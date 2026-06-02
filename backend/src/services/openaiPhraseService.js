const OpenAI = require("openai");

// PRIVACIDAD: solo texto y etiquetas van a OpenAI. Nunca datos personales del usuario.

const SYSTEM_PROMPT = `Eres un asistente AAC en español.
Reformula frases telegráficas en frases naturales, pero conserva TODOS los conceptos.

REGLAS:
- No elimines ningún concepto original.
- Añade solo palabras funcionales imprescindibles: artículos, preposiciones, conjunciones.
- No uses "de" por defecto.
- Enumeraciones con "," e "y": "sopa, puré y espaguetis".
- Usa "de" solo en relaciones naturales: "vaso de agua", "puré de patata", "casa de mamá".
- La salida debe ser breve y clara.

MODOS (se indica en la entrada como [mode:...]):
- statement (por defecto): afirmación en presente. Conjuga verbos normalmente. NO añadir "quiero"/"necesito" salvo que el usuario lo haya incluido explícitamente.
- request: petición o deseo. Puedes añadir "quiero" o "necesito" si resulta natural.
- past: afirmación en pasado (pretérito indefinido o imperfecto según contexto).
- future: afirmación en futuro próximo ("voy a…") o futuro simple.

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

wordType usa SOLO: "verb", "pronoun", "noun", "descriptor", "social", "place", "time", "misc"

Ejemplos:

[mode:statement] "yo ser veloz"
→ { "reformulatedText": "Yo soy veloz.", "canonicalTokens": [{"text":"yo","wordType":"pronoun"},{"text":"ser","wordType":"verb"},{"text":"veloz","wordType":"descriptor"}], "displayTokens": [{"text":"Yo","wordType":"pronoun"},{"text":"soy","wordType":"verb"},{"text":"veloz","wordType":"descriptor"}], "confidence": 0.95, "notes": [] }

[mode:statement] "yo comer sopa puré espaguetis"
→ { "reformulatedText": "Yo como sopa, puré y espaguetis.", "canonicalTokens": [{"text":"yo","wordType":"pronoun"},{"text":"comer","wordType":"verb"},{"text":"sopa","wordType":"noun"},{"text":"puré","wordType":"noun"},{"text":"y","wordType":"misc"},{"text":"espaguetis","wordType":"noun"}], "displayTokens": [{"text":"Yo","wordType":"pronoun"},{"text":"como","wordType":"verb"},{"text":"sopa","wordType":"noun"},{"text":"puré","wordType":"noun"},{"text":"y","wordType":"misc"},{"text":"espaguetis","wordType":"noun"}], "confidence": 0.95, "notes": [] }

[mode:request] "yo comer sopa puré espaguetis"
→ { "reformulatedText": "Yo quiero comer sopa, puré y espaguetis.", ... }

[mode:past] "yo comer sopa"
→ { "reformulatedText": "Yo comí sopa.", ... }

[mode:future] "yo ir parque"
→ { "reformulatedText": "Yo voy a ir al parque.", ... }

Responde solo JSON.`;

/**
 * Llama a OpenAI para reformular una frase telegráfica AAC.
 * Devuelve reformulatedText + canonicalTokens + displayTokens (objetos {text, wordType}).
 *
 * @param {string} text   - Frase telegráfica.
 * @param {string} locale - Código de idioma. Por defecto "es".
 * @returns {Promise<{ reformulatedText, canonicalTokens, displayTokens, confidence, notes }>}
 */
exports.reformulatePhrase = async (text, locale = "es", mode = "statement") => {
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
        { role: "user", content: `[mode:${mode}] Entrada: "${text}"` },
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
