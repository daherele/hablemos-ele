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

    // Body robusto (en Vercel a veces llega como string)
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    body = body || {};

    const { text, level = "A1" } = body;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Missing text" });
    }

    const baseSystemInstruction = `
Eres un corrector de español para estudiantes de nivel ${level}.

OBJETIVO:
- Corrige la frase del alumno para que sea natural y adecuada al nivel ${level}.
- Da una explicación MUY breve (máx. 1 frase) en español.

FORMATO (OBLIGATORIO):
Devuelve SOLO un JSON válido con las claves:
- corrected (string)
- explanation (string)

PROHIBIDO:
- Texto fuera del JSON
- Markdown o \`\`\`
- Escribir “Here is...”
`.trim();

    const contents = [
      { role: "user", parts: [{ text: `Frase del alumno: ${text}` }] }
    ];

    function cleanModelText(textRaw) {
      return String(textRaw || "")
        .replace(/```json\s*/gi, "")
        .replace(/```/g, "")
        .replace(/^\s*Here is the JSON requested:\s*/i, "")
        .replace(/^\s*Here is the JSON:\s*/i, "")
        .replace(/^\s*Here is\s*/i, "")
        .trim();
    }

    // Extrae el primer bloque JSON (objeto o array) del texto, y valida que sea parseable
    function extractJsonString(textRaw) {
      const t = cleanModelText(textRaw);

      // 1) Si ya es JSON puro
      try {
        JSON.parse(t);
        return t;
      } catch {}

      // 2) Busca primer bloque {...} o [...]
      const match = t.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (!match) return null;

      const candidate = match[1].trim();
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        return null;
      }
    }

    function oneSentence(text) {
      const s = String(text || "").trim();
      if (!s) return "";
      // Corta a la primera frase si mete más de una
      const cut = s.match(/^(.+?[.!?])(\s|$)/);
      return (cut ? cut[1] : s).trim();
    }

    async function callGemini({ strict = false } = {}) {
      const systemInstruction = strict
        ? `${baseSystemInstruction}\n\nULTIMA REGLA: el primer carácter de tu respuesta debe ser { y el último }`
        : baseSystemInstruction;

      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

      let r;
      try {
        r = await fetch(url, {
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
        });
      } catch (e) {
        return {
          ok: false,
          status: 502,
          data: { error: "Fetch to Gemini failed", details: String(e?.message || e) }
        };
      }

      let data;
      try {
        data = await r.json();
      } catch (e) {
        return {
          ok: false,
          status: 502,
          data: { error: "Gemini returned non-JSON", details: String(e?.message || e) }
        };
      }

      if (!r.ok) return { ok: false, status: r.status, data };

      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      const textRaw = parts.map((p) => p?.text ?? "").join("").trim();

      return { ok: true, textRaw, data };
    }

    // 1) intento normal
    let out = await callGemini({ strict: false });
    if (!out.ok) {
      return res.status(out.status).json({ error: "Gemini API error", details: out.data });
    }

    let jsonStr = extractJsonString(out.textRaw);

    // 2) reintento estricto si no hay JSON válido
    if (!jsonStr) {
      const out2 = await callGemini({ strict: true });
      if (!out2.ok) {
        return res.status(out2.status).json({ error: "Gemini API error", details: out2.data });
      }

      jsonStr = extractJsonString(out2.textRaw);

      // Si AÚN no hay JSON: NO rompas la UI → devuelve 200 con fallback
      if (!jsonStr) {
        const fallback = cleanModelText(out2.textRaw);
        return res.status(200).json({
          corrected: text,
          explanation: oneSentence(fallback) || "No pude corregir ahora mismo."
        });
      }

      // Parse del segundo intento
      try {
        const parsed2 = JSON.parse(jsonStr);

        const corrected2 =
          typeof parsed2?.corrected === "string" && parsed2.corrected.trim()
            ? parsed2.corrected.trim()
            : text;

        const explanation2 =
          typeof parsed2?.explanation === "string"
            ? oneSentence(parsed2.explanation)
            : "Corrección aplicada.";

        return res.status(200).json({
          corrected: corrected2,
          explanation: explanation2 || "Corrección aplicada."
        });
      } catch {
        const fallback = cleanModelText(out2.textRaw);
        return res.status(200).json({
          corrected: text,
          explanation: oneSentence(fallback) || "No pude corregir ahora mismo."
        });
      }
    }

    // Parse del primer intento
    try {
      const parsed = JSON.parse(jsonStr);

      const corrected =
        typeof parsed?.corrected === "string" && parsed.corrected.trim()
          ? parsed.corrected.trim()
          : text;

      const explanation =
        typeof parsed?.explanation === "string"
          ? oneSentence(parsed.explanation)
          : "Corrección aplicada.";

      return res.status(200).json({
        corrected,
        explanation: explanation || "Corrección aplicada."
      });
    } catch {
      const fallback = cleanModelText(out.textRaw);
      return res.status(200).json({
        corrected: text,
        explanation: oneSentence(fallback) || "No pude corregir ahora mismo."
      });
    }
  } catch (err) {
    return res.status(500).json({ error: "Server error", details: String(err?.message || err) });
  }
}
