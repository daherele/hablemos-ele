// api/generate-scenario.js

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: "Falta GEMINI_API_KEY en Vercel",
        details: "Settings → Environment Variables (Production y Preview) y redeploy."
      });
    }

    const { level = "A1", context = "general" } = req.body || {};

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    // Prompt simple: el control real lo da responseMimeType + schema
    const prompt = `
Genera UN escenario de práctica comunicativa para estudiantes de español nivel ${level}.
Contexto: ${context}.
Devuelve los campos del esquema JSON.
`.trim();

    const payload = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 900, // suficiente para objetivos+starter
        responseMimeType: "application/json"
      },
      // Schema (muy recomendado): obliga a que venga completo y bien formado
      responseSchema: {
        type: "object",
        required: ["title", "description", "level", "context", "roles", "objectives", "starter"],
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          level: { type: "string" },
          context: { type: "string" },
          roles: {
            type: "object",
            required: ["user", "ai"],
            properties: {
              user: { type: "string" },
              ai: { type: "string" }
            }
          },
          objectives: {
            type: "array",
            items: { type: "string" },
            minItems: 3,
            maxItems: 8
          },
          starter: { type: "string" }
        }
      }
    };

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await r.json().catch(() => null);

    if (!r.ok) {
      return res.status(500).json({
        error: "No se pudo generar el escenario",
        details: data?.error?.message || `HTTP ${r.status}`
      });
    }

    // Con responseMimeType=application/json, normalmente viene en candidates[0].content.parts[0].text como JSON válido.
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";

    let scenario;
    try {
      scenario = JSON.parse(text);
    } catch (e) {
      return res.status(500).json({
        error: "Gemini devolvió JSON no parseable",
        details: text.slice(0, 2000)
      });
    }

    // Normalización mínima por si acaso
    scenario.level = scenario.level || level;
    scenario.context = scenario.context || context;

    if (!scenario.roles || typeof scenario.roles !== "object") {
      scenario.roles = { user: "Alumno/a", ai: "Interlocutor" };
    } else {
      scenario.roles.user = scenario.roles.user || "Alumno/a";
      scenario.roles.ai = scenario.roles.ai || "Interlocutor";
    }

    if (!Array.isArray(scenario.objectives)) scenario.objectives = [];
    scenario.objectives = scenario.objectives
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .slice(0, 8);

    scenario.title = String(scenario.title || "").trim() || `Situación: ${context}`;
    scenario.description = String(scenario.description || "").trim() || "Escenario generado con IA.";
    scenario.starter = String(scenario.starter || "").trim() || "¡Hola! ¿En qué puedo ayudarte?";

    return res.status(200).json(scenario);
  } catch (err) {
    console.error("generate-scenario error:", err);
    return res.status(500).json({
      error: "No se pudo generar el escenario",
      details: err?.message || String(err)
    });
  }
}
