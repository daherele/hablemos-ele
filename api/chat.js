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

    const { history = [], scenario, level, userMessage, currentObjectives = [] } = req.body || {};

    if (!scenario?.title || !scenario?.botPersona?.name) {
      return res.status(400).json({ error: "Missing scenario data" });
    }
    if (!userMessage || typeof userMessage !== "string") {
      return res.status(400).json({ error: "Missing userMessage" });
    }

    // Construye el prompt en el servidor (no en el cliente)
    const objectivesList = currentObjectives
      .map(o => `- ID: "${o.id}": ${o.text} (Estado: ${o.completed ? "Completado" : "Pendiente"})`)
      .join("\n");

    const systemPrompt = `
Actúa como un interlocutor nativo en un escenario de práctica de español.

CONTEXTO:
Escenario: "${scenario.title}"
Rol: "${scenario.botPersona.name}"
Nivel del estudiante: ${level}

OBJETIVOS DE LA TAREA:
${objectivesList}

INSTRUCCIONES:
- Responde SIEMPRE en español.
- Usa frases cortas y claras, adecuadas al nivel.
- Mantén el rol del escenario.
- No expliques gramática.
- No evalúes al estudiante.
- Reformula de manera natural si hay errores.
- En cada respuesta, intenta ayudar al estudiante a avanzar hacia ALGUNO de los objetivos pendientes.
- Termina la mayoría de tus respuestas con una pregunta breve y natural.

FORMATO DE RESPUESTA (JSON OBLIGATORIO):
Devuelve SOLAMENTE un objeto JSON con:
{
  "reply": "Tu respuesta en español como personaje",
  "completed_objective_ids": ["id1", "id2"]
}
Devuelve SOLO los IDs que el estudiante acaba de cumplir con SU ÚLTIMO MENSAJE. Si ninguno, [].
`.trim();

    const contents = [
      { role: "user", parts: [{ text: systemPrompt }] },
      ...history.map(msg => ({
        role: msg.sender === "user" ? "user" : "model",
        parts: [{ text: msg.text }]
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
          generationConfig: { responseMimeType: "application/json" }
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
      return res.status(200).json(parsed);
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
