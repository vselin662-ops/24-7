import React, { useState, useEffect } from 'react';
import { SimulatedCustomer, Message } from '../types';
import { Send, MessageCircle, Globe, Mail, Volume2, MessageSquare, Shield } from 'lucide-react';
// @ts-ignore
import archGeos from '../assets/images/arch_geos_1785822482173.jpg';

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

  // Empty initial list of customers (fetched from server or created on demand)
  const [customers, setCustomers] = useState<SimulatedCustomer[]>([]);

  const channelsList = [
    { id: 'telegram', name: 'Telegram', icon: Send, color: '#229ED9' },
    { id: 'whatsapp', name: 'WhatsApp', icon: MessageCircle, color: '#25D366' },
    { id: 'vk', name: 'ВКонтакте', icon: Globe, color: '#0077FF' },
    { id: 'email', name: 'Почта', icon: Mail, color: '#888888' }
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

  // Use real Telegram chats if available and active, otherwise fallback to customer state
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

  const getInitial = (name?: string) => {
    if (!name) return 'К';
    const cleaned = name.trim().replace(/^@/, '');
    return cleaned ? cleaned.charAt(0).toUpperCase() : 'К';
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customMsg.trim() || !selectedCustomer) return;

    const userText = customMsg;
    setCustomMsg('');

    // CASE 1: Real-time Telegram operator response
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

    // CASE 2: Sandbox test
    const updatedHistory = [
      ...selectedCustomer.history,
      { sender: 'customer' as const, text: userText }
    ];

    updateCustomerHistory(selectedCustomer.id, updatedHistory);
    setLoading(true);

    try {
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
          {
            sender: 'agent' as const,
            text: data.response,
            mediaType: data.mediaType,
            mediaUrl: data.mediaUrl,
            codeDetails: data.codeDetails,
            isQuotaDegraded: data.isQuotaDegraded,
            audioBase64: data.audio
          }
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
    if (!selectedCustomer) return;
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
    let targetCustomer = selectedCustomer;
    if (!targetCustomer) {
      const newCust: SimulatedCustomer = {
        id: `sim_${Date.now()}`,
        name: 'Новый клиент',
        channel: activeChannel,
        avatar: 'Н',
        lastMessage: 'Здравствуйте! Подскажите стоимость и условия.',
        timestamp: 'Только что',
        history: [
          { sender: 'customer', text: 'Здравствуйте! Подскажите стоимость и условия.' }
        ]
      };
      setCustomers(prev => [newCust, ...prev]);
      setSelectedCustomerId(newCust.id);
      return;
    }

    const mockInquiries = [
      "Здравствуйте! Скажите, а вы делаете скидки для новых клиентов?",
      "У меня срочный вопрос! Можно ли связаться с руководством компании?",
      "Спасибо за подробный ответ, я готов сделать заказ. Пришлите ссылку на оплату.",
      "Каковы сроки выполнения типовых работ у вас?"
    ];

    const randomInquiry = mockInquiries[Math.floor(Math.random() * mockInquiries.length)];

    const updatedHistory = [
      ...targetCustomer.history,
      { sender: 'customer' as const, text: randomInquiry }
    ];

    updateCustomerHistory(targetCustomer.id, updatedHistory);
  };

  return (
    <div className="w-full bg-[#14100E]/50 backdrop-blur-xl border border-[#DCD6CD]/20 rounded-3xl p-6 md:p-8 space-y-8 animate-fade-in shadow-2xl">
      {/* GEOS Organic Image Banner */}
      <div className="relative w-full h-44 sm:h-52 overflow-hidden rounded-[36px_12px_36px_12px] border border-[#DCD6CD]/20 shadow-xl group">
        <img 
          src={archGeos} 
          alt="Архитектура и Каналы" 
          className="w-full h-full object-cover filter brightness-90 contrast-110 group-hover:scale-105 transition-transform duration-700" 
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#14100E] via-black/20 to-transparent" />
        <div className="absolute bottom-4 left-6 right-6 flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase tracking-[0.25em] text-[#C5A059] font-medium font-serif-geos block">
              МОДУЛЬ СВЯЗИ · 24/7
            </span>
            <h3 className="font-serif-geos text-xl md:text-2xl text-[#EAE6DF] font-light">
              Шлюз мгновенных коммуникаций
            </h3>
          </div>
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#1A1614]/80 backdrop-blur-md border border-[#DCD6CD]/20 text-xs text-[#DCD6CD]">
            <span className={`w-2 h-2 rounded-full ${isBotActive ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <span>{isBotActive ? 'Бот на связи' : 'Демо режим'}</span>
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#DCD6CD]/10">
        <div>
          <h2 className="text-2xl md:text-3xl font-serif-geos font-light text-[#EAE6DF] tracking-tight">Симулятор каналов продаж</h2>
          <p className="text-sm text-[#B0A79E] mt-1 font-light">
            Проверка ответов ИИ-помощника в мессенджерах, соцсетях и по почте.
          </p>
        </div>

        {/* Small Bot Connection Indicator */}
        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#1C1816]/70 border border-[#DCD6CD]/15 self-start md:self-auto">
          <span className={`w-2 h-2 rounded-full ${isBotActive ? 'bg-emerald-400' : 'bg-slate-500'}`} />
          <span className="text-xs text-[#B0A79E] font-normal">
            {isBotActive ? 'Бот на связи' : 'Бот не подключён'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar: Channels & Conversations */}
        <div className="lg:col-span-1 space-y-6">
          {/* Channels Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-white">Где общаемся с клиентами</h3>
            <div className="grid grid-cols-1 gap-2">
              {channelsList.map(ch => (
                <button
                  key={ch.id}
                  onClick={() => setActiveChannel(ch.id as any)}
                  className={`w-full flex items-center gap-3.5 p-3 rounded-xl border text-left transition-all duration-200 cursor-pointer ${
                    activeChannel === ch.id
                      ? 'border-[#C5A059] bg-[#C5A059]/15 text-[#EAE6DF] font-medium shadow-md'
                      : 'border-[#DCD6CD]/10 bg-[#1C1816]/60 text-[#B0A79E] hover:bg-[#231E1B] hover:border-[#DCD6CD]/20 shadow-sm'
                  }`}
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${ch.color}1F` }}
                  >
                    <ch.icon className="w-5 h-5" style={{ color: ch.color }} />
                  </div>
                  <span className="text-xs font-medium text-white truncate">{ch.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Dialogs Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-white">Переписки</h3>
            <div className="space-y-2 max-h-[320px] lg:max-h-none overflow-y-auto pr-1">
              {currentCustomers.length === 0 ? (
                <div className="text-center py-6 px-4 rounded-xl border border-white/5 bg-white/[0.01] text-slate-400 space-y-2">
                  <MessageSquare className="w-6 h-6 mx-auto text-slate-500 opacity-60" />
                  <p className="text-xs leading-relaxed font-light">
                    Пока нет переписок. Напишите боту в Telegram — диалог появится здесь.
                  </p>
                </div>
              ) : (
                currentCustomers.map(cust => (
                  <button
                    key={cust.id}
                    onClick={() => setSelectedCustomerId(cust.id)}
                    className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all duration-200 cursor-pointer ${
                      selectedCustomerId === cust.id
                        ? 'border-[#FF6B00] bg-[#FF6B00]/10 text-white shadow-[0_0_15px_rgba(255,107,0,0.1)]'
                        : 'border-white/5 bg-white/[0.02] text-slate-300 hover:bg-white/[0.05] hover:border-white/15 hover:-translate-y-0.5'
                    }`}
                  >
                    <div className="w-9 h-9 rounded-full bg-white/10 border border-white/10 flex items-center justify-center font-bold text-white text-xs shrink-0 mt-0.5">
                      {getInitial(cust.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center gap-1">
                        <span className="font-bold text-white truncate text-xs">{cust.name}</span>
                        <span className="text-slate-500 text-[10px] shrink-0">{cust.timestamp}</span>
                      </div>
                      <p className="truncate text-slate-400 mt-1 text-xs font-light">{cust.lastMessage}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Main Terminal Window */}
        <div className="lg:col-span-3">
          {selectedCustomer ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] backdrop-blur-md flex flex-col h-[540px] relative overflow-hidden font-sans">
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-white/10 bg-black/20">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/10 border border-white/10 flex items-center justify-center font-bold text-white text-sm shrink-0">
                    {getInitial(selectedCustomer.name)}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">{selectedCustomer.name}</h4>
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      <span className="font-normal text-[11px]">
                        {selectedCustomer.id.startsWith('tg_') ? 'Клиент в Telegram' : 'Бот отвечает сам'}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={simulateIncomingClientMessage}
                  className="bg-white/10 hover:bg-white/20 text-white text-xs font-medium py-2 px-4 rounded-xl border border-white/10 transition-all duration-200 cursor-pointer"
                >
                  Проверить ответ бота
                </button>
              </div>

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {selectedCustomer.history.map((msg, index) => (
                  <div
                    key={index}
                    className={`flex ${msg.sender === 'customer' ? 'justify-start' : 'justify-end'}`}
                  >
                    <div
                      className={`max-w-[75%] rounded-xl p-4 text-xs leading-relaxed ${
                        msg.sender === 'customer'
                          ? 'bg-white/5 border border-white/10 text-slate-100 rounded-tl-none font-light'
                          : 'bg-[#FF6B00]/10 border border-[#FF6B00]/20 text-white rounded-tr-none shadow-[0_2px_15px_rgba(255,107,0,0.05)]'
                      }`}
                    >
                      <div className="whitespace-pre-line">{msg.text}</div>

                      {/* Multimodal Image Rendering */}
                      {msg.mediaUrl && (
                        <div className="mt-3 overflow-hidden rounded-lg border border-white/20 shadow-lg">
                          <img 
                            src={msg.mediaUrl} 
                            alt="Сгенерированное изображение" 
                            className="w-full max-h-72 object-cover" 
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      )}

                      {/* Multimodal Code Block Rendering */}
                      {msg.codeDetails && (
                        <div className="mt-3 overflow-hidden rounded-lg border border-[#C5A059]/30 bg-[#0E0C0A] text-[#EAE6DF]">
                          <div className="flex items-center justify-between px-3 py-1.5 bg-[#1C1816] border-b border-[#C5A059]/20 text-[10px] text-[#C5A059] font-mono">
                            <span>📄 {msg.codeDetails.filename} ({msg.codeDetails.language})</span>
                            <button
                              onClick={() => navigator.clipboard.writeText(msg.codeDetails?.code || '')}
                              className="hover:text-white transition-colors cursor-pointer"
                            >
                              Скопировать
                            </button>
                          </div>
                          <pre className="p-3 text-[11px] font-mono overflow-x-auto leading-normal text-amber-200/90 whitespace-pre">
                            <code>{msg.codeDetails.code}</code>
                          </pre>
                        </div>
                      )}

                      {/* Quota degradation badge */}
                      {msg.isQuotaDegraded && (
                        <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] font-medium">
                          <span>⚡ Режим мягкой адаптации квоты API</span>
                        </div>
                      )}

                      {msg.sender === 'agent' && (
                        <div className="mt-3 pt-2 border-t border-white/10 flex justify-between items-center text-[10px] text-slate-400 font-light">
                          <span className="flex items-center gap-1">
                            <Shield className="h-3 w-3 text-[#FF6B00]" />
                            {selectedCustomer.id.startsWith('tg_') ? 'Вы (Оператор)' : 'Ответ бота'}
                          </span>
                          <button
                            onClick={() => handleVoicePlayback(msg.text, index)}
                            disabled={audioLoadingMsgId === `${selectedCustomer.id}-${index}`}
                            className="flex items-center gap-1 text-[#FF6B00] hover:text-white cursor-pointer transition-all"
                            title="Озвучить"
                          >
                            {audioLoadingMsgId === `${selectedCustomer.id}-${index}` ? (
                              <span className="animate-pulse">Синтез...</span>
                            ) : (
                              <>
                                <Volume2 className="h-3 w-3" /> Озвучить
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
                    <div className="bg-[#FF6B00]/10 border border-[#FF6B00]/20 rounded-xl rounded-tr-none p-4 text-xs text-[#FF6B00] flex items-center gap-2">
                      <span className="flex gap-1">
                        <span className="w-1.5 h-1.5 bg-[#FF6B00] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-[#FF6B00] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-[#FF6B00] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </span>
                      <span className="text-xs font-normal">Бот готовит ответ...</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Input Form */}
              <form onSubmit={handleSendMessage} className="p-4 border-t border-white/10 bg-black/30 flex gap-2">
                <input
                  type="text"
                  value={customMsg}
                  onChange={e => setCustomMsg(e.target.value)}
                  placeholder={selectedCustomer.id.startsWith('tg_')
                    ? "Напишите ответ клиенту..."
                    : "Напишите сообщение от лица клиента..."
                  }
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#FF6B00] transition-all font-light"
                />
                <button
                  type="submit"
                  className="bg-[#FF6B00] hover:bg-[#E05E00] text-white px-4 py-2.5 rounded-xl transition-all duration-200 cursor-pointer flex items-center justify-center shrink-0"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] backdrop-blur-md flex flex-col justify-center items-center text-center p-8 h-[540px]">
              <MessageSquare className="h-10 w-10 text-[#FF6B00]/40 mb-3" />
              <h4 className="text-base font-bold text-white mb-1">Переписка не выбрана</h4>
              <p className="text-xs text-slate-400 max-w-sm leading-relaxed mb-6 font-light">
                Пока нет переписок. Напишите боту в Telegram — диалог появится здесь, или нажмите кнопку ниже для проверки.
              </p>
              <button
                onClick={simulateIncomingClientMessage}
                className="bg-[#FF6B00] hover:bg-[#E05E00] text-white text-xs font-bold py-3 px-6 rounded-xl transition-all duration-200 cursor-pointer shadow-[0_4px_15px_rgba(255,107,0,0.2)]"
              >
                Проверить ответ бота
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

