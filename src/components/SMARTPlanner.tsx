import React, { useState, useRef, useEffect } from 'react';
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

// Шаблоны миссий для динамической генерации (если сервер не вернул план)
const ROLE_TEMPLATES: Record<string, { title: string; missionTemplate: (b: string, i: string, t: string) => string; icon: string }> = {
  receiver: { 
    title: 'Приемщик заявок', 
    missionTemplate: (b, i, t) => `Мгновенно отвечает клиентам в мессенджерах компании "${b}" (${i}). Консультирует по ценам и записывает на услуги. Тон: ${t}.`, 
    icon: 'MessageSquare' 
  },
  sales: { 
    title: 'Менеджер по продажам', 
    missionTemplate: (b, i, t) => `Работает с лидами компании "${b}". Отправляет КП, отрабатывает возражения и доводит до оплаты. Тон: ${t}.`, 
    icon: 'DollarSign' 
  },
  content: { 
    title: 'Контент-мейкер', 
    missionTemplate: (b, i, t) => `Создает посты и рассылки для "${b}" в нише "${i}". Пишет вовлекающие тексты по расписанию. Тон: ${t}.`, 
    icon: 'PenTool' 
  },
  analyst: { 
    title: 'Бизнес-аналитик', 
    missionTemplate: (b, i, t) => `Анализирует переписки и метрики "${b}". Находит точки роста и делает ежедневные отчеты. Тон: ${t}.`, 
    icon: 'BarChart3' 
  },
  operator: { 
    title: 'Координатор штаба', 
    missionTemplate: (b, i, t) => `Управляет задачами всех агентов "${b}". Формирует сводки для владельца и следит за качеством. Тон: ${t}.`, 
    icon: 'CheckSquare' 
  }
};

export const SMARTPlanner: React.FC<SMARTPlannerProps> = ({
  businessName, ownerName, industry, tone, channels, onComplete, setCurrentTab
}) => {
  const urlParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const tgMode = urlParams.get('mode'); // 'onboarding' | 'dashboard' | null
  const isTelegram = typeof window !== 'undefined' && !!(window as any).Telegram?.WebApp;

  const EAGLE_BG = ""; // Вставь путь к картинке орла, если есть
  const [questStep, setQuestStep] = useState<'intro' | 'plan' | 'needs_clarification'>('intro');
  const [plan, setPlan] = useState<AgentPlan[]>([]);
  const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<'idle' | 'transcribing' | 'assembling' | 'error' | 'clarifying'>('idle');
  const [clarifyMessage, setClarifyMessage] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (isTelegram) {
      try {
        const tg = (window as any).Telegram?.WebApp;
        if (tg) {
          tg.expand?.();
          tg.setHeaderColor?.('#050505');
          tg.setBackgroundColor?.('#050505');
        }
      } catch (e) {
        console.warn("Telegram WebApp expand error:", e);
      }
    }
  }, [isTelegram]);

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
      
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mr.mimeType || "audio/webm" });
        setIsRecording(false);
        setProcessingStatus('transcribing');

        const reader = new FileReader();
        reader.onloadend = async () => {
          const b64 = (reader.result as string).split(",")[1];
          try {
            // 1. Транскрипция
            const trRes = await fetch("/api/transcribe", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ audio: b64, mimeType: blob.type })
            });
            const trData = await trRes.json();
            
            if (!trData.text || !trData.text.trim()) {
              setProcessingStatus('error');
              setTimeout(() => setProcessingStatus('idle'), 3000);
              return;
            }

            // 2. Интервью (forceComplete)
            setProcessingStatus('assembling');
            const intRes = await fetch('/api/interview', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ messages: [{ role: 'user', content: trData.text }], forceComplete: true })
            });
            const intData = await intRes.json();

            if (!intData.text || !intData.text.includes('[COMPLETE]')) {
              // Сервер не смог завершить интервью → просит уточнить
              setClarifyMessage(intData.text || "Я пока не уловил суть. Скажите парой слов: какой у вас бизнес и что нужно автоматизировать?");
              setProcessingStatus('clarifying');
              return;
            }

            // 3. Парсинг конфига
            const parts = intData.text.split('[COMPLETE]');
            if (parts.length < 2) {
              setClarifyMessage("Не удалось разобрать ответ системы. Попробуйте еще раз.");
              setProcessingStatus('clarifying');
              return;
            }
            let configData: any = {};
            try {
              const jsonText = parts[1].replace(/```json/g, '').replace(/```/g, '').trim();
              configData = JSON.parse(jsonText);
            } catch (e) {
              console.error("JSON parse error", e);
              setProcessingStatus('error');
              setTimeout(() => setProcessingStatus('idle'), 3000);
              return;
            }

            // 4. Попытка получить план от сервера
            let finalPlan: AgentPlan[] = [];
            try {
              const planRes = await fetch('/api/quest/generate-plan', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  selectedChoices: {}, // Можно передать ответы станций, если они были
                  industry: configData.industry || industry,
                  business_name: configData.business_name || businessName,
                  owner_name: configData.owner_name || ownerName,
                  objective: "Оптимизация бизнеса"
                })
              });
              if (planRes.ok) {
                const planData = await planRes.json();
                if (planData.plan && Array.isArray(planData.plan)) {
                  finalPlan = planData.plan.map((p: any) => ({
                    agent: p.agent,
                    title: p.title,
                    mission: p.mission,
                    icon: p.icon || 'HelpCircle'
                  }));
                }
              }
            } catch (e) { console.warn("Plan generation failed, using dynamic fallback", e); }

            // 5. Fallback: динамические агенты из detected_agents, если план не пришел
            if (finalPlan.length === 0) {
              const b = configData.business_name || businessName || 'Мой Бизнес';
              const ind = configData.industry || industry || 'Услуги';
              const t = configData.tone || tone || 'friendly';
              
              const rolesToUse = (configData.detected_agents && configData.detected_agents.length > 0) 
                ? configData.detected_agents 
                : ['receiver', 'sales', 'operator']; // Дефолт, если модель не определила роли
              
              finalPlan = rolesToUse.map((role: string) => {
                const template = ROLE_TEMPLATES[role] || ROLE_TEMPLATES['receiver'];
                return {
                  agent: role,
                  title: template.title,
                  mission: template.missionTemplate(b, ind, t),
                  icon: template.icon
                };
              });
            }

            // 6. Если вообще ничего нет — ошибка/уточнение
            if (finalPlan.length === 0) {
              setClarifyMessage("Не удалось собрать штаб. Попробуйте описать задачу подробнее.");
              setProcessingStatus('clarifying');
              return;
            }

            // 7. Успех
            const createdAgents: Agent[] = finalPlan.map(p => ({
              id: p.agent, role: p.agent as any, name: p.title, russianRole: p.title,
              description: p.mission, icon: p.icon, status: 'idle',
              channels: configData.channels || channels, systemPrompt: p.mission
            }));

            const newConfig: AppConfig = {
              project_name: 'Цифровой сотрудник',
              owner_name: configData.owner_name || ownerName || 'Предприниматель',
              business_name: configData.business_name || businessName || 'Мой Бизнес',
              industry: configData.industry || industry || 'Сфера бизнеса',
              channels: configData.channels || channels || ['telegram'],
              tone: (configData.tone || tone || 'friendly') as any,
              autonomy_level: (configData.autonomy_level || 'full') as any,
              voice_id: 'Kore', is_active: true, auto_synthesize: false, tts_voice: 'Kore'
            };

            setPlan(finalPlan);
            setQuestStep('plan');
            setProcessingStatus('idle');
            if (onComplete) onComplete(newConfig, createdAgents);

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
      console.error("Mic error:", err);
      setProcessingStatus('error');
      setTimeout(() => setProcessingStatus('idle'), 3000);
      setIsRecording(false);
    }
  };

  const renderIcon = (iconName: string) => {
    const IconComponent = (Icons as any)[iconName] || Icons.HelpCircle;
    return <IconComponent className="h-8 w-8 text-white shrink-0" style={{ filter: 'drop-shadow(0 0 10px rgba(255,255,255,0.4))' }} />;
  };

  return (
    <div 
      className="w-full min-h-[600px] text-white rounded-3xl border border-white/10 p-8 md:p-12 font-modern relative overflow-hidden transition-all duration-300 shadow-[0_24px_70px_rgba(0,0,0,0.85)]"
      style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(255, 255, 255, 0.04) 0%, rgba(8, 8, 12, 0.95) 75%)' }}
    >
      {/* INTRO SCREEN */}
      {questStep === 'intro' && processingStatus !== 'clarifying' && (
        <section className="relative w-full min-h-[520px] rounded-2xl p-6 sm:p-8 md:p-12 text-left overflow-hidden border border-white/10 bg-gradient-to-b from-[#0e0e12] to-[#050507]">
          {/* Thin Grid Background */}
          <div 
            className="absolute inset-0 pointer-events-none opacity-40"
            style={{
              backgroundImage: `linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px)`,
              backgroundSize: '48px 48px',
              maskImage: 'radial-gradient(ellipse at center, black 40%, transparent 85%)',
              WebkitMaskImage: 'radial-gradient(ellipse at center, black 40%, transparent 85%)'
            }}
          />
          {/* Soft ambient white light top right */}
          <div 
            className="absolute top-0 right-0 w-[400px] h-[400px] pointer-events-none rounded-full"
            style={{
              background: 'radial-gradient(circle at top right, rgba(255,255,255,0.04) 0%, transparent 70%)'
            }}
          />

          <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 items-center">
            {/* Left Column (Text & Mic) */}
            <div className="space-y-6 text-left">
              {/* Micro-label */}
              <div className="flex items-center gap-2 text-[11px] text-[#94A3B8] font-normal">
                <span className="w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_6px_#FFFFFF] shrink-0" />
                <span>Selin — автономный штаб</span>
              </div>

              {/* Headline */}
              <h1 className="font-display font-bold text-4xl sm:text-5xl md:text-6xl text-white leading-[1.05] tracking-tight">
                Отвечает клиентам<br />
                вместо вас.
              </h1>

              {/* Subtitle */}
              <p className="text-lg md:text-xl font-normal text-[#e2e8f0] font-display">
                Голосом. Круглые сутки.
              </p>

              {/* Paragraph */}
              <p className="text-sm md:text-base text-[#94A3B8] max-w-md font-light leading-relaxed">
                Опишите бизнес голосом — за минуту соберу команду под вашу задачу и выведу её на линию.
              </p>

              {/* Recording Block */}
              <div className="pt-2 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="relative flex items-center justify-center shrink-0">
                  {isRecording && (
                    <span className="absolute inset-0 rounded-full bg-red-500/30 animate-ping pointer-events-none" />
                  )}
                  <button
                    type="button"
                    disabled={processingStatus !== 'idle'}
                    onClick={toggleRecording}
                    className={`w-22 h-22 md:w-24 md:h-24 rounded-full flex items-center justify-center cursor-pointer transition-all duration-300 border relative z-10 ${
                      isRecording
                        ? 'border-red-500 text-red-500 bg-red-500/10 shadow-[0_0_35px_rgba(239,68,68,0.4)] scale-105'
                        : 'border-white/20 text-white bg-white/5 hover:bg-white/10 hover:border-white/50 shadow-[0_0_25px_rgba(255,255,255,0.1)] hover:scale-105 active:scale-95'
                    }`}
                  >
                    {isRecording ? (
                      <Icons.StopCircle className="w-7 h-7 text-red-500" />
                    ) : (
                      <Icons.Mic className="w-7 h-7 text-white" />
                    )}
                  </button>
                </div>

                <div className="text-xs text-[#94A3B8] font-normal leading-relaxed">
                  {isRecording ? (
                    <span className="text-red-400 font-medium">слушаю — нажмите ещё раз, чтобы остановить</span>
                  ) : processingStatus === 'transcribing' ? (
                    <div className="flex items-center gap-2 text-slate-300">
                      <Icons.Loader2 className="w-4 h-4 text-white animate-spin" />
                      <span>Распознаю речь…</span>
                    </div>
                  ) : processingStatus === 'assembling' ? (
                    <div className="flex items-center gap-2 text-slate-300">
                      <Icons.Loader2 className="w-4 h-4 text-white animate-spin" />
                      <span>Собираю штаб…</span>
                    </div>
                  ) : processingStatus === 'error' ? (
                    <span className="text-red-400">не расслышал — повторите</span>
                  ) : (
                    <span>нажмите и говорите 10–30 сек</span>
                  )}
                </div>
              </div>
            </div>

            {/* Vertical Divider for md screens */}
            <div className="hidden md:block absolute left-1/2 top-10 bottom-10 w-[1px] bg-white/[0.08] -translate-x-1/2 pointer-events-none" />

            {/* Right Column (Staff Registry) */}
            <div className="md:pl-6 space-y-4 text-left">
              <div className="text-[11px] text-[#94A3B8] font-normal">
                Команда под вашу задачу
              </div>

              <div className="rounded-xl border border-white/[0.08] bg-black/30 divide-y divide-white/[0.06] overflow-hidden">
                {[
                  { role: 'receiver', title: 'Приём обращений', icon: Icons.MessageSquare },
                  { role: 'sales', title: 'Продажи', icon: Icons.DollarSign },
                  { role: 'content', title: 'Контент', icon: Icons.PenTool },
                  { role: 'analyst', title: 'Аналитика', icon: Icons.BarChart3 },
                  { role: 'operator', title: 'Координация', icon: Icons.CheckSquare },
                ].map((item, idx) => {
                  const IconComp = item.icon;
                  return (
                    <div
                      key={item.role}
                      className="flex items-center justify-between p-3.5 px-4 transition-all duration-300 hover:bg-white/[0.03]"
                      style={{
                        animation: `fadeIn 0.3s ease-out ${idx * 0.06}s both`
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                        <IconComp className="w-4 h-4 text-slate-300 shrink-0" />
                        <span className="text-sm font-medium text-white">{item.title}</span>
                      </div>
                      <span className="text-xs text-slate-400 font-mono">{item.role}</span>
                    </div>
                  );
                })}
              </div>

              <p className="text-[11px] text-[#94A3B8] font-normal">
                Состав уточнится после вашего описания.
              </p>
            </div>
          </div>

          {/* BALANCE CARD & ACTION GRID matching requested design */}
          <div className="pt-8 space-y-6 relative z-10">
            {/* Balance Card */}
            <div className="balance-card">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="balance-label">Баланс Обработок ИИ-Штаба</div>
                  <div className="balance-main">3,420,000 ₽</div>
                  <div className="balance-sub">
                    <Icons.TrendingUp className="w-5 h-5 text-[#00D4FF]" />
                    <span>+128 автономных обращений сегодня</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="status-badge">24/7 ONLINE</span>
                </div>
              </div>
            </div>

            {/* Action Grid */}
            <div className="action-grid">
              <button
                type="button"
                onClick={toggleRecording}
                className="action-btn cursor-pointer"
              >
                <div className="btn-icon">
                  <Icons.Mic className="w-5 h-5" />
                </div>
                <span className="btn-label">Голосовой Приём</span>
              </button>

              <button
                type="button"
                onClick={() => setCurrentTab('simulator')}
                className="action-btn cursor-pointer"
              >
                <div className="btn-icon">
                  <Icons.MessageSquare className="w-5 h-5" />
                </div>
                <span className="btn-label">Каналы Связи</span>
              </button>

              <button
                type="button"
                onClick={() => setCurrentTab('feed')}
                className="action-btn cursor-pointer"
              >
                <div className="btn-icon">
                  <Icons.Activity className="w-5 h-5" />
                </div>
                <span className="btn-label">Лента Штаба</span>
              </button>

              <button
                type="button"
                onClick={() => setCurrentTab('billing')}
                className="action-btn cursor-pointer"
              >
                <div className="btn-icon">
                  <Icons.CreditCard className="w-5 h-5" />
                </div>
                <span className="btn-label">Баланс & Тарифы</span>
              </button>
            </div>
          </div>
        </section>
      )}

      {/* PLAN RESULTS SCREEN (Dynamic count of agents) */}
      {questStep === 'plan' && plan.length > 0 && (
        <div className="space-y-10 animate-fade-in text-left font-modern">
          <div className="space-y-3 pb-4 border-b border-white/10">
            <span className="text-[10px] tracking-[0.2em] text-white/80 uppercase block font-semibold">задачи распределены по ролям</span>
            <h2 className="text-3xl md:text-4xl font-bold text-white leading-snug">Что будет делать ваш штаб</h2>
            <p className="text-sm text-[#94A3B8] leading-relaxed max-w-2xl font-light">
              Я подобрал {plan.length} специалистов именно под ваши задачи. Каждый знает свою роль и готов работать.
            </p>
          </div>

          <div className="space-y-6">
            {plan.map((agent, idx) => (
              <div key={idx} className="glass-panel p-6 md:p-8 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6 transition-all duration-300 hover:border-white/30 hover:bg-white/[0.04]">
                <div className="flex items-start md:items-center gap-6">
                  <div className="h-16 w-16 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(255,255,255,0.05)]">
                    {renderIcon(agent.icon)}
                  </div>
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="font-bold text-xl text-white tracking-tight">{agent.title}</h3>
                      <span className="text-[10px] text-white uppercase tracking-wider border border-white/30 bg-white/10 px-2.5 py-0.5 rounded-full font-semibold font-modern shadow-[0_0_8px_rgba(255,255,255,0.1)]">Активен</span>
                    </div>
                    <p className="text-sm text-[#94A3B8] leading-relaxed max-w-3xl font-light">{agent.mission}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-8 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-6">
            <button onClick={() => { setQuestStep('intro'); setPlan([]); }} className="text-xs uppercase tracking-widest text-[#94A3B8] hover:text-white transition-colors cursor-pointer font-semibold">Пройти заново</button>
            <button 
              onClick={() => {
                setIsSuccessModalOpen(true);
                if (isTelegram) {
                  try {
                    (window as any).Telegram?.WebApp?.close?.();
                  } catch (e) {
                    console.warn("Telegram WebApp close error:", e);
                  }
                }
              }} 
              className="w-full sm:w-auto bg-white hover:bg-slate-200 text-black text-xs font-bold py-4 px-10 rounded-xl transition-all duration-300 cursor-pointer tracking-widest uppercase flex items-center justify-center gap-2 shadow-[0_4px_25px_rgba(255,255,255,0.25)]"
            >
              <Icons.Zap className="h-4 w-4 fill-current text-black" /> Запустить штаб в работу
            </button>
          </div>
        </div>
      )}

      {/* CLARIFICATION SCREEN */}
      {processingStatus === 'clarifying' && (
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-6 animate-fade-in font-modern">
          <div className="h-20 w-20 rounded-full bg-white/10 border border-white/20 flex items-center justify-center shadow-[0_0_25px_rgba(255,255,255,0.1)]">
            <Icons.HelpCircle className="h-10 w-10 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white">Нужно немного уточнить</h2>
          <p className="text-sm text-[#94A3B8] max-w-md leading-relaxed font-light">{clarifyMessage}</p>
          <button onClick={() => setProcessingStatus('idle')} className="mt-4 bg-white hover:bg-slate-200 text-black font-bold px-8 py-3 rounded-xl transition-all cursor-pointer text-xs uppercase tracking-widest shadow-[0_4px_20px_rgba(255,255,255,0.2)]">
            Попробовать ещё раз
          </button>
        </div>
      )}

      {/* Success Modal */}
      {isSuccessModalOpen && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fade-in font-modern">
          <div className="bg-[#0A0A0E] border border-white/15 rounded-2xl p-8 md:p-12 max-w-lg w-full text-center space-y-6 shadow-[0_24px_70px_rgba(0,0,0,0.9)]">
            <div className="h-16 w-16 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center mx-auto shadow-[0_0_30px_rgba(255,255,255,0.2)]">
              <Icons.Sparkles className="h-8 w-8 text-white" />
            </div>
            <div className="space-y-3">
              <h3 className="text-2xl md:text-3xl font-bold text-white tracking-tight">Штаб успешно запущен!</h3>
              <p className="text-sm text-[#94A3B8] leading-relaxed font-light">
                {plan.length} ИИ-сотрудников активированы и настроены на алгоритмы вашего бизнеса "{businessName}". Проверьте вкладку "Каналы связи"!
              </p>
            </div>
            <button onClick={() => { setIsSuccessModalOpen(false); setCurrentTab?.('simulator'); }} className="w-full bg-white hover:bg-slate-200 text-black text-xs font-bold py-4 rounded-xl transition-all duration-300 cursor-pointer uppercase tracking-widest shadow-[0_4px_20px_rgba(255,255,255,0.25)]">
              Отлично, к симулятору!
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
