import React, { useState, useEffect } from 'react';
import { GlassPanel } from './GlassPanel';
import { NeonButton } from './NeonButton';
import { Cpu, CheckCircle2, Play, Search, Send, Calendar, Phone, ShieldCheck, Zap, RefreshCw } from 'lucide-react';

interface MCPTool {
  name: string;
  description: string;
  category: string;
}

export const MCPToolsPanel: React.FC = () => {
  const [tools, setTools] = useState<MCPTool[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTool, setSelectedTool] = useState<string>('search_flights');
  const [argsInput, setArgsInput] = useState<string>('{\n  "origin": "Москва",\n  "destination": "Дубай",\n  "departureDate": "2026-08-15"\n}');
  const [executionResult, setExecutionResult] = useState<any>(null);
  const [executing, setExecuting] = useState(false);

  const DEFAULT_TOOLS: MCPTool[] = [
    { name: 'verify_client_booking', description: 'Проверка бронирования по телефону CRM', category: 'CRM' },
    { name: 'search_flights', description: 'Поиск авиабилетов и цен', category: 'Travel' },
    { name: 'send_messenger_notification', description: 'Отправка в Telegram/WhatsApp/SMS', category: 'Messaging' },
    { name: 'create_smart_task', description: 'Создание задачи в смарт-планере', category: 'Planner' }
  ];

  const fetchTools = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/mcp/tools');
      if (res.ok) {
        const data = await res.json();
        if (data.tools && Array.isArray(data.tools) && data.tools.length > 0) {
          setTools(data.tools);
          return;
        }
      }
      setTools(DEFAULT_TOOLS);
    } catch (e) {
      setTools(DEFAULT_TOOLS);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTools();
  }, []);

  const handleToolSelect = (toolName: string) => {
    setSelectedTool(toolName);
    setExecutionResult(null);
    if (toolName === 'search_flights') {
      setArgsInput(JSON.stringify({ origin: "Москва", destination: "Дубай", departureDate: "2026-08-15", maxPriceRub: 50000 }, null, 2));
    } else if (toolName === 'verify_client_booking') {
      setArgsInput(JSON.stringify({ clientPhone: "+79991234567" }, null, 2));
    } else if (toolName === 'send_messenger_notification') {
      setArgsInput(JSON.stringify({ recipient: "+79991234567", messenger: "telegram", messageText: "Ваше бронирование подтверждено!" }, null, 2));
    } else if (toolName === 'create_smart_task') {
      setArgsInput(JSON.stringify({ title: "Поездка в Дубай", date: "2026-08-15 09:00", category: "travel", priority: "high" }, null, 2));
    }
  };

  const handleExecute = async () => {
    setExecuting(true);
    setExecutionResult(null);
    try {
      let parsedArgs = {};
      try {
        parsedArgs = JSON.parse(argsInput);
      } catch {
        alert('Некорректный JSON в параметрах');
        setExecuting(false);
        return;
      }

      const res = await fetch('/api/mcp/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: selectedTool, args: parsedArgs })
      });
      const data = await res.json();
      setExecutionResult(data);
    } catch (e: any) {
      setExecutionResult({ error: e.message || 'Ошибка выполнения MCP инструмента' });
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="space-y-6">
      <GlassPanel className="p-6 border-cyan-500/30">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-cyan-500/10 rounded-xl border border-cyan-500/20 text-cyan-400">
              <Cpu className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                Model Context Protocol (MCP) Server HQ
                <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-mono">
                  v2.2.0 Active
                </span>
              </h2>
              <p className="text-sm text-gray-400">
                Защищенный шлюз выполнения внешних функций и автономных инструментов
              </p>
            </div>
          </div>
          <button
            onClick={fetchTools}
            className="flex items-center space-x-2 text-xs bg-gray-800/80 hover:bg-gray-700 text-gray-300 px-3 py-2 rounded-lg border border-gray-700"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Обновить реестр</span>
          </button>
        </div>

        {/* Registered Tools Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4">
          {tools.map((t) => (
            <div
              key={t.name}
              onClick={() => handleToolSelect(t.name)}
              className={`p-3 rounded-xl border cursor-pointer transition-all ${
                selectedTool === t.name
                  ? 'bg-cyan-950/40 border-cyan-400 text-cyan-300 shadow-lg shadow-cyan-500/10'
                  : 'bg-gray-900/50 border-gray-800 text-gray-400 hover:border-gray-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-mono font-semibold truncate text-white">{t.name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 uppercase">
                  {t.category}
                </span>
              </div>
              <p className="text-[11px] text-gray-400 line-clamp-2">{t.description}</p>
            </div>
          ))}
        </div>
      </GlassPanel>

      {/* Tool Tester Interface */}
      <GlassPanel className="p-6 border-indigo-500/30">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Zap className="w-5 h-5 text-indigo-400" />
          Тестирование MCP Инструмента: <span className="text-indigo-300 font-mono">{selectedTool}</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <label className="text-xs text-gray-300 font-medium block">
              Входные параметры (JSON Schema / Zod Validated):
            </label>
            <textarea
              value={argsInput}
              onChange={(e) => setArgsInput(e.target.value)}
              rows={8}
              className="w-full bg-gray-950/80 border border-gray-800 rounded-xl p-3 font-mono text-xs text-green-400 focus:outline-none focus:border-indigo-500"
            />
            <NeonButton
              onClick={handleExecute}
              disabled={executing}
              className="w-full flex items-center justify-center space-x-2"
            >
              <Play className="w-4 h-4" />
              <span>{executing ? 'Выполнение в MCP...' : 'Запустить MCP Tool'}</span>
            </NeonButton>
          </div>

          <div className="space-y-3">
            <label className="text-xs text-gray-300 font-medium block">
              Результат выполнения (Structured JSON Response):
            </label>
            <div className="w-full h-56 bg-gray-950/90 border border-gray-800 rounded-xl p-3 font-mono text-xs overflow-y-auto">
              {executionResult ? (
                <pre className="text-cyan-300 whitespace-pre-wrap">
                  {JSON.stringify(executionResult, null, 2)}
                </pre>
              ) : (
                <span className="text-gray-600 italic">Нажмите "Запустить MCP Tool" для получения вывода...</span>
              )}
            </div>
          </div>
        </div>
      </GlassPanel>
    </div>
  );
};
