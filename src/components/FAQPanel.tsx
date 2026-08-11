import React, { useState } from 'react';
import { GlassPanel } from './GlassPanel';
import { NeonButton } from './NeonButton';
import { HelpCircle, Shield, Key, Eye, Check, AlertTriangle, Copy, FileText } from 'lucide-react';
const TECHNICAL_REPORT_MARKDOWN = `# Технический отчет Selin AI
- Платформа: Selin AI
- Безопасность: 152-ФЗ РФ, шифрование данных
- База данных: SQLite WAL mode
- Интеграция: Max Bot API, Gemini AI`;

const TELEGRAM_SETUP_INSTRUCTIONS = `# Инструкция по подключению
1. Откройте бота в Max: https://max.ru/se13914883_bot
2. Нажмите "Старт" или отправьте /язык или /бизнес
3. Бот сразу начнёт работу!`;

interface FAQPanelProps {
  onWipeData: () => void;
  systemPrompts: { role: string; prompt: string }[];
}

export const FAQPanel: React.FC<FAQPanelProps> = ({ onWipeData, systemPrompts }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showPromptIndex, setShowPromptIndex] = useState<number | null>(null);
  const [showWipeConfirm, setShowWipeConfirm] = useState(false);
  const [wiped, setWiped] = useState(false);
  const [copiedReport, setCopiedReport] = useState(false);
  const [showFullReport, setShowFullReport] = useState(false);
  const [copiedTgSetup, setCopiedTgSetup] = useState(false);
  const [showFullTgSetup, setShowFullTgSetup] = useState(false);

  const faqs = [
    {
      q: 'Что делает автономный штаб?',
      a: 'Штаб состоит из 5 специализированных ИИ-сотрудников, которые координируются ИИ-координатором. Они автоматически отвечают на входящие вопросы в ваших мессенджерах, прогревают клиентов, высылают КП, ведут социальные сети и предоставляют аналитику по SMART-целям.'
    },
    {
      q: 'Безопасно ли клонирование голоса?',
      a: 'Абсолютно. Извлеченный вектор голоса шифруется алгоритмом AES-256 с использованием ключа, который хранится только у вас. Никто, включая разработчиков, не может использовать ваш голос без этого ключа. Все действия логируются в Firestore.'
    },
    {
      q: 'Какие мессенджеры поддерживаются?',
      a: 'Система имеет готовые вебхук-интеграции с Telegram Bot API, WhatsApp Business API (через партнерские шлюзы), сообщениями сообществ ВКонтакте и Email SMTP серверами.'
    },
    {
      q: 'Соответствует ли приложение 152-ФЗ?',
      a: 'Да. Все персональные данные шифруются, хранятся на территории РФ (в защищенном Firestore). Каждому пользователю предоставляется право на полное удаление всех данных и голосовых слепков в один клик согласно законодательству.'
    }
  ];

  const filteredFaqs = faqs.filter(
    f => f.q.toLowerCase().includes(searchTerm.toLowerCase()) || f.a.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleWipe = () => {
    setWiped(true);
    setTimeout(() => {
      onWipeData();
      setShowWipeConfirm(false);
      setWiped(false);
    }, 1500);
  };

  const handleCopyReport = () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(TECHNICAL_REPORT_MARKDOWN);
        setCopiedReport(true);
        setTimeout(() => setCopiedReport(false), 2000);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = TECHNICAL_REPORT_MARKDOWN;
        textArea.style.position = "fixed";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setCopiedReport(true);
        setTimeout(() => setCopiedReport(false), 2000);
      }
    } catch (err) {
      console.error("Failed to copy report", err);
    }
  };

  const handleCopyTgSetup = () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(TELEGRAM_SETUP_INSTRUCTIONS);
        setCopiedTgSetup(true);
        setTimeout(() => setCopiedTgSetup(false), 2000);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = TELEGRAM_SETUP_INSTRUCTIONS;
        textArea.style.position = "fixed";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setCopiedTgSetup(true);
        setTimeout(() => setCopiedTgSetup(false), 2000);
      }
    } catch (err) {
      console.error("Failed to copy Telegram setup instructions", err);
    }
  };

  return (
    <div className="space-y-12 animate-fade-in py-6">
      {/* Short Hero-Block Header */}
      <div className="relative text-left border-b border-white/[0.08] pb-6">
        <div className="absolute -top-12 left-0 text-8xl font-extrabold text-white/[0.03] select-none pointer-events-none font-display">
          09
        </div>
        <span className="text-[10px] tracking-[0.1em] text-[#F5A623]/70 block mb-2 uppercase">справка и академия</span>
        <h2 className="text-3xl md:text-4xl font-lux font-light text-white leading-snug">Документация и инструкции</h2>
        <p className="text-sm text-slate-400 mt-2 max-w-2xl font-light leading-relaxed">
          Полезные материалы по настройке Telegram-ботов, техническая отчетность и правовое соответствие 152-ФЗ.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Search & FAQs */}
        <div className="lg:col-span-7 space-y-6">
          {/* Telegram Bot Setup Card */}
          <div className="premium-card p-6 rounded-2xl space-y-4 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-accent/5 rounded-full filter blur-xl animate-pulse animate-duration-10000" />
            
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-accent/10 rounded-xl text-accent border border-accent/25">
                  <Key className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white font-display uppercase tracking-wider">🤖 Инструкция Telegram-бота</h4>
                  <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-0.5">Создание, подключение и запуск живого бота</p>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowFullTgSetup(!showFullTgSetup)}
                  className="text-[10px] font-bold uppercase tracking-wider text-accent hover:text-white transition-colors px-3 py-1.5 rounded bg-accent/10 hover:bg-accent/20 flex items-center gap-1.5 cursor-pointer"
                >
                  <Eye className="h-4 w-4" />
                  {showFullTgSetup ? 'Скрыть' : 'Инструкция'}
                </button>

                <NeonButton
                  variant={copiedTgSetup ? "accent" : "glass"}
                  onClick={handleCopyTgSetup}
                  className="text-[10px] font-bold tracking-wider uppercase px-4 py-2.5 flex items-center gap-1.5"
                  glow={false}
                >
                  {copiedTgSetup ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-300" />
                      Скопировано!
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Копировать
                    </>
                  )}
                </NeonButton>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed font-light">
              Подключите реального Telegram-бота к вашему ИИ-штабу. Наша CRM-система будет ловить сообщения из мессенджера, а ИИ-агенты будут генерировать живые ответы в режиме реального времени. Вы также можете отвечать напрямую!
            </p>

            {showFullTgSetup && (
              <div className="mt-4 max-h-[300px] overflow-y-auto bg-black/40 border border-white/5 rounded-2xl p-4 text-xs text-slate-300 space-y-3 leading-relaxed scrollbar-thin">
                <pre className="whitespace-pre-wrap font-sans text-xs text-slate-200">
                  {TELEGRAM_SETUP_INSTRUCTIONS}
                </pre>
              </div>
            )}
          </div>

          {/* Technical Report Card */}
          <div className="premium-card p-6 rounded-2xl space-y-4 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-accent/5 rounded-full filter blur-xl animate-pulse animate-duration-[12000ms]" />
            
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-accent/10 rounded-xl text-accent border border-accent/25">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white font-display uppercase tracking-wider">📋 ТЕХНИЧЕСКИЙ ОТЧЕТ</h4>
                  <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-0.5">Статус, стек, архитектура и результаты проекта</p>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowFullReport(!showFullReport)}
                  className="text-[10px] font-bold uppercase tracking-wider text-accent hover:text-white transition-colors px-3 py-1.5 rounded bg-accent/10 hover:bg-accent/20 flex items-center gap-1.5 cursor-pointer"
                >
                  <Eye className="h-4 w-4" />
                  {showFullReport ? 'Скрыть отчет' : 'Читать'}
                </button>

                <NeonButton
                  variant={copiedReport ? "accent" : "glass"}
                  onClick={handleCopyReport}
                  className="text-[10px] font-bold tracking-wider uppercase px-4 py-2.5 flex items-center gap-1.5"
                  glow={false}
                >
                  {copiedReport ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-300" />
                      Скопировано!
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Копировать
                    </>
                  )}
                </NeonButton>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed font-light">
              Вы можете скопировать полный структурированный технический отчет по проекту в один клик для отправки или сохранения на ПК. Он описывает состояние, рабочие функции, ограничения и дальнейшие шаги.
            </p>

            {showFullReport && (
              <div className="mt-4 max-h-[300px] overflow-y-auto bg-black/40 border border-white/5 rounded-2xl p-4 text-xs text-slate-300 space-y-3 leading-relaxed scrollbar-thin">
                <pre className="whitespace-pre-wrap font-sans text-xs text-slate-200">
                  {TECHNICAL_REPORT_MARKDOWN}
                </pre>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Академия & FAQ</span>
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Поиск по документации и часто задаваемым вопросам..."
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-accent focus:bg-black/60 transition-all font-light"
            />
          </div>

          <div className="space-y-3">
            {filteredFaqs.map((faq, idx) => (
              <div key={idx} className="premium-card p-5 rounded-2xl space-y-2 text-xs">
                <h5 className="font-bold text-white flex items-center gap-2.5 text-xs uppercase tracking-wide">
                  <HelpCircle className="h-4.5 w-4.5 text-accent shrink-0" /> {faq.q}
                </h5>
                <p className="text-slate-300 leading-relaxed pl-7 font-light">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Security compliance & prompts */}
        <div className="lg:col-span-5 space-y-6">
          <div className="premium-card rounded-2xl p-6 space-y-5">
            <div className="flex items-center gap-2.5 text-accent font-display font-bold text-sm uppercase tracking-wide border-b border-white/5 pb-3">
              <Shield className="h-5 w-5" /> Системные промты ИИ-Агентов
            </div>
            <p className="text-xs text-slate-400 font-light leading-relaxed">
              Здесь вы можете заглянуть под капот и просмотреть точные инструкции, по которым действуют ИИ-агенты вашего штаба.
            </p>

            <div className="space-y-2.5 text-xs">
              {systemPrompts.map((p, idx) => (
                <div key={idx} className="bg-black/30 border border-white/5 rounded-xl p-4 space-y-2.5">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-white uppercase text-[10px] tracking-wider">{p.role}</span>
                    <button
                      onClick={() => setShowPromptIndex(showPromptIndex === idx ? null : idx)}
                      className="text-accent hover:text-white flex items-center gap-1 text-[9px] cursor-pointer font-bold uppercase tracking-wider"
                    >
                      <Eye className="h-3 w-3" /> {showPromptIndex === idx ? 'Скрыть' : 'Показать'}
                    </button>
                  </div>
                  {showPromptIndex === idx && (
                    <pre className="text-[10px] text-slate-300 bg-black/50 p-3 rounded-xl border border-white/5 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto scrollbar-thin">
                      {p.prompt}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Wipe Data compliance according to 152-ФЗ */}
          <div className="bg-red-950/10 border border-red-500/20 p-6 rounded-2xl space-y-4">
            <div className="flex items-center gap-2.5 text-red-400 font-display font-bold text-sm uppercase tracking-wide">
              <AlertTriangle className="h-5 w-5 animate-pulse" /> Конфиденциальность & 152-ФЗ
            </div>
            <p className="text-xs text-slate-300 leading-relaxed font-light">
              Вы имеете полное законное право отозвать согласие на обработку данных. Нажатие на кнопку ниже мгновенно, физически и безвозвратно удалит ваш голосовой слепок, зашифрованные вектора в Firestore, историю переписок и SMART-планы.
            </p>

            {!showWipeConfirm ? (
              <NeonButton variant="red" onClick={() => setShowWipeConfirm(true)} className="text-[10px] font-bold tracking-wider uppercase py-3 w-full" glow={false}>
                Отозвать согласие и стереть все данные в 1 клик
              </NeonButton>
            ) : (
              <div className="bg-slate-950/60 p-4 rounded-xl border border-red-500/30 text-xs text-center space-y-3 font-light">
                <span className="font-bold text-red-400 block uppercase tracking-wider text-[10px]">Вы абсолютно уверены? Это действие необратимо.</span>
                <div className="flex gap-2.5 justify-center">
                  <NeonButton variant="glass" onClick={() => setShowWipeConfirm(false)} className="text-[10px] py-1.5 px-3 border-white/10" glow={false}>
                    Отмена
                  </NeonButton>
                  <NeonButton variant="red" onClick={handleWipe} loading={wiped} className="text-[10px] py-1.5 px-4 font-bold uppercase tracking-wider" glow={false}>
                    {wiped ? 'Удаление...' : 'Да, стереть всё'}
                  </NeonButton>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
