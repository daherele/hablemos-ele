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

function cleanModelText(textRaw) {
  return String(textRaw || "")
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .replace(/^\s*Here is the JSON requested:\s*/i, "")
    .replace(/^\s*Here is the JSON:\s*/i, "")
    .replace(/^\s*Here is\s*/i, "")
    .trim();
}

function extractJsonString(textRaw) {
  const t = cleanModelText(textRaw);

  try {
    JSON.parse(t);
    return t;
  } catch {}

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

// ✅ Versión "suave": NO marca como malo un español corto.
// Solo bloquea: vacío, inglés típico, o basura.
function isBadReply(reply) {
  let r = String(reply || "");
  r = r.replace(/[\u200B-\u200D\uFEFF]/g, "").trim(); // invisibles

  if (!r) return true;

  // Inglés típico (solo palabra completa)
  if (/\bhere\b/i.test(r)) return true;
  if (/\b(sure|okay|yes)\b/i.test(r)) return true;

  // Basura / ruido: solo signos o tokens típicos
  const onlyLetters = r.replace(/[¿?¡!.,;:"'()\[\]{}\-]/g, "").trim();
  if (!onlyLetters) return true; // solo signos
  if (/^(asdf|qwer|xxxx|test)$/i.test(onlyLetters)) return true;

  return false;
}

function safeNormalizeParsed(parsed, fallbackText) {
  const reply =
    typeof parsed?.reply === "string" && parsed.reply.trim()
      ? parsed.reply.trim()
      : (cleanModelText(fallbackText) || "Perdón, ¿puedes repetirlo?");

  const ids = Array.isArray(parsed?.completed_objective_ids)
    ? parsed.completed_objective_ids.map((x) => String(x))
    : [];

  return { reply, completed_objective_ids: ids, _badReply: isBadReply(reply) };
}

// Detecta si el bot está pidiendo aclaración (para NO reinyectarlo al history)
function isClarificationReply(text) {
  const r = String(text || "").toLowerCase();
  return (
    r.includes("puedes repetir") ||
    r.includes("no te entiendo") ||
    r.includes("de otra forma")
  );
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

    // ✅ Normaliza SIEMPRE userMessage (invisibles, espacios, etc.)
    let normalizedUserMessage = String(userMessage)
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!normalizedUserMessage) {
      return res.status(200).json({ reply: "Perdón, ¿puedes repetirlo?", completed_objective_ids: [] });
    }

    // Respuesta final única (cortafuegos)
    function finalize(reply, ids = []) {
      let r = String(reply || "");
      r = r.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();

      if (isBadReply(r)) {
        r = "Perdón, ¿puedes repetirlo?";
        ids = [];
      }

      // Marca para verificar deploy (puedes quitarla luego)
      res.setHeader("x-chat-version", "recovery-v2");

      return res.status(200).json({ reply: r, completed_objective_ids: ids });
    }

    // 2) Historial corto y limpio (quita "(Demo)") + evita bucles de aclaración
    const shortHistory = (Array.isArray(history) ? history : [])
      .slice(-12)
      .map((m) => ({
        sender: m?.sender,
        text: String(m?.text ?? "").replace(/^\(Demo\)\s*/i, "")
      }))
      .filter((m) => {
        if (m.sender === "user") return true;

        if (m.sender === "bot" || m.sender === "model" || m.sender === "assistant") {
          // No reinyectamos aclaraciones del bot al contexto (evita bucles)
          if (isClarificationReply(m.text)) return false;
          // Tampoco reinyectamos respuestas “rotas”
          if (isBadReply(m.text)) return false;
          return true;
        }
        return false;
      })
      .slice(-6);

    const objectivesList = (Array.isArray(currentObjectives) ? currentObjectives : [])
      .map((o) => {
        const id = String(o?.id ?? "");
        const text = String(o?.text ?? "");
        const done = Boolean(o?.completed);
        return `- ID: "${id}": ${text} (Estado: ${done ? "Completado" : "Pendiente"})`;
      })
      .join("\n");

    const sentenceLimits = getSentenceLimits(level);
    const correctionMode = getCorrectionMode(level);

    // Prompt normal (completo)
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
- Si el alumno responde con 1–3 palabras (ej.: "y yo", "yo también", "sí"), interprétalo como respuesta elíptica y continúa. NO digas "¿puedes repetirlo?".

LÍMITE DE FRASES:
- Si HAY reformulación: máximo ${sentenceLimits.withReformulation} frase(s).
- Si NO hay reformulación: máximo ${sentenceLimits.withoutReformulation} frase(s).
- Si reformulas, procura que la reformulación sea 1 frase corta.
REGLA DURA: No superes esos límites bajo ninguna circunstancia.

CONTINUACIÓN (según nivel):
- A1/A2: termina con UNA pregunta muy simple.
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

ININTELIGIBLE (muy estricto):
- Solo considera ininteligible si el texto NO está en español (p.ej., inglés) o es puro ruido (p.ej., "asdf", "....").
- Una frase corta ("y yo", "yo también", "sí") NO es ininteligible.
- Si es ininteligible, di: "Perdón, no te entiendo. ¿Puedes decirlo de otra forma?"

FORMATO (OBLIGATORIO):
Devuelve SOLO un JSON válido con las claves:
- reply (string)
- completed_objective_ids (array de strings)

PROHIBIDO:
- Texto fuera del JSON
- Markdown o \`\`\`
`.trim();

    // Prompt de recuperación (corto y “desatascador”)
    // A1/A2: 2 frases máximo SIEMPRE en recovery.
    const recoveryPrompt = `
Eres un interlocutor nativo en un roleplay de español.

Escenario: "${scenario.title}"
Rol: "${scenario.botPersona.name}"
Nivel: ${level}

Reglas (RECOVERY):
- Responde SOLO en español.
- Máximo 2 frases cortas.
- Sé natural y continúa la conversación.
- Si el alumno escribe 1–3 palabras (ej. "y yo"), interprétalo como respuesta elíptica y continúa.
- Devuelve SOLO JSON con:
  {"reply":"...","completed_objective_ids":[]}
`.trim();

    const contents = [
      ...shortHistory.map((msg) => ({
        role: msg.sender === "user" ? "user" : "model",
        parts: [{ text: msg.text }]
      })),
      { role: "user", parts: [{ text: normalizedUserMessage }] }
    ];

    async function callGemini({ strict = false, overrideContents = null, overridePrompt = null } = {}) {
      const promptToUse = overridePrompt || baseSystemPrompt;

      const systemPrompt = strict
        ? `${promptToUse}\n\nULTIMA REGLA: devuelve SOLO JSON válido (objeto) y nada más.`
        : promptToUse;

      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

      let r;
      try {
        r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: overrideContents || contents,
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
              temperature: strict ? 0.05 : (level === "A1" ? 0.2 : level === "A2" ? 0.25 : 0.4),
              maxOutputTokens: strict
                ? (level === "A1" ? 90 : level === "A2" ? 110 : 160)
                : (level === "A1" ? 120 : level === "A2" ? 140 : level === "B1" ? 180 : 260),
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

    async function parseGeminiOutput(out) {
      if (!out?.ok) return null;

      const jsonStr = extractJsonString(out.textRaw);
      if (!jsonStr) return null;

      try {
        const parsed = JSON.parse(jsonStr);
        return safeNormalizeParsed(parsed, out.textRaw);
      } catch {
        return null;
      }
    }

    // =======================
    // Lógica principal con recovery
    // =======================

    // 1) Intento normal
    const out1 = await callGemini({ strict: false });
    if (!out1.ok) {
      return res.status(out1.status).json({ error: "Gemini API error", details: out1.data });
    }

    const norm1 = await parseGeminiOutput(out1);
    if (norm1 && !norm1._badReply) {
      return finalize(norm1.reply, norm1.completed_objective_ids);
    }

    // 2) Intento strict (mismo contexto)
    const out2 = await callGemini({ strict: true });
    if (out2.ok) {
      const norm2 = await parseGeminiOutput(out2);
      if (norm2 && !norm2._badReply) {
        return finalize(norm2.reply, norm2.completed_objective_ids);
      }
    }

    // 3) Recovery: strict + prompt corto + SIN historial (reset)
    const contentsReset = [{ role: "user", parts: [{ text: normalizedUserMessage }] }];
    const out3 = await callGemini({
      strict: true,
      overrideContents: contentsReset,
      overridePrompt: recoveryPrompt
    });

    if (out3.ok) {
      const norm3 = await parseGeminiOutput(out3);
      if (norm3 && !norm3._badReply) {
        return finalize(norm3.reply, norm3.completed_objective_ids);
      }
    }

    // 4) Fallback final seguro
    return finalize("Perdón, ¿puedes repetirlo?", []);
  } catch (err) {
    return res.status(500).json({ error: "Server error", details: String(err?.message || err) });
  }
}
