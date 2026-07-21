import React, { useState, useEffect } from 'react';
import { GlassPanel } from './GlassPanel';
import { NeonButton } from './NeonButton';
import * as Icons from 'lucide-react';

interface SMARTPlannerProps {
  businessName: string;
  ownerName: string;
  industry: string;
  tone: string;
  channels: string[];
}

interface Option {
  id: string;
  label: string;
  icon: string;
}

interface Station {
  id: string;
  title: string;
  subtitle: string;
  type: 'single' | 'multiple';
  options: Option[];
}

interface AgentPlan {
  agent: string;
  title: string;
  mission: string;
  icon: string;
}

export const SMARTPlanner: React.FC<SMARTPlannerProps> = ({
  businessName,
  ownerName,
  industry,
  tone,
  channels
}) => {
  const [questStep, setQuestStep] = useState<'intro' | 'loading' | 'stations' | 'generating' | 'plan' | 'success'>('intro');
  const [stations, setStations] = useState<Station[]>([]);
  const [currentStationIndex, setCurrentStationIndex] = useState(0);
  const [selectedChoices, setSelectedChoices] = useState<Record<string, string[]>>({});
  const [plan, setPlan] = useState<AgentPlan[]>([]);
  const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);

  const getFallbackStations = (ind: string): Station[] => {
    const norm = (ind || "").toLowerCase();
    
    let targetAudienceOpts: Option[] = [
      { id: "opt_1_1", label: "Частные клиенты (B2C)", icon: "Users" },
      { id: "opt_1_2", label: "Бизнес-партнеры (B2B)", icon: "Briefcase" },
      { id: "opt_1_3", label: "Постоянные лояльные гости", icon: "Heart" },
      { id: "opt_1_4", label: "Премиум VIP-сегмент", icon: "Award" }
    ];

    let productsOpts: Option[] = [
      { id: "opt_2_1", label: "Стандартные услуги компании", icon: "ShoppingBag" },
      { id: "opt_2_2", label: "Комплексные пакеты и VIP-тарифы", icon: "Layers" },
      { id: "opt_2_3", label: "Фирменные сопутствующие товары", icon: "ShoppingCart" },
      { id: "opt_2_4", label: "Абонементы и регулярный сервис", icon: "Calendar" }
    ];

    if (norm.includes("авто") || norm.includes("шин") || norm.includes("ремонт")) {
      targetAudienceOpts = [
        { id: "opt_1_1", label: "Владельцы легковых авто", icon: "Users" },
        { id: "opt_1_2", label: "Корпоративные автопарки / Такси", icon: "Briefcase" },
        { id: "opt_1_3", label: "Жители близлежащих районов", icon: "MapPin" },
        { id: "opt_1_4", label: "Владельцы премиум-каров", icon: "Award" }
      ];
      productsOpts = [
        { id: "opt_2_1", label: "Сезонный шиномонтаж", icon: "Zap" },
        { id: "opt_2_2", label: "Ремонт подвески и ТО", icon: "Layers" },
        { id: "opt_2_3", label: "Хранение шин и дисков", icon: "Database" },
        { id: "opt_2_4", label: "Правка и покраска дисков", icon: "Award" }
      ];
    } else if (norm.includes("салон") || norm.includes("крас") || norm.includes("бьют") || norm.includes("космет")) {
      targetAudienceOpts = [
        { id: "opt_1_1", label: "Женщины (уходовые услуги)", icon: "Users" },
        { id: "opt_1_2", label: "Мужской зал / Барбер", icon: "Briefcase" },
        { id: "opt_1_3", label: "Постоянные гости салона", icon: "Heart" },
        { id: "opt_1_4", label: "Клиенты премиум-процедур", icon: "Award" }
      ];
      productsOpts = [
        { id: "opt_2_1", label: "Стрижка и окрашивание", icon: "Sparkles" },
        { id: "opt_2_2", label: "Маникюр и педикюр", icon: "Smile" },
        { id: "opt_2_3", label: "Косметология и массаж", icon: "Heart" },
        { id: "opt_2_4", label: "Профессиональная косметика", icon: "ShoppingBag" }
      ];
    } else if (norm.includes("школ") || norm.includes("курс") || norm.includes("обуч") || norm.includes("инфо")) {
      targetAudienceOpts = [
        { id: "opt_1_1", label: "Начинающие специалисты", icon: "Users" },
        { id: "opt_1_2", label: "Профессионалы (повышение)", icon: "Briefcase" },
        { id: "opt_1_3", label: "Дети и подростки", icon: "Smile" },
        { id: "opt_1_4", label: "Корпоративный сектор (B2B)", icon: "Award" }
      ];
      productsOpts = [
        { id: "opt_2_1", label: "Видеокурсы в записи", icon: "Smartphone" },
        { id: "opt_2_2", label: "Интерактивные вебинары", icon: "Globe" },
        { id: "opt_2_3", label: "Личный менторинг", icon: "Heart" },
        { id: "opt_2_4", label: "Практические воркшопы", icon: "Layers" }
      ];
    }

    return [
      {
        id: "station_1",
        title: "Кто ваши клиенты?",
        subtitle: "Выберите приоритетные сегменты для настройки ИИ-агентов",
        type: "multiple",
        options: targetAudienceOpts
      },
      {
        id: "station_2",
        title: "Что вы продаёте?",
        subtitle: "Выберите основные направления услуг или товаров",
        type: "multiple",
        options: productsOpts
      },
      {
        id: "station_3",
        title: "Откуда приходят заявки?",
        subtitle: "Укажите ключевые каналы привлечения трафика",
        type: "multiple",
        options: [
          { id: "opt_3_1", label: "Рекомендации и сарафан", icon: "Smile" },
          { id: "opt_3_2", label: "Социальные сети и блоги", icon: "Megaphone" },
          { id: "opt_3_3", label: "Поисковые системы Яндекс/Google", icon: "Globe" },
          { id: "opt_3_4", label: "Платный таргетинг / контекст", icon: "Zap" }
        ]
      },
      {
        id: "station_4",
        title: "Как сейчас обрабатываете заявки?",
        subtitle: "Где происходит наибольшая потеря потенциальных клиентов?",
        type: "single",
        options: [
          { id: "opt_4_1", label: "Отвечаем вручную с задержкой", icon: "Clock" },
          { id: "opt_4_2", label: "Теряем лиды вне рабочих часов", icon: "Shield" },
          { id: "opt_4_3", label: "Сложно дожать до оплаты", icon: "MessageSquare" },
          { id: "opt_4_4", label: "Нет четкой схемы прогрева", icon: "TrendingUp" }
        ]
      },
      {
        id: "station_5",
        title: "Где общаетесь с клиентами?",
        subtitle: "Выберите площадки для внедрения авто-агентов",
        type: "multiple",
        options: [
          { id: "opt_5_1", label: "Telegram каналы и боты", icon: "Send" },
          { id: "opt_5_2", label: "WhatsApp чаты и аккаунты", icon: "MessageSquare" },
          { id: "opt_5_3", label: "Корпоративный сайт / лендинг", icon: "Globe" },
          { id: "opt_5_4", label: "Группы в соцсетях VK и др.", icon: "Smartphone" }
        ]
      },
      {
        id: "station_6",
        title: "Какая главная цель на месяц?",
        subtitle: "Определите приоритетную бизнес-задачу на сегодня",
        type: "single",
        options: [
          { id: "opt_6_1", label: "Мгновенные ответы (до 2 мин)", icon: "Clock" },
          { id: "opt_6_2", label: "Рост продаж и апсейлы", icon: "DollarSign" },
          { id: "opt_6_3", label: "Полное освобождение владельца", icon: "Cpu" },
          { id: "opt_6_4", label: "Прогрев холодной базы лидов", icon: "Target" }
        ]
      },
      {
        id: "station_7",
        title: "Сколько времени готовы тратить на контроль?",
        subtitle: "Выберите комфортный режим мониторинга работы штаба",
        type: "single",
        options: [
          { id: "opt_7_1", label: "5 минут: только вечерний рапорт", icon: "Clock" },
          { id: "opt_7_2", label: "30 минут: детальный еженедельный разбор", icon: "FileText" },
          { id: "opt_7_3", label: "Интерактивный контроль в реальном времени", icon: "Eye" },
          { id: "opt_7_4", label: "Полное автономное управление", icon: "Cpu" }
        ]
      }
    ];
  };

  const getFallbackPlan = (ind: string): AgentPlan[] => {
    return [
      {
        agent: "receiver",
        title: "ИИ-Приемщик обращений",
        mission: `Мгновенно отвечает на все входящие вопросы клиентов. Квалифицирует лидов, выявляет интерес к направлению "${ind || "услуги"}" и снимает рутину ответов на частые вопросы.`,
        icon: "MessageSquare"
      },
      {
        agent: "content",
        title: "ИИ-Контент-маркетолог",
        mission: "Генерирует живые, прогревающие посты о качестве работы, акциях и отзывах. Ведет регулярные публикации в выбранных соцсетях для повышения вовлеченности аудитории.",
        icon: "PenTool"
      },
      {
        agent: "sales",
        title: "ИИ-Менеджер по продажам",
        mission: "Концентрируется на дожиме теплых заявок. Отправляет индивидуальные коммерческие предложения, обосновывает выгоды, отрабатывает возражения и стимулирует скорейшую оплату услуг.",
        icon: "DollarSign"
      },
      {
        agent: "analyst",
        title: "ИИ-Бизнес-аналитик",
        mission: "Контролирует скорость ответов и качество переписок. Выявляет этапы воронки, где клиенты уходят, и дает рекомендации по оптимизации скриптов для решения бизнес-целей.",
        icon: "BarChart2"
      },
      {
        agent: "operator",
        title: "ИИ-Шеф Координатор",
        mission: "Полностью координирует работу всех цифровых сотрудников. Формирует лаконичный и понятный вечерний рапорт за 1 минуту для руководителя и отслеживает ключевые метрики.",
        icon: "CheckSquare"
      }
    ];
  };

  // Load dynamically generated stations for this business from backend
  const startQuest = async () => {
    setQuestStep('loading');
    try {
      const response = await fetch('/api/quest/generate-stations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          industry,
          business_name: businessName,
          objective: "Оптимизация и автоматизация рабочих процессов компании"
        })
      });
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      const data = await response.json();
      if (data.stations && data.stations.length > 0) {
        setStations(data.stations);
        // Initialize choices
        const initialChoices: Record<string, string[]> = {};
        data.stations.forEach((s: Station) => {
          initialChoices[s.id] = [];
        });
        setSelectedChoices(initialChoices);
        setQuestStep('stations');
        setCurrentStationIndex(0);
      } else {
        throw new Error("No stations returned by API");
      }
    } catch (err) {
      console.warn("Using offline / local fallback for quest stations:", err);
      // Fallback
      const fallbackStations = getFallbackStations(industry);
      setStations(fallbackStations);
      const initialChoices: Record<string, string[]> = {};
      fallbackStations.forEach((s: Station) => {
        initialChoices[s.id] = [];
      });
      setSelectedChoices(initialChoices);
      setQuestStep('stations');
      setCurrentStationIndex(0);
    }
  };

  // Toggle selection of card
  const handleSelectOption = (stationId: string, optionId: string, type: 'single' | 'multiple') => {
    setSelectedChoices(prev => {
      const current = prev[stationId] || [];
      if (type === 'single') {
        return { ...prev, [stationId]: [optionId] };
      } else {
        if (current.includes(optionId)) {
          return { ...prev, [stationId]: current.filter(id => id !== optionId) };
        } else {
          return { ...prev, [stationId]: [...current, optionId] };
        }
      }
    });
  };

  const handleNext = async () => {
    if (currentStationIndex < stations.length - 1) {
      setCurrentStationIndex(prev => prev + 1);
    } else {
      // Last step: compile choices and generate plan
      await generatePlan();
    }
  };

  const handleSkip = () => {
    if (currentStationIndex < stations.length - 1) {
      setCurrentStationIndex(prev => prev + 1);
    } else {
      generatePlan();
    }
  };

  const handleBack = () => {
    if (currentStationIndex > 0) {
      setCurrentStationIndex(prev => prev - 1);
    } else {
      setQuestStep('intro');
    }
  };

  const generatePlan = async () => {
    setQuestStep('generating');
    try {
      // Map station choices to names/labels for the AI to process better
      const mappedChoices: Record<string, string[]> = {};
      stations.forEach(s => {
        const chosenIds = selectedChoices[s.id] || [];
        const chosenLabels = s.options
          .filter(opt => chosenIds.includes(opt.id))
          .map(opt => opt.label);
        mappedChoices[s.title] = chosenLabels.length > 0 ? chosenLabels : ["Не выбрано"];
      });

      const response = await fetch('/api/quest/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedChoices: mappedChoices,
          industry,
          business_name: businessName,
          owner_name: ownerName,
          objective: "Успешный запуск и координация ИИ-штаба"
        })
      });
      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }
      const data = await response.json();
      if (data.plan && data.plan.length > 0) {
        setPlan(data.plan);
        setQuestStep('plan');
      } else {
        throw new Error("No plan returned by API");
      }
    } catch (err) {
      console.warn("Using offline / local fallback for quest plan generation:", err);
      // Fallback
      const fallbackPlan = getFallbackPlan(industry);
      setPlan(fallbackPlan);
      setQuestStep('plan');
    }
  };

  // Helper to render Lucide icons dynamically
  const renderIcon = (iconName: string) => {
    const IconComponent = (Icons as any)[iconName] || Icons.HelpCircle;
    return <IconComponent className="h-8 w-8 text-[#F5A623] shrink-0" />;
  };

  const currentStation = stations[currentStationIndex];

  return (
    <div className="w-full min-h-[600px] bg-white/4 backdrop-blur-xl text-white rounded-3xl border border-white/10 p-6 md:p-12 font-sans relative overflow-hidden transition-all duration-300 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)]">
      
      {/* Absolute Background Ambient Glows */}
      <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-[#F5A623]/5 blur-[120px] pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-[#F5A623]/5 blur-[120px] pointer-events-none" />

      {/* 1. INTRO SCREEN */}
      {questStep === 'intro' && (
        <div className="flex flex-col items-center text-center justify-center py-12 max-w-3xl mx-auto space-y-8 animate-fade-in">
          <div className="h-16 w-16 rounded-2xl bg-[#F5A623]/10 border border-[#F5A623]/20 flex items-center justify-center shadow-[0_0_30px_rgba(245,166,35,0.1)]">
            <Icons.Compass className="h-8 w-8 text-[#F5A623] animate-spin-slow" />
          </div>

          <div className="space-y-4">
            <span className="text-xs uppercase tracking-[0.3em] font-semibold text-[#F5A623]">интерактивный интеллигентный квест</span>
            <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight leading-tight uppercase">
              Настройка вашего ИИ-Штаба
            </h1>
            <p className="text-lg text-slate-400 font-light max-w-xl mx-auto leading-relaxed">
              Пройдите короткий увлекательный квест из 7 станций по алгоритму вашего бизнеса. ИИ мгновенно составит персональный план запуска штаба простым и понятным языком.
            </p>
          </div>

          <div className="pt-4 w-full max-w-sm">
            <button
              onClick={startQuest}
              className="w-full bg-[#F5A623] hover:bg-[#e09212] text-[#0A0A0B] text-base font-bold py-4 px-8 rounded-xl transition-all duration-300 transform hover:scale-[1.02] shadow-[0_4px_20px_rgba(245,166,35,0.25)] cursor-pointer tracking-wider uppercase"
            >
              Запустить квест
            </button>
            <p className="text-xs text-slate-500 mt-4">
              Время прохождения: ~3 минуты • Настройка под нишу: {industry || "Общие услуги"}
            </p>
          </div>
        </div>
      )}

      {/* 2. LOADING STATIONS SCREEN */}
      {questStep === 'loading' && (
        <div className="flex flex-col items-center justify-center py-24 space-y-6 animate-fade-in text-center max-w-md mx-auto">
          <Icons.Loader2 className="h-12 w-12 text-[#F5A623] animate-spin" />
          <div className="space-y-2">
            <h3 className="text-xl font-bold uppercase tracking-wider text-white">Генерируем квест...</h3>
            <p className="text-sm text-slate-400 font-light">
              ИИ-Архитектор выстраивает 7 станций-вопросов специально для бизнеса в сфере <span className="text-[#F5A623] font-medium">"{industry}"</span>...
            </p>
          </div>
        </div>
      )}

      {/* 3. WIZARD STATIONS SCREEN */}
      {questStep === 'stations' && currentStation && (
        <div className="space-y-10 animate-fade-in">
          
          {/* Header & Progress Indicator */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/[0.08] pb-6">
            <div className="space-y-1">
              <span className="text-xs font-bold text-[#F5A623] uppercase tracking-[0.25em]">
                Станция {currentStationIndex + 1} из {stations.length}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Сфера: {industry || "Услуги"}</span>
                <span className="h-1 w-1 rounded-full bg-slate-600" />
                <span className="text-xs text-slate-400">
                  Выбор: {currentStation.type === 'single' ? 'Одиночный' : 'Множественный'}
                </span>
              </div>
            </div>
            
            {/* Elegant thin progress bar */}
            <div className="w-full md:w-64 bg-white/[0.04] h-1.5 rounded-full overflow-hidden border border-white/[0.05]">
              <div 
                className="bg-[#F5A623] h-full transition-all duration-300 shadow-[0_0_10px_rgba(245,166,35,0.5)]" 
                style={{ width: `${((currentStationIndex + 1) / stations.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Large Massive Question */}
          <div className="space-y-3 max-w-4xl text-left">
            <h2 className="text-[32px] md:text-[40px] font-black text-white tracking-tight leading-tight">
              {currentStation.title}
            </h2>
            <p className="text-base text-slate-400 font-light">
              {currentStation.subtitle}
            </p>
          </div>

          {/* Interactive Large Option Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {currentStation.options.map(opt => {
              const isSelected = (selectedChoices[currentStation.id] || []).includes(opt.id);
              return (
                <div
                  key={opt.id}
                  onClick={() => handleSelectOption(currentStation.id, opt.id, currentStation.type)}
                  className={`min-h-[104px] p-6 rounded-2xl border transition-all duration-300 flex items-center justify-between gap-6 cursor-pointer transform hover:scale-[1.01] ${
                    isSelected
                      ? 'border-accent bg-accent/10 backdrop-blur-md shadow-[0_0_25px_rgba(245,166,35,0.12)]'
                      : 'border-white/10 bg-white/4 backdrop-blur-md hover:border-accent/30 hover:bg-white/6 hover:shadow-[0_0_20px_rgba(245,166,35,0.1)]'
                  }`}
                >
                  <div className="flex items-center gap-5">
                    {/* Big Icon */}
                    <div className="h-14 w-14 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
                      {renderIcon(opt.icon)}
                    </div>
                    {/* Option Text (18-20px) */}
                    <span className="text-[18px] md:text-[20px] font-semibold text-white tracking-tight text-left leading-snug">
                      {opt.label}
                    </span>
                  </div>

                  {/* Circular selector indicator */}
                  <div className={`h-7 w-7 rounded-full border flex items-center justify-center transition-all duration-200 shrink-0 ${
                    isSelected 
                      ? 'bg-[#F5A623] border-[#F5A623] text-[#0A0A0B]' 
                      : 'border-white/20'
                  }`}>
                    {isSelected && <Icons.Check className="h-4.5 w-4.5 stroke-[3]" />}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Action Navigation Buttons */}
          <div className="flex items-center justify-between pt-8 border-t border-white/[0.08]">
            <button
              onClick={handleBack}
              className="text-sm uppercase tracking-wider text-slate-400 hover:text-white transition-colors cursor-pointer flex items-center gap-2"
            >
              <Icons.ChevronLeft className="h-4 w-4" /> Назад
            </button>

            <div className="flex items-center gap-4">
              <button
                onClick={handleSkip}
                className="text-sm uppercase tracking-wider text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
              >
                Пропустить
              </button>
              
              <button
                onClick={handleNext}
                disabled={currentStation.type === 'single' && (selectedChoices[currentStation.id] || []).length === 0}
                className={`px-8 py-4 rounded-xl text-sm font-bold uppercase tracking-wider transition-all duration-300 flex items-center gap-2 cursor-pointer ${
                  currentStation.type === 'single' && (selectedChoices[currentStation.id] || []).length === 0
                    ? 'bg-white/5 border border-white/10 text-slate-500 cursor-not-allowed'
                    : 'bg-[#F5A623] hover:bg-[#e09212] text-[#0A0A0B] shadow-[0_4px_15px_rgba(245,166,35,0.2)]'
                }`}
              >
                {currentStationIndex === stations.length - 1 ? 'Составить план' : 'Дальше'} 
                <Icons.ArrowRight className="h-4 w-4 stroke-[2.5]" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. GENERATING PLAN SCREEN */}
      {questStep === 'generating' && (
        <div className="flex flex-col items-center justify-center py-24 space-y-6 animate-fade-in text-center max-w-md mx-auto">
          <Icons.Loader2 className="h-12 w-12 text-[#F5A623] animate-spin" />
          <div className="space-y-2">
            <h3 className="text-xl font-bold uppercase tracking-wider text-white">Выстраиваем процессы штаба...</h3>
            <p className="text-sm text-slate-400 font-light">
              ИИ декомпозирует ваши задачи, формирует роли агентов и связывает каналы связи в готовую систему...
            </p>
          </div>
        </div>
      )}

      {/* 5. PLAN RESULTS SCREEN */}
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
                // Restart quest
                setQuestStep('intro');
                setStations([]);
                setSelectedChoices({});
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
          <div className="bg-white/6 border border-white/12 backdrop-blur-xl rounded-3xl p-8 md:p-12 max-w-lg w-full text-center space-y-6 shadow-2xl relative">
            <div className="h-16 w-16 rounded-2xl bg-[#F5A623]/10 border border-[#F5A623]/20 flex items-center justify-center mx-auto shadow-[0_0_30px_rgba(245,166,35,0.25)]">
              <Icons.Sparkles className="h-8 w-8 text-[#F5A623] animate-pulse" />
            </div>

            <div className="space-y-3">
              <h3 className="text-2xl md:text-3xl font-black uppercase text-white tracking-tight">Штаб успешно запущен!</h3>
              <p className="text-sm text-slate-400 font-light leading-relaxed">
                Поздравляем! Все 5 ИИ-сотрудников активированы и настроены на алгоритмы вашего бизнеса в сфере "{industry}". Проверьте вкладку "Каналы связи", чтобы протестировать их работу в реальном времени!
              </p>
            </div>

            <button
              onClick={() => {
                setIsSuccessModalOpen(false);
                // Optionally transition to simulator tab or let them view plan
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
