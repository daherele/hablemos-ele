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
- Máximo 2 frases, naturales para nivel ${level}.
- NO expliques gramática ni evalúes.
- Interpreta con buena fe.
- Termina normalmente con una pregunta breve.

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
        parts: [{ text: msg.text }]
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
    let out = await callGemini({ strict: false });
    if (!out.ok) {
      // Aquí sí devolvemos error, porque es error real del API, no “formato”
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
