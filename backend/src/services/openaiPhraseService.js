const OpenAI = require("openai");

// PRIVACIDAD: solo se envían a OpenAI la frase, el modo y el género gramatical.
// No se envían nombre, ubicación, dirección, diagnóstico ni datos personales.

const VALID_MODES   = new Set(["statement", "request", "past", "future"]);
const VALID_GENDERS = new Set(["male", "female", "neutral", "unknown"]);

// Límites de max_tokens ajustables sin tocar el prompt.
// El JSON de respuesta tiene ~100 tokens de overhead de estructura, más ~40 por token de salida.
const MIN_TOKENS     = 220;
const MAX_TOKENS     = 420;
const TOKENS_PER_WORD = 55;

const SYSTEM_PROMPT = `Eres un asistente AAC en español.
Reformula frases telegráficas creadas con pictogramas en frases naturales, breves y claras.

OBJETIVO:
- Conserva TODOS los conceptos originales.
- Corrige concordancia, orden, artículos, preposiciones y tiempos verbales.
- No añadas intención nueva.
- No inventes información.
- No elimines conceptos.

REGLAS:
- Añade solo palabras funcionales imprescindibles.
- No añadas "quiero", "necesito" o "me gustaría" salvo en modo request o si el usuario lo incluyó explícitamente.
- No uses "de" por defecto.
- Usa "de" solo en relaciones naturales: "vaso de agua", "puré de patata", "casa de mamá".
- Enumeraciones con "," e "y".
- La frase final debe ser corta, natural y comprensible.

GÉNERO DEL USUARIO:
- En la entrada recibirás [userGender:male|female|neutral|unknown].
- Usa ese género SOLO cuando la frase describa al propio usuario.
- Si aparece "yo", "me", "mi", "estoy", "soy", "me siento" o una descripción directa del usuario, adapta adjetivos y participios al género indicado.
- Ejemplo con userGender:female: "yo estar cansado" → "Yo estoy cansada."
- Ejemplo con userGender:male: "yo estar contenta" → "Yo estoy contento."
- Si la frase se refiere a otra persona, usa el género inferido por el sentido de la oración.
- Ejemplo: "mamá estar contento" → "Mamá está contenta."
- Ejemplo: "papá estar cansada" → "Papá está cansado."
- Si no se puede inferir el género de otra persona, conserva una forma natural sin forzar.

TIEMPOS VERBALES SEGÚN MODO:
- statement: afirmación en presente. Conjuga de forma natural. No añadas deseo si no aparece.
- request: petición o deseo. Puedes añadir "quiero" o "necesito" si resulta natural.
- past: afirmación en pasado.
  - Usa pretérito indefinido para acciones terminadas: "comí", "fui", "jugué", "bebí".
  - Usa imperfecto para estados, descripciones, hábitos o duración: "estaba", "era", "tenía", "quería".
  - Ejemplos:
    "yo comer sopa" → "Yo comí sopa."
    "yo ir parque" → "Yo fui al parque."
    "yo estar triste" → "Yo estaba triste."
    "yo ser pequeño" → "Yo era pequeño/pequeña según userGender."
    "mamá estar contento" → "Mamá estaba contenta."
- future: futuro próximo con "voy a..." salvo que el futuro simple sea más natural.
  Ejemplo: "yo ir parque" → "Yo voy a ir al parque."

TOKENS:
- canonicalTokens y displayTokens deben tener la MISMA longitud y estar alineados por índice.
- canonicalTokens:
  - forma base para buscar pictogramas.
  - verbos en infinitivo.
  - sustantivos preferiblemente en singular.
  - adjetivos en masculino singular como forma base si aplica.
  - artículos, preposiciones y conjunciones solo si aparecen en displayTokens y son necesarios.
- displayTokens:
  - forma final visible.
  - debe coincidir con reformulatedText.
  - debe tener conjugación, género y número correctos.

wordType usa SOLO:
"verb", "pronoun", "noun", "descriptor", "social", "place", "time", "misc"

FORMATO:
Devuelve SOLO JSON válido, sin markdown, sin explicación.

Estructura:
{
  "reformulatedText": "...",
  "canonicalTokens": [{"text":"...","wordType":"..."}],
  "displayTokens": [{"text":"...","wordType":"..."}],
  "confidence": 0.95,
  "notes": []
}

Ejemplos:

[mode:statement] [userGender:female] "yo estar cansado"
→ {"reformulatedText":"Yo estoy cansada.","canonicalTokens":[{"text":"yo","wordType":"pronoun"},{"text":"estar","wordType":"verb"},{"text":"cansado","wordType":"descriptor"}],"displayTokens":[{"text":"Yo","wordType":"pronoun"},{"text":"estoy","wordType":"verb"},{"text":"cansada","wordType":"descriptor"}],"confidence":0.95,"notes":[]}

[mode:statement] [userGender:male] "yo estar contenta"
→ {"reformulatedText":"Yo estoy contento.","canonicalTokens":[{"text":"yo","wordType":"pronoun"},{"text":"estar","wordType":"verb"},{"text":"contento","wordType":"descriptor"}],"displayTokens":[{"text":"Yo","wordType":"pronoun"},{"text":"estoy","wordType":"verb"},{"text":"contento","wordType":"descriptor"}],"confidence":0.95,"notes":[]}

[mode:statement] [userGender:female] "mamá estar contento"
→ {"reformulatedText":"Mamá está contenta.","canonicalTokens":[{"text":"mamá","wordType":"noun"},{"text":"estar","wordType":"verb"},{"text":"contento","wordType":"descriptor"}],"displayTokens":[{"text":"Mamá","wordType":"noun"},{"text":"está","wordType":"verb"},{"text":"contenta","wordType":"descriptor"}],"confidence":0.95,"notes":[]}

[mode:past] [userGender:female] "yo estar triste"
→ {"reformulatedText":"Yo estaba triste.","canonicalTokens":[{"text":"yo","wordType":"pronoun"},{"text":"estar","wordType":"verb"},{"text":"triste","wordType":"descriptor"}],"displayTokens":[{"text":"Yo","wordType":"pronoun"},{"text":"estaba","wordType":"verb"},{"text":"triste","wordType":"descriptor"}],"confidence":0.95,"notes":[]}

[mode:past] [userGender:male] "yo ser pequeño"
→ {"reformulatedText":"Yo era pequeño.","canonicalTokens":[{"text":"yo","wordType":"pronoun"},{"text":"ser","wordType":"verb"},{"text":"pequeño","wordType":"descriptor"}],"displayTokens":[{"text":"Yo","wordType":"pronoun"},{"text":"era","wordType":"verb"},{"text":"pequeño","wordType":"descriptor"}],"confidence":0.95,"notes":[]}

[mode:past] [userGender:unknown] "yo comer sopa"
→ {"reformulatedText":"Yo comí sopa.","canonicalTokens":[{"text":"yo","wordType":"pronoun"},{"text":"comer","wordType":"verb"},{"text":"sopa","wordType":"noun"}],"displayTokens":[{"text":"Yo","wordType":"pronoun"},{"text":"comí","wordType":"verb"},{"text":"sopa","wordType":"noun"}],"confidence":0.95,"notes":[]}

[mode:future] [userGender:unknown] "yo ir parque"
→ {"reformulatedText":"Yo voy a ir al parque.","canonicalTokens":[{"text":"yo","wordType":"pronoun"},{"text":"ir","wordType":"verb"},{"text":"a","wordType":"misc"},{"text":"ir","wordType":"verb"},{"text":"al","wordType":"misc"},{"text":"parque","wordType":"place"}],"displayTokens":[{"text":"Yo","wordType":"pronoun"},{"text":"voy","wordType":"verb"},{"text":"a","wordType":"misc"},{"text":"ir","wordType":"verb"},{"text":"al","wordType":"misc"},{"text":"parque","wordType":"place"}],"confidence":0.95,"notes":[]}

Responde solo JSON.`;

/**
 * Llama a OpenAI para reformular una frase telegráfica AAC.
 * Devuelve reformulatedText + canonicalTokens + displayTokens (objetos {text, wordType}).
 *
 * @param {string} text       - Frase telegráfica.
 * @param {string} locale     - Código de idioma. Por defecto "es".
 * @param {string} mode       - statement | request | past | future. Por defecto "statement".
 * @param {string} userGender - male | female | neutral | unknown. Por defecto "unknown".
 * @returns {Promise<{ reformulatedText, canonicalTokens, displayTokens, confidence, notes }>}
 */
exports.reformulatePhrase = async (
  text,
  locale = "es",
  mode = "statement",
  userGender = "unknown",
) => {
  // ── Validación de entrada ────────────────────────────────────────────────────
  if (!text || typeof text !== "string" || !text.trim()) {
    const err = new Error("El texto de entrada no puede estar vacío.");
    err.code = "EMPTY_TEXT";
    throw err;
  }

  const safeText   = text.trim();
  const safeMode   = VALID_MODES.has(mode)          ? mode       : "statement";
  const safeGender = VALID_GENDERS.has(userGender)  ? userGender : "unknown";

  // ── Cliente OpenAI ───────────────────────────────────────────────────────────
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error(
      "OPENAI_API_KEY no está configurada en las variables de entorno.",
    );
    err.code = "MISSING_API_KEY";
    throw err;
  }

  const model  = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const client = new OpenAI({ apiKey, timeout: 12_000 });

  const inputTokenCount = safeText.split(/\s+/).filter(Boolean).length;
  const maxTokens = Math.min(MAX_TOKENS, Math.max(MIN_TOKENS, inputTokenCount * TOKENS_PER_WORD));

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user",   content: `[mode:${safeMode}] [userGender:${safeGender}] Entrada: "${safeText}"` },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
    max_tokens:  maxTokens,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const err = new Error("La respuesta de OpenAI no es JSON válido: " + raw);
    err.code = "INVALID_JSON";
    throw err;
  }

  if (!parsed.reformulatedText || typeof parsed.reformulatedText !== "string") {
    const err = new Error(
      "La respuesta de OpenAI no contiene reformulatedText.",
    );
    err.code = "MISSING_FIELD";
    throw err;
  }

  const canonicalTokens = Array.isArray(parsed.canonicalTokens) ? parsed.canonicalTokens : [];
  const displayTokens   = Array.isArray(parsed.displayTokens)   ? parsed.displayTokens   : [];
  const notes           = Array.isArray(parsed.notes)           ? parsed.notes           : [];

  // Advertencia de alineación (el controller ya tiene fallback para este caso).
  if (canonicalTokens.length !== displayTokens.length) {
    notes.push("canonicalTokens y displayTokens no tienen la misma longitud.");
  }

  return {
    reformulatedText: parsed.reformulatedText,
    canonicalTokens,
    displayTokens,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
    notes,
  };
};
