import React from 'react';
import { GlassPanel } from './GlassPanel';
import { BarChart, TrendingUp, Users, Zap, Award } from 'lucide-react';

export const AnalyticsPanel: React.FC = () => {
  const stats = [
    { title: 'Заявок обработано', value: '412', change: '+18% за неделю', icon: <Users className="h-4 w-4 text-accent" /> },
    { title: 'Конверсия в сделку', value: '28.4%', change: '+4.2% в этом месяце', icon: <TrendingUp className="h-4 w-4 text-emerald-400" /> },
    { title: 'Сэкономлено времени', value: '148 ч', change: '24/7 автономная работа', icon: <Zap className="h-4 w-4 text-amber-400" /> },
    { title: 'Успешность задач', value: '94.2%', change: 'Оценка SMART соответствия', icon: <Award className="h-4 w-4 text-purple-400" /> }
  ];

  const agentPerformance = [
    { name: 'Приемщик (Receiver)', taskCount: 215, score: '98%', color: 'bg-purple-500' },
    { name: 'Продажник (Sales)', taskCount: 148, score: '92%', color: 'bg-emerald-500' },
    { name: 'Контентщик (Content)', taskCount: 88, score: '95%', color: 'bg-accent' },
    { name: 'Аналитик (Analyst)', taskCount: 30, score: '96%', color: 'bg-blue-500' }
  ];

  return (
    <div className="space-y-12 animate-fade-in py-6">
      {/* Short Hero-Block Header */}
      <div className="relative text-left border-b border-white/5 pb-8">
        <div className="absolute -top-12 left-0 text-8xl font-extrabold text-white/[0.03] select-none pointer-events-none font-display">
          07
        </div>
        <span className="text-[11px] font-bold text-accent uppercase tracking-[0.25em] block mb-2">модуль аналитики</span>
        <h2 className="text-3xl md:text-4xl font-display font-black text-white uppercase tracking-tight">Аналитика штаба & Эффективность</h2>
        <p className="text-sm text-slate-400 mt-2 max-w-2xl font-light">
          Подробный разбор показателей эффективности ИИ-сотрудников, аналитика обращений и динамика экономии ресурсов.
        </p>
      </div>

      {/* Stat Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((s, idx) => (
          <div key={idx} className="premium-card p-6 rounded-2xl border border-white/8 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider">{s.title}</span>
              <div className="text-2xl font-display font-black text-white mt-2">{s.value}</div>
              <span className="text-[11px] text-slate-500 block mt-1.5 font-light">{s.change}</span>
            </div>
            <div className="bg-white/5 p-3 rounded-xl border border-white/5 shrink-0">{s.icon}</div>
          </div>
        ))}
      </div>

      {/* Main performance chart & agents */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* SVG Interactive Chart */}
        <div className="lg:col-span-8">
          <div className="premium-card rounded-2xl p-6 h-full flex flex-col justify-between">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h4 className="text-sm font-bold text-white uppercase tracking-wider font-display">Трафик и активность по часам</h4>
                <p className="text-[11px] text-slate-400 font-light mt-1">Суммарная активность за последние 24 часа</p>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider bg-accent/10 border border-accent/20 text-accent px-3 py-1 rounded">
                Live Мониторинг
              </span>
            </div>

            {/* Custom SVG Bar Chart */}
            <div className="h-60 w-full flex items-end justify-between gap-1.5 pt-6">
              {[30, 45, 20, 55, 75, 40, 85, 90, 60, 45, 80, 100, 70, 65, 50, 40, 60, 85, 95, 70, 50, 40, 30, 20].map((val, idx) => (
                <div key={idx} className="flex-1 flex flex-col items-center gap-2 h-full justify-end group relative">
                  {/* Tooltip */}
                  <span className="opacity-0 group-hover:opacity-100 absolute bottom-64 bg-slate-950 text-white text-[10px] px-2 py-1 rounded border border-white/10 pointer-events-none transition-all whitespace-nowrap z-10 shadow-2xl">
                    {val} заявок
                  </span>
                  <div
                    className="w-full bg-accent/10 hover:bg-accent border border-accent/20 hover:border-accent rounded-t transition-all duration-300 cursor-pointer"
                    style={{ height: `${val}%` }}
                  />
                  <span className="text-[9px] text-slate-600 group-hover:text-accent transition-all font-light">
                    {idx}:00
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Agents Performance */}
        <div className="lg:col-span-4">
          <div className="premium-card rounded-2xl p-6 h-full flex flex-col justify-between space-y-6">
            <div>
              <h4 className="text-sm font-bold text-white uppercase tracking-wider font-display mb-6">Коэффициент эффективности ИИ</h4>
              <div className="space-y-5">
                {agentPerformance.map((ap, idx) => (
                  <div key={idx} className="space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-slate-300 uppercase tracking-wide text-[11px]">{ap.name}</span>
                      <span className="text-accent font-bold">{ap.score}</span>
                    </div>
                    <div className="w-full bg-black/40 h-1.5 rounded-full overflow-hidden border border-white/5">
                      <div
                        className={`${ap.color} h-full rounded-full transition-all duration-500`}
                        style={{ width: ap.score }}
                      />
                    </div>
                    <div className="text-slate-500 text-[10px] font-light">
                      Выполнено SMART-задач: {ap.taskCount}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 border-t border-white/5 pt-5 text-[10px] text-slate-500 flex justify-between items-center">
              <span>Система: База Знаний + Firestore</span>
              <span className="text-accent font-bold">Оценка MOS: 4.85/5</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
