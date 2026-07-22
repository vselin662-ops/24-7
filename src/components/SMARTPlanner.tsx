import React, { useState, useEffect, useRef } from 'react';
import * as Icons from 'lucide-react';
import { AppConfig, Agent } from '../types';

interface AgentPlan {
  agent: string;
  title: string;
  mission: string;
  icon: string;
}

interface SMARTPlannerProps {
  businessName: string;
  ownerName: string;
  industry: string;
  tone: string;
  channels: string[];
  onComplete?: (config: AppConfig, agents: Agent[]) => void;
  setCurrentTab?: (tab: string) => void;
}

export const SMARTPlanner: React.FC<SMARTPlannerProps> = ({
  businessName,
  ownerName,
  industry,
  tone,
  channels,
  onComplete,
  setCurrentTab
}) => {
  const [questStep, setQuestStep] = useState<'intro' | 'plan'>('intro');
  const [plan, setPlan] = useState<AgentPlan[]>([]);
  const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<'idle' | 'transcribing' | 'assembling' | 'error'>('idle');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const toggleRecording = async () => {
    if (isRecording) {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
      }
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
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mr.mimeType || "audio/webm" });
        setIsRecording(false);
        setProcessingStatus('transcribing');

        const reader = new FileReader();
        reader.onloadend = async () => {
          const b64 = (reader.result as string).split(",")[1];
          try {
            const r = await fetch("/api/transcribe", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ audio: b64, mimeType: blob.type })
            });
            const d = await r.json();
            if (d.text && d.text.trim()) {
              setProcessingStatus('assembling');

              const response = await fetch('/api/interview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  messages: [{ role: 'user', content: d.text }],
                  forceComplete: true
                })
              });

              if (!response.ok) {
                throw new Error("Interview API error");
              }
              const data = await response.json();
              if (data.text) {
                if (data.text.includes('[COMPLETE]')) {
                  const parts = data.text.split('[COMPLETE]');
                  try {
                    const jsonText = parts[1].replace(/```json/g, '').replace(/```/g, '').trim();
                    const configData = JSON.parse(jsonText);

                    const newConfig: AppConfig = {
                      project_name: 'Цифровой сотрудник',
                      owner_name: configData.owner_name || ownerName || 'Предприниматель',
                      business_name: configData.business_name || businessName || 'Мой Бизнес',
                      industry: configData.industry || industry || 'Сфера бизнеса',
                      channels: configData.channels || channels || ['telegram'],
                      tone: configData.tone || tone || 'friendly',
                      autonomy_level: configData.autonomy_level || 'full',
                      voice_id: 'Kore',
                      is_active: true,
                      auto_synthesize: false,
                      tts_voice: 'Kore'
                    };

                    const customizedAgents = initializeDefaultAgents(configData);
                    if (onComplete) {
                      onComplete(newConfig, customizedAgents);
                    }

                    const agentPlans: AgentPlan[] = customizedAgents.map(a => ({
                      agent: a.id,
                      title: a.russianRole,
                      mission: a.description,
                      icon: getAgentIcon(a.id)
                    }));

                    setPlan(agentPlans);
                    setQuestStep('plan');
                    setProcessingStatus('idle');
                  } catch (err) {
                    console.error("Failed to parse COMPLETE JSON:", err);
                    fallbackComplete();
                    setProcessingStatus('idle');
                  }
                } else {
                  fallbackComplete();
                  setProcessingStatus('idle');
                }
              } else {
                fallbackComplete();
                setProcessingStatus('idle');
              }
            } else {
              setProcessingStatus('error');
              setTimeout(() => setProcessingStatus('idle'), 3000);
            }
          } catch (e) {
            console.error("Processing error:", e);
            setProcessingStatus('error');
            setTimeout(() => setProcessingStatus('idle'), 3000);
          }
        };
        reader.readAsDataURL(blob);
      };
      mr.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Mic access error:", err);
      setProcessingStatus('error');
      setTimeout(() => setProcessingStatus('idle'), 3000);
      setIsRecording(false);
    }
  };

  const getAgentIcon = (id: string): string => {
    switch (id) {
      case 'receiver': return 'MessageSquare';
      case 'sales': return 'DollarSign';
      case 'content': return 'PenTool';
      case 'analyst': return 'BarChart2';
      default: return 'CheckSquare';
    }
  };

  const initializeDefaultAgents = (configData: any): Agent[] => {
    const bName = configData.business_name || businessName || 'Мой Бизнес';
    const ind = configData.industry || industry || 'Продажи';
    const oName = configData.owner_name || ownerName || 'Владелец';
    const t = configData.tone || tone || 'friendly';

    return [
      {
        id: 'receiver',
        role: 'receiver',
        name: 'Анна',
        russianRole: 'Приемщик (Customer Support)',
        description: 'Отвечает на утренние/вечерние заявки в мессенджерах, дает справку, консультирует по ценам.',
        icon: '👩‍💼',
        status: 'idle',
        channels: configData.channels || channels || ['telegram'],
        systemPrompt: `Ты — ИИ-приемщик Анна в компании "${bName}" (${ind}). Отвечай вежливо, тон: ${t}. Консультируй по услугам.`
      },
      {
        id: 'sales',
        role: 'sales',
        name: 'Максим',
        russianRole: 'Продажник (Lead Nurturing & Sales)',
        description: 'Отправляет КП, отрабатывает возражения клиентов, закрывает сделки и вовлекает лидов.',
        icon: '👨‍💼',
        status: 'idle',
        channels: configData.channels || channels || ['telegram'],
        systemPrompt: `Ты — ИИ-продавец Максим в компании "${bName}". Твоя цель — доводить клиентов до сделки, отправлять коммерческие предложения. Тон: ${t}.`
      },
      {
        id: 'content',
        role: 'content',
        name: 'Алина',
        russianRole: 'Контент-мейкер (SMM & Content)',
        description: 'Пишет посты по расписанию в соцсети, планирует вовлекающий контент и рассылки.',
        icon: '👩‍🎨',
        status: 'idle',
        channels: configData.channels || channels || ['telegram'],
        systemPrompt: `Ты — ИИ-копирайтер Алина. Создавай вовлекающие и конверсионные посты для "${bName}".`
      },
      {
        id: 'analyst',
        role: 'analyst',
        name: 'Игорь',
        russianRole: 'Аналитик (Metrics & Reporting)',
        description: 'Отслеживает конверсию обращений в чатах, находит аномалии и делает выгрузку за день.',
        icon: '👨‍🔧',
        status: 'idle',
        channels: configData.channels || channels || ['telegram'],
        systemPrompt: `Ты — ИИ-аналитик Игорь. Анализируй конверсию чатов и давай рекомендации бизнесу "${bName}".`
      },
      {
        id: 'operator',
        role: 'operator',
        name: 'Супервизор',
        russianRole: 'Операционист-Координатор',
        description: 'Управляет SMART-планом на день, следит за активностью штаба и формирует сводки.',
        icon: '👑',
        status: 'idle',
        channels: configData.channels || channels || ['telegram'],
        systemPrompt: `Ты — Операционный координатор штаба компании "${bName}". Направляй SMART-задачи для Анны, Максима, Алины и Игоря.`
      }
    ];
  };

  const fallbackComplete = () => {
    const defaultData: AppConfig = {
      project_name: 'Цифровой сотрудник',
      owner_name: ownerName || 'Предприниматель',
      business_name: businessName || 'Мой Бизнес',
      industry: industry || 'Продажи',
      channels: channels || ['telegram', 'whatsapp'],
      tone: (tone as any) || 'friendly',
      autonomy_level: 'full',
      voice_id: 'Kore',
      is_active: true,
      auto_synthesize: false,
      tts_voice: 'Kore'
    };
    const customizedAgents = initializeDefaultAgents(defaultData);
    if (onComplete) {
      onComplete(defaultData, customizedAgents);
    }
    const agentPlans: AgentPlan[] = customizedAgents.map(a => ({
      agent: a.id,
      title: a.russianRole,
      mission: a.description,
      icon: getAgentIcon(a.id)
    }));
    setPlan(agentPlans);
    setQuestStep('plan');
  };

  const renderIcon = (iconName: string) => {
    const IconComponent = (Icons as any)[iconName] || Icons.HelpCircle;
    return <IconComponent className="h-8 w-8 text-[#F5A623] shrink-0" />;
  };

  return (
    <div className="w-full min-h-[600px] bg-white/4 backdrop-blur-xl text-white rounded-3xl border border-white/10 p-6 md:p-12 font-sans relative overflow-hidden transition-all duration-300 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)]">
      
      {/* Absolute Background Ambient Glows */}
      <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-[#F5A623]/5 blur-[120px] pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-[#F5A623]/5 blur-[120px] pointer-events-none" />

      {/* 1. SINGLE VOICE ONBOARDING SCREEN */}
      {questStep === 'intro' && (
        <div className="flex flex-col items-center text-center justify-center py-16 max-w-2xl mx-auto space-y-12 animate-fade-in">
          <div className="h-16 w-16 rounded-2xl bg-[#F5A623]/10 border border-[#F5A623]/20 flex items-center justify-center shadow-[0_0_30px_rgba(245,166,35,0.1)]">
            <Icons.Compass className="h-8 w-8 text-[#F5A623] animate-spin-slow" />
          </div>

          <div className="space-y-4">
            <h1 className="text-4xl md:text-5xl font-black text-white tracking-tighter uppercase leading-tight">
              Я ваш <span className="text-[#F5A623] italic lowercase font-light">интеллектуальный</span> помощник
            </h1>
            <p className="text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
              Нажмите на микрофон и расскажите, что нужно автоматизировать в вашем бизнесе — я зафиксирую задачу и соберу цифровой штаб под неё.
            </p>
          </div>

          <div className="flex flex-col items-center space-y-4">
            <button
              disabled={processingStatus === 'transcribing' || processingStatus === 'assembling'}
              onClick={toggleRecording}
              className={`w-24 h-24 rounded-full flex items-center justify-center border transition-all duration-300 cursor-pointer shadow-lg hover:shadow-[#F5A623]/10 ${
                isRecording
                  ? "bg-red-500/20 border-red-500 text-red-400 animate-pulse"
                  : "bg-[#F5A623]/10 border-[#F5A623]/30 text-[#F5A623] hover:border-[#F5A623] hover:bg-[#F5A623]/15"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isRecording ? (
                <Icons.StopCircle className="h-10 w-10" />
              ) : (
                <Icons.Mic className="h-10 w-10" />
              )}
            </button>
            <div className="min-h-[24px]">
              {isRecording ? (
                <span className="text-sm text-red-400 font-medium animate-pulse">Слушаю... нажмите, чтобы закончить</span>
              ) : processingStatus === 'transcribing' ? (
                <div className="flex items-center gap-2 justify-center">
                  <Icons.Loader2 className="h-4 w-4 text-[#F5A623] animate-spin" />
                  <span className="text-xs text-slate-400 font-medium">Распознаю речь...</span>
                </div>
              ) : processingStatus === 'assembling' ? (
                <div className="flex items-center gap-2 justify-center">
                  <Icons.Loader2 className="h-4 w-4 text-[#F5A623] animate-spin" />
                  <span className="text-xs text-slate-400 font-medium">Собираю ваш штаб под задачу...</span>
                </div>
              ) : processingStatus === 'error' ? (
                <span className="text-xxs text-red-400 font-medium">Не расслышал, попробуйте ещё раз</span>
              ) : (
                <span className="text-xxs text-slate-500 uppercase tracking-wider">говорите свободно, 10–30 секунд</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. PLAN RESULTS SCREEN */}
      {questStep === 'plan' && plan.length > 0 && (
        <div className="space-y-10 animate-fade-in text-left">
          
          {/* Top Banner Header */}
          <div className="space-y-3">
            <span className="text-xs uppercase tracking-[0.3em] font-semibold text-[#F5A623]">задачи распределены по ролям</span>
            <h2 className="text-3xl md:text-4xl font-black uppercase tracking-tight text-white">
              Что будет делать ваш штаб
            </h2>
            <p className="text-base text-slate-400 font-light max-w-2xl leading-relaxed">
              Мы синтезировали ваши выборы на станциях квеста и распределили задачи между 5 ИИ-сотрудниками. Каждый знает свои обязанности и готов приступить к работе.
            </p>
          </div>

          {/* Cards for each of the 5 agents */}
          <div className="space-y-6">
            {plan.map((agent, idx) => (
              <div
                key={idx}
                className="bg-white/4 border border-white/10 backdrop-blur-md p-6 md:p-8 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6 hover:border-accent/25 hover:bg-white/6 transition-all duration-300 shadow-[0_4px_20px_rgba(0,0,0,0.2)] hover:shadow-[0_0_20px_rgba(245,166,35,0.1)]"
              >
                <div className="flex items-start md:items-center gap-6">
                  {/* Large Icon Box */}
                  <div className="h-16 w-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center shrink-0">
                    {renderIcon(agent.icon || "Users")}
                  </div>
                  
                  {/* Agent Info & Mission details */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-xl font-bold text-white tracking-tight">
                        {agent.title}
                      </h3>
                      <span className="text-[10px] text-[#F5A623] uppercase tracking-wider border border-[#F5A623]/20 bg-[#F5A623]/5 px-2.5 py-0.5 rounded-full">
                        Активен
                      </span>
                    </div>
                    <p className="text-[15px] md:text-[16px] text-slate-300 font-light leading-relaxed max-w-3xl">
                      {agent.mission}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* CTA "Запустить штаб" */}
          <div className="pt-8 border-t border-white/[0.08] flex flex-col sm:flex-row items-center justify-between gap-6">
            <button
              onClick={() => {
                setQuestStep('intro');
                setPlan([]);
              }}
              className="text-sm uppercase tracking-wider text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
            >
              Пройти квест заново
            </button>

            <button
              onClick={() => setIsSuccessModalOpen(true)}
              className="w-full sm:w-auto bg-[#F5A623] hover:bg-[#e09212] text-[#0A0A0B] text-base font-bold py-4 px-10 rounded-xl transition-all duration-300 transform hover:scale-[1.02] shadow-[0_4px_20px_rgba(245,166,35,0.25)] cursor-pointer tracking-wider uppercase flex items-center justify-center gap-2"
            >
              <Icons.Zap className="h-5 w-5 fill-current" /> Запустить штаб в работу
            </button>
          </div>
        </div>
      )}

      {/* Success celebration modal */}
      {isSuccessModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-lg flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-[#0E0E10]/90 border border-white/12 backdrop-blur-xl rounded-3xl p-8 md:p-12 max-w-lg w-full text-center space-y-6 shadow-2xl relative">
            <div className="h-16 w-16 rounded-2xl bg-[#F5A623]/10 border border-[#F5A623]/20 flex items-center justify-center mx-auto shadow-[0_0_30px_rgba(245,166,35,0.25)]">
              <Icons.Sparkles className="h-8 w-8 text-[#F5A623] animate-pulse" />
            </div>

            <div className="space-y-3">
              <h3 className="text-2xl md:text-3xl font-black uppercase text-white tracking-tight">Штаб успешно запущен!</h3>
              <p className="text-sm text-slate-400 font-light leading-relaxed">
                Поздравляем! Все 5 ИИ-сотрудников активированы и настроены на алгоритмы вашего бизнеса в сфере "{industry || "Общие услуги"}". Проверьте вкладку "Каналы связи", чтобы протестировать их работу в реальном времени!
              </p>
            </div>

            <button
              onClick={() => {
                setIsSuccessModalOpen(false);
                if (setCurrentTab) {
                  setCurrentTab('simulator');
                }
              }}
              className="w-full bg-[#F5A623] hover:bg-[#e09212] text-[#0A0A0B] text-sm font-bold py-3.5 rounded-xl transition-all duration-300 cursor-pointer uppercase tracking-wider"
            >
              Отлично, к симулятору!
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
