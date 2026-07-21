import React, { useState, useEffect } from 'react';
import { GlassPanel } from './GlassPanel';
import { NeonButton } from './NeonButton';
import { SimulatedCustomer, Message } from '../types';
import { Send, Volume2, MessageSquare, Shield, HelpCircle } from 'lucide-react';

interface ChannelSimulatorProps {
  businessName: string;
  ownerName: string;
  industry: string;
  tone: string;
  voiceId: string;
  autoSynthesize?: boolean;
  ttsVoice?: string;
}

export const ChannelSimulator: React.FC<ChannelSimulatorProps> = ({
  businessName,
  ownerName,
  industry,
  tone,
  voiceId,
  autoSynthesize,
  ttsVoice
}) => {
  const [activeChannel, setActiveChannel] = useState<'telegram' | 'whatsapp' | 'vk' | 'email'>('telegram');
  const [loading, setLoading] = useState(false);
  const [customMsg, setCustomMsg] = useState('');
  const [audioLoadingMsgId, setAudioLoadingMsgId] = useState<string | null>(null);

  // Set up mock customers
  const [customers, setCustomers] = useState<SimulatedCustomer[]>([
    {
      id: 'cust_1',
      name: 'Екатерина Смирнова',
      channel: 'telegram',
      avatar: '👩‍💼',
      lastMessage: 'Добрый день! Подскажите стоимость услуг и свободные слоты на завтра?',
      timestamp: '10:45',
      history: [
        { sender: 'customer', text: 'Добрый день! Подскажите стоимость услуг и свободные слоты на завтра?' }
      ]
    },
    {
      id: 'cust_2',
      name: 'Алексей Петров',
      channel: 'whatsapp',
      avatar: '👨‍🔧',
      lastMessage: 'Привет! Мне нужно коммерческое предложение на услуги вашей компании.',
      timestamp: '11:15',
      history: [
        { sender: 'customer', text: 'Привет! Мне нужно коммерческое предложение на услуги вашей компании.' }
      ]
    },
    {
      id: 'cust_3',
      name: 'Мария Иванова',
      channel: 'vk',
      avatar: '👩‍🎨',
      lastMessage: 'Здравствуйте! Вы работаете по выходным? Хотела бы сделать заказ.',
      timestamp: 'Вчера',
      history: [
        { sender: 'customer', text: 'Здравствуйте! Вы работаете по выходным? Хотела бы сделать заказ.' }
      ]
    }
  ]);

  const channelsList = [
    { id: 'telegram', name: 'Telegram Bot', icon: '✈️' },
    { id: 'whatsapp', name: 'WhatsApp Business', icon: '💬' },
    { id: 'vk', name: 'ВКонтакте', icon: '💙' },
    { id: 'email', name: 'Email SMTP', icon: '✉️' }
  ];

  // States for real Telegram integration
  const [realTelegramCustomers, setRealTelegramCustomers] = useState<SimulatedCustomer[]>([]);
  const [hasRealTelegram, setHasRealTelegram] = useState(false);
  const [isBotActive, setIsBotActive] = useState(false);

  // Poll actual Telegram chats from server
  useEffect(() => {
    if (activeChannel !== 'telegram') return;

    const fetchRealChats = async () => {
      try {
        const res = await fetch('/api/telegram/chats');
        if (!res.ok) {
          throw new Error(`Server returned status ${res.status}`);
        }
        const data = await res.json();
        setIsBotActive(data.isBotActive);
        if (data.chats && data.chats.length > 0) {
          setRealTelegramCustomers(data.chats);
          setHasRealTelegram(true);
        } else {
          setRealTelegramCustomers([]);
          setHasRealTelegram(false);
        }
      } catch (err) {
        console.warn("Failed to fetch real Telegram chats:", err);
      }
    };

    fetchRealChats();
    const interval = setInterval(fetchRealChats, 4000);
    return () => clearInterval(interval);
  }, [activeChannel]);

  // Use real Telegram chats if available and active, otherwise fallback to mock customer simulations
  const isRealTelegramActive = activeChannel === 'telegram' && hasRealTelegram;
  const currentCustomers = isRealTelegramActive 
    ? realTelegramCustomers 
    : customers.filter(c => c.channel === activeChannel);

  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');

  // Automatically select the first customer when active channel or conversations list changes
  useEffect(() => {
    if (currentCustomers.length > 0) {
      const exists = currentCustomers.some(c => c.id === selectedCustomerId);
      if (!exists) {
        setSelectedCustomerId(currentCustomers[0].id);
      }
    } else {
      setSelectedCustomerId('');
    }
  }, [currentCustomers, selectedCustomerId]);

  const selectedCustomer = currentCustomers.find(c => c.id === selectedCustomerId) || currentCustomers[0];

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customMsg.trim() || !selectedCustomer) return;

    const userText = customMsg;
    setCustomMsg('');

    // CASE 1: Real-time Telegram operator response (Direct 2-way chat)
    if (selectedCustomer.id.startsWith('tg_')) {
      setLoading(true);
      try {
        const response = await fetch('/api/telegram/send-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chatId: selectedCustomer.id,
            text: userText
          })
        });
        const data = await response.json();
        if (data.success) {
          // Instantly update UI for responsive feedback
          setRealTelegramCustomers(prev =>
            prev.map(c => {
              if (c.id === selectedCustomer.id) {
                return {
                  ...c,
                  lastMessage: userText,
                  timestamp: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
                  history: [...c.history, { sender: 'agent' as const, text: userText }]
                };
              }
              return c;
            })
          );
        }
      } catch (err) {
        console.error("Failed to send manual Telegram response:", err);
      } finally {
        setLoading(false);
      }
      return;
    }

    // CASE 2: Standard Simulator Sandbox (Mock client query)
    const updatedHistory = [
      ...selectedCustomer.history,
      { sender: 'customer' as const, text: userText }
    ];

    updateCustomerHistory(selectedCustomer.id, updatedHistory);
    setLoading(true);

    try {
      // Determine agent role depending on message
      let agentRole = 'receiver';
      if (userText.toLowerCase().includes('купить') || userText.toLowerCase().includes('кп') || userText.toLowerCase().includes('коммерческое') || userText.toLowerCase().includes('цена') || userText.toLowerCase().includes('стоимость')) {
        agentRole = 'sales';
      }

      const response = await fetch('/api/agent-respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_role: agentRole,
          user_message: userText,
          context: `Business Name: ${businessName}, Owner Name: ${ownerName}, Industry: ${industry}, Tone: ${tone}`,
          business_name: businessName,
          owner_name: ownerName,
          industry: industry,
          tone: tone
        })
      });

      const data = await response.json();
      if (data.response) {
        const finalHistory = [
          ...updatedHistory,
          { sender: 'agent' as const, text: data.response }
        ];
        updateCustomerHistory(selectedCustomer.id, finalHistory);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const updateCustomerHistory = (id: string, history: any[]) => {
    setCustomers(prev =>
      prev.map(c => (c.id === id ? { ...c, history, lastMessage: history[history.length - 1].text } : c))
    );
  };

  const handleVoicePlayback = async (text: string, msgIdx: number) => {
    const msgId = `${selectedCustomer.id}-${msgIdx}`;
    setAudioLoadingMsgId(msgId);

    try {
      const response = await fetch('/api/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: ttsVoice || voiceId || 'Kore' })
      });

      const data = await response.json();
      if (data.audio) {
        // Play PCM raw audio
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        const binary = atob(data.audio);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const int16Array = new Int16Array(bytes.buffer);
        const float32Array = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) {
          float32Array[i] = int16Array[i] / 32768.0;
        }

        const buffer = audioCtx.createBuffer(1, float32Array.length, 24000);
        buffer.getChannelData(0).set(float32Array);

        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(audioCtx.destination);
        source.start(0);
      } else {
        alert("Озвучка симулирована (Ключ API не настроен в AI Studio).");
      }
    } catch (error) {
      console.error("TTS Synthesis error:", error);
    } finally {
      setAudioLoadingMsgId(null);
    }
  };

  const [spokenMessageKeys, setSpokenMessageKeys] = useState<string[]>([]);

  useEffect(() => {
    if (!selectedCustomer || !autoSynthesize) return;
    const history = selectedCustomer.history;
    if (history.length === 0) return;

    const lastIdx = history.length - 1;
    const lastMsg = history[lastIdx];
    const msgKey = `${selectedCustomer.id}-${lastIdx}`;

    if (lastMsg.sender === 'agent' && !spokenMessageKeys.includes(msgKey)) {
      setSpokenMessageKeys(prev => [...prev, msgKey]);
      handleVoicePlayback(lastMsg.text, lastIdx);
    }
  }, [selectedCustomer?.history, autoSynthesize, spokenMessageKeys, selectedCustomer?.id]);

  const simulateIncomingClientMessage = () => {
    if (!selectedCustomer) return;

    const mockInquiries = [
      "Здравствуйте! Скажите, а вы делаете скидки для новых клиентов?",
      "У меня срочный вопрос! Можно ли связаться с руководством компании?",
      "Спасибо за подробный ответ, я готов сделать заказ. Пришлите ссылку на оплату.",
      "Каковы сроки выполнения типовых работ у вас?"
    ];

    const randomInquiry = mockInquiries[Math.floor(Math.random() * mockInquiries.length)];

    const updatedHistory = [
      ...selectedCustomer.history,
      { sender: 'customer' as const, text: randomInquiry }
    ];

    updateCustomerHistory(selectedCustomer.id, updatedHistory);
  };

  return (
    <div className="space-y-12 animate-fade-in py-6">
      {/* Short Hero-Block Header */}
      <div className="relative text-left border-b border-white/5 pb-8">
        <div className="absolute -top-12 left-0 text-8xl font-extrabold text-white/[0.03] select-none pointer-events-none font-display">
          05
        </div>
        <span className="text-[11px] font-bold text-accent uppercase tracking-[0.25em] block mb-2">модуль симуляции</span>
        <h2 className="text-3xl md:text-4xl font-display font-black text-white uppercase tracking-tight">Симулятор каналов продаж</h2>
        <p className="text-sm text-slate-400 mt-2 max-w-2xl font-light">
          Интерактивная песочница для тестирования ответов ИИ-сотрудников в мессенджерах, соцсетях и по email.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar: Channels & Customers list */}
        <div className="lg:col-span-1 space-y-6">
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">
              Канал мессенджера
            </span>
            <div className="flex flex-col gap-2">
              {channelsList.map(ch => (
                <button
                  key={ch.id}
                  onClick={() => {
                    setActiveChannel(ch.id as any);
                  }}
                  className={`flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all duration-300 text-xs cursor-pointer ${
                    activeChannel === ch.id
                      ? 'border-accent bg-accent/10 text-white shadow-[0_4px_15px_rgba(245,166,35,0.1)] font-semibold backdrop-blur-md'
                      : 'border-white/10 bg-white/4 backdrop-blur-sm hover:bg-white/8 hover:border-white/15 text-slate-400'
                  }`}
                >
                  <span className="text-base">{ch.icon}</span>
                  <span className="truncate tracking-wide">{ch.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">
              Диалоги
            </span>
            <div className="space-y-2 max-h-[300px] lg:max-h-none overflow-y-auto pr-1">
              {currentCustomers.length === 0 ? (
                <div className="text-center py-8 text-xxs text-slate-500 italic border border-dashed border-white/8 rounded-2xl bg-black/20 font-light">
                  Нет активных диалогов в этом канале.
                </div>
              ) : (
                currentCustomers.map(cust => (
                  <button
                    key={cust.id}
                    onClick={() => setSelectedCustomerId(cust.id)}
                    className={`w-full flex items-start gap-3.5 p-4 rounded-xl border text-left transition-all duration-300 cursor-pointer ${
                      selectedCustomerId === cust.id
                        ? 'border-accent bg-accent/5 text-slate-200 shadow-[0_2px_10px_rgba(245,166,35,0.05)]'
                        : 'border-white/5 bg-transparent hover:bg-white/[0.03] text-slate-400'
                    }`}
                  >
                    <div className="text-lg bg-white/5 p-2 rounded-xl">{cust.avatar}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-white truncate text-xs">{cust.name}</span>
                        <span className="text-slate-500 text-[9px]">{cust.timestamp}</span>
                      </div>
                      <p className="truncate text-slate-400 mt-1.5 text-[11px] font-light">{cust.lastMessage}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Main chat terminal window */}
        <div className="lg:col-span-3">
          {selectedCustomer ? (
            <div className="premium-card rounded-2xl flex flex-col h-[520px] relative p-0 overflow-hidden font-sans">
              {/* Real-time Status Alert Banner */}
              {activeChannel === 'telegram' && (
                <div className={`px-5 py-3.5 border-b border-white/5 flex items-center justify-between text-[10px] ${isBotActive ? 'bg-emerald-500/10 text-emerald-300' : 'bg-accent/10 text-accent'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${isBotActive ? 'bg-emerald-400 animate-pulse' : 'bg-accent animate-pulse'}`} />
                    <span className="font-bold uppercase tracking-wider">
                      {isBotActive 
                        ? 'РЕАЛЬНЫЙ TELEGRAM БОТ АКТИВЕН В РЕЖИМЕ LIVE' 
                        : 'TELEGRAM ИНТЕГРАЦИЯ: ДЕМО-РЕЖИМ (СИМУЛЯЦИЯ)'
                      }
                    </span>
                  </div>
                  {!isBotActive && (
                    <span className="text-[9px] text-slate-400 font-light">
                      Укажите TELEGRAM_BOT_TOKEN в настройках
                    </span>
                  )}
                </div>
              )}

              {/* Header */}
              <div className="flex items-center justify-between p-5 border-b border-white/5 bg-white/[0.01]">
                <div className="flex items-center gap-3.5">
                  <div className="text-2xl bg-white/5 p-2.5 rounded-xl">{selectedCustomer.avatar}</div>
                  <div>
                    <h4 className="text-sm font-bold text-white uppercase tracking-wide">{selectedCustomer.name}</h4>
                    <div className="flex items-center gap-1.5 text-[10px] text-accent">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="font-medium">
                        {selectedCustomer.id.startsWith('tg_') 
                          ? 'Статус: Живой клиент в Telegram' 
                          : 'Авто-контроль: ИИ-ассистент на линии'
                        }
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  {selectedCustomer.id.startsWith('tg_') ? (
                    <span className="text-[10px] px-3.5 py-1.5 rounded-full bg-accent/10 border border-accent/20 text-accent flex items-center gap-2 animate-pulse font-bold tracking-wider">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent" /> LIVE ЧАТ
                    </span>
                  ) : (
                    <NeonButton
                      variant="glass"
                      onClick={simulateIncomingClientMessage}
                      className="text-[10px] px-3.5 py-1.5 font-sans border-white/10 hover:border-accent/20 cursor-pointer text-slate-300"
                    >
                      📥 Симулировать вопрос
                    </NeonButton>
                  )}
                </div>
              </div>

              {/* Scrollable messages space */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {selectedCustomer.history.map((msg, index) => (
                  <div
                    key={index}
                    className={`flex ${msg.sender === 'customer' ? 'justify-start' : 'justify-end'}`}
                  >
                    <div
                      className={`max-w-[75%] rounded-xl p-4 text-xs ${
                        msg.sender === 'customer'
                          ? 'bg-white/5 border border-white/5 text-slate-100 rounded-tl-none font-light'
                          : 'bg-accent/10 border border-accent/20 text-white rounded-tr-none shadow-[0_2px_15px_rgba(245,166,35,0.03)]'
                      }`}
                    >
                      <div className="whitespace-pre-line leading-relaxed">{msg.text}</div>

                      {msg.sender === 'agent' && (
                        <div className="mt-3 pt-2.5 border-t border-accent/10 flex justify-between items-center text-[10px] text-accent font-light">
                          <span className="flex items-center gap-1.5">
                            <Shield className="h-3 w-3" /> {selectedCustomer.id.startsWith('tg_') ? 'Вы (Оператор)' : `Штаб: ${tone === 'friendly' ? 'Дружелюбный' : tone === 'strict' ? 'Строгий' : 'Профессиональный'}`}
                          </span>
                          <button
                            onClick={() => handleVoicePlayback(msg.text, index)}
                            disabled={audioLoadingMsgId === `${selectedCustomer.id}-${index}`}
                            className="flex items-center gap-1 hover:text-white cursor-pointer transition-all"
                            title="Озвучить"
                          >
                            {audioLoadingMsgId === `${selectedCustomer.id}-${index}` ? (
                              <span className="animate-pulse">Синтез...</span>
                            ) : (
                              <>
                                <Volume2 className="h-3 w-3 animate-pulse text-accent" /> Озвучить
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {loading && (
                  <div className="flex justify-end">
                    <div className="bg-accent/5 border border-accent/20 rounded-xl rounded-tr-none p-4 text-xs text-accent flex items-center gap-2">
                      <span className="flex gap-1">
                        <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </span>
                      <span className="text-[10px] tracking-wider uppercase font-bold">ИИ генерирует ответ...</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Input form */}
              <form onSubmit={handleSendMessage} className="p-4 border-t border-white/5 bg-black/20 flex gap-2">
                <input
                  type="text"
                  value={customMsg}
                  onChange={e => setCustomMsg(e.target.value)}
                  placeholder={selectedCustomer.id.startsWith('tg_')
                    ? "Напишите прямой ответ клиенту в Telegram от лица оператора..."
                    : "Напишите сообщение от лица клиента для проверки ответа..."
                  }
                  className="flex-1 bg-white/5 border border-white/5 rounded-xl px-4 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-accent focus:bg-white/10 transition-all font-light"
                />
                <NeonButton type="submit" variant="accent" className="px-5 py-3">
                  <Send className="h-4 w-4" />
                </NeonButton>
              </form>
            </div>
          ) : (
            <div className="premium-card rounded-2xl flex flex-col justify-center items-center text-center p-8 h-[520px]">
              <MessageSquare className="h-10 w-10 text-accent/30 mb-4" />
              <h4 className="text-sm font-bold text-white uppercase tracking-wide font-display">Выберите диалог</h4>
              <p className="text-xs text-slate-400 mt-1 max-w-xs font-light">
                Выберите мессенджер в боковом меню или нажмите кнопку «Симулировать вопрос» для старта переписки.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
