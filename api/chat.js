// /api/chat.js

// =======================
// Reglas y helpers (FUERA del handler)
// =======================

const LEVEL_RULES = {
  A1: `
REGLAS DE NIVEL A1 (OBLIGATORIAS):
- Usa SOLO presente de indicativo.
- Frases MUY cortas (max 6–8 palabras).
- Léxico muy frecuente y concreto.
- NO uses: pasado, futuro, condicional, subjuntivo, perífrasis complejas.
- NO uses preguntas abiertas tipo: "¿Qué tal tu semana?" / "Cuéntame..."
- Mantén la conversación en 1 acción: responder + 1 pregunta simple.
- Si reformulas, que sea muy corta.
`.trim(),

  A2: `
REGLAS DE NIVEL A2 (OBLIGATORIAS):
- Presente y pasado perfecto (he + participio).
- Frases cortas; alguna coordinación con "y/pero".
- Preguntas simples y dirigidas.
- Evita expresiones idiomáticas complejas.
`.trim(),

  B1: `
REGLAS DE NIVEL B1:
- Pasados principales.
- Conectores básicos (porque, entonces, aunque).
- Puedes pedir opinión simple.
`.trim(),

  B2: `
REGLAS DE NIVEL B2:
- Subjuntivo frecuente cuando corresponda.
- Conectores discursivos y matización.
`.trim(),

  C1: `
REGLAS DE NIVEL C1:
- Lengua natural con registro adecuado.
- Corrige solo lo relevante.
`.trim(),

  C2: `
REGLAS DE NIVEL C2:
- Máxima naturalidad, precisión y flexibilidad estilística.
`.trim(),
};

function getLevelRules(level) {
  return LEVEL_RULES[level] || LEVEL_RULES.A1;
}

function getSentenceLimits(level) {
  // Límite distinto según haya reformulación o no
  if (level === "A1") return { withReformulation: 3, withoutReformulation: 2 };
  if (level === "A2") return { withReformulation: 3, withoutReformulation: 2 };
  if (level === "B1") return { withReformulation: 4, withoutReformulation: 3 };
  if (level === "B2") return { withReformulation: 5, withoutReformulation: 4 };
  if (level === "C1") return { withReformulation: 6, withoutReformulation: 5 };
  if (level === "C2") return { withReformulation: 7, withoutReformulation: 6 };
  return { withReformulation: 3, withoutReformulation: 2 };
}

function getCorrectionMode(level) {
  if (level === "A1" || level === "A2") return "explicit";
  if (level === "B1" || level === "B2") return "light";
  return "minimal";
}

// Limpia texto del modelo (por si “se escapa” del formato)
function cleanModelText(textRaw) {
  return String(textRaw || "")
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .replace(/^\s*Here is the JSON requested:\s*/i, "")
    .replace(/^\s*Here is the JSON:\s*/i, "")
    .replace(/^\s*Here is\s*/i, "")
    .trim();
}

// Extrae el primer bloque JSON (objeto o array) del texto
function extractJsonString(textRaw) {
  const t = cleanModelText(textRaw);

  // 1) Si ya es JSON puro
  try {
    JSON.parse(t);
    return t;
  } catch {}

  // 2) Busca primer {...} o [...]
  const match = t.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (!match) return null;

  const candidate = match[1].trim();
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    return null;
  }
}

function safeNormalizeParsed(parsed, fallbackText) {
  const reply =
    typeof parsed?.reply === "string" && parsed.reply.trim()
      ? parsed.reply.trim()
      : (cleanModelText(fallbackText) || "Perdón, ¿puedes repetirlo?");

  const ids = Array.isArray(parsed?.completed_objective_ids)
    ? parsed.completed_objective_ids.map((x) => String(x))
    : [];

  return { reply, completed_objective_ids: ids };
}

// =======================
// Handler
// =======================

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY in server env" });
    }

    // 1) Body robusto (en Vercel a veces llega como string)
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    body = body || {};

    const {
      history = [],
      scenario,
      level = "A1",
      userMessage,
      currentObjectives = []
    } = body;

    if (!scenario?.title || !scenario?.botPersona?.name) {
      return res.status(400).json({ error: "Missing scenario data" });
    }
    if (!userMessage || typeof userMessage !== "string") {
      return res.status(400).json({ error: "Missing userMessage" });
    }

    // 2) Historial corto y limpio (quita "(Demo)")
    const shortHistory = (Array.isArray(history) ? history : [])
      .slice(-6)
      .map((m) => ({
        sender: m?.sender,
        text: String(m?.text ?? "").replace(/^\(Demo\)\s*/i, "")
      }));

    const objectivesList = (Array.isArray(currentObjectives) ? currentObjectives : [])
      .map((o) => {
        const id = String(o?.id ?? "");
        const text = String(o?.text ?? "");
        const done = Boolean(o?.completed);
        return `- ID: "${id}": ${text} (Estado: ${done ? "Completado" : "Pendiente"})`;
      })
      .join("\n");

    // ✅ Dinámicos por nivel (dependen del body)
    const sentenceLimits = getSentenceLimits(level);
    const correctionMode = getCorrectionMode(level);

    // Prompt del sistema
    const baseSystemPrompt = `
Actúa como un interlocutor nativo en un escenario de práctica de español.

CONTEXTO:
Escenario: "${scenario.title}"
Rol: "${scenario.botPersona.name}"
Nivel del estudiante: ${level}

OBJETIVOS:
${objectivesList}

${getLevelRules(level)}

REGLAS GENERALES:
- Responde SIEMPRE en español.
- Mantén el rol del escenario (persona real, no profesor), PERO respeta estrictamente las reglas del nivel.
- NO expliques gramática ni evalúes.
- Interpreta con buena fe.
- El valor de "reply" debe estar SIEMPRE en español. Prohibido usar inglés (por ejemplo: "Here", "Here is", etc.).
- Si estás a punto de escribir una palabra en inglés, en su lugar escribe: "Perdón, ¿puedes repetirlo?"


LÍMITE DE FRASES:
- Si HAY reformulación: máximo ${sentenceLimits.withReformulation} frase(s).
- Si NO hay reformulación: máximo ${sentenceLimits.withoutReformulation} frase(s).
- Si reformulas, procura que la reformulación sea 1 frase corta.
REGLA DURA: No superes esos límites bajo ninguna circunstancia.

CONTINUACIÓN (según nivel):
- A1/A2: termina con UNA pregunta muy simple (A1/A2).
- B1/B2: termina con una pregunta breve, puede ser abierta.
- C1/C2: termina con una pregunta natural o un comentario que invite a continuar (no siempre pregunta).

CORRECCIÓN (según nivel):
- Modo actual: ${correctionMode}
- Si correctionMode = "explicit" (A1/A2):
  - Si hay errores pero se entiende: empieza con "Ah, quieres decir: '<frase corregida>'." y sigue.
  - Si está bien: NO reformules.
- Si correctionMode = "light" (B1/B2):
  - Reformula solo si ayuda a la fluidez (breve) y no siempre.
- Si correctionMode = "minimal" (C1/C2):
  - Solo corrige si el error dificulta o es muy relevante. Si no, sigue natural.

ININTELIGIBLE:
- Si el mensaje es realmente ininteligible, di:
  "Perdón, no te entiendo. ¿Puedes decirlo de otra forma?"

FORMATO (OBLIGATORIO):
Devuelve SOLO un JSON válido con las claves:
- reply (string)
- completed_objective_ids (array de strings)

PROHIBIDO:
- Texto fuera del JSON
- La palabra "Here" (en cualquier parte).
- Markdown o \`\`\`
- Frases tipo "Here is..."
`.trim();
    

    // Contenido para Gemini
    const contents = [
      ...shortHistory.map((msg) => ({
        role: msg?.sender === "user" ? "user" : "model",
        parts: [{ text: msg.text }]
      })),
      { role: "user", parts: [{ text: userMessage }] }
    ];

    async function callGemini({ strict = false } = {}) {
      const systemPrompt = strict
        ? `${baseSystemPrompt}\n\nULTIMA REGLA: el primer carácter de tu respuesta debe ser { y el último }`
        : baseSystemPrompt;

      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

      let r;
      try {
        r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: {
                type: "object",
                properties: {
                  reply: { type: "string" },
                  completed_objective_ids: {
                    type: "array",
                    items: { type: "string" }
                  }
                },
                required: ["reply", "completed_objective_ids"]
              },
              temperature: strict ? 0.1 : (level === "A1" ? 0.2 : level === "A2" ? 0.25 : 0.4),
              maxOutputTokens: (level === "A1" ? 120 : level === "A2" ? 140 : level === "B1" ? 180 : 260),
            }
          })
        });
      } catch (e) {
        return { ok: false, status: 502, data: { error: "Fetch to Gemini failed", details: String(e?.message || e) } };
      }

      let data;
      try {
        data = await r.json();
      } catch (e) {
        return { ok: false, status: 502, data: { error: "Gemini returned non-JSON", details: String(e?.message || e) } };
      }

      if (!r.ok) return { ok: false, status: r.status, data };

      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      const textRaw = parts.map((p) => p?.text ?? "").join("").trim();

      return { ok: true, textRaw, data };
    }

    // -------- Lógica principal --------

    // Intento normal
    const out = await callGemini({ strict: false });
    if (!out.ok) {
      return res.status(out.status).json({ error: "Gemini API error", details: out.data });
    }

    let jsonStr = extractJsonString(out.textRaw);

    // Reintento estricto si no hay JSON válido
    if (!jsonStr) {
      const out2 = await callGemini({ strict: true });
      if (!out2.ok) {
        return res.status(out2.status).json({ error: "Gemini API error", details: out2.data });
      }
      jsonStr = extractJsonString(out2.textRaw);

      // Si sigue sin JSON, NO rompas el chat
      if (!jsonStr) {
        const fallbackReply = cleanModelText(out2.textRaw);
        return res.status(200).json({
          reply: fallbackReply || "Perdón, ¿qué quieres hacer ahora?",
          completed_objective_ids: []
        });
      }

      // Parse del segundo intento
      try {
        const parsed2 = JSON.parse(jsonStr);
        return res.status(200).json(safeNormalizeParsed(parsed2, out2.textRaw));
      } catch {
        const fallbackReply = cleanModelText(out2.textRaw);
        return res.status(200).json({
          reply: fallbackReply || "Perdón, ¿qué quieres hacer ahora?",
          completed_objective_ids: []
        });
      }
    }

    // Parse del primer intento
    try {
      const parsed = JSON.parse(jsonStr);
      return res.status(200).json(safeNormalizeParsed(parsed, out.textRaw));
    } catch {
      const fallbackReply = cleanModelText(out.textRaw);
      return res.status(200).json({
        reply: fallbackReply || "Perdón, ¿qué quieres hacer ahora?",
        completed_objective_ids: []
      });
    }
  } catch (err) {
    return res.status(500).json({ error: "Server error", details: String(err?.message || err) });
  }
}
