import React, { useState, useEffect } from 'react';
import { AppConfig, Agent } from './types';
import { OnboardingFlow } from './components/OnboardingFlow';
import { SMARTPlanner } from './components/SMARTPlanner';
import { ChannelSimulator } from './components/ChannelSimulator';
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
  const [agents, setAgents] = useState<Agent[]>([]);
  const [currentTab, setCurrentTab] = useState<'planner' | 'simulator' | 'knowledge' | 'analytics' | 'billing' | 'faq' | 'settings' | 'moderation'>('planner');
  const [isSyncing, setIsSyncing] = useState(false);
  const [dbStatus, setDbStatus] = useState<{ connected: boolean; mode: string } | null>(null);
  const [logoError, setLogoError] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [isLaunchModalOpen, setIsLaunchModalOpen] = useState(false);
  const [readinessState, setReadinessState] = useState<{ is_live?: boolean; all_ready?: boolean; kb_ready?: boolean; channel_ready?: boolean; tone_ready?: boolean; missions_ready?: boolean } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  interface MenuTabItem {
    id: 'planner' | 'simulator' | 'knowledge' | 'analytics' | 'billing' | 'faq' | 'settings' | 'moderation';
    label: string;
    icon: React.ComponentType<any>;
    badge?: number;
  }

  const menuTabs: MenuTabItem[] = [
    { id: 'planner', label: 'Квест-Планировщик', icon: Compass },
    { id: 'simulator', label: 'Каналы Связи', icon: MessageSquare },
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
      .then(data => setReadinessState(data))
      .catch(err => console.warn("Failed to fetch readiness status:", err));
  };

  useEffect(() => {
    fetchReadiness();
  }, []);

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
    const configWithAgents = { ...newConfig, agents: customizedAgents };
    setConfig(configWithAgents);
    setAgents(customizedAgents);
    localStorage.setItem('ai_staff_config', JSON.stringify(configWithAgents));
    localStorage.setItem('ai_staff_agents', JSON.stringify(customizedAgents));
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

  // If onboarding is not complete, show the elegant onboarding flow
  if (!config) {
    return (
      <div className="min-h-screen flex flex-col justify-between py-6 px-4">
        <header className="max-w-5xl mx-auto w-full flex justify-between items-center pb-6 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Bot className="h-6 w-6 text-[#F5A623]" />
            <span className="font-display font-bold text-lg text-white tracking-wide">
              Цифровой сотрудник
            </span>
          </div>
          <div className="text-xxs text-slate-500">
            Версия 1.0 | Лицензия Apache-2.0
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center">
          <OnboardingFlow onComplete={handleOnboardingComplete} />
        </main>

        <footer className="max-w-5xl mx-auto w-full pt-6 border-t border-white/5 text-center text-xxs text-slate-600">
          © 2026 Автономный цифровой сотрудник для малого бизнеса. Все права защищены. Соответствует 152-ФЗ РФ.
        </footer>
      </div>
    );
  }

  let statusColor = 'bg-emerald-500 text-emerald-400';
  let statusTitle = 'Штаб Активен';

  if (isSyncing) {
    statusColor = 'bg-[#F5A623] text-[#F5A623] animate-pulse';
    statusTitle = 'Синхронизация...';
  } else if (dbStatus?.connected) {
    statusColor = 'bg-[#F5A623] text-[#F5A623]';
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
    <div className="min-h-screen flex flex-col justify-between py-6 px-4">
      {/* Header Panel */}
      <header className="max-w-7xl mx-auto w-full mb-6 relative">
        <div className="premium-card p-4 rounded-2xl lux-shadow lux-hairline flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            {/* Logo container - replaced with Selin SVG */}
            <div className="w-12 h-12 shrink-0 bg-white rounded-2xl flex items-center justify-center overflow-hidden shadow-[0_2px_10px_rgba(0,0,0,0.3)]">
              <svg viewBox="0 0 100 100" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
                <g fill="#000000">
                  <rect x="44" y="6"  width="12" height="12" transform="rotate(45 50 12)" />
                  <rect x="71" y="17" width="12" height="12" transform="rotate(45 77 23)" />
                  <rect x="82" y="44" width="12" height="12" transform="rotate(45 88 50)" />
                  <rect x="71" y="71" width="12" height="12" transform="rotate(45 77 77)" />
                  <rect x="44" y="82" width="12" height="12" transform="rotate(45 50 88)" />
                  <rect x="17" y="71" width="12" height="12" transform="rotate(45 23 77)" />
                  <rect x="6"  y="44" width="12" height="12" transform="rotate(45 12 50)" />
                  <rect x="17" y="17" width="12" height="12" transform="rotate(45 23 23)" />
                </g>
                <text x="50" y="53" textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontSize="15" fill="#000000">Selin</text>
                <line x1="37" y1="58" x2="63" y2="58" stroke="#000000" strokeWidth="1.2" />
              </svg>
            </div>
            
            {/* Title & Dot */}
            <div className="flex items-center gap-3">
              <h1 className="font-lux text-2xl md:text-3xl text-white tracking-normal leading-none select-none">
                {APP_TITLE}
              </h1>
              
              {/* Dot Status Indicator */}
              <div className="group relative cursor-pointer flex items-center pt-0.5">
                <span className={`w-2.5 h-2.5 rounded-full ${statusColor.split(' ')[0]} shadow-[0_0_8px_currentColor] transition-all duration-300`} style={{ color: statusColor.includes('emerald') ? '#10B981' : statusColor.includes('F5A623') ? '#F5A623' : '#64748B' }} />
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 bg-black/95 text-white text-[10px] font-sans font-medium px-2.5 py-1 rounded-lg border border-white/10 shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-50">
                  {statusTitle}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 ml-auto">
            {/* Launch Headquarters Button */}
            <button
              onClick={() => setIsLaunchModalOpen(true)}
              className={`px-4 py-2 rounded-xl font-sans text-xs font-bold transition-all duration-300 flex items-center gap-2 cursor-pointer shrink-0 ${
                config?.is_live || readinessState?.is_live
                  ? 'bg-emerald-500/10 border border-emerald-500/40 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                  : readinessState?.all_ready
                  ? 'bg-[#F5A623] text-black hover:bg-[#F5A623]/90 shadow-[0_0_15px_rgba(245,166,35,0.3)]'
                  : 'bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10'
              }`}
            >
              {config?.is_live || readinessState?.is_live ? (
                <>
                  <Zap className="h-4 w-4 text-emerald-400 animate-pulse shrink-0" />
                  <span className="hidden sm:inline">Штаб работает 24/7</span>
                </>
              ) : (
                <>
                  <Rocket className="h-4 w-4 text-[#F5A623] shrink-0" />
                  <span className="hidden sm:inline">ЗАПУСТИТЬ ШТАБ</span>
                </>
              )}
            </button>

            {/* Burger Menu Button */}
            <button
              onClick={() => setMenuOpen(true)}
              className="relative shrink-0 p-2.5 rounded-xl bg-white/5 border border-white/10 hover:border-[#F5A623] hover:text-[#F5A623] text-white transition-all duration-300 cursor-pointer shadow-lg flex items-center justify-center"
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
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity duration-300 animate-fade-in"
            />

            {/* Drawer Panel */}
            <div
              className="fixed top-0 right-0 h-full w-[78%] max-w-xs bg-[#0B0A09]/97 border-l lux-hairline z-50 transition-transform duration-300 flex flex-col p-6 lux-shadow backdrop-blur-xl"
            >
              {/* Шапка: профиль владельца + статус + закрытие */}
              <div className="flex items-center justify-between mb-5 pb-4 border-b lux-hairline">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 shrink-0 rounded-full bg-[#F5A623]/10 border lux-hairline flex items-center justify-center text-[#F5A623] font-lux text-xl">
                    {ownerInitial}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xl font-lux text-white truncate leading-tight">{config?.owner_name || "Владелец"}</div>
                    <div className={`text-[10px] flex items-center gap-1.5 mt-0.5 ${staffLive ? "text-emerald-400" : "text-slate-400"}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${staffLive ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
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
                  <span className="text-[#F5A623] font-semibold">{readyCount}/4</span>
                </div>
                <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-[#F5A623] rounded-full transition-all duration-500 shadow-[0_0_8px_rgba(245,166,35,0.3)]" style={{ width: `${readyPercent}%` }} />
                </div>
              </div>

              {/* Список пунктов — стеклянные плитки */}
              <div className="flex-1 overflow-y-auto space-y-0 pr-1">
                {menuTabs.map((tab, idx) => {
                  const active = currentTab === tab.id;
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => { setCurrentTab(tab.id); setMenuOpen(false); }}
                      style={{ animationDelay: `${idx * 50}ms` }}
                      className="relative w-full flex items-center gap-4 py-3 border-b lux-hairline transition-all duration-300 cursor-pointer text-left overflow-hidden animate-fade-in hover:bg-white/[0.02]"
                    >
                      {active && (
                        <span className="absolute left-0 top-2 bottom-2 w-px bg-[#F5A623] shadow-[0_0_8px_rgba(245,166,35,0.6)]" />
                      )}
                      <div className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center border transition-all duration-300 ${
                        active ? "bg-[#F5A623]/10 border-[#F5A623]/30" : "bg-white/5 border-white/[0.08]"
                      }`}>
                        <Icon className={`h-4.5 w-4.5 ${active ? "text-[#F5A623]" : "text-slate-400"}`} />
                      </div>
                      <span className={`flex-1 font-lux text-lg truncate ${active ? "text-[#F5A623]" : "text-white"}`}>
                        {tab.label}
                      </span>
                      {tab.badge !== undefined && tab.badge > 0 && (
                        <span className="bg-[#F5A623] text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none shrink-0">
                          {tab.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Футер: быстрые действия */}
              <div className="mt-5 pt-4 space-y-3">
                <div className="lux-gold-line w-full opacity-40 mb-3" />
                <button
                  onClick={() => { setMenuOpen(false); setIsLaunchModalOpen(true); }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all duration-300 cursor-pointer bg-[#F5A623] text-black hover:bg-[#F5A623]/90 shadow-[0_0_15px_rgba(245,166,35,0.3)]"
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
    </div>
  );
}
