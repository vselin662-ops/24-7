import React, { useState } from 'react';
import { GlassPanel } from './GlassPanel';
import { NeonButton } from './NeonButton';
import { Check, ShieldAlert, CreditCard, ExternalLink, Key } from 'lucide-react';
// @ts-ignore
import luxSpace from '../assets/images/lux_space_1785822495366.jpg';

export const BillingPanel: React.FC = () => {
  const [selectedPlan, setSelectedPlan] = useState<'free' | 'personal' | 'business' | 'enterprise'>('personal');
  const [loading, setLoading] = useState(false);
  const [isPaid, setIsPaid] = useState(false);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);

  const plans = [
    {
      id: 'free',
      name: 'Free',
      price: '0 ₽',
      sub: 'Попробовать',
      features: [
        '1 активный ИИ-агент (Приемщик)',
        'До 10 SMART-задач в день',
        'Текстовый режим (без голосового клона)',
        'Базовая память сессии'
      ],
      glow: false
    },
    {
      id: 'personal',
      name: 'Personal',
      price: '990 ₽/мес',
      sub: 'Самый популярный',
      features: [
        'Полный штаб: 4 ИИ-агента',
        'Безлимитные SMART-задачи',
        'Голосовой клон (1 голос)',
        'Озвучка звонков вашим голосом',
        'Полная автономность 24/7',
        'Память базы знаний на 30 дней'
      ],
      glow: true
    },
    {
      id: 'business',
      name: 'Business',
      price: '4 990 ₽/мес',
      sub: 'Для растущего бизнеса',
      features: [
        'Безлимитные ИИ-агенты',
        'Командный доступ к панели',
        'Интеграция с amoCRM, Bitrix24',
        'Прямые мессенджер интеграции',
        'Аналитика постов и воронка продаж',
        'Выделенный API ключ и база'
      ],
      glow: false
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      price: 'от 50 000 ₽',
      sub: 'White Label решение',
      features: [
        'Индивидуальный бренд (White Label)',
        'Развертывание на GPU серверах',
        'Разработка кастомных ML-моделей',
        'Обучение на вашей базе знаний',
        'Персональный архитектор 24/7',
        'Полный аудит и безопасность'
      ],
      glow: false
    }
  ];

  const handleSubscribe = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setShowCheckoutModal(true);
    }, 800);
  };

  const confirmSimulatedPayment = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setShowCheckoutModal(false);
      setIsPaid(true);
    }, 1500);
  };

  return (
    <div className="w-full bg-[#14100E]/50 backdrop-blur-xl border border-[#DCD6CD]/20 rounded-3xl p-6 md:p-8 space-y-10 animate-fade-in font-sans text-white shadow-2xl">
      {/* GEOS Organic Pebble Photo Banner */}
      <div className="relative w-full h-44 sm:h-52 overflow-hidden rounded-[28px_12px_28px_12px] border border-[#DCD6CD]/20 shadow-xl group">
        <img 
          src={luxSpace} 
          alt="Тарифы и Пространство" 
          className="w-full h-full object-cover filter brightness-90 contrast-110 group-hover:scale-105 transition-transform duration-700" 
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#14100E] via-black/20 to-transparent" />
        <div className="absolute bottom-4 left-6 right-6 flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase tracking-[0.25em] text-[#C5A059] font-medium font-serif-geos block">
              ТАРИФЫ И ЛИМИТЫ
            </span>
            <h3 className="font-serif-geos text-xl md:text-2xl text-[#EAE6DF] font-light">
              Индивидуальная автономность и баланс
            </h3>
          </div>
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#1A1614]/80 backdrop-blur-md border border-[#DCD6CD]/20 text-xs text-[#DCD6CD]">
            <CreditCard className="w-3.5 h-3.5 text-[#C5A059]" />
            <span>0% Удорожания</span>
          </div>
        </div>
      </div>

      {/* Short Hero-Block Header */}
      <div className="relative text-left border-b border-[#DCD6CD]/10 pb-6">
        <span className="text-[10px] tracking-[0.2em] text-[#C5A059] block mb-1 uppercase font-serif-geos">МОДУЛЬ ТАРИФОВ</span>
        <h2 className="text-3xl md:text-4xl font-serif-geos font-light text-[#EAE6DF] leading-snug">Подписка и баланс</h2>
        <p className="text-sm text-[#B0A79E] mt-2 max-w-2xl font-light leading-relaxed">
          Выберите тарифный план для масштабирования вашего ИИ-штаба. Переключайтесь между тарифами в любое время.
        </p>
      </div>

      {/* Grace period notify */}
      {!isPaid && (
        <div className="bg-accent/5 border border-accent/20 p-6 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="flex gap-4 items-start">
            <div className="bg-accent/10 text-accent p-3 rounded-xl mt-0.5 border border-accent/20">
              <ShieldAlert className="h-6 w-6 animate-pulse" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-accent uppercase tracking-wider">Пробный период (Grace Period) — осталось 3 дня</h4>
              <p className="text-xs text-slate-300 mt-1.5 font-light leading-relaxed">
                Продлите подписку для бесперебойной работы ваших агентов. Автоматическое понижение тарифа произойдет 23 июля.
              </p>
            </div>
          </div>
          <NeonButton variant="accent" onClick={() => { setSelectedPlan('personal'); handleSubscribe(); }} className="text-[10px] font-bold tracking-wider uppercase py-3 px-5 shrink-0">
            Продлить сейчас
          </NeonButton>
        </div>
      )}

      {isPaid && (
        <div className="bg-emerald-500/5 border border-emerald-500/20 p-6 rounded-2xl flex gap-4 items-center animate-fade-in">
          <div className="bg-emerald-950/40 border border-emerald-500/30 text-emerald-400 p-2.5 rounded-full">
            <Check className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-emerald-300 uppercase tracking-wider">Тариф «Personal» успешно активирован!</h4>
            <p className="text-xs text-slate-400 mt-1 font-light">Рекуррентный платеж привязан через ЮKassa. Следующее списание: 20 августа 2026 г.</p>
          </div>
        </div>
      )}

      {/* Plans comparison cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        {plans.map((p) => (
          <div
            key={p.id}
            onClick={() => setSelectedPlan(p.id as any)}
            className={`p-6 rounded-2xl flex flex-col justify-between border cursor-pointer transition-all duration-300 relative ${
              selectedPlan === p.id
                ? 'border-[#F5A623]/40 bg-[#F5A623]/10 shadow-[0_4px_25px_rgba(245,166,35,0.05)] backdrop-blur-md'
                : 'border-white/[0.08] bg-white/[0.02] backdrop-blur-sm hover:border-[#F5A623]/25 hover:bg-white/[0.04] hover:shadow-[0_0_20px_rgba(245,166,35,0.05)]'
            }`}
          >
            {p.glow && (
              <span className="absolute -top-3 right-6 bg-accent text-black text-[9px] font-bold px-3 py-1 rounded-full uppercase tracking-widest shadow-[0_4px_15px_rgba(245,166,35,0.3)]">
                Популярно
              </span>
            )}
            <div>
              <span className="text-[9px] font-bold text-slate-500 block uppercase tracking-wider">{p.sub}</span>
              <h4 className="text-lg font-bold text-white mt-1.5 font-display uppercase tracking-tight">{p.name}</h4>
              <div className="text-2xl font-display font-black text-accent mt-3">{p.price}</div>

              <ul className="space-y-3 mt-6 border-t border-white/5 pt-5 text-xs text-slate-300 font-light leading-relaxed">
                {p.features.map((f, idx) => (
                  <li key={idx} className="flex gap-2.5 items-start">
                    <Check className="h-3.5 w-3.5 text-accent mt-0.5 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>

            <NeonButton
              variant={selectedPlan === p.id ? 'accent' : 'glass'}
              glow={selectedPlan === p.id}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedPlan(p.id as any);
                handleSubscribe();
              }}
              className="w-full mt-8 text-[10px] font-bold tracking-wider uppercase py-3.5"
            >
              Выбрать тариф
            </NeonButton>
          </div>
        ))}
      </div>

      {/* Simulated YuKassa checkout Modal */}
      {showCheckoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="bg-[#111113] border border-white/10 rounded-2xl p-8 max-w-md w-full shadow-[0_10px_50px_rgba(0,0,0,0.8)] animate-fade-in">
            <div className="flex justify-between items-center border-b border-white/5 pb-4">
              <span className="font-display font-bold text-white uppercase tracking-wider text-xs flex items-center gap-2.5">
                <CreditCard className="text-accent h-4.5 w-4.5" /> Шлюз оплаты ЮKassa
              </span>
              <button
                onClick={() => setShowCheckoutModal(false)}
                className="text-slate-500 hover:text-white transition-all text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-5 mt-5">
              <div className="bg-black/40 p-4.5 rounded-xl border border-white/5 text-xs space-y-2 font-light">
                <div className="flex justify-between text-slate-400">
                  <span>Получатель:</span>
                  <span className="text-white font-medium font-sans">ИИ-Штаб StayAutonomous</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Тариф:</span>
                  <span className="text-white font-medium font-sans">Personal (Ежемесячная подписка)</span>
                </div>
                <div className="flex justify-between text-slate-400 border-t border-white/5 pt-2 mt-1">
                  <span>Сумма к оплате:</span>
                  <span className="text-accent font-black">990.00 ₽</span>
                </div>
              </div>

              {/* Simulated Card form */}
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Номер карты</label>
                  <input
                    type="text"
                    defaultValue="2200 4812 3456 7890"
                    disabled
                    className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-xs text-slate-300 focus:outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Срок</label>
                    <input
                      type="text"
                      defaultValue="12 / 29"
                      disabled
                      className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-xs text-slate-300 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">CVC</label>
                    <input
                      type="password"
                      defaultValue="***"
                      disabled
                      className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-xs text-slate-300 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-accent/5 border border-accent/10 rounded-xl p-4 text-[10px] text-accent leading-relaxed font-light">
                Это безопасная песочница симуляции ЮKassa API. Нажмите «Оплатить» для подтверждения подписки. Настоящие средства списаны не будут.
              </div>

              <div className="flex gap-3 pt-3">
                <NeonButton variant="glass" onClick={() => setShowCheckoutModal(false)} className="flex-1 text-[10px] font-bold tracking-wider uppercase py-3 border-white/10">
                  Отмена
                </NeonButton>
                <NeonButton variant="accent" onClick={confirmSimulatedPayment} loading={loading} className="flex-1 text-[10px] font-bold tracking-wider uppercase py-3">
                  Оплатить 990 ₽
                </NeonButton>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
