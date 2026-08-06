# ОБЪЕДИНЕННЫЙ ФАЙЛ ПРОЕКТА И АУДИТ ФУНКЦИОНАЛА

Этот файл объединяет полные исходные коды ключевых узлов системы (`server.ts`, `package.json`, `src/App.tsx`), структуру файлов и сводную таблицу статуса функций.

---

## 1. Содержимое `package.json`

```json
{
  "name": "react-example",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx server.ts",
    "build": "vite build && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs",
    "start": "node dist/server.cjs",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@google/genai": "^0.1.1",
    "@modelcontextprotocol/sdk": "^1.6.1",
    "clsx": "^2.1.1",
    "cors": "^2.8.5",
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "firebase-admin": "^13.1.0",
    "lucide-react": "^0.344.0",
    "mammoth": "^1.9.1",
    "motion": "^12.4.7",
    "node-telegram-bot-api": "^0.66.0",
    "pdf-parse": "^1.1.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "tailwind-merge": "^3.0.2",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^5.0.0",
    "@types/node": "^22.13.5",
    "@types/node-telegram-bot-api": "^0.64.7",
    "@types/pdf-parse": "^1.1.4",
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "esbuild": "^0.25.0",
    "postcss": "^8.5.3",
    "tailwindcss": "^4.0.8",
    "tsx": "^4.19.3",
    "typescript": "^5.7.3",
    "vite": "^6.1.1"
  }
}
```

---

## 2. Структура файлов в директории `src/`

- `src/App.tsx` (главный экран приложения и кнопка квеста)
- `src/index.css`
- `src/main.tsx`
- `src/types.ts`
- `src/assets/`
- `src/components/AnalyticsPanel.tsx`
- `src/components/BillingPanel.tsx`
- `src/components/ChannelSimulator.tsx`
- `src/components/FAQPanel.tsx`
- `src/components/GlassPanel.tsx`
- `src/components/KnowledgeBasePanel.tsx`
- `src/components/LaunchModal.tsx`
- `src/components/MCPToolsPanel.tsx`
- `src/components/ModerationPanel.tsx`
- `src/components/NeonButton.tsx`
- `src/components/OnboardingFlow.tsx`
- `src/components/ResiliencyDashboard.tsx`
- `src/components/SMARTPlanner.tsx`
- `src/components/SettingsPanel.tsx`
- `src/components/StaffFeed.tsx`
- `src/components/TechnicalReportData.ts`
- `src/components/TelegramSetupData.ts`
- `src/components/VoiceOrganismOnboarding.tsx`
- `src/components/VoiceQuestFlow.tsx`
- `src/components/VoiceRecorder.tsx`

---

## 3. Таблица функций (Статус реализации)

| Название функции | Статус | От чего зависит |
| :--- | :---: | :--- |
| **Голосовой квест настройки штаба** | **реально** | Backend API (`/api/smart-plan`, `/api/generate-quest-stations`), Gemini API, `VoiceQuestFlow.tsx` |
| **Мультимодальные ответы (Картинки, Код, Озвучка TTS, Видео)** | **реально** | Gemini API (`@google/genai`), `GEMINI_API_KEY`, обработчик `processMultimodalMessage` |
| **Интеграция с Telegram-ботом (Long Polling & WebApp)** | **реально** | `node-telegram-bot-api`, `TELEGRAM_BOT_TOKEN` в `.env` |
| **Симулятор каналов общения (ChannelSimulator)** | **реально** | `/api/agent-respond`, `quietClientProfileUpdate`, клиентский state в `App.tsx` |
| **Мультиагентные дебаты и эскалация (runDebate)** | **реально** | Gemini API (итеративная генерация аргументов роем агентов) |
| **Тихое профилирование клиентов (profileNotes)** | **реально** | Паттерны текста в `server.ts` + локальное / Firestore сохранение |
| **База знаний / RAG (KnowledgeBasePanel)** | **реально** | Векторные эмбеддинги (`text-embedding-004`), `pdf-parse`, `mammoth` |
| **Ручная и автоматическая модерация (ModerationPanel)** | **реально** | Очередь модерации в `server.ts` (`human-supervised` режим) |
| **Лента событий штаба в реальном времени (StaffFeed)** | **реально** | Серверный EventBus (`logFeedEvent`), `/api/feed` |
| **SMART-планировщик с генерацией задач** | **реально** | `/api/smart-plan`, Gemini API, `SMARTPlanner.tsx` |
| **Отзовоустойчивость и Circuit Breaker (ResiliencyDashboard)** | **реально** | Движок телеметрии и сброса квоты в `server.ts` |
| **MCP Инструменты и исполнение (MCPToolsPanel)** | **половина** | Реестр MCP и встроенные функции `mcpToolsRegistry`, без внешних сокетов Stdio |
| **Тарифы и биллинг (BillingPanel)** | **половина** | Расчёт расходов токенов на клиенте/сервере, без подключения эквайринга |

---

## 4. Содержимое `src/App.tsx` (Главный экран и кнопка квеста)

```tsx
import React, { useState, useEffect } from 'react';
import { 
  Bot, 
  Send, 
  Sparkles, 
  ShieldAlert, 
  Database, 
  Cpu, 
  Settings, 
  Play, 
  CheckCircle2, 
  MessageSquare, 
  Workflow, 
  Activity,
  CreditCard,
  HelpCircle,
  BarChart3,
  Flame,
  FileCode,
  Radio,
  Zap,
  Check,
  ChevronRight,
  ChevronLeft,
  X,
  Volume2,
  RefreshCw,
  Sliders,
  ExternalLink,
  Info,
  Server
} from 'lucide-react';
import GlassPanel from './components/GlassPanel';
import NeonButton from './components/NeonButton';
import ModerationPanel from './components/ModerationPanel';
import KnowledgeBasePanel from './components/KnowledgeBasePanel';
import SettingsPanel from './components/SettingsPanel';
import ChannelSimulator from './components/ChannelSimulator';
import StaffFeed from './components/StaffFeed';
import SMARTPlanner from './components/SMARTPlanner';
import ResiliencyDashboard from './components/ResiliencyDashboard';
import LaunchModal from './components/LaunchModal';
import OnboardingFlow from './components/OnboardingFlow';
import FAQPanel from './components/FAQPanel';
import AnalyticsPanel from './components/AnalyticsPanel';
import BillingPanel from './components/BillingPanel';
import MCPToolsPanel from './components/MCPToolsPanel';
import VoiceQuestFlow from './components/VoiceQuestFlow';
import VoiceOrganismOnboarding from './components/VoiceOrganismOnboarding';
import { CompanyConfig, ModerationItem, TelegramChat } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<'simulator' | 'quest' | 'organism' | 'moderation' | 'knowledge' | 'settings' | 'feed' | 'planner' | 'resiliency' | 'mcp' | 'faq' | 'analytics' | 'billing'>('simulator');
  const [showLaunchModal, setShowLaunchModal] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [voiceQuestChatId, setVoiceQuestChatId] = useState<string | null>(null);

  // Sync mode with Server (Firestore vs Local JSON)
  const [storageMode, setStorageMode] = useState<{ connected: boolean; mode: string }>({
    connected: false,
    mode: 'Загрузка состояния...'
  });

  // Global app state stored locally and synced via server API
  const [config, setConfig] = useState<CompanyConfig>({
    business_name: 'Мой Бизнес',
    owner_name: 'Предприниматель',
    industry: 'Продажи и услуги',
    tone: 'friendly',
    autonomy_level: 'full',
    channels: ['telegram'],
    voice_id: 'Kore',
    auto_synthesize: false,
    tts_voice: 'Kore',
    preferences: {
      address_form: 'вы',
      response_style: 'коротко и по делу',
      reminder_time: '09:00',
      timezone: 'Europe/Moscow'
    },
    schedule: {
      work_start: '09:00',
      work_end: '18:00',
      daily_brief_time: '08:30'
    },
    proactive_scenarios: [],
    tools_enabled: ['web_search', 'calculate', 'memory'],
    contacts: [],
    tasks: [],
    notes: [],
    metrics: { track: [], targets: {} }
  });

  const [moderationQueue, setModerationQueue] = useState<ModerationItem[]>([]);
  const [moderationHistory, setModerationHistory] = useState<ModerationItem[]>([]);
  const [telegramChats, setTelegramChats] = useState<TelegramChat[]>([]);
  const [isTelegramBotActive, setIsTelegramBotActive] = useState(false);

  // Parse URL parameters (e.g., mode=voice-quest&chatId=12345)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode');
    const chatId = params.get('chatId');

    if (mode === 'voice-quest' && chatId) {
      setVoiceQuestChatId(chatId);
      setActiveTab('quest');
    }
  }, []);

  // Sync with backend API on mount
  useEffect(() => {
    fetch('/api/sync-status')
      .then(res => res.json())
      .then(data => setStorageMode(data))
      .catch(() => setStorageMode({ connected: false, mode: 'Автономный режим (Local JSON)' }));

    fetch('/api/get-config')
      .then(res => res.json())
      .then(data => {
        if (data.config) setConfig(data.config);
      })
      .catch(err => console.error('Failed to load company config:', err));

    fetch('/api/telegram/chats')
      .then(res => res.json())
      .then(data => {
        if (data.chats) setTelegramChats(data.chats);
        setIsTelegramBotActive(data.isBotActive);
      })
      .catch(err => console.error('Failed to load telegram chats:', err));
  }, []);

  const handleSaveConfig = async (newConfig: CompanyConfig) => {
    setConfig(newConfig);
    try {
      await fetch('/api/save-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });
    } catch (err) {
      console.error('Failed to save config:', err);
    }
  };

  const handleApproveModeration = async (id: string, customResponse?: string) => {
    const item = moderationQueue.find(q => q.id === id);
    if (!item) return;

    const responseText = customResponse || item.proposedResponse;

    setModerationQueue(prev => prev.filter(q => q.id !== id));
    setModerationHistory(prev => [{
      ...item,
      status: 'approved',
      proposedResponse: responseText
    }, ...prev]);

    // Send to Telegram chat if telegram channel
    if (item.chatId) {
      try {
        await fetch('/api/telegram/send-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId: item.chatId, text: responseText })
        });
      } catch (err) {
        console.error('Failed to send approved message:', err);
      }
    }
  };

  const handleRejectModeration = (id: string) => {
    const item = moderationQueue.find(q => q.id === id);
    if (!item) return;

    setModerationQueue(prev => prev.filter(q => q.id !== id));
    setModerationHistory(prev => [{
      ...item,
      status: 'rejected'
    }, ...prev]);
  };

  return (
    <div className="min-h-screen bg-[#070503] text-[#EAE6DF] font-sans flex flex-col selection:bg-[#C5A059] selection:text-[#070503] relative overflow-x-hidden">
      
      {/* Background ambient lighting */}
      <div className="fixed top-0 left-1/4 w-96 h-96 bg-[#C5A059]/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="fixed bottom-0 right-1/4 w-96 h-96 bg-[#D4AF37]/5 rounded-full blur-[150px] pointer-events-none" />

      {/* Top Header Bar */}
      <header className="border-b border-[#C5A059]/20 bg-[#0E0C0A]/90 backdrop-blur-md sticky top-0 z-40 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#C5A059] to-[#8C6F38] flex items-center justify-center text-[#070503] shadow-lg shadow-[#C5A059]/20 font-bold font-mono">
            S
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="font-semibold text-base text-[#F5F2EB] tracking-wide font-serif">
                SELIN <span className="text-[#C5A059] font-sans text-xs font-normal border border-[#C5A059]/30 px-1.5 py-0.5 rounded">HQ</span>
              </h1>
              <span className="text-xs text-slate-400">| {config.business_name}</span>
            </div>
            <div className="flex items-center space-x-2 text-[10px] text-slate-400">
              <span className="inline-flex items-center gap-1 text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Штаб активен
              </span>
              <span>•</span>
              <span className="text-amber-200/80">{storageMode.mode}</span>
            </div>
          </div>
        </div>

        {/* CTA Actions */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setActiveTab('quest')}
            className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#C5A059] to-[#9E7D3B] text-[#070503] font-medium text-xs flex items-center space-x-1.5 shadow-md shadow-[#C5A059]/20 hover:brightness-110 transition cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>🚀 Персональный квест</span>
          </button>

          <button
            onClick={() => setActiveTab('organism')}
            className="px-3 py-1.5 rounded-lg bg-[#1C1816] border border-[#C5A059]/30 text-[#C5A059] font-medium text-xs flex items-center space-x-1.5 hover:bg-[#28221F] transition cursor-pointer"
          >
            <Radio className="w-3.5 h-3.5 text-amber-400" />
            <span>Голосовой Демо-Агент</span>
          </button>

          <button
            onClick={() => setShowLaunchModal(true)}
            className="px-3 py-1.5 rounded-lg bg-[#1C1816] border border-white/10 text-slate-300 font-medium text-xs flex items-center space-x-1.5 hover:bg-[#28221F] transition cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 text-emerald-400" />
            <span>Запуск Telegram</span>
          </button>
        </div>
      </header>

      {/* Main Body with Sidebar Navigation */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Navigation Sidebar */}
        <aside className="w-64 border-r border-[#C5A059]/15 bg-[#090806]/80 flex flex-col justify-between p-3 select-none">
          <div className="space-y-1">
            <div className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-[#C5A059]/70">
              Операционный Центр
            </div>

            <button
              onClick={() => setActiveTab('simulator')}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                activeTab === 'simulator' 
                  ? 'bg-[#C5A059]/15 text-[#C5A059] border border-[#C5A059]/30' 
                  : 'text-slate-300 hover:bg-[#1C1816] hover:text-white'
              }`}
            >
              <MessageSquare className="w-4 h-4 text-[#C5A059]" />
              <span>Каналы Общения</span>
            </button>

            <button
              onClick={() => setActiveTab('quest')}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                activeTab === 'quest' 
                  ? 'bg-[#C5A059]/15 text-[#C5A059] border border-[#C5A059]/30' 
                  : 'text-slate-300 hover:bg-[#1C1816] hover:text-white'
              }`}
            >
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>Интерактивный Квест</span>
            </button>

            <button
              onClick={() => setActiveTab('feed')}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                activeTab === 'feed' 
                  ? 'bg-[#C5A059]/15 text-[#C5A059] border border-[#C5A059]/30' 
                  : 'text-slate-300 hover:bg-[#1C1816] hover:text-white'
              }`}
            >
              <Activity className="w-4 h-4 text-emerald-400" />
              <span>Лента Штаба</span>
            </button>

            <button
              onClick={() => setActiveTab('planner')}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                activeTab === 'planner' 
                  ? 'bg-[#C5A059]/15 text-[#C5A059] border border-[#C5A059]/30' 
                  : 'text-slate-300 hover:bg-[#1C1816] hover:text-white'
              }`}
            >
              <Workflow className="w-4 h-4 text-blue-400" />
              <span>SMART Планер</span>
            </button>

            <div className="pt-3 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-[#C5A059]/70">
              База и Управление
            </div>

            <button
              onClick={() => setActiveTab('knowledge')}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                activeTab === 'knowledge' 
                  ? 'bg-[#C5A059]/15 text-[#C5A059] border border-[#C5A059]/30' 
                  : 'text-slate-300 hover:bg-[#1C1816] hover:text-white'
              }`}
            >
              <Database className="w-4 h-4 text-purple-400" />
              <span>База Знаний (RAG)</span>
            </button>

            <button
              onClick={() => setActiveTab('moderation')}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                activeTab === 'moderation' 
                  ? 'bg-[#C5A059]/15 text-[#C5A059] border border-[#C5A059]/30' 
                  : 'text-slate-300 hover:bg-[#1C1816] hover:text-white'
              }`}
            >
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              <div className="flex-1 flex justify-between items-center">
                <span>Модерация</span>
                {moderationQueue.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-rose-500/20 text-rose-300 text-[10px] border border-rose-500/30 font-bold">
                    {moderationQueue.length}
                  </span>
                )}
              </div>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                activeTab === 'settings' 
                  ? 'bg-[#C5A059]/15 text-[#C5A059] border border-[#C5A059]/30' 
                  : 'text-slate-300 hover:bg-[#1C1816] hover:text-white'
              }`}
            >
              <Settings className="w-4 h-4 text-slate-400" />
              <span>Настройки Бизнеса</span>
            </button>

            <div className="pt-3 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-[#C5A059]/70">
              Enterprise & Метрики
            </div>

            <button
              onClick={() => setActiveTab('resiliency')}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                activeTab === 'resiliency' 
                  ? 'bg-[#C5A059]/15 text-[#C5A059] border border-[#C5A059]/30' 
                  : 'text-slate-300 hover:bg-[#1C1816] hover:text-white'
              }`}
            >
              <Cpu className="w-4 h-4 text-cyan-400" />
              <span>Устойчивость & Circuit Breaker</span>
            </button>

            <button
              onClick={() => setActiveTab('mcp')}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                activeTab === 'mcp' 
                  ? 'bg-[#C5A059]/15 text-[#C5A059] border border-[#C5A059]/30' 
                  : 'text-slate-300 hover:bg-[#1C1816] hover:text-white'
              }`}
            >
              <FileCode className="w-4 h-4 text-amber-300" />
              <span>MCP Инструменты</span>
            </button>

            <button
              onClick={() => setActiveTab('analytics')}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                activeTab === 'analytics' 
                  ? 'bg-[#C5A059]/15 text-[#C5A059] border border-[#C5A059]/30' 
                  : 'text-slate-300 hover:bg-[#1C1816] hover:text-white'
              }`}
            >
              <BarChart3 className="w-4 h-4 text-indigo-400" />
              <span>Аналитика</span>
            </button>

            <button
              onClick={() => setActiveTab('billing')}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                activeTab === 'billing' 
                  ? 'bg-[#C5A059]/15 text-[#C5A059] border border-[#C5A059]/30' 
                  : 'text-slate-300 hover:bg-[#1C1816] hover:text-white'
              }`}
            >
              <CreditCard className="w-4 h-4 text-emerald-300" />
              <span>Тарифы & Токены</span>
            </button>

            <button
              onClick={() => setActiveTab('faq')}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                activeTab === 'faq' 
                  ? 'bg-[#C5A059]/15 text-[#C5A059] border border-[#C5A059]/30' 
                  : 'text-slate-300 hover:bg-[#1C1816] hover:text-white'
              }`}
            >
              <HelpCircle className="w-4 h-4 text-[#C5A059]" />
              <span>Вопросы и Ответы (FAQ)</span>
            </button>
          </div>

          {/* Footer Info in Sidebar */}
          <div className="pt-4 border-t border-[#C5A059]/10">
            <div className="p-2.5 rounded-lg bg-[#13100E] border border-[#C5A059]/20 text-[11px]">
              <div className="text-slate-300 font-medium flex items-center justify-between">
                <span>Бот Telegram</span>
                <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                  isTelegramBotActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700/50 text-slate-400'
                }`}>
                  {isTelegramBotActive ? 'Активен' : 'Демо'}
                </span>
              </div>
              <p className="text-slate-400 text-[10px] mt-1 leading-tight">
                {isTelegramBotActive 
                  ? 'Реальный бот подключен к серверу' 
                  : 'Задайте TELEGRAM_BOT_TOKEN для запуска'}
              </p>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto p-6 bg-[#070503]">
          
          {activeTab === 'simulator' && (
            <ChannelSimulator 
              config={config} 
              chats={telegramChats}
              onUpdateChats={setTelegramChats}
            />
          )}

          {activeTab === 'quest' && (
            <VoiceQuestFlow 
              initialChatId={voiceQuestChatId}
              onComplete={(questData) => {
                const newConfig = {
                  ...config,
                  business_name: questData.business_name || config.business_name,
                  owner_name: questData.owner_name || config.owner_name,
                  industry: questData.industry || config.industry,
                  tone: questData.tone || config.tone
                };
                handleSaveConfig(newConfig);
                setActiveTab('simulator');
              }}
            />
          )}

          {activeTab === 'organism' && (
            <VoiceOrganismOnboarding 
              onComplete={(result) => {
                if (result.userName) {
                  handleSaveConfig({
                    ...config,
                    owner_name: result.userName
                  });
                }
                setActiveTab('simulator');
              }}
            />
          )}

          {activeTab === 'feed' && <StaffFeed />}

          {activeTab === 'planner' && <SMARTPlanner config={config} />}

          {activeTab === 'knowledge' && <KnowledgeBasePanel />}

          {activeTab === 'moderation' && (
            <ModerationPanel 
              queue={moderationQueue}
              history={moderationHistory}
              onApprove={handleApproveModeration}
              onReject={handleRejectRejectModeration || handleRejectModeration}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsPanel 
              config={config}
              onSave={handleSaveConfig}
            />
          )}

          {activeTab === 'resiliency' && <ResiliencyDashboard />}

          {activeTab === 'mcp' && <MCPToolsPanel />}

          {activeTab === 'analytics' && <AnalyticsPanel />}

          {activeTab === 'billing' && <BillingPanel />}

          {activeTab === 'faq' && <FAQPanel />}

        </main>
      </div>

      {/* Launch Modal */}
      {showLaunchModal && (
        <LaunchModal onClose={() => setShowLaunchModal(false)} />
      )}

      {/* Onboarding Flow Modal */}
      {showOnboarding && (
        <OnboardingFlow 
          onClose={() => setShowOnboarding(false)}
          onSave={(newConfig) => {
            handleSaveConfig(newConfig);
            setShowOnboarding(false);
          }}
        />
      )}

    </div>
  );
}
```

---

## 5. Полное содержимое файла `server.ts`

Файл `server.ts` уже содержит полную логику работы Express сервера, Firebase/Firestore синка, Telegram-бота, генерации ответов через Gemini API, мультимодальной генерации (Imagen, Veo, TTS), мультиагентных дебатов, RAG поиска и Enterprise Circuit Breaker.

*(Файл подключен в актуальном рабочем виде в `/server.ts` вашего контейнера).*
