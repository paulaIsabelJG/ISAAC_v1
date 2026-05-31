const ArasaacPictogram = require('../models/ArasaacPictogram');

const ARASAAC_IMG = (id) => `https://static.arasaac.org/pictograms/${id}/${id}_500.png`;
const escapeRegex = (s)  => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Normaliza para comparación en memoria: minúsculas, sin tildes ni diacríticos, sin puntuación.
 * Ejemplo: "más" → "mas", "niño" → "nino", "Querer" → "querer".
 * NOTA: NO se usa para construir regexes de BD (allí se usa el texto original para preservar tildes).
 */
const normalize = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // elimina diacríticos combinados (tildes, cedilla, ñ→n…)
    .replace(/[.,;:!?¡¿"'()«»\-]/g, '')
    .trim();

/**
 * Busca en ARASAAC en lote para una lista de textos originales (con tildes, sin normalizar).
 * Devuelve Map<normalizedText, doc> para lookups consistentes.
 *
 * Query 1: label exacto case-insensitive.
 * Query 2: keywords (string o {keyword}) para los no encontrados en Q1.
 * Máximo 2 queries en vez de N secuenciales.
 *
 * @param {string[]} rawTexts — textos originales (no normalizados) para queries precisas
 * @returns {Map<string, doc>}
 */
async function batchSearchArasaac(rawTexts) {
  const result = new Map(); // clave: normalize(texto), valor: doc
  if (!rawTexts.length) return result;

  // Q1: búsqueda por label exacto (case-insensitive, preserva tildes del original)
  const labelRegexes = rawTexts.map(s => new RegExp(`^${escapeRegex(s)}$`, 'i'));
  try {
    const labelDocs = await ArasaacPictogram.find({ label: { $in: labelRegexes } }).lean();
    for (const doc of labelDocs) {
      const key = normalize(doc.label);
      if (!result.has(key)) result.set(key, doc);
    }
  } catch (e) {
    console.error('[AI Resolver] batchSearch Q1 error:', e.message);
  }

  // Q2: búsqueda por keywords para los textos aún sin resultado
  const missingRaw = rawTexts.filter(t => !result.has(normalize(t)));
  if (missingRaw.length > 0) {
    const kwRegexes = missingRaw.map(s => new RegExp(`^${escapeRegex(s)}$`, 'i'));
    try {
      const kwDocs = await ArasaacPictogram.find({
        $or: [
          { keywords:           { $in: kwRegexes } }, // keywords como strings
          { 'keywords.keyword': { $in: kwRegexes } }, // keywords como objetos {keyword, type}
        ],
      }).lean();

      for (const doc of kwDocs) {
        for (const rawTerm of missingRaw) {
          const normTerm = normalize(rawTerm);
          if (result.has(normTerm)) continue;
          const re = new RegExp(`^${escapeRegex(rawTerm)}$`, 'i');
          const matchLabel   = re.test(doc.label);
          const matchKeyword = Array.isArray(doc.keywords) && doc.keywords.some(k =>
            re.test(typeof k === 'string' ? k : (k?.keyword ?? ''))
          );
          if (matchLabel || matchKeyword) {
            result.set(normTerm, doc);
            break;
          }
        }
      }
    } catch (e) {
      console.error('[AI Resolver] batchSearch Q2 error:', e.message);
    }
  }

  return result;
}

/**
 * Resuelve canonical/display tokens a pictogramas concretos.
 *
 * Pipeline por índice i:
 *   1. canonNorm encontrado en tokens originales → preserva imagen/color/wordType original.
 *   2. canonNorm en ARASAAC → Fitzgerald. Si no: también intenta displayNorm (resiliencia ante
 *      AI que devuelva forma conjugada como canonical en lugar de infinitivo).
 *   3. Fallback textual → Fitzgerald con wordType IA, mismo formato visual.
 *
 * @param {Array<{text:string, wordType:string}>} canonicals
 * @param {Array<{text:string, wordType:string}>} displays   — misma longitud
 * @param {Array<{label, imageUrl, color, wordType, fitzgeraldEnabled}>} originalTokens
 * @returns {Promise<Array<ResolvedToken>>}
 */
exports.resolveTokens = async (canonicals, displays, originalTokens) => {
  // Índice de originales por label normalizado (sin tildes)
  const origByLabel = new Map();
  for (const t of (originalTokens || [])) {
    if (t.label) origByLabel.set(normalize(t.label), t);
  }

  const notInOriginals = (raw) => raw && !origByLabel.has(normalize(raw));

  // Búsqueda ARASAAC batch con textos ORIGINALES (preserva tildes para el regex DB).
  // Incluye tanto canonical como display: si el AI devuelve canonical="quiero" (error de conjugación)
  // el display="quiero" también se busca, y si "quiero" es keyword de "querer" en ARASAAC, se encuentra.
  const rawToSearch = [...new Set([
    ...canonicals.map(c => c.text).filter(notInOriginals),
    ...displays.map(d => d.text).filter(notInOriginals),
  ])];

  const arasaacMap = await batchSearchArasaac(rawToSearch);

  const resolved = [];

  for (let i = 0; i < canonicals.length; i++) {
    const canonRaw    = canonicals[i].text || '';
    const displayRaw  = displays[i]?.text  || canonRaw;
    const canonNorm   = normalize(canonRaw);
    const displayNorm = normalize(displayRaw);
    const wordType    = canonicals[i].wordType || 'misc';

    let source            = 'text';
    let foundLabel        = '';
    let imageUrl          = '';
    let color             = '';
    let resolvedWordType  = wordType;
    let fitzgeraldEnabled = true;
    let originalLabel     = null;

    // ── 1: token original → preservar color/wordType del pictograma del usuario ────
    const orig = origByLabel.get(canonNorm);
    if (orig) {
      source            = 'original';
      foundLabel        = orig.label;
      imageUrl          = orig.imageUrl  || '';
      color             = orig.color     || '';
      resolvedWordType  = orig.wordType  || 'misc';
      fitzgeraldEnabled = !!orig.fitzgeraldEnabled;
      originalLabel     = orig.label;
    }

    // ── 2: ARASAAC — canonical primero; display como fallback de resiliencia ────────
    if (source === 'text') {
      const doc = arasaacMap.get(canonNorm) ?? arasaacMap.get(displayNorm);
      if (doc) {
        source            = 'arasaac';
        foundLabel        = doc.label;
        imageUrl          = doc.imageUrl || ARASAAC_IMG(doc.arasaacId);
        color             = '';
        resolvedWordType  = wordType;
        fitzgeraldEnabled = true;
        originalLabel     = null;
      }
    }

    // ── Log de depuración (temporal, eliminar en producción) ─────────────────────────
    console.log(
      `[AI Resolver] #${i}` +
      `  canonical="${canonRaw}"` +
      `  display="${displayRaw}"` +
      `  → source="${source}"` +
      `  arasaacLabel="${foundLabel}"` +
      `  wordType="${resolvedWordType}"` +
      `  fitz=${fitzgeraldEnabled}` +
      `  color="${color}"`
    );

    resolved.push({
      text:              displayRaw,
      source,
      originalLabel,
      imageUrl,
      color,
      wordType:          resolvedWordType,
      fitzgeraldEnabled,
    });
  }

  return resolved;
};
