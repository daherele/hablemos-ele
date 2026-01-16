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

    const shortHistory = Array.isArray(history) ? history.slice(-6) : [];

    const objectivesList = (Array.isArray(currentObjectives) ? currentObjectives : [])
      .map((o) => {
        const id = String(o?.id ?? "");
        const text = String(o?.text ?? "");
        const done = Boolean(o?.completed);
        return `- ID: "${id}": ${text} (Estado: ${done ? "Completado" : "Pendiente"})`;
      })
      .join("\n");

    const systemPrompt = `
Actúa como un interlocutor nativo en un escenario de práctica de español.

CONTEXTO:
Escenario: "${scenario.title}"
Rol: "${scenario.botPersona.name}"
Nivel del estudiante: ${level}

OBJETIVOS DE LA TAREA:
${objectivesList}

INSTRUCCIONES (MUY IMPORTANTES):
- Responde SIEMPRE en español.
- Mantén el rol del escenario y actúa como una persona real (no como profesor).
- Usa frases cortas y naturales, adecuadas al nivel ${level}. Máximo 2 frases.
- NO expliques gramática.
- NO evalúes al estudiante.
- Interpreta con buena fe: si el mensaje del alumno es comprensible aunque tenga errores, responde normalmente.
- NO digas “¿puedes repetirlo?” ni “no entiendo” salvo que el mensaje sea realmente ininteligible.
- Si el alumno hace un cumplido, responde agradeciendo.
- Si no cumple un objetivo, responde de forma natural y guía suavemente hacia uno con una pregunta.
- Termina la mayoría de respuestas con una pregunta breve y funcional.

EJEMPLOS OBLIGATORIOS:
Alumno: "¡Qué casa tan bonita!"
Tú: "¡Gracias! ¿Quieres beber algo?"

Alumno: "Hola, ¿qué tal?"
Tú: "¡Hola! Muy bien. ¿Cómo estás?"

FORMATO DE RESPUESTA (JSON OBLIGATORIO):
Devuelve SOLO:
{
  "reply": "respuesta breve en español",
  "completed_objective_ids": ["obj_id_1"]
}

REGLA PARA completed_objective_ids:
- Incluye SOLO los IDs de objetivos que el alumno ACABA de cumplir con SU ÚLTIMO MENSAJE.
- Si ninguno, devuelve [].

IMPORTANTE: No incluyas texto fuera del JSON. No uses \`\`\` ni comentarios. Solo un objeto JSON válido.
`.trim();

    const contents = [
      ...shortHistory.map((msg) => ({
        role: msg?.sender === "user" ? "user" : "model",
        parts: [{ text: String(msg?.text ?? "") }]
      })),
      { role: "user", parts: [{ text: userMessage }] }
    ];

    const geminiResp = await fetch(
      // Modelo más estable para empezar
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.4,
            maxOutputTokens: 220
          }
        })
      }
    );

    const data = await geminiResp.json();

    if (!geminiResp.ok) {
      return res.status(geminiResp.status).json({
        error: "Gemini API error",
        details: data
      });
    }

    // Une todos los parts
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const textRaw = parts.map((p) => p?.text ?? "").join("").trim();

    const cleaned = String(textRaw)
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    const jsonCandidate =
      firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace
        ? cleaned.slice(firstBrace, lastBrace + 1)
        : cleaned;

    try {
      const parsed = JSON.parse(jsonCandidate);

      const reply = typeof parsed?.reply === "string" ? parsed.reply : "No pude generar respuesta.";
      const ids = Array.isArray(parsed?.completed_objective_ids)
        ? parsed.completed_objective_ids
        : [];

      return res.status(200).json({ reply, completed_objective_ids: ids });
    } catch (e) {
      return res.status(500).json({
        error: "Invalid JSON from model",
        debug_raw: cleaned.slice(0, 700)
      });
    }
  } catch (err) {
    return res.status(500).json({ error: "Server error", details: String(err?.message || err) });
  }
}
