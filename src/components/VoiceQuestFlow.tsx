import React, { useState, useEffect } from 'react';
import { GlassPanel } from './GlassPanel';
import { NeonButton } from './NeonButton';
import { AppConfig, Agent } from '../types';
import { Check, Sparkles, ArrowRight, Bot, Compass, CheckCircle2, Sliders, Globe, Radio } from 'lucide-react';

interface QuestStep {
  id: string;
  title: string;
  description: string;
  agent: string;
  completed: boolean;
}

interface VoiceQuestFlowProps {
  steps: QuestStep[];
  onComplete: (config: AppConfig, customizedAgents: Agent[]) => void;
}

export const VoiceQuestFlow: React.FC<VoiceQuestFlowProps> = ({ steps: initialSteps, onComplete }) => {
  const [steps, setSteps] = useState<QuestStep[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  
  // Customization fields
  const [businessName, setBusinessName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [industry, setIndustry] = useState('');
  const [selectedTone, setSelectedTone] = useState<'friendly' | 'professional' | 'energetic' | 'elegant' | 'strict'>('friendly');
  const [selectedChannels, setSelectedChannels] = useState<string[]>(['telegram']);
  
  // Extra setup data from step interactive actions
  const [welcomeText, setWelcomeText] = useState('Приветствую! Чем я могу вам помочь?');
  const [autonomyLevel, setAutonomyLevel] = useState<'full' | 'human-supervised'>('full');

  useEffect(() => {
    if (initialSteps && initialSteps.length > 0) {
      setSteps(initialSteps);
    } else {
      // Default placeholder steps while loading or as fallback
      setSteps([
        { id: 'step1', title: 'Определить название и сферу бизнеса', description: 'Зададим базовые параметры вашей компании.', agent: 'operator', completed: false },
        { id: 'step2', title: 'Настроить приветствие клиентов', description: 'Сформулируем идеальное первое сообщение.', agent: 'receiver', completed: false },
        { id: 'step3', title: 'Выбрать каналы связи', description: 'Где ваши клиенты будут общаться с ИИ.', agent: 'sales', completed: false }
      ]);
    }
  }, [initialSteps]);

  // Load quest details from server metadata if available
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const chatId = urlParams.get('chatId');
    if (chatId) {
      fetch(`/api/get-voice-quest?chatId=${chatId}`)
        .then(res => res.json())
        .then(data => {
          if (data) {
            setBusinessName(data.business_name || '');
            setOwnerName(data.owner_name || 'Предприниматель');
            setIndustry(data.industry || '');
            if (data.tone) {
              setSelectedTone(data.tone);
            }
          }
        })
        .catch(err => console.warn("Error fetching details for quest form:", err));
    }
  }, []);

  const handleNext = () => {
    // Mark current step as completed
    const updatedSteps = [...steps];
    if (updatedSteps[currentIndex]) {
      updatedSteps[currentIndex].completed = true;
    }
    setSteps(updatedSteps);

    if (currentIndex < steps.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      handleFinish();
    }
  };

  const handleFinish = () => {
    setLoading(true);

    const bName = businessName || 'Мой Бизнес';
    const ind = industry || 'Продажи и услуги';
    const oName = ownerName || 'Предприниматель';

    const finalConfig: AppConfig = {
      project_name: 'Цифровой штаб',
      owner_name: oName,
      business_name: bName,
      industry: ind,
      channels: selectedChannels,
      tone: selectedTone,
      autonomy_level: autonomyLevel,
      voice_id: 'Kore',
      is_active: true,
      auto_synthesize: false,
      tts_voice: 'Kore',
      is_live: true,
      agent_missions: {
        receiver: `Отвечает на утренние/вечерние заявки в мессенджерах для ${bName}. Приветствие: "${welcomeText}"`,
        sales: `Отправляет КП, отрабатывает возражения клиентов компании ${bName}, тон: ${selectedTone}.`
      }
    };

    // Initialize default agents
    const customizedAgents: Agent[] = [
      {
        id: 'receiver',
        role: 'receiver',
        name: 'Анна',
        russianRole: 'Приемщик (Customer Support)',
        description: 'Отвечает на утренние/вечерние заявки в мессенджерах, дает справку, консультирует по ценам.',
        icon: '👩‍💼',
        status: 'idle',
        channels: selectedChannels,
        systemPrompt: `Ты — ИИ-приемщик Анна в компании "${bName}" (${ind}). Отвечай вежливо, тон: ${selectedTone}. Приветственное сообщение: "${welcomeText}".`
      },
      {
        id: 'sales',
        role: 'sales',
        name: 'Максим',
        russianRole: 'Продажник (Lead Nurturing & Sales)',
        description: 'Отправляет КП, отрабатывает возражения клиентов, закрывает сделки и вовлекает лидов.',
        icon: '👨‍💼',
        status: 'idle',
        channels: selectedChannels,
        systemPrompt: `Ты — ИИ-продавец Максим в компании "${bName}". Твоя цель — доводить клиентов до сделки, отправлять коммерческие предложения. Тон: ${selectedTone}.`
      },
      {
        id: 'operator',
        role: 'operator',
        name: 'Супервизор',
        russianRole: 'Операционист-Координатор',
        description: 'Управляет SMART-планом на день, следит за активностью штаба и формирует сводки.',
        icon: '👑',
        status: 'idle',
        channels: selectedChannels,
        systemPrompt: `Ты — Операционный координатор штаба компании "${bName}". Планируй SMART-задачи для Анны и Максима.`
      }
    ];

    onComplete(finalConfig, customizedAgents);
    setLoading(false);
  };

  const progressPercent = steps.length > 0 ? Math.round((currentIndex / steps.length) * 100) : 0;
  const currentStep = steps[currentIndex];

  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-8 font-modern">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-[#FF6B00] mb-3 text-xs font-semibold">
          <Compass className="h-4 w-4" />
          <span>Ваш Персональный Голосовой Квест</span>
        </div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">Запустите свой ИИ-штаб</h1>
        <p className="text-slate-400 mt-2 text-sm max-w-md mx-auto">
          Мы составили пошаговый план запуска на основе вашего голосового запроса. Настройте параметры ниже.
        </p>
      </div>

      {/* Progress Tracker */}
      <div className="mb-6">
        <div className="flex justify-between items-center text-xs text-slate-400 mb-2">
          <span>Прогресс настройки</span>
          <span className="font-semibold text-white">{progressPercent}%</span>
        </div>
        <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-orange-500 to-amber-500 transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Step Steps Indicator */}
      <div className="flex items-center gap-2 overflow-x-auto pb-4 mb-6">
        {steps.map((s, idx) => {
          const isActive = idx === currentIndex;
          const isDone = s.completed;
          return (
            <div 
              key={s.id} 
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs whitespace-nowrap transition-all duration-300 ${
                isActive 
                  ? 'bg-orange-500/20 border-orange-500/40 text-white font-medium' 
                  : isDone 
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                    : 'bg-white/5 border-white/5 text-slate-400'
              }`}
            >
              {isDone ? <CheckCircle2 className="h-3 w-3" /> : <div className="h-1.5 w-1.5 rounded-full bg-current" />}
              <span>Шаг {idx + 1}</span>
            </div>
          );
        })}
      </div>

      {currentStep && (
        <GlassPanel className="p-6 border-white/10 relative overflow-hidden" id={`quest_step_${currentStep.id}`}>
          <div className="absolute top-0 right-0 p-4 text-slate-600/30 text-5xl font-extrabold select-none">
            0{currentIndex + 1}
          </div>

          <div className="flex items-start gap-4 mb-6">
            <div className="p-3 rounded-xl bg-orange-500/10 border border-orange-500/20 text-[#FF6B00]">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">{currentStep.title}</h2>
              <p className="text-slate-400 text-sm mt-1">{currentStep.description}</p>
            </div>
          </div>

          {/* Interactive Form Controls for specific steps */}
          <div className="space-y-4 border-t border-white/5 pt-5 mb-6">
            {currentIndex === 0 && (
              <div className="space-y-3">
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Основная информация о бизнесе
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <span className="text-xxs text-slate-500 block mb-1">Название компании</span>
                    <input 
                      type="text" 
                      value={businessName} 
                      onChange={(e) => setBusinessName(e.target.value)} 
                      placeholder="Например, ProЦветы" 
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                    />
                  </div>
                  <div>
                    <span className="text-xxs text-slate-500 block mb-1">Сфера деятельности</span>
                    <input 
                      type="text" 
                      value={industry} 
                      onChange={(e) => setIndustry(e.target.value)} 
                      placeholder="Например, доставка цветов" 
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                    />
                  </div>
                </div>
                <div>
                  <span className="text-xxs text-slate-500 block mb-1">Имя владельца</span>
                  <input 
                    type="text" 
                    value={ownerName} 
                    onChange={(e) => setOwnerName(e.target.value)} 
                    placeholder="Ваше имя" 
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>
            )}

            {currentIndex === 1 && (
              <div className="space-y-3">
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Приветственное сообщение (Ресивер Анна)
                </label>
                <textarea 
                  value={welcomeText} 
                  onChange={(e) => setWelcomeText(e.target.value)} 
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-sm text-white focus:outline-none focus:border-orange-500"
                  placeholder="Введите текст приветствия..."
                />
                <span className="text-xxs text-slate-500 block">
                  Этот текст будет отправлен клиентам в первую очередь, когда они начнут диалог с вашим ботом.
                </span>
              </div>
            )}

            {currentIndex === 2 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                    Каналы связи штаба
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {['telegram', 'whatsapp', 'vk', 'email'].map((ch) => {
                      const isSelected = selectedChannels.includes(ch);
                      return (
                        <button
                          key={ch}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              setSelectedChannels(selectedChannels.filter(c => c !== ch));
                            } else {
                              setSelectedChannels([...selectedChannels, ch]);
                            }
                          }}
                          className={`px-3 py-1.5 rounded-lg border text-xs capitalize font-medium transition-all duration-200 ${
                            isSelected 
                              ? 'bg-orange-500/20 border-orange-500/50 text-white' 
                              : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20'
                          }`}
                        >
                          {ch}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                    Тон общения ИИ-агентов
                  </label>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    {(['friendly', 'professional', 'energetic', 'elegant', 'strict'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setSelectedTone(t)}
                        className={`px-2 py-1.5 rounded-lg border text-center text-xs font-medium transition-all duration-200 ${
                          selectedTone === t 
                            ? 'bg-orange-500/20 border-orange-500/50 text-white' 
                            : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20'
                        }`}
                      >
                        {t === 'friendly' ? 'Дружелюбный' :
                         t === 'professional' ? 'Деловой' :
                         t === 'energetic' ? 'Энергичный' :
                         t === 'elegant' ? 'Элегантный' : 'Строгий'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {currentIndex > 2 && (
              <div className="space-y-3">
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Уровень автономности решений
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setAutonomyLevel('full')}
                    className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all duration-200 ${
                      autonomyLevel === 'full' 
                        ? 'bg-orange-500/20 border-orange-500/50 text-white' 
                        : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20'
                    }`}
                  >
                    <Radio className="h-4 w-4 text-[#FF6B00] mt-0.5 shrink-0" />
                    <div>
                      <span className="text-xs font-bold block text-white">Полная автономия</span>
                      <span className="text-xxs text-slate-400 mt-1 block">Агенты отвечают клиентам автоматически 24/7.</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAutonomyLevel('human-supervised')}
                    className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all duration-200 ${
                      autonomyLevel === 'human-supervised' 
                        ? 'bg-orange-500/20 border-orange-500/50 text-white' 
                        : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20'
                    }`}
                  >
                    <Sliders className="h-4 w-4 text-[#FF6B00] mt-0.5 shrink-0" />
                    <div>
                      <span className="text-xs font-bold block text-white">С подтверждением</span>
                      <span className="text-xxs text-slate-400 mt-1 block">Ответы отправляются в очередь модерации на проверку.</span>
                    </div>
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-between items-center">
            <span className="text-xxs text-slate-500">
              Шаг {currentIndex + 1} из {steps.length}
            </span>
            <NeonButton 
              onClick={handleNext} 
              disabled={loading}
              className="flex items-center gap-1.5"
            >
              {loading ? (
                <span>Запуск...</span>
              ) : currentIndex === steps.length - 1 ? (
                <>
                  <span>Завершить квест</span>
                  <Check className="h-4 w-4" />
                </>
              ) : (
                <>
                  <span>Далее</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </NeonButton>
          </div>
        </GlassPanel>
      )}
    </div>
  );
};
