import React, { useState, useEffect } from 'react';
import { GlassPanel } from './GlassPanel';
import { NeonButton } from './NeonButton';
import { ShieldCheck, Activity, AlertTriangle, Zap, RefreshCw, Cpu, Server, CheckCircle2, Play, Flame, Gauge } from 'lucide-react';

interface MetricsData {
  telemetry: {
    totalRequests: number;
    successCount: number;
    failoverCount: number;
    consecutiveFailures: number;
    circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
    lastCircuitChange: string;
    avgLatencyMs: number;
    requestLogs: Array<{
      id: string;
      timestamp: string;
      prompt: string;
      latencyMs: number;
      provider: string;
      circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
      status: 'success' | 'failover' | 'error';
    }>;
  };
  nodes: Array<{
    name: string;
    role: string;
    status: string;
    pingMs: number;
  }>;
}

export const ResiliencyDashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [testPrompt, setTestPrompt] = useState('Проверь бронирование +79991234567 и найди вылет в Дубай');
  const [testResult, setTestResult] = useState<any>(null);
  const [executing, setExecuting] = useState(false);

  const fetchMetrics = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/enterprise/resiliency/metrics');
      if (res.ok) {
        const data = await res.json();
        setMetrics(data);
      }
    } catch (e) {
      // Silently ignore transient network errors
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleCircuitToggle = async (action: 'trip' | 'reset') => {
    try {
      await fetch('/api/enterprise/circuit-breaker/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      fetchMetrics();
    } catch (e) {
      console.error('Failed to toggle circuit breaker:', e);
    }
  };

  const handleTestExecution = async () => {
    setExecuting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/enterprise/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: testPrompt, channel: 'Resiliency Simulator' })
      });
      const data = await res.json();
      setTestResult(data);
      fetchMetrics();
    } catch (e: any) {
      setTestResult({ error: e.message || 'Ошибка обработки' });
    } finally {
      setExecuting(false);
    }
  };

  const circuitState = metrics?.telemetry.circuitState || 'CLOSED';
  const successRate = metrics?.telemetry.totalRequests
    ? Math.round((metrics.telemetry.successCount / metrics.telemetry.totalRequests) * 100)
    : 100;

  return (
    <div className="space-y-6">
      {/* Header Panel */}
      <GlassPanel className="p-6 border-emerald-500/30">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className={`p-3 rounded-xl border ${
              circuitState === 'CLOSED'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : circuitState === 'OPEN'
                ? 'bg-red-500/10 border-red-500/30 text-red-400 animate-pulse'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
            }`}>
              <ShieldCheck className="w-7 h-7" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                Circuit Breaker & Resilience Engine
                <span className={`text-xs px-2.5 py-1 rounded-full font-mono font-bold uppercase ${
                  circuitState === 'CLOSED'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : circuitState === 'OPEN'
                    ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                }`}>
                  State: {circuitState}
                </span>
              </h2>
              <p className="text-sm text-gray-400">
                Автоматический предохранитель отказоустойчивости и мониторинг нагрузок
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => handleCircuitToggle('trip')}
              className="text-xs bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-800/80 px-3 py-2 rounded-lg transition-colors flex items-center space-x-1"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Спровоцировать сбой (Trip)</span>
            </button>

            <button
              onClick={() => handleCircuitToggle('reset')}
              className="text-xs bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-800/80 px-3 py-2 rounded-lg transition-colors flex items-center space-x-1"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Восстановить (Reset)</span>
            </button>

            <button
              onClick={fetchMetrics}
              className="p-2 text-gray-400 hover:text-white bg-gray-800/60 rounded-lg border border-gray-700"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Vital Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div className="bg-gray-950/60 border border-gray-800 rounded-xl p-3">
            <div className="text-xs text-gray-400 mb-1 flex items-center gap-1">
              <Activity className="w-3.5 h-3.5 text-cyan-400" /> Total Requests
            </div>
            <div className="text-2xl font-bold font-mono text-white">
              {metrics?.telemetry.totalRequests || 0}
            </div>
          </div>

          <div className="bg-gray-950/60 border border-gray-800 rounded-xl p-3">
            <div className="text-xs text-gray-400 mb-1 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Success Rate
            </div>
            <div className="text-2xl font-bold font-mono text-emerald-400">
              {successRate}%
            </div>
          </div>

          <div className="bg-gray-950/60 border border-gray-800 rounded-xl p-3">
            <div className="text-xs text-gray-400 mb-1 flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 text-amber-400" /> Failover Activations
            </div>
            <div className="text-2xl font-bold font-mono text-amber-400">
              {metrics?.telemetry.failoverCount || 0}
            </div>
          </div>

          <div className="bg-gray-950/60 border border-gray-800 rounded-xl p-3">
            <div className="text-xs text-gray-400 mb-1 flex items-center gap-1">
              <Gauge className="w-3.5 h-3.5 text-indigo-400" /> Avg Latency
            </div>
            <div className="text-2xl font-bold font-mono text-indigo-300">
              {metrics?.telemetry.avgLatencyMs || 180} ms
            </div>
          </div>
        </div>
      </GlassPanel>

      {/* Nodes Health Status */}
      <GlassPanel className="p-6 border-cyan-500/30">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Server className="w-5 h-5 text-cyan-400" />
          Статус Инфраструктурных Узлов
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {metrics?.nodes.map((node, i) => (
            <div key={i} className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-white">{node.name}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-mono ${
                    node.status === 'HEALTHY'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-red-500/20 text-red-300 border border-red-500/30'
                  }`}>
                    {node.status}
                  </span>
                </div>
                <p className="text-xs text-gray-400">{node.role}</p>
              </div>

              <div className="mt-4 pt-3 border-t border-gray-800/80 flex items-center justify-between text-[11px] font-mono text-gray-400">
                <span>Latency</span>
                <span className="text-cyan-400">{node.pingMs} ms</span>
              </div>
            </div>
          ))}
        </div>
      </GlassPanel>

      {/* Interactive Failover & Resilience Simulator */}
      <GlassPanel className="p-6 border-indigo-500/30">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Zap className="w-5 h-5 text-indigo-400" />
          Симулятор Прохождения Запросов через Шлюз
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <label className="text-xs text-gray-300 font-medium block">
              Введите тестовый запрос:
            </label>
            <textarea
              value={testPrompt}
              onChange={(e) => setTestPrompt(e.target.value)}
              rows={4}
              className="w-full bg-gray-950/80 border border-gray-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500"
            />
            <NeonButton
              onClick={handleTestExecution}
              disabled={executing}
              className="w-full flex items-center justify-center space-x-2"
            >
              <Play className="w-4 h-4" />
              <span>{executing ? 'Обработка шлюзом...' : 'Отправить в Enterprise Gateway'}</span>
            </NeonButton>
          </div>

          <div className="space-y-3">
            <label className="text-xs text-gray-300 font-medium block">
              Ответ и метаданные исполнения:
            </label>
            <div className="w-full h-44 bg-gray-950/90 border border-gray-800 rounded-xl p-3 font-mono text-xs overflow-y-auto">
              {testResult ? (
                <pre className="text-indigo-300 whitespace-pre-wrap">
                  {JSON.stringify(testResult, null, 2)}
                </pre>
              ) : (
                <span className="text-gray-600 italic">Нажмите "Отправить" для вызова шлюза...</span>
              )}
            </div>
          </div>
        </div>
      </GlassPanel>

      {/* Live Stream Logs */}
      <GlassPanel className="p-6 border-gray-700/40">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Activity className="w-5 h-5 text-gray-300" />
          Живой Лог Запросов и Переключений (Telemetry Stream)
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400">
                <th className="pb-2">ID</th>
                <th className="pb-2">Время</th>
                <th className="pb-2">Промпт</th>
                <th className="pb-2">Провайдер</th>
                <th className="pb-2">Задержка</th>
                <th className="pb-2">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60">
              {metrics?.telemetry.requestLogs && metrics.telemetry.requestLogs.length > 0 ? (
                metrics.telemetry.requestLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-900/40">
                    <td className="py-2 text-gray-400">{log.id}</td>
                    <td className="py-2 text-gray-400">{new Date(log.timestamp).toLocaleTimeString()}</td>
                    <td className="py-2 text-white max-w-[200px] truncate">{log.prompt}</td>
                    <td className="py-2 text-indigo-300">{log.provider}</td>
                    <td className="py-2 text-cyan-400">{log.latencyMs} ms</td>
                    <td className="py-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] ${
                        log.status === 'success'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-amber-500/20 text-amber-300'
                      }`}>
                        {log.status}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-gray-600 italic">
                    Логи запросов пока отсутствуют. Отправьте запрос в симуляторе выше!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassPanel>
    </div>
  );
};
