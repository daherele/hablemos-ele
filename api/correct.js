// /api/correct.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY in server env" });
    }

    const { text, level = "A1" } = req.body || {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Missing text" });
    }

    const baseSystemInstruction = `
Eres un corrector de español para estudiantes de nivel ${level}.

OBJETIVO:
- Corrige la frase del alumno para que sea natural y adecuada al nivel ${level}.
- Da una explicación MUY breve (máx. 1 frase) en español.

FORMATO:
Devuelve SOLO un JSON con las claves:
{
  "corrected": "frase corregida",
  "explanation": "explicación breve"
}

PROHIBIDO:
- Escribir “Here is the JSON…”
- Usar \`\`\` o bloques de código
`.trim();

    const contents = [
      { role: "user", parts: [{ text: `Frase del alumno: ${text}` }] }
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
      const systemInstruction = strict
        ? `${baseSystemInstruction}\n\nULTIMA REGLA: el primer carácter de tu respuesta debe ser { y el último }`
        : baseSystemInstruction;

      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents,
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: {
                type: "object",
                properties: {
                  corrected: { type: "string" },
                  explanation: { type: "string" }
                },
                required: ["corrected", "explanation"]
              },
              temperature: strict ? 0.1 : 0.2,
              maxOutputTokens: 180
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

      // Si AÚN no hay JSON: NO rompas la UI → devuelve 200 con fallback
      if (!jsonCandidate) {
        const fallback = cleanModelText(out2.textRaw);

        return res.status(200).json({
          // si no podemos corregir, al menos devolvemos el texto original
          corrected: text,
          explanation: fallback
            ? `No pude devolver JSON. Respuesta del modelo: ${fallback}`
            : "No pude corregir ahora mismo."
        });
      }
    }

    // Parse final: si falla, NO rompas la UI
    try {
      const parsed = JSON.parse(jsonCandidate);

      const corrected =
        typeof parsed?.corrected === "string" ? parsed.corrected.trim() : text;

      const explanation =
        typeof parsed?.explanation === "string"
          ? parsed.explanation.trim()
          : "Corrección aplicada.";

      return res.status(200).json({ corrected, explanation });
    } catch {
      const fallback = cleanModelText(out.textRaw);
      return res.status(200).json({
        corrected: text,
        explanation: fallback
          ? `No pude devolver JSON. Respuesta del modelo: ${fallback}`
          : "No pude corregir ahora mismo."
      });
    }
  } catch (err) {
    return res.status(500).json({ error: "Server error", details: String(err?.message || err) });
  }
}
