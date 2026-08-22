import React, { useState, useEffect, useRef } from 'react';
import {
  Globe,
  Briefcase,
  Car,
  Bot,
  ExternalLink,
  Sparkles,
  BookOpen,
  Target,
  CheckCircle,
  BarChart3,
  Flame,
  Volume2,
  Send,
  MessageSquare,
  Shield,
  Database,
  Sliders,
  HelpCircle,
  Menu,
  X,
  Clock,
  Award,
  Mic,
  VolumeX,
  Play
} from 'lucide-react';
import { GlassPanel } from './components/GlassPanel';
import { NeonButton } from './components/NeonButton';
import { StaffFeed } from './components/StaffFeed';
import { ModerationPanel } from './components/ModerationPanel';
import { KnowledgeBasePanel } from './components/KnowledgeBasePanel';
import { VoiceButton } from './components/VoiceButton';
import { useVoiceRecorder } from './hooks/useVoiceRecorder';
import { SettingsPanel } from './components/SettingsPanel';
import { FAQPanel } from './components/FAQPanel';
import { AppConfig } from './types';

const MAX_BOT_URL = "https://max.ru/se13914883_bot";

interface VoiceDialogueState {
  userText: string;
  assistantText: string;
  isGenerating: boolean;
  isOpen: boolean;
}

function normalizeWakeText(text: string): string {
  if (!text) return "";
  let s = text.toLowerCase();
  s = s.replace(/семьсот\s*семьдесят\s*семь/g, "777");
  s = s.replace(/три\s*сем[её]рки/g, "777");
  s = s.replace(/три\s*нуля/g, "000");
  s = s.replace(/семь\s*семь\s*семь/g, "777");
  s = s.replace(/ноль\s*ноль\s*ноль/g, "000");
  s = s.replace(/нуль\s*нуль\s*нуль/g, "000");
  s = s.replace(/\bсемь\b/g, "7");
  s = s.replace(/\bноль\b/g, "0");
  s = s.replace(/\bнуль\b/g, "0");
  return s;
}

function detectClientWakeWord(rawText: string) {
  if (!rawText) return { detected: false, voice: null, mode: null, cleanedText: "", isOnlyWakeWord: false, confirmationSpeech: "" };
  const normalized = normalizeWakeText(rawText);
  const compactText = rawText.toLowerCase().replace(/[\s\-_.,!?:;]+/g, "");

  const maleRegex = /(?:selin|селин|силин|селен|салин|целин|zelin)\s*(?:7\s*7\s*7|777|три\s*сем[её]рки|семь\s*семь\s*семь|семьсот\s*семьдесят\s*семь)/i;
  const femaleRegex = /(?:selin|селин|силин|селен|салин|целин|zelin)\s*(?:0\s*0\s*0|000|[oо]\s*[oо]\s*[oо]|[oо]{3}|три\s*нуля|ноль\s*ноль\s*ноль|нуль\s*нуль\s*нуль)/i;

  let matchedMode: "male" | "female" | null = null;
  let targetVoice: "Charon" | "Kore" | null = null;

  if (maleRegex.test(normalized) || compactText.includes("selin777") || compactText.includes("селин777") || compactText.includes("силин777")) {
    matchedMode = "male";
    targetVoice = "Charon";
  } else if (femaleRegex.test(normalized) || compactText.includes("selin000") || compactText.includes("селин000") || compactText.includes("силин000") || compactText.includes("selinooo") || compactText.includes("селинооо")) {
    matchedMode = "female";
    targetVoice = "Kore";
  }

  if (!matchedMode || !targetVoice) {
    return { detected: false, voice: null, mode: null, cleanedText: rawText.trim(), isOnlyWakeWord: false, confirmationSpeech: "" };
  }

  let cleaned = rawText;
  if (matchedMode === "male") {
    cleaned = cleaned.replace(/(?:привет[\s,]*)?(?:selin|селин|силин|селен|салин|целин|zelin)[\s\-_]*(?:7[\s\-_]*7[\s\-_]*7|777|три\s*сем[её]рки|семь\s*семь\s*семь|семьсот\s*семьдесят\s*семь|семьсемьсемь)[\s,]*/gi, " ");
  } else {
    cleaned = cleaned.replace(/(?:привет[\s,]*)?(?:selin|селин|силин|селен|салин|целин|zelin)[\s\-_]*(?:0[\s\-_]*0[\s\-_]*0|000|[oо][\s\-_]*[oо][\s\-_]*[oо]|[oо]{3}|три\s*нуля|ноль\s*ноль\s*ноль|нольнольноль|нуль\s*нуль\s*нуль)[\s,]*/gi, " ");
  }
  cleaned = cleaned.replace(/\s*,\s*,+/g, ", ").replace(/\s{2,}/g, " ").replace(/^[\s,!:;?—-]+/, "").replace(/[\s,!:;?—-]+$/, "").trim();

  const isOnlyWakeWord = cleaned.length === 0;
  const confirmationSpeech = matchedMode === "male"
    ? "Мужской режим активирован. Я на связи."
    : "Женский режим активирован.";

  return { detected: true, voice: targetVoice, mode: matchedMode, cleanedText: cleaned, isOnlyWakeWord, confirmationSpeech };
}

const AVAILABLE_VOICES = [
  { id: 'Kore', name: 'Kore', label: 'Теплый женский (заводской по умолчанию) ✨', gender: 'female' },
  { id: 'Charon', name: 'Charon', label: 'Инженер / Мужской голос (Selin777) 🏛️', gender: 'male' },
  { id: 'Aoede', name: 'Aoede', label: 'Мелодичный женский 🎵', gender: 'female' },
  { id: 'Orus', name: 'Orus', label: 'Уверенный мужской 🎙️', gender: 'male' },
  { id: 'Alnilam', name: 'Alnilam', label: 'Глубокий мужской 🔊', gender: 'male' },
  { id: 'Fenrir', name: 'Fenrir', label: 'Бархатный мужской 🎙️', gender: 'male' },
  { id: 'Puck', name: 'Puck', label: 'Энергичный мужской ⚡', gender: 'male' },
  { id: 'Zephyr', name: 'Zephyr', label: 'Мягкий доверительный 🍃', gender: 'neutral' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'main' | 'languages' | 'business' | 'lifestyle' | 'feed' | 'moderation' | 'knowledge' | 'settings'>('main');
  const [menuOpen, setMenuOpen] = useState(false);
  const [voiceToast, setVoiceToast] = useState<string | null>(null);
  const [showMicGuide, setShowMicGuide] = useState(false);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [activeVoice, setActiveVoice] = useState<string>(() => {
    return localStorage.getItem('selin_voice') || 'Kore';
  });

  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  const [voiceDialogue, setVoiceDialogue] = useState<VoiceDialogueState>({
    userText: '',
    assistantText: '',
    isGenerating: false,
    isOpen: false,
  });

  // Load server config on startup
  useEffect(() => {
    fetch('/api/get-config')
      .then((res) => res.json())
      .then((data) => {
        if (data?.config) {
          setConfig(data.config);
          const savedVoice = data.config.tts_voice || data.config.voice_id;
          if (savedVoice) {
            setActiveVoice(savedVoice);
            localStorage.setItem('selin_voice', savedVoice);
          }
        }
      })
      .catch((err) => console.warn('Failed to load company config:', err));
  }, []);

  const handleSaveConfig = async (updatedConfig: AppConfig) => {
    setConfig(updatedConfig);
    if (updatedConfig.tts_voice || updatedConfig.voice_id) {
      const v = updatedConfig.tts_voice || updatedConfig.voice_id;
      setActiveVoice(v);
      localStorage.setItem('selin_voice', v);
    }
    try {
      await fetch('/api/save-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig),
      });
    } catch (err) {
      console.error('Failed to save config:', err);
    }
  };

  const handleVoiceChange = (newVoice: string) => {
    setActiveVoice(newVoice);
    localStorage.setItem('selin_voice', newVoice);
    if (config) {
      const updated = { ...config, tts_voice: newVoice, voice_id: newVoice };
      handleSaveConfig(updated);
    }
  };

  // Stop any ongoing audio playback
  const stopAllAudio = () => {
    if (currentAudioRef.current) {
      try {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = 0;
        currentAudioRef.current = null;
      } catch (_) {}
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }
  };

  // Synthesize and speak text via Studio Neural TTS (Gemini TTS with WAV audio)
  const speakText = async (text: string, voiceOverride?: string, onEnd?: () => void) => {
    if (!text || !text.trim()) {
      if (onEnd) onEnd();
      return;
    }

    stopAllAudio();
    const chosenVoice = voiceOverride || activeVoice || config?.tts_voice || config?.voice_id || 'Charon';

    try {
      setVoiceStateCustom('speaking');

      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: chosenVoice }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data?.audioUrl) {
          const audio = new Audio(data.audioUrl);
          currentAudioRef.current = audio;

          audio.onended = () => {
            setVoiceStateCustom('idle');
            currentAudioRef.current = null;
            if (onEnd) onEnd();
          };

          audio.onerror = (e) => {
            console.warn('Audio playback error:', e);
            setVoiceStateCustom('idle');
            currentAudioRef.current = null;
            if (onEnd) onEnd();
          };

          await audio.play();
          return;
        }
      }
    } catch (err) {
      console.warn('Studio High-Quality TTS call failed, fallback to Web Speech:', err);
    }

    // Fallback to browser SpeechSynthesis ONLY if server neural TTS fails
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ru-RU';
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        const voices = window.speechSynthesis.getVoices();
        const ruVoice = voices.find((v) => v.lang?.includes('ru') || v.lang?.includes('RU'));
        if (ruVoice) utterance.voice = ruVoice;

        utterance.onend = () => {
          setVoiceStateCustom('idle');
          if (onEnd) onEnd();
        };
        utterance.onerror = () => {
          setVoiceStateCustom('idle');
          if (onEnd) onEnd();
        };

        window.speechSynthesis.speak(utterance);
      } catch (_) {
        setVoiceStateCustom('idle');
        if (onEnd) onEnd();
      }
    } else {
      setVoiceStateCustom('idle');
      if (onEnd) onEnd();
    }
  };

  const handleVoiceInput = async (text: string) => {
    if (!text || !text.trim()) return;

    stopAllAudio();

    // Check for smart speaker voice wake words ("Selin777" for Charon male, "Selin000" for Kore female)
    const wakeResult = detectClientWakeWord(text);
    let effectiveVoice = activeVoice;

    if (wakeResult.detected) {
      effectiveVoice = wakeResult.voice!;
      setActiveVoice(wakeResult.voice!);
      localStorage.setItem('selin_voice', wakeResult.voice!);
      if (config) {
        handleSaveConfig({ ...config, tts_voice: wakeResult.voice!, voice_id: wakeResult.voice! });
      }

      setVoiceToast(wakeResult.mode === 'male' 
        ? '🎙️ Голосовая команда Selin777: Включен мужской голос (Charon)' 
        : '🎙️ Голосовая команда Selin000: Включен заводской женский голос (Kore)');

      if (wakeResult.isOnlyWakeWord) {
        setVoiceDialogue({
          userText: text,
          assistantText: wakeResult.confirmationSpeech,
          isGenerating: false,
          isOpen: true,
        });
        await speakText(wakeResult.confirmationSpeech, wakeResult.voice!);
        return;
      }
    }

    setVoiceDialogue({
      userText: text,
      assistantText: '',
      isGenerating: true,
      isOpen: true,
    });
    if (!wakeResult.detected) {
      setVoiceToast(`Вы: "${text}"`);
    }

    try {
      const res = await fetch('/api/voice-organism-dialogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userInput: text,
          history: [],
          step: 2,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      const reply = data?.speech || data?.reply || 'Я вас слышу! Чем я могу помочь по вашим задачам или языкам?';

      setVoiceDialogue({
        userText: text,
        assistantText: reply,
        isGenerating: false,
        isOpen: true,
      });

      const voiceToUse = data?.voice || effectiveVoice;
      await speakText(reply, voiceToUse);
    } catch (err) {
      console.warn('Voice AI dialogue error, fallback to local reply:', err);
      const fallbackReply = `Принято! Вы сказали: "${text}". Я готов помочь с автоматизацией бизнеса, изучением языков или рутиной.`;
      setVoiceDialogue({
        userText: text,
        assistantText: fallbackReply,
        isGenerating: false,
        isOpen: true,
      });
      await speakText(fallbackReply, effectiveVoice);
    }
  };

  const {
    state: voiceState,
    volume: voiceVolume,
    duration: voiceDuration,
    error: voiceError,
    startRecording,
    stopRecording,
    setState: setVoiceStateCustom,
    clearError,
  } = useVoiceRecorder({
    onTranscript: (text) => {
      handleVoiceInput(text);
    },
    onError: (err) => {
      setVoiceToast(err);
      setShowMicGuide(true);
    },
  });

  const handleVoiceClick = () => {
    if (voiceState === 'idle') {
      stopAllAudio();
      clearError();
      startRecording();
    } else if (voiceState === 'recording') {
      stopRecording();
    } else if (voiceState === 'speaking') {
      stopAllAudio();
      setVoiceStateCustom('idle');
    }
  };

  // Quick stats state
  const [langStats, setLangStats] = useState({ level: 'A1', words: 0, streak: 0, lang: 'Английский' });
  const [bizStats, setBizStats] = useState({ tasksDone: 0, streak: 0, stage: 'Идея' });

  return (
    <div className="min-h-screen bg-[#0F0D0C] text-[#EAE6DF] font-sans selection:bg-[#C5A059]/30 relative overflow-x-hidden">
      {/* Background Glow */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-gradient-to-b from-[#C5A059]/15 via-[#C5A059]/5 to-transparent blur-[120px]" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#161210]/90 backdrop-blur-xl border-b border-[#2A231F]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#2A221E] to-[#1C1715] border border-[#C5A059]/40 flex items-center justify-center text-[#C5A059] shadow-lg">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-[#EAE6DF] tracking-wide leading-none flex items-center gap-2">
                Selin AI
                <span className="text-[10px] font-semibold tracking-wider text-[#C5A059] bg-[#C5A059]/10 border border-[#C5A059]/30 px-2 py-0.5 rounded-full uppercase">
                  v2.1
                </span>
              </h1>
              <p className="text-xs text-[#9E958C] mt-0.5">Интеллектуальный наставник</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Header Voice Button */}
            <button
              onClick={handleVoiceClick}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                voiceState === 'recording'
                  ? 'bg-red-950/80 border-red-500/80 text-red-100 animate-pulse shadow-lg shadow-red-500/20'
                  : voiceState === 'speaking'
                  ? 'bg-emerald-950/80 border-emerald-500/80 text-emerald-100 shadow-lg shadow-emerald-500/20'
                  : 'bg-[#221C19] border-[#362E29] text-[#EAE6DF] hover:border-[#C5A059]/50 hover:bg-[#2A221E]'
              }`}
              title={voiceState === 'recording' ? 'Остановить запись' : 'Голосовой ввод'}
            >
              <Mic className={`w-3.5 h-3.5 ${voiceState === 'recording' ? 'text-red-400 animate-ping' : 'text-[#C5A059]'}`} />
              <span className="hidden sm:inline">
                {voiceState === 'recording' ? 'Слушаю...' : voiceState === 'speaking' ? 'Говорю...' : 'Голос'}
              </span>
            </button>

            <a
              href={MAX_BOT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-[#C5A059] text-[#0F0D0C] hover:bg-[#D4B06A] transition-all duration-200 shadow-lg shadow-[#C5A059]/15 hover:shadow-[#C5A059]/25 hover:-translate-y-0.5 active:translate-y-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Открыть в Max</span>
              <ExternalLink className="w-3 h-3 opacity-70" />
            </a>

            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-2 rounded-xl bg-[#221C19] border border-[#362E29] text-[#9E958C] hover:text-[#EAE6DF] hover:border-[#C5A059]/50 transition-all md:hidden"
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {menuOpen && (
          <div className="md:hidden border-t border-[#2A231F] bg-[#161210]/95 px-4 py-3 space-y-1.5 animate-fade-in">
            <button
              onClick={() => { setActiveTab('main'); setMenuOpen(false); }}
              className={`w-full px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2.5 transition-all ${
                activeTab === 'main' ? 'bg-[#C5A059] text-[#0F0D0C] font-semibold' : 'text-[#9E958C] hover:bg-[#221C19] hover:text-[#EAE6DF]'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              <span>Главная</span>
            </button>
            <button
              onClick={() => { setActiveTab('languages'); setMenuOpen(false); }}
              className={`w-full px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2.5 transition-all ${
                activeTab === 'languages' ? 'bg-[#C5A059] text-[#0F0D0C] font-semibold' : 'text-[#9E958C] hover:bg-[#221C19] hover:text-[#EAE6DF]'
              }`}
            >
              <Globe className="w-4 h-4 text-blue-400" />
              <span>Языки</span>
            </button>
            <button
              onClick={() => { setActiveTab('business'); setMenuOpen(false); }}
              className={`w-full px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2.5 transition-all ${
                activeTab === 'business' ? 'bg-[#C5A059] text-[#0F0D0C] font-semibold' : 'text-[#9E958C] hover:bg-[#221C19] hover:text-[#EAE6DF]'
              }`}
            >
              <Briefcase className="w-4 h-4 text-amber-400" />
              <span>Бизнес</span>
            </button>
            <button
              onClick={() => { setActiveTab('lifestyle'); setMenuOpen(false); }}
              className={`w-full px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2.5 transition-all ${
                activeTab === 'lifestyle' ? 'bg-[#C5A059] text-[#0F0D0C] font-semibold' : 'text-[#9E958C] hover:bg-[#221C19] hover:text-[#EAE6DF]'
              }`}
            >
              <Car className="w-4 h-4 text-emerald-400" />
              <span>Быт (Скоро)</span>
            </button>
            <button
              onClick={() => { setActiveTab('feed'); setMenuOpen(false); }}
              className={`w-full px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2.5 transition-all ${
                activeTab === 'feed' ? 'bg-[#C5A059] text-[#0F0D0C] font-semibold' : 'text-[#9E958C] hover:bg-[#221C19] hover:text-[#EAE6DF]'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              <span>Лента штаба</span>
            </button>
            <button
              onClick={() => { setActiveTab('moderation'); setMenuOpen(false); }}
              className={`w-full px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2.5 transition-all ${
                activeTab === 'moderation' ? 'bg-[#C5A059] text-[#0F0D0C] font-semibold' : 'text-[#9E958C] hover:bg-[#221C19] hover:text-[#EAE6DF]'
              }`}
            >
              <Shield className="w-4 h-4" />
              <span>Модерация</span>
            </button>
            <button
              onClick={() => { setActiveTab('knowledge'); setMenuOpen(false); }}
              className={`w-full px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2.5 transition-all ${
                activeTab === 'knowledge' ? 'bg-[#C5A059] text-[#0F0D0C] font-semibold' : 'text-[#9E958C] hover:bg-[#221C19] hover:text-[#EAE6DF]'
              }`}
            >
              <Database className="w-4 h-4" />
              <span>База знаний</span>
            </button>
            <button
              onClick={() => { setActiveTab('settings'); setMenuOpen(false); }}
              className={`w-full px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2.5 transition-all ${
                activeTab === 'settings' ? 'bg-[#C5A059] text-[#0F0D0C] font-semibold' : 'text-[#9E958C] hover:bg-[#221C19] hover:text-[#EAE6DF]'
              }`}
            >
              <Sliders className="w-4 h-4" />
              <span>Настройки</span>
            </button>
          </div>
        )}
      </header>

      {/* Main Layout */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 relative z-10">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-4 mb-6 custom-scrollbar border-b border-[#2A231F]">
          <button
            onClick={() => setActiveTab('main')}
            className={`px-4 py-2 rounded-xl text-xs font-medium transition-all shrink-0 flex items-center gap-2 ${
              activeTab === 'main'
                ? 'bg-[#C5A059] text-[#0F0D0C] font-semibold'
                : 'bg-[#1C1715] text-[#9E958C] hover:text-[#EAE6DF] hover:bg-[#26201D]'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Главная</span>
          </button>

          <button
            onClick={() => setActiveTab('languages')}
            className={`px-4 py-2 rounded-xl text-xs font-medium transition-all shrink-0 flex items-center gap-2 ${
              activeTab === 'languages'
                ? 'bg-[#C5A059] text-[#0F0D0C] font-semibold'
                : 'bg-[#1C1715] text-[#9E958C] hover:text-[#EAE6DF] hover:bg-[#26201D]'
            }`}
          >
            <Globe className="w-3.5 h-3.5 text-blue-400" />
            <span>Языки</span>
          </button>

          <button
            onClick={() => setActiveTab('business')}
            className={`px-4 py-2 rounded-xl text-xs font-medium transition-all shrink-0 flex items-center gap-2 ${
              activeTab === 'business'
                ? 'bg-[#C5A059] text-[#0F0D0C] font-semibold'
                : 'bg-[#1C1715] text-[#9E958C] hover:text-[#EAE6DF] hover:bg-[#26201D]'
            }`}
          >
            <Briefcase className="w-3.5 h-3.5 text-amber-400" />
            <span>Бизнес</span>
          </button>

          <button
            onClick={() => setActiveTab('lifestyle')}
            className={`px-4 py-2 rounded-xl text-xs font-medium transition-all shrink-0 flex items-center gap-2 ${
              activeTab === 'lifestyle'
                ? 'bg-[#C5A059] text-[#0F0D0C] font-semibold'
                : 'bg-[#1C1715] text-[#9E958C] hover:text-[#EAE6DF] hover:bg-[#26201D]'
            }`}
          >
            <Car className="w-3.5 h-3.5 text-emerald-400" />
            <span>Быт (Скоро)</span>
          </button>

          <button
            onClick={() => setActiveTab('feed')}
            className={`px-4 py-2 rounded-xl text-xs font-medium transition-all shrink-0 flex items-center gap-2 ${
              activeTab === 'feed'
                ? 'bg-[#C5A059] text-[#0F0D0C] font-semibold'
                : 'bg-[#1C1715] text-[#9E958C] hover:text-[#EAE6DF] hover:bg-[#26201D]'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Лента штаба</span>
          </button>

          <button
            onClick={() => setActiveTab('moderation')}
            className={`px-4 py-2 rounded-xl text-xs font-medium transition-all shrink-0 flex items-center gap-2 ${
              activeTab === 'moderation'
                ? 'bg-[#C5A059] text-[#0F0D0C] font-semibold'
                : 'bg-[#1C1715] text-[#9E958C] hover:text-[#EAE6DF] hover:bg-[#26201D]'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Модерация</span>
          </button>

          <button
            onClick={() => setActiveTab('knowledge')}
            className={`px-4 py-2 rounded-xl text-xs font-medium transition-all shrink-0 flex items-center gap-2 ${
              activeTab === 'knowledge'
                ? 'bg-[#C5A059] text-[#0F0D0C] font-semibold'
                : 'bg-[#1C1715] text-[#9E958C] hover:text-[#EAE6DF] hover:bg-[#26201D]'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>База знаний</span>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-2 rounded-xl text-xs font-medium transition-all shrink-0 flex items-center gap-2 ${
              activeTab === 'settings'
                ? 'bg-[#C5A059] text-[#0F0D0C] font-semibold'
                : 'bg-[#1C1715] text-[#9E958C] hover:text-[#EAE6DF] hover:bg-[#26201D]'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Настройки</span>
          </button>
        </div>

        {/* TAB 1: MAIN HERO SCREEN */}
        {activeTab === 'main' && (
          <div className="space-y-8">
            {/* Banner with Embedded Voice Terminal */}
            <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-br from-[#1E1815] via-[#161210] to-[#120F0D] border border-[#2E2621] relative overflow-hidden shadow-2xl flex flex-col lg:flex-row items-center justify-between gap-8">
              <div className="absolute top-0 right-0 w-96 h-96 bg-[#C5A059]/10 rounded-full blur-3xl pointer-events-none" />
              <div className="max-w-xl relative z-10 space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#C5A059]/10 border border-[#C5A059]/30 text-[#C5A059] text-xs font-medium">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Selin AI — Автономный Интеллект</span>
                </div>
                <h2 className="text-3xl sm:text-4xl font-extrabold text-[#EAE6DF] tracking-tight leading-tight">
                  Selin AI — <span className="text-[#C5A059]">автономный интеллект</span> общего назначения
                </h2>
                <p className="text-sm text-[#A89E94] leading-relaxed">
                  Не чат-бот. Не помощник. Интеллект, который учится, помнит и действует.
                </p>
                <div className="text-xs text-[#C5A059] font-medium italic">
                  «Сегодня в твоём телефоне. Завтра — рядом с тобой.»
                </div>
                <div className="pt-2 flex flex-wrap gap-3">
                  <a
                    href={MAX_BOT_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-6 py-3 rounded-xl bg-[#C5A059] text-[#0F0D0C] font-bold text-xs uppercase tracking-wider hover:bg-[#D4B06A] transition-all duration-200 inline-flex items-center gap-2 shadow-lg shadow-[#C5A059]/20"
                  >
                    <span>Открыть в Max</span>
                    <ExternalLink className="w-4 h-4" />
                  </a>
                  <button
                    onClick={() => setActiveTab('feed')}
                    className="px-6 py-3 rounded-xl bg-[#26201D] text-[#EAE6DF] border border-[#382F2A] font-semibold text-xs hover:border-[#C5A059]/40 transition-all"
                  >
                    Консоль Ядра
                  </button>
                </div>
              </div>

              {/* Embedded Voice Station on the Main Page */}
              <div className="w-full lg:w-80 relative z-10">
                <div className="p-5 rounded-2xl bg-[#14100E]/90 border border-[#C5A059]/30 shadow-2xl backdrop-blur-md flex flex-col items-center text-center space-y-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#C5A059] uppercase tracking-wider">
                    <Mic className="w-4 h-4" />
                    <span>Голосовой интерфейс</span>
                  </div>

                  <VoiceButton
                    state={voiceState}
                    volume={voiceVolume}
                    duration={voiceDuration}
                    onClick={handleVoiceClick}
                    error={voiceError}
                    onOpenPermissionGuide={() => setShowMicGuide(true)}
                    variant="embedded"
                  />

                  {/* Fast Suggested Prompts */}
                  <div className="w-full pt-1 border-t border-[#261E1A] space-y-1.5">
                    <div className="text-[10px] text-[#7A7167] font-medium">Быстрый голосовой запрос:</div>
                    <div className="flex flex-wrap gap-1.5 justify-center">
                      <button
                        onClick={() => handleVoiceInput('Помоги выучить английский')}
                        className="text-[11px] px-2.5 py-1 rounded-lg bg-[#1F1916] text-[#A89E94] hover:text-[#EAE6DF] hover:bg-[#2A221E] border border-[#332822] transition-colors"
                      >
                        «Учить английский»
                      </button>
                      <button
                        onClick={() => handleVoiceInput('Проведи аудит моего бизнеса')}
                        className="text-[11px] px-2.5 py-1 rounded-lg bg-[#1F1916] text-[#A89E94] hover:text-[#EAE6DF] hover:bg-[#2A221E] border border-[#332822] transition-colors"
                      >
                        «Аудит бизнеса»
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 3 CORE CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Card 1: Languages */}
              <div
                onClick={() => setActiveTab('languages')}
                className="group p-6 rounded-2xl bg-[#161210] border border-[#2A231F] hover:border-[#C5A059]/50 transition-all duration-300 cursor-pointer flex flex-col justify-between hover:-translate-y-1 shadow-xl hover:shadow-[#C5A059]/5"
              >
                <div className="space-y-4">
                  <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 group-hover:scale-110 transition-transform">
                    <Globe className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-[#EAE6DF] group-hover:text-[#C5A059] transition-colors">
                      🌍 Языковой Наставник
                    </h3>
                    <p className="text-xs text-[#A89E94] mt-2 leading-relaxed">
                      Интервальные повторения Anki (SM-2), генерация уроков с диалогами, shadowing произношения и проверка домашних заданий.
                    </p>
                  </div>
                </div>

                <div className="pt-6 border-t border-[#26201D] mt-6 flex items-center justify-between text-xs font-semibold text-blue-400">
                  <span>Перейти к обучению</span>
                  <span>→</span>
                </div>
              </div>

              {/* Card 2: Business */}
              <div
                onClick={() => setActiveTab('business')}
                className="group p-6 rounded-2xl bg-[#161210] border border-[#2A231F] hover:border-[#C5A059]/50 transition-all duration-300 cursor-pointer flex flex-col justify-between hover:-translate-y-1 shadow-xl hover:shadow-[#C5A059]/5"
              >
                <div className="space-y-4">
                  <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 group-hover:scale-110 transition-transform">
                    <Briefcase className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-[#EAE6DF] group-hover:text-[#C5A059] transition-colors">
                      💼 Бизнес-Ментор
                    </h3>
                    <p className="text-xs text-[#A89E94] mt-2 leading-relaxed">
                      Экспресс-диагностика бизнеса, ежедневные SMART-задания, симулятор ролевых игр по продажам и еженедельный разбор отчётов.
                    </p>
                  </div>
                </div>

                <div className="pt-6 border-t border-[#26201D] mt-6 flex items-center justify-between text-xs font-semibold text-amber-400">
                  <span>Запустить менторство</span>
                  <span>→</span>
                </div>
              </div>

              {/* Card 3: Lifestyle (Coming Soon) */}
              <div
                onClick={() => setActiveTab('lifestyle')}
                className="group p-6 rounded-2xl bg-[#161210] border border-[#2A231F] hover:border-[#C5A059]/50 transition-all duration-300 cursor-pointer flex flex-col justify-between hover:-translate-y-1 shadow-xl opacity-90"
              >
                <div className="space-y-4">
                  <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 group-hover:scale-110 transition-transform">
                    <Car className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-bold text-[#EAE6DF] group-hover:text-[#C5A059] transition-colors">
                        🚕 Быт & Сервисы
                      </h3>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                        Скоро
                      </span>
                    </div>
                    <p className="text-xs text-[#A89E94] mt-2 leading-relaxed">
                      Интеграция заказа такси, доставки еды, поиска билетов и бронирования отелей через голосовой интерфейс.
                    </p>
                  </div>
                </div>

                <div className="pt-6 border-t border-[#26201D] mt-6 flex items-center justify-between text-xs font-semibold text-emerald-400">
                  <span>В разработке</span>
                  <span>⏳</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: LANGUAGES */}
        {activeTab === 'languages' && (
          <div className="space-y-6">
            <div className="p-6 rounded-2xl bg-[#161210] border border-[#2A231F] space-y-4">
              <div className="flex items-center gap-3">
                <Globe className="w-8 h-8 text-blue-400" />
                <div>
                  <h3 className="text-xl font-bold text-[#EAE6DF]">🌍 Языковой модуль Selin AI</h3>
                  <p className="text-xs text-[#A89E94]">Профессиональный наставник с алгоримом SM-2</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
                <div className="p-4 rounded-xl bg-[#1C1715] border border-[#2A231F]">
                  <div className="text-xs text-[#9E958C]">Алгоритм повторений</div>
                  <div className="text-lg font-bold text-[#EAE6DF] mt-1">Anki (SM-2)</div>
                  <div className="text-[10px] text-blue-400 mt-1">Интервалы 1d, 6d, ef</div>
                </div>

                <div className="p-4 rounded-xl bg-[#1C1715] border border-[#2A231F]">
                  <div className="text-xs text-[#9E958C]">Практика произношения</div>
                  <div className="text-lg font-bold text-[#EAE6DF] mt-1">Shadowing</div>
                  <div className="text-[10px] text-emerald-400 mt-1">Голосовой анализ AI</div>
                </div>

                <div className="p-4 rounded-xl bg-[#1C1715] border border-[#2A231F]">
                  <div className="text-xs text-[#9E958C]">Проверка домашних заданий</div>
                  <div className="text-lg font-bold text-[#EAE6DF] mt-1">Gemini AI</div>
                  <div className="text-[10px] text-amber-400 mt-1">Оценка и разбор ошибок</div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#1F1916] border border-[#382E27] space-y-2">
                <h4 className="text-xs font-bold text-[#C5A059] uppercase tracking-wider">Команды в Max-боте:</h4>
                <div className="text-xs text-[#D8D2C9] space-y-1 font-mono">
                  <p><span className="text-[#C5A059]">/язык английский</span> — начать курс или сменить язык</p>
                  <p><span className="text-[#C5A059]">новый урок</span> — сгенерировать 5 новых слов и диалог</p>
                  <p><span className="text-[#C5A059]">повторение</span> — список слов для повторения сегодня</p>
                  <p><span className="text-[#C5A059]">прогресс</span> — общая статистика и текущий streak</p>
                </div>
              </div>

              <div className="pt-2">
                <a
                  href={MAX_BOT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-6 py-3 rounded-xl bg-[#C5A059] text-[#0F0D0C] font-bold text-xs uppercase tracking-wider hover:bg-[#D4B06A] transition-all inline-flex items-center gap-2 shadow-lg shadow-[#C5A059]/15"
                >
                  <span>Начать обучение в Max</span>
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: BUSINESS */}
        {activeTab === 'business' && (
          <div className="space-y-6">
            <div className="p-6 rounded-2xl bg-[#161210] border border-[#2A231F] space-y-4">
              <div className="flex items-center gap-3">
                <Briefcase className="w-8 h-8 text-amber-400" />
                <div>
                  <h3 className="text-xl font-bold text-[#EAE6DF]">💼 Бизнес-ментор Selin AI</h3>
                  <p className="text-xs text-[#A89E94]">Пошаговое сопровождение предпринимателя до результата</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
                <div className="p-4 rounded-xl bg-[#1C1715] border border-[#2A231F]">
                  <div className="text-xs text-[#9E958C]">Экспресс-диагностика</div>
                  <div className="text-lg font-bold text-[#EAE6DF] mt-1">5 Вопросов</div>
                  <div className="text-[10px] text-amber-400 mt-1">Ниша, стадия, цели</div>
                </div>

                <div className="p-4 rounded-xl bg-[#1C1715] border border-[#2A231F]">
                  <div className="text-xs text-[#9E958C]">Дневные задачи</div>
                  <div className="text-lg font-bold text-[#EAE6DF] mt-1">SMART-контроль</div>
                  <div className="text-[10px] text-emerald-400 mt-1">1 задача на сегодня</div>
                </div>

                <div className="p-4 rounded-xl bg-[#1C1715] border border-[#2A231F]">
                  <div className="text-xs text-[#9E958C]">Симулятор переговоров</div>
                  <div className="text-lg font-bold text-[#EAE6DF] mt-1">Sales Roleplay</div>
                  <div className="text-[10px] text-blue-400 mt-1">AI-клиент с возражениями</div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#1F1916] border border-[#382E27] space-y-2">
                <h4 className="text-xs font-bold text-[#C5A059] uppercase tracking-wider">Команды в Max-боте:</h4>
                <div className="text-xs text-[#D8D2C9] space-y-1 font-mono">
                  <p><span className="text-[#C5A059]">/бизнес</span> — запустить экспресс-диагностику</p>
                  <p><span className="text-[#C5A059]">задание</span> — получить конкретную задачу на сегодня</p>
                  <p><span className="text-[#C5A059]">отчёт [текст]</span> — сдать отчёт о выполнении</p>
                  <p><span className="text-[#C5A059]">ролевая игра</span> — запустить тренировку продаж</p>
                  <p><span className="text-[#C5A059]">обзор</span> — еженедельный разбор результатов</p>
                </div>
              </div>

              <div className="pt-2">
                <a
                  href={MAX_BOT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-6 py-3 rounded-xl bg-[#C5A059] text-[#0F0D0C] font-bold text-xs uppercase tracking-wider hover:bg-[#D4B06A] transition-all inline-flex items-center gap-2 shadow-lg shadow-[#C5A059]/15"
                >
                  <span>Запустить ментор в Max</span>
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: LIFESTYLE (COMING SOON) */}
        {activeTab === 'lifestyle' && (
          <div className="space-y-6">
            <div className="p-8 rounded-2xl bg-[#161210] border border-[#2A231F] text-center space-y-4">
              <Car className="w-12 h-12 text-emerald-400 mx-auto animate-pulse" />
              <h3 className="text-2xl font-bold text-[#EAE6DF]">🚕 Бытовой консьерж Selin AI</h3>
              <p className="text-xs text-[#A89E94] max-w-md mx-auto">
                Модуль автоматизации бытовых задач находится в разработке. Скоро: заказ такси, доставка еды, покупка авиабилетов и бронирование через голосового ассистента.
              </p>
              <div className="pt-4">
                <button
                  onClick={() => setActiveTab('main')}
                  className="px-6 py-2.5 rounded-xl bg-[#26201D] text-[#EAE6DF] border border-[#382F2A] font-medium text-xs hover:border-[#C5A059]/40 transition-all"
                >
                  Вернуться на главную
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PANELS FROM HEADQUARTERS */}
        {activeTab === 'feed' && <StaffFeed />}
        {activeTab === 'moderation' && <ModerationPanel />}
        {activeTab === 'knowledge' && <KnowledgeBasePanel />}
        {activeTab === 'settings' && (
          <SettingsPanel
            config={config || {
              project_name: 'Selin AI',
              owner_name: 'Пользователь',
              business_name: 'Мой Бизнес',
              industry: 'Продажи и услуги',
              channels: ['telegram'],
              tone: 'friendly',
              autonomy_level: 'full',
              voice_id: activeVoice,
              tts_voice: activeVoice,
              is_active: true,
              auto_synthesize: true,
            }}
            onSave={handleSaveConfig}
          />
        )}
      </main>

      {/* Voice Dialogue Modal */}
      {voiceDialogue.isOpen && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="w-full max-w-lg bg-[#161210] border border-[#C5A059]/40 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#2A231F] pb-3">
              <div className="flex items-center gap-2.5">
                <div className={`w-3 h-3 rounded-full ${voiceState === 'speaking' ? 'bg-emerald-400 animate-pulse' : 'bg-[#C5A059]'}`} />
                <h4 className="text-sm font-bold text-[#EAE6DF]">Голосовой диалог с Selin</h4>
              </div>
              <button
                onClick={() => {
                  stopAllAudio();
                  setVoiceDialogue((prev) => ({ ...prev, isOpen: false }));
                }}
                className="p-1 rounded-lg text-[#9E958C] hover:text-[#EAE6DF] hover:bg-[#221C19]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Voice Model Selector Chips */}
            <div className="space-y-1.5 bg-[#1B1512] p-3 rounded-xl border border-[#2E241E]">
              <div className="text-[10px] font-semibold text-[#C5A059] uppercase tracking-wider flex items-center justify-between">
                <span>Голос Selin (Студийный AI):</span>
                <span className="text-[#8E8478] lowercase">{AVAILABLE_VOICES.find(v => v.id === activeVoice)?.gender === 'female' ? 'женский' : 'мужской'}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {AVAILABLE_VOICES.map((v) => {
                  const isSelected = activeVoice === v.id;
                  return (
                    <button
                      key={v.id}
                      onClick={() => {
                        handleVoiceChange(v.id);
                        if (voiceDialogue.assistantText) {
                          speakText(voiceDialogue.assistantText, v.id);
                        }
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all flex items-center gap-1 ${
                        isSelected
                          ? 'bg-[#C5A059] text-[#0F0D0C] font-bold shadow-md shadow-[#C5A059]/20'
                          : 'bg-[#241C18] text-[#B0A698] hover:text-white hover:bg-[#2F241F] border border-[#3A2D25]'
                      }`}
                    >
                      <span>{v.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* User speech */}
            <div className="bg-[#1F1916] border border-[#2E2521] rounded-xl p-3 space-y-1">
              <div className="text-[10px] font-semibold text-[#C5A059] uppercase tracking-wider">Вы сказали:</div>
              <div className="text-xs text-[#EAE6DF] font-medium leading-relaxed">{voiceDialogue.userText}</div>
            </div>

            {/* Assistant response */}
            <div className="bg-gradient-to-br from-[#241B15] to-[#181310] border border-[#C5A059]/30 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">
                <span className="flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>Selin отвечает ({activeVoice}):</span>
                </span>
                {voiceDialogue.isGenerating ? (
                  <span className="text-[#C5A059] animate-pulse">Генерация ответа...</span>
                ) : voiceState === 'speaking' ? (
                  <span className="text-emerald-400 animate-pulse font-bold">Озвучивание...</span>
                ) : null}
              </div>
              <div className="text-xs text-[#EAE6DF] leading-relaxed max-h-48 overflow-y-auto pr-1">
                {voiceDialogue.assistantText || (
                  <span className="text-[#9E958C] italic">Обрабатываю ваш запрос...</span>
                )}
              </div>

              {/* Audio Controls */}
              {voiceDialogue.assistantText && (
                <div className="pt-2 flex items-center gap-2 border-t border-[#33261F]">
                  {voiceState === 'speaking' ? (
                    <button
                      onClick={() => {
                        stopAllAudio();
                        setVoiceStateCustom('idle');
                      }}
                      className="px-3 py-1.5 rounded-lg bg-red-950/70 border border-red-500/40 text-red-200 text-xs font-semibold flex items-center gap-1.5 hover:bg-red-900/80 transition-all"
                    >
                      <VolumeX className="w-3.5 h-3.5" />
                      <span>Остановить голос</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => speakText(voiceDialogue.assistantText, activeVoice)}
                      className="px-3 py-1.5 rounded-lg bg-[#2A201A] border border-[#C5A059]/40 text-[#EAE6DF] text-xs font-medium flex items-center gap-1.5 hover:bg-[#382B23] hover:border-[#C5A059] transition-all"
                    >
                      <Play className="w-3.5 h-3.5 text-[#C5A059]" />
                      <span>Послушать ещё раз ({activeVoice})</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => {
                  stopAllAudio();
                  setVoiceDialogue((prev) => ({ ...prev, isOpen: false }));
                  clearError();
                  startRecording();
                }}
                className="flex-1 py-2.5 rounded-xl bg-[#C5A059] text-[#0F0D0C] text-xs font-bold flex items-center justify-center gap-2 hover:bg-[#D4B06A] transition-all shadow-md"
              >
                <Mic className="w-4 h-4" />
                <span>Сказать ещё</span>
              </button>
              <button
                onClick={() => {
                  stopAllAudio();
                  setVoiceDialogue((prev) => ({ ...prev, isOpen: false }));
                }}
                className="px-4 py-2.5 rounded-xl bg-[#26201D] text-[#EAE6DF] text-xs font-medium hover:bg-[#322A26] border border-[#382F2A]"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Microphone Permission Guide Modal */}
      {showMicGuide && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="w-full max-w-lg bg-[#181412] border border-amber-500/40 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <Mic className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-[#EAE6DF]">Включение микрофона</h4>
                  <p className="text-xs text-[#9E958C]">Инструкция для Android Chrome и Safari</p>
                </div>
              </div>
              <button
                onClick={() => setShowMicGuide(false)}
                className="p-1 rounded-lg text-[#9E958C] hover:text-[#EAE6DF] hover:bg-[#221C19]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-[#C8BFAF]">
              <div className="p-3.5 rounded-xl bg-[#221C19] border border-[#332A25] flex gap-3 items-start">
                <div className="w-5 h-5 rounded-full bg-[#C5A059]/20 text-[#C5A059] flex items-center justify-center font-bold shrink-0 mt-0.5">
                  1
                </div>
                <div>
                  <div className="font-semibold text-[#EAE6DF]">Разрешите доступ в адресной строке</div>
                  <div className="text-[11px] text-[#9E958C] mt-0.5">
                    Нажмите на значок <strong className="text-amber-300">замка 🔒</strong> или <strong className="text-amber-300">настроек сайта ⚙️</strong> слева от URL браузера и выберите <strong>"Микрофон" → "Разрешить"</strong>.
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-[#221C19] border border-[#332A25] flex gap-3 items-start">
                <div className="w-5 h-5 rounded-full bg-[#C5A059]/20 text-[#C5A059] flex items-center justify-center font-bold shrink-0 mt-0.5">
                  2
                </div>
                <div>
                  <div className="font-semibold text-[#EAE6DF]">Или откройте сайт в отдельной вкладке</div>
                  <div className="text-[11px] text-[#9E958C] mt-0.5">
                    В окне предпросмотра фрейм может блокировать микрофон. В отдельной вкладке всплывающий запрос разрешения появится моментально.
                  </div>
                </div>
              </div>
            </div>

            {/* Direct Action Buttons */}
            <div className="space-y-2 pt-2">
              <button
                onClick={() => {
                  try {
                    window.open(window.location.href, '_blank');
                  } catch (_) {}
                  setShowMicGuide(false);
                }}
                className="w-full py-3 rounded-xl bg-[#C5A059] text-[#0F0D0C] text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-[#D4B06A] transition-all shadow-lg"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Открыть сайт в отдельной вкладке</span>
              </button>

              <button
                onClick={() => {
                  setShowMicGuide(false);
                  clearError();
                  startRecording();
                }}
                className="w-full py-2.5 rounded-xl bg-[#2A221E] text-[#EAE6DF] border border-[#3D322B] text-xs font-medium hover:bg-[#342B25] transition-all"
              >
                Повторить запрос микрофона сейчас
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="max-w-6xl mx-auto px-4 sm:px-6 py-8 border-t border-[#2A231F] mt-12 text-center text-xs text-[#7A7167]">
        <p>© 2026 Selin AI · Интеллектуальный наставник & Автономный цифровой сотрудник</p>
      </footer>
    </div>
  );
}
