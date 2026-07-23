import React, { useState, useRef } from 'react';
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
  const EAGLE_BG = ""; // Вставь путь к картинке орла, если есть
  const [questStep, setQuestStep] = useState<'intro' | 'plan' | 'needs_clarification'>('intro');
  const [plan, setPlan] = useState<AgentPlan[]>([]);
  const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<'idle' | 'transcribing' | 'assembling' | 'error' | 'clarifying'>('idle');
  const [clarifyMessage, setClarifyMessage] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

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
    return <IconComponent className="h-8 w-8 text-[#FF6B00] shrink-0" style={{ filter: 'drop-shadow(0 0 8px rgba(255,107,0,0.4))' }} />;
  };

  return (
    <div 
      className="w-full min-h-[600px] text-white rounded-3xl border border-white/[0.08] p-8 md:p-12 font-modern relative overflow-hidden transition-all duration-300 shadow-[0_24px_70px_rgba(0,0,0,0.8)]"
      style={{ background: 'radial-gradient(circle at top center, #1a0f00 0%, #050505 60%)' }}
    >
      {/* INTRO SCREEN */}
      {questStep === 'intro' && processingStatus !== 'clarifying' && (
        <section className="relative w-full min-h-[70vh] overflow-hidden rounded-2xl flex flex-col items-center justify-center px-6 py-16">
          {/* Content Overlay */}
          <div className="relative z-10 flex flex-col items-center text-center pointer-events-none">
            <p className="font-modern text-[10px] uppercase tracking-[0.2em] text-[#A0A0A0] mb-8">Selin · автономный штаб</p>
            <h1 className="font-modern font-bold text-4xl md:text-6xl text-white leading-tight tracking-tight text-center">Расскажите задачу —<br />штаб соберётся сам</h1>
            <p className="font-modern text-base text-[#A0A0A0] mt-6 max-w-lg text-center leading-relaxed">Нажмите на микрофон и опишите бизнес голосом. Я пойму суть и подберу команду под неё.</p>

            <button
              type="button" disabled={processingStatus !== 'idle'} onClick={toggleRecording}
              className={`pointer-events-auto relative w-24 h-24 rounded-full flex items-center justify-center cursor-pointer transition-all duration-300 active:scale-95 mt-10 z-10 disabled:opacity-50 ${
                isRecording ? 'bg-red-500/10 border-red-500 shadow-[0_0_40px_rgba(239,68,68,0.6)]' : 'animate-pulse-slow bg-[rgba(255,107,0,0.05)]'
              }`}
              style={{
                border: isRecording ? '1px solid #ef4444' : '1px solid #FF6B00',
                boxShadow: isRecording 
                  ? '0 0 30px rgba(239,68,68,0.5), inset 0 0 20px rgba(239,68,68,0.2)' 
                  : undefined
              }}
            >
              {isRecording ? <Icons.StopCircle className="h-8 w-8 text-red-500" /> : <Icons.Mic className="h-8 w-8 text-[#FF6B00]" style={{ filter: 'drop-shadow(0 0 8px #FF6B00)' }} />}
            </button>

            <div className="min-h-[24px] mt-6 pointer-events-auto font-modern text-xs text-[#A0A0A0] uppercase tracking-wider text-center">
              {isRecording ? <span className="text-red-400 font-medium animate-pulse">Слушаю… нажмите, чтобы закончить</span>
               : processingStatus === 'transcribing' ? <div className="flex items-center gap-2 justify-center"><Icons.Loader2 className="h-4 w-4 text-[#FF6B00] animate-spin" /><span>Распознаю речь…</span></div>
               : processingStatus === 'assembling' ? <div className="flex items-center gap-2 justify-center"><Icons.Loader2 className="h-4 w-4 text-[#FF6B00] animate-spin" /><span>Собираю штаб…</span></div>
               : processingStatus === 'error' ? <span className="text-red-400">Не расслышал, попробуйте ещё раз</span>
               : <span>говорите свободно, 10–30 секунд</span>}
            </div>
          </div>
        </section>
      )}

      {/* PLAN RESULTS SCREEN (Dynamic count of agents) */}
      {questStep === 'plan' && plan.length > 0 && (
        <div className="space-y-10 animate-fade-in text-left font-modern">
          <div className="space-y-3 pb-4 border-b border-white/10">
            <span className="text-[10px] tracking-[0.2em] text-[#FF6B00] uppercase block font-semibold">задачи распределены по ролям</span>
            <h2 className="text-3xl md:text-4xl font-bold text-white leading-snug">Что будет делать ваш штаб</h2>
            <p className="text-sm text-[#A0A0A0] leading-relaxed max-w-2xl font-light">
              Я подобрал {plan.length} специалистов именно под ваши задачи. Каждый знает свою роль и готов работать.
            </p>
          </div>

          <div className="space-y-6">
            {plan.map((agent, idx) => (
              <div key={idx} className="glass-panel p-6 md:p-8 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6 transition-all duration-300 hover:border-[#FF6B00]/40 hover:bg-white/[0.03]">
                <div className="flex items-start md:items-center gap-6">
                  <div className="h-16 w-16 rounded-2xl bg-white/[0.02] border border-white/10 flex items-center justify-center shrink-0">
                    {renderIcon(agent.icon)}
                  </div>
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="font-bold text-xl text-white tracking-tight">{agent.title}</h3>
                      <span className="text-[10px] text-[#FF6B00] uppercase tracking-wider border border-[#FF6B00]/30 bg-[#FF6B00]/10 px-2.5 py-0.5 rounded-full font-semibold font-modern">Активен</span>
                    </div>
                    <p className="text-sm text-[#A0A0A0] leading-relaxed max-w-3xl font-light">{agent.mission}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-8 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-6">
            <button onClick={() => { setQuestStep('intro'); setPlan([]); }} className="text-xs uppercase tracking-widest text-[#A0A0A0] hover:text-white transition-colors cursor-pointer font-semibold">Пройти заново</button>
            <button onClick={() => setIsSuccessModalOpen(true)} className="w-full sm:w-auto bg-[#FF6B00] hover:bg-[#E05E00] text-white text-xs font-bold py-4 px-10 rounded-xl transition-all duration-300 cursor-pointer tracking-widest uppercase flex items-center justify-center gap-2 shadow-[0_4px_20px_rgba(255,107,0,0.3)]">
              <Icons.Zap className="h-4 w-4 fill-current text-white" /> Запустить штаб в работу
            </button>
          </div>
        </div>
      )}

      {/* CLARIFICATION SCREEN (Instead of fake 5 agents) */}
      {processingStatus === 'clarifying' && (
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-6 animate-fade-in font-modern">
          <div className="h-20 w-20 rounded-full bg-[#FF6B00]/10 border border-[#FF6B00]/20 flex items-center justify-center">
            <Icons.HelpCircle className="h-10 w-10 text-[#FF6B00]" />
          </div>
          <h2 className="text-2xl font-bold text-white">Нужно немного уточнить</h2>
          <p className="text-sm text-[#A0A0A0] max-w-md leading-relaxed font-light">{clarifyMessage}</p>
          <button onClick={() => setProcessingStatus('idle')} className="mt-4 bg-[#FF6B00] hover:bg-[#E05E00] text-white font-bold px-8 py-3 rounded-xl transition-all cursor-pointer text-xs uppercase tracking-widest shadow-[0_4px_20px_rgba(255,107,0,0.2)]">
            Попробовать ещё раз
          </button>
        </div>
      )}

      {/* Success Modal */}
      {isSuccessModalOpen && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fade-in font-modern">
          <div className="bg-[#0A0A0A] border border-white/10 rounded-2xl p-8 md:p-12 max-w-lg w-full text-center space-y-6 shadow-[0_24px_70px_rgba(0,0,0,0.8)]">
            <div className="h-16 w-16 rounded-2xl bg-[#FF6B00]/10 border border-[#FF6B00]/20 flex items-center justify-center mx-auto shadow-[0_0_30px_rgba(255,107,0,0.2)]">
              <Icons.Sparkles className="h-8 w-8 text-[#FF6B00]" />
            </div>
            <div className="space-y-3">
              <h3 className="text-2xl md:text-3xl font-bold text-white tracking-tight">Штаб успешно запущен!</h3>
              <p className="text-sm text-[#A0A0A0] leading-relaxed font-light">
                {plan.length} ИИ-сотрудников активированы и настроены на алгоритмы вашего бизнеса "{businessName}". Проверьте вкладку "Каналы связи"!
              </p>
            </div>
            <button onClick={() => { setIsSuccessModalOpen(false); setCurrentTab?.('simulator'); }} className="w-full bg-[#FF6B00] hover:bg-[#E05E00] text-white text-xs font-bold py-4 rounded-xl transition-all duration-300 cursor-pointer uppercase tracking-widest shadow-[0_4px_20px_rgba(255,107,0,0.3)]">
              Отлично, к симулятору!
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
