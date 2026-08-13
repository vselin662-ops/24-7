import { logger } from "../logger";
import { deductTrustScore, isRestrictedMode } from "./trust-engine";

interface RequestMetrics {
  toolCallsCount: number;
  tokensUsed: number;
  unauthorizedAccessAttempted: boolean;
}

interface UserRateTracker {
  requestTimes: number[];
  anomalyScore: number;
}

const userTrackers = new Map<string, UserRateTracker>();

export function trackAgentMetrics(tenantId: string, metrics: RequestMetrics): { anomalyDetected: boolean; reason?: string } {
  let anomalyDetected = false;
  let reason = "";

  // 1. Tool Call Limit
  if (metrics.toolCallsCount > 5) {
    anomalyDetected = true;
    reason = `Excessive tool calls in single request: ${metrics.toolCallsCount} > max 5`;
    logger.warn(`⚠️ Agent Monitor Blast Radius Exceeded: ${reason} (Tenant: ${tenantId})`);
  }

  // 2. Token Limit Check
  if (metrics.tokensUsed > 10000) {
    anomalyDetected = true;
    reason = `Excessive token usage: ${metrics.tokensUsed} > max 10000`;
    logger.warn(`⚠️ Agent Monitor Token Spike: ${reason} (Tenant: ${tenantId})`);
  }

  // 3. Unauthorized Cross-Tenant Access
  if (metrics.unauthorizedAccessAttempted) {
    anomalyDetected = true;
    reason = "Unauthorized cross-tenant data access attempt detected!";
    logger.error(`🚨 CRITICAL: ${reason} (Tenant: ${tenantId})`);
  }

  if (anomalyDetected) {
    deductTrustScore(tenantId, 25, reason);
  }

  return { anomalyDetected, reason };
}

export function trackUserRateAndAnomalies(tenantId: string): { isAnomaly: boolean; ratePerMin: number } {
  const now = Date.now();
  let tracker = userTrackers.get(tenantId);

  if (!tracker) {
    tracker = { requestTimes: [], anomalyScore: 0 };
    userTrackers.set(tenantId, tracker);
  }

  // Filter out timestamps older than 60 seconds
  tracker.requestTimes = tracker.requestTimes.filter(t => now - t < 60000);
  tracker.requestTimes.push(now);

  const ratePerMin = tracker.requestTimes.length;

  // Rate spike anomaly check (>25 requests in 1 min)
  if (ratePerMin > 25) {
    logger.warn(`🚨 Rate Spike Anomaly Detected for ${tenantId}: ${ratePerMin} req/min`);
    deductTrustScore(tenantId, 30, "RATE_SPIKE_ANOMALY");
    return { isAnomaly: true, ratePerMin };
  }

  return { isAnomaly: false, ratePerMin };
}

export function shouldDowngradeToSafeMode(tenantId: string): boolean {
  return isRestrictedMode(tenantId);
}
