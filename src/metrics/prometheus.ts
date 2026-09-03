import client from "prom-client";
import { logger } from "../logger";

// Create a custom registry
const register = new client.Registry();

// Enable standard system/process metrics (CPU, Memory, etc.)
client.collectDefaultMetrics({ register });

// 1. selin_llm_requests_total{provider, status} — счётчик запросов к LLM
export const llmRequestsTotal = new client.Counter({
  name: "selin_llm_requests_total",
  help: "Total count of LLM requests with provider and status labels",
  labelNames: ["provider", "status"],
  registers: [register]
});

// 2. selin_llm_latency_seconds{provider} — гистограмма задержек
export const llmLatencySeconds = new client.Histogram({
  name: "selin_llm_latency_seconds",
  help: "Latency of LLM requests in seconds",
  labelNames: ["provider"],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 15, 30],
  registers: [register]
});

// 3. selin_tts_requests_total{engine} — счётчик TTS-запросов
export const ttsRequestsTotal = new client.Counter({
  name: "selin_tts_requests_total",
  help: "Total count of TTS requests",
  labelNames: ["engine"],
  registers: [register]
});

// 4. selin_active_users — количество активных пользователей за последний час
export const activeUsersGauge = new client.Gauge({
  name: "selin_active_users",
  help: "Number of active users in the last hour",
  registers: [register]
});

// 5. selin_memory_usage_bytes — потребление RAM
export const memoryUsageBytes = new client.Gauge({
  name: "selin_memory_usage_bytes",
  help: "Memory usage of the process in bytes",
  registers: [register]
});

// 6. selin_prompt_variant_selected{experiment, variant} — выбор варианта промпта для A/B тестирования
export const promptVariantSelected = new client.Counter({
  name: "selin_prompt_variant_selected",
  help: "Counter of selected prompt variants for A/B testing",
  labelNames: ["experiment", "variant"],
  registers: [register]
});

// Helper function to update system metrics before scraping
export async function getPrometheusMetrics(): Promise<string> {
  try {
    // A. Update memory usage
    const mem = process.memoryUsage();
    memoryUsageBytes.set(mem.heapUsed);

    // B. Query database for active users (last 1 hour)
    try {
      const { sqliteDb } = await import("../../db");
      if (sqliteDb) {
        // Compute last active cutoff (1 hour ago in ISO/UTC form or local)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const row = sqliteDb.prepare("SELECT COUNT(DISTINCT chat_id) as active_count FROM user_sessions WHERE last_active >= ?").get(oneHourAgo);
        if (row) {
          activeUsersGauge.set(row.active_count || 0);
        }
      }
    } catch (dbErr) {
      // Fallback if sqliteDb or table is not ready yet
    }
  } catch (err: any) {
    logger.error("❌ [Metrics] Error gathering metrics:", err);
  }

  return await register.metrics();
}

export function getPrometheusContentType(): string {
  return register.contentType;
}
