import React, { useState, useRef, useEffect } from 'react';
import * as Icons from 'lucide-react';
import { AppConfig, Agent } from '../types';
// @ts-ignore
import bgCathedral from '../assets/images/mountain_forest_bg_1785821902731.jpg';

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
      className="w-full min-h-[600px] text-white rounded-3xl border border-[#DCD6CD]/20 p-6 md:p-10 font-modern relative overflow-hidden transition-all duration-300 shadow-[0_24px_70px_rgba(0,0,0,0.75)] bg-[#14100E]/80 backdrop-blur-2xl"
    >
      {/* INTRO SCREEN */}
      {questStep === 'intro' && processingStatus !== 'clarifying' && (
        <section className="relative w-full rounded-2xl p-6 sm:p-8 md:p-12 text-center overflow-hidden border border-[#DCD6CD]/15 bg-[#1C1816]/70 backdrop-blur-xl shadow-2xl">
          {/* Ambient Warm Golden Glow */}
          <div 
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] pointer-events-none rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(197, 160, 89, 0.12) 0%, transparent 70%)'
            }}
          />

          <div className="relative z-10 max-w-xl mx-auto space-y-6 flex flex-col items-center">
            
            {/* Elegant Luxury Frame - Clean Image & Status Badge */}
            <div className="relative mx-auto w-full max-w-sm sm:max-w-md p-1.5 rounded-[32px] sm:rounded-[36px] border border-[#C5A059]/35 bg-[#181412]/90 shadow-[0_25px_60px_rgba(0,0,0,0.9),0_0_35px_rgba(197,160,89,0.12)] transition-transform duration-700 hover:scale-[1.01]">
              <div className="relative w-full h-60 sm:h-72 rounded-[26px] sm:rounded-[30px] overflow-hidden flex flex-col justify-end p-3">
                <img 
                  src={bgCathedral} 
                  alt="ИИ-Штаб SELIN" 
                  className="absolute inset-0 w-full h-full object-cover filter contrast-105 brightness-95 transition-transform duration-1000 hover:scale-105"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/10" />
                
                {/* Status Bar inside the image card with proper margins so text is NEVER clipped */}
                <div className="relative z-10 flex items-center justify-between text-xs font-serif-geos text-[#EAE6DF] bg-[#14100E]/90 backdrop-blur-md px-4 py-2.5 rounded-2xl border border-[#C5A059]/30 shadow-lg">
                  <span className="tracking-widest text-[#C5A059] font-medium uppercase">SELIN CORE</span>
                  <span className="text-[#30d158] font-bold flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#30d158] animate-pulse" />
                    ONLINE 24/7
                  </span>
                </div>
              </div>
            </div>

            {/* Glass Voice Recording Action Button */}
            <div className="w-full flex flex-col items-center justify-center gap-3 pt-1">
              <div className="relative flex items-center justify-center w-full max-w-md">
                {isRecording && (
                  <span className="absolute inset-0 rounded-full bg-red-500/30 animate-ping pointer-events-none" />
                )}
                <button
                  type="button"
                  disabled={processingStatus !== 'idle'}
                  onClick={toggleRecording}
                  className={`w-full py-4 px-6 sm:px-8 rounded-full font-serif-geos text-sm sm:text-base font-bold tracking-widest transition-all duration-300 border flex items-center justify-center gap-3 cursor-pointer relative z-10 uppercase ${
                    isRecording
                      ? 'border-red-500 text-red-400 bg-red-500/20 shadow-[0_0_35px_rgba(239,68,68,0.5)] scale-105'
                      : 'border-[#C5A059]/50 text-[#14100E] bg-gradient-to-r from-[#C5A059] via-[#E8C580] to-[#C5A059] hover:brightness-110 hover:scale-[1.02] active:scale-95 shadow-[0_12px_35px_rgba(197,160,89,0.35)]'
                  }`}
                >
                  {isRecording ? (
                    <>
                      <Icons.StopCircle className="w-5 h-5 sm:w-6 sm:h-6 text-red-500 animate-pulse" />
                      <span>Остановить запись</span>
                    </>
                  ) : (
                    <>
                      <Icons.Mic className="w-5 h-5 sm:w-6 sm:h-6 text-[#14100E]" />
                      <span>ЗАПУСТИТЬ ГОЛОСОВОЙ ВВОД</span>
                    </>
                  )}
                </button>
              </div>

              {/* Status indicator */}
              <div className="text-xs text-[#B0A79E] font-serif-geos tracking-wider text-center min-h-[20px]">
                {isRecording ? (
                  <span className="text-red-400 font-medium animate-pulse">Слушаю вас — нажмите ещё раз для остановки</span>
                ) : processingStatus === 'transcribing' ? (
                  <div className="flex items-center justify-center gap-2 text-[#EAE6DF]">
                    <Icons.Loader2 className="w-4 h-4 text-[#C5A059] animate-spin" />
                    <span>Распознаю голос…</span>
                  </div>
                ) : processingStatus === 'assembling' ? (
                  <div className="flex items-center justify-center gap-2 text-[#EAE6DF]">
                    <Icons.Loader2 className="w-4 h-4 text-[#C5A059] animate-spin" />
                    <span>Формирую ИИ-штаб…</span>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Quick Modules Row */}
            <div className="pt-6 border-t border-[#DCD6CD]/10 grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 w-full">
              <button
                type="button"
                onClick={toggleRecording}
                className="p-3.5 sm:p-4 rounded-2xl bg-[#231E1B] border border-[#DCD6CD]/10 hover:border-[#C5A059]/40 text-left transition-all duration-300 cursor-pointer group hover:bg-[#2A231F]"
              >
                <Icons.Mic className="w-5 h-5 text-[#C5A059] mb-1.5 group-hover:scale-110 transition-transform" />
                <div className="text-xs font-semibold text-[#EAE6DF]">Голосовой Инженер</div>
                <div className="text-[10px] text-[#8E847A]">Живой диалог</div>
              </button>

              <button
                type="button"
                onClick={() => setCurrentTab('simulator')}
                className="p-3.5 sm:p-4 rounded-2xl bg-[#231E1B] border border-[#DCD6CD]/10 hover:border-[#C5A059]/40 text-left transition-all duration-300 cursor-pointer group hover:bg-[#2A231F]"
              >
                <Icons.MessageSquare className="w-5 h-5 text-[#C5A059] mb-1.5 group-hover:scale-110 transition-transform" />
                <div className="text-xs font-semibold text-[#EAE6DF]">Каналы Связи</div>
                <div className="text-[10px] text-[#8E847A]">WhatsApp / TG</div>
              </button>

              <button
                type="button"
                onClick={() => setCurrentTab('feed')}
                className="p-3.5 sm:p-4 rounded-2xl bg-[#231E1B] border border-[#DCD6CD]/10 hover:border-[#C5A059]/40 text-left transition-all duration-300 cursor-pointer group hover:bg-[#2A231F]"
              >
                <Icons.Activity className="w-5 h-5 text-[#C5A059] mb-1.5 group-hover:scale-110 transition-transform" />
                <div className="text-xs font-semibold text-[#EAE6DF]">Лента Штаба</div>
                <div className="text-[10px] text-[#8E847A]">Отчеты 24/7</div>
              </button>

              <button
                type="button"
                onClick={() => setCurrentTab('billing')}
                className="p-3.5 sm:p-4 rounded-2xl bg-[#231E1B] border border-[#DCD6CD]/10 hover:border-[#C5A059]/40 text-left transition-all duration-300 cursor-pointer group hover:bg-[#2A231F]"
              >
                <Icons.CreditCard className="w-5 h-5 text-[#C5A059] mb-1.5 group-hover:scale-110 transition-transform" />
                <div className="text-xs font-semibold text-[#EAE6DF]">Баланс & Тарифы</div>
                <div className="text-[10px] text-[#8E847A]">Управление</div>
              </button>
            </div>

          </div>
        </section>
      )}

      {/* PLAN RESULTS SCREEN (Dynamic count of agents) */}
      {questStep === 'plan' && plan.length > 0 && (
        <div className="space-y-10 animate-fade-in text-left font-serif-geos">
          <div className="space-y-3 pb-4 border-b border-[#DCD6CD]/15">
            <span className="text-xs uppercase tracking-[0.2em] text-[#C5A059] block font-medium">ЗАДАЧИ РАСПРЕДЕЛЕНЫ ПО РОЛЯМ</span>
            <h2 className="text-3xl md:text-4xl font-light text-[#EAE6DF] leading-snug">Что будет делать ваш штаб</h2>
            <p className="text-sm text-[#B0A79E] leading-relaxed max-w-2xl font-light">
              Я подобрал {plan.length} специалистов именно под ваши задачи. Каждый знает свою роль и готов работать.
            </p>
          </div>

          <div className="space-y-6">
            {plan.map((agent, idx) => (
              <div key={idx} className="p-6 md:p-8 rounded-2xl bg-[#1C1816]/80 border border-[#DCD6CD]/15 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 transition-all duration-300 hover:border-[#C5A059]/40 hover:bg-[#231E1B]">
                <div className="flex items-start md:items-center gap-6">
                  <div className="h-16 w-16 rounded-2xl bg-[#28221F] border border-[#C5A059]/30 flex items-center justify-center shrink-0 shadow-lg">
                    {renderIcon(agent.icon)}
                  </div>
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="font-medium text-xl text-[#EAE6DF] tracking-wide">{agent.title}</h3>
                      <span className="text-[10px] text-[#C5A059] uppercase tracking-wider border border-[#C5A059]/40 bg-[#C5A059]/10 px-2.5 py-0.5 rounded-full font-medium">Активен</span>
                    </div>
                    <p className="text-sm text-[#B0A79E] leading-relaxed max-w-3xl font-light">{agent.mission}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-8 border-t border-[#DCD6CD]/15 flex flex-col sm:flex-row items-center justify-between gap-6">
            <button onClick={() => { setQuestStep('intro'); setPlan([]); }} className="text-xs uppercase tracking-widest text-[#B0A79E] hover:text-[#EAE6DF] transition-colors cursor-pointer font-medium">Пройти заново</button>
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
              className="w-full sm:w-auto bg-[#DCD6CD] hover:bg-[#EAE6DF] text-[#1A1614] text-xs font-semibold py-4 px-10 rounded-full transition-all duration-300 cursor-pointer tracking-widest uppercase flex items-center justify-center gap-2 shadow-xl"
            >
              <Icons.Zap className="h-4 w-4 fill-current text-[#1A1614]" /> Запустить штаб в работу
            </button>
          </div>
        </div>
      )}

      {/* CLARIFICATION SCREEN */}
      {processingStatus === 'clarifying' && (
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-6 animate-fade-in font-serif-geos">
          <div className="h-20 w-20 rounded-full bg-[#28221F] border border-[#C5A059]/40 flex items-center justify-center shadow-xl">
            <Icons.HelpCircle className="h-10 w-10 text-[#C5A059]" />
          </div>
          <h2 className="text-2xl font-light text-[#EAE6DF]">Нужно немного уточнить</h2>
          <p className="text-sm text-[#B0A79E] max-w-md leading-relaxed font-light">{clarifyMessage}</p>
          <button onClick={() => setProcessingStatus('idle')} className="mt-4 bg-[#DCD6CD] hover:bg-[#EAE6DF] text-[#1A1614] font-semibold px-8 py-3 rounded-full transition-all cursor-pointer text-xs uppercase tracking-widest shadow-lg">
            Попробовать ещё раз
          </button>
        </div>
      )}

      {/* Success Modal */}
      {isSuccessModalOpen && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fade-in font-serif-geos">
          <div className="bg-[#181412] border border-[#DCD6CD]/20 rounded-3xl p-8 md:p-12 max-w-lg w-full text-center space-y-6 shadow-2xl">
            <div className="h-20 w-20 rounded-full bg-[#C5A059]/15 border border-[#C5A059]/40 flex items-center justify-center mx-auto shadow-xl">
              <Icons.CheckCircle className="h-10 w-10 text-[#C5A059]" />
            </div>
            <div className="space-y-2">
              <h3 className="text-2xl font-light text-[#EAE6DF]">Штаб успешно запущен!</h3>
              <p className="text-xs text-[#B0A79E] leading-relaxed font-light">
                Все ИИ-сотрудники приступили к выполнению регламентов. Вы можете отслеживать их работу в разделах "Лента" и "Аналитика".
              </p>
            </div>
            <button 
              onClick={() => { setIsSuccessModalOpen(false); setCurrentTab?.('simulator'); }}
              className="w-full bg-[#DCD6CD] hover:bg-[#EAE6DF] text-[#1A1614] font-medium py-3.5 rounded-full text-xs uppercase tracking-widest transition-all cursor-pointer shadow-md font-serif-geos"
            >
              Отлично, к симулятору!
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
