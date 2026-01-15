import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, BookOpen, Send, ArrowLeft, Utensils, Building2, GraduationCap, Bus, Info, ChevronRight, X, User, Bot, Sparkles, Stethoscope, Briefcase, ShoppingBag, Landmark, Key, ShieldAlert, Volume2, Wand2, Loader2, Home, Users, MapPin, ZapOff, Plus, FileText, CheckCircle, AlertCircle } from 'lucide-react';

// --- GEMINI API CONFIGURATION ---

// ⚠️ INSTRUCCIONES PARA VERCEL:
// Cuando subas este código a Vercel/Vite, DESCOMENTA la siguiente línea:
// const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

// ⚠️ PARA PRUEBAS RÁPIDAS AQUÍ:
// Pega tu clave aquí si quieres probar las funciones avanzadas.
const apiKey = ""; 

// --- MOCK AI LOGIC (FALLBACK) ---
const generateMockReply = (input, contextId, level) => {
  const lowerInput = input.toLowerCase();
  
  const responses = {
    cafe: {
      keywords: { 'café': ['¡Marchando!', '¿Con leche?'], 'cuenta': ['Enseguida.', 'Son 3 euros.'] },
      fallback: ['¿Desea algo más?', '¡Entendido!']
    },
    default: {
      keywords: { 'hola': ['¡Hola!', 'Buenos días.'], 'gracias': ['De nada.', 'A ti.'] },
      fallback: ['Entiendo.', 'Interesante.', 'Continúa, por favor.']
    }
  };

  const contextResponses = responses[contextId] || responses.default;
  let reply = null;

  for (const [key, options] of Object.entries(contextResponses.keywords)) {
    if (lowerInput.includes(key)) {
      reply = options[Math.floor(Math.random() * options.length)];
      break;
    }
  }
  return `(Demo) ${reply || contextResponses.fallback[0]}`;
};

// --- GEMINI API CALLS ---

const callGeminiChat = async (history, scenario, level, userMessage) => {
  if (!apiKey) {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve(generateMockReply(userMessage, scenario.id, level));
      }, 1000);
    });
  }

  const systemPrompt = `
    Eres un asistente conversacional para estudiantes de español como lengua extranjera.
    ROL: ${scenario.botPersona.name} en ${scenario.title}.
    NIVEL ALUMNO: ${level}.
    INSTRUCCIONES: Responde solo en español, corrige implícitamente, mantén el rol. Máximo 2 frases.
  `;

  const contents = [
    { role: "user", parts: [{ text: systemPrompt }] },
    ...history.map(msg => ({
      role: msg.sender === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }]
    })),
    { role: "user", parts: [{ text: userMessage }] }
  ];

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents })
      }
    );
    if (!response.ok) throw new Error("API Error");
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "No te he entendido bien.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Error de conexión con la IA.";
  }
};

const callGeminiCorrection = async (text, level) => {
  if (!apiKey) return "⚠️ Configura la API Key para usar correcciones inteligentes.";
  const prompt = `Actúa como profesor de español. Corrige brevemente esta frase de nivel ${level}: "${text}". Máximo 20 palabras.`;
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }
    );
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "Error al corregir.";
  } catch (error) { return "Error de conexión."; }
};

// ✨ NEW: SCENARIO GENERATOR
const callGeminiScenarioGen = async (topic, level) => {
  if (!apiKey) throw new Error("NO_API_KEY");

  const prompt = `
    Create a Spanish learning scenario for level ${level} based on the topic: "${topic}".
    Return ONLY a valid JSON object with this structure:
    {
      "id": "custom_${Date.now()}",
      "title": "Short Title (in Spanish)",
      "description": "Brief description (in Spanish)",
      "color": "bg-indigo-600",
      "vocab": [
        {"word": "Spanish word/phrase", "type": "noun/verb/phrase", "translation": "English translation"}
      ],
      "botPersona": {
        "name": "Role Name",
        "initialMessage": {
          "${level}": "Initial greeting in Spanish for level ${level}",
          "default": "Default greeting"
        }
      }
    }
    Generate 5 relevant vocab items. Ensure all fields are strings, not objects.
  `;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      }
    );
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return JSON.parse(text);
  } catch (error) {
    console.error("Scenario Gen Error:", error);
    throw error;
  }
};

// ✨ NEW: FEEDBACK GENERATOR
const callGeminiFeedback = async (history, level) => {
  if (!apiKey) return null;

  const conversationText = history.map(m => `${m.sender}: ${m.text}`).join('\n');
  const prompt = `
    Analyze this conversation for a Spanish student (Level ${level}).
    Conversation:
    ${conversationText}

    Return ONLY a valid JSON object with:
    {
      "score": number (1-10),
      "comment": "Brief encouraging comment in Spanish (max 20 words)",
      "corrections": [
        "Correction 1 (e.g. 'Dijiste X, mejor di Y')",
        "Correction 2"
      ],
      "goodPoints": [
        "Good point 1",
        "Good point 2"
      ]
    }
    Limit to 3 corrections and 2 good points. Ensure arrays contain strings only.
  `;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      }
    );
    const data = await response.json();
    return JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text);
  } catch (error) {
    console.error("Feedback Error:", error);
    return null;
  }
};

const callGeminiTTS = async (text) => {
  if (!apiKey) return;
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } } }
        }),
      }
    );
    if (!response.ok) throw new Error("TTS Error");
    const data = await response.json();
    const audioContent = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (audioContent) {
      const binaryString = atob(audioContent);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) { bytes[i] = binaryString.charCodeAt(i); }
      const wavBytes = addWavHeader(bytes, 24000, 1); 
      const blob = new Blob([wavBytes], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play();
    }
  } catch (error) { console.error("TTS Error:", error); }
};

function addWavHeader(samples, sampleRate, numChannels) {
  const buffer = new ArrayBuffer(44 + samples.length);
  const view = new DataView(buffer);
  const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++) { view.setUint8(offset + i, string.charCodeAt(i)); }
  };
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); 
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length, true);
  const dataView = new Uint8Array(buffer);
  dataView.set(samples, 44);
  return buffer;
}

// --- INITIAL DATA ---

const LEVELS = [
  { id: 'A1', label: 'A1 - Acceso', description: 'Vocabulario básico y frases sencillas.', color: 'bg-green-100 text-green-800 border-green-200' },
  { id: 'A2', label: 'A2 - Plataforma', description: 'Descripciones y tareas rutinarias.', color: 'bg-green-200 text-green-900 border-green-300' },
  { id: 'B1', label: 'B1 - Umbral', description: 'Situaciones imprevistas y opiniones.', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  { id: 'B2', label: 'B2 - Avanzado', description: 'Conversación fluida y técnica.', color: 'bg-blue-200 text-blue-900 border-blue-300' },
  { id: 'C1', label: 'C1 - Dominio', description: 'Contextos complejos y profesionales.', color: 'bg-purple-100 text-purple-800 border-purple-200' },
];

const INITIAL_SCENARIOS = [
  // --- NIVEL A1 / A2 (Familiar & Entorno Inmediato) ---
  {
    id: 'friend_house',
    title: 'Visita a una Amiga',
    difficulty: ['A1', 'A2'],
    icon: <Home className="w-6 h-6" />,
    description: 'Saludar, entrar en casa y conversaciones informales.',
    color: 'bg-rose-400',
    vocab: [
      { word: '¡Hola! ¿Qué tal?', type: 'phrase', translation: 'Hello! How are you?' },
      { word: 'Pasa, pasa', type: 'phrase', translation: 'Come in, come in' },
      { word: 'Siéntate, por favor', type: 'phrase', translation: 'Sit down, please' },
      { word: '¿Quieres beber algo?', type: 'phrase', translation: 'Do you want something to drink?' },
      { word: 'Tu casa es muy bonita', type: 'phrase', translation: 'Your house is very pretty' },
    ],
    botPersona: {
      name: 'María (Amiga)',
      initialMessage: {
        A1: '¡Hola! ¡Qué bien que has venido! Pasa, por favor.',
        A2: '¡Hola! Cuánto tiempo sin verte. Deja tu abrigo ahí y ponte cómoda. ¿Qué tal el viaje?',
        default: '¡Hola! Bienvenida a mi casa.'
      }
    }
  },
  {
    id: 'family_dinner',
    title: 'Cena en Familia',
    difficulty: ['A1', 'A2'],
    icon: <Users className="w-6 h-6" />,
    description: 'Poner la mesa, hablar de comida y rutinas familiares.',
    color: 'bg-amber-500',
    vocab: [
      { word: 'Poner la mesa', type: 'verb', translation: 'To set the table' },
      { word: 'La cena está lista', type: 'phrase', translation: 'Dinner is ready' },
      { word: '¿Qué hay de comer?', type: 'phrase', translation: 'What is for dinner?' },
      { word: 'Pásame el pan', type: 'phrase', translation: 'Pass me the bread' },
      { word: 'Está muy rico', type: 'phrase', translation: 'It is very tasty' },
    ],
    botPersona: {
      name: 'Mamá',
      initialMessage: {
        A1: '¡Hola! La cena está casi lista. ¿Puedes poner la mesa?',
        A2: 'Hijo, ven a la cocina. ¿Me ayudas a cortar el pan y llevar los vasos al comedor?',
        default: '¡A cenar! Venid todos a la mesa.'
      }
    }
  },
  {
    id: 'cafe',
    title: 'En la Cafetería',
    difficulty: ['A1', 'A2'],
    icon: <Utensils className="w-6 h-6" />,
    description: 'Pedir bebidas, aperitivos y pagar la cuenta.',
    color: 'bg-orange-400',
    vocab: [
      { word: 'Un café con leche', type: 'phrase', translation: 'A coffee with milk' },
      { word: 'La cuenta, por favor', type: 'phrase', translation: 'The bill, please' },
      { word: '¿Cuánto es?', type: 'phrase', translation: 'How much is it?' },
      { word: 'Azúcar / Sacarina', type: 'noun', translation: 'Sugar / Sweetener' },
    ],
    botPersona: {
      name: 'Camarero',
      initialMessage: {
        A1: '¡Hola! ¿Qué quieres tomar?',
        A2: 'Buenos días. ¿Te pongo lo de siempre o quieres ver la carta?',
        default: 'Hola, ¿qué le pongo?'
      }
    }
  },
  {
    id: 'shop',
    title: 'Tienda de Ropa',
    difficulty: ['A1', 'A2'],
    icon: <ShoppingBag className="w-6 h-6" />,
    description: 'Preguntar tallas, precios y probadores.',
    color: 'bg-pink-500',
    vocab: [
      { word: 'Probador', type: 'noun', translation: 'Fitting room' },
      { word: 'Talla M / L', type: 'noun', translation: 'Size M / L' },
      { word: '¿Tiene otro color?', type: 'phrase', translation: 'Do you have another color?' },
      { word: 'Me queda grande', type: 'phrase', translation: 'It is too big for me' },
      { word: 'Es barato / caro', type: 'adjective', translation: 'It is cheap / expensive' },
    ],
    botPersona: {
      name: 'Dependiente',
      initialMessage: {
        A1: 'Hola. ¿Necesitas ayuda con la ropa?',
        A2: 'Hola. Ahora tenemos descuentos en pantalones. ¿Buscas algo específico?',
        default: 'Buenas tardes, dígame.'
      }
    }
  },
  {
    id: 'street_directions',
    title: 'En la Calle',
    difficulty: ['A1', 'A2'],
    icon: <MapPin className="w-6 h-6" />,
    description: 'Preguntar direcciones, ubicaciones y distancias.',
    color: 'bg-cyan-500',
    vocab: [
      { word: 'Perdona / Disculpa', type: 'phrase', translation: 'Excuse me' },
      { word: '¿Dónde está...?', type: 'phrase', translation: 'Where is...?' },
      { word: 'Todo recto', type: 'phrase', translation: 'Straight ahead' },
      { word: 'Gira a la izquierda', type: 'phrase', translation: 'Turn left' },
      { word: 'A la derecha', type: 'phrase', translation: 'To the right' },
    ],
    botPersona: {
      name: 'Peatón',
      initialMessage: {
        A1: 'Hola. ¿Necesitas ayuda? Te veo perdido.',
        A2: 'Hola, perdona. Te veo mirando el mapa con cara de duda. ¿Buscas alguna calle en concreto?',
        default: 'Hola, ¿puedo ayudarte a encontrar algo?'
      }
    }
  },

  // --- NIVEL B1 / B2 (Gestiones y Servicios) ---
  {
    id: 'doctor',
    title: 'Consulta Médica',
    difficulty: ['B1', 'B2'],
    icon: <Stethoscope className="w-6 h-6" />,
    description: 'Describir síntomas, dolor y pedir recetas.',
    color: 'bg-emerald-500',
    vocab: [
      { word: 'Me duele la cabeza', type: 'phrase', translation: 'I have a headache' },
      { word: 'Tengo fiebre', type: 'phrase', translation: 'I have a fever' },
      { word: 'Receta médica', type: 'noun', translation: 'Prescription' },
      { word: 'Estoy mareado', type: 'adjective', translation: 'I feel dizzy' },
    ],
    botPersona: {
      name: 'Doctor',
      initialMessage: {
        B1: 'Buenos días. Siéntese. ¿Qué le pasa hoy?',
        B2: 'Buenos días. Veo en su historial que vino hace un mes. ¿Han persistido los síntomas o es algo nuevo?',
        default: 'Pase, por favor. ¿Qué síntomas tiene?'
      }
    }
  },
  {
    id: 'bank',
    title: 'En el Banco',
    difficulty: ['B1', 'B2'],
    icon: <Landmark className="w-6 h-6" />,
    description: 'Abrir cuentas, tarjetas perdidas y transferencias.',
    color: 'bg-blue-700',
    vocab: [
      { word: 'Abrir una cuenta', type: 'verb', translation: 'To open an account' },
      { word: 'Comisiones', type: 'noun', translation: 'Fees/Commissions' },
      { word: 'He perdido mi tarjeta', type: 'phrase', translation: 'I lost my card' },
      { word: 'Hacer una transferencia', type: 'phrase', translation: 'Make a transfer' },
    ],
    botPersona: {
      name: 'Agente',
      initialMessage: {
        B1: 'Hola. ¿Vienes a ingresar dinero o a hablar con un gestor?',
        B2: 'Buenos días. Para temas de hipotecas o fondos de inversión necesita cita previa. ¿Es para operativa de caja?',
        default: 'Buenos días, ¿en qué puedo ayudarle?'
      }
    }
  },
  {
    id: 'rent',
    title: 'Alquiler de Piso',
    difficulty: ['B1', 'B2'],
    icon: <Key className="w-6 h-6" />,
    description: 'Negociar condiciones, fianza y gastos.',
    color: 'bg-teal-600',
    vocab: [
      { word: 'Fianza', type: 'noun', translation: 'Deposit' },
      { word: 'Gastos incluidos', type: 'phrase', translation: 'Bills included' },
      { word: 'Contrato de alquiler', type: 'noun', translation: 'Lease agreement' },
      { word: 'Amueblado', type: 'adjective', translation: 'Furnished' },
    ],
    botPersona: {
      name: 'Casero',
      initialMessage: {
        B1: 'El piso tiene dos habitaciones. ¿Cuándo quieres verlo?',
        B2: 'El contrato es de un año obligado cumplimiento. ¿Tienes solvencia económica demostrable?',
        default: 'Hola, ¿llamas por el anuncio del piso?'
      }
    }
  },

  // --- NIVEL C1 (Profesional y Complejo) ---
  {
    id: 'job',
    title: 'Entrevista de Trabajo',
    difficulty: ['C1'],
    icon: <Briefcase className="w-6 h-6" />,
    description: 'Experiencia laboral, fortalezas y negociación.',
    color: 'bg-slate-700',
    vocab: [
      { word: 'Experiencia laboral', type: 'noun', translation: 'Work experience' },
      { word: 'Puntos fuertes', type: 'noun', translation: 'Strengths' },
      { word: 'Trabajo en equipo', type: 'noun', translation: 'Teamwork' },
      { word: 'Incorporación inmediata', type: 'phrase', translation: 'Immediate start' },
    ],
    botPersona: {
      name: 'Entrevistador',
      initialMessage: {
        C1: 'Gracias por venir. He revisado su currículum con interés. Hábleme de su última experiencia liderando equipos.',
        default: 'Bienvenido a la entrevista. Cuénteme sobre usted.'
      }
    }
  },
  {
    id: 'police',
    title: 'Comisaría (Denuncia)',
    difficulty: ['C1'],
    icon: <ShieldAlert className="w-6 h-6" />,
    description: 'Reportar robos, describir sospechosos y trámites legales.',
    color: 'bg-indigo-900',
    vocab: [
      { word: 'Poner una denuncia', type: 'phrase', translation: 'To file a report' },
      { word: 'Me han robado', type: 'phrase', translation: 'I have been robbed' },
      { word: 'Cartera / Móvil', type: 'noun', translation: 'Wallet / Phone' },
      { word: 'Testigo', type: 'noun', translation: 'Witness' },
    ],
    botPersona: {
      name: 'Policía',
      initialMessage: {
        C1: 'Buenas tardes. Para tramitar la denuncia necesito una descripción detallada de los hechos cronológicamente.',
        default: 'Siéntese. ¿Viene a denunciar un delito?'
      }
    }
  }
];

// --- COMPONENTS ---

// Helper to safely render content that might be an object
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
              disabled={isPlaying || !apiKey}
              className={`text-xs flex items-center gap-1 transition-colors ${!apiKey ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-indigo-600'}`}
            >
              {isPlaying ? <Loader2 size={12} className="animate-spin" /> : <Volume2 size={12} />}
              <span>Escuchar</span>
            </button>
          )}

          {isUser && isLast && !feedback && apiKey && (
             <button 
             onClick={handleCorrection}
             disabled={isCorrecting}
             className="text-xs text-indigo-500 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded-full flex items-center gap-1 transition-colors border border-indigo-100"
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

const LevelBadge = ({ level, selected, onClick }) => {
  return (
    <button 
      onClick={onClick}
      className={`px-3 py-1.5 md:px-4 md:py-2 rounded-lg text-xs md:text-sm font-medium border transition-all whitespace-nowrap ${
        selected ? 'ring-2 ring-indigo-500 ring-offset-1 shadow-sm scale-105' : 'opacity-70 hover:opacity-100'
      } ${level.color}`}
    >
      {level.label}
    </button>
  );
};

const FeedbackModal = ({ isOpen, onClose, data }) => {
  if (!isOpen || !data) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 animate-in fade-in zoom-in duration-300">
        <div className="text-center mb-6">
          <div className="inline-block p-3 bg-indigo-100 rounded-full mb-3">
            <FileText className="w-8 h-8 text-indigo-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800">Evaluación de la Sesión</h2>
          <p className="text-gray-500">Aquí tienes tu informe de progreso</p>
        </div>

        <div className="flex items-center justify-center gap-4 mb-6">
          <div className="text-center p-4 bg-gray-50 rounded-xl border border-gray-100">
            <div className="text-3xl font-bold text-indigo-600">{data.score}/10</div>
            <div className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Puntuación</div>
          </div>
        </div>

        <div className="space-y-4 mb-6">
          <div>
            <h4 className="text-sm font-bold text-green-700 flex items-center gap-2 mb-2">
              <CheckCircle size={16} /> Lo mejor
            </h4>
            <ul className="text-sm text-gray-600 list-disc list-inside space-y-1 bg-green-50 p-3 rounded-lg">
              {data.goodPoints && data.goodPoints.map((p, i) => <li key={i}><SafeRender content={p} /></li>)}
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-bold text-orange-700 flex items-center gap-2 mb-2">
              <AlertCircle size={16} /> A mejorar
            </h4>
            <ul className="text-sm text-gray-600 list-disc list-inside space-y-1 bg-orange-50 p-3 rounded-lg">
              {data.corrections && data.corrections.map((c, i) => <li key={i}><SafeRender content={c} /></li>)}
            </ul>
          </div>
        </div>

        <div className="bg-indigo-50 p-4 rounded-lg text-sm text-indigo-800 italic text-center mb-6">
          "<SafeRender content={data.comment} />"
        </div>

        <button onClick={onClose} className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors">
          ¡Entendido!
        </button>
      </div>
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
  
  // Custom Scenario State
  const [isCreatingScenario, setIsCreatingScenario] = useState(false);
  const [customTopic, setCustomTopic] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // Feedback State
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackData, setFeedbackData] = useState(null);
  const [isGeneratingFeedback, setIsGeneratingFeedback] = useState(false);

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
    setShowFeedback(false);
    setFeedbackData(null);
    
    // Check if initial message is object (standard) or string (custom)
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

    const userMsg = { id: Date.now(), sender: 'user', text: inputText };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsTyping(true);
    setErrorMsg(null);

    try {
      const response = await callGeminiChat(messages, selectedScenario, selectedLevelId, userMsg.text);
      const botMsg = { id: Date.now() + 1, sender: 'bot', text: response };
      setMessages(prev => [...prev, botMsg]);
    } catch (err) {
      console.error(err);
      setErrorMsg("Error de conexión.");
    } finally {
      setIsTyping(false);
    }
  };

  const handleCreateScenario = async (e) => {
    e.preventDefault();
    if (!customTopic.trim()) return;
    if (!apiKey) {
      alert("Necesitas configurar la API Key en el código para usar esta función.");
      return;
    }

    setIsGenerating(true);
    try {
      const newScenario = await callGeminiScenarioGen(customTopic, selectedLevelId);
      // Post-process to ensure it has correct structure for UI
      newScenario.difficulty = [selectedLevelId]; 
      newScenario.icon = <Sparkles className="w-6 h-6" />; // Default icon for custom
      
      setScenarios(prev => [newScenario, ...prev]);
      setIsCreatingScenario(false);
      setCustomTopic('');
      startChat(newScenario);
    } catch (err) {
      alert("Error al generar el escenario. Inténtalo de nuevo.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleEndSession = async () => {
    if (!apiKey || messages.length < 3) {
      setScreen('home');
      return;
    }
    
    setIsGeneratingFeedback(true);
    const feedback = await callGeminiFeedback(messages, selectedLevelId);
    setFeedbackData(feedback);
    setIsGeneratingFeedback(false);
    if (feedback) setShowFeedback(true);
    else setScreen('home');
  };

  const handleCorrectionRequest = async (text) => {
    return await callGeminiCorrection(text, selectedLevelId);
  };

  // Restored function
  const handleVocabSelect = (word) => {
    setInputText(prev => prev + (prev ? ' ' : '') + word);
  };

  // --- RENDER: HOME SCREEN ---
  if (screen === 'home') {
    return (
      <div className="min-h-screen bg-gray-50 font-sans">
        {/* Scenario Creator Modal */}
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
                    disabled={isGenerating || !customTopic}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg flex items-center gap-2 disabled:opacity-50"
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
                <span className="text-xs text-indigo-600 font-medium">Práctica de Español</span>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              {!apiKey && (
                <div className="hidden sm:flex items-center gap-2 text-xs text-amber-600 bg-amber-50 px-3 py-1 rounded-full border border-amber-200">
                   <ZapOff size={12} />
                   <span>Modo Demo</span>
                </div>
              )}
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
              {/* Create New Card */}
              <div 
                onClick={() => setIsCreatingScenario(true)}
                className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-md border-0 overflow-hidden cursor-pointer transition-all hover:-translate-y-1 hover:shadow-lg flex flex-col items-center justify-center text-white p-6 group min-h-[200px]"
              >
                <div className="bg-white/20 p-4 rounded-full mb-4 group-hover:scale-110 transition-transform">
                  <Plus size={32} />
                </div>
                <h3 className="font-bold text-lg text-center">Crear Situación</h3>
                <p className="text-indigo-100 text-xs text-center mt-2">¿No encuentras lo que buscas?<br/>Créalo con IA.</p>
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

  // --- RENDER: CHAT SCREEN ---
  return (
    <div className="h-screen bg-gray-100 flex flex-col md:flex-row overflow-hidden font-sans">
      <FeedbackModal isOpen={showFeedback} onClose={() => setScreen('home')} data={feedbackData} />
      
      {/* Loading Overlay for Feedback */}
      {isGeneratingFeedback && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex flex-col items-center justify-center z-50 text-white">
          <Loader2 className="w-12 h-12 animate-spin mb-4" />
          <p className="font-bold text-lg">Analizando conversación...</p>
        </div>
      )}

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col h-full relative z-0">
        <header className="bg-white px-4 py-3 border-b flex items-center justify-between shrink-0 shadow-sm z-10">
          <div className="flex items-center gap-3">
            <button onClick={() => setScreen('home')} className="p-2 hover:bg-gray-100 rounded-full text-gray-600 transition-colors">
              <ArrowLeft size={20} />
            </button>
            <div>
              <h2 className="font-bold text-gray-800 leading-tight text-sm md:text-base">{selectedScenario.title}</h2>
              <div className="text-xs text-gray-500">Nivel {selectedLevelId}</div>
            </div>
          </div>
          
          <div className="flex gap-2">
            <button 
              onClick={handleEndSession}
              className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-bold hover:bg-red-100 transition-colors flex items-center gap-1"
            >
              <X size={14} /> Finalizar
            </button>
            <button 
              onClick={() => setIsVocabOpen(!isVocabOpen)}
              className={`p-2 rounded-lg flex items-center gap-2 transition-colors ${isVocabOpen ? 'bg-indigo-100 text-indigo-700' : 'hover:bg-gray-100 text-gray-600'}`}
            >
              <BookOpen size={20} />
              <span className="hidden sm:inline font-medium text-sm">Léxico</span>
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

      {/* Vocabulary Sidebar */}
      <div className={`fixed inset-y-0 right-0 w-80 bg-white border-l shadow-2xl transform transition-transform duration-300 ease-in-out z-20 md:relative md:transform-none md:shadow-none ${
        isVocabOpen ? 'translate-x-0' : 'translate-x-full md:hidden'
      }`}>
        <div className="h-full flex flex-col">
          <div className="p-4 border-b flex items-center justify-between bg-gray-50">
            <div className="flex items-center gap-2 text-gray-800 font-semibold">
              <BookOpen size={18} className="text-indigo-600" />
              <h3>Ayuda</h3>
            </div>
            <button onClick={() => setIsVocabOpen(false)} className="md:hidden text-gray-500 hover:bg-gray-200 rounded p-1">
              <X size={20} />
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4">
            <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 mb-4 text-xs text-indigo-800 flex items-start gap-2">
              <Info size={14} className="mt-0.5 shrink-0" />
              <p>Nivel {selectedLevelId}: Usa estas frases.</p>
            </div>
            
            {selectedScenario?.vocab.map((item, index) => (
              <VocabularyItem key={index} item={item} onSelect={handleVocabSelect} />
            ))}
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
