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

    const {
      history = [],
      scenario,
      level = "A1",
      userMessage,
      currentObjectives = []
    } = req.body || {};

    if (!scenario?.title || !scenario?.botPersona?.name) {
      return res.status(400).json({ error: "Missing scenario data" });
    }
    if (!userMessage || typeof userMessage !== "string") {
      return res.status(400).json({ error: "Missing userMessage" });
    }

    // Historial corto y limpio (quita "(Demo)")
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

    // Importante: prompt SIN “ejemplos de JSON” largos, para no “invitar” al prefacio
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

FORMATO:
Devuelve SOLO un JSON con las claves: reply (string) y completed_objective_ids (array de strings).
No uses \`\`\` ni frases tipo "Here is...".
`.trim();

    const contents = [
      ...shortHistory.map((msg) => ({
        role: msg?.sender === "user" ? "user" : "model",
        parts: [{ text: msg.text }]
      })),
      { role: "user", parts: [{ text: userMessage }] }
    ];

    function cleanModelText(textRaw) {
      return String(textRaw || "")
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .replace(/^Here is the JSON requested:\s*/i, "")
        .replace(/^Here is the JSON:\s*/i, "")
        .replace(/^Here is\s*/i, "")
        .trim();
    }

    function tryExtractJson(textRaw) {
      const cleaned = cleanModelText(textRaw);
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        return cleaned.slice(firstBrace, lastBrace + 1);
      }
      return null;
    }

    async function callGemini({ strict = false } = {}) {
      const systemPrompt = strict
        ? `${baseSystemPrompt}\n\nULTIMA REGLA: el primer carácter de tu respuesta debe ser { y el último }`
        : baseSystemPrompt;

      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
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
        }
      );

      const data = await r.json();
      if (!r.ok) return { ok: false, status: r.status, data };

      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      const textRaw = parts.map((p) => p?.text ?? "").join("").trim();

      return { ok: true, textRaw };
    }

    // 1) intento normal
    let out = await callGemini({ strict: false });
    if (!out.ok) {
      return res.status(out.status).json({ error: "Gemini API error", details: out.data });
    }

    let jsonCandidate = tryExtractJson(out.textRaw);

    // 2) reintento estricto si no hay JSON
    if (!jsonCandidate) {
      const out2 = await callGemini({ strict: true });
      if (!out2.ok) {
        return res.status(out2.status).json({ error: "Gemini API error", details: out2.data });
      }
      jsonCandidate = tryExtractJson(out2.textRaw);

      // Si AÚN no hay JSON: NO rompas el chat → responde con texto rescatado
      if (!jsonCandidate) {
        const fallbackReply = cleanModelText(out2.textRaw);
        return res.status(200).json({
          reply: fallbackReply || "Perdón, ¿qué quieres hacer ahora?",
          completed_objective_ids: []
        });
      }
    }

    // Parse final: si falla, NO rompas el chat
    try {
      const parsed = JSON.parse(jsonCandidate);

      const reply =
        typeof parsed?.reply === "string" && parsed.reply.trim()
          ? parsed.reply.trim()
          : cleanModelText(out.textRaw) || "Perdón, ¿qué quieres hacer ahora?";

      const ids = Array.isArray(parsed?.completed_objective_ids)
        ? parsed.completed_objective_ids.map(String)
        : [];

      return res.status(200).json({ reply, completed_objective_ids: ids });
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
