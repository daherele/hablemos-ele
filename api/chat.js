// /api/chat.js
export default async function handler(req, res) {
  // Solo POST
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

    // Historial corto y seguro
    const shortHistory = Array.isArray(history) ? history.slice(-6) : [];

    // Objetivos en texto (servidor)
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
`.trim();

    const contents = [
      { role: "user", parts: [{ text: systemPrompt }] },
      ...shortHistory.map((msg) => ({
        role: msg?.sender === "user" ? "user" : "model",
        parts: [{ text: String(msg?.text ?? "") }]
      })),
      { role: "user", parts: [{ text: userMessage }] }
    ];

    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: {
            responseMimeType: "application/json",
            // Opcional (pero ayuda a que no se vaya por las ramas)
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

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    // Intentamos parsear JSON; si falla, devolvemos texto “seguro”
    try {
      const parsed = JSON.parse(text);

      // Normaliza salida por si viene rara
      const reply = typeof parsed?.reply === "string" ? parsed.reply : "No pude generar respuesta.";
      const ids = Array.isArray(parsed?.completed_objective_ids) ? parsed.completed_objective_ids : [];

      return res.status(200).json({
        reply,
        completed_objective_ids: ids
      });
    } catch {
      return res.status(200).json({
        reply: typeof text === "string" ? text : "No pude generar respuesta.",
        completed_objective_ids: []
      });
    }
  } catch (err) {
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
}

