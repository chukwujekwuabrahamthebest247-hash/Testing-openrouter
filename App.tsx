import React, { useState, useEffect, useRef, useMemo } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Message, ChatSession, VoiceState } from './types';

const STORAGE_KEY = 'gemini_ultra_pro_v14';
const VAULT_KEY = 'secure_matrix_config_v14';

const App: React.FC = () => {
  // --- 1. STATE ---
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  });
  
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isResearching, setIsResearching] = useState(false);

  // VAULT SECURITY STATES
  const [vaultLocked, setVaultLocked] = useState(true);
  const [vaultPassword, setVaultPassword] = useState('');

  // KEY SPACES (Loaded from LocalStorage)
  const [vaultConfig, setVaultConfig] = useState(() => {
    const saved = localStorage.getItem(VAULT_KEY);
    return saved ? JSON.parse(saved) : { 
      openRouterKey: '',
      serperKey: '',
      tavilyKey: '',
      selectedModel: 'google/gemini-2.0-flash-001',
      researchMode: true
    };
  });

  // --- 2. PERSISTENCE ---
  useEffect(() => {
    localStorage.setItem(VAULT_KEY, JSON.stringify(vaultConfig));
  }, [vaultConfig]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }, [sessions]);

  // --- 3. VAULT SECURITY LOGIC ---
  const handleVaultUnlock = () => {
    if (vaultPassword === 'Moneynow234$#') {
      setVaultLocked(false);
      setVaultPassword('');
    } else {
      alert("SIGNAL INVALID. ACCESS DENIED.");
      setVaultPassword('');
    }
  };

  // --- 4. RESEARCH LOGIC (Uses Serper/Tavily Spaces) ---
  const performResearch = async (query: string) => {
    const { serperKey, tavilyKey } = vaultConfig;
    let searchContext = "";

    if (serperKey) {
      setIsResearching(true);
      try {
        const res = await fetch("https://google.serper.dev", {
          method: "POST",
          headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
          body: JSON.stringify({ q: query })
        });
        const json = await res.json();
        searchContext += "\n[SERPER]: " + json.organic?.slice(0, 2).map((o: any) => o.snippet).join(" ");
      } catch (e) { console.error(e); }
    }

    if (tavilyKey) {
      setIsResearching(true);
      try {
        const res = await fetch("https://api.tavily.com", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: tavilyKey, query, search_depth: "advanced" })
        });
        const json = await res.json();
        searchContext += "\n[TAVILY]: " + json.results?.slice(0, 2).map((r: any) => r.content).join(" ");
      } catch (e) { console.error(e); }
    }

    setIsResearching(false);
    return searchContext;
  };

  // --- 5. CHAT LOGIC (Uses OpenRouter Space) ---
  const handleSendText = async () => {
    if (!inputText.trim() || isThinking) return;

    const { openRouterKey, selectedModel, researchMode } = vaultConfig;

    if (!openRouterKey) {
      alert("SYSTEM ALERT: OpenRouter Key is missing. Unlock the Vault to set it.");
      return;
    }

    setIsThinking(true);
    const userMsg = inputText;
    setInputText('');

    const tempId = currentSessionId || Date.now().toString();
    if (!currentSessionId) setCurrentSessionId(tempId);

    try {
      const context = researchMode ? await performResearch(userMsg) : "";

      const response = await fetch("https://openrouter.ai", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openRouterKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [{ role: "user", content: context + "\n\n" + userMsg }]
        })
      });

      const data = await response.json();
      const aiMsg = data.choices[0].message.content;

      setSessions(prev => {
        const existing = prev.find(s => s.id === tempId);
        const newMsgs = [
          { role: 'user', content: userMsg, timestamp: Date.now() },
          { role: 'assistant', content: aiMsg, timestamp: Date.now() }
        ];
        if (!existing) return [{ id: tempId, title: userMsg.slice(0, 15), messages: newMsgs, lastTimestamp: Date.now() }, ...prev];
        return prev.map(s => s.id === tempId ? { ...s, messages: [...s.messages, ...newMsgs] } : s);
      });

    } catch (e) {
      alert("SIGNAL ERROR: " + e);
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <div style={{ background: '#000', color: '#0f0', padding: '20px', minHeight: '100vh', fontFamily: 'monospace' }}>
      
      {/* SECURITY VAULT UI */}
      <div style={{ border: '1px solid #0f0', padding: '15px', marginBottom: '20px' }}>
        {vaultLocked ? (
          <div>
            <h3>[LOCKED] SECURITY VAULT</h3>
            <input 
              type="password" 
              placeholder="ENTER PASSCODE..." 
              value={vaultPassword}
              onChange={(e) => setVaultPassword(e.target.value)}
              style={{ background: '#111', color: '#0f0', border: '1px solid #0f0' }}
            />
            <button onClick={handleVaultUnlock} style={{ marginLeft: '10px', background: '#0f0', color: '#000' }}>UNLOCK</button>
          </div>
        ) : (
          <div>
            <h3>[UNLOCKED] KEY CONFIGURATION</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input type="password" placeholder="OpenRouter API Key..." value={vaultConfig.openRouterKey} 
                     onChange={(e) => setVaultConfig({...vaultConfig, openRouterKey: e.target.value})} />
              <input type="password" placeholder="Serper API Key..." value={vaultConfig.serperKey} 
                     onChange={(e) => setVaultConfig({...vaultConfig, serperKey: e.target.value})} />
              <input type="password" placeholder="Tavily API Key..." value={vaultConfig.tavilyKey} 
                     onChange={(e) => setVaultConfig({...vaultConfig, tavilyKey: e.target.value})} />
              <button onClick={() => setVaultLocked(true)} style={{ background: 'red', color: 'white' }}>LOCK VAULT</button>
            </div>
          </div>
        )}
      </div>

      {/* CHAT DISPLAY */}
      <div style={{ height: '350px', overflowY: 'auto', border: '1px solid #333', background: '#050505', padding: '10px' }}>
        {isResearching && <div style={{ color: 'cyan' }}>&gt; SCANNING GLOBAL CHANNELS...</div>}
        {sessions.find(s => s.id === currentSessionId)?.messages.map((m, i) => (
          <div key={i} style={{ marginBottom: '10px' }}>
            <span style={{ color: m.role === 'user' ? '#0af' : '#0f0' }}>{m.role.toUpperCase()}:</span> {m.content}
          </div>
        ))}
      </div>

      {/* INPUT CONTROL */}
      <div style={{ marginTop: '15px' }}>
        <input 
          value={inputText} 
          onChange={(e) => setInputText(e.target.value)} 
          onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
          style={{ width: '80%', padding: '10px', background: '#111', color: '#fff', border: '1px solid #333' }}
        />
        <button onClick={handleSendText} disabled={isThinking} style={{ padding: '10px', width: '15%', marginLeft: '2%' }}>
          {isThinking ? "BUSY" : "EXECUTE"}
        </button>
      </div>
    </div>
  );
};

export default App;
