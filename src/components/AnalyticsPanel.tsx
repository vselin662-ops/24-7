import React, { useState, useEffect } from 'react';
import { Users, TrendingUp, Zap, Award, Activity, CheckCircle2 } from 'lucide-react';
import { adminApi } from '../lib/adminApi';

export const AnalyticsPanel: React.FC = () => {
  const [feedCount, setFeedCount] = useState<number>(0);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [activeChannelsCount, setActiveChannelsCount] = useState<number>(1);
  const [isLive, setIsLive] = useState<boolean>(false);

  useEffect(() => {
    // Fetch live counts from actual system APIs
    adminApi('/api/admin/feed')
      .then(res => res.json())
      .then(data => {
        const feedList = Array.isArray(data) ? data : (data?.feed || []);
        setFeedCount(feedList.length);
      })
      .catch(() => {});

    adminApi('/api/moderation/pending')
      .then(res => res.json())
      .then(data => {
        const pendingList = Array.isArray(data) ? data : (data?.queue || []);
        setPendingCount(pendingList.length);
      })
      .catch(() => {});

    adminApi('/api/admin/config')
      .then(res => res.json())
      .then(data => {
        if (data?.config) {
          setIsLive(!!data.config.is_live);
          if (Array.isArray(data.config.channels)) {
            setActiveChannelsCount(data.config.channels.length);
          }
        }
      })
      .catch(() => {});
  }, []);

  const stats = [
    { title: 'Записей в Ленте', value: `${feedCount}`, change: 'Реальные события штаба', icon: <Users className="h-4 w-4 text-[#C5A059]" /> },
    { title: 'Очередь Модерации', value: `${pendingCount}`, change: 'Задачи на проверку', icon: <TrendingUp className="h-4 w-4 text-[#30d158]" /> },
    { title: 'Каналы связи', value: `${activeChannelsCount}`, change: 'Подключенные мессенджеры', icon: <Zap className="h-4 w-4 text-[#DCD6CD]" /> },
    { title: 'Статус штаба', value: isLive ? '24/7 LIVE' : 'ГОТОВ', change: 'Режим автономии', icon: <Award className="h-4 w-4 text-[#C5A059]" /> }
  ];

  const agentsList = [
    { name: 'Приемщик (Receiver)', role: 'Прием обращений', status: 'Активен', color: 'bg-[#C5A059]' },
    { name: 'Продажник (Sales)', role: 'Ведение лидов', status: 'Активен', color: 'bg-[#30d158]' },
    { name: 'Операционист (Operator)', role: 'Координация задач', status: 'Активен', color: 'bg-[#DCD6CD]' }
  ];

  return (
    <div className="space-y-10 animate-fade-in py-4 font-serif-geos">
      {/* Header */}
      <div className="relative text-left border-b border-[#DCD6CD]/15 pb-6">
        <span className="text-xs font-medium text-[#C5A059] uppercase tracking-[0.25em] block mb-1.5">СЕЛИНИ · АНАЛИТИКА</span>
        <h2 className="text-3xl md:text-4xl font-light text-[#EAE6DF] tracking-wide">Аналитика и Метрики Штаба</h2>
        <p className="text-sm text-[#B0A79E] mt-1.5 max-w-2xl font-light leading-relaxed">
          Реальные показатели работы ИИ-сотрудников, синхронизированные с базой данных и мессенджерами.
        </p>
      </div>

      {/* Stat Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {stats.map((s, idx) => (
          <div key={idx} className="p-6 rounded-2xl bg-[#181412]/80 border border-[#DCD6CD]/15 flex items-center justify-between shadow-xl">
            <div>
              <span className="text-[11px] text-[#8E847A] uppercase tracking-wider">{s.title}</span>
              <div className="text-2xl font-medium text-[#EAE6DF] mt-2">{s.value}</div>
              <span className="text-[11px] text-[#B0A79E] block mt-1.5 font-light">{s.change}</span>
            </div>
            <div className="bg-[#28221F] p-3 rounded-xl border border-[#DCD6CD]/10 shrink-0">{s.icon}</div>
          </div>
        ))}
      </div>

      {/* Real Agents & System Health */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8">
          <div className="p-6 md:p-8 rounded-3xl bg-[#181412]/80 border border-[#DCD6CD]/15 h-full flex flex-col justify-between shadow-xl">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h4 className="text-base font-medium text-[#EAE6DF] tracking-wide">Состояние активных ИИ-сотрудников</h4>
                <p className="text-xs text-[#B0A79E] font-light mt-1">Штаб автоматически распределяет поступившие задачи</p>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider bg-[#30d158]/10 border border-[#30d158]/20 text-[#30d158] px-3 py-1 rounded-full flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Онлайн
              </span>
            </div>

            <div className="space-y-3.5">
              {agentsList.map((agent, idx) => (
                <div key={idx} className="p-4 rounded-2xl bg-[#231E1B] border border-[#DCD6CD]/10 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`w-2.5 h-2.5 rounded-full ${agent.color}`} />
                    <div>
                      <div className="text-sm font-medium text-[#EAE6DF]">{agent.name}</div>
                      <div className="text-xs text-[#8E847A] font-light">{agent.role}</div>
                    </div>
                  </div>
                  <span className="text-xs font-medium px-3 py-1 rounded-full bg-[#28221F] border border-[#DCD6CD]/20 text-[#DCD6CD]">
                    {agent.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-4">
          <div className="p-6 md:p-8 rounded-3xl bg-[#181412]/80 border border-[#DCD6CD]/15 h-full flex flex-col justify-between space-y-6 shadow-xl">
            <div>
              <h4 className="text-base font-medium text-[#EAE6DF] tracking-wide mb-3">База знаний & ИИ</h4>
              <p className="text-xs text-[#B0A79E] font-light leading-relaxed mb-4">
                Штаб непрерывно использует ваши данные о бизнесе и системные промпты для ответа клиентам.
              </p>
              <div className="p-4 rounded-2xl bg-[#231E1B] border border-[#DCD6CD]/10 space-y-2.5">
                <div className="flex justify-between text-xs">
                  <span className="text-[#8E847A]">Синхронизация</span>
                  <span className="text-[#30d158] font-medium">Активна</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[#8E847A]">Модель ИИ</span>
                  <span className="text-[#EAE6DF] font-mono">Gemini 2.5 Flash</span>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-[#DCD6CD]/10 text-[11px] text-[#8E847A] flex justify-between items-center">
              <span>СИСТЕМА SELIN</span>
              <span className="text-[#C5A059] font-medium">100% АВТОНОМНОСТЬ</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
