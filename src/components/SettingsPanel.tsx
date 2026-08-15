import React, { useState } from 'react';
import { GlassPanel } from './GlassPanel';
import { NeonButton } from './NeonButton';
import { AppConfig } from '../types';
import { Sliders, Volume2, Check, Bot, Sparkles, HelpCircle } from 'lucide-react';

interface SettingsPanelProps {
  config: AppConfig;
  onSave: (updatedConfig: AppConfig) => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ config, onSave }) => {
  const [localConfig, setLocalConfig] = useState<AppConfig>({ ...config });
  const [saved, setSaved] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(localConfig);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleChannelToggle = (ch: string) => {
    const currentChannels = localConfig.channels || [];
    const channels = currentChannels.includes(ch)
      ? currentChannels.filter(c => c !== ch)
      : [...currentChannels, ch];
    setLocalConfig({ ...localConfig, channels });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-12 animate-fade-in py-6 font-sans">
      {/* Short Hero-Block Header */}
      <div className="relative text-left border-b border-white/[0.08] pb-6">
        <div className="absolute -top-12 left-0 text-8xl font-extrabold text-white/[0.03] select-none pointer-events-none font-display">
          10
        </div>
        <span className="text-[10px] tracking-[0.1em] text-[#F5A623]/70 block mb-2 uppercase">модуль конфигурации</span>
        <h2 className="text-3xl md:text-4xl font-lux font-light text-white leading-snug">Настройки штаба</h2>
        <p className="text-sm text-slate-400 mt-2 max-w-2xl font-light leading-relaxed">
          Параметры деятельности вашей компании, style общения ИИ-сотрудников и параметры синтеза голосового сопровождения.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-8">
        <div className="premium-card rounded-2xl p-6 space-y-6">
          <div className="flex items-center gap-3.5 border-b border-white/5 pb-4">
            <div className="bg-accent/10 p-2.5 rounded-xl text-accent border border-accent/25">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white uppercase tracking-wider">Параметры компании</h4>
              <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-0.5">Общие настройки автономных ИИ-агентов</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold block">
                Название компании:
              </label>
              <input
                type="text"
                value={localConfig.business_name}
                onChange={e => setLocalConfig({ ...localConfig, business_name: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-accent focus:bg-black/60 transition-all font-light"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold block">
                Имя владельца:
              </label>
              <input
                type="text"
                value={localConfig.owner_name}
                onChange={e => setLocalConfig({ ...localConfig, owner_name: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-accent focus:bg-black/60 transition-all font-light"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold block">
              Сфера деятельности (Индустрия):
            </label>
            <input
              type="text"
              value={localConfig.industry}
              onChange={e => setLocalConfig({ ...localConfig, industry: e.target.value })}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-accent focus:bg-black/60 transition-all font-light"
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold block">
                Стиль общения (Тон):
              </label>
              <select
                value={localConfig.tone}
                onChange={e => setLocalConfig({ ...localConfig, tone: e.target.value as any })}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-accent focus:bg-black/60 transition-all font-light cursor-pointer"
              >
                <option value="friendly" className="bg-black text-white">Дружелюбный</option>
                <option value="professional" className="bg-black text-white">Деловой / Профессиональный</option>
                <option value="energetic" className="bg-black text-white">Энергичный</option>
                <option value="elegant" className="bg-black text-white">Элегантный</option>
                <option value="strict" className="bg-black text-white">Строгий</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold block">
                Уровень автономности:
              </label>
              <select
                value={localConfig.autonomy_level}
                onChange={e => setLocalConfig({ ...localConfig, autonomy_level: e.target.value as any })}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-accent focus:bg-black/60 transition-all font-light cursor-pointer"
              >
                <option value="full" className="bg-black text-white">Полная автономность (ИИ 24/7)</option>
                <option value="human-supervised" className="bg-black text-white">Контроль человеком (Полуавтомат)</option>
              </select>
            </div>
          </div>

          <div className="space-y-2.5 pt-2">
            <label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold block">
              Используемые каналы связи:
            </label>
            <div className="flex flex-wrap gap-2.5">
              {['telegram', 'whatsapp', 'vk', 'email'].map(ch => {
                const hasCh = (localConfig.channels || []).includes(ch);
                return (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => handleChannelToggle(ch)}
                    className={`px-4 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                      hasCh
                        ? 'bg-accent/10 border-accent text-accent'
                        : 'bg-transparent border-white/5 text-slate-500 hover:border-white/20'
                    }`}
                  >
                    {ch}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="premium-card rounded-2xl p-6 space-y-6">
          <div className="flex items-center gap-3.5 border-b border-white/5 pb-4">
            <div className="bg-accent/10 p-2.5 rounded-xl text-accent border border-accent/25">
              <Volume2 className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white uppercase tracking-wider">Озвучка ответов агентов</h4>
              <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-0.5">Настройки автоматического синтеза речи</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold block">
                Автоозвучка ответов:
              </label>
              <label className="relative flex items-center gap-3.5 cursor-pointer pt-2">
                <input
                  type="checkbox"
                  checked={localConfig.auto_synthesize || false}
                  onChange={e => setLocalConfig({ ...localConfig, auto_synthesize: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-10 h-6 bg-black/60 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[12px] after:left-[4px] after:bg-slate-500 after:border-slate-400 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent/30 peer-checked:after:bg-accent peer-checked:after:border-accent border border-white/10" />
                <span className="text-xs font-semibold text-slate-300 ml-1">
                  {localConfig.auto_synthesize ? 'Каждый новый ответ озвувается' : 'Выключено'}
                </span>
              </label>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold block">
                Голос ИИ:
              </label>
              <select
                value={localConfig.tts_voice || 'Kore'}
                onChange={e => setLocalConfig({ ...localConfig, tts_voice: e.target.value, voice_id: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-accent focus:bg-black/60 transition-all font-light cursor-pointer"
              >
                <option value="Kore" className="bg-black text-white">Kore (Заводской женский по умолчанию ✨)</option>
                <option value="Charon" className="bg-black text-white">Charon (Мужской голос инженера / Selin777 🏛️)</option>
                <option value="Aoede" className="bg-black text-white">Aoede (Мелодичный женский 🎵)</option>
                <option value="Orus" className="bg-black text-white">Orus (Уверенный мужской 🎙️)</option>
                <option value="Alnilam" className="bg-black text-white">Alnilam (Глубокий мужской 🔊)</option>
                <option value="Fenrir" className="bg-black text-white">Fenrir (Бархатный мужской 🎙️)</option>
                <option value="Puck" className="bg-black text-white">Puck (Энергичный мужской ⚡)</option>
                <option value="Zephyr" className="bg-black text-white">Zephyr (Мягкий нейтральный 🍃)</option>
              </select>
            </div>
          </div>

          <div className="text-xs text-slate-400 bg-black/40 p-4 rounded-xl border border-white/5 leading-relaxed font-light space-y-2">
            <p>
              💡 <span className="font-semibold text-slate-200">Голосовое переключение в умной колонке:</span>
            </p>
            <ul className="list-disc list-inside space-y-1 text-slate-300">
              <li>Скажите <span className="text-accent font-semibold">«Selin777»</span> (или «Селин 777») — включится мужской голос инженера (Charon).</li>
              <li>Скажите <span className="text-accent font-semibold">«Selin000»</span> (или «Селин 000») — вернется заводской женский голос (Kore).</li>
            </ul>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <NeonButton type="submit" variant="accent" className="px-8 py-4 text-xs tracking-widest font-bold uppercase">
            {saved ? (
              <span className="flex items-center gap-1.5 text-black">
                <Check className="h-4.5 w-4.5" /> СОХРАНЕНО!
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Sliders className="h-4.5 w-4.5" /> СОХРАНИТЬ ИЗМЕНЕНИЯ
              </span>
            )}
          </NeonButton>
        </div>
      </form>
    </div>
  );
};
