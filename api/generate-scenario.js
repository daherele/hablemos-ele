import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { level = "B1", context = "general" } = req.body || {};

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash"
    });

    // 🔴 AQUÍ VA EL PROMPT (ESTO ES LO QUE PREGUNTABAS)
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
- Lenguaje natural y realista
- Situación cotidiana
- Adecuada a nivel ${level}
- No incluyas explicaciones
- No incluyas texto fuera del JSON
`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const scenario = JSON.parse(text);

    res.status(200).json(scenario);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo generar el escenario" });
  }
}
