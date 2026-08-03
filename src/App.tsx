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
  Scale
} from 'lucide-react';
// @ts-ignore
import logoImg from './assets/images/logo_1784642385346.jpg';

const APP_TITLE = "Цифровой помощник";

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [questSteps, setQuestSteps] = useState<any[]>([]);
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get('mode');
  const chatId = urlParams.get('chatId');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [currentTab, setCurrentTab] = useState<'planner' | 'simulator' | 'feed' | 'knowledge' | 'analytics' | 'billing' | 'faq' | 'settings' | 'moderation'>('planner');
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

  interface MenuTabItem {
    id: 'planner' | 'simulator' | 'feed' | 'knowledge' | 'analytics' | 'billing' | 'faq' | 'settings' | 'moderation';
    label: string;
    icon: React.ComponentType<any>;
    badge?: number;
  }

  const menuTabs: MenuTabItem[] = [
    { id: 'planner', label: 'Квест-Планировщик', icon: Compass },
    { id: 'simulator', label: 'Каналы Связи', icon: MessageSquare },
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

  // If onboarding is not complete, show the elegant onboarding flow
  if (!config) {
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
            Версия 1.0 | Лицензия Apache-2.0
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center">
          <OnboardingFlow onComplete={handleOnboardingComplete} />
        </main>

        <footer className="max-w-5xl mx-auto w-full pt-6 border-t border-white/10 text-center text-xxs text-slate-500 font-modern">
          © 2026 Автономный цифровой помощник для малого бизнеса. Все права защищены. Соответствует 152-ФЗ РФ.
        </footer>
      </div>
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

      {/* Header Panel */}
      <header className="max-w-7xl mx-auto w-full mb-6 relative z-10">
        <div className="bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl p-4 flex items-center justify-between gap-3 shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
          <div className="flex items-center gap-4">
            {/* Logo container - replaced with Selin SVG in luxury white */}
            <div className="w-12 h-12 shrink-0 bg-white/5 rounded-xl border border-white/10 flex items-center justify-center overflow-hidden shadow-[0_0_15px_rgba(255,255,255,0.05)]">
              <svg viewBox="0 0 100 100" className="w-full h-full p-1" xmlns="http://www.w3.org/2000/svg">
                <g fill="#FFFFFF" style={{ filter: 'drop-shadow(0 0 5px rgba(255,255,255,0.6))' }}>
                  <rect x="44" y="6"  width="12" height="12" transform="rotate(45 50 12)" />
                  <rect x="71" y="17" width="12" height="12" transform="rotate(45 77 23)" />
                  <rect x="82" y="44" width="12" height="12" transform="rotate(45 88 50)" />
                  <rect x="71" y="71" width="12" height="12" transform="rotate(45 77 77)" />
                  <rect x="44" y="82" width="12" height="12" transform="rotate(45 50 88)" />
                  <rect x="17" y="71" width="12" height="12" transform="rotate(45 23 77)" />
                  <rect x="6"  y="44" width="12" height="12" transform="rotate(45 12 50)" />
                  <rect x="17" y="17" width="12" height="12" transform="rotate(45 23 23)" />
                </g>
                <text x="50" y="53" textAnchor="middle" fontFamily="sans-serif" fontWeight="bold" fontSize="14" fill="#FFFFFF">Selin</text>
                <line x1="37" y1="58" x2="63" y2="58" stroke="#FFFFFF" strokeWidth="1.2" />
              </svg>
            </div>
            
            {/* Title & Orbitron Brand */}
            <div className="flex items-center gap-3">
              <span className="brand text-base md:text-lg">
                SELIN
              </span>
              <span className="status-badge hidden sm:inline-block">
                ONLINE
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 ml-auto">
            {/* Launch Headquarters Button */}
            <button
              onClick={() => setIsLaunchModalOpen(true)}
              className={`px-4 py-2.5 rounded-xl font-modern text-xs font-bold tracking-wider uppercase transition-all duration-300 flex items-center gap-2 cursor-pointer shrink-0 ${
                config?.is_live || readinessState?.is_live
                  ? 'bg-white/10 border border-white/30 text-white shadow-[0_0_20px_rgba(255,255,255,0.12)] hover:bg-white/20'
                  : readinessState?.all_ready
                  ? 'bg-white text-black hover:bg-slate-200 shadow-[0_0_25px_rgba(255,255,255,0.25)]'
                  : 'bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10'
              }`}
            >
              {config?.is_live || readinessState?.is_live ? (
                <>
                  <Zap className="h-4 w-4 text-white shrink-0" />
                  <span className="hidden sm:inline">Штаб работает 24/7</span>
                </>
              ) : (
                <>
                  <Rocket className="h-4 w-4 text-white shrink-0" />
                  <span className="hidden sm:inline">ЗАПУСТИТЬ ШТАБ</span>
                </>
              )}
            </button>

            {/* Burger Menu Button */}
            <button
              onClick={() => setMenuOpen(true)}
              className="relative shrink-0 p-2.5 rounded-xl bg-white/5 border border-white/10 hover:border-white hover:text-white text-slate-300 transition-all duration-300 cursor-pointer flex items-center justify-center shadow-lg"
              title="Открыть меню"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto w-full flex-1 space-y-6">
        {/* Mobile/Desktop Burger Drawer */}
        {menuOpen && (
          <>
            {/* Overlay */}
            <div
              onClick={() => setMenuOpen(false)}
              className="fixed inset-0 bg-black/70 backdrop-blur-md z-40 transition-opacity duration-300 animate-fade-in"
            />

            {/* Drawer Panel */}
            <div
              className="fixed top-0 right-0 h-full w-[78%] max-w-xs bg-[#08080A] border-l border-white/15 z-50 transition-transform duration-300 flex flex-col p-6 backdrop-blur-2xl shadow-[0_8px_40px_rgba(0,0,0,0.9)] font-modern"
            >
              {/* Шапка: профиль владельца + статус + закрытие */}
              <div className="flex items-center justify-between mb-5 pb-4 border-b border-white/10">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 shrink-0 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white font-semibold text-lg shadow-[0_0_15px_rgba(255,255,255,0.1)]">
                    {ownerInitial}
                  </div>
                  <div className="min-w-0">
                    <div className="text-base font-bold text-white truncate leading-tight">{config?.owner_name || "Владелец"}</div>
                    <div className="text-[10px] flex items-center gap-1.5 mt-0.5 text-white/80">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                      {staffLive ? "Штаб работает 24/7" : "Штаб не запущен"}
                    </div>
                  </div>
                </div>
                <button onClick={() => setMenuOpen(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 cursor-pointer transition-colors shrink-0">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Прогресс-бар готовности */}
              <div className="mb-5">
                <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1.5">
                  <span>Готовность к запуску</span>
                  <span className="text-white font-semibold">{readyCount}/4</span>
                </div>
                <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-white rounded-full transition-all duration-500 shadow-[0_0_8px_rgba(255,255,255,0.5)]" style={{ width: `${readyPercent}%` }} />
                </div>
              </div>

              {/* Список пунктов */}
              <div className="flex-1 overflow-y-auto space-y-0 pr-1">
                {menuTabs.map((tab, idx) => {
                  const active = currentTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => { setCurrentTab(tab.id); setMenuOpen(false); }}
                      style={{ animationDelay: `${idx * 50}ms` }}
                      className={`relative w-full flex items-center py-3 px-4 border-b border-white/5 transition-all duration-300 cursor-pointer text-left font-modern text-sm tracking-wide ${
                        active 
                          ? "text-white bg-white/10 border-l-2 border-white font-semibold shadow-[inset_0_0_10px_rgba(255,255,255,0.05)]" 
                          : "text-[#A0A0A0] font-normal hover:text-white hover:bg-white/[0.04]"
                      }`}
                    >
                      <span className="truncate">
                        {tab.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Футер: быстрые действия */}
              <div className="mt-5 pt-4 space-y-3">
                <div className="w-full h-px bg-white/10 mb-3" />
                <button
                  onClick={() => { setMenuOpen(false); setIsLaunchModalOpen(true); }}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold transition-all duration-300 cursor-pointer bg-white text-black hover:bg-slate-200 uppercase tracking-widest shadow-[0_4px_20px_rgba(255,255,255,0.2)]"
                >
                  {staffLive ? <Zap className="h-4 w-4" /> : <Rocket className="h-4 w-4" />}
                  {staffLive ? "Штаб работает 24/7" : "Запустить штаб"}
                </button>
                <button
                  onClick={() => { if (window.confirm("Сбросить все настройки и данные штаба? Это действие необратимо.")) { setMenuOpen(false); handleWipeAllData(); } }}
                  className="w-full text-center py-2 text-xs text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
                >
                  Сбросить данные
                </button>
                <div className="text-center text-[9px] text-slate-600 pt-1">v1.0 · 152-ФЗ РФ</div>
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
