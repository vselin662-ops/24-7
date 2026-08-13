import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Send, Volume2, VolumeX, Sparkles, X, ArrowRight, CheckCircle2, MessageSquare } from 'lucide-react';
// @ts-ignore
import bgPhoto from '../assets/images/mountain_forest_bg_1785821902731.jpg';

interface VoiceOrganismOnboardingProps {
  onComplete: (data: { userName?: string; userGoal?: string }) => void;
  onClose?: () => void;
}

interface MessageTurn {
  role: 'user' | 'assistant';
  content: string;
}

const cleanNameStr = (val: string | null | undefined): string => {
  if (!val) return '';
  const trimmed = val.trim();
  if (trimmed.length > 25 || /extracted|schema|json|let's|context|history|output|prompt|valid|requires/i.test(trimmed)) {
    const match = trimmed.match(/\b([А-ЯЁ][а-яё]{1,15}|[A-Z][a-z]{1,15})\b/);
    if (match && match[1] && !/extracted|schema|json|lets|context|history|output|valid|requires/i.test(match[1])) {
      return match[1];
    }
    return '';
  }
  return trimmed;
};

export const VoiceOrganismOnboarding: React.FC<VoiceOrganismOnboardingProps> = ({
  onComplete,
  onClose,
}) => {
  const [step, setStep] = useState<string>('INITIAL_START');
  const [userName, setUserName] = useState<string>('');
  const [userGoal, setUserGoal] = useState<string>('');
  const [history, setHistory] = useState<MessageTurn[]>([]);
  
  const [aiSpeech, setAiSpeech] = useState<string>('Приветствую вас! Я ваш интеллектуальный помощник и инженер ваших будущих задач. Как я могу к вам обращаться?');
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isThinking, setIsThinking] = useState<boolean>(false);
  
  const [textInput, setTextInput] = useState<string>('');
  const [showTextInput, setShowTextInput] = useState<boolean>(false);
  const [audioEnabled, setAudioEnabled] = useState<boolean>(true);

  const recognitionRef = useRef<any>(null);
  const isSpeechSupported = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  // Speech Synthesis Helper (uses server Gemini TTS API first for premium natural voice)
  const speakText = async (text: string) => {
    if (!audioEnabled || typeof window === 'undefined') return;

    // Stop previous audio if playing
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    setIsSpeaking(true);

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: 'Kore' })
      });

      if (res.ok) {
        const data = await res.json();
        if (data?.audioUrl) {
          const audio = new Audio(data.audioUrl);
          currentAudioRef.current = audio;

          audio.onplay = () => setIsSpeaking(true);
          audio.onended = () => {
            setIsSpeaking(false);
            currentAudioRef.current = null;
          };
          audio.onerror = () => {
            setIsSpeaking(false);
            currentAudioRef.current = null;
          };

          await audio.play();
          return;
        }
      }
    } catch (err) {
      console.warn("Server TTS failed, falling back to Web Speech API:", err);
    }

    // Fallback to browser SpeechSynthesis if TTS endpoint is unavailable
    if ('speechSynthesis' in window) {
      try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ru-RU';
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        const voices = window.speechSynthesis.getVoices();
        const ruVoice = voices.find(v => v.lang?.includes('ru') || v.lang?.includes('RU'));
        if (ruVoice) utterance.voice = ruVoice;

        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);

        window.speechSynthesis.speak(utterance);
      } catch (e) {
        console.warn("Fallback Speech Synthesis failed:", e);
        setIsSpeaking(false);
      }
    } else {
      setIsSpeaking(false);
    }
  };

  // Initial trigger
  useEffect(() => {
    // Autoplay greeting after short mounting delay
    const timer = setTimeout(() => {
      speakText('Приветствую вас! Я ваш новый интеллектуальный помощник и инженер ваших будущих задач. Как я могу к вам обращаться?');
    }, 600);

    return () => {
      clearTimeout(timer);
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Setup Speech Recognition
  useEffect(() => {
    if (isSpeechSupported) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'ru-RU';

      recognitionRef.current.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setTextInput(transcript);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current.onerror = (err: any) => {
        console.warn('Speech recognition error:', err);
        setIsListening(false);
      };
    }
  }, [isSpeechSupported]);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      setIsSpeaking(false);
      setTextInput('');
      try {
        recognitionRef.current?.start();
        setIsListening(true);
      } catch (err) {
        console.warn("Could not start recognition:", err);
      }
    }
  };

  const handleSend = async (userMessageText?: string) => {
    const input = (userMessageText || textInput).trim();
    if (!input && !userMessageText) return;

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    }

    setTextInput('');
    setIsThinking(true);

    const updatedHistory: MessageTurn[] = [
      ...history,
      { role: 'user', content: input }
    ];
    setHistory(updatedHistory);

    try {
      const res = await fetch('/api/voice-organism-dialogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step,
          userName,
          userInput: input,
          history: updatedHistory
        })
      });

      const data = await res.json();
      setIsThinking(false);

      if (data.speech) {
        setAiSpeech(data.speech);
        speakText(data.speech);

        setHistory(prev => [...prev, { role: 'assistant', content: data.speech }]);
      }

      if (data.userName) {
        const cName = cleanNameStr(data.userName);
        if (cName) setUserName(cName);
      }

      if (data.extractedGoal) {
        setUserGoal(data.extractedGoal);
      }

      if (data.nextStep) {
        setStep(data.nextStep);
      }

      if (data.nextStep === 'SETUP_COMPLETE') {
        setTimeout(() => {
          onComplete({ userName: cleanNameStr(data.userName) || userName, userGoal: data.extractedGoal || userGoal });
        }, 4000);
      }
    } catch (err) {
      console.error("Voice dialogue failed:", err);
      setIsThinking(false);
      const fallbackSpeech = "Я на связи! Принял ваш ответ и готов настраивать под вас цифровую систему.";
      setAiSpeech(fallbackSpeech);
      speakText(fallbackSpeech);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#080B11] text-white flex flex-col justify-between p-6 overflow-hidden select-none animate-fade-in">
      {/* Full-screen Background Image */}
      <div className="absolute inset-0 w-full h-full pointer-events-none overflow-hidden">
        <img
          src={localStorage.getItem('custom_user_bg_photo') || bgPhoto}
          alt="Фон"
          className="w-full h-full object-cover object-center filter grayscale contrast-125 brightness-50 opacity-60"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#080B11]/90 via-[#080B11]/60 to-[#080B11]/95" />
      </div>

      {/* Background Ambient Glow & Particles */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full blur-[120px] transition-all duration-1000 ${
          isListening ? 'bg-cyan-500/20 scale-125' : isSpeaking ? 'bg-purple-500/25 scale-110' : 'bg-blue-600/15'
        }`} />
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-[100px]" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-[100px]" />
      </div>

      {/* Header bar */}
      <div className="relative z-10 flex items-center justify-between w-full max-w-4xl mx-auto pt-2">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-cyan-400 animate-pulse" />
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-400 font-display">Живой ИИ-Организм</div>
            <div className="text-[11px] text-slate-400 font-light">Интерактивный Инженер Задач</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setAudioEnabled(!audioEnabled);
              if (audioEnabled && typeof window !== 'undefined' && 'speechSynthesis' in window) {
                window.speechSynthesis.cancel();
                setIsSpeaking(false);
              }
            }}
            className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 transition-colors"
            title={audioEnabled ? "Выключить звук" : "Включить звук"}
          >
            {audioEnabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4 text-slate-500" />}
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white transition-colors"
              title="Перейти в штаб"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main Central Orb & AI Speech Area */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center max-w-3xl mx-auto text-center px-4 my-8">
        {/* Animated Central Voice Orb */}
        <div className="relative mb-10 flex items-center justify-center">
          {/* Outer Wave Rings */}
          {(isSpeaking || isListening) && (
            <>
              <div className="absolute w-44 h-44 rounded-full border border-cyan-500/30 animate-ping opacity-75" />
              <div className="absolute w-56 h-56 rounded-full border border-purple-500/20 animate-pulse" />
            </>
          )}

          {/* Central Orb Core */}
          <div className={`w-32 h-32 rounded-full border border-white/20 flex items-center justify-center transition-all duration-700 backdrop-blur-xl shadow-2xl ${
            isListening 
              ? 'bg-gradient-to-tr from-cyan-500/40 to-emerald-500/40 shadow-cyan-500/30 scale-110' 
              : isSpeaking 
              ? 'bg-gradient-to-tr from-purple-600/40 to-blue-500/40 shadow-purple-500/30 scale-105'
              : 'bg-gradient-to-tr from-white/10 to-white/5 shadow-black/50'
          }`}>
            <Sparkles className={`w-12 h-12 transition-transform duration-500 ${
              isSpeaking ? 'text-purple-300 scale-110 animate-pulse' : isListening ? 'text-cyan-300 scale-110' : 'text-slate-300'
            }`} />
          </div>
        </div>

        {/* AI Speech Bubble Text */}
        <div className="space-y-4 max-w-2xl">
          {cleanNameStr(userName) ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-xs font-semibold text-cyan-300 animate-fade-in">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Собеседник: {cleanNameStr(userName)}
            </span>
          ) : null}

          <div className="min-h-[60px] flex flex-col items-center justify-center">
            {isThinking ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm animate-pulse">
                <Sparkles className="w-4 h-4 text-cyan-400 animate-spin" />
                <span>Осмысливаю ваши слова...</span>
              </div>
            ) : isSpeaking ? (
              <div className="flex items-center gap-2 text-purple-300 text-sm font-medium animate-pulse">
                <Volume2 className="w-4 h-4 text-purple-400" />
                <span>Голосовой агент говорит...</span>
              </div>
            ) : isListening ? (
              <div className="flex items-center gap-2 text-cyan-300 text-sm font-medium animate-pulse">
                <Mic className="w-4 h-4 text-cyan-400 animate-bounce" />
                <span>Слушаю ваш ответ...</span>
              </div>
            ) : (
              <div className="text-slate-400 text-xs font-light">
                Нажмите на микрофон для разговора
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Floating Microphone & Controls Bar */}
      <div className="relative z-10 w-full max-w-2xl mx-auto pb-4 space-y-4">
        {/* Real-time transcribed text preview or manual input */}
        {showTextInput ? (
          <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex gap-2 animate-fade-in">
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Напишите ответ от руки..."
              className="flex-1 bg-white/5 border border-white/15 rounded-2xl px-5 py-3.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
              autoFocus
            />
            <button
              type="submit"
              disabled={!textInput.trim() || isThinking}
              className="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-black font-bold px-6 py-3.5 rounded-2xl flex items-center gap-2 transition-all"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        ) : (
          textInput && (
            <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 text-center text-xs text-slate-300 animate-fade-in">
              Распознано: «{textInput}»
            </div>
          )
        )}

        {/* Big Mic Button & Action Row */}
        <div className="flex items-center justify-center gap-6">
          <button
            onClick={() => setShowTextInput(!showTextInput)}
            className="p-3 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white transition-all text-xs flex items-center gap-2"
            title="Переключить текстовый ввод"
          >
            <MessageSquare className="w-4 h-4" />
            <span className="hidden sm:inline">{showTextInput ? "Голос" : "Текст"}</span>
          </button>

          {/* Main Floating Glowing Microphone Button */}
          <button
            onClick={toggleListening}
            disabled={isThinking}
            className={`relative p-6 rounded-full border transition-all duration-500 shadow-2xl transform active:scale-95 ${
              isListening
                ? 'bg-cyan-500 text-black border-cyan-300 shadow-cyan-500/50 scale-110 animate-pulse'
                : 'bg-white/10 hover:bg-white/20 text-white border-white/20 hover:border-cyan-400/50 shadow-black'
            }`}
          >
            {isListening ? (
              <MicOff className="w-8 h-8 animate-bounce" />
            ) : (
              <Mic className="w-8 h-8 text-cyan-400" />
            )}
          </button>

          {textInput.trim() && !showTextInput ? (
            <button
              onClick={() => handleSend()}
              className="p-3 rounded-full bg-cyan-500 text-black font-bold hover:bg-cyan-400 transition-all shadow-lg shadow-cyan-500/20"
              title="Отправить голос"
            >
              <Send className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={() => onComplete({ userName, userGoal })}
              className="p-3 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white transition-all text-xs flex items-center gap-2"
              title="Пропустить прямо в штаб"
            >
              <span className="hidden sm:inline">В штаб</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Subtle Guidance Caption */}
        <div className="text-center text-[11px] text-slate-500 font-light">
          {isListening
            ? "Говорите свободным языком — система уловит ваши слова..."
            : "Нажмите на микрофон и ответьте голосом"}
        </div>
      </div>
    </div>
  );
};
