// /api/chat.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY in server env" });
    }

    // 1) Body robusto (en Vercel a veces llega como string)
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    body = body || {};

    const {
      history = [],
      scenario,
      level = "A1",
      userMessage,
      currentObjectives = [],
      // opcional: si el frontend alguna vez te lo manda, lo conservamos en fallbacks
      completed_objective_ids: incomingCompletedIds = []
    } = body;

    if (!scenario?.title || !scenario?.botPersona?.name) {
      return res.status(400).json({ error: "Missing scenario data" });
    }
    if (!userMessage || typeof userMessage !== "string") {
      return res.status(400).json({ error: "Missing userMessage" });
    }

    // 2) Historial corto y limpio (quita "(Demo)")
    const shortHistory = (Array.isArray(history) ? history : [])
      .slice(-6)
      .map((m) => ({
        sender: m?.sender,
        text: String(m?.text ?? "").replace(/^\(Demo\)\s*/i, "")
      }));

    // 3) Normaliza objetivos (evita objetivos rotos que luego “bloquean”)
    const normalizedObjectives = (Array.isArray(currentObjectives) ? currentObjectives : [])
      .map((o, idx) => ({
        id: String(o?.id ?? `obj_${idx}`),
        text: String(o?.text ?? "").trim(),
        completed: Boolean(o?.completed)
      }))
      .filter((o) => o.id && o.text);

    const allowedObjectiveIds = new Set(normalizedObjectives.map((o) => o.id));

    const objectivesList = normalizedObjectives
      .map((o) => `- ID: "${o.id}": ${o.text} (Estado: ${o.completed ? "Completado" : "Pendiente"})`)
      .join("\n");

    function getPendingObjectives(limit = 2) {
      return normalizedObjectives.filter((o) => !o.completed).slice(0, limit);
    }

    const pendingObjectives = normalizedObjectives.filter((o) => !o.completed);

    // 4) Prompt base (Opción A + anti-respuestas vacías)
    const baseSystemPrompt = `
Actúa como un interlocutor nativo en un escenario de práctica de español.

CONTEXTO:
Escenario: "${scenario.title}"
Rol: "${scenario.botPersona.name}"
Nivel del estudiante: ${level}

OBJETIVOS:
${objectivesList || "(Sin objetivos especificados)"}

REGLAS:
- Responde SIEMPRE en español.
- Mantén el rol del escenario (persona real, no profesor).
- Máximo 3 frases cortas.
- NO expliques gramática ni evalúes.
- Interpreta con buena fe.
- Si hay objetivos pendientes, intenta avanzar uno.
- Termina normalmente con una pregunta breve (si hay objetivos pendientes).

REGLA CRÍTICA (muy importante):
- Si el mensaje del alumno es comprensible pero NO avanza claramente ningún objetivo pendiente (es ambiguo, demasiado corto o no aporta información nueva),
  NO digas "¿qué quieres hacer ahora?" ni rompas la ficción.
  En su lugar, haz una pregunta NATURAL del escenario para conseguir el dato que falta o ofrece 2-3 opciones concretas dentro del contexto.

OBJETIVOS (norma de IDs):
- En completed_objective_ids SOLO puedes incluir IDs existentes de la lista OBJETIVOS.
- Si dudas, no marques ninguno.

REFORMULACIÓN:
- Si el mensaje del alumno tiene errores pero se entiende, empieza tu respuesta con una reformulación breve:
  "Ah, quieres decir: '<frase corregida>'." y después responde normalmente.
- Si el mensaje ya está bien, NO reformules.
- Si el mensaje es realmente ininteligible, NO reformules y di:
  "Perdón, no te entiendo. ¿Puedes decirlo de otra forma?"
- Nunca inventes contenido: la reformulación debe mantener el significado.

FORMATO (OBLIGATORIO):
Devuelve SOLO un JSON válido con las claves:
- reply (string)
- completed_objective_ids (array de strings)

PROHIBIDO:
- Texto fuera del JSON
- Markdown o \`\`\`
- Frases tipo "Here is..."
`.trim();

    const contents = [
      ...shortHistory.map((msg) => ({
        role: msg?.sender === "user" ? "user" : "model",
        parts: [{ text: String(msg.text ?? "") }]
      })),
      { role: "user", parts: [{ text: userMessage }] }
    ];

    // -------- Helpers --------

    function cleanModelText(textRaw) {
      return String(textRaw || "")
        .replace(/```json\s*/gi, "")
        .replace(/```/g, "")
        .replace(/^\s*Here is the JSON requested:\s*/i, "")
        .replace(/^\s*Here is the JSON:\s*/i, "")
        .replace(/^\s*Here is\s*/i, "")
        .trim();
    }

    function extractJsonString(textRaw) {
      const t = cleanModelText(textRaw);

      // 1) Si ya es JSON puro
      try {
        JSON.parse(t);
        return t;
      } catch {}

      // 2) Busca primer {...} o [...]
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

    function hasImplicitReference(text) {
      const t = String(text || "").toLowerCase();
      return (
        t.includes("lo de siempre") ||
        t.includes("lo mismo") ||
        t.includes("como siempre") ||
        t.includes("lo habitual")
      );
    }

    function isWeakReply(reply) {
      const raw = String(reply || "").trim();
      const t = raw.toLowerCase().replace(/[.,!?¿¡]/g, "").trim();

      // Respuestas típicamente inútiles
      const weakSingles = new Set([
        "claro",
        "vale",
        "ah",
        "ajá",
        "aja",
        "sí",
        "si",
        "ok",
        "hola",
        "buenos días",
        "buenos dias",
        "buenas"
      ]);

      if (raw.length < 10) return true;
      if (weakSingles.has(t)) return true;
      if (raw.endsWith(",")) return true;

      return false;
    }

    function isIrrelevantReply(reply, userMsg) {
      const r = String(reply || "").toLowerCase().trim().replace(/[.,!?¿¡]/g, "");
      const u = String(userMsg || "").toLowerCase().trim();

      // Saludos fuera de lugar (usuario no está saludando)
      if (["hola", "buenos días", "buenos dias", "buenas"].includes(r)) {
        if (!/hola|buenos días|buenos dias|buenas/.test(u)) return true;
      }

      return false;
    }

    // --- detección genérica de elipsis A1 + aclaraciones inútiles ---
    function isA1EllipticUserUtterance(userMsg, level) {
      const lvl = String(level || "").toUpperCase();
      if (lvl !== "A1") return false;

      const s = String(userMsg || "").trim();
      if (!s) return false;

      const words = s.split(/\s+/).filter(Boolean);
      if (words.length < 1 || words.length > 5) return false;

      // Si contiene verbos comunes, NO lo consideramos elipsis nominal típica
      const hasCommonVerb =
        /\b(quiero|quisiera|busco|necesito|tengo|hay|es|son|estoy|está|están|puedo|puede)\b/i.test(s);
      if (hasCommonVerb) return false;

      // Solo letras/espacios y conectores normales (evita basura)
      const mostlyWords = /^[\p{L}\p{M}\s'-]+$/u.test(s);
      if (!mostlyWords) return false;

      return true;
    }

    function isBadClarificationQuestion(reply) {
      const r = String(reply || "").trim().toLowerCase();

      // "¿De qué?" / "¿De qué" truncado
      if (/^¿?\s*de\s+qué\b/.test(r)) return true;

      // Preguntas genéricas inútiles
      if (r === "¿qué?" || r === "que?" || r === "¿qué") return true;
      if (r === "¿cuál?" || r === "cual?" || r === "¿cuál") return true;

      return false;
    }

    function safeNormalizeParsed(parsed, fallbackText) {
      const reply =
        typeof parsed?.reply === "string" && parsed.reply.trim()
          ? parsed.reply.trim()
          : cleanModelText(fallbackText);

      // SOLO IDs válidos
      const ids = Array.isArray(parsed?.completed_objective_ids)
        ? parsed.completed_objective_ids
            .map((x) => String(x))
            .filter((id) => (allowedObjectiveIds.size ? allowedObjectiveIds.has(id) : Boolean(id)))
        : [];

      return { reply: reply || "", completed_objective_ids: ids };
    }

    async function callGemini({ strict = false } = {}) {
      const systemPrompt = strict
        ? `${baseSystemPrompt}\n\nULTIMA REGLA: el primer carácter de tu respuesta debe ser { y el último }`
        : baseSystemPrompt;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

      let r;
      try {
        r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: {
                type: "object",
                properties: {
                  reply: { type: "string" },
                  completed_objective_ids: {
                    type: "array",
                    items: { type: "string" }
                  }
                },
                required: ["reply", "completed_objective_ids"]
              },
              temperature: strict ? 0.1 : 0.4,
              maxOutputTokens: 260
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

    async function miniImmersiveFallback() {
      const role = String(scenario?.botPersona?.name || "interlocutor").trim();
      const scene = String(scenario?.title || "escenario").trim();
      const pending = getPendingObjectives(2);

      const pendingBlock = pending.length
        ? `Objetivo pendiente prioritario:\n- ${pending.map((o) => o.text).join("\n- ")}`
        : `Objetivo pendiente prioritario: (no especificado; igualmente guía para avanzar la conversación)`;

      const prompt = `
Eres ${role} en: "${scene}". Nivel del estudiante: ${level}.
El estudiante ha dicho: "${String(userMessage || "").trim()}".

${pendingBlock}

TAREA:
Escribe SOLO 1 intervención natural (máx. 2 frases cortas) que:
- mantenga la ficción (no menciones objetivos, misión, sistema, JSON)
- sea específica del contexto
- haga UNA pregunta concreta para avanzar
- si el mensaje del estudiante es ambiguo, pide el dato que falta de forma natural.

Devuelve SOLO el texto, sin comillas, sin JSON, sin markdown.
`.trim();

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

      let r;
      try {
        r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 90
            }
          })
        });
      } catch {
        return null;
      }

      let data;
      try {
        data = await r.json();
      } catch {
        return null;
      }

      if (!r.ok) return null;

      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      const textRaw = parts.map((p) => p?.text ?? "").join("").trim();

      const cleaned = String(textRaw || "")
        .replace(/```[\s\S]*?```/g, "")
        .replace(/^["']|["']$/g, "")
        .trim();

      if (!cleaned) return null;
      if (cleaned.toLowerCase().includes("json")) return null;

      return cleaned;
    }

    async function applyQualityHeuristics(norm) {
      // No aumentamos llamadas: solo pedimos mini-call si detectamos “respuesta mala”
      let needsFallback = false;

      // --- Early-exit por nivel (reduce mini-calls en A1/A2) ---
      const lvl = String(level || "").toUpperCase();
      const isLowLevel = lvl === "A1" || lvl === "A2";

      if (isLowLevel) {
        const replyRaw = String(norm.reply || "").trim();
        const replyCore = replyRaw.toLowerCase().replace(/[.,!?¿¡]/g, "").trim();

        const clearlyBad =
          !replyRaw ||
          replyRaw.length < 4 ||
          replyRaw.endsWith(",") ||
          isIrrelevantReply(replyRaw, userMessage) ||
          ["hola", "claro", "vale", "ah", "ajá", "aja", "sí", "si", "ok"].includes(replyCore);

        if (!clearlyBad) {
          return norm; // ✅ A1/A2: si no es claramente malo, NO hacemos mini-call
        }
      }

      // --- Micro-error #2 corregido: prioridad a elipsis A1 (si es elíptico, guiamos) ---
      if (isA1EllipticUserUtterance(userMessage, level)) {
        const immersive = await miniImmersiveFallback();
        if (immersive) {
          norm.reply = immersive;
          return norm;
        }
      }

      // --- Guardia anti "¿De qué?" en A1 con respuesta elíptica ---
      if (isA1EllipticUserUtterance(userMessage, level) && isBadClarificationQuestion(norm.reply)) {
        const immersive = await miniImmersiveFallback();
        if (immersive) norm.reply = immersive;
        return norm;
      }

      if (!norm.reply) needsFallback = true;

      // 1) Respuesta débil o típica de relleno
      if (isWeakReply(norm.reply)) needsFallback = true;

      // 2) Irrelevante al mensaje del alumno
      if (isIrrelevantReply(norm.reply, userMessage)) needsFallback = true;

      // 3) Referencia implícita sin concreción
      const userIsAmbiguous = hasImplicitReference(userMessage) || isA1EllipticUserUtterance(userMessage, level);

      if (hasImplicitReference(userMessage)) {
        const u = userMessage.toLowerCase();
        const hasNumberOrQty = /\b(un|una|dos|tres|cuatro|cinco|\d+|kilo|kilos|medio)\b/i.test(u);
        const hasSpecificNoun = u.length > 0 && u.split(/\s+/).length >= 4;

        if (!hasNumberOrQty && !hasSpecificNoun) needsFallback = true;
      }

      // --- Micro-error #1 corregido: NO exigir pregunta siempre; solo si el user fue ambiguo ---
      const hasQuestion = /[?¿]/.test(norm.reply);
      if (pendingObjectives.length > 0 && userIsAmbiguous && !hasQuestion) needsFallback = true;

      if (needsFallback) {
        const immersive = await miniImmersiveFallback();
        if (immersive) norm.reply = immersive;
      }

      if (!norm.reply) {
        norm.reply = "Perdón 🙂 ¿Puedes concretarlo un poco más?";
      }

      return norm;
    }

    // -------- Lógica principal --------

    const out = await callGemini({ strict: false });
    if (!out.ok) {
      return res.status(out.status).json({ error: "Gemini API error", details: out.data });
    }

    let jsonStr = extractJsonString(out.textRaw);

    // Reintento estricto si no hay JSON válido
    if (!jsonStr) {
      const out2 = await callGemini({ strict: true });
      if (!out2.ok) {
        return res.status(out2.status).json({ error: "Gemini API error", details: out2.data });
      }

      jsonStr = extractJsonString(out2.textRaw);

      if (!jsonStr) {
        const immersive = await miniImmersiveFallback();
        const fallbackReply = cleanModelText(out2.textRaw);

        return res.status(200).json({
          reply: immersive || fallbackReply || "Perdón 🙂 ¿Puedes concretarlo un poco más?",
          completed_objective_ids: Array.isArray(incomingCompletedIds) ? incomingCompletedIds.map(String) : []
        });
      }

      try {
        const parsed2 = JSON.parse(jsonStr);
        let norm2 = safeNormalizeParsed(parsed2, out2.textRaw);
        norm2 = await applyQualityHeuristics(norm2);
        return res.status(200).json(norm2);
      } catch {
        const immersive = await miniImmersiveFallback();
        const fallbackReply = cleanModelText(out2.textRaw);

        return res.status(200).json({
          reply: immersive || fallbackReply || "Perdón 🙂 ¿Puedes concretarlo un poco más?",
          completed_objective_ids: Array.isArray(incomingCompletedIds) ? incomingCompletedIds.map(String) : []
        });
      }
    }

    // Parse del primer intento
    try {
      const parsed = JSON.parse(jsonStr);
      let norm = safeNormalizeParsed(parsed, out.textRaw);
      norm = await applyQualityHeuristics(norm);
      return res.status(200).json(norm);
    } catch {
      const immersive = await miniImmersiveFallback();
      const fallbackReply = cleanModelText(out.textRaw);

      return res.status(200).json({
        reply: immersive || fallbackReply || "Perdón 🙂 ¿Puedes concretarlo un poco más?",
        completed_objective_ids: Array.isArray(incomingCompletedIds) ? incomingCompletedIds.map(String) : []
      });
    }
  } catch (err) {
    return res.status(500).json({ error: "Server error", details: String(err?.message || err) });
  }
}
