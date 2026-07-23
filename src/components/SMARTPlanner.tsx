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
  const EAGLE_BG = "";
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
    <div className="w-full min-h-[600px] bg-[#0E0C0B]/90 backdrop-blur-xl text-white rounded-3xl border border-white/[0.08] p-6 md:p-12 font-sans relative overflow-hidden transition-all duration-300 shadow-[0_24px_70px_rgba(0,0,0,0.6)]">
      
      {/* Absolute Background Ambient Glows */}
      <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-[#F5A623]/2 blur-[120px] pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-[#F5A623]/2 blur-[120px] pointer-events-none" />

      {/* 1. SINGLE VOICE ONBOARDING SCREEN */}
      {questStep === 'intro' && (
        <section className="relative w-full min-h-[88vh] overflow-hidden rounded-3xl flex flex-col items-center justify-center px-6 py-16">
          {/* СЛОЙ ФОТО (опциональный) */}
          {EAGLE_BG && (
            <div 
              className="absolute inset-0 bg-cover bg-center pointer-events-none z-0" 
              style={{ backgroundImage: `url(${EAGLE_BG})`, animation: 'kenburns 26s ease-in-out infinite' }} 
            />
          )}

          {/* СЛОЙ ПРОЦЕДУРНЫЙ ПЕЙЗАЖ */}
          <div className="absolute inset-0 pointer-events-none z-0" style={{ animation: 'kenburns 30s ease-in-out infinite' }}>
            {/* небо */}
            <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,#0a1018 0%, #16202b 38%, #2a3340 60%, #4a4636 80%, #1a1d22 100%)' }} />
            
            {/* тёплый отсвет горизонта */}
            <div className="absolute left-1/2 top-[42%] -translate-x-1/2 w-[60%] h-[22%] rounded-full" style={{ background: 'radial-gradient(ellipse at center, rgba(245,166,35,0.30), rgba(245,166,35,0) 70%)', filter: 'blur(20px)' }} />
            
            {/* горы дальние */}
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1000 1000" preserveAspectRatio="none">
              <polygon points="0,1000 0,550 200,420 350,480 500,380 680,470 850,400 1000,520 1000,1000" fill="#1c2730" />
              <polygon points="0,1000 0,600 150,520 300,580 450,460 600,540 750,480 900,560 1000,620 1000,1000" fill="#141c24" />
              <polygon points="0,1000 0,660 100,610 250,650 400,540 550,620 700,560 850,630 1000,680 1000,1000" fill="#0d1319" />
            </svg>
            
            {/* река */}
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1000 1000" preserveAspectRatio="none">
              <path d="M 500,580 Q 480,680 530,780 T 450,1000" stroke="rgba(180,200,210,0.5)" strokeWidth="10" fill="none" style={{ animation: 'riverShimmer 5s infinite' }} />
            </svg>
            
            {/* лес снизу */}
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1000 1000" preserveAspectRatio="none">
              <polygon points="0,1000 0,720 20,700 40,730 60,705 80,725 100,695 120,720 140,700 160,730 180,710 200,725 220,695 240,715 260,700 280,735 300,710 320,730 340,705 360,725 380,695 400,720 420,700 440,730 460,710 480,725 500,695 520,715 540,700 560,735 580,710 600,730 620,705 640,725 660,695 680,720 700,700 720,730 740,710 760,725 780,695 800,715 820,700 840,735 860,710 880,730 900,705 920,725 940,695 960,720 980,700 1000,730 1000,1000" fill="#0a0f14" />
            </svg>
            
            {/* туман */}
            <div className="absolute left-[10%] top-[40%] w-[40%] h-[15%] rounded-full" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 70%)', filter: 'blur(30px)', animation: 'fogDrift 18s ease-in-out infinite' }} />
            <div className="absolute right-[15%] top-[48%] w-[45%] h-[12%] rounded-full" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 70%)', filter: 'blur(30px)', animation: 'fogDrift 24s ease-in-out infinite' }} />
            <div className="absolute left-[30%] top-[52%] w-[35%] h-[14%] rounded-full" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 70%)', filter: 'blur(30px)', animation: 'fogDrift 30s ease-in-out infinite' }} />
          </div>

          {/* СЛОЙ ВИНЬЕТКА */}
          <div className="absolute inset-0 pointer-events-none z-[1]" style={{ background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 35%, rgba(0,0,0,0.55) 100%)' }} />

          {/* СЛОЙ ОРЁЛ (анимированный силуэт) */}
          <div className="absolute top-0 left-0 w-[150px] h-[60px] md:w-[180px] md:h-[72px] pointer-events-none z-[5]" style={{ animation: 'eagleFly 22s linear infinite' }}>
            <svg viewBox="0 0 200 80" className="w-full h-full" style={{ filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.7)) drop-shadow(0 0 6px rgba(245,166,35,0.25))' }}>
              {/* тело+голова+хвост */}
              <path d="M92 38 q8 -6 16 0 q4 3 2 8 l-2 10 q-6 4 -12 0 l-2 -10 q-2 -5 -2 -8 z" fill="#2b3744" stroke="rgba(248,210,150,0.55)" strokeWidth="1" />
              {/* голова-клюв */}
              <path d="M100 34 q3 -4 7 -2 q2 2 0 4 z" fill="#2b3744" stroke="rgba(248,210,150,0.55)" strokeWidth="1" />
              {/* левое крыло */}
              <path d="M92 40 C70 30 40 26 8 34 C36 40 64 44 90 46 Z" fill="#2b3744" stroke="rgba(248,210,150,0.55)" strokeWidth="1" style={{ transformBox: 'fill-box', transformOrigin: 'right center', animation: 'flapL 1.1s ease-in-out infinite' }} />
              {/* правое крыло */}
              <path d="M108 40 C130 30 160 26 192 34 C164 40 136 44 110 46 Z" fill="#2b3744" stroke="rgba(248,210,150,0.55)" strokeWidth="1" style={{ transformBox: 'fill-box', transformOrigin: 'left center', animation: 'flapR 1.1s ease-in-out infinite' }} />
            </svg>
          </div>

          {/* КОНТЕНТ */}
          <div className="relative z-10 flex flex-col items-center text-center pointer-events-none">
            {/* верхний якорь */}
            <p className="font-ui text-[11px] tracking-[0.12em] text-white/55 mb-3 uppercase">Selin · автономный штаб</p>
            
            {/* заголовок */}
            <h1 className="font-sans font-semibold text-3xl md:text-5xl text-white leading-tight tracking-tight">
              Расскажите задачу —<br />штаб соберётся сам
            </h1>
            
            {/* подзаголовок */}
            <p className="font-ui text-sm text-white/65 max-w-md mt-4 leading-relaxed">
              Нажмите на микрофон и опишите бизнес голосом. Я пойму суть и подберу команду под неё — а если не расслышу, честно переспрошу.
            </p>
            
            {/* СТЕКЛЯННАЯ КНОПКА МИКРОФОНА */}
            <button
              type="button"
              disabled={processingStatus === 'transcribing' || processingStatus === 'assembling'}
              onClick={toggleRecording}
              className={`pointer-events-auto relative w-28 h-28 rounded-full flex items-center justify-center cursor-pointer transition-transform duration-300 active:scale-95 mt-10 ${
                isRecording ? 'bg-red-600/18 border-red-400/50 animate-pulse' : ''
              } disabled:opacity-50 disabled:cursor-not-allowed`}
              style={{
                background: isRecording ? 'rgba(220, 38, 38, 0.18)' : 'rgba(255,255,255,0.06)',
                border: isRecording ? '1px solid rgba(248, 113, 113, 0.5)' : '1px solid rgba(255,255,255,0.18)',
                backdropFilter: 'blur(14px)',
                WebkitBackdropFilter: 'blur(14px)',
                animation: isRecording ? 'none' : 'glassPulse 4s ease-in-out infinite',
                boxShadow: '0 20px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.2)'
              }}
            >
              {isRecording ? (
                <Icons.StopCircle className="h-10 w-10 text-red-300" />
              ) : (
                <Icons.Mic className="h-10 w-10 text-[#F5A623]" />
              )}
              {/* вокруг кнопки тонкое янтарное кольцо */}
              <span className="absolute -inset-1 rounded-full border border-[#F5A623]/30" />
            </button>
            
            {/* подпись под кнопкой */}
            <div className="min-h-[24px] mt-4 pointer-events-auto">
              {isRecording ? (
                <span className="text-sm text-red-300 font-medium">Слушаю… нажмите, чтобы закончить</span>
              ) : processingStatus === 'transcribing' ? (
                <div className="flex items-center gap-2 justify-center text-xs text-white/60">
                  <Icons.Loader2 className="h-4 w-4 text-[#F5A623] animate-spin" />
                  <span>Распознаю речь…</span>
                </div>
              ) : processingStatus === 'assembling' ? (
                <div className="flex items-center gap-2 justify-center text-xs text-white/60">
                  <Icons.Loader2 className="h-4 w-4 text-[#F5A623] animate-spin" />
                  <span>Собираю штаб…</span>
                </div>
              ) : processingStatus === 'error' ? (
                <span className="text-xs text-red-300">Не расслышал, попробуйте ещё раз</span>
              ) : (
                <span className="text-white/45 text-xs">говорите свободно, 10–30 секунд</span>
              )}
            </div>
          </div>
        </section>
      )}

      {/* 2. PLAN RESULTS SCREEN */}
      {questStep === 'plan' && plan.length > 0 && (
        <div className="space-y-10 animate-fade-in text-left">
          
          {/* Top Banner Header */}
          <div className="space-y-3 pb-4 border-b border-white/[0.08]">
            <span className="text-[10px] tracking-[0.1em] text-[#F5A623]/70 uppercase block">задачи распределены по ролям</span>
            <h2 className="text-3xl md:text-4xl font-lux font-light text-white leading-snug">
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
