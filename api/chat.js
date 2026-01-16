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

    const scenarioTitle =
      typeof scenario?.title === "string" ? scenario.title.trim() : "";
    const scenarioRole =
      typeof scenario?.botPersona?.name === "string" ? scenario.botPersona.name.trim() : "";
    const normalizedUserMessage =
      typeof userMessage === "string" ? userMessage.trim() : "";

    if (!scenarioTitle || !scenarioRole) {
      return res.status(400).json({ error: "Missing scenario data" });
    }
    if (!normalizedUserMessage) {
      return res.status(400).json({ error: "Missing userMessage" });
    }

    // Historial corto y limpio (quita prefijo "(Demo)")
    const shortHistory = (Array.isArray(history) ? history : [])
      .slice(-6)
      .map((m) => ({
        sender: m?.sender,
        text: String(m?.text ?? "").replace(/^\(Demo\)\s*/i, "")
      }));

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
Escenario: "${scenarioTitle}"
Rol: "${scenarioRole}"
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

FORMATO (OBLIGATORIO):
Devuelve únicamente un objeto JSON válido con EXACTAMENTE estas claves:
{
  "reply": "respuesta breve en español",
  "completed_objective_ids": ["obj_id_1"]
}

REGLA PARA completed_objective_ids:
- Incluye SOLO los IDs de objetivos que el alumno ACABA de cumplir con SU ÚLTIMO MENSAJE.
- Si ninguno, devuelve [].

IMPORTANTE: No escribas texto fuera del JSON. No uses \`\`\`. No pongas frases tipo "Here is the JSON requested".
`.trim();

    const contents = [
      ...shortHistory.map((msg) => ({
        role: msg?.sender === "user" ? "user" : "model",
        parts: [{ text: msg.text }]
      })),
      { role: "user", parts: [{ text: normalizedUserMessage }] }
    ];

    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: {
            responseMimeType: "application/json",
            // CLAVE: JSON Schema (minúsculas) para forzar salida válida
            responseSchema: {
              type: "object",
              properties: {
                reply: { type: "string" },
                completed_objective_ids: {
                  type: "array",
                  items: { type: "string" }
                }
              },
              required: ["reply", "completed_objective_ids"],
              additionalProperties: false
            },
            temperature: 0.4,
            maxOutputTokens: 220
          }
        })
      }
    );

    const geminiText = await geminiResp.text();
    let data;
    try {
      data = JSON.parse(geminiText);
    } catch (parseError) {
      data = null;
    }

    if (!geminiResp.ok) {
      return res.status(geminiResp.status).json({
        error: "Gemini API error",
        details: data ?? geminiText.slice(0, 700)
      });
    }
    if (!data) {
      return res.status(500).json({
        error: "Invalid JSON from model",
        debug_raw: geminiText.slice(0, 700)
      });
    }

    // Une todos los parts por si vienen varios
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const textRaw = parts.map((p) => p?.text ?? "").join("").trim();

    // Limpia fences por si acaso
    const cleaned = String(textRaw)
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    // Extrae el objeto JSON si viniera con texto alrededor (backup)
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    const jsonCandidate =
      firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace
        ? cleaned.slice(firstBrace, lastBrace + 1)
        : cleaned;

    try {
      const parsed = JSON.parse(jsonCandidate);

      const reply =
        typeof parsed?.reply === "string" && parsed.reply.trim()
          ? parsed.reply.trim()
          : "No pude generar respuesta.";

      const ids = Array.isArray(parsed?.completed_objective_ids)
        ? [...new Set(parsed.completed_objective_ids.map(String))]
        : [];

      return res.status(200).json({
        reply,
        completed_objective_ids: ids
      });
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
