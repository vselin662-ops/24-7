import React, { useState, useEffect } from 'react';
import {
  Globe,
  Briefcase,
  Car,
  Bot,
  ExternalLink,
  Sparkles,
  BookOpen,
  Target,
  CheckCircle,
  BarChart3,
  Flame,
  Volume2,
  Send,
  MessageSquare,
  Shield,
  Database,
  Sliders,
  HelpCircle,
  Menu,
  X,
  Clock,
  Award
} from 'lucide-react';
import { GlassPanel } from './components/GlassPanel';
import { NeonButton } from './components/NeonButton';
import { StaffFeed } from './components/StaffFeed';
import { ModerationPanel } from './components/ModerationPanel';
import { KnowledgeBasePanel } from './components/KnowledgeBasePanel';
import { VoiceButton } from './components/VoiceButton';
import { useVoiceRecorder } from './hooks/useVoiceRecorder';
import { SettingsPanel } from './components/SettingsPanel';
import { FAQPanel } from './components/FAQPanel';

const MAX_BOT_URL = "https://max.ru/se13914883_bot";

export default function App() {
  const [activeTab, setActiveTab] = useState<'main' | 'languages' | 'business' | 'lifestyle' | 'feed' | 'moderation' | 'knowledge' | 'settings'>('main');
  const [menuOpen, setMenuOpen] = useState(false);
  const [voiceToast, setVoiceToast] = useState<string | null>(null);

  const {
    state: voiceState,
    volume: voiceVolume,
    duration: voiceDuration,
    error: voiceError,
    startRecording,
    stopRecording,
  } = useVoiceRecorder({
    onTranscript: (text) => {
      setVoiceToast(`Распознано: "${text}"`);
      setTimeout(() => setVoiceToast(null), 5000);
    },
    onError: (err) => {
      setVoiceToast(err);
      setTimeout(() => setVoiceToast(null), 5000);
    },
  });

  const handleVoiceClick = () => {
    if (voiceState === 'idle') {
      startRecording();
    } else if (voiceState === 'recording') {
      stopRecording();
    }
  };

  // Quick stats state
  const [langStats, setLangStats] = useState({ level: 'A1', words: 0, streak: 0, lang: 'Английский' });
  const [bizStats, setBizStats] = useState({ tasksDone: 0, streak: 0, stage: 'Идея' });

  return (
    <div className="min-h-screen bg-[#0F0D0C] text-[#EAE6DF] font-sans selection:bg-[#C5A059]/30 relative overflow-x-hidden">
      {/* Background Glow */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-gradient-to-b from-[#C5A059]/15 via-[#C5A059]/5 to-transparent blur-[120px]" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#161210]/90 backdrop-blur-xl border-b border-[#2A231F]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#2A221E] to-[#1C1715] border border-[#C5A059]/40 flex items-center justify-center text-[#C5A059] shadow-lg">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-[#EAE6DF] tracking-wide leading-none flex items-center gap-2">
                Selin AI
                <span className="text-[10px] font-semibold tracking-wider text-[#C5A059] bg-[#C5A059]/10 border border-[#C5A059]/30 px-2 py-0.5 rounded-full uppercase">
                  v2.1
                </span>
              </h1>
              <p className="text-xs text-[#9E958C] mt-0.5">Интеллектуальный наставник</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <a
              href={MAX_BOT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-[#C5A059] text-[#0F0D0C] hover:bg-[#D4B06A] transition-all duration-200 shadow-lg shadow-[#C5A059]/15 hover:shadow-[#C5A059]/25 hover:-translate-y-0.5 active:translate-y-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Открыть в Max</span>
              <ExternalLink className="w-3 h-3 opacity-70" />
            </a>

            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-2 rounded-xl bg-[#221C19] border border-[#362E29] text-[#9E958C] hover:text-[#EAE6DF] hover:border-[#C5A059]/50 transition-all md:hidden"
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 relative z-10">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-4 mb-6 custom-scrollbar border-b border-[#2A231F]">
          <button
            onClick={() => setActiveTab('main')}
            className={`px-4 py-2 rounded-xl text-xs font-medium transition-all shrink-0 flex items-center gap-2 ${
              activeTab === 'main'
                ? 'bg-[#C5A059] text-[#0F0D0C] font-semibold'
                : 'bg-[#1C1715] text-[#9E958C] hover:text-[#EAE6DF] hover:bg-[#26201D]'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Главная</span>
          </button>

          <button
            onClick={() => setActiveTab('languages')}
            className={`px-4 py-2 rounded-xl text-xs font-medium transition-all shrink-0 flex items-center gap-2 ${
              activeTab === 'languages'
                ? 'bg-[#C5A059] text-[#0F0D0C] font-semibold'
                : 'bg-[#1C1715] text-[#9E958C] hover:text-[#EAE6DF] hover:bg-[#26201D]'
            }`}
          >
            <Globe className="w-3.5 h-3.5 text-blue-400" />
            <span>Языки</span>
          </button>

          <button
            onClick={() => setActiveTab('business')}
            className={`px-4 py-2 rounded-xl text-xs font-medium transition-all shrink-0 flex items-center gap-2 ${
              activeTab === 'business'
                ? 'bg-[#C5A059] text-[#0F0D0C] font-semibold'
                : 'bg-[#1C1715] text-[#9E958C] hover:text-[#EAE6DF] hover:bg-[#26201D]'
            }`}
          >
            <Briefcase className="w-3.5 h-3.5 text-amber-400" />
            <span>Бизнес</span>
          </button>

          <button
            onClick={() => setActiveTab('lifestyle')}
            className={`px-4 py-2 rounded-xl text-xs font-medium transition-all shrink-0 flex items-center gap-2 ${
              activeTab === 'lifestyle'
                ? 'bg-[#C5A059] text-[#0F0D0C] font-semibold'
                : 'bg-[#1C1715] text-[#9E958C] hover:text-[#EAE6DF] hover:bg-[#26201D]'
            }`}
          >
            <Car className="w-3.5 h-3.5 text-emerald-400" />
            <span>Быт (Скоро)</span>
          </button>

          <button
            onClick={() => setActiveTab('feed')}
            className={`px-4 py-2 rounded-xl text-xs font-medium transition-all shrink-0 flex items-center gap-2 ${
              activeTab === 'feed'
                ? 'bg-[#C5A059] text-[#0F0D0C] font-semibold'
                : 'bg-[#1C1715] text-[#9E958C] hover:text-[#EAE6DF] hover:bg-[#26201D]'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Лента штаба</span>
          </button>

          <button
            onClick={() => setActiveTab('moderation')}
            className={`px-4 py-2 rounded-xl text-xs font-medium transition-all shrink-0 flex items-center gap-2 ${
              activeTab === 'moderation'
                ? 'bg-[#C5A059] text-[#0F0D0C] font-semibold'
                : 'bg-[#1C1715] text-[#9E958C] hover:text-[#EAE6DF] hover:bg-[#26201D]'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Модерация</span>
          </button>

          <button
            onClick={() => setActiveTab('knowledge')}
            className={`px-4 py-2 rounded-xl text-xs font-medium transition-all shrink-0 flex items-center gap-2 ${
              activeTab === 'knowledge'
                ? 'bg-[#C5A059] text-[#0F0D0C] font-semibold'
                : 'bg-[#1C1715] text-[#9E958C] hover:text-[#EAE6DF] hover:bg-[#26201D]'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>База знаний</span>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-2 rounded-xl text-xs font-medium transition-all shrink-0 flex items-center gap-2 ${
              activeTab === 'settings'
                ? 'bg-[#C5A059] text-[#0F0D0C] font-semibold'
                : 'bg-[#1C1715] text-[#9E958C] hover:text-[#EAE6DF] hover:bg-[#26201D]'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Настройки</span>
          </button>
        </div>

        {/* TAB 1: MAIN HERO SCREEN */}
        {activeTab === 'main' && (
          <div className="space-y-8">
            {/* Banner */}
            <div className="p-8 rounded-3xl bg-gradient-to-br from-[#1E1815] via-[#161210] to-[#120F0D] border border-[#2E2621] relative overflow-hidden shadow-2xl flex flex-col lg:flex-row items-center justify-between gap-8">
              <div className="absolute top-0 right-0 w-96 h-96 bg-[#C5A059]/10 rounded-full blur-3xl pointer-events-none" />
              <div className="max-w-xl relative z-10 space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#C5A059]/10 border border-[#C5A059]/30 text-[#C5A059] text-xs font-medium">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Selin AI — Автономный Интеллект</span>
                </div>
                <h2 className="text-3xl sm:text-4xl font-extrabold text-[#EAE6DF] tracking-tight leading-tight">
                  Selin AI — <span className="text-[#C5A059]">автономный интеллект</span> общего назначения
                </h2>
                <p className="text-sm text-[#A89E94] leading-relaxed">
                  Не чат-бот. Не помощник. Интеллект, который учится, помнит и действует.
                </p>
                <div className="text-xs text-[#C5A059] font-medium italic">
                  «Сегодня в твоём телефоне. Завтра — рядом с тобой.»
                </div>
                <div className="pt-2 flex flex-wrap gap-3">
                  <a
                    href={MAX_BOT_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-6 py-3 rounded-xl bg-[#C5A059] text-[#0F0D0C] font-bold text-xs uppercase tracking-wider hover:bg-[#D4B06A] transition-all duration-200 inline-flex items-center gap-2 shadow-lg shadow-[#C5A059]/20"
                  >
                    <span>Открыть в Max</span>
                    <ExternalLink className="w-4 h-4" />
                  </a>
                  <button
                    onClick={() => setActiveTab('feed')}
                    className="px-6 py-3 rounded-xl bg-[#26201D] text-[#EAE6DF] border border-[#382F2A] font-semibold text-xs hover:border-[#C5A059]/40 transition-all"
                  >
                    Консоль Ядра
                  </button>
                </div>
              </div>
            </div>

            {/* 3 CORE CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Card 1: Languages */}
              <div
                onClick={() => setActiveTab('languages')}
                className="group p-6 rounded-2xl bg-[#161210] border border-[#2A231F] hover:border-[#C5A059]/50 transition-all duration-300 cursor-pointer flex flex-col justify-between hover:-translate-y-1 shadow-xl hover:shadow-[#C5A059]/5"
              >
                <div className="space-y-4">
                  <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 group-hover:scale-110 transition-transform">
                    <Globe className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-[#EAE6DF] group-hover:text-[#C5A059] transition-colors">
                      🌍 Языковой Наставник
                    </h3>
                    <p className="text-xs text-[#A89E94] mt-2 leading-relaxed">
                      Интервальные повторения Anki (SM-2), генерация уроков с диалогами, shadowing произношения и проверка домашних заданий.
                    </p>
                  </div>
                </div>

                <div className="pt-6 border-t border-[#26201D] mt-6 flex items-center justify-between text-xs font-semibold text-blue-400">
                  <span>Перейти к обучению</span>
                  <span>→</span>
                </div>
              </div>

              {/* Card 2: Business */}
              <div
                onClick={() => setActiveTab('business')}
                className="group p-6 rounded-2xl bg-[#161210] border border-[#2A231F] hover:border-[#C5A059]/50 transition-all duration-300 cursor-pointer flex flex-col justify-between hover:-translate-y-1 shadow-xl hover:shadow-[#C5A059]/5"
              >
                <div className="space-y-4">
                  <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 group-hover:scale-110 transition-transform">
                    <Briefcase className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-[#EAE6DF] group-hover:text-[#C5A059] transition-colors">
                      💼 Бизнес-Ментор
                    </h3>
                    <p className="text-xs text-[#A89E94] mt-2 leading-relaxed">
                      Экспресс-диагностика бизнеса, ежедневные SMART-задания, симулятор ролевых игр по продажам и еженедельный разбор отчётов.
                    </p>
                  </div>
                </div>

                <div className="pt-6 border-t border-[#26201D] mt-6 flex items-center justify-between text-xs font-semibold text-amber-400">
                  <span>Запустить менторство</span>
                  <span>→</span>
                </div>
              </div>

              {/* Card 3: Lifestyle (Coming Soon) */}
              <div
                onClick={() => setActiveTab('lifestyle')}
                className="group p-6 rounded-2xl bg-[#161210] border border-[#2A231F] hover:border-[#C5A059]/50 transition-all duration-300 cursor-pointer flex flex-col justify-between hover:-translate-y-1 shadow-xl opacity-90"
              >
                <div className="space-y-4">
                  <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 group-hover:scale-110 transition-transform">
                    <Car className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-bold text-[#EAE6DF] group-hover:text-[#C5A059] transition-colors">
                        🚕 Быт & Сервисы
                      </h3>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                        Скоро
                      </span>
                    </div>
                    <p className="text-xs text-[#A89E94] mt-2 leading-relaxed">
                      Интеграция заказа такси, доставки еды, поиска билетов и бронирования отелей через голосовой интерфейс.
                    </p>
                  </div>
                </div>

                <div className="pt-6 border-t border-[#26201D] mt-6 flex items-center justify-between text-xs font-semibold text-emerald-400">
                  <span>В разработке</span>
                  <span>⏳</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: LANGUAGES */}
        {activeTab === 'languages' && (
          <div className="space-y-6">
            <div className="p-6 rounded-2xl bg-[#161210] border border-[#2A231F] space-y-4">
              <div className="flex items-center gap-3">
                <Globe className="w-8 h-8 text-blue-400" />
                <div>
                  <h3 className="text-xl font-bold text-[#EAE6DF]">🌍 Языковой модуль Selin AI</h3>
                  <p className="text-xs text-[#A89E94]">Профессиональный наставник с алгоримом SM-2</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
                <div className="p-4 rounded-xl bg-[#1C1715] border border-[#2A231F]">
                  <div className="text-xs text-[#9E958C]">Алгоритм повторений</div>
                  <div className="text-lg font-bold text-[#EAE6DF] mt-1">Anki (SM-2)</div>
                  <div className="text-[10px] text-blue-400 mt-1">Интервалы 1d, 6d, ef</div>
                </div>

                <div className="p-4 rounded-xl bg-[#1C1715] border border-[#2A231F]">
                  <div className="text-xs text-[#9E958C]">Практика произношения</div>
                  <div className="text-lg font-bold text-[#EAE6DF] mt-1">Shadowing</div>
                  <div className="text-[10px] text-emerald-400 mt-1">Голосовой анализ AI</div>
                </div>

                <div className="p-4 rounded-xl bg-[#1C1715] border border-[#2A231F]">
                  <div className="text-xs text-[#9E958C]">Проверка домашних заданий</div>
                  <div className="text-lg font-bold text-[#EAE6DF] mt-1">Gemini AI</div>
                  <div className="text-[10px] text-amber-400 mt-1">Оценка и разбор ошибок</div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#1F1916] border border-[#382E27] space-y-2">
                <h4 className="text-xs font-bold text-[#C5A059] uppercase tracking-wider">Команды в Max-боте:</h4>
                <div className="text-xs text-[#D8D2C9] space-y-1 font-mono">
                  <p><span className="text-[#C5A059]">/язык английский</span> — начать курс или сменить язык</p>
                  <p><span className="text-[#C5A059]">новый урок</span> — сгенерировать 5 новых слов и диалог</p>
                  <p><span className="text-[#C5A059]">повторение</span> — список слов для повторения сегодня</p>
                  <p><span className="text-[#C5A059]">прогресс</span> — общая статистика и текущий streak</p>
                </div>
              </div>

              <div className="pt-2">
                <a
                  href={MAX_BOT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-6 py-3 rounded-xl bg-[#C5A059] text-[#0F0D0C] font-bold text-xs uppercase tracking-wider hover:bg-[#D4B06A] transition-all inline-flex items-center gap-2 shadow-lg shadow-[#C5A059]/15"
                >
                  <span>Начать обучение в Max</span>
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: BUSINESS */}
        {activeTab === 'business' && (
          <div className="space-y-6">
            <div className="p-6 rounded-2xl bg-[#161210] border border-[#2A231F] space-y-4">
              <div className="flex items-center gap-3">
                <Briefcase className="w-8 h-8 text-amber-400" />
                <div>
                  <h3 className="text-xl font-bold text-[#EAE6DF]">💼 Бизнес-ментор Selin AI</h3>
                  <p className="text-xs text-[#A89E94]">Пошаговое сопровождение предпринимателя до результата</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
                <div className="p-4 rounded-xl bg-[#1C1715] border border-[#2A231F]">
                  <div className="text-xs text-[#9E958C]">Экспресс-диагностика</div>
                  <div className="text-lg font-bold text-[#EAE6DF] mt-1">5 Вопросов</div>
                  <div className="text-[10px] text-amber-400 mt-1">Ниша, стадия, цели</div>
                </div>

                <div className="p-4 rounded-xl bg-[#1C1715] border border-[#2A231F]">
                  <div className="text-xs text-[#9E958C]">Дневные задачи</div>
                  <div className="text-lg font-bold text-[#EAE6DF] mt-1">SMART-контроль</div>
                  <div className="text-[10px] text-emerald-400 mt-1">1 задача на сегодня</div>
                </div>

                <div className="p-4 rounded-xl bg-[#1C1715] border border-[#2A231F]">
                  <div className="text-xs text-[#9E958C]">Симулятор переговоров</div>
                  <div className="text-lg font-bold text-[#EAE6DF] mt-1">Sales Roleplay</div>
                  <div className="text-[10px] text-blue-400 mt-1">AI-клиент с возражениями</div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#1F1916] border border-[#382E27] space-y-2">
                <h4 className="text-xs font-bold text-[#C5A059] uppercase tracking-wider">Команды в Max-боте:</h4>
                <div className="text-xs text-[#D8D2C9] space-y-1 font-mono">
                  <p><span className="text-[#C5A059]">/бизнес</span> — запустить экспресс-диагностику</p>
                  <p><span className="text-[#C5A059]">задание</span> — получить конкретную задачу на сегодня</p>
                  <p><span className="text-[#C5A059]">отчёт [текст]</span> — сдать отчёт о выполнении</p>
                  <p><span className="text-[#C5A059]">ролевая игра</span> — запустить тренировку продаж</p>
                  <p><span className="text-[#C5A059]">обзор</span> — еженедельный разбор результатов</p>
                </div>
              </div>

              <div className="pt-2">
                <a
                  href={MAX_BOT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-6 py-3 rounded-xl bg-[#C5A059] text-[#0F0D0C] font-bold text-xs uppercase tracking-wider hover:bg-[#D4B06A] transition-all inline-flex items-center gap-2 shadow-lg shadow-[#C5A059]/15"
                >
                  <span>Запустить ментор в Max</span>
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: LIFESTYLE (COMING SOON) */}
        {activeTab === 'lifestyle' && (
          <div className="space-y-6">
            <div className="p-8 rounded-2xl bg-[#161210] border border-[#2A231F] text-center space-y-4">
              <Car className="w-12 h-12 text-emerald-400 mx-auto animate-pulse" />
              <h3 className="text-2xl font-bold text-[#EAE6DF]">🚕 Бытовой консьерж Selin AI</h3>
              <p className="text-xs text-[#A89E94] max-w-md mx-auto">
                Модуль автоматизации бытовых задач находится в разработке. Скоро: заказ такси, доставка еды, покупка авиабилетов и бронирование через голосового ассистента.
              </p>
              <div className="pt-4">
                <button
                  onClick={() => setActiveTab('main')}
                  className="px-6 py-2.5 rounded-xl bg-[#26201D] text-[#EAE6DF] border border-[#382F2A] font-medium text-xs hover:border-[#C5A059]/40 transition-all"
                >
                  Вернуться на главную
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PANELS FROM HEADQUARTERS */}
        {activeTab === 'feed' && <StaffFeed />}
        {activeTab === 'moderation' && <ModerationPanel />}
        {activeTab === 'knowledge' && <KnowledgeBasePanel />}
        {activeTab === 'settings' && <SettingsPanel config={null} onSave={() => {}} />}
      </main>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto px-4 sm:px-6 py-6 border-t border-[#2A231F] mt-12 pb-36 text-center text-xs text-[#7A7167]">
        <p>© 2026 Selin AI · Интеллектуальный наставник & Автономный цифровой сотрудник</p>
      </footer>

      {/* Floating Voice Recording Button fixed at bottom center */}
      <VoiceButton
        state={voiceState}
        volume={voiceVolume}
        duration={voiceDuration}
        onClick={handleVoiceClick}
        error={voiceError || voiceToast}
      />
    </div>
  );
}
