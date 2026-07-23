import React, { useState, useEffect } from 'react';
import { GlassPanel } from './GlassPanel';
import { NeonButton } from './NeonButton';
import { 
  BookOpen, 
  Database, 
  UploadCloud, 
  FileText, 
  Trash2, 
  File, 
  Plus, 
  Search, 
  AlertCircle, 
  CheckCircle, 
  Loader2, 
  HelpCircle,
  Cpu
} from 'lucide-react';

interface KBDocument {
  id: string;
  name: string;
  type: 'file' | 'text';
  size: number;
  uploadedAt: string;
  chunkCount: number;
}

export function KnowledgeBasePanel() {
  // Stats
  const [stats, setStats] = useState({
    documentCount: 0,
    chunkCount: 0,
    documents: [] as KBDocument[]
  });

  // Manual text input state
  const [manualTitle, setManualTitle] = useState('');
  const [manualText, setManualText] = useState('');

  // Upload/Search states
  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Playground Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ text: string; docName: string; score: number }[]>([]);
  const [searching, setSearching] = useState(false);

  // Fetch KB stats
  const fetchKBStatus = async () => {
    try {
      const res = await fetch('/api/knowledge/status');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Failed to fetch knowledge base status', err);
    }
  };

  useEffect(() => {
    fetchKBStatus();
  }, []);

  // Show status notification
  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  // Manual upload handler
  const handleManualUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualText.trim()) return;

    setLoading(true);
    try {
      const res = await fetch('/api/knowledge/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: manualTitle.trim() ? `${manualTitle.trim()}.txt` : 'Ручной ввод.txt',
          textContent: manualText,
          type: 'text/plain'
        })
      });

      if (res.ok) {
        showNotification('success', 'Текст успешно проанализирован и добавлен в базу знаний!');
        setManualTitle('');
        setManualText('');
        fetchKBStatus();
      } else {
        const errData = await res.json();
        showNotification('error', errData.error || 'Ошибка при загрузке текста.');
      }
    } catch (err) {
      showNotification('error', 'Сетевая ошибка при загрузке.');
    } finally {
      setLoading(false);
    }
  };

  // File Upload parser (Base64 conversion)
  const processAndUploadFile = (file: File) => {
    const reader = new FileReader();
    setLoading(true);

    reader.onload = async (e) => {
      const result = e.target?.result as string;
      // Extract clean Base64 data
      const base64Content = result.split(',')[1];

      try {
        const res = await fetch('/api/knowledge/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: file.name,
            type: file.type,
            base64: base64Content
          })
        });

        if (res.ok) {
          showNotification('success', `Файл "${file.name}" успешно загружен, разбит на чанки и векторизован!`);
          fetchKBStatus();
        } else {
          const errData = await res.json();
          showNotification('error', errData.error || 'Ошибка обработки файла.');
        }
      } catch (err) {
        showNotification('error', 'Ошибка сети при передаче файла.');
      } finally {
        setLoading(false);
      }
    };

    reader.onerror = () => {
      showNotification('error', 'Ошибка чтения файла.');
      setLoading(false);
    };

    reader.readAsDataURL(file);
  };

  // Drag & drop handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const validTypes = [
        'application/pdf', 
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 
        'text/plain'
      ];
      const fileExt = file.name.split('.').pop()?.toLowerCase();

      if (validTypes.includes(file.type) || ['pdf', 'docx', 'txt'].includes(fileExt || '')) {
        processAndUploadFile(file);
      } else {
        showNotification('error', 'Поддерживаются только форматы PDF, DOCX и TXT.');
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processAndUploadFile(e.target.files[0]);
    }
  };

  // Delete document
  const handleDeleteDoc = async (docId: string) => {
    if (!confirm('Вы уверены, что хотите удалить этот документ из базы знаний? Все связанные векторные чанки будут стерты.')) {
      return;
    }

    try {
      const res = await fetch('/api/knowledge/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId })
      });

      if (res.ok) {
        showNotification('success', 'Документ успешно удален.');
        fetchKBStatus();
      } else {
        showNotification('error', 'Не удалось удалить документ.');
      }
    } catch (err) {
      showNotification('error', 'Ошибка связи с сервером.');
    }
  };

  // Playground Search (RAG simulator)
  const handlePlaygroundSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setSearching(true);
    try {
      // We will perform a simulated client RAG test request
      const res = await fetch('/api/agent-respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_role: 'receiver',
          user_message: searchQuery,
          context: 'Поиск по базе знаний в тестовом режиме',
          business_name: 'Тест',
          owner_name: 'Тест',
          industry: 'Тест',
          tone: 'friendly'
        })
      });

      if (res.ok) {
        const matchRes = await fetch(`/api/knowledge/status`);
        if (matchRes.ok) {
          const kbData = await matchRes.json();
          // Let's call the server embedding on the search query
          const embedRes = await fetch('/api/knowledge/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              textContent: searchQuery,
              name: 'query_temp.txt'
            })
          });
          
          if (embedRes.ok) {
            // Retrieve latest status including the query_temp and compare, then delete query_temp
            const embedData = await embedRes.json();
            const tempDocId = embedData.document.id;
            
            // Fetch updated KB
            const latestRes = await fetch('/api/knowledge/status');
            const latestKB = await latestRes.json();
            
            // Find query vector
            const queryChunk = latestKB.documents.find((d: any) => d.id === tempDocId);
            const queryVecObj = latestKB.chunks.find((c: any) => c.docId === tempDocId);
            
            if (queryVecObj && queryVecObj.embedding) {
              const queryVec = queryVecObj.embedding;
              // Calc cosine similarity
              const results = latestKB.chunks
                .filter((c: any) => c.docId !== tempDocId)
                .map((chunk: any) => {
                  let dotProduct = 0;
                  let normA = 0;
                  let normB = 0;
                  const vecA = queryVec;
                  const vecB = chunk.embedding;
                  const len = Math.min(vecA.length, vecB.length);
                  for (let i = 0; i < len; i++) {
                    dotProduct += vecA[i] * vecB[i];
                    normA += vecA[i] * vecA[i];
                    normB += vecB[i] * vecB[i];
                  }
                  const score = normA === 0 || normB === 0 ? 0 : dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
                  return {
                    text: chunk.text,
                    docName: chunk.docName,
                    score
                  };
                });
              
              results.sort((a: any, b: any) => b.score - a.score);
              setSearchResults(results.slice(0, 3));
            }
            
            // Delete temp doc
            await fetch('/api/knowledge/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ docId: tempDocId })
            });
            fetchKBStatus();
          }
        }
      }
    } catch (err) {
      console.error('Playground search error', err);
    } finally {
      setSearching(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-12 animate-fade-in py-6">
      {/* Notifications */}
      {notification && (
        <div className={`fixed bottom-6 right-6 z-50 p-4 rounded-xl flex items-center gap-3 shadow-2xl border backdrop-blur-md transition-all duration-300 animate-slide-in ${
          notification.type === 'success' 
            ? 'bg-emerald-950/90 border-emerald-500/30 text-emerald-200' 
            : 'bg-red-950/90 border-red-500/30 text-red-200'
        }`}>
          {notification.type === 'success' ? (
            <CheckCircle className="h-5 w-5 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
          )}
          <span className="text-xs font-semibold leading-relaxed font-sans">{notification.message}</span>
        </div>
      )}

      {/* Short Hero-Block Header */}
      <div className="relative text-left border-b border-white/[0.08] pb-6">
        <div className="absolute -top-12 left-0 text-8xl font-extrabold text-white/[0.03] select-none pointer-events-none font-display">
          06
        </div>
        <span className="text-[10px] tracking-[0.1em] text-[#F5A623]/70 block mb-2 uppercase">модуль знаний</span>
        <h2 className="text-3xl md:text-4xl font-lux font-light text-white leading-snug">База знаний и векторный поиск</h2>
        <p className="text-sm text-slate-400 mt-2 max-w-2xl font-light leading-relaxed">
          Загрузка и векторизация корпоративной информации. ИИ-агенты используют эти данные по технологии RAG для генерации точных ответов на вопросы клиентов.
        </p>
      </div>

      {/* Stats Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="premium-card p-6 rounded-2xl border border-white/8 flex items-center gap-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-20 h-20 bg-accent/5 rounded-full filter blur-xl" />
          <div className="p-3.5 bg-accent/10 rounded-xl text-accent">
            <BookOpen className="h-6 w-6" />
          </div>
          <div>
            <div className="text-slate-400 text-[10px] uppercase tracking-widest">Всего документов</div>
            <div className="text-3xl font-lux font-light text-white mt-1">{stats.documentCount}</div>
          </div>
        </div>

        <div className="premium-card p-6 rounded-2xl border border-white/8 flex items-center gap-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-500/5 rounded-full filter blur-xl" />
          <div className="p-3.5 bg-emerald-500/10 rounded-xl text-emerald-400">
            <Database className="h-6 w-6" />
          </div>
          <div>
            <div className="text-slate-400 text-[10px] uppercase tracking-widest">Векторных чанков</div>
            <div className="text-3xl font-lux font-light text-white mt-1">{stats.chunkCount}</div>
          </div>
        </div>

        <div className="premium-card p-6 rounded-2xl border border-white/8 flex items-center gap-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-20 h-20 bg-purple-500/5 rounded-full filter blur-xl" />
          <div className="p-3.5 bg-purple-500/10 rounded-xl text-purple-400">
            <Cpu className="h-6 w-6" />
          </div>
          <div>
            <div className="text-slate-400 text-[10px] uppercase tracking-widest">Движок RAG</div>
            <div className="text-sm font-bold text-purple-300 tracking-wider mt-2.5">text-embedding-004</div>
          </div>
        </div>
      </div>

      {/* Main Upload Area Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Drag & Drop Box */}
        <div className="lg:col-span-6">
          <div className="premium-card rounded-2xl p-6 flex flex-col justify-between h-full min-h-[340px]">
            <div>
              <h3 className="text-base font-bold text-white uppercase tracking-tight font-display flex items-center gap-2.5">
                <UploadCloud className="h-5 w-5 text-accent animate-pulse" />
                ЗАГРУЗИТЬ ФАЙЛЫ
              </h3>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed font-light">
                Загрузите инструкции, тарифные сетки, прайс-листы или регламенты. Поддерживаемые форматы: <strong className="text-white font-semibold">PDF, DOCX, TXT</strong>. Файлы автоматически парсятся на умные чанки и векторизуются.
              </p>
            </div>

            <div 
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              className={`mt-6 border border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center transition-all duration-300 ${
                dragActive 
                  ? 'border-accent bg-accent/5 scale-[0.99] shadow-[0_4px_20px_rgba(245,166,35,0.15)]' 
                  : 'border-white/10 hover:border-white/20 bg-black/30'
              }`}
            >
              {loading ? (
                <div className="space-y-4">
                  <Loader2 className="h-8 w-8 text-accent animate-spin mx-auto" />
                  <p className="text-[10px] text-accent tracking-wider uppercase font-bold animate-pulse">Анализ документа и генерация эмбеддингов...</p>
                </div>
              ) : (
                <>
                  <UploadCloud className="h-12 w-12 text-slate-500 mb-4 animate-pulse" />
                  <p className="text-xs text-slate-200 font-medium">Перетащите файл сюда или</p>
                  <label className="mt-3.5 inline-flex items-center justify-center px-4.5 py-2 bg-accent/10 border border-accent/30 hover:border-accent text-accent rounded-xl text-[10px] font-bold uppercase tracking-wider cursor-pointer hover:bg-accent/20 transition-all duration-300">
                    <span>Выберите на диске</span>
                    <input 
                      type="file" 
                      className="hidden" 
                      accept=".pdf,.docx,.txt"
                      onChange={handleFileChange}
                    />
                  </label>
                  <p className="text-[10px] text-slate-500 mt-4">Максимальный размер: 15 MB</p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right Manual Text Paste Area */}
        <div className="lg:col-span-6">
          <div className="premium-card rounded-2xl p-6 h-full flex flex-col justify-between min-h-[340px]">
            <div>
              <h3 className="text-base font-bold text-white uppercase tracking-tight font-display flex items-center gap-2.5">
                <FileText className="h-5 w-5 text-emerald-400" />
                ВВЕСТИ ДАННЫЕ ВРУЧНУЮ
              </h3>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed font-light">
                Вставьте прайс-лист, контакты, часы работы компании или ответы на частые вопросы напрямую в поле ниже для моментальной векторизации.
              </p>
            </div>

            <form onSubmit={handleManualUpload} className="mt-6 space-y-4">
              <div>
                <input 
                  type="text" 
                  placeholder="Название документа (например: Прайс-лист компании)"
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-accent focus:bg-black/60 transition-colors font-light"
                />
              </div>
              <div>
                <textarea 
                  placeholder="Вставьте сюда любой текст бизнес-справки..."
                  rows={4}
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-accent focus:bg-black/60 transition-colors resize-none font-sans font-light"
                  required
                />
              </div>
              <div className="flex justify-end">
                <NeonButton
                  type="submit"
                  variant="accent"
                  disabled={loading || !manualText.trim()}
                  className="text-[10px] font-bold tracking-wider uppercase px-5 py-3.5 flex items-center gap-2 shadow-[0_4px_15px_rgba(245,166,35,0.1)]"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      СОХРАНЕНИЕ...
                    </>
                  ) : (
                    <>
                      <Plus className="h-3.5 w-3.5" />
                      ВНЕДРИТЬ В БАЗУ ЗНАНИЙ
                    </>
                  )}
                </NeonButton>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* RAG Search Playground Panel */}
      {stats.chunkCount > 0 && (
        <div className="bg-accent/[0.02] border border-accent/20 rounded-2xl p-6">
          <h3 className="text-xs font-black text-accent font-display flex items-center gap-2.5 tracking-wider uppercase">
            <Search className="h-4.5 w-4.5" />
            🔍 ИНТЕРАКТИВНЫЙ ПОИСК В БАЗЕ ЗНАНИЙ (RAG PLAYGROUND)
          </h3>
          <p className="text-[11px] text-slate-400 mt-1.5 font-light">
            Протестируйте, какие фрагменты документов находит алгоритм векторного поиска в реальном времени. Введите любой вопрос клиента.
          </p>

          <form onSubmit={handlePlaygroundSearch} className="mt-4 flex gap-3">
            <input 
              type="text"
              placeholder="Какая стоимость услуг? Работаете ли вы в выходные?"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-accent focus:bg-black/70 transition-colors font-light"
              required
            />
            <NeonButton
              type="submit"
              variant="accent"
              disabled={searching || !searchQuery.trim()}
              className="text-[10px] tracking-wider uppercase font-bold px-6 shrink-0 h-auto"
            >
              {searching ? 'Поиск...' : 'Искать в чанках'}
            </NeonButton>
          </form>

          {searchResults.length > 0 && (
            <div className="mt-6 space-y-3">
              <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Найденные релевантные чанки:</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {searchResults.map((result, i) => (
                  <div 
                    key={i} 
                    className="p-4 bg-black/40 border border-white/5 rounded-2xl text-[11px] space-y-3 flex flex-col justify-between"
                  >
                    <p className="text-slate-300 leading-relaxed font-sans italic font-light">
                      "{result.text}"
                    </p>
                    <div className="flex justify-between items-center pt-3 border-t border-white/5 text-[9px]">
                      <span className="text-slate-500 truncate max-w-[120px] font-light">{result.docName}</span>
                      <span className={`px-2 py-0.5 rounded font-bold ${
                        result.score >= 0.5 
                          ? 'bg-emerald-500/10 text-emerald-400' 
                          : result.score >= 0.35 
                            ? 'bg-accent/10 text-accent' 
                            : 'bg-amber-500/10 text-amber-400'
                      }`}>
                        {(result.score * 100).toFixed(1)}% MATCH
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loaded Documents Table */}
      <div className="premium-card rounded-2xl p-6">
        <h3 className="text-base font-bold text-white uppercase tracking-tight font-display flex items-center gap-2.5">
          <Database className="h-5 w-5 text-accent" />
          РЕЕСТР ЗАГРУЖЕННЫХ ДОКУМЕНТОВ БИЗНЕСА
        </h3>

        {stats.documents.length === 0 ? (
          <div className="text-center py-12">
            <Database className="h-12 w-12 text-slate-700 mx-auto animate-pulse mb-4" />
            <p className="text-xs text-slate-400 font-light">База знаний пока пуста.</p>
            <p className="text-[11px] text-slate-500 mt-1.5 max-w-sm mx-auto font-light">
              Загрузите файлы компании или добавьте текст вручную, чтобы ИИ-агенты начали использовать ваши настоящие цены и регламенты при ответах клиентам.
            </p>
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/5 text-[10px] text-slate-500 uppercase tracking-widest pb-3">
                  <th className="py-3 font-bold">Документ</th>
                  <th className="py-3 font-bold">Тип</th>
                  <th className="py-3 font-bold">Размер</th>
                  <th className="py-3 font-bold">Векторные Чанки</th>
                  <th className="py-3 font-bold">Дата добавления</th>
                  <th className="py-3 font-bold text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {stats.documents.map((doc) => (
                  <tr key={doc.id} className="text-xs text-slate-300 hover:bg-white/[0.01] transition-colors">
                    <td className="py-4 flex items-center gap-2.5 font-bold text-white font-display">
                      <File className="h-4.5 w-4.5 text-accent shrink-0" />
                      <span className="truncate max-w-[180px] sm:max-w-xs">{doc.name}</span>
                    </td>
                    <td className="py-4">
                      <span className={`px-2 py-0.5 text-[10px] font-bold rounded ${
                        doc.type === 'text' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-accent/10 text-accent'
                      }`}>
                        {doc.type === 'text' ? 'Текст' : 'Файл'}
                      </span>
                    </td>
                    <td className="py-4 text-[11px] text-slate-400">{formatSize(doc.size)}</td>
                    <td className="py-4 text-[11px] text-slate-300">
                      <span className="text-white font-bold">{doc.chunkCount}</span> шт.
                    </td>
                    <td className="py-4 text-slate-400 text-[11px]">{doc.uploadedAt}</td>
                    <td className="py-4 text-right">
                      <button
                        onClick={() => handleDeleteDoc(doc.id)}
                        className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/5 rounded-xl transition-all inline-flex items-center cursor-pointer"
                        title="Удалить из базы знаний"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
