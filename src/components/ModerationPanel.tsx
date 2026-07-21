import React, { useState, useEffect } from 'react';
import { GlassPanel } from './GlassPanel';
import { NeonButton } from './NeonButton';
import { ModerationItem, ModerationLogEntry } from '../types';
import { 
  Shield, 
  Check, 
  X, 
  Edit3, 
  Clock, 
  User, 
  MessageSquare, 
  History, 
  AlertCircle, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  Sparkles, 
  ArrowRight,
  Send
} from 'lucide-react';

export const ModerationPanel: React.FC = () => {
  const [queue, setQueue] = useState<ModerationItem[]>([]);
  const [log, setLog] = useState<ModerationLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  
  // Keep editable response copies for items in the queue
  const [editableResponses, setEditableResponses] = useState<Record<string, string>>({});

  const fetchModerationData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/moderation/queue');
      if (res.ok) {
        const data = await res.json();
        setQueue(data.queue || []);
        setLog(data.log || []);
        
        // Initialize textareas for any new items
        setEditableResponses(prev => {
          const updated = { ...prev };
          (data.queue || []).forEach((item: ModerationItem) => {
            if (updated[item.id] === undefined) {
              updated[item.id] = item.proposedResponse;
            }
          });
          return updated;
        });
      }
    } catch (err) {
      console.error('Error fetching moderation data:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchModerationData();
    const interval = setInterval(() => fetchModerationData(true), 4000);
    return () => clearInterval(interval);
  }, []);

  const handleAction = async (itemId: string, action: 'approve' | 'edit' | 'reject') => {
    setSubmittingId(itemId);
    const correctedText = editableResponses[itemId];

    try {
      const res = await fetch('/api/moderation/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId,
          action,
          correctedText: action === 'edit' ? correctedText : undefined
        })
      });

      if (res.ok) {
        // Optimistic update
        setQueue(prev => prev.filter(item => item.id !== itemId));
        // Refetch to sync history
        fetchModerationData(true);
      } else {
        alert('Не удалось выполнить действие модерации. Попробуйте еще раз.');
      }
    } catch (err) {
      console.error('Moderation action failed:', err);
    } finally {
      setSubmittingId(null);
    }
  };

  const getChannelBadgeColor = (channel: string) => {
    switch (channel) {
      case 'telegram': return 'bg-[#229ED9]/10 border-[#229ED9]/20 text-[#229ED9]';
      case 'whatsapp': return 'bg-[#25D366]/10 border-[#25D366]/20 text-[#25D366]';
      case 'vk': return 'bg-[#4C75A3]/10 border-[#4C75A3]/20 text-[#4C75A3]';
      case 'email': return 'bg-[#F5A623]/10 border-[#F5A623]/20 text-[#F5A623]';
      default: return 'bg-white/5 border-white/10 text-slate-400';
    }
  };

  const getChannelName = (channel: string) => {
    switch (channel) {
      case 'telegram': return 'Telegram';
      case 'whatsapp': return 'WhatsApp';
      case 'vk': return 'ВКонтакте';
      case 'email': return 'Email';
      default: return channel;
    }
  };

  const getAgentRoleName = (role: string) => {
    switch (role) {
      case 'receiver': return 'ИИ-Приемщик';
      case 'sales': return 'ИИ-Продавец';
      case 'content': return 'ИИ-Контент';
      case 'analyst': return 'ИИ-Аналитик';
      case 'operator': return 'ИИ-Шеф';
      default: return role;
    }
  };

  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <div className="space-y-6">
      {/* Overview Block */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="font-sans font-bold text-xl md:text-2xl text-white select-none flex items-center gap-2">
            <Shield className="h-5 w-5 text-[#F5A623]" />
            Ручная модерация ответов
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Режим контроля позволяет просматривать, изменять и утверждать сообщения цифровых агентов перед их отправкой клиентам.
          </p>
        </div>
        <div className="bg-[#F5A623]/10 border border-[#F5A623]/20 rounded-xl px-4 py-2.5 flex items-center gap-3">
          <Clock className="h-4 w-4 text-[#F5A623] animate-pulse" />
          <div className="text-right">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Ожидают проверки</div>
            <div className="text-sm font-bold text-white">{queue.length} шт.</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Moderation Queue List */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider font-sans select-none flex items-center gap-2">
            <span>Очередь сообщений</span>
            <span className="bg-[#F5A623] text-black text-xs font-bold px-2 py-0.5 rounded-full leading-none">
              {queue.length}
            </span>
          </h3>

          {loading ? (
            <div className="premium-card p-10 text-center text-slate-400">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#F5A623] mx-auto mb-4" />
              <span>Загрузка очереди модерации...</span>
            </div>
          ) : queue.length === 0 ? (
            <div className="premium-card p-10 text-center text-slate-400 flex flex-col items-center justify-center border border-white/5 bg-black/20 rounded-2xl">
              <CheckCircle2 className="h-10 w-10 text-emerald-500 mb-3" />
              <h4 className="text-sm font-bold text-white mb-1">Все чисто!</h4>
              <p className="text-xs max-w-sm">
                В очереди нет ожидающих сообщений. Все ответы отправляются клиентам автоматически или штаб ожидает новые обращения.
              </p>
            </div>
          ) : (
            queue.map((item) => (
              <GlassPanel key={item.id} className="p-5 border border-white/10 hover:border-white/15 transition-all duration-300">
                {/* Header info */}
                <div className="flex flex-wrap justify-between items-center gap-3 border-b border-white/5 pb-3.5 mb-4">
                  <div className="flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-full bg-[#F5A623]/10 flex items-center justify-center text-xs font-bold text-white">
                      {item.clientName ? item.clientName.charAt(0) : 'K'}
                    </span>
                    <div>
                      <div className="text-xs font-bold text-white">{item.clientName || 'Клиент'}</div>
                      <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                        <span className={`px-1.5 py-0.5 rounded text-[8px] uppercase font-bold border ${getChannelBadgeColor(item.channel)}`}>
                          {getChannelName(item.channel)}
                        </span>
                        <span>·</span>
                        <span>{formatTime(item.timestamp)}</span>
                      </div>
                    </div>
                  </div>

                  <span className="bg-white/5 border border-white/10 text-slate-300 text-[10px] font-semibold px-2.5 py-1 rounded-full uppercase">
                    Агент: <span className="text-[#F5A623]">{getAgentRoleName(item.agentRole)}</span>
                  </span>
                </div>

                {/* Main conversation block */}
                <div className="space-y-4">
                  {/* Customer Question */}
                  <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3">
                    <div className="text-[10px] text-[#F5A623] uppercase tracking-wider font-bold mb-1 flex items-center gap-1.5">
                      <User className="h-3 w-3" />
                      Запрос от клиента:
                    </div>
                    <p className="text-xs text-slate-200 font-light leading-relaxed">
                      {item.userMessage}
                    </p>
                  </div>

                  {/* Proposed Response editable textbox */}
                  <div>
                    <div className="text-[10px] text-emerald-400 uppercase tracking-wider font-bold mb-1.5 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <MessageSquare className="h-3 w-3" />
                        Предложенный ответ ИИ-агента:
                      </span>
                      <span className="text-slate-500 text-[9px] font-normal lowercase">можно отредактировать перед отправкой</span>
                    </div>

                    <textarea
                      value={editableResponses[item.id] || ''}
                      onChange={(e) => setEditableResponses({ ...editableResponses, [item.id]: e.target.value })}
                      className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#F5A623] focus:bg-black/80 transition-all font-light leading-relaxed min-h-[100px]"
                      placeholder="Напишите или отредактируйте ответ..."
                    />
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                    <button
                      onClick={() => handleAction(item.id, 'reject')}
                      disabled={submittingId !== null}
                      className="px-4 py-2.5 rounded-xl border border-rose-500/30 hover:border-rose-500 bg-rose-950/15 hover:bg-rose-950/30 text-rose-400 text-xs font-semibold cursor-pointer transition-all flex items-center gap-2"
                    >
                      <X className="h-4 w-4" />
                      <span>Отклонить</span>
                    </button>

                    {editableResponses[item.id] !== item.proposedResponse ? (
                      <button
                        onClick={() => handleAction(item.id, 'edit')}
                        disabled={submittingId !== null}
                        className="px-5 py-2.5 rounded-xl border border-[#F5A623] bg-[#F5A623]/10 hover:bg-[#F5A623]/25 text-[#F5A623] text-xs font-semibold cursor-pointer transition-all flex items-center gap-2 shadow-[0_0_15px_rgba(245,166,35,0.1)]"
                      >
                        <Edit3 className="h-4 w-4" />
                        <span>Изменить и Отправить</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleAction(item.id, 'approve')}
                        disabled={submittingId !== null}
                        className="px-5 py-2.5 rounded-xl border border-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/25 text-emerald-400 text-xs font-semibold cursor-pointer transition-all flex items-center gap-2"
                      >
                        <Check className="h-4 w-4" />
                        <span>Одобрить и Отправить</span>
                      </button>
                    )}
                  </div>
                </div>
              </GlassPanel>
            ))
          )}
        </div>

        {/* History Log Column */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider font-sans select-none flex items-center gap-2">
            <History className="h-4 w-4 text-slate-400" />
            <span>История решений</span>
          </h3>

          <GlassPanel className="p-4 border border-white/5 bg-black/10 rounded-2xl max-h-[600px] overflow-y-auto space-y-3.5 scrollbar-thin scrollbar-thumb-white/10">
            {log.length === 0 ? (
              <div className="text-center py-10 text-xs text-slate-500">
                <AlertCircle className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                <span>История пуста</span>
              </div>
            ) : (
              log.map((entry) => (
                <div key={entry.id} className="border-b border-white/5 pb-3 last:border-0 last:pb-0 text-xs">
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="font-bold text-slate-200 truncate max-w-[120px]">{entry.clientName}</span>
                    <span className="text-[9px] text-slate-500">{formatTime(entry.timestamp)}</span>
                  </div>

                  {/* Badges */}
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    <span className={`px-1.5 py-0.5 rounded-[4px] text-[8px] uppercase font-bold border ${getChannelBadgeColor(entry.channel)}`}>
                      {getChannelName(entry.channel)}
                    </span>

                    {entry.action === 'approve' && (
                      <span className="px-1.5 py-0.5 rounded-[4px] text-[8px] uppercase font-bold border border-emerald-500/20 bg-emerald-950/20 text-emerald-400 flex items-center gap-1">
                        <Check className="h-2 w-2" /> Одобрено
                      </span>
                    )}

                    {entry.action === 'edit' && (
                      <span className="px-1.5 py-0.5 rounded-[4px] text-[8px] uppercase font-bold border border-[#F5A623]/20 bg-[#F5A623]/10 text-[#F5A623] flex items-center gap-1">
                        <Edit3 className="h-2 w-2" /> Изменено
                      </span>
                    )}

                    {entry.action === 'reject' && (
                      <span className="px-1.5 py-0.5 rounded-[4px] text-[8px] uppercase font-bold border border-rose-500/20 bg-rose-950/20 text-rose-400 flex items-center gap-1">
                        <X className="h-2 w-2" /> Отклонено
                      </span>
                    )}
                  </div>

                  {/* Messages snippet */}
                  <div className="bg-black/30 border border-white/5 rounded-lg p-2 space-y-1.5">
                    <div>
                      <span className="text-[9px] text-slate-500 uppercase block font-semibold">Клиент:</span>
                      <p className="text-[11px] text-slate-300 line-clamp-2">{entry.userMessage}</p>
                    </div>
                    {entry.finalResponse ? (
                      <div>
                        <span className="text-[9px] text-emerald-400/80 uppercase block font-semibold">Ответ:</span>
                        <p className="text-[11px] text-slate-400 line-clamp-3 leading-relaxed">{entry.finalResponse}</p>
                      </div>
                    ) : (
                      <p className="text-[10px] text-rose-400 italic">Ответ не был отправлен клиенту</p>
                    )}
                  </div>
                </div>
              ))
            )}
          </GlassPanel>
        </div>
      </div>
    </div>
  );
};
