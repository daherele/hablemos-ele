import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  MessageCircle,
  BookOpen,
  Send,
  ArrowLeft,
  X,
  User,
  Bot,
  Sparkles,
  Volume2,
  Wand2,
  Loader2,
  Home,
  ZapOff,
  Plus,
  Target,
  CheckSquare,
  Square,
} from "lucide-react";

/**
 * ✅ Frontend seguro:
 * - Sin API key en cliente
 * - Llamadas SOLO a /api/chat y /api/correct (backend en Vercel)
 */

// --- Helpers ---
async function postJSON(path, payload) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data;
}

// ✅ Chat vía backend
async function callChat(history, scenario, level, userMessage, currentObjectives) {
  const trimmedHistory = Array.isArray(history) ? history.slice(-6) : [];

  const data = await postJSON("/api/chat", {
    history: trimmedHistory,
    scenario,
    level,
    userMessage,
    currentObjectives,
  });

  return {
    reply: typeof data?.reply === "string" ? data.reply : "No pude generar respuesta.",
    completed_objective_ids: Array.isArray(data?.completed_objective_ids)
      ? data.completed_objective_ids
      : [],
  };
}

// ✅ Corrección vía backend
async function callCorrection(text, level) {
  const data = await postJSON("/api/correct", { text, level });

  return {
    corrected: typeof data?.corrected === "string" ? data.corrected.trim() : "",
    explanation: typeof data?.explanation === "string" ? data.explanation.trim() : "",
  };
}

// --- DATA ---
const LEVELS = [
  { id: "A1", label: "A1 - Acceso", color: "bg-green-100 text-green-800 border-green-200" },
  { id: "A2", label: "A2 - Plataforma", color: "bg-green-200 text-green-900 border-green-300" },
  { id: "B1", label: "B1 - Umbral", color: "bg-blue-100 text-blue-800 border-blue-200" },
  { id: "B2", label: "B2 - Avanzado", color: "bg-blue-200 text-blue-900 border-blue-300" },
  { id: "C1", label: "C1 - Dominio", color: "bg-purple-100 text-purple-800 border-purple-200" },
];

const INITIAL_SCENARIOS = [
  {
    id: "friend_house",
    title: "Visita a una Amiga",
    difficulty: ["A1", "A2"],
    icon: <Home className="w-6 h-6" />,
    description: "Practica saludos informales y etiqueta básica de visita.",
    color: "bg-rose-400",
    objectives: [
      { id: "obj_greet", text: "Saludar adecuadamente a tu amiga" },
      { id: "obj_drink", text: "Aceptar o rechazar una bebida" },
      { id: "obj_compliment", text: "Hacer un cumplido sobre la casa" },
      { id: "obj_farewell", text: "Despedirse al marcharte" },
    ],
    vocab: [
      { word: "¡Hola! ¿Qué tal?", type: "phrase", translation: "Hello! How are you?" },
      { word: "Pasa, pasa", type: "phrase", translation: "Come in, come in" },
      { word: "¡Qué casa tan bonita!", type: "phrase", translation: "What a beautiful house!" },
      { word: "Sí, un poco de agua por favor", type: "phrase", translation: "Yes, some water please" },
      { word: "Me tengo que ir", type: "phrase", translation: "I have to go" },
    ],
    botPersona: {
      name: "María (Amiga)",
      initialMessage: {
        A1: "¡Hola! ¡Qué bien que has venido! Pasa, por favor.",
        A2: "¡Hola! Cuánto tiempo. Deja tu abrigo ahí. ¿Qué tal el viaje?",
        default: "¡Hola! Bienvenida a mi casa.",
      },
    },
  },
];

// --- UI components ---
const SafeRender = ({ content }) => {
  if (typeof content === "string" || typeof content === "number") return content;
  if (typeof content === "object") return JSON.stringify(content);
  return null;
};

const LevelBadge = ({ level, selected, onClick }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 md:px-4 md:py-2 rounded-lg text-xs md:text-sm font-medium border transition-all whitespace-nowrap ${
      selected ? "ring-2 ring-indigo-500 ring-offset-1 shadow-sm scale-105" : "opacity-70 hover:opacity-100"
    } ${level.color}`}
  >
    {level.label}
  </button>
);

const VocabularyItem = ({ item, onSelect }) => (
  <button
    onClick={() => onSelect(item.word)}
    className="w-full text-left p-3 mb-2 bg-white hover:bg-indigo-50 border border-gray-200 rounded-lg transition-colors group"
  >
    <div className="flex justify-between items-start">
      <span className="font-medium text-gray-800 group-hover:text-indigo-700">
        <SafeRender content={item.word} />
      </span>
      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 capitalize">
        <SafeRender content={item.type} />
      </span>
    </div>
    <p className="text-sm text-gray-500 mt-1 italic">
      <SafeRender content={item.translation} />
    </p>
  </button>
);

/**
 * ✅ Objetivos robustos (Opción A): el estudiante los marca manualmente.
 */
const ObjectiveItem = ({ obj, onToggle }) => {
  return (
    <label className="flex items-start gap-3 p-3 rounded-lg border bg-white border-gray-200 hover:bg-gray-50 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={!!obj.completed}
        onChange={() => onToggle(obj.id)}
        className="mt-1"
      />
      <div className="flex-1">
        <div className={`text-sm ${obj.completed ? "text-green-800 line-through" : "text-gray-700"}`}>
          {obj.text}
        </div>
        <div className="text-[11px] text-gray-400 mt-1">ID: {obj.id}</div>
      </div>
      <div className="mt-0.5">
        {obj.completed ? <CheckSquare size={18} className="text-green-600" /> : <Square size={18} className="text-gray-300" />}
      </div>
    </label>
  );
};

const ChatMessage = ({ message, isUser, isLastUserMessage, onCorrect }) => {
  const [isPlaying] = useState(false); // TTS desactivado (placeholder)
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const handleCorrection = async () => {
    setIsCorrecting(true);
    try {
      const fb = await onCorrect(message.text);
      setFeedback(fb || null);
    } finally {
      setIsCorrecting(false);
    }
  };

  return (
    <div className={`flex w-full mb-6 ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`flex flex-col max-w-[85%] md:max-w-[75%] ${isUser ? "items-end" : "items-start"}`}>
        <div className={`flex ${isUser ? "flex-row-reverse" : "flex-row"}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isUser ? "ml-2 bg-indigo-600" : "mr-2 bg-gray-200"}`}>
            {isUser ? <User size={16} className="text-white" /> : <Bot size={16} className="text-gray-600" />}
          </div>

          <div
            className={`p-3 rounded-2xl text-sm md:text-base shadow-sm relative group ${
              isUser
                ? "bg-indigo-600 text-white rounded-tr-none"
                : "bg-white border border-gray-100 text-gray-800 rounded-tl-none"
            }`}
          >
            <SafeRender content={message.text} />
          </div>
        </div>

        <div className={`flex items-center gap-2 mt-1 px-1 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
          {!isUser && (
            <button
              disabled
              className="text-xs flex items-center gap-1 transition-colors text-gray-300 cursor-not-allowed"
              title="TTS desactivado (si quieres, lo movemos a /api/tts)"
            >
              {isPlaying ? <Loader2 size={12} className="animate-spin" /> : <Volume2 size={12} />}
              <span>Escuchar</span>
            </button>
          )}

          {isUser && isLastUserMessage && (
            <button
              onClick={handleCorrection}
              disabled={isCorrecting}
              className="text-xs text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded-full flex items-center gap-1 transition-colors border border-indigo-100"
              title="Corregir tu último mensaje"
            >
              {isCorrecting ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
              <span>Corregir</span>
            </button>
          )}
        </div>

        {feedback && (
          <div className="mt-2 bg-yellow-50 border border-yellow-200 rounded-lg p-2 text-xs text-yellow-800 max-w-full animate-fade-in flex gap-2 items-start">
            <Sparkles size={14} className="mt-0.5 shrink-0 text-yellow-600" />
            <div><SafeRender content={feedback} /></div>
          </div>
        )}
      </div>
    </div>
  );
};

export default function App() {
  const [screen, setScreen] = useState("home");
  const [selectedScenario, setSelectedScenario] = useState(null);
  const [selectedLevelId, setSelectedLevelId] = useState("A1");
  const [scenarios] = useState(INITIAL_SCENARIOS);

  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [isVocabOpen, setIsVocabOpen] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  // ✅ Objetivos “A”: el alumno marca manualmente
  const [currentObjectives, setCurrentObjectives] = useState([]);

  // Crear situación sigue desactivado en este App (solo UI)
  const [isCreatingScenario, setIsCreatingScenario] = useState(false);
  const [customTopic, setCustomTopic] = useState("");

  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const filteredScenarios = useMemo(() => {
    return scenarios
      .filter((s) => {
        if (selectedLevelId === "A1" || selectedLevelId === "A2") return s.difficulty.some((d) => ["A1", "A2"].includes(d));
        if (selectedLevelId === "B1" || selectedLevelId === "B2") return s.difficulty.some((d) => ["B1", "B2"].includes(d));
        if (selectedLevelId === "C1") return s.difficulty.includes("C1");
        return true;
      })
      .sort((a, b) => {
        const aRelevance = a.difficulty.includes(selectedLevelId) ? 1 : 0;
        const bRelevance = b.difficulty.includes(selectedLevelId) ? 1 : 0;
        return bRelevance - aRelevance;
      });
  }, [scenarios, selectedLevelId]);

  const startChat = (scenario) => {
    setSelectedScenario(scenario);
    setScreen("chat");
    setIsVocabOpen(window.innerWidth >= 1024);
    setErrorMsg(null);

    // ✅ objetivos locales (robustos)
    const sessionObjectives = (scenario.objectives || []).map((obj) => ({
      ...obj,
      completed: false,
    }));
    setCurrentObjectives(sessionObjectives);

    let intro = "";
    if (typeof scenario.botPersona?.initialMessage === "string") {
      intro = scenario.botPersona.initialMessage;
    } else {
      intro =
        scenario.botPersona?.initialMessage?.[selectedLevelId] ||
        scenario.botPersona?.initialMessage?.default ||
        "¡Hola!";
    }

    setMessages([{ id: Date.now(), sender: "bot", text: intro }]);
  };

  const handleToggleObjective = (id) => {
    setCurrentObjectives((prev) =>
      prev.map((o) => (o.id === id ? { ...o, completed: !o.completed } : o))
    );
  };

  const handleVocabSelect = (word) => {
    setInputText((prev) => prev + (prev ? " " : "") + word);
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || !selectedScenario) return;

    const historySnapshot = messages;
    const userMsg = { id: Date.now(), sender: "user", text: inputText.trim() };

    setMessages((prev) => [...prev, userMsg]);
    setInputText("");
    setIsTyping(true);
    setErrorMsg(null);

    try {
      const responseData = await callChat(
        historySnapshot,
        selectedScenario,
        selectedLevelId,
        userMsg.text,
        currentObjectives
      );

      const botMsg = { id: Date.now() + 1, sender: "bot", text: responseData.reply };
      setMessages((prev) => [...prev, botMsg]);

      // ⚠️ No marcamos objetivos automáticamente (Opción A = manual).
      // Si más adelante quieres “sugerencias” sin fragilidad, lo hacemos en una capa separada.
    } catch (err) {
      console.error(err);
      setErrorMsg(err?.message || "Error de conexión.");
    } finally {
      setIsTyping(false);
    }
  };

  const handleCorrectionRequest = async (text) => {
    const { corrected, explanation } = await callCorrection(text, selectedLevelId);

    // Si no hay corrección, devolvemos feedback útil (no vacío)
    if (!corrected) {
      return explanation || "No pude corregir ahora mismo.";
    }

    // Reemplaza el último mensaje del usuario por la versión corregida
    setMessages((prev) => {
      const copy = [...prev];
      for (let i = copy.length - 1; i >= 0; i--) {
        if (copy[i]?.sender === "user") {
          copy[i] = { ...copy[i], text: corrected };
          break;
        }
      }
      return copy;
    });

    // Feedback breve (si no quieres feedback, devuelve null)
    return explanation ? `💡 ${explanation}` : "✅ Corregido.";
  };

  const lastUserMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.sender === "user") return messages[i].id;
    }
    return null;
  }, [messages]);

  const handleCreateScenario = (e) => {
    e.preventDefault();
    alert("🔒 Crear Situación sigue desactivado aquí. Si quieres lo activamos creando /api/scenario (backend).");
    setIsCreatingScenario(false);
    setCustomTopic("");
  };

  // --- HOME ---
  if (screen === "home") {
    return (
      <div className="min-h-screen bg-gray-50 font-sans">
        {isCreatingScenario && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
              <h3 className="text-xl font-bold text-gray-800 mb-2">✨ Crear Situación</h3>
              <p className="text-sm text-gray-600 mb-4">
                (Ahora está desactivado por seguridad. Se activa con un endpoint /api/scenario.)
              </p>
              <form onSubmit={handleCreateScenario}>
                <input
                  type="text"
                  value={customTopic}
                  onChange={(e) => setCustomTopic(e.target.value)}
                  placeholder="Ej: Pedir una pizza por teléfono..."
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 mb-4 focus:ring-2 focus:ring-indigo-500 outline-none"
                  autoFocus
                />
                <div className="flex justify-end gap-3">
                  <button type="button" onClick={() => setIsCreatingScenario(false)} className="px-4 py-2 text-gray-500">
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg flex items-center gap-2 hover:bg-indigo-700"
                  >
                    <Sparkles size={18} />
                    Generar
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <header className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
          <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="bg-indigo-600 p-2 rounded-lg shadow-sm">
                <MessageCircle className="text-white w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-800 leading-none">Hablemos</h1>
                <span className="text-xs text-indigo-600 font-medium">Práctica de Español con IA</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 text-xs text-amber-600 bg-amber-50 px-3 py-1 rounded-full border border-amber-200">
                <ZapOff size={12} />
                <span>Modo seguro (IA por backend)</span>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-5xl mx-auto px-4 py-8">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Selecciona tu Nivel</h2>
            <div className="flex flex-wrap gap-2 md:gap-3 mb-8">
              {LEVELS.map((level) => (
                <LevelBadge
                  key={level.id}
                  level={level}
                  selected={selectedLevelId === level.id}
                  onClick={() => setSelectedLevelId(level.id)}
                />
              ))}
            </div>

            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-800">Contextos Disponibles</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              <div
                onClick={() => setIsCreatingScenario(true)}
                className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-md border-0 overflow-hidden cursor-pointer transition-all hover:-translate-y-1 hover:shadow-lg flex flex-col items-center justify-center text-white p-6 group min-h-[200px]"
                title="Se activa con /api/scenario"
              >
                <div className="bg-white/20 p-4 rounded-full mb-4 group-hover:scale-110 transition-transform">
                  <Plus size={32} />
                </div>
                <h3 className="font-bold text-lg text-center">Crear Situación</h3>
                <p className="text-indigo-100 text-xs text-center mt-2">
                  Desactivado por seguridad<br />hasta moverlo al backend.
                </p>
              </div>

              {filteredScenarios.map((scenario) => (
                <div
                  key={scenario.id}
                  onClick={() => startChat(scenario)}
                  className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden cursor-pointer transition-all hover:-translate-y-1 group"
                >
                  <div className={`h-2 ${scenario.color}`}></div>
                  <div className="p-5">
                    <div className="flex justify-between items-start mb-3">
                      <div className="p-2.5 rounded-lg bg-gray-50 text-gray-700 group-hover:text-indigo-600 group-hover:bg-indigo-50 transition-colors">
                        {scenario.icon}
                      </div>
                    </div>
                    <h3 className="text-lg font-bold text-gray-800 mb-1">{scenario.title}</h3>
                    <p className="text-gray-500 text-xs mb-3 line-clamp-2">{scenario.description}</p>
                    <div className="flex flex-wrap gap-1 mt-auto">
                      {scenario.difficulty.map((d) => (
                        <span
                          key={d}
                          className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded border border-gray-200 font-mono"
                        >
                          {d}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  // --- CHAT ---
  return (
    <div className="h-screen bg-gray-100 flex flex-col md:flex-row overflow-hidden font-sans">
      <div className="flex-1 flex flex-col h-full relative z-0">
        <header className="bg-white px-4 py-3 border-b flex items-center justify-between shrink-0 shadow-sm z-10">
          <div className="flex items-center gap-3">
            <button onClick={() => setScreen("home")} className="p-2 hover:bg-gray-100 rounded-full text-gray-600 transition-colors">
              <ArrowLeft size={20} />
            </button>
            <div>
              <h2 className="font-bold text-gray-800 leading-tight text-sm md:text-base">
                {selectedScenario?.title || "Chat"}
              </h2>
              <div className="text-xs text-gray-500">Nivel {selectedLevelId}</div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setIsVocabOpen(!isVocabOpen)}
              className={`p-2 rounded-lg flex items-center gap-2 transition-colors ${
                isVocabOpen ? "bg-indigo-100 text-indigo-700" : "hover:bg-gray-100 text-gray-600"
              }`}
            >
              <Target size={20} />
              <span className="hidden sm:inline font-medium text-sm">Misión</span>
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 bg-slate-50">
          <div className="max-w-3xl mx-auto">
            {errorMsg && (
              <div className="mb-3 text-sm bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg">
                {errorMsg}
              </div>
            )}

            {messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                isUser={msg.sender === "user"}
                isLastUserMessage={msg.sender === "user" && msg.id === lastUserMessageId}
                onCorrect={handleCorrectionRequest}
              />
            ))}

            {isTyping && (
              <div className="flex justify-start w-full mb-4">
                <div className="flex flex-row items-center bg-white border border-gray-100 p-3 rounded-2xl rounded-tl-none shadow-sm gap-1">
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></div>
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-75"></div>
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-150"></div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="bg-white p-3 md:p-4 border-t shrink-0">
          <form onSubmit={handleSendMessage} className="max-w-3xl mx-auto relative flex items-center gap-2">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={`Escribe en español (${selectedLevelId})...`}
              className="flex-1 bg-gray-100 border-0 focus:ring-2 focus:ring-indigo-500 rounded-full px-4 py-3 text-sm md:text-base text-gray-800 placeholder-gray-400 transition-shadow"
            />
            <button
              type="submit"
              disabled={!inputText.trim() || isTyping}
              className="p-3 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              <Send size={18} />
            </button>
          </form>
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div
        className={`fixed inset-y-0 right-0 w-80 bg-white border-l shadow-2xl transform transition-transform duration-300 ease-in-out z-20 md:relative md:transform-none md:shadow-none ${
          isVocabOpen ? "translate-x-0" : "translate-x-full md:hidden"
        }`}
      >
        <div className="h-full flex flex-col">
          <div className="p-4 border-b flex items-center justify-between bg-gray-50">
            <div className="flex items-center gap-2 text-gray-800 font-semibold">
              <Target size={18} className="text-indigo-600" />
              <h3>Tu Misión</h3>
            </div>
            <button onClick={() => setIsVocabOpen(false)} className="md:hidden text-gray-500 hover:bg-gray-200 rounded p-1">
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1">
                Objetivos Comunicativos (manual)
              </h4>

              <div className="space-y-3">
                {currentObjectives?.length ? (
                  currentObjectives.map((obj) => (
                    <ObjectiveItem key={obj.id} obj={obj} onToggle={handleToggleObjective} />
                  ))
                ) : (
                  <p className="text-sm text-gray-400 italic">No hay objetivos definidos.</p>
                )}
              </div>

              <div className="mt-3 text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded p-2">
                ✅ Este sistema no depende de la IA: el estudiante marca lo que cree que ha logrado.
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1">
                <BookOpen size={14} /> Léxico Útil
              </h4>
              <div className="space-y-1">
                {selectedScenario?.vocab?.map((item, index) => (
                  <VocabularyItem key={index} item={item} onSelect={handleVocabSelect} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {isVocabOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-25 z-10 md:hidden" onClick={() => setIsVocabOpen(false)} />
      )}
    </div>
  );
}
