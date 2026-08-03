import React, { useState, useEffect } from 'react';
import { GlassPanel } from './GlassPanel';
import { Check, X, Rocket, AlertCircle, RefreshCw, Zap } from 'lucide-react';

interface ReadinessState {
  kb_ready: boolean;
  channel_ready: boolean;
  tone_ready: boolean;
  missions_ready: boolean;
  is_live: boolean;
  all_ready: boolean;
}

interface LaunchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLaunched?: () => void;
}

export const LaunchModal: React.FC<LaunchModalProps> = ({
  isOpen,
  onClose,
  onLaunched
}) => {
  const [readiness, setReadiness] = useState<ReadinessState | null>(null);
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [isLiveSuccess, setIsLiveSuccess] = useState(false);

  const fetchReadinessAndAttemptLaunch = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/readiness');
      if (res.ok) {
        const data: ReadinessState = await res.json();
        setReadiness(data);
        if (data.is_live) {
          setIsLiveSuccess(true);
        } else if (data.all_ready) {
          // If all ready, attempt auto-launch
          await handleLaunch();
        }
      }
    } catch (err) {
      console.error("Failed to check readiness:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchReadinessAndAttemptLaunch();
    }
  }, [isOpen]);

  const handleLaunch = async () => {
    setLaunching(true);
    try {
      const res = await fetch('/api/launch', { method: 'POST' });
      if (res.ok) {
        setIsLiveSuccess(true);
        if (readiness) {
          setReadiness({ ...readiness, is_live: true });
        }
        if (onLaunched) onLaunched();
      } else {
        const errData = await res.json();
        if (errData.readiness) {
          setReadiness(errData.readiness);
        }
      }
    } catch (err) {
      console.error("Failed to launch headquarters:", err);
    } finally {
      setLaunching(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <GlassPanel glowColor="accent" className="max-w-lg w-full relative p-6 md:p-8">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors cursor-pointer p-1"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white shadow-[0_0_12px_rgba(255,255,255,0.1)]">
            <Rocket className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-lux font-light text-white">Готовность к запуску штаба</h2>
            <p className="text-xs text-slate-400">Чеклист автономной работы цифровых сотрудников</p>
          </div>
        </div>

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-3">
            <RefreshCw className="h-8 w-8 text-white animate-spin" />
            <span className="text-sm font-sans text-slate-300">Проверка готовности компонентов...</span>
          </div>
        ) : isLiveSuccess || readiness?.is_live ? (
          <div className="py-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 mx-auto animate-pulse">
              <Zap className="h-8 w-8" />
            </div>
            <h3 className="text-2xl font-lux font-light text-emerald-400">Штаб работает 24/7</h3>
            <p className="text-sm font-sans text-slate-300 max-w-sm mx-auto">
              Все цифровые агенты активированы в боевом режиме с персональными миссиями и полной базой знаний.
            </p>
            <div className="pt-4">
              <button
                onClick={onClose}
                className="w-full py-3 px-6 rounded-xl font-sans font-bold text-sm bg-emerald-500 text-black hover:bg-emerald-400 transition-all cursor-pointer shadow-[0_0_20px_rgba(16,185,129,0.2)]"
              >
                Отлично, к работе!
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="space-y-3">
              {/* 1. KB */}
              <div className={`p-4 rounded-xl border flex items-start gap-3 transition-colors ${
                readiness?.kb_ready ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'
              }`}>
                <div className={`mt-0.5 p-1 rounded-full ${readiness?.kb_ready ? 'bg-emerald-500 text-black' : 'bg-red-500 text-white'}`}>
                  {readiness?.kb_ready ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                </div>
                <div>
                  <div className="text-sm font-bold font-sans text-white">База знаний (RAG)</div>
                  <div className="text-xs font-sans text-slate-300">
                    {readiness?.kb_ready ? "База знаний заполнена и готова" : "Загрузите прайс в Базу знаний"}
                  </div>
                </div>
              </div>

              {/* 2. Channel */}
              <div className={`p-4 rounded-xl border flex items-start gap-3 transition-colors ${
                readiness?.channel_ready ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'
              }`}>
                <div className={`mt-0.5 p-1 rounded-full ${readiness?.channel_ready ? 'bg-emerald-500 text-black' : 'bg-red-500 text-white'}`}>
                  {readiness?.channel_ready ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                </div>
                <div>
                  <div className="text-sm font-bold font-sans text-white">Канал Telegram</div>
                  <div className="text-xs font-sans text-slate-300">
                    {readiness?.channel_ready ? "Telegram-бот подключен" : "Подключите Telegram-бот"}
                  </div>
                </div>
              </div>

              {/* 3. Tone */}
              <div className={`p-4 rounded-xl border flex items-start gap-3 transition-colors ${
                readiness?.tone_ready ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'
              }`}>
                <div className={`mt-0.5 p-1 rounded-full ${readiness?.tone_ready ? 'bg-emerald-500 text-black' : 'bg-red-500 text-white'}`}>
                  {readiness?.tone_ready ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                </div>
                <div>
                  <div className="text-sm font-bold font-sans text-white">Тон общения</div>
                  <div className="text-xs font-sans text-slate-300">
                    {readiness?.tone_ready ? "Тон общения установлен" : "Укажите тон общения в настройках"}
                  </div>
                </div>
              </div>

              {/* 4. Missions */}
              <div className={`p-4 rounded-xl border flex items-start gap-3 transition-colors ${
                readiness?.missions_ready ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'
              }`}>
                <div className={`mt-0.5 p-1 rounded-full ${readiness?.missions_ready ? 'bg-emerald-500 text-black' : 'bg-red-500 text-white'}`}>
                  {readiness?.missions_ready ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                </div>
                <div>
                  <div className="text-sm font-bold font-sans text-white">Миссии агентов</div>
                  <div className="text-xs font-sans text-slate-300">
                    {readiness?.missions_ready ? "Миссии сформированы" : "Пройдите квест для миссий агентов"}
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row gap-3">
              <button
                onClick={fetchReadinessAndAttemptLaunch}
                className="py-3 px-4 rounded-xl font-sans text-xs text-slate-300 border border-white/10 hover:bg-white/5 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <RefreshCw className="h-4 w-4" />
                <span>Проверить снова</span>
              </button>

              <button
                disabled={!readiness?.all_ready || launching}
                onClick={handleLaunch}
                className={`flex-1 py-3 px-6 rounded-xl font-sans font-bold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer ${
                  readiness?.all_ready
                    ? 'bg-white text-black hover:bg-slate-200 shadow-[0_0_20px_rgba(255,255,255,0.3)]'
                    : 'bg-white/5 text-slate-500 border border-white/5 opacity-60 cursor-not-allowed'
                }`}
              >
                {launching ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Rocket className="h-4 w-4" />
                )}
                <span>ЗАПУСТИТЬ ШТАБ</span>
              </button>
            </div>
          </div>
        )}
      </GlassPanel>
    </div>
  );
};
