const openaiPhraseService  = require('../services/openaiPhraseService');
const aiPictogramResolver  = require('../services/aiPictogramResolver');

const VALID_WORD_TYPES = new Set(['verb', 'noun', 'pronoun', 'descriptor', 'social', 'misc']);

/**
 * Normaliza una entrada del array de tokens de OpenAI.
 * Acepta tanto string (formato antiguo) como { text, wordType } (formato actual).
 */
function normalizeToken(t) {
  if (typeof t === 'string') return { text: t, wordType: 'misc' };
  if (t && typeof t === 'object') {
    return {
      text:     String(t.text || ''),
      wordType: VALID_WORD_TYPES.has(t.wordType) ? t.wordType : 'misc',
    };
  }
  return { text: '', wordType: 'misc' };
}

/**
 * POST /api/ai/reformulate-phrase
 *
 * Reformula una frase telegráfica AAC y devuelve la secuencia de tokens
 * con pictogramas resueltos (original → ARASAAC → texto).
 *
 * Body esperado:
 *   { text, locale?, tokens?: Array<{ label, imageUrl, color, wordType, fitzgeraldEnabled }> }
 *
 * Respuesta:
 *   { originalText, reformulatedText, confidence, notes, tokens: Array<ResolvedToken> }
 */
exports.reformulatePhrase = async (req, res) => {
  try {
    const { text, locale = 'es', tokens: originalTokens = [], mode = 'statement' } = req.body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'El campo "text" es obligatorio y no puede estar vacío.' });
    }

    const trimmedText = text.trim();
    if (trimmedText.length > 500) {
      return res.status(400).json({ error: 'El texto no puede superar 500 caracteres.' });
    }

    const validModes = new Set(['statement', 'request', 'past', 'future']);
    const safeMode = validModes.has(mode) ? mode : 'statement';

    const aiResult = await openaiPhraseService.reformulatePhrase(trimmedText, locale, safeMode);

    // Normalizar a Array<{text, wordType}> (acepta strings o objetos)
    let canonicals = aiResult.canonicalTokens.map(normalizeToken);
    let displays   = aiResult.displayTokens.map(normalizeToken);

    // Validar longitudes iguales y no vacías
    const valid = canonicals.length > 0 && canonicals.length === displays.length;
    if (!valid) {
      const words = aiResult.reformulatedText.trim().split(/\s+/);
      canonicals = words.map(w => ({ text: w, wordType: 'misc' }));
      displays   = words.map(w => ({ text: w, wordType: 'misc' }));
    }

    const resolvedTokens = await aiPictogramResolver.resolveTokens(
      canonicals,
      displays,
      originalTokens,
    );

    return res.json({
      originalText:     trimmedText,
      reformulatedText: aiResult.reformulatedText,
      confidence:       aiResult.confidence,
      notes:            aiResult.notes,
      tokens:           resolvedTokens,
    });
  } catch (err) {
    console.error('[AI] reformulatePhrase error:', err.message);

    if (err.code === 'MISSING_API_KEY') {
      return res.status(503).json({ error: 'El servicio de IA no está configurado. Contacta al administrador.' });
    }
    if (err.status === 429 || err.code === 'rate_limit_exceeded') {
      return res.status(429).json({ error: 'Límite de la API de IA alcanzado. Inténtalo de nuevo en unos segundos.' });
    }
    if (err.status === 401) {
      return res.status(503).json({ error: 'API key de IA no válida. Contacta al administrador.' });
    }
    if (err.name === 'AbortError' || err.code === 'ETIMEDOUT' || err.type === 'request-timeout') {
      return res.status(504).json({ error: 'El servicio de IA tardó demasiado. Inténtalo de nuevo.' });
    }

    return res.status(500).json({ error: 'Error al procesar la frase con IA. Inténtalo de nuevo.' });
  }
};
