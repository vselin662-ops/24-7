import React, { useState, useEffect } from 'react';
import { AppConfig, Agent } from './types';
import { OnboardingFlow } from './components/OnboardingFlow';
import { VoiceQuestFlow } from './components/VoiceQuestFlow';
import { SMARTPlanner } from './components/SMARTPlanner';
import { ChannelSimulator } from './components/ChannelSimulator';
import { StaffFeed } from './components/StaffFeed';
import { AnalyticsPanel } from './components/AnalyticsPanel';
import { BillingPanel } from './components/BillingPanel';
import { FAQPanel } from './components/FAQPanel';
import { GlassPanel } from './components/GlassPanel';
import { NeonButton } from './components/NeonButton';
import { KnowledgeBasePanel } from './components/KnowledgeBasePanel';
import { SettingsPanel } from './components/SettingsPanel';
import { ModerationPanel } from './components/ModerationPanel';
import { LaunchModal } from './components/LaunchModal';
import { MCPToolsPanel } from './components/MCPToolsPanel';
import { ResiliencyDashboard } from './components/ResiliencyDashboard';
import { VoiceOrganismOnboarding } from './components/VoiceOrganismOnboarding';
import {
  Bot,
  Calendar,
  TrendingUp,
  CreditCard,
  HelpCircle,
  MessageSquare,
  Activity,
  User,
  Shield,
  Volume2,
  Sparkles,
  Zap,
  Database,
  Sliders,
  Rocket,
  Menu,
  X,
  Compass,
  BarChart3,
  Scale,
  Cpu,
  ShieldCheck,
  PhoneCall,
  Upload,
  Camera
} from 'lucide-react';
// @ts-ignore
import logoImg from './assets/images/logo_1784642385346.jpg';
// @ts-ignore
import bgPhoto from './assets/images/mountain_forest_bg_1785821902731.jpg';

const APP_TITLE = "Цифровой помощник";

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [questSteps, setQuestSteps] = useState<any[]>([]);
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get('mode');
  const chatId = urlParams.get('chatId');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [currentTab, setCurrentTab] = useState<'planner' | 'simulator' | 'feed' | 'knowledge' | 'analytics' | 'billing' | 'faq' | 'settings' | 'moderation' | 'mcp' | 'resiliency'>('planner');
  const [isSyncing, setIsSyncing] = useState(false);
  const [dbStatus, setDbStatus] = useState<{ connected: boolean; mode: string } | null>(null);
  const [logoError, setLogoError] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [isLaunchModalOpen, setIsLaunchModalOpen] = useState(false);
  interface ReadinessState {
    is_live?: boolean;
    all_ready?: boolean;
    kb_ready?: boolean;
    channel_ready?: boolean;
    tone_ready?: boolean;
    missions_ready?: boolean;
  }
  const [readinessState, setReadinessState] = useState<ReadinessState | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showVoiceOrganism, setShowVoiceOrganism] = useState<boolean>(false);
  const [customUserBg, setCustomUserBg] = useState<string | null>(() => {
    return localStorage.getItem('custom_user_bg_photo') || null;
  });
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleCustomPhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        if (result) {
          setCustomUserBg(result);
          localStorage.setItem('custom_user_bg_photo', result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  interface MenuTabItem {
    id: 'planner' | 'simulator' | 'feed' | 'knowledge' | 'analytics' | 'billing' | 'faq' | 'settings' | 'moderation' | 'mcp' | 'resiliency';
    label: string;
    icon: React.ComponentType<any>;
    badge?: number;
  }

  const menuTabs: MenuTabItem[] = [
    { id: 'planner', label: 'Квест-Планировщик', icon: Compass },
    { id: 'simulator', label: 'Каналы Связи', icon: MessageSquare },
    { id: 'mcp', label: 'MCP Сервер & Инструменты', icon: Cpu },
    { id: 'resiliency', label: 'Отказоустойчивость (Circuit Breaker)', icon: ShieldCheck },
    { id: 'feed', label: 'Лента штаба', icon: Activity },
    { id: 'moderation', label: 'Модерация', icon: Shield, badge: pendingCount },
    { id: 'knowledge', label: 'База знаний (RAG)', icon: Database },
    { id: 'analytics', label: 'Аналитика штаба', icon: BarChart3 },
    { id: 'billing', label: 'Тарифы & Биллинг', icon: CreditCard },
    { id: 'faq', label: 'Инструкции & 152-ФЗ', icon: Scale },
    { id: 'settings', label: 'Настройки штаба', icon: Sliders }
  ];

  const fetchReadiness = () => {
    fetch('/api/readiness')
      .then(res => res.json())
      .then(data => {
        if (data && typeof data === 'object') {
          setReadinessState(data as ReadinessState);
        }
      })
      .catch(err => console.warn("Failed to fetch readiness status:", err));
  };

  useEffect(() => {
    fetchReadiness();
  }, []);

  // Load Voice Quest steps if in voice-quest mode
  useEffect(() => {
    if (mode === 'voice-quest' && chatId) {
      setIsSyncing(true);
      fetch(`/api/get-voice-quest?chatId=${chatId}`)
        .then(res => {
          if (!res.ok) throw new Error("Voice quest not found or expired");
          return res.json();
        })
        .then(data => {
          if (data && data.steps) {
            setQuestSteps(data.steps);
          }
        })
        .catch(err => console.warn("Failed to load voice quest steps:", err))
        .finally(() => setIsSyncing(false));
    }
  }, [mode, chatId]);

  // Poll pending moderation count
  useEffect(() => {
    const fetchPendingCount = async () => {
      try {
        const res = await fetch('/api/moderation/queue');
        if (res.ok) {
          const data = await res.json();
          if (data && data.queue) {
            setPendingCount(data.queue.length);
          }
        }
      } catch (err) {
        console.warn("Failed to fetch pending count:", err);
      }
    };
    fetchPendingCount();
    const interval = setInterval(fetchPendingCount, 4000);
    return () => clearInterval(interval);
  }, []);

  // Load config & check sync status from server
  useEffect(() => {
    // 1. Load initial cache from localStorage for instant display
    const savedConfig = localStorage.getItem('ai_staff_config');
    const savedAgents = localStorage.getItem('ai_staff_agents');
    if (savedConfig) {
      try {
        setConfig(JSON.parse(savedConfig));
      } catch (err) {
        console.error("Failed to parse cached config", err);
      }
    }
    if (savedAgents) {
      try {
        setAgents(JSON.parse(savedAgents));
      } catch (err) {
        console.error("Failed to parse cached agents", err);
      }
    }

    // 2. Fetch the ultimate source of truth from Firestore / server
    setIsSyncing(true);
    fetch('/api/get-config')
      .then(res => res.json())
      .then(data => {
        if (data && data.config) {
          // If the server has real data, or if there is no local cache, load it!
          setConfig(data.config);
          localStorage.setItem('ai_staff_config', JSON.stringify(data.config));
          if (data.config.agents && data.config.agents.length > 0) {
            setAgents(data.config.agents);
            localStorage.setItem('ai_staff_agents', JSON.stringify(data.config.agents));
          }
        }
      })
      .catch(err => console.error("Failed to fetch config from server:", err))
      .finally(() => setIsSyncing(false));

    // 3. Fetch database status
    fetch('/api/sync-status')
      .then(res => res.json())
      .then(data => setDbStatus(data))
      .catch(err => console.error("Failed to fetch database status:", err));
  }, []);

  // Sync config with the backend server when it changes
  useEffect(() => {
    if (config) {
      setIsSyncing(true);
      fetch('/api/save-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      })
      .then(res => res.json())
      .then(data => {
        console.log("Config successfully synced to server:", data);
        // Refresh db status
        fetch('/api/sync-status')
          .then(res => res.json())
          .then(statusData => setDbStatus(statusData))
          .catch(() => {});
      })
      .catch(err => console.error("Failed to sync config to server:", err))
      .finally(() => {
        // Simple delay to make the elegant transition visible
        setTimeout(() => setIsSyncing(false), 800);
      });
    }
  }, [config]);

  const handleOnboardingComplete = (newConfig: AppConfig, customizedAgents: Agent[]) => {
    // Сохраняем расширенные поля из текущего конфига, если они есть
    const preservedFields = {
      preferences: (config as any)?.preferences,
      schedule: (config as any)?.schedule,
      proactive_scenarios: (config as any)?.proactive_scenarios,
      tools_enabled: (config as any)?.tools_enabled,
      contacts: (config as any)?.contacts,
      tasks: (config as any)?.tasks,
      notes: (config as any)?.notes,
      metrics: (config as any)?.metrics
    };
    
    const configWithAgents = { 
      ...newConfig, 
      ...preservedFields, // Восстанавливаем расширенные поля
      agents: customizedAgents 
    };
    
    setConfig(configWithAgents as any);
    setAgents(customizedAgents);
    localStorage.setItem('ai_staff_config', JSON.stringify(configWithAgents));
    localStorage.setItem('ai_staff_agents', JSON.stringify(customizedAgents));
  };

  const saveToDb = (newConfig: AppConfig, customizedAgents: Agent[]) => {
    handleOnboardingComplete(newConfig, customizedAgents);
    window.history.replaceState({}, document.title, window.location.pathname);
  };

  const handleWipeAllData = () => {
    setConfig(null);
    setAgents([]);
    localStorage.removeItem('ai_staff_config');
    localStorage.removeItem('ai_staff_agents');
    setCurrentTab('planner');
  };

  const systemPrompts = agents.map(a => ({
    role: a.russianRole,
    prompt: a.systemPrompt
  }));

  // If in voice quest mode, render the custom voice quest layout
  if (mode === 'voice-quest' && chatId) {
    return (
      <div className="min-h-screen flex flex-col justify-between py-6 px-4 font-modern">
        <header className="max-w-5xl mx-auto w-full flex justify-between items-center pb-6 border-b border-white/10 font-modern">
          <div className="flex items-center gap-2">
            <Bot className="h-6 w-6 text-white" style={{ filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.5))' }} />
            <span className="font-semibold text-lg text-white tracking-wide">
              Цифровой помощник
            </span>
          </div>
          <div className="text-xxs text-slate-400">
            Режим: Голосовой Квест | Лицензия Apache-2.0
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center">
          <VoiceQuestFlow steps={questSteps} onComplete={saveToDb} />
        </main>

        <footer className="max-w-5xl mx-auto w-full pt-6 border-t border-white/10 text-center text-xxs text-slate-500 font-modern">
          © 2026 Автономный цифровой помощник для малого бизнеса. Все права защищены. Соответствует 152-ФЗ РФ.
        </footer>
      </div>
    );
  }

  // Living Voice Organism Onboarding (or explicit toggle)
  if (!config || showVoiceOrganism) {
    return (
      <VoiceOrganismOnboarding
        onComplete={(data) => {
          const name = data.userName || (config?.owner_name) || "Предприниматель";
          const newConfig: AppConfig = {
            project_name: "Штаб " + name,
            business_name: (config?.business_name) || ("Цифровой Штаб " + name),
            owner_name: name,
            industry: "Услуги и продажи",
            tone: "friendly",
            autonomy_level: "full",
            channels: ["telegram"],
            voice_id: "Kore",
            is_active: true
          };
          const defaultAgents: Agent[] = [
            { id: "receiver", role: "receiver", name: "Приемщик", russianRole: "Приемщик (Receiver)", description: "Прием обращений клиентов", icon: "📞", systemPrompt: "Ты — Приемщик обращений клиентов.", status: "active", channels: ["telegram"] },
            { id: "sales", role: "sales", name: "Продажник", russianRole: "Продажник (Sales)", description: "Ведение сделок", icon: "💼", systemPrompt: "Ты — Менеджер по продажам.", status: "active", channels: ["telegram"] },
            { id: "operator", role: "operator", name: "Координатор", russianRole: "Координатор (Operator)", description: "Координация задач", icon: "📋", systemPrompt: "Ты — Операционный Координатор.", status: "active", channels: ["telegram"] }
          ];
          handleOnboardingComplete(newConfig, (agents && agents.length > 0) ? agents : defaultAgents);
          setShowVoiceOrganism(false);
        }}
        onClose={config ? () => setShowVoiceOrganism(false) : undefined}
      />
    );
  }

  let statusColor = 'bg-white text-white';
  let statusTitle = 'Штаб Активен';

  if (isSyncing) {
    statusColor = 'bg-white text-white animate-pulse';
    statusTitle = 'Синхронизация...';
  } else if (dbStatus?.connected) {
    statusColor = 'bg-white text-white';
    statusTitle = 'Сохранено в облаке';
  } else {
    statusColor = 'bg-slate-500 text-slate-400';
    statusTitle = 'Локальный кэш';
  }

  const ownerInitial = (config?.owner_name || "В").trim().charAt(0).toUpperCase();
  const staffLive = !!(config?.is_live || readinessState?.is_live);
  const readyFlags = [readinessState?.kb_ready, readinessState?.channel_ready, readinessState?.tone_ready, readinessState?.missions_ready];
  const readyCount = readyFlags.filter(Boolean).length;
  const readyPercent = Math.round((readyCount / 4) * 100);

  return (
    <div className="min-h-screen flex flex-col justify-between py-6 px-4 pb-28 font-modern relative">
      {/* Nebula Background Gradient */}
      <div className="nebula" />

      {/* Hidden File Input for Direct User Photo Upload */}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        onChange={handleCustomPhotoUpload}
        className="hidden"
      />

      {/* Full-screen Background Image */}
      <div className="fixed inset-0 w-full h-full z-0 pointer-events-none overflow-hidden">
        <img
          src={customUserBg || bgPhoto}
          alt="Фоновое изображение"
          className="w-full h-full object-cover object-center filter grayscale contrast-125 brightness-90 opacity-90 transition-all duration-700"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/25 to-black/60 backdrop-blur-[0.5px]" />
      </div>

      {/* Header Panel - SELIN GEOS Luxury Style */}
      <header className="max-w-7xl mx-auto w-full mb-6 relative z-10">
        <div className="bg-[#181412]/85 backdrop-blur-2xl border border-[#DCD6CD]/20 rounded-[24px] sm:rounded-[28px] p-2.5 sm:p-3.5 px-3 sm:px-5 flex items-center justify-between gap-2 sm:gap-4 shadow-[0_12px_40px_rgba(0,0,0,0.7)] overflow-hidden">
          {/* Phone Call Icon / System Gateway & Camera upload */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <a 
              href="tel:+78000000000" 
              className="p-2 sm:p-2.5 rounded-full bg-[#28221F] border border-[#DCD6CD]/20 text-[#DCD6CD] hover:text-white hover:border-[#DCD6CD] transition-all duration-300"
              title="Шлюз прямой связи"
            >
              <PhoneCall className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#DCD6CD]" />
            </a>

            {/* Direct Upload Photo Button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-2 sm:px-3 sm:py-2 rounded-full bg-[#28221F] border border-[#C5A059]/40 text-[#C5A059] hover:bg-[#322B27] hover:border-[#C5A059] transition-all duration-300 flex items-center gap-1.5 text-xs font-serif-geos cursor-pointer"
              title="Загрузить вашу оригинальную фотографию с устройства"
            >
              <Camera className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#C5A059]" />
              <span className="hidden sm:inline text-[#EAE6DF]">Моё фото</span>
            </button>
          </div>
            
          {/* Clean Brand Title with SELIN Logo */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink">
            <div className="w-7 h-7 sm:w-9 sm:h-9 shrink-0 bg-[#28221F] rounded-[10px] sm:rounded-[14px] border border-[#C5A059]/40 flex items-center justify-center overflow-hidden shadow-md">
              <svg viewBox="0 0 100 100" className="w-full h-full p-1 sm:p-1.5" xmlns="http://www.w3.org/2000/svg">
                <g fill="#DCD6CD">
                  <rect x="44" y="6"  width="12" height="12" transform="rotate(45 50 12)" />
                  <rect x="71" y="17" width="12" height="12" transform="rotate(45 77 23)" />
                  <rect x="82" y="44" width="12" height="12" transform="rotate(45 88 50)" />
                  <rect x="71" y="71" width="12" height="12" transform="rotate(45 77 77)" />
                  <rect x="44" y="82" width="12" height="12" transform="rotate(45 50 88)" />
                  <rect x="17" y="71" width="12" height="12" transform="rotate(45 23 77)" />
                  <rect x="6"  y="44" width="12" height="12" transform="rotate(45 12 50)" />
                  <rect x="17" y="17" width="12" height="12" transform="rotate(45 23 23)" />
                </g>
                <text x="50" y="53" textAnchor="middle" fontFamily="serif" fontWeight="normal" fontSize="13" fill="#DCD6CD">SELIN</text>
              </svg>
            </div>
            <span className="font-serif-geos text-sm sm:text-lg md:text-xl text-[#EAE6DF] tracking-wider font-semibold whitespace-nowrap">
              SELIN
            </span>
            <span className="text-[9px] sm:text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-full bg-[#30d158]/10 text-[#30d158] border border-[#30d158]/20 hidden md:inline-block">
              ONLINE
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {/* Live Voice Agent Button */}
            <button
              onClick={() => setShowVoiceOrganism(true)}
              className="p-2 sm:px-3.5 sm:py-2 rounded-full font-serif-geos text-xs font-semibold tracking-wider transition-all duration-300 flex items-center gap-2 cursor-pointer shrink-0 bg-[#DCD6CD] text-[#1A1614] hover:bg-[#EAE6DF] shadow-md"
              title="Запустить голосовой модуль"
            >
              <Volume2 className="h-4 w-4 text-[#1A1614] shrink-0 animate-pulse" />
              <span className="hidden md:inline">Живой Агент</span>
            </button>

            {/* Launch Headquarters Button */}
            <button
              onClick={() => setIsLaunchModalOpen(true)}
              className={`p-2 sm:px-3.5 sm:py-2 rounded-full font-serif-geos text-xs font-semibold tracking-wider transition-all duration-300 flex items-center gap-2 cursor-pointer shrink-0 ${
                config?.is_live || readinessState?.is_live
                  ? 'bg-[#28221F] border border-[#DCD6CD]/30 text-[#EAE6DF] hover:bg-[#342C28]'
                  : 'bg-[#C5A059] text-[#1A1614] hover:bg-[#D8B46E] shadow-md'
              }`}
            >
              {config?.is_live || readinessState?.is_live ? (
                <>
                  <Zap className="h-4 w-4 text-[#C5A059] shrink-0" />
                  <span className="hidden sm:inline">24/7 ONLINE</span>
                </>
              ) : (
                <>
                  <Rocket className="h-4 w-4 text-[#1A1614] shrink-0" />
                  <span className="hidden sm:inline">ШТАБ 24/7</span>
                </>
              )}
            </button>

            {/* Burger Menu Button */}
            <button
              onClick={() => setMenuOpen(true)}
              className="relative shrink-0 p-2 sm:p-2.5 rounded-full bg-[#28221F] border border-[#DCD6CD]/20 hover:border-[#DCD6CD] text-[#EAE6DF] transition-all duration-300 cursor-pointer flex items-center justify-center shadow-md"
              title="Открыть меню управления"
            >
              <Menu className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto w-full flex-1 space-y-6">
        {/* Mobile/Desktop Sleek Sidebar Drawer */}
        {menuOpen && (
          <>
            {/* Overlay */}
            <div
              onClick={() => setMenuOpen(false)}
              className="fixed inset-0 bg-black/80 backdrop-blur-md z-40 transition-opacity duration-300 animate-fade-in"
            />

            {/* Drawer Panel */}
            <div
              className="fixed top-0 right-0 h-full w-[82%] max-w-sm bg-[#14100E]/95 border-l border-[#DCD6CD]/20 z-50 transition-transform duration-300 flex flex-col p-6 backdrop-blur-2xl shadow-[0_0_50px_rgba(0,0,0,0.9)] font-modern"
            >
              {/* Header: Owner Profile + Status + Close */}
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-[#DCD6CD]/15">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-12 h-12 shrink-0 rounded-full bg-[#28221F] border-2 border-[#C5A059]/50 flex items-center justify-center text-[#EAE6DF] font-bold text-lg shadow-md">
                    {ownerInitial}
                  </div>
                  <div className="min-w-0">
                    <div className="text-base font-bold text-[#EAE6DF] truncate leading-tight tracking-wide">{config?.owner_name || "Владелец"}</div>
                    <div className="text-[11px] flex items-center gap-1.5 mt-1 font-serif-geos text-[#C5A059]">
                      <span className="w-2 h-2 rounded-full bg-[#30d158] animate-pulse" />
                      {staffLive ? "ШТАБ АКТИВЕН 24/7" : "ШТАБ ГОТОВ К ЗАПУСКУ"}
                    </div>
                  </div>
                </div>
                <button onClick={() => setMenuOpen(false)} className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 border border-transparent cursor-pointer transition-all shrink-0">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Smooth Progress Bar Indicator */}
              <div className="mb-6 p-4 rounded-2xl bg-[#1C1816]/80 border border-[#DCD6CD]/15 shadow-inner">
                <div className="flex items-center justify-between text-xs text-[#B0A79E] mb-2 font-serif-geos">
                  <span className="text-[#EAE6DF] font-semibold uppercase tracking-wider">Готовность к запуску</span>
                  <span className="text-[#C5A059] font-bold">{readyPercent}% ({readyCount}/4)</span>
                </div>
                <div className="h-2 w-full bg-[#28221F] rounded-full overflow-hidden p-0.5 border border-[#DCD6CD]/10">
                  <div 
                    className="h-full rounded-full bg-gradient-to-r from-[#C5A059] to-[#D8B46E] transition-all duration-700 shadow-[0_0_12px_rgba(197,160,89,0.5)]" 
                    style={{ width: `${readyPercent}%` }} 
                  />
                </div>
              </div>

              {/* Navigation Items with Modern Minimalist Icons */}
              <div className="flex-1 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                {menuTabs.map((tab, idx) => {
                  const active = currentTab === tab.id;
                  const TabIcon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => { setCurrentTab(tab.id); setMenuOpen(false); }}
                      style={{ animationDelay: `${idx * 40}ms` }}
                      className={`relative w-full flex items-center gap-3.5 py-3 px-4 rounded-xl transition-all duration-200 cursor-pointer text-left text-sm tracking-wide ${
                        active 
                          ? "text-[#EAE6DF] bg-[#DCD6CD]/15 border-l-4 border-[#C5A059] font-semibold shadow-[inset_0_0_20px_rgba(255,255,255,0.05)]" 
                          : "text-[#B0A79E] font-normal hover:text-white hover:bg-white/5 hover:border-l-2 hover:border-[#C5A059]/50"
                      }`}
                    >
                      <TabIcon className={`w-5 h-5 shrink-0 ${active ? 'text-[#C5A059]' : 'text-slate-400'}`} />
                      <span className="truncate flex-1">
                        {tab.label}
                      </span>
                      {tab.badge && tab.badge > 0 ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#C5A059] text-slate-950 shadow-md">
                          {tab.badge}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              {/* Footer Actions */}
              <div className="mt-6 pt-4 space-y-3 border-t border-[#DCD6CD]/15">
                <button
                  onClick={() => { setMenuOpen(false); setIsLaunchModalOpen(true); }}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-xs font-serif-geos font-bold transition-all duration-300 cursor-pointer bg-[#DCD6CD] text-[#1A1614] hover:bg-[#EAE6DF] uppercase tracking-widest shadow-md"
                >
                  {staffLive ? <Zap className="h-4 w-4 text-[#1A1614]" /> : <Rocket className="h-4 w-4 text-[#1A1614]" />}
                  {staffLive ? "ШТАБ АКТИВЕН 24/7" : "ЗАПУСТИТЬ ШТАБ"}
                </button>
                <button
                  onClick={() => { if (window.confirm("Сбросить все настройки и данные штаба? Это действие необратимо.")) { setMenuOpen(false); handleWipeAllData(); } }}
                  className="w-full text-center py-2 text-xs font-modern text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
                >
                  Сбросить данные
                </button>
                <div className="text-center font-modern text-[10px] text-slate-500 pt-1">v1.0 · 152-ФЗ РФ</div>
              </div>
            </div>
          </>
        )}

        {/* Dynamic Tab Render */}
        <div className="transition-all duration-300">
          {currentTab === 'planner' && (
            <SMARTPlanner
              businessName={config.business_name}
              ownerName={config.owner_name}
              industry={config.industry}
              tone={config.tone}
              channels={config.channels}
              onComplete={handleOnboardingComplete}
              setCurrentTab={setCurrentTab}
            />
          )}

          {currentTab === 'simulator' && (
            <ChannelSimulator
              businessName={config.business_name}
              ownerName={config.owner_name}
              industry={config.industry}
              tone={config.tone}
              voiceId={config.voice_id}
              autoSynthesize={config.auto_synthesize}
              ttsVoice={config.tts_voice}
            />
          )}

          {currentTab === 'mcp' && <MCPToolsPanel />}

          {currentTab === 'resiliency' && <ResiliencyDashboard />}

          {currentTab === 'feed' && <StaffFeed />}

          {currentTab === 'moderation' && <ModerationPanel />}

          {currentTab === 'knowledge' && <KnowledgeBasePanel />}

          {currentTab === 'analytics' && <AnalyticsPanel />}

          {currentTab === 'billing' && <BillingPanel />}

          {currentTab === 'faq' && (
            <FAQPanel onWipeData={handleWipeAllData} systemPrompts={systemPrompts} />
          )}

          {currentTab === 'settings' && (
            <SettingsPanel
              config={config}
              onSave={(updatedConfig) => {
                setConfig(updatedConfig);
                localStorage.setItem('ai_staff_config', JSON.stringify(updatedConfig));
              }}
            />
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto w-full pt-6 mt-10 border-t border-white/5 text-center">
        <span className="text-xs text-white/30 font-sans tracking-normal block">
          © 2026 Автономный цифровой сотрудник · 152-ФЗ РФ
        </span>
      </footer>

      <LaunchModal
        isOpen={isLaunchModalOpen}
        onClose={() => setIsLaunchModalOpen(false)}
        onLaunched={() => {
          setConfig(prev => prev ? { ...prev, is_live: true } : null);
          fetchReadiness();
        }}
      />

      {/* FIXED BOTTOM NAVIGATION matching requested design */}
      <nav className="bottom-nav">
        <button
          onClick={() => setCurrentTab('planner')}
          className={`nav-item ${currentTab === 'planner' ? 'active' : ''}`}
        >
          <div className="nav-icon">
            <Compass className="w-5 h-5" />
          </div>
          <span>Квест</span>
        </button>

        <button
          onClick={() => setCurrentTab('simulator')}
          className={`nav-item ${currentTab === 'simulator' ? 'active' : ''}`}
        >
          <div className="nav-icon">
            <MessageSquare className="w-5 h-5" />
          </div>
          <span>Каналы</span>
        </button>

        <button
          onClick={() => setCurrentTab('feed')}
          className={`nav-item ${currentTab === 'feed' ? 'active' : ''}`}
        >
          <div className="nav-icon">
            <Activity className="w-5 h-5" />
          </div>
          <span>Лента</span>
        </button>

        <button
          onClick={() => setCurrentTab('analytics')}
          className={`nav-item ${currentTab === 'analytics' ? 'active' : ''}`}
        >
          <div className="nav-icon">
            <BarChart3 className="w-5 h-5" />
          </div>
          <span>Аналитика</span>
        </button>

        <button
          onClick={() => setCurrentTab('moderation')}
          className={`nav-item relative ${currentTab === 'moderation' ? 'active' : ''}`}
        >
          <div className="nav-icon">
            <Shield className="w-5 h-5" />
          </div>
          <span>Модерация</span>
          {pendingCount > 0 && (
            <span className="absolute top-1 right-2 w-2 h-2 bg-red-500 rounded-full animate-ping" />
          )}
        </button>

        <button
          onClick={() => setCurrentTab('settings')}
          className={`nav-item ${currentTab === 'settings' ? 'active' : ''}`}
        >
          <div className="nav-icon">
            <Sliders className="w-5 h-5" />
          </div>
          <span>Настройки</span>
        </button>
      </nav>
    </div>
  );
}
