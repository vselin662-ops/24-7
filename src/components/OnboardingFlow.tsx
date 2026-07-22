import React, { useState, useRef, useEffect } from 'react';
import { GlassPanel } from './GlassPanel';
import { NeonButton } from './NeonButton';
import { VoiceRecorder } from './VoiceRecorder';
import { Message, AppConfig, Agent } from '../types';
import { Users, Bot, MessageSquare, Send, Check, Shield, HelpCircle, Volume2, Sparkles, Sliders, Mic, StopCircle } from 'lucide-react';

interface OnboardingFlowProps {
  onComplete: (config: AppConfig, customizedAgents: Agent[]) => void;
}

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({ onComplete }) => {
  const [step, setStep] = useState<'welcome' | 'interview' | 'agents_setup'>('welcome');
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'model',
      content: 'Приветствую! Я подстроюсь под вашу задачу. Расскажите голосом или напишите, что именно нужно автоматизировать в вашем бизнесе — и я соберу под это цифровой штаб. Как вас зовут и чем занимаетесь?'
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [detectedConfig, setDetectedConfig] = useState<AppConfig | null>(null);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Customized agents state
  const [customizedAgents, setCustomizedAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('receiver');

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mr.mimeType || "audio/webm" });
        setIsRecording(false);

        const reader = new FileReader();
        reader.onloadend = async () => {
          const b64 = (reader.result as string).split(",")[1];
          try {
            const resp = await fetch("/api/transcribe", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ audio: b64, mimeType: blob.type })
            });
            const data = await resp.json();
            if (data.text) {
              setInputValue(prev => (prev ? prev + " " : "") + data.text);
            }
          } catch (err) {
            console.error("Transcribe fetch error:", err);
          }
        };
        reader.readAsDataURL(blob);
      };
      mr.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Mic access error:", err);
      setIsRecording(false);
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || loading) return;

    const userText = inputValue;
    setInputValue('');

    const updatedMessages = [
      ...messages,
      { role: 'user' as const, content: userText }
    ];
    setMessages(updatedMessages);
    setLoading(true);

    try {
      const response = await fetch('/api/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages })
      });

      const data = await response.json();
      if (data.text) {
        // Check if [COMPLETE] exists in response text
        if (data.text.includes('[COMPLETE]')) {
          const parts = data.text.split('[COMPLETE]');
          const cleanText = parts[0].trim();

          // Try parsing JSON from the text after complete
          try {
            const jsonText = parts[1].replace(/```json/g, '').replace(/```/g, '').trim();
            const configData = JSON.parse(jsonText);

            setMessages([
              ...updatedMessages,
              { role: 'model' as const, content: cleanText }
            ]);

            setDetectedConfig({
              project_name: 'Цифровой сотрудник',
              owner_name: configData.owner_name || 'Предприниматель',
              business_name: configData.business_name || 'Мой Бизнес',
              industry: configData.industry || 'Сфера бизнеса',
              channels: configData.channels || ['telegram'],
              tone: configData.tone || 'friendly',
              autonomy_level: configData.autonomy_level || 'full',
              voice_id: 'Kore',
              is_active: true,
              auto_synthesize: false,
              tts_voice: 'Kore'
            });

            // Initialize default agent prompts
            initializeDefaultAgents(configData);
            setStep('agents_setup');
          } catch (err) {
            console.error("Failed to parse COMPLETE JSON:", err);
            // Fallback config
            setDetectedConfig({
              project_name: 'Цифровой сотрудник',
              owner_name: 'Предприниматель',
              business_name: 'Мой Бизнес',
              industry: 'Продажи',
              channels: ['telegram'],
              tone: 'friendly',
              autonomy_level: 'full',
              voice_id: 'Kore',
              is_active: true,
              auto_synthesize: false,
              tts_voice: 'Kore'
            });
            setStep('agents_setup');
          }
        } else {
          setMessages([
            ...updatedMessages,
            { role: 'model' as const, content: data.text }
          ]);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleForceComplete = async () => {
    if (loading) return;
    setLoading(true);

    try {
      const response = await fetch('/api/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, forceComplete: true })
      });

      const data = await response.json();
      if (data.text) {
        if (data.text.includes('[COMPLETE]')) {
          const parts = data.text.split('[COMPLETE]');
          const cleanText = parts[0].trim();

          try {
            const jsonText = parts[1].replace(/```json/g, '').replace(/```/g, '').trim();
            const configData = JSON.parse(jsonText);

            setMessages([
              ...messages,
              { role: 'model' as const, content: cleanText || 'Я проанализировал наши ответы и настроил ваш цифровой штаб!' }
            ]);

            setDetectedConfig({
              project_name: 'Цифровой сотрудник',
              owner_name: configData.owner_name || 'Предприниматель',
              business_name: configData.business_name || 'Мой Бизнес',
              industry: configData.industry || 'Сфера бизнеса',
              channels: configData.channels || ['telegram'],
              tone: configData.tone || 'friendly',
              autonomy_level: configData.autonomy_level || 'full',
              voice_id: 'Kore',
              is_active: true,
              auto_synthesize: false,
              tts_voice: 'Kore'
            });

            initializeDefaultAgents(configData);
            setStep('agents_setup');
          } catch (err) {
            console.error("Failed to parse COMPLETE JSON:", err);
            fallbackComplete();
          }
        } else {
          fallbackComplete();
        }
      } else {
        fallbackComplete();
      }
    } catch (err) {
      console.error(err);
      fallbackComplete();
    } finally {
      setLoading(false);
    }
  };

  const fallbackComplete = () => {
    const defaultData = {
      project_name: 'Цифровой сотрудник',
      owner_name: 'Предприниматель',
      business_name: 'Мой Бизнес',
      industry: 'Продажи',
      channels: ['telegram', 'whatsapp'],
      tone: 'friendly' as const,
      autonomy_level: 'full' as const,
      voice_id: 'Kore',
      is_active: true,
      auto_synthesize: false,
      tts_voice: 'Kore'
    };
    setDetectedConfig(defaultData);
    initializeDefaultAgents(defaultData);
    setStep('agents_setup');
  };

  const initializeDefaultAgents = (configData: any) => {
    const businessName = configData.business_name || 'Мой Бизнес';
    const industry = configData.industry || 'Продажи';
    const ownerName = configData.owner_name || 'Владелец';
    const tone = configData.tone || 'friendly';

    const defaultStaff: Agent[] = [
      {
        id: 'receiver',
        role: 'receiver',
        name: 'Анна',
        russianRole: 'Приемщик (Customer Support)',
        description: 'Отвечает на утренние/вечерние заявки в мессенджерах, дает справку, консультирует по ценам.',
        icon: '👩‍💼',
        status: 'idle',
        channels: configData.channels || ['telegram'],
        systemPrompt: `Ты — ИИ-приемщик Анна в компании "${businessName}" (${industry}). Отвечай вежливо, тон: ${tone}. Консультируй по услугам.`
      },
      {
        id: 'sales',
        role: 'sales',
        name: 'Максим',
        russianRole: 'Продажник (Lead Nurturing & Sales)',
        description: 'Отправляет КП, отрабатывает возражения клиентов, закрывает сделки и вовлекает лидов.',
        icon: '👨‍💼',
        status: 'idle',
        channels: configData.channels || ['telegram'],
        systemPrompt: `Ты — ИИ-продавец Максим в компании "${businessName}". Твоя цель — доводить клиентов до сделки, отправлять коммерческие предложения. Тон: ${tone}.`
      },
      {
        id: 'content',
        role: 'content',
        name: 'Алина',
        russianRole: 'Контент-мейкер (SMM & Content)',
        description: 'Пишет посты по расписанию в соцсети, планирует вовлекающий контент и рассылки.',
        icon: '👩‍🎨',
        status: 'idle',
        channels: configData.channels || ['telegram'],
        systemPrompt: `Ты — ИИ-копирайтер Алина. Создавай вовлекающие и конверсионные посты для "${businessName}".`
      },
      {
        id: 'analyst',
        role: 'analyst',
        name: 'Игорь',
        russianRole: 'Аналитик (Metrics & Reporting)',
        description: 'Отслеживает конверсию обращений в чатах, находит аномалии и делает выгрузку за день.',
        icon: '👨‍🔧',
        status: 'idle',
        channels: configData.channels || ['telegram'],
        systemPrompt: `Ты — ИИ-аналитик Игорь. Анализируй конверсию чатов и давай рекомендации бизнесу "${businessName}".`
      },
      {
        id: 'operator',
        role: 'operator',
        name: 'Супервизор',
        russianRole: 'Операционист-Координатор',
        description: 'Управляет SMART-планом на день, следит за активностью штаба и формирует сводки.',
        icon: '👑',
        status: 'idle',
        channels: configData.channels || ['telegram'],
        systemPrompt: `Ты — Операционный координатор штаба компании "${businessName}". Планируй SMART-задачи для Анны, Максима, Алины и Игоря.`
      }
    ];

    setCustomizedAgents(defaultStaff);
  };

  const handleVoiceCloned = (voiceId: string, encryptedVector: string) => {
    if (detectedConfig) {
      setDetectedConfig({
        ...detectedConfig,
        voice_id: voiceId,
        voice_vector_encrypted: encryptedVector
      });
    }
  };

  const handleAgentPromptChange = (val: string) => {
    setCustomizedAgents(prev =>
      prev.map(a => (a.id === selectedAgentId ? { ...a, systemPrompt: val } : a))
    );
  };

  const handleLaunch = () => {
    if (detectedConfig) {
      onComplete(detectedConfig, customizedAgents);
    }
  };

  const activeAgent = customizedAgents.find(a => a.id === selectedAgentId);

  return (
    <div className="max-w-5xl mx-auto py-4">
      {step === 'welcome' && (
        <div className="space-y-16 text-center max-w-4xl mx-auto py-16 px-4 animate-fade-in">
          <div className="space-y-6">
            <div className="flex items-center justify-center gap-2">
              <span className="text-[11px] font-bold text-accent uppercase tracking-[0.25em] bg-accent/10 px-4.5 py-1.5 rounded-full border border-accent/20 inline-block">
                PREMIUM AI STAFF • ВАШ ЦИФРОВОЙ ШТАБ
              </span>
            </div>
            
            <div className="relative">
              <div className="absolute -top-16 left-1/2 -translate-x-1/2 text-[120px] font-extrabold text-white/[0.03] select-none pointer-events-none font-display">
                01
              </div>
              <h1 className="text-4xl md:text-6xl font-display font-black text-white tracking-tighter leading-tight uppercase">
                Ваш цифровой сотрудник. <br />
                <span className="text-accent italic font-light font-sans tracking-normal lowercase">работает 24/7.</span>
              </h1>
            </div>

            <p className="text-base text-slate-400 max-w-2xl mx-auto leading-relaxed font-light">
              Разверните автономный штат профессиональных ИИ-специалистов за 2 минуты интерактивного интервью. 
              Они автоматизируют ваши продажи, будут отвечать клиентам вашим голосом, разрабатывать SMART-планы 
              и круглосуточно масштабировать ваш бизнес.
            </p>
          </div>

          {/* Core cards visualization */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left max-w-5xl mx-auto pt-4">
            <div className="premium-card p-8 rounded-2xl space-y-4 relative overflow-hidden group">
              <div className="absolute top-4 right-4 text-white/[0.04] text-5xl font-bold select-none">
                I
              </div>
              <div className="bg-accent/10 text-accent p-3 rounded-xl w-12 h-12 flex items-center justify-center group-hover:bg-accent group-hover:text-dark-base transition-all duration-300">
                <Bot className="h-6 w-6" />
              </div>
              <h4 className="text-lg font-bold text-white uppercase tracking-tight font-display">5 ИИ-Профессионалов</h4>
              <p className="text-xs text-slate-400 leading-relaxed font-light">
                Операционист координирует приемщика, продажника, копирайтера и аналитика для бесперебойного достижения бизнес-целей.
              </p>
            </div>

            <div className="premium-card p-8 rounded-2xl space-y-4 relative overflow-hidden group">
              <div className="absolute top-4 right-4 text-white/[0.04] text-5xl font-bold select-none">
                II
              </div>
              <div className="bg-accent/10 text-accent p-3 rounded-xl w-12 h-12 flex items-center justify-center group-hover:bg-accent group-hover:text-dark-base transition-all duration-300">
                <Volume2 className="h-6 w-6" />
              </div>
              <h4 className="text-lg font-bold text-white uppercase tracking-tight font-display">Голосовой Клон</h4>
              <p className="text-xs text-slate-400 leading-relaxed font-light">
                Запишите 10 секунд вашей речи, извлеките шифрованный спектральный вектор и озвучивайте ответы вашим голосом.
              </p>
            </div>

            <div className="premium-card p-8 rounded-2xl space-y-4 relative overflow-hidden group">
              <div className="absolute top-4 right-4 text-white/[0.04] text-5xl font-bold select-none">
                III
              </div>
              <div className="bg-accent/10 text-accent p-3 rounded-xl w-12 h-12 flex items-center justify-center group-hover:bg-accent group-hover:text-dark-base transition-all duration-300">
                <Sparkles className="h-6 w-6" />
              </div>
              <h4 className="text-lg font-bold text-white uppercase tracking-tight font-display">SMART-Планер</h4>
              <p className="text-xs text-slate-400 leading-relaxed font-light">
                Ежедневная автогенерация детальных SMART задач, автоматическая маршрутизация и сбор вечерней аналитической отчетности.
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row justify-center items-center gap-6 pt-8">
            <NeonButton variant="accent" onClick={() => setStep('interview')} className="px-10 py-4.5 text-xs font-semibold tracking-widest shadow-[0_12px_35px_rgba(245,166,35,0.25)] hover:scale-105 transition-all duration-300">
              Создать мой штаб сотрудников
            </NeonButton>
          </div>
        </div>
      )}

      {step === 'interview' && (
        <div className="space-y-12 animate-fade-in max-w-6xl mx-auto py-8">
          {/* Section Heading */}
          <div className="relative text-center md:text-left">
            <div className="absolute -top-10 left-1/2 -translate-x-1/2 md:left-0 md:translate-x-0 text-7xl font-extrabold text-white/[0.03] select-none pointer-events-none font-display">
              02
            </div>
            <span className="text-[11px] font-bold text-accent uppercase tracking-[0.2em] block mb-2">Этап 2: Проектирование</span>
            <h2 className="text-3xl font-display font-black text-white uppercase tracking-tight">AI Собеседование штаба</h2>
            <p className="text-xs text-slate-400 mt-1 max-w-xl">
              Наш интервьюер проанализирует особенности вашей компании, чтобы настроить индивидуальные роли.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Chat with Interviewer */}
            <div className="lg:col-span-2 font-sans">
              <div className="premium-card rounded-2xl flex flex-col justify-between h-[550px] relative overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-white/5 bg-white/[0.01]">
                  <div className="flex items-center gap-3">
                    <Bot className="h-5 w-5 text-accent" />
                    <div>
                      <h4 className="text-sm font-semibold text-white uppercase tracking-wide">Интервьюер Системы</h4>
                      <p className="text-[10px] text-slate-400">Голосовое и текстовое сканирование целей</p>
                    </div>
                  </div>
                  <NeonButton 
                    onClick={handleForceComplete} 
                    variant="accent" 
                    className="text-[10px] px-4 py-2 h-auto flex items-center gap-1.5 shadow-[0_4px_15px_rgba(245,166,35,0.15)]"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Создать штаб 🚀
                  </NeonButton>
                </div>

                {/* Chat Feed */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  {messages.map((m, idx) => (
                    <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[80%] rounded-xl p-4 text-xs ${
                          m.role === 'user'
                            ? 'bg-accent/10 border border-accent/20 text-white rounded-tr-none'
                            : 'bg-white/5 border border-white/5 text-slate-200 rounded-tl-none font-light'
                        }`}
                      >
                        <p className="whitespace-pre-line leading-relaxed">{m.content}</p>
                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div className="flex justify-start">
                      <div className="bg-white/3 border border-white/5 rounded-xl rounded-tl-none p-4 text-xs text-slate-400 flex items-center gap-2">
                        <span className="flex gap-1">
                          <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </span>
                        <span>Формирование оптимальных инструкций...</span>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Text Input Footer */}
                <div className="px-5 py-2 flex flex-col md:flex-row justify-between items-start md:items-center bg-black/20 border-t border-white/5 gap-2">
                  <span className="text-[10px] text-slate-400 font-light">
                    Уже ответили на ключевые вопросы? Вы можете завершить интервью принудительно.
                  </span>
                  <button
                    type="button"
                    onClick={handleForceComplete}
                    className="text-[10px] text-accent hover:text-white transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <Sparkles className="h-3 w-3 animate-pulse text-accent" />
                    Завершить и построить штаб
                  </button>
                </div>
                <form onSubmit={handleSendMessage} className="p-5 bg-black/20 flex gap-2">
                  <button
                    type="button"
                    onClick={toggleRecording}
                    className={`px-4 py-3 rounded-xl border transition-all cursor-pointer ${
                      isRecording
                        ? "bg-red-500/20 border-red-500 text-red-400 animate-pulse"
                        : "bg-white/5 border-white/10 text-slate-400 hover:border-accent hover:text-accent"
                    }`}
                    title="Сказать голосом"
                  >
                    {isRecording ? <StopCircle className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  </button>
                  <input
                    type="text"
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    placeholder="Напишите ответ на вопрос..."
                    className="flex-1 bg-white/5 border border-white/5 rounded-xl px-5 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-accent focus:bg-white/10 transition-all font-light"
                  />
                  <NeonButton type="submit" variant="accent" className="px-5 py-3">
                    <Send className="h-4 w-4" />
                  </NeonButton>
                </form>
              </div>
            </div>

            {/* Quick guide and cloner sidebar */}
            <div className="lg:col-span-1 space-y-6">
              <div className="premium-card rounded-2xl p-6 text-xs space-y-4">
                <h5 className="font-bold text-white uppercase tracking-wider font-display text-xs">💡 План Собеседования:</h5>
                <div className="space-y-3 text-slate-300 font-light">
                  <p className="flex gap-2 items-start">
                    <span className="text-accent font-bold">1.</span>
                    <span>Название вашей компании и имя владельца.</span>
                  </p>
                  <p className="flex gap-2 items-start">
                    <span className="text-accent font-bold">2.</span>
                    <span>Сфера вашей деятельности (например: кофейня, дизайн-студия).</span>
                  </p>
                  <p className="flex gap-2 items-start">
                    <span className="text-accent font-bold">3.</span>
                    <span>Выберите каналы автоматизации.</span>
                  </p>
                  <p className="flex gap-2 items-start">
                    <span className="text-accent font-bold">4.</span>
                    <span>ИИ сформирует инструкции.</span>
                  </p>
                </div>
                <div className="bg-accent/5 border border-accent/20 p-4 rounded-xl text-xxs text-accent font-light leading-relaxed">
                  Вы также можете вводить тестовые ответы для быстрой конфигурации в песочнице!
                </div>
              </div>

              <VoiceRecorder onCloneComplete={handleVoiceCloned} />
            </div>
          </div>
        </div>
      )}

      {step === 'agents_setup' && detectedConfig && (
        <div className="space-y-12 animate-fade-in max-w-6xl mx-auto py-8 font-sans">
          {/* Section Heading */}
          <div className="relative flex flex-col md:flex-row justify-between items-start md:items-end gap-6 pb-2">
            <div className="absolute -top-10 left-1/2 -translate-x-1/2 md:left-0 md:translate-x-0 text-7xl font-extrabold text-white/[0.03] select-none pointer-events-none font-display">
              03
            </div>
            <div>
              <span className="text-[11px] font-bold text-accent uppercase tracking-[0.2em] block mb-2">Этап 3: Калибровка</span>
              <h2 className="text-3xl font-display font-black text-white uppercase tracking-tight">Подтверждение ИИ-штаба</h2>
              <p className="text-xs text-slate-400 mt-1 max-w-xl">
                ИИ автоматически сформировал 5 специализированных сотрудников для вашей компании «{detectedConfig.business_name}». Настройте параметры перед запуском.
              </p>
            </div>
            <NeonButton variant="accent" onClick={handleLaunch} className="px-8 py-4.5 text-xs font-semibold tracking-wider shadow-[0_12px_30px_rgba(245,166,35,0.2)] hover:scale-102 transition-all duration-300">
              Запустить штаб в работу 🚀
            </NeonButton>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Column: Agents Cards */}
            <div className="lg:col-span-5 space-y-3">
              {/* Company config card */}
              <div
                onClick={() => setSelectedAgentId('company')}
                className={`p-5 rounded-2xl border text-left transition-all duration-300 cursor-pointer flex gap-4 items-start ${
                  selectedAgentId === 'company'
                    ? 'border-accent bg-accent/10 shadow-[0_4px_20px_rgba(245,166,35,0.08)] backdrop-blur-md'
                    : 'border-white/10 bg-white/4 backdrop-blur-sm hover:bg-white/8 hover:border-white/15'
                }`}
              >
                <div className="text-2xl bg-white/5 p-3 rounded-xl">⚙️</div>
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-white text-sm block uppercase tracking-wide">Параметры компании</span>
                  <span className="text-accent font-medium text-[11px] block mt-0.5">Общие настройки бизнеса</span>
                  <p className="text-slate-400 mt-2 text-xs truncate">
                    {detectedConfig.business_name} • {detectedConfig.industry}
                  </p>
                </div>
              </div>

              {customizedAgents.map(agent => (
                <div
                  key={agent.id}
                  onClick={() => setSelectedAgentId(agent.id)}
                  className={`p-5 rounded-2xl border text-left transition-all duration-300 cursor-pointer flex gap-4 items-start ${
                    selectedAgentId === agent.id
                      ? 'border-accent bg-accent/10 shadow-[0_4px_20px_rgba(245,166,35,0.08)] backdrop-blur-md'
                      : 'border-white/10 bg-white/4 backdrop-blur-sm hover:bg-white/8 hover:border-white/15'
                  }`}
                >
                  <div className="text-2xl bg-white/5 p-3 rounded-xl">{agent.icon}</div>
                  <div className="flex-1 min-w-0">
                    <span className="font-bold text-white text-sm block uppercase tracking-wide">{agent.name}</span>
                    <span className="text-accent font-medium text-[11px] block mt-0.5">{agent.russianRole}</span>
                    <p className="text-slate-400 mt-2 text-xs truncate font-light">{agent.description}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Right Column: Prompt Customizer Panel */}
            <div className="lg:col-span-7">
              {selectedAgentId === 'company' ? (
                <div className="premium-card rounded-2xl p-8 flex flex-col justify-between h-full space-y-6">
                  <div className="space-y-6">
                    <div className="flex items-center justify-between border-b border-white/5 pb-4">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">⚙️</span>
                        <div>
                          <h4 className="text-sm font-bold text-white uppercase tracking-wider">Параметры компании</h4>
                          <span className="text-[10px] text-accent font-medium">Общие настройки цифрового штаба</span>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-slate-400 uppercase tracking-wider block">
                          Название компании:
                        </label>
                        <input
                          type="text"
                          value={detectedConfig.business_name}
                          onChange={e => setDetectedConfig({ ...detectedConfig, business_name: e.target.value })}
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-accent focus:bg-black/60 transition-all font-light"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-slate-400 uppercase tracking-wider block">
                          Имя владельца:
                        </label>
                        <input
                          type="text"
                          value={detectedConfig.owner_name}
                          onChange={e => setDetectedConfig({ ...detectedConfig, owner_name: e.target.value })}
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-accent focus:bg-black/60 transition-all font-light"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] text-slate-400 uppercase tracking-wider block">
                        Сфера деятельности (Индустрия):
                      </label>
                      <input
                        type="text"
                        value={detectedConfig.industry}
                        onChange={e => setDetectedConfig({ ...detectedConfig, industry: e.target.value })}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-accent focus:bg-black/60 transition-all font-light"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-slate-400 uppercase tracking-wider block">
                          Стиль общения (Тон):
                        </label>
                        <select
                          value={detectedConfig.tone}
                          onChange={e => setDetectedConfig({ ...detectedConfig, tone: e.target.value as any })}
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-accent focus:bg-black/60 transition-all font-light"
                        >
                          <option value="friendly">Дружелюбный</option>
                          <option value="professional">Деловой / Профессиональный</option>
                          <option value="energetic">Энергичный</option>
                          <option value="elegant">Элегантный</option>
                          <option value="strict">Строгий</option>
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] text-slate-400 uppercase tracking-wider block">
                          Уровень автономности:
                        </label>
                        <select
                          value={detectedConfig.autonomy_level}
                          onChange={e => setDetectedConfig({ ...detectedConfig, autonomy_level: e.target.value as any })}
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-accent focus:bg-black/60 transition-all font-light"
                        >
                          <option value="full">Полная автономность (ИИ 24/7)</option>
                          <option value="human-supervised">Контроль человеком (Полуавтомат)</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-slate-400 uppercase tracking-wider block">
                          Автоозвучка ответов:
                        </label>
                        <label className="relative flex items-center gap-2 cursor-pointer pt-2">
                          <input
                            type="checkbox"
                            checked={detectedConfig.auto_synthesize || false}
                            onChange={e => setDetectedConfig({ ...detectedConfig, auto_synthesize: e.target.checked })}
                            className="sr-only peer"
                          />
                          <div className="w-9 h-5 bg-black/60 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[10px] after:left-[2px] after:bg-slate-500 after:border-slate-400 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent/30 peer-checked:after:bg-accent peer-checked:after:border-accent border border-white/10" />
                          <span className="text-xxs font-semibold text-slate-300">
                            {detectedConfig.auto_synthesize ? 'Включена' : 'Выключена'}
                          </span>
                        </label>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] text-slate-400 uppercase tracking-wider block">
                          Выбор голоса ИИ:
                        </label>
                        <select
                          value={detectedConfig.tts_voice || 'Kore'}
                          onChange={e => setDetectedConfig({ ...detectedConfig, tts_voice: e.target.value })}
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-accent focus:bg-black/60 transition-all font-light"
                        >
                          <option value="Kore">Kore</option>
                          <option value="Puck">Puck</option>
                          <option value="Charon">Charon</option>
                          <option value="Fenrir">Fenrir</option>
                          <option value="Zephyr">Zephyr</option>
                        </select>
                      </div>
                    </div>

                    <div className="text-[10px] text-accent/80 italic bg-accent/5 p-3 rounded-xl border border-accent/10 leading-relaxed font-light">
                      💡 Это стандартные нейро-голоса. Персональный клон вашего голоса будет доступен после завершения калибровки клона.
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] text-slate-400 uppercase tracking-wider block">
                        Используемые каналы связи:
                      </label>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {['telegram', 'whatsapp', 'vk', 'email'].map(ch => {
                          const hasCh = detectedConfig.channels.includes(ch);
                          return (
                            <button
                              key={ch}
                              type="button"
                              onClick={() => {
                                const newChannels = hasCh
                                  ? detectedConfig.channels.filter(c => c !== ch)
                                  : [...detectedConfig.channels, ch];
                                setDetectedConfig({ ...detectedConfig, channels: newChannels });
                              }}
                              className={`px-4 py-2 rounded-xl border text-xxs uppercase transition-all duration-200 cursor-pointer ${
                                hasCh
                                  ? 'bg-accent/10 border-accent text-accent font-semibold shadow-[0_2px_10px_rgba(245,166,35,0.1)]'
                                  : 'bg-transparent border-white/10 text-slate-400 hover:border-white/20'
                              }`}
                            >
                              {ch}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-white/5 pt-4 mt-6 flex justify-between items-center text-[10px] text-slate-500 font-light">
                    <span>Все изменения применяются ко всему штабу ИИ-агентов</span>
                    <span className="text-accent font-semibold">Параметры синхронизированы</span>
                  </div>
                </div>
              ) : (
                activeAgent && (
                  <div className="premium-card rounded-2xl p-8 flex flex-col justify-between h-full space-y-6">
                    <div className="space-y-6">
                      <div className="flex items-center justify-between border-b border-white/5 pb-4">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl bg-white/5 p-2.5 rounded-xl">{activeAgent.icon}</span>
                          <div>
                            <h4 className="text-sm font-bold text-white uppercase tracking-wider">{activeAgent.name}</h4>
                            <span className="text-[10px] text-accent uppercase tracking-wider">{activeAgent.russianRole}</span>
                          </div>
                        </div>
                        <span className="text-[9px] bg-accent/10 text-accent px-2.5 py-1 rounded-full uppercase font-bold tracking-wider border border-accent/20">
                          Настройка ИИ
                        </span>
                      </div>

                      <p className="text-xs text-slate-300 leading-relaxed font-light">
                        {activeAgent.description}
                      </p>

                      <div className="space-y-1.5">
                        <label className="text-[10px] text-slate-400 uppercase tracking-wider block">
                          Системный промт (Инструкция поведения):
                        </label>
                        <textarea
                          value={activeAgent.systemPrompt}
                          onChange={e => handleAgentPromptChange(e.target.value)}
                          rows={10}
                          className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-xs text-slate-200 focus:outline-none focus:border-accent focus:bg-black/60 transition-all leading-relaxed"
                        />
                      </div>
                    </div>

                    <div className="border-t border-white/5 pt-4 mt-6 flex justify-between items-center text-[10px] text-slate-500 font-light">
                      <span>Поддерживаемые каналы: {detectedConfig.channels.join(', ')}</span>
                      <span className="text-accent font-semibold">Статус: Готов к запуску</span>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
