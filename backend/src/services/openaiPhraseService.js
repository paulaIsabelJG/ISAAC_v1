const OpenAI = require("openai");

// PRIVACIDAD: solo texto y etiquetas van a OpenAI. Nunca datos personales del usuario.

const SYSTEM_PROMPT = `Eres un asistente AAC en español.
Reformula frases telegráficas en frases naturales, pero conserva TODOS los conceptos.

REGLAS:
- No elimines ningún concepto original.
- No añadas contenido nuevo.
- Añade solo palabras funcionales necesarias: artículos, preposiciones, conjunciones.
- No uses "de" por defecto.
- Si hay varios alimentos/objetos/personas seguidos, trátalos como enumeración con "," e "y", salvo que claramente formen una expresión natural con "de".
- Usa "de" solo cuando sea una relación natural: "vaso de agua", "puré de patata", "casa de mamá".
- La salida debe ser breve y clara.

Devuelve SOLO JSON válido:
{
  "reformulatedText": "...",
  "canonicalTokens": [{"text":"...","wordType":"..."}],
  "displayTokens": [{"text":"...","wordType":"..."}],
  "confidence": 0.95,
  "notes": []
}

canonicalTokens:
- forma BASE para buscar pictogramas.
- verbos en infinitivo.
- sustantivos preferiblemente en singular.
- misma longitud que displayTokens.

displayTokens:
- forma FINAL visible.
- concordancia correcta.
- alineado por índice con canonicalTokens.

wordType usa SOLO:
- "verb"
- "pronoun"
- "noun"
- "descriptor"
- "social"
- "place"
- "time"
- "misc"

Ejemplos:
Entrada: "yo comer sopa puré espaguetis"
Salida:
{
  "reformulatedText": "Yo quiero comer sopa, puré y espaguetis.",
  "canonicalTokens": [
    {"text":"yo","wordType":"pronoun"},
    {"text":"querer","wordType":"verb"},
    {"text":"comer","wordType":"verb"},
    {"text":"sopa","wordType":"noun"},
    {"text":"puré","wordType":"noun"},
    {"text":"y","wordType":"misc"},
    {"text":"espaguetis","wordType":"noun"}
  ],
  "displayTokens": [
    {"text":"Yo","wordType":"pronoun"},
    {"text":"quiero","wordType":"verb"},
    {"text":"comer","wordType":"verb"},
    {"text":"sopa","wordType":"noun"},
    {"text":"puré","wordType":"noun"},
    {"text":"y","wordType":"misc"},
    {"text":"espaguetis","wordType":"noun"}
  ],
  "confidence": 0.95,
  "notes": []
}

Entrada: "yo beber vaso agua"
Salida: "Yo quiero beber un vaso de agua."

Responde solo JSON.`;

/**
 * Llama a OpenAI para reformular una frase telegráfica AAC.
 * Devuelve reformulatedText + canonicalTokens + displayTokens (objetos {text, wordType}).
 *
 * @param {string} text   - Frase telegráfica.
 * @param {string} locale - Código de idioma. Por defecto "es".
 * @returns {Promise<{ reformulatedText, canonicalTokens, displayTokens, confidence, notes }>}
 */
exports.reformulatePhrase = async (text, locale = "es") => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error(
      "OPENAI_API_KEY no está configurada en las variables de entorno.",
    );
    err.code = "MISSING_API_KEY";
    throw err;
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const client = new OpenAI({ apiKey });

  const inputTokenCount = text.trim().split(/\s+/).filter(Boolean).length;

  // La IA puede añadir conectores/artículos, así que damos margen.
  // Mínimo 220, máximo 500.
  const maxTokens = Math.min(500, Math.max(220, inputTokenCount * 70));

  const completion = await client.chat.completions.create(
    {
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Entrada: "${text}"` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: maxTokens,
    },
    { timeout: 12_000 },
  );

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

  return {
    reformulatedText: parsed.reformulatedText,
    canonicalTokens: Array.isArray(parsed.canonicalTokens)
      ? parsed.canonicalTokens
      : [],
    displayTokens: Array.isArray(parsed.displayTokens)
      ? parsed.displayTokens
      : [],
    confidence:
      typeof parsed.confidence === "number" ? parsed.confidence : null,
    notes: Array.isArray(parsed.notes) ? parsed.notes : [],
  };
};
