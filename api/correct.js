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

    const systemInstruction = `
Eres un corrector de español para estudiantes de nivel ${level}.
Devuelve SOLO un JSON válido con:
{
  "corrected": "frase corregida (natural y nivel ${level})",
  "explanation": "explicación MUY breve (máximo 1 frase, en español)"
}
No añadas texto fuera del JSON.
`.trim();

    const contents = [
      { role: "user", parts: [{ text: `Frase del alumno: ${text}` }] }
    ];

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
            temperature: 0.2,
            maxOutputTokens: 180,
            responseSchema: {
              type: "object",
              properties: {
                corrected: { type: "string" },
                explanation: { type: "string" }
              },
              required: ["corrected", "explanation"]
            }
          }
        })
      }
    );

    const data = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({ error: "Gemini API error", details: data });
    }

    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const textRaw = parts.map((p) => p?.text ?? "").join("").trim();

    // parse defensivo (por si mete prefacio)
    const cleaned = String(textRaw).trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    const jsonCandidate =
      firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace
        ? cleaned.slice(firstBrace, lastBrace + 1)
        : cleaned;

    const parsed = JSON.parse(jsonCandidate);

    return res.status(200).json({
      corrected: String(parsed.corrected || ""),
      explanation: String(parsed.explanation || "")
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error", details: String(err?.message || err) });
  }
}
