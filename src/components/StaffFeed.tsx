import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, DollarSign, PenTool, BarChart3, CheckSquare, Activity } from 'lucide-react';
// @ts-ignore
import natureForest from '../assets/images/nature_forest_1785822465712.jpg';

export interface FeedEvent {
  id: string;
  role: string;
  type: string;
  title: string;
  detail: string;
  status: 'done' | 'pending' | 'info';
  ts: string;
}

const ROLE_CONFIG: Record<string, { label: string; icon: React.ComponentType<any>; color: string }> = {
  receiver: { label: 'Приёмная', icon: MessageSquare, color: '#229ED9' },
  sales: { label: 'Отдел продаж', icon: DollarSign, color: '#34C759' },
  content: { label: 'Контент', icon: PenTool, color: '#FF6B00' },
  analyst: { label: 'Аналитик', icon: BarChart3, color: '#BF5AF2' },
  operator: { label: 'Оператор', icon: CheckSquare, color: '#888888' },
};

export const StaffFeed: React.FC = () => {
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const prevTopIdRef = useRef<string | null>(null);

  const fetchFeed = async () => {
    try {
      const res = await fetch('/api/feed');
      if (res.ok) {
        const data = await res.json();
        const newFeed: FeedEvent[] = data.feed || [];
        if (newFeed.length > 0) {
          const topId = newFeed[0].id;
          if (prevTopIdRef.current && prevTopIdRef.current !== topId) {
            setHighlightedId(topId);
            setTimeout(() => setHighlightedId(null), 1200);
          }
          prevTopIdRef.current = topId;
        }
        setFeed(newFeed);
      }
    } catch (err) {
      console.warn('Failed to fetch staff feed:', err);
    }
  };

  useEffect(() => {
    fetchFeed();
    const interval = setInterval(fetchFeed, 3500);
    return () => clearInterval(interval);
  }, []);

  const isToday = (ts: string) => {
    try {
      const d = new Date(ts);
      const today = new Date();
      return (
        d.getDate() === today.getDate() &&
        d.getMonth() === today.getMonth() &&
        d.getFullYear() === today.getFullYear()
      );
    } catch {
      return false;
    }
  };

  const todayEvents = feed.filter(e => isToday(e.ts));
  const doneCount = todayEvents.filter(e => e.status === 'done').length;
  const pendingCount = todayEvents.filter(e => e.status === 'pending').length;

  const formatTime = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <div className="w-full bg-[#14100E]/50 backdrop-blur-xl border border-[#DCD6CD]/20 rounded-3xl p-6 md:p-8 space-y-8 animate-fade-in font-sans text-white shadow-2xl">
      {/* GEOS Organic Pebble Photo Banner */}
      <div className="relative w-full h-44 sm:h-52 overflow-hidden rounded-[12px_36px_12px_36px] border border-[#DCD6CD]/20 shadow-xl group">
        <img 
          src={natureForest} 
          alt="Лента Штаба и Природа" 
          className="w-full h-full object-cover filter brightness-90 contrast-110 group-hover:scale-105 transition-transform duration-700" 
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#14100E] via-black/20 to-transparent" />
        <div className="absolute bottom-4 left-6 right-6 flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase tracking-[0.25em] text-[#C5A059] font-medium font-serif-geos block">
              ЖИВОЙ РЕЕСТР · 24/7
            </span>
            <h3 className="font-serif-geos text-xl md:text-2xl text-[#EAE6DF] font-light">
              Лента активности цифрового штаба
            </h3>
          </div>
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#1A1614]/80 backdrop-blur-md border border-[#DCD6CD]/20 text-xs text-[#DCD6CD]">
            <Activity className="w-3.5 h-3.5 text-[#C5A059] animate-spin" />
            <span>Непрерывный мониторинг</span>
          </div>
        </div>
      </div>

      {/* Top Live Summary Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-[#1C1816]/60 border border-[#DCD6CD]/15 backdrop-blur-md">
        <div>
          <h2 className="text-xl sm:text-2xl font-serif-geos font-light tracking-tight text-[#EAE6DF]">
            Сегодня штаб закрыл {doneCount} задач
          </h2>
          <p className="text-xs text-[#B0A79E] mt-1 font-light">
            Автоматическая хроника действий цифровых сотрудников
          </p>
        </div>

        {pendingCount > 0 ? (
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#C5A059]/15 border border-[#C5A059]/40 shrink-0">
            <span className="w-2 h-2 rounded-full bg-[#C5A059] animate-ping" />
            <span className="text-xs font-medium text-[#EAE6DF]">
              <span className="text-sm font-bold mr-1 text-[#C5A059]">{pendingCount}</span> ждут тебя
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white/[0.03] border border-white/10 shrink-0 text-slate-400 text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>Все задачи обработаны</span>
          </div>
        )}
      </div>

      {/* Main Feed Section */}
      {feed.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] backdrop-blur-md p-10 text-center space-y-3">
          <Activity className="w-10 h-10 mx-auto text-slate-500 opacity-50" />
          <p className="text-sm text-slate-300 font-medium max-w-md mx-auto leading-relaxed">
            Пока тихо. Как только бот ответит первому клиенту или ты утвердишь ответ — здесь появится лента работы штаба.
          </p>
        </div>
      ) : (
        <div className="relative pl-4 sm:pl-6 space-y-4">
          {/* Vertical Timeline Line */}
          <div className="absolute left-6 sm:left-8 top-3 bottom-3 w-0.5 bg-white/10" />

          {feed.map((ev, index) => {
            const roleInfo = ROLE_CONFIG[ev.role] || {
              label: ev.role || 'Агент',
              icon: MessageSquare,
              color: '#888888',
            };
            const IconComp = roleInfo.icon;
            const isHighlight = highlightedId === ev.id;
            const isFirst = index === 0;

            return (
              <div
                key={ev.id}
                className={`relative flex items-start gap-4 transition-all duration-300 ${
                  isFirst ? 'animate-slide-down' : ''
                }`}
              >
                {/* Timeline node badge */}
                <div
                  className="relative z-10 w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border border-white/10 transition-transform duration-200 hover:scale-105"
                  style={{ backgroundColor: `${roleInfo.color}1F` }}
                >
                  <IconComp className="w-4 h-4" style={{ color: roleInfo.color }} />
                </div>

                {/* Event Card */}
                <div
                  className={`flex-1 rounded-2xl p-4 transition-all duration-200 border text-left ${
                    ev.status === 'pending'
                      ? 'bg-white/[0.04] border-[#FF6B00]/40 border-l-4 border-l-[#FF6B00]'
                      : 'bg-white/[0.02] border-white/10 hover:bg-white/[0.05] hover:border-white/20'
                  } ${
                    isHighlight
                      ? 'ring-2 ring-[#FF6B00] border-[#FF6B00] shadow-[0_0_20px_rgba(255,107,0,0.2)]'
                      : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-medium text-slate-400">
                      {roleInfo.label}
                    </span>
                    <div className="flex items-center gap-2">
                      {ev.status === 'pending' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-[#FF6B00]/20 text-[#FF6B00] border border-[#FF6B00]/30">
                          ждёт тебя
                        </span>
                      )}
                      {ev.status === 'done' && (
                        <span className="w-2 h-2 rounded-full bg-emerald-400" title="Завершено" />
                      )}
                      {ev.status === 'info' && (
                        <span className="w-2 h-2 rounded-full bg-slate-500" title="Информация" />
                      )}
                      <span className="text-[11px] text-slate-500 font-light">
                        {formatTime(ev.ts)}
                      </span>
                    </div>
                  </div>

                  <h4 className="text-sm font-semibold text-white leading-snug">
                    {ev.title}
                  </h4>

                  {ev.detail && (
                    <p className="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed font-light">
                      {ev.detail}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
