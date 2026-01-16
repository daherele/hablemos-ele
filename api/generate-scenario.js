// api/generate-scenario.js

function extractJSON(text) {
  const raw = String(text || "").trim();

  // Caso 1: viene en ```json ... ```
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();

  // Caso 2: hay texto alrededor, cogemos el primer bloque {...}
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1).trim();
  }

  // Caso 3: fallback
  return raw;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: "Falta GEMINI_API_KEY en variables de entorno (Vercel)",
        details: "Añádela en Settings → Environment Variables (Production y Preview) y redeploy."
      });
    }

    const { level = "B1", context = "general" } = req.body || {};

    // ✅ Igual que en chat.js: fetch directo + modelo 2.5
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const prompt = `
Eres un diseñador de actividades de ELE.

Genera UN escenario de práctica comunicativa para estudiantes de español nivel ${level}.
Contexto sugerido: ${context}

Devuelve EXCLUSIVAMENTE un objeto JSON con esta estructura exacta:

{
  "title": "",
  "description": "",
  "level": "${level}",
  "context": "${context}",
  "roles": {
    "user": "",
    "ai": ""
  },
  "objectives": [],
  "starter": ""
}

Condiciones:
- Situación cotidiana, realista.
- Adecuada al nivel ${level}.
- "objectives" debe ser un array de strings.
- No incluyas texto fuera del JSON.
- No uses bloques de código ni backticks. No escribas \`\`\`json.
`.trim();

    const payload = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 700
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

    // Extraer texto del modelo
    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";

    // ✅ Limpieza (quita ```json ... ```)
    const cleaned = extractJSON(text);

    // ✅ Parse robusto
    let scenario;
    try {
      scenario = JSON.parse(cleaned);
    } catch (e) {
      return res.status(500).json({
        error: "Gemini no devolvió JSON válido",
        details: cleaned.slice(0, 500)
      });
    }

    // Validación mínima para que no rompa el frontend
    scenario.title = String(scenario.title || "").trim() || `Situación: ${context}`;
    scenario.description = String(scenario.description || "").trim() || "Escenario generado con IA.";
    scenario.level = scenario.level || level;
    scenario.context = scenario.context || context;

    scenario.roles = scenario.roles && typeof scenario.roles === "object" ? scenario.roles : { user: "Alumno/a", ai: "Interlocutor" };
    scenario.roles.user = scenario.roles.user || "Alumno/a";
    scenario.roles.ai = scenario.roles.ai || "Interlocutor";

    scenario.objectives = Array.isArray(scenario.objectives) ? scenario.objectives : [];
    scenario.objectives = scenario.objectives
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .slice(0, 8);

    scenario.starter =
      String(scenario.starter || "").trim() ||
      "¡Perfecto! Empecemos. ¿Qué quieres decir primero?";

    return res.status(200).json(scenario);
  } catch (err) {
    console.error("generate-scenario error:", err);
    return res.status(500).json({
      error: "No se pudo generar el escenario",
      details: err?.message || String(err)
    });
  }
}
