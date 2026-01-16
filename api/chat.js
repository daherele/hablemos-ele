export default async function handler(req, res) {
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

    // Tu frontend usa status: pending | possible | confirmed
    const pendingObjectives = (currentObjectives || []).filter(
      (o) => o?.status !== "confirmed"
    );

    const objectivesContext = pendingObjectives
      .map((o) => `- ID: "${o.id}" DESC: "${o.text}"`)
      .join("\n");

    const systemPrompt = `
ROL: Actor nativo en rol de "${scenario.botPersona.name}" (Escenario: "${scenario.title}").
NIVEL ALUMNO: ${level}.

MISIÓN DEL ALUMNO (Objetivos pendientes):
${objectivesContext || "- (No hay objetivos pendientes)"}

REGLAS DE CONVERSACIÓN:
- Responde SIEMPRE en español.
- Mantén el rol del escenario.
- Frases cortas, naturales y adecuadas al nivel ${level}.
- NO expliques gramática ni evalúes al alumno.
- Si hay errores, reformula de manera natural dentro de tu respuesta.
- NO digas “¿puedes repetirlo?” salvo que el mensaje sea realmente ininteligible.
- Tu objetivo es ayudar al alumno a cumplir objetivos pendientes con andamiaje (preguntas útiles).

TAREA:
1) Lee el último mensaje del alumno.
2) Responde como tu personaje (máx 2 frases).
3) Detecta si el alumno ha avanzado en sus objetivos: busca INTENCIÓN comunicativa lograda (no perfección).
4) Si no estás seguro, usa confidence bajo.
5) Opcional: añade una pregunta de seguimiento breve que empuje hacia un objetivo pendiente.

FORMATO JSON ESTRICTO (SIN MARKDOWN, SOLO JSON):
{
  "reply": "respuesta en español",
  "objective_updates": [
    {
      "id": "id_del_objetivo",
      "status": "possible",
      "confidence": 0.0,
      "evidence": "fragmento del alumno",
      "reason": "motivo breve"
    }
  ],
  "follow_up_question": "pregunta corta opcional o string vacío"
}
`.trim();

    // Recorta historial para evitar ruido y coste
    const shortHistory = Array.isArray(history) ? history.slice(-8) : [];

       const contents = [
      ...shortHistory.map((msg) => ({
        role: msg.sender === "user" ? "user" : "model",
        parts: [{ text: String(msg.text ?? "") }]
      })),
      { role: "user", parts: [{ text: userMessage }] }
    ];


    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.6
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

    try {
      const parsed = JSON.parse(text);

      // Seguridad mínima: garantiza campos esperados
      return res.status(200).json({
        reply: parsed?.reply ?? "No pude generar respuesta.",
        objective_updates: Array.isArray(parsed?.objective_updates) ? parsed.objective_updates : [],
        follow_up_question: typeof parsed?.follow_up_question === "string" ? parsed.follow_up_question : ""
      });
    } catch {
      return res.status(200).json({
        reply: typeof text === "string" ? text : "No pude generar respuesta.",
        objective_updates: [],
        follow_up_question: ""
      });
    }
  } catch (err) {
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
}
