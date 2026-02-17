
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Message, ChatSession, VoiceState } from './types';
import { decode, decodeRawPcm, createPcmBlob } from './utils/audio';

/** 
 * MASTER GLOBAL SIGNAL GATEWAY
 * Hardcode your keys here to enable them globally across all devices/browsers.
 */
const GLOBAL_KEYS = {
  OPENROUTER_KEY: "", 
  SERPER_KEY: "",     
  TAVILY_KEY: ""      
};

const STORAGE_KEY = 'gemini_ultra_pro_v14';
const SETTINGS_KEY = 'ultra_settings_v14';
const VAULT_KEY = 'secure_matrix_config_v14';

interface OpenRouterModel {
  id: string;
  name: string;
  pricing: {
    prompt: string;
    completion: string;
  };
  context_length: number;
}

const App: React.FC = () => {
  // --- STATE ---
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  });
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  
  const [voiceState, setVoiceState] = useState<VoiceState>(VoiceState.IDLE);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isThinking, setIsThinking] = useState(false);
  const [isResearching, setIsResearching] = useState(false);
  
  const [vaultOpen, setVaultOpen] = useState(false);
  const [vaultLocked, setVaultLocked] = useState(true);
  const [vaultPassword, setVaultPassword] = useState('');
  
  const [allModels, setAllModels] = useState<OpenRouterModel[]>([]);
  const [modelSearch, setModelSearch] = useState('');
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  const [vaultConfig, setVaultConfig] = useState(() => {
    const saved = localStorage.getItem(VAULT_KEY);
    const local = saved ? JSON.parse(saved) : { 
      openRouterKey: '',
      serperKey: '',
      tavilyKey: '',
      selectedModel: 'google/gemini-2.0-flash-001',
      researchMode: true,
      voiceName: '', 
      pitch: 1.0, 
      rate: 1.1,
    };
    return {
      ...local,
      openRouterKey: local.openRouterKey || GLOBAL_KEYS.OPENROUTER_KEY,
      serperKey: local.serperKey || GLOBAL_KEYS.SERPER_KEY,
      tavilyKey: local.tavilyKey || GLOBAL_KEYS.TAVILY_KEY,
    };
  });

  const [autoVoiceEnabled, setAutoVoiceEnabled] = useState(() => {
    const saved = localStorage.getItem(SETTINGS_KEY);
    const data = saved ? JSON.parse(saved) : { autoVoice: true };
    return data.autoVoice ?? true;
  });

  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);

  // --- REFS ---
  const recognitionRef = useRef<any>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const transcriptBufferRef = useRef<string>('');

  // --- DERIVED ---
  const activeSession = useMemo(() => 
    sessions.find(s => s.id === currentSessionId), 
  [sessions, currentSessionId]);

  const filteredModels = useMemo(() => {
    return allModels.filter(m => 
      m.name.toLowerCase().includes(modelSearch.toLowerCase()) || 
      m.id.toLowerCase().includes(modelSearch.toLowerCase())
    ).sort((a, b) => {
      const aFree = parseFloat(a.pricing.prompt) === 0;
      const bFree = parseFloat(b.pricing.prompt) === 0;
      if (aFree && !bFree) return -1;
      if (!aFree && bFree) return 1;
      return 0;
    }).slice(0, 80);
  }, [allModels, modelSearch]);

  const isConfigured = !!(vaultConfig.openRouterKey || GLOBAL_KEYS.OPENROUTER_KEY);

  // --- LIFECYCLE ---
  useEffect(() => {
    const fetchModels = async () => {
      setIsLoadingModels(true);
      try {
        const response = await fetch("https://openrouter.ai/api/v1/models");
        const json = await response.json();
        if (json.data) setAllModels(json.data);
      } catch (e) { console.error("Models failed:", e); }
      finally { setIsLoadingModels(false); }
    };
    fetchModels();
  }, []);

  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      setAvailableVoices(voices);
      if (!vaultConfig.voiceName && voices.length > 0) {
        const defaultVoice = voices.find(v => v.lang.startsWith('en')) || voices[0];
        setVaultConfig(prev => ({ ...prev, voiceName: defaultVoice.name }));
      }
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, [vaultConfig.voiceName]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    localStorage.setItem(VAULT_KEY, JSON.stringify(vaultConfig));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ autoVoice: autoVoiceEnabled }));
  }, [vaultConfig, autoVoiceEnabled]);

  // --- CORE LOGIC ---
  const handleVaultUnlock = () => {
    if (vaultPassword.trim() === 'Moneynow234$#') {
      setVaultLocked(false);
      setVaultPassword('');
    } else {
      alert("SIGNAL INVALID.");
      setVaultPassword('');
    }
  };

  const stopAllAudio = () => {
    window.speechSynthesis.cancel();
    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();
  };

  const speakTextWebSpeech = (text: string) => {
    if (!autoVoiceEnabled) return Promise.resolve();
    return new Promise<void>((resolve) => {
      window.speechSynthesis.cancel();
      const cleanText = text.replace(/[*_#`~]/g, '').replace(/\[.*?\]/g, '');
      const utterance = new SpeechSynthesisUtterance(cleanText);
      const selectedVoice = availableVoices.find(v => v.name === vaultConfig.voiceName);
      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.pitch = vaultConfig.pitch;
      utterance.rate = vaultConfig.rate;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
    });
  };

  const performResearch = async (query: string) => {
    const keySerper = vaultConfig.serperKey || GLOBAL_KEYS.SERPER_KEY;
    const keyTavily = vaultConfig.tavilyKey || GLOBAL_KEYS.TAVILY_KEY;
    let searchData = "";
    if (keySerper) {
      setIsResearching(true);
      try {
        const res = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: { "X-API-KEY": keySerper, "Content-Type": "application/json" },
          body: JSON.stringify({ q: query })
        });
        const json = await res.json();
        const snippets = json.organic?.slice(0, 4).map((o: any, i: number) => `Source ${i+1}: ${o.title} - ${o.snippet}`).join("\n");
        if (snippets) searchData += `\nWEB CONTEXT:\n${snippets}\n`;
      } catch (e) { console.error("Search Error:", e); }
      finally { setIsResearching(false); }
    }
    if (keyTavily) {
      setIsResearching(true);
      try {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: keyTavily, query, search_depth: "advanced", max_results: 2 })
        });
        const json = await res.json();
        const content = json.results?.map((r: any) => `Synthesis Node (${r.title}): ${r.content}`).join("\n");
        if (content) searchData += `\nDEEP CONTEXT:\n${content}\n`;
      } catch (e) { console.error("Tavily Error:", e); }
      finally { setIsResearching(false); }
    }
    return searchData;
  };

  const handleSendText = async (overrideText?: string) => {
    const textToProcess = overrideText !== undefined ? overrideText : inputText;
    if (!textToProcess.trim() || isThinking) return;
    setInputText('');
    setIsThinking(true);
    stopAllAudio();
    addMessageToCurrentSession(textToProcess, '');
    try {
      let finalResponse = "";
      const keyOR = vaultConfig.openRouterKey || GLOBAL_KEYS.OPENROUTER_KEY;
      let research = vaultConfig.researchMode ? await performResearch(textToProcess) : "";
      if (keyOR) {
        finalResponse = await callOpenRouter(textToProcess, research);
      } else {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = research ? `CONTEXT:\n${research}\n\nUSER COMMAND: ${textToProcess}` : textToProcess;
        const response = await ai.models.generateContent({
          model: 'gemini-3-pro-preview',
          contents: prompt,
          config: { thinkingConfig: { thinkingBudget: 4000 } }
        });
        finalResponse = response.text || "Output failed.";
      }
      addMessageToCurrentSession('', finalResponse);
      setIsThinking(false);
      await speakTextWebSpeech(finalResponse);
    } catch (err: any) {
      addMessageToCurrentSession('', `SYSTEM ALERT: ${err.message}`);
      setIsThinking(false);
    }
  };

  const callOpenRouter = async (prompt: string, context: string = "") => {
    const keyOR = vaultConfig.openRouterKey || GLOBAL_KEYS.OPENROUTER_KEY;
    if (!keyOR) throw new Error("Matrix configuration required.");
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${keyOR}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: vaultConfig.selectedModel,
        messages: [
          { role: "system", content: "You are an elite level neural assistant." },
          { role: "user", content: context ? `CONTEXT:\n${context}\n\nUSER:${prompt}` : prompt }
        ]
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.choices?.[0]?.message?.content || "No Synthesis Output.";
  };

  const addMessageToCurrentSession = (userText: string, assistantText: string) => {
    setSessions(prev => {
      let targetId = currentSessionId;
      let newSessions = [...prev];
      if (!targetId) {
        targetId = crypto.randomUUID();
        const newS: ChatSession = { id: targetId, title: userText.slice(0, 30) || 'Neural Synthesis', messages: [], updatedAt: Date.now() };
        newSessions = [newS, ...newSessions];
        setCurrentSessionId(targetId);
      }
      return newSessions.map(s => {
        if (s.id === targetId) {
          const msgs = [...s.messages];
          if (userText) msgs.push({ id: crypto.randomUUID(), role: 'user', content: userText, timestamp: Date.now() });
          if (assistantText) msgs.push({ id: crypto.randomUUID(), role: 'assistant', content: assistantText, timestamp: Date.now() });
          return { ...s, messages: msgs, updatedAt: Date.now(), title: s.messages.length === 0 && userText ? userText.slice(0, 30) : s.title };
        }
        return s;
      });
    });
  };

  const startNewSession = () => {
    const id = crypto.randomUUID();
    setSessions(prev => [{ id, title: 'Neural Entry', messages: [], updatedAt: Date.now() }, ...prev]);
    setCurrentSessionId(id);
    stopAllAudio();
    setInputText('');
  };

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessions(prev => prev.filter(s => s.id !== id));
    if (currentSessionId === id) setCurrentSessionId(null);
  };

  const toggleSpeechRecognition = () => {
    if (voiceState === VoiceState.LISTENING) {
      recognitionRef.current?.stop();
      setVoiceState(VoiceState.IDLE);
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return alert("System does not support vocal matrix capture.");
    stopAllAudio();
    transcriptBufferRef.current = '';
    setInputText('');
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onstart = () => setVoiceState(VoiceState.LISTENING);
    recognition.onresult = (event: any) => {
      let interim = '';
      let currentFinal = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) currentFinal += event.results[i][0].transcript;
        else interim += event.results[i][0].transcript;
      }
      if (currentFinal) transcriptBufferRef.current += currentFinal + ' ';
      setInputText((transcriptBufferRef.current + interim).trim());
    };
    recognition.onerror = () => setVoiceState(VoiceState.IDLE);
    recognition.onend = () => setVoiceState(VoiceState.IDLE);
    recognitionRef.current = recognition;
    recognition.start();
  };

  return (
    <div className="flex h-screen w-full bg-[#010101] text-zinc-100 overflow-hidden font-sans selection:bg-[#24A1DE]/40">
      
      {/* SIDEBAR */}
      <aside className={`glass border-r border-white/5 flex flex-col transition-all duration-500 z-30 ${isSidebarOpen ? 'w-80' : 'w-0 overflow-hidden'}`}>
        <div className="p-8 flex items-center justify-between">
          <div className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#24A1DE] to-indigo-800 flex items-center justify-center shadow-2xl transition-transform duration-700 group-hover:rotate-[360deg]">
              <i className="fa-solid fa-atom text-white text-base"></i>
            </div>
            <h1 className="text-xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-600">Ultra Pro</h1>
          </div>
          <button onClick={startNewSession} className="p-2.5 hover:bg-white/5 rounded-xl transition-all hover:scale-110 active:scale-90 text-zinc-700 hover:text-white">
            <i className="fa-solid fa-plus-large"></i>
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto px-4 space-y-2 custom-scroll">
          {sessions.map(s => (
            <div key={s.id} onClick={() => setCurrentSessionId(s.id)} className={`p-4 rounded-[1.4rem] cursor-pointer flex items-center justify-between group transition-all duration-300 border ${currentSessionId === s.id ? 'bg-white/10 border-white/10 shadow-xl scale-[1.02]' : 'hover:bg-white/5 border-transparent'}`}>
              <div className="flex flex-col overflow-hidden">
                <span className="truncate text-[13px] font-bold tracking-tight">{s.title}</span>
                <span className="text-[9px] text-zinc-800 font-black tracking-widest uppercase mt-1">
                  {new Date(s.updatedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </span>
              </div>
              <button onClick={(e) => deleteSession(s.id, e)} className="opacity-0 group-hover:opacity-100 p-2 hover:text-red-500 transition-all">
                <i className="fa-solid fa-trash-can text-[10px]"></i>
              </button>
            </div>
          ))}
        </div>

        <div className="p-8 border-t border-white/5 space-y-6 bg-black/40">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="block text-[9px] font-black text-zinc-700 uppercase tracking-widest">Global Link</span>
              <span className="text-[8px] text-zinc-800 font-bold uppercase tracking-widest italic">Research Sync</span>
            </div>
            <button onClick={() => setVaultConfig({ ...vaultConfig, researchMode: !vaultConfig.researchMode })} className={`w-10 h-5.5 rounded-full relative transition-all duration-500 ${vaultConfig.researchMode ? 'bg-[#24A1DE] shadow-[0_0_15px_rgba(36,161,222,0.4)]' : 'bg-zinc-900'}`}>
              <div className={`absolute top-0.75 w-4 h-4 bg-white rounded-full transition-all duration-300 ${vaultConfig.researchMode ? 'left-5.25' : 'left-0.75'}`} />
            </button>
          </div>

          <button onClick={() => setVaultOpen(true)} className={`w-full py-4 rounded-[1.5rem] border transition-all text-[10px] font-black uppercase tracking-[0.3em] flex items-center justify-center gap-3 ${isConfigured ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400/80' : 'bg-white/5 border-white/5 text-zinc-600 hover:bg-white/10'}`}>
            <i className="fa-solid fa-microchip"></i>
            Core Protocol
          </button>
        </div>
      </aside>

      {/* MAIN VIEW */}
      <main className="flex-1 flex flex-col relative h-full">
        <header className="h-20 flex items-center justify-between px-10 border-b border-white/5 glass z-20">
          <div className="flex items-center gap-8">
            <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-3 hover:bg-white/5 rounded-2xl text-zinc-700 transition-all active:scale-90">
              <i className={`fa-solid ${isSidebarOpen ? 'fa-indent' : 'fa-outdent'} text-lg`}></i>
            </button>
            <div className="flex items-center gap-6">
              <h2 className="font-black text-base text-zinc-100 truncate max-w-[200px] md:max-w-md">
                {activeSession?.title || 'Nexus Signal'}
              </h2>
              
              {/* VOCAL SYNTH TOGGLE */}
              <div 
                className={`h-10 px-5 flex items-center gap-3 rounded-full border transition-all duration-500 cursor-pointer select-none group ${autoVoiceEnabled ? 'bg-cyan-500/10 border-cyan-500/30 shadow-[0_0_20px_rgba(6,182,212,0.2)]' : 'bg-zinc-800/20 border-white/5'}`} 
                onClick={() => setAutoVoiceEnabled(!autoVoiceEnabled)}
              >
                <span className={`text-[9px] font-black uppercase tracking-[0.2em] transition-colors ${autoVoiceEnabled ? 'text-cyan-400' : 'text-zinc-700 group-hover:text-zinc-500'}`}>
                  Vocal Synth {autoVoiceEnabled ? 'ON' : 'OFF'}
                </span>
                <div className={`w-9 h-5 rounded-full relative transition-all duration-500 ${autoVoiceEnabled ? 'bg-cyan-500' : 'bg-zinc-800'}`}>
                  <div className={`absolute top-0.75 w-3.5 h-3.5 bg-white rounded-full transition-all duration-300 ${autoVoiceEnabled ? 'left-4.5' : 'left-0.75'}`} />
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-12 space-y-12 flex flex-col items-center custom-scroll pb-64">
          {activeSession && activeSession.messages.length > 0 ? (
            <div className="w-full max-w-4xl space-y-14">
              {activeSession.messages.map(m => (
                <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} group animate-in slide-in-from-bottom-6 duration-700`}>
                  <div className="flex flex-col max-w-[90%] gap-4">
                    <div className={`px-7 py-6 rounded-[2.5rem] shadow-2xl transition-all leading-relaxed ${m.role === 'user' ? 'bg-[#24A1DE] text-white rounded-tr-none' : 'glass border border-white/10 text-zinc-200 rounded-tl-none backdrop-blur-3xl'}`}>
                      <p className="text-[16px] whitespace-pre-wrap leading-relaxed">{m.content}</p>
                    </div>
                  </div>
                </div>
              ))}
              {(isThinking || isResearching) && (
                <div className="flex justify-start">
                  <div className="glass border border-white/5 px-8 py-6 rounded-[2.5rem] flex items-center gap-6 animate-pulse shadow-2xl">
                    <i className="fa-solid fa-atom-simple animate-spin-slow text-2xl text-[#24A1DE]"></i>
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.4em]">Signal Processing</span>
                      <span className="text-[9px] text-zinc-800 font-black uppercase tracking-widest mt-1">Deep Logic Synthesis...</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-xl px-10 pt-24 animate-in fade-in zoom-in duration-1000">
              <div className="w-32 h-32 rounded-[3.5rem] bg-gradient-to-tr from-[#24A1DE] to-indigo-900 flex items-center justify-center shadow-[0_25px_60px_rgba(36,161,222,0.2)] relative animate-float mb-16 border border-white/5">
                <i className="fa-solid fa-brain-circuit text-6xl text-white"></i>
              </div>
              <h3 className="text-6xl font-black mb-8 tracking-tighter text-white">Neural Nexus</h3>
              <p className="text-zinc-800 text-xl mb-12 leading-relaxed font-medium">Capture vocal outcome or initiate synthesis for global intelligence node.</p>
            </div>
          )}
        </div>

        {/* INPUT AREA */}
        <div className="p-10 pt-0 w-full flex justify-center absolute bottom-0 z-20 pointer-events-auto">
          <div className={`w-full max-w-4xl bg-[#0b0f14]/98 backdrop-blur-3xl p-2 rounded-[3rem] flex items-center gap-2 shadow-[0_40px_100px_rgba(0,0,0,0.95)] border transition-all duration-500 ${voiceState === VoiceState.LISTENING ? 'border-cyan-500/50 ring-[8px] ring-cyan-500/5 shadow-[0_0_40px_rgba(6,182,212,0.3)]' : 'border-white/5'}`}>
            <button 
              onClick={toggleSpeechRecognition} 
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${voiceState === VoiceState.IDLE ? 'text-zinc-700 hover:text-white hover:bg-white/5' : 'bg-red-500 text-white shadow-3xl animate-pulse ring-6 ring-red-500/15 scale-110'}`}
              title={voiceState === VoiceState.LISTENING ? "Stop Capture" : "Capture Intel"}
            >
              <i className={`fa-solid ${voiceState === VoiceState.IDLE ? 'fa-microphone' : 'fa-stop'} text-xl`}></i>
            </button>
            <div className="flex-1 min-w-0 px-5">
              <input 
                type="text" 
                value={inputText} 
                onChange={(e) => setInputText(e.target.value)} 
                onKeyDown={(e) => e.key === 'Enter' && handleSendText()} 
                placeholder={voiceState === VoiceState.LISTENING ? "Processing capture..." : "Synthesize neural protocol..."} 
                className={`w-full bg-transparent border-none outline-none text-zinc-100 placeholder:text-zinc-900 h-14 text-[18px] font-medium transition-opacity ${voiceState === VoiceState.LISTENING ? 'opacity-90' : 'opacity-100'}`} 
              />
            </div>
            <button 
              onClick={() => handleSendText()} 
              disabled={!inputText.trim() || isThinking || voiceState === VoiceState.LISTENING} 
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all duration-500 transform active:scale-90 ${inputText.trim() && !isThinking && voiceState !== VoiceState.LISTENING ? 'bg-[#24A1DE] text-white shadow-2xl hover:brightness-125' : 'text-zinc-900 bg-white/5 grayscale opacity-10 pointer-events-none'}`}
            >
              {isThinking ? <i className="fa-solid fa-spinner-third animate-spin text-xl"></i> : <i className="fa-solid fa-paper-plane text-xl rotate-[12deg] -translate-x-0.5 -translate-y-0.5"></i>}
            </button>
          </div>
        </div>

        {/* VAULT MODAL */}
        {vaultOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-10 bg-black/98 backdrop-blur-3xl animate-in fade-in duration-500">
            <div className="w-full max-w-7xl glass rounded-[4rem] border border-white/10 overflow-hidden shadow-2xl flex flex-col h-[90vh]">
              <div className="p-12 border-b border-white/5 flex items-center justify-between bg-white/[0.01]">
                <div className="flex items-center gap-8">
                  <div className="w-16 h-16 rounded-[1.5rem] bg-white/5 flex items-center justify-center border border-white/5 shadow-inner">
                    <i className="fa-solid fa-shield-keyhole text-[#24A1DE] text-4xl shadow-blue-500/50"></i>
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-[14px] text-white font-black uppercase tracking-[0.6em]">Secure logic vault</span>
                    <span className="text-[9px] text-zinc-700 font-black uppercase tracking-[0.4em] italic">Authorized Signal Matrix</span>
                  </div>
                </div>
                <button onClick={() => { setVaultOpen(false); setVaultLocked(true); setVaultPassword(''); }} className="text-zinc-700 hover:text-white transition-all transform hover:rotate-90 p-4">
                  <i className="fa-solid fa-xmark text-4xl"></i>
                </button>
              </div>

              <div className="flex-1 overflow-hidden">
                {vaultLocked ? (
                  /* COMPACT PASSWORD AREA */
                  <div className="h-full flex flex-col items-center justify-center space-y-8 max-w-xs mx-auto animate-in zoom-in-95 duration-500">
                    <div className="text-center space-y-2">
                      <div className="w-20 h-20 rounded-full bg-red-500/5 border border-red-500/10 flex items-center justify-center mx-auto mb-4 group shadow-inner">
                        <i className="fa-solid fa-lock-keyhole text-red-500 text-4xl opacity-20 group-hover:opacity-100 transition-opacity"></i>
                      </div>
                      <h4 className="text-2xl font-black tracking-tighter text-white uppercase tracking-widest">Gateway</h4>
                    </div>
                    <div className="w-full space-y-4">
                      <input 
                        type="password" 
                        value={vaultPassword} 
                        onChange={(e) => setVaultPassword(e.target.value)} 
                        placeholder="••••••••" 
                        className="w-full bg-white/5 border border-white/10 rounded-2xl p-5 text-center text-3xl outline-none focus:border-blue-500/30 transition-all font-mono tracking-widest text-white shadow-inner" 
                        onKeyDown={(e) => e.key === 'Enter' && handleVaultUnlock()} 
                        autoFocus
                      />
                      <button onClick={handleVaultUnlock} className="w-full bg-[#24A1DE] text-white font-black py-5 rounded-2xl transition-all shadow-xl uppercase tracking-[0.4em] text-sm hover:brightness-110 active:scale-95">Verify</button>
                    </div>
                  </div>
                ) : (
                  <div className="h-full grid grid-cols-1 lg:grid-cols-2 p-12 gap-20 overflow-y-auto custom-scroll animate-in slide-in-from-bottom-20 pb-32">
                    {/* LEFT PANEL */}
                    <div className="space-y-16">
                      <div className="space-y-10">
                        <div className="flex items-center gap-5">
                           <i className="fa-solid fa-satellite-dish text-[#24A1DE] text-2xl"></i>
                           <label className="text-[12px] font-black text-white uppercase tracking-[0.5em]">Global signal pipelines</label>
                        </div>
                        <div className="space-y-8">
                          {['OpenRouter', 'Serper', 'Tavily'].map((key) => (
                            <div key={key} className="space-y-3">
                              <label className="text-[9px] font-black uppercase text-zinc-700 tracking-[0.3em] ml-2">{key} AI Master Signal</label>
                              <div className="relative group">
                                <i className="fa-solid fa-brain-circuit absolute left-7 top-1/2 -translate-y-1/2 text-zinc-900 group-focus-within:text-[#24A1DE] transition-all text-xl"></i>
                                <input 
                                  type="password" 
                                  value={vaultConfig[key.toLowerCase() + 'Key']}
                                  onChange={(e) => setVaultConfig({ ...vaultConfig, [key.toLowerCase() + 'Key']: e.target.value })}
                                  placeholder={`${key} Key Node...`}
                                  className="w-full bg-black/60 border border-white/10 rounded-2xl py-6 pl-18 pr-7 text-sm outline-none focus:border-[#24A1DE]/40 transition-all shadow-inner font-mono text-zinc-500"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-12 pt-12 border-t border-white/5">
                        <div className="flex items-center gap-5">
                           <i className="fa-solid fa-microphone-lines text-pink-500 text-2xl"></i>
                           <label className="text-[12px] font-black text-white uppercase tracking-[0.5em]">Vocal modulation</label>
                        </div>
                        <div className="space-y-8">
                          <div className="space-y-4">
                            <label className="text-[9px] font-black text-zinc-700 uppercase tracking-widest ml-2">Active Synthesis Node</label>
                            <div className="relative">
                              <select 
                                value={vaultConfig.voiceName} 
                                onChange={(e) => setVaultConfig({ ...vaultConfig, voiceName: e.target.value })} 
                                className="w-full bg-black/70 border border-white/10 rounded-2xl p-6 text-sm focus:border-pink-500/40 outline-none appearance-none cursor-pointer hover:bg-black/90 transition-all font-bold text-zinc-300"
                              >
                                {availableVoices.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
                              </select>
                              <i className="fa-solid fa-chevron-down absolute right-7 top-1/2 -translate-y-1/2 text-zinc-800 pointer-events-none"></i>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* RIGHT PANEL - COMPACT MODEL LIST */}
                    <div className="flex flex-col h-full space-y-10">
                      <div className="flex items-center justify-between">
                         <div className="flex items-center gap-5">
                            <i className="fa-solid fa-layer-group text-blue-500 text-2xl"></i>
                            <label className="text-[12px] font-black text-white uppercase tracking-[0.5em]">Intelligence Matrix</label>
                         </div>
                      </div>
                      <div className="relative">
                        <i className="fa-solid fa-filter absolute left-7 top-1/2 -translate-y-1/2 text-zinc-900 text-xl"></i>
                        <input 
                          type="text" 
                          placeholder="Filter Logic..." 
                          value={modelSearch}
                          onChange={(e) => setModelSearch(e.target.value)}
                          className="w-full bg-black/70 border border-white/10 rounded-[2.5rem] py-7 pl-18 pr-8 text-sm outline-none focus:border-blue-500/40 transition-all shadow-inner text-zinc-300"
                        />
                      </div>
                      <div className="flex-1 min-h-[500px] grid grid-cols-1 md:grid-cols-2 gap-4 border border-white/5 rounded-[3.5rem] bg-black/40 p-8 overflow-y-auto custom-scroll shadow-inner">
                        {isLoadingModels && <div className="col-span-2 py-20 text-center"><i className="fa-solid fa-atom animate-spin text-blue-500 text-6xl opacity-10"></i></div>}
                        {filteredModels.map(m => {
                          const isSelected = vaultConfig.selectedModel === m.id;
                          const isFree = parseFloat(m.pricing.prompt) === 0;
                          return (
                            <button 
                              key={m.id} 
                              onClick={() => setVaultConfig({ ...vaultConfig, selectedModel: m.id })} 
                              className={`p-6 rounded-[2.5rem] border flex flex-col justify-center text-left transition-all active:scale-[0.97] h-28 relative ${isSelected ? 'border-blue-500/50 bg-blue-500/10 shadow-[0_0_40px_rgba(59,130,246,0.1)]' : 'border-transparent hover:bg-white/5'}`}
                            >
                              <div className="flex flex-col gap-1 overflow-hidden">
                                <span className={`text-[12px] font-black truncate tracking-tight transition-colors ${isSelected ? 'text-blue-400' : 'text-zinc-600 group-hover:text-zinc-200'}`}>{m.name}</span>
                                <span className="text-[9px] font-mono text-zinc-800 truncate uppercase tracking-tighter">{m.id.split('/')[1] || m.id}</span>
                                {isFree && (
                                  <div className="mt-2 flex">
                                    <span className="text-[8px] bg-emerald-500 text-emerald-950 px-3 py-1 rounded-full font-black uppercase tracking-[0.2em] animate-pulse-fast border border-emerald-400/40 shadow-[0_0_15px_rgba(16,185,129,0.4)]">
                                      FREE
                                    </span>
                                  </div>
                                )}
                              </div>
                              {isSelected && <i className="fa-solid fa-check-circle text-blue-500 text-2xl absolute top-6 right-6 shadow-blue-500/50"></i>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
      
      <style>{`
        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-30px); } }
        @keyframes pulse-fast { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.8; transform: scale(0.97); } }
        .animate-float { animation: float 12s ease-in-out infinite; }
        .animate-pulse-fast { animation: pulse-fast 1.4s ease-in-out infinite; }
        .animate-spin-slow { animation: spin 18s linear infinite; }
        .custom-scroll::-webkit-scrollbar { width: 4px; }
        .custom-scroll::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.04); border-radius: 40px; }
        .shadow-3xl { shadow: 0 40px 100px -25px rgba(0, 0, 0, 1); }
      `}</style>
    </div>
  );
};

export default App;
