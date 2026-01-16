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
      level,
      userMessage,
      currentObjectives = []
    } = req.body || {};

    if (!scenario?.title || !scenario?.botPersona?.name) {
      return res.status(400).json({ error: "Missing scenario data" });
    }
    if (!userMessage || typeof userMessage !== "string") {
      return res.status(400).json({ error: "Missing userMessage" });
    }

    // Recortamos historial para coste/latencia
    const safeHistory = Array.isArray(history) ? history.slice(-6) : [];

    // Solo objetivos no confirmados
    const pendingObjectives = Array.isArray(currentObjectives)
      ? currentObjectives.filter(o => o && o.id && o.text && o.status !== "confirmed")
      : [];

    // Contexto objetivos (compacto)
    const objectivesContext = pendingObjectives
      .map(o => `- ID: "${o.id}" DESC: "${String(o.text).slice(0, 140)}"`)
      .join("\n");

    const systemPrompt = `
ROL: Actor nativo en rol de "${scenario.botPersona.name}" (Escenario: "${scenario.title}").
NIVEL ALUMNO: ${level}.

MISIÓN DEL ALUMNO (Objetivos pendientes):
${objectivesContext || "- (No hay objetivos pendientes)"}

TAREA:
1. Lee el último mensaje del alumno.
2. Responde como tu personaje (natural, breve, nivel ${level}). Máximo 2 frases.
3. Detecta si el alumno ha avanzado en sus objetivos. NO evalúes perfección: busca INTENCIÓN comunicativa lograda.
4. Si dudas, confidence bajo.
5. Devuelve sugerencias SOLO para objetivos pendientes (no confirmados).

FORMATO JSON ESTRICTO (NO MARKDOWN, SOLO JSON):
{
  "reply": "Tu respuesta en español (máx 2 frases)",
  "objective_updates": [
    {
      "id": "id_del_objetivo",
      "status": "possible",
      "confidence": 0.0,
      "evidence": "fragmento breve del texto del alumno",
      "reason": "motivo muy breve en español"
    }
  ],
  "follow_up_question": "pregunta corta opcional o string vacío"
}

REGLAS IMPORTANTES:
- "objective_updates" debe contener SOLO objetivos que el alumno PUEDE haber logrado con su ÚLTIMO mensaje.
- Si no hay ninguno, devuelve [].
- No inventes IDs: usa SOLO IDs listados arriba.
`.trim();

    const contents = [
      { role: "user", parts: [{ text: systemPrompt }] },
      ...safeHistory.map(msg => ({
        role: msg?.sender === "user" ? "user" : "model",
        parts: [{ text: String(msg?.text ?? "").slice(0, 800) }]
      })),
      { role: "user", parts: [{ text: userMessage.slice(0, 1200) }] }
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
            // opcional: un poco de control de longitud
            maxOutputTokens: 300
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

    // Parseo seguro + normalización del shape
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }

    if (!parsed || typeof parsed !== "object") {
      return res.status(200).json({
        reply: typeof text === "string" ? text : "No pude generar respuesta.",
        objective_updates: [],
        follow_up_question: ""
      });
    }

    // Normalizamos salida para que el frontend no se rompa
    const reply = typeof parsed.reply === "string" ? parsed.reply : "No pude generar respuesta.";
    const follow_up_question = typeof parsed.follow_up_question === "string" ? parsed.follow_up_question : "";

    // Filtrado: objective_updates solo con ids válidos (pendientes) + shape correcto
    const allowedIds = new Set(pendingObjectives.map(o => o.id));
    const objective_updates = Array.isArray(parsed.objective_updates)
      ? parsed.objective_updates
          .filter(u => u && typeof u.id === "string" && allowedIds.has(u.id))
          .map(u => ({
            id: u.id,
            status: "possible",
            confidence: typeof u.confidence === "number" ? Math.max(0, Math.min(1, u.confidence)) : 0.5,
            evidence: typeof u.evidence === "string" ? u.evidence.slice(0, 220) : "",
            reason: typeof u.reason === "string" ? u.reason.slice(0, 140) : ""
          }))
      : [];

    return res.status(200).json({
      reply,
      objective_updates,
      follow_up_question
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
}
