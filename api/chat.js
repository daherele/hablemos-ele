// /api/chat.js
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
      completed_objective_ids = [] 
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

    // 3) Objetivos a texto (para prompt)
    const objectivesList = (Array.isArray(currentObjectives) ? currentObjectives : [])
      .map((o) => {
        const id = String(o?.id ?? "");
        const text = String(o?.text ?? "");
        const done = Boolean(o?.completed);
        return `- ID: "${id}": ${text} (Estado: ${done ? "Completado" : "Pendiente"})`;
      })
      .join("\n");

    // 4) Prompt base (Opción A: regla crítica)
    const baseSystemPrompt = `
Actúa como un interlocutor nativo en un escenario de práctica de español.

CONTEXTO:
Escenario: "${scenario.title}"
Rol: "${scenario.botPersona.name}"
Nivel del estudiante: ${level}

OBJETIVOS:
${objectivesList}

REGLAS:
- Responde SIEMPRE en español.
- Mantén el rol del escenario (persona real, no profesor).
- Máximo 3 frases cortas.
- NO expliques gramática ni evalúes.
- Interpreta con buena fe.
- Termina normalmente con una pregunta breve.

REGLA CRÍTICA (muy importante):
- Si el mensaje del alumno es comprensible pero NO avanza claramente ningún objetivo pendiente (es ambiguo, demasiado corto o no aporta información nueva),
  NO digas "¿qué quieres hacer ahora?" ni rompas la ficción.
  En su lugar, haz una pregunta NATURAL del escenario para conseguir el dato que falta o ofrece 2-3 opciones concretas dentro del contexto.

REFORMULACIÓN:
- Si el mensaje del alumno tiene errores pero se entiende, empieza tu respuesta con una reformulación breve:
  "Ah, quieres decir: '<frase corregida>'." y después responde normalmente.
- Si el mensaje ya está bien, NO reformules.
- Si el mensaje es realmente ininteligible, NO reformules y di:
  "Perdón, no te entiendo. ¿Puedes decirlo de otra forma?"
- Nunca inventes contenido: la reformulación debe mantener el significado.

FORMATO (OBLIGATORIO):
Devuelve SOLO un JSON válido con las claves:
- reply (string)
- completed_objective_ids (array de strings)

PROHIBIDO:
- Texto fuera del JSON
- Markdown o \`\`\`
- Frases tipo "Here is..."
`.trim();

    const contents = [
      ...shortHistory.map((msg) => ({
        role: msg?.sender === "user" ? "user" : "model",
        parts: [{ text: String(msg.text ?? "") }]
      })),
      { role: "user", parts: [{ text: userMessage }] }
    ];

    // -------- Helpers --------

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

    function getPendingObjectiveTexts(limit = 2) {
      const arr = Array.isArray(currentObjectives) ? currentObjectives : [];
      return arr
        .filter((o) => o && !o.completed)
        .map((o) => String(o?.text ?? "").trim())
        .filter(Boolean)
        .slice(0, limit);
    }

    async function miniImmersiveFallback() {
      const role = String(scenario?.botPersona?.name || "interlocutor").trim();
      const scene = String(scenario?.title || "escenario").trim();
      const pending = getPendingObjectiveTexts(2);

      const pendingBlock = pending.length
        ? `Objetivo pendiente prioritario:\n- ${pending.join("\n- ")}`
        : `Objetivo pendiente prioritario: (no especificado; igualmente guía para avanzar la conversación)`;

      const prompt = `
Eres ${role} en: "${scene}". Nivel del estudiante: ${level}.
El estudiante ha dicho: "${String(userMessage || "").trim()}".

${pendingBlock}

TAREA:
Escribe SOLO 1 intervención natural (máx. 2 frases cortas) que:
- mantenga la ficción (no menciones objetivos, misión, sistema, JSON)
- sea específica del contexto
- haga UNA pregunta concreta para avanzar
- si el mensaje del estudiante es ambiguo, pide el dato que falta de forma natural.

Devuelve SOLO el texto, sin comillas, sin JSON, sin markdown.
`.trim();

      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

      let r;
      try {
        r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 90
            }
          })
        });
      } catch {
        return null;
      }

      let data;
      try {
        data = await r.json();
      } catch {
        return null;
      }

      if (!r.ok) return null;

      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      const textRaw = parts.map((p) => p?.text ?? "").join("").trim();

      const cleaned = String(textRaw || "")
        .replace(/```[\s\S]*?```/g, "")
        .replace(/^["']|["']$/g, "")
        .trim();

      // Evita que te devuelva algo tipo "Aquí tienes..."
      if (!cleaned) return null;
      if (cleaned.toLowerCase().includes("json")) return null;

      return cleaned;
    }

    function safeNormalizeParsed(parsed, fallbackText) {
      const reply =
        typeof parsed?.reply === "string" && parsed.reply.trim()
          ? parsed.reply.trim()
          : cleanModelText(fallbackText);

      const ids = Array.isArray(parsed?.completed_objective_ids)
        ? parsed.completed_objective_ids.map((x) => String(x))
        : [];

      return {
        reply: reply || "", // si queda vacío lo resolvemos después
        completed_objective_ids: ids
      };
    }

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
              temperature: strict ? 0.1 : 0.4,
              maxOutputTokens: 260
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

      if (!jsonStr) {
        const immersive = await miniImmersiveFallback();
        const fallbackReply = cleanModelText(out2.textRaw);

        return res.status(200).json({
          reply: immersive || fallbackReply || "Perdón 🙂 ¿Puedes concretarlo un poco más?",
          completed_objective_ids: []
        });
      }

      try {
        const parsed2 = JSON.parse(jsonStr);
        const norm2 = safeNormalizeParsed(parsed2, out2.textRaw);

        if (!norm2.reply || norm2.reply.length < 3) {
          const immersive = await miniImmersiveFallback();
          norm2.reply = immersive || "Perdón 🙂 ¿Puedes concretarlo un poco más?";
        }

        return res.status(200).json(norm2);
      } catch {
        const immersive = await miniImmersiveFallback();
        const fallbackReply = cleanModelText(out2.textRaw);

        return res.status(200).json({
          reply: immersive || fallbackReply || "Perdón 🙂 ¿Puedes concretarlo un poco más?",
          completed_objective_ids: []
        });
      }
    }

    // Parse del primer intento
    try {
      const parsed = JSON.parse(jsonStr);
      const norm = safeNormalizeParsed(parsed, out.textRaw);

      if (!norm.reply || norm.reply.length < 3) {
        const immersive = await miniImmersiveFallback();
        norm.reply = immersive || "Perdón 🙂 ¿Puedes concretarlo un poco más?";
      }

      return res.status(200).json(norm);
    } catch {
      const immersive = await miniImmersiveFallback();
      const fallbackReply = cleanModelText(out.textRaw);

      return res.status(200).json({
        reply: immersive || fallbackReply || "Perdón 🙂 ¿Puedes concretarlo un poco más?",
        completed_objective_ids: []
      });
    }
  } catch (err) {
    return res.status(500).json({ error: "Server error", details: String(err?.message || err) });
  }
}
