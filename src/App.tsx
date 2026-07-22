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
  Rocket
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
  const [readinessState, setReadinessState] = useState<{ is_live?: boolean; all_ready?: boolean } | null>(null);

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

  return (
    <div className="min-h-screen flex flex-col justify-between py-6 px-4">
      {/* Header Panel */}
      <header className="max-w-7xl mx-auto w-full mb-6">
        <div className="premium-card p-4 rounded-2xl flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {/* Logo container */}
            <div className="relative w-12 h-12 md:w-14 md:h-14 rounded-full overflow-hidden border border-white/10 flex items-center justify-center bg-black/40 shadow-[0_0_15px_rgba(245,166,35,0.15)] shrink-0">
              {!logoError ? (
                <img 
                  src={logoImg} 
                  alt="Logo" 
                  className="w-full h-full object-cover" 
                  onError={() => setLogoError(true)}
                />
              ) : (
                <div className="text-[#F5A623] flex items-center justify-center">
                  <Bot className="h-6 w-6" />
                </div>
              )}
            </div>
            
            {/* Title & Dot */}
            <div className="flex items-center gap-3">
              <h1 className="font-sans font-bold text-xl md:text-2xl text-white tracking-normal leading-none select-none">
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

          {/* Launch Headquarters Button */}
          <button
            onClick={() => setIsLaunchModalOpen(true)}
            className={`px-4 py-2 rounded-xl font-sans text-xs font-bold transition-all duration-300 flex items-center gap-2 cursor-pointer ${
              config?.is_live || readinessState?.is_live
                ? 'bg-emerald-500/10 border border-emerald-500/40 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                : readinessState?.all_ready
                ? 'bg-[#F5A623] text-black hover:bg-[#F5A623]/90 shadow-[0_0_15px_rgba(245,166,35,0.3)]'
                : 'bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10'
            }`}
          >
            {config?.is_live || readinessState?.is_live ? (
              <>
                <Zap className="h-4 w-4 text-emerald-400 animate-pulse" />
                <span>Штаб работает 24/7</span>
              </>
            ) : (
              <>
                <Rocket className="h-4 w-4 text-[#F5A623]" />
                <span>ЗАПУСТИТЬ ШТАБ</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main Tabs Navigation */}
      <main className="max-w-7xl mx-auto w-full flex-1 space-y-6">
        <div className="flex overflow-x-auto gap-2 border-b border-white/5 pb-2 scrollbar-none">
          <button
            onClick={() => setCurrentTab('planner')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-all duration-300 ${
              currentTab === 'planner'
                ? 'bg-[#F5A623]/10 border border-[#F5A623] text-[#F5A623] shadow-[0_0_15px_rgba(245,166,35,0.1)]'
                : 'border border-transparent hover:bg-white/3 text-slate-400'
            }`}
          >
            <Calendar className="h-4 w-4" />
            <span>Квест-Планировщик</span>
          </button>

          <button
            onClick={() => setCurrentTab('simulator')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-all duration-300 ${
              currentTab === 'simulator'
                ? 'bg-[#F5A623]/10 border border-[#F5A623] text-[#F5A623]'
                : 'border border-transparent hover:bg-white/3 text-slate-400'
            }`}
          >
            <MessageSquare className="h-4 w-4" />
            <span>Каналы Связи</span>
          </button>

          <button
            onClick={() => setCurrentTab('moderation')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-all duration-300 ${
              currentTab === 'moderation'
                ? 'bg-[#F5A623]/10 border border-[#F5A623] text-[#F5A623] shadow-[0_0_15px_rgba(245,166,35,0.1)]'
                : 'border border-transparent hover:bg-white/3 text-slate-400'
            }`}
          >
            <Shield className="h-4 w-4" />
            <span>Модерация</span>
            {pendingCount > 0 && (
              <span className="bg-[#F5A623] text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full select-none leading-none">
                {pendingCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setCurrentTab('knowledge')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-all duration-300 ${
              currentTab === 'knowledge'
                ? 'bg-[#F5A623]/10 border border-[#F5A623] text-[#F5A623]'
                : 'border border-transparent hover:bg-white/3 text-slate-400'
            }`}
          >
            <Database className="h-4 w-4" />
            <span>База знаний (RAG)</span>
          </button>

          <button
            onClick={() => setCurrentTab('analytics')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-all duration-300 ${
              currentTab === 'analytics'
                ? 'bg-[#F5A623]/10 border border-[#F5A623] text-[#F5A623]'
                : 'border border-transparent hover:bg-white/3 text-slate-400'
            }`}
          >
            <TrendingUp className="h-4 w-4" />
            <span>Аналитика штаба</span>
          </button>

          <button
            onClick={() => setCurrentTab('billing')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-all duration-300 ${
              currentTab === 'billing'
                ? 'bg-[#F5A623]/10 border border-[#F5A623] text-[#F5A623]'
                : 'border border-transparent hover:bg-white/3 text-slate-400'
            }`}
          >
            <CreditCard className="h-4 w-4" />
            <span>Тарифы & Биллинг</span>
          </button>

          <button
            onClick={() => setCurrentTab('faq')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-all duration-300 ${
              currentTab === 'faq'
                ? 'bg-[#F5A623]/10 border border-[#F5A623] text-[#F5A623]'
                : 'border border-transparent hover:bg-white/3 text-slate-400'
            }`}
          >
            <HelpCircle className="h-4 w-4" />
            <span>Инструкции & 152-ФЗ</span>
          </button>

          <button
            onClick={() => setCurrentTab('settings')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-all duration-300 ${
              currentTab === 'settings'
                ? 'bg-[#F5A623]/10 border border-[#F5A623] text-[#F5A623]'
                : 'border border-transparent hover:bg-white/3 text-slate-400'
            }`}
          >
            <Sliders className="h-4 w-4" />
            <span>Настройки штаба</span>
          </button>
        </div>

        {/* Dynamic Tab Render */}
        <div className="transition-all duration-300">
          {currentTab === 'planner' && (
            <SMARTPlanner
              businessName={config.business_name}
              ownerName={config.owner_name}
              industry={config.industry}
              tone={config.tone}
              channels={config.channels}
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
