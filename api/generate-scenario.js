// api/generate-scenario.js

function safeParseJSON(text) {
  const raw = String(text || "").trim();

  // Quitar fences ```json ... ```
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const s = (fenceMatch?.[1] ? fenceMatch[1] : raw).trim();

  // Intento directo
  try {
    return { ok: true, value: JSON.parse(s), cleaned: s };
  } catch {}

  // Intento: extraer primer objeto balanceando llaves
  let start = -1;
  let depth = 0;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{") {
      if (start === -1) start = i;
      depth++;
    } else if (ch === "}") {
      if (start !== -1) depth--;
      if (start !== -1 && depth === 0) {
        const candidate = s.slice(start, i + 1).trim();
        try {
          return { ok: true, value: JSON.parse(candidate), cleaned: candidate };
        } catch {
          start = -1;
          depth = 0;
        }
      }
    }
  }

  return { ok: false, cleaned: s };
}

async function callGemini({ apiKey, level, context, temperature }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const prompt = `
Devuelve SOLO JSON válido (sin texto extra, sin explicaciones, sin backticks).

Estructura exacta:
{
  "title": "",
  "description": "",
  "level": "${level}",
  "context": "${context}",
  "roles": { "user": "", "ai": "" },
  "objectives": [],
  "starter": ""
}

Reglas:
- Situación cotidiana y realista para ELE.
- Nivel ${level}.
- objectives: 4 a 6 strings (atómicos, una sola acción cada uno).
- starter: una primera frase del interlocutor (AI) para iniciar la conversación.
`.trim();

  Reglas adicionales para objectives (MUY IMPORTANTE):
- Cada objetivo debe ser atómico: UNA sola acción comunicativa.
- Prohibido usar "y", "e", "o", "/" para combinar acciones.
- Prohibido incluir dos verbos en el mismo objetivo.
- Formato recomendado: verbo + complemento (ej: "Saludar al interlocutor.", "Pedir un producto concreto.", "Preguntar el precio de un artículo.").
- Máximo 10 palabras por objetivo.
- Devuelve entre 4 y 6 objetivos.

  
  const payload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: 900,
      responseMimeType: "application/json" // ✅ esto sí (responseSchema NO)
    }
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await r.json().catch(() => null);

  if (!r.ok) {
    return {
      ok: false,
      error: data?.error?.message || `HTTP ${r.status}`,
      raw: data
    };
  }

  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  return { ok: true, text };
}

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

    // 1) Primer intento (normal)
    const first = await callGemini({ apiKey, level, context, temperature: 0.7 });
    if (!first.ok) {
      return res.status(500).json({ error: "No se pudo generar el escenario", details: first.error });
    }

    let parsed = safeParseJSON(first.text);

    // 2) Si falla por truncado o texto raro, reintenta con temperatura baja
    if (!parsed.ok) {
      const second = await callGemini({ apiKey, level, context, temperature: 0.2 });
      if (!second.ok) {
        return res.status(500).json({
          error: "Gemini no devolvió JSON válido",
          details: parsed.cleaned.slice(0, 2000)
        });
      }
      parsed = safeParseJSON(second.text);
    }

    // 3) Si sigue fallando, devolvemos details largo para depurar
    if (!parsed.ok) {
      return res.status(500).json({
        error: "Gemini no devolvió JSON válido",
        details: parsed.cleaned.slice(0, 2000)
      });
    }

    const scenario = parsed.value || {};

    // Normalización mínima (para que el frontend no rompa)
    scenario.title = String(scenario.title || "").trim() || `Situación: ${context}`;
    scenario.description = String(scenario.description || "").trim() || "Escenario generado con IA.";
    scenario.level = scenario.level || level;
    scenario.context = scenario.context || context;

    scenario.roles =
      scenario.roles && typeof scenario.roles === "object"
        ? scenario.roles
        : { user: "Alumno/a", ai: "Interlocutor" };

    scenario.roles.user = scenario.roles.user || "Alumno/a";
    scenario.roles.ai = scenario.roles.ai || "Interlocutor";

    scenario.objectives = Array.isArray(scenario.objectives) ? scenario.objectives : [];
    scenario.objectives = scenario.objectives
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .slice(0, 8);

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
