import React, { useState, useEffect, useRef } from 'react';
import {
  MessageCircle, BookOpen, Send, ArrowLeft, X,
  User, Bot, Sparkles, Volume2, Wand2, Loader2,
  Home, ZapOff, Plus, CheckCircle, AlertCircle, Target, CheckSquare, Square,
  ThumbsDown
} from 'lucide-react';

/**
 * ✅ PASO 3 (frontend -> backend):
 * - No hay API key en el cliente.
 * - No hay llamadas directas a Google desde el navegador.
 * - El frontend llama a /api/chat (función backend en Vercel).
 */

// --- MOCK AI LOGIC (FALLBACK) ---
const generateMockReply = (input, contextId) => {
  const lowerInput = input.toLowerCase();
  let updates = [];

  if (contextId === 'friend_house') {
    if (lowerInput.includes('hola') || lowerInput.includes('buenos')) {
      updates.push({
        id: 'obj_greet',
        status: 'possible',
        confidence: 0.9,
        evidence: input,
        reason: "Saludo reconocido"
      });
    }
  }

  const responses = ["¡Hola! ¿Cómo estás?", "Entiendo, cuéntame más.", "Muy bien."];
  const reply = responses[Math.floor(Math.random() * responses.length)];

  return {
    reply: `(Demo) ${reply}`,
    objective_updates: updates,
    follow_up_question: "¿Y qué tal tu familia?"
  };
};

// --- BACKEND CALLS (/api/*) ---
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
    // si no devuelve JSON, lo dejamos en null
  }

  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// ✅ Chat vía backend
const callGeminiChat = async (history, scenario, level, userMessage, currentObjectives) => {
  try {
    const trimmedHistory = Array.isArray(history) ? history.slice(-6) : [];

    const data = await postJSON("/api/chat", {
      history: trimmedHistory,
      scenario,
      level,
      userMessage,
      currentObjectives
    });

    return {
      reply: typeof data?.reply === "string" ? data.reply : "No pude generar respuesta.",
      objective_updates: Array.isArray(data?.objective_updates) ? data.objective_updates : [],
      follow_up_question: typeof data?.follow_up_question === "string" ? data.follow_up_question : ""
    };
  } catch (err) {
    console.warn("Backend /api/chat falló, usando modo demo:", err);
    return generateMockReply(userMessage, scenario?.id);
  }
};

// ✅ Corrección vía backend
const callGeminiCorrection = async (text, level) => {
  const data = await postJSON("/api/correct", { text, level });

  return {
    corrected: typeof data?.corrected === "string" ? data.corrected.trim() : "",
    explanation: typeof data?.explanation === "string" ? data.explanation.trim() : ""
  };
};

const callGeminiTTS = async () => {
  // desactivado por ahora
  return;
};

// --- INITIAL DATA ---
const LEVELS = [
  { id: 'A1', label: 'A1 - Acceso', description: 'Vocabulario básico y frases sencillas.', color: 'bg-green-100 text-green-800 border-green-200' },
  { id: 'A2', label: 'A2 - Plataforma', description: 'Descripciones y tareas rutinarias.', color: 'bg-green-200 text-green-900 border-green-300' },
  { id: 'B1', label: 'B1 - Umbral', description: 'Situaciones imprevistas y opiniones.', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  { id: 'B2', label: 'B2 - Avanzado', description: 'Conversación fluida y técnica.', color: 'bg-blue-200 text-blue-900 border-blue-300' },
  { id: 'C1', label: 'C1 - Dominio', description: 'Contextos complejos y profesionales.', color: 'bg-purple-100 text-purple-800 border-purple-200' },
];

const INITIAL_SCENARIOS = [
  {
    id: 'friend_house',
    title: 'Visita a una Amiga',
    difficulty: ['A1', 'A2'],
    icon: <Home className="w-6 h-6" />,
    description: 'Practica saludos informales y etiqueta básica de visita.',
    color: 'bg-rose-400',
    objectives: [
      { id: 'obj_greet', text: 'Saludar adecuadamente a tu amiga' },
      { id: 'obj_drink', text: 'Aceptar o rechazar una bebida' },
      { id: 'obj_compliment', text: 'Hacer un cumplido sobre la casa' },
      { id: 'obj_farewell', text: 'Despedirse al marcharte' }
    ],
    vocab: [
      { word: '¡Hola! ¿Qué tal?', type: 'phrase', translation: 'Hello! How are you?' },
      { word: 'Pasa, pasa', type: 'phrase', translation: 'Come in, come in' },
      { word: '¡Qué casa tan bonita!', type: 'phrase', translation: 'What a beautiful house!' },
      { word: 'Sí, un poco de agua por favor', type: 'phrase', translation: 'Yes, some water please' },
      { word: 'Me tengo que ir', type: 'phrase', translation: 'I have to go' },
    ],
    botPersona: {
      name: 'María (Amiga)',
      initialMessage: {
        A1: '¡Hola! ¡Qué bien que has venido! Pasa, por favor.',
        A2: '¡Hola! Cuánto tiempo. Deja tu abrigo ahí. ¿Qué tal el viaje?',
        default: '¡Hola! Bienvenida a mi casa.'
      }
    }
  },
];

// --- COMPONENTS ---
const SafeRender = ({ content }) => {
  if (typeof content === 'string' || typeof content === 'number') return content;
  if (typeof content === 'object') return JSON.stringify(content);
  return null;
};

const ChatMessage = ({ message, isUser, onCorrect, isLast }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [isCorrecting, setIsCorrecting] = useState(false);

  const handlePlay = async () => {
    if (isPlaying) return;
    setIsPlaying(true);
    await callGeminiTTS(message.text);
    setIsPlaying(false);
  };

  const handleCorrection = async () => {
    setIsCorrecting(true);
    const result = await onCorrect(message.text);
    setFeedback(result);
    setIsCorrecting(false);
  };

  return (
    <div className={`flex w-full mb-6 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex flex-col max-w-[85%] md:max-w-[75%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`flex ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isUser ? 'ml-2 bg-indigo-600' : 'mr-2 bg-gray-200'}`}>
            {isUser ? <User size={16} className="text-white" /> : <Bot size={16} className="text-gray-600" />}
          </div>
          <div className={`p-3 rounded-2xl text-sm md:text-base shadow-sm relative group ${
            isUser
              ? 'bg-indigo-600 text-white rounded-tr-none'
              : 'bg-white border border-gray-100 text-gray-800 rounded-tl-none'
          }`}>
            <SafeRender content={message.text} />
          </div>
        </div>

        <div className={`flex items-center gap-2 mt-1 px-1 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
          {!isUser && (
            <button
              onClick={handlePlay}
              disabled={true}
              className="text-xs flex items-center gap-1 transition-colors text-gray-300 cursor-not-allowed"
              title="TTS desactivado por seguridad (mover a backend)"
            >
              {isPlaying ? <Loader2 size={12} className="animate-spin" /> : <Volume2 size={12} />}
              <span>Escuchar</span>
            </button>
          )}

          {isUser && isLast && !feedback && (
            <button
              onClick={handleCorrection}
              disabled={isCorrecting}
              className="text-xs text-indigo-500 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded-full flex items-center gap-1 transition-colors border border-indigo-100"
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

const LevelBadge = ({ level, selected, onClick }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 md:px-4 md:py-2 rounded-lg text-xs md:text-sm font-medium border transition-all whitespace-nowrap ${
      selected ? 'ring-2 ring-indigo-500 ring-offset-1 shadow-sm scale-105' : 'opacity-70 hover:opacity-100'
    } ${level.color}`}
  >
    {level.label}
  </button>
);

const ObjectiveItem = ({ objective, onConfirm, onReject }) => {
  const { status, text, evidence, reason } = objective;

  if (status === 'confirmed') {
    return (
      <div className="flex items-start gap-3 p-3 rounded-lg border bg-green-50 border-green-200 transition-all">
        <div className="mt-0.5 text-green-500"><CheckSquare size={18} /></div>
        <span className="text-sm text-green-800 line-through decoration-green-300">{text}</span>
      </div>
    );
  }

  if (status === 'possible') {
    return (
      <div className="flex flex-col gap-2 p-3 rounded-lg border bg-yellow-50 border-yellow-200 transition-all">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 text-yellow-600"><AlertCircle size={18} /></div>
          <span className="text-sm text-yellow-900 font-medium">{text}</span>
        </div>

        <div className="text-xs text-yellow-800 bg-yellow-100/50 p-2 rounded ml-1 border-l-2 border-yellow-400">
          <p className="font-semibold mb-1">Evidencia:</p>
          <p className="italic">"{evidence}"</p>
          {reason && <p className="opacity-75 mt-1">({reason})</p>}
        </div>

        <div className="flex gap-2 mt-1 justify-end">
          <button
            onClick={() => onReject(objective.id)}
            className="px-2 py-1.5 bg-white text-red-600 text-xs rounded shadow-sm hover:bg-red-50 border border-red-100 flex items-center gap-1 transition-colors"
          >
            <ThumbsDown size={12} /> No era eso
          </button>
          <button
            onClick={() => onConfirm(objective.id)}
            className="px-3 py-1.5 bg-green-600 text-white text-xs font-bold rounded shadow-sm hover:bg-green-700 flex items-center gap-1 transition-colors"
          >
            <CheckCircle size={12} /> ¡Sí, conseguido!
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border bg-white border-gray-200">
      <div className="mt-0.5 text-gray-300"><Square size={18} /></div>
      <span className="text-sm text-gray-600">{text}</span>
    </div>
  );
};

export default function App() {
  const [screen, setScreen] = useState('home');
  const [selectedScenario, setSelectedScenario] = useState(null);
  const [selectedLevelId, setSelectedLevelId] = useState('A1');
  const [scenarios, setScenarios] = useState(INITIAL_SCENARIOS);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isVocabOpen, setIsVocabOpen] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [currentObjectives, setCurrentObjectives] = useState([]);

  const [isCreatingScenario, setIsCreatingScenario] = useState(false);
  const [customTopic, setCustomTopic] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const filteredScenarios = scenarios.filter(s => {
    if (selectedLevelId === 'A1' || selectedLevelId === 'A2') return s.difficulty.some(d => ['A1', 'A2'].includes(d));
    if (selectedLevelId === 'B1' || selectedLevelId === 'B2') return s.difficulty.some(d => ['B1', 'B2'].includes(d));
    if (selectedLevelId === 'C1') return s.difficulty.includes('C1');
    return true;
  }).sort((a, b) => {
    const aRelevance = a.difficulty.includes(selectedLevelId) ? 1 : 0;
    const bRelevance = b.difficulty.includes(selectedLevelId) ? 1 : 0;
    return bRelevance - aRelevance;
  });

  const startChat = (scenario) => {
    setSelectedScenario(scenario);
    setScreen('chat');
    setIsVocabOpen(window.innerWidth >= 1024);
    setErrorMsg(null);

    const sessionObjectives = (scenario.objectives || []).map(obj => ({
      ...obj,
      status: 'pending',
      evidence: '',
      reason: ''
    }));
    setCurrentObjectives(sessionObjectives);

    let intro = "";
    if (typeof scenario.botPersona.initialMessage === 'string') {
      intro = scenario.botPersona.initialMessage;
    } else {
      intro = scenario.botPersona.initialMessage[selectedLevelId] || scenario.botPersona.initialMessage.default;
    }

    setMessages([{ id: 1, sender: 'bot', text: intro }]);
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const historySnapshot = messages;

    const userMsg = { id: Date.now(), sender: 'user', text: inputText };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsTyping(true);
    setErrorMsg(null);

    try {
      const responseData = await callGeminiChat(
        historySnapshot,
        selectedScenario,
        selectedLevelId,
        userMsg.text,
        currentObjectives
      );

      if (responseData.objective_updates && responseData.objective_updates.length > 0) {
        setCurrentObjectives(prev => prev.map(obj => {
          const update = responseData.objective_updates.find(u => u.id === obj.id);
          if (update && obj.status !== 'confirmed') {
            return {
              ...obj,
              status: 'possible',
              evidence: update.evidence || '',
              reason: update.reason || ''
            };
          }
          return obj;
        }));
      }

      const botMsg = { id: Date.now() + 1, sender: 'bot', text: responseData.reply };
      setMessages(prev => [...prev, botMsg]);
    } catch (err) {
      console.error(err);
      setErrorMsg("Error de conexión.");
    } finally {
      setIsTyping(false);
    }
  };

  const handleConfirmObjective = (id) => {
    setCurrentObjectives(prev => prev.map(obj =>
      obj.id === id ? { ...obj, status: 'confirmed' } : obj
    ));
  };

  const handleRejectObjective = (id) => {
    setCurrentObjectives(prev => prev.map(obj =>
      obj.id === id ? { ...obj, status: 'pending', evidence: '', reason: '' } : obj
    ));
  };

  const handleCorrectionRequest = async (text) => {
    const { corrected, explanation } = await callGeminiCorrection(text, selectedLevelId);

    if (!corrected) {
      return explanation || "No pude corregir ahora mismo.";
    }

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

    return explanation ? `💡 ${explanation}` : null;
  };

  // ✅ ESTA FUNCIÓN FALTABA (causaba el pantallazo en blanco)
  const handleVocabSelect = (word) => {
    setInputText((prev) => prev + (prev ? ' ' : '') + word);
  };

  const handleCreateScenario = async (e) => {
    e.preventDefault();
    if (!customTopic.trim()) return;

    alert("🔒 Por seguridad, 'Crear Situación' está desactivado hasta moverlo a un endpoint backend (/api/scenario).");
    return;
  };

  // --- RENDER: HOME SCREEN ---
  if (screen === 'home') {
    return (
      <div className="min-h-screen bg-gray-50 font-sans">
        {isCreatingScenario && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
              <h3 className="text-xl font-bold text-gray-800 mb-4">✨ Crear Situación</h3>
              <p className="text-sm text-gray-600 mb-4">Describe la situación que quieres practicar. La IA generará todo el contexto por ti.</p>
              <form onSubmit={handleCreateScenario}>
                <input
                  type="text"
                  value={customTopic}
                  onChange={e => setCustomTopic(e.target.value)}
                  placeholder="Ej: Discutiendo una multa de tráfico..."
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 mb-4 focus:ring-2 focus:ring-indigo-500 outline-none"
                  autoFocus
                />
                <div className="flex justify-end gap-3">
                  <button type="button" onClick={() => setIsCreatingScenario(false)} className="px-4 py-2 text-gray-500">Cancelar</button>
                  <button
                    type="submit"
                    disabled={true}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg flex items-center gap-2 disabled:opacity-50 hover:bg-indigo-700"
                    title="Desactivado hasta backend (/api/scenario)"
                  >
                    {isGenerating ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
                    {isGenerating ? 'Creando...' : 'Generar'}
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
              {LEVELS.map(level => (
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
                title="Desactivado hasta backend (/api/scenario)"
              >
                <div className="bg-white/20 p-4 rounded-full mb-4 group-hover:scale-110 transition-transform">
                  <Plus size={32} />
                </div>
                <h3 className="font-bold text-lg text-center">Crear Situación</h3>
                <p className="text-indigo-100 text-xs text-center mt-2">Desactivado por seguridad<br/>hasta moverlo al backend.</p>
              </div>

              {filteredScenarios.map(scenario => (
                <div
                  key={scenario.id}
                  onClick={() => startChat(scenario)}
                  className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden cursor-pointer transition-all hover:-translate-y-1 group"
                >
                  <div className={`h-2 ${scenario.color}`}></div>
                  <div className="p-5">
                    <div className="flex justify-between items-start mb-3">
                      <div className={`p-2.5 rounded-lg bg-gray-50 text-gray-700 group-hover:text-indigo-600 group-hover:bg-indigo-50 transition-colors`}>
                        {scenario.icon}
                      </div>
                    </div>
                    <h3 className="text-lg font-bold text-gray-800 mb-1">{scenario.title}</h3>
                    <p className="text-gray-500 text-xs mb-3 line-clamp-2">{scenario.description}</p>
                    <div className="flex flex-wrap gap-1 mt-auto">
                      {scenario.difficulty.map(d => (
                        <span key={d} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded border border-gray-200 font-mono">{d}</span>
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

  // ✅ Guard anti-pantalla en blanco
  if (screen === 'chat' && !selectedScenario) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white border rounded-xl p-4 max-w-md w-full text-center">
          <p className="text-gray-700 font-medium mb-3">No hay escenario seleccionado.</p>
          <button
            onClick={() => setScreen('home')}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg"
          >
            Volver al inicio
          </button>
        </div>
      </div>
    );
  }

  // --- RENDER: CHAT SCREEN ---
  return (
    <div className="h-screen bg-gray-100 flex flex-col md:flex-row overflow-hidden font-sans">
      <div className="flex-1 flex flex-col h-full relative z-0">
        <header className="bg-white px-4 py-3 border-b flex items-center justify-between shrink-0 shadow-sm z-10">
          <div className="flex items-center gap-3">
            <button onClick={() => setScreen('home')} className="p-2 hover:bg-gray-100 rounded-full text-gray-600 transition-colors">
              <ArrowLeft size={20} />
            </button>
            <div>
              <h2 className="font-bold text-gray-800 leading-tight text-sm md:text-base">
                {selectedScenario?.title || ""}
              </h2>
              <div className="text-xs text-gray-500">Nivel {selectedLevelId}</div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setIsVocabOpen(!isVocabOpen)}
              className={`p-2 rounded-lg flex items-center gap-2 transition-colors ${isVocabOpen ? 'bg-indigo-100 text-indigo-700' : 'hover:bg-gray-100 text-gray-600'}`}
            >
              <Target size={20} />
              <span className="hidden sm:inline font-medium text-sm">Misión</span>
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 bg-slate-50">
          <div className="max-w-3xl mx-auto">
            {messages.map((msg, idx) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                isUser={msg.sender === 'user'}
                onCorrect={handleCorrectionRequest}
                isLast={idx === messages.length - 1 || idx === messages.length - 2}
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

      <div className={`fixed inset-y-0 right-0 w-80 bg-white border-l shadow-2xl transform transition-transform duration-300 ease-in-out z-20 md:relative md:transform-none md:shadow-none ${
        isVocabOpen ? 'translate-x-0' : 'translate-x-full md:hidden'
      }`}>
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
                Objetivos Comunicativos
              </h4>
              <div className="space-y-3">
                {currentObjectives && currentObjectives.map((obj) => (
                  <ObjectiveItem
                    key={obj.id}
                    objective={obj}
                    onConfirm={handleConfirmObjective}
                    onReject={handleRejectObjective}
                  />
                ))}
                {(!currentObjectives || currentObjectives.length === 0) && (
                  <p className="text-sm text-gray-400 italic">No hay objetivos definidos para este escenario.</p>
                )}
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
        <div
          className="fixed inset-0 bg-black bg-opacity-25 z-10 md:hidden"
          onClick={() => setIsVocabOpen(false)}
        ></div>
      )}
    </div>
  );
}
