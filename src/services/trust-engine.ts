import { logger } from "../logger";

interface TrustSession {
  score: number;
  lastActive: number;
  restrictedMode: boolean;
}

const trustStore = new Map<string, TrustSession>();
const ONE_DAY = 24 * 60 * 60 * 1000;

export function getTrustSession(tenantId: string): TrustSession {
  const now = Date.now();
  const session = trustStore.get(tenantId);

  if (!session || now - session.lastActive > ONE_DAY) {
    const newSession: TrustSession = {
      score: 100,
      lastActive: now,
      restrictedMode: false,
    };
    trustStore.set(tenantId, newSession);
    return newSession;
  }

  session.lastActive = now;
  return session;
}

export function deductTrustScore(tenantId: string, penalty: number, reason: string): TrustSession {
  const session = getTrustSession(tenantId);
  session.score = Math.max(0, session.score - penalty);
  
  if (session.score < 30) {
    session.restrictedMode = true;
    logger.warn(`⚠️ User ${tenantId} trust score dropped to ${session.score}. Entering RESTRICTED MODE. Reason: ${reason}`);
  } else {
    logger.info(`Deducted ${penalty} trust points for ${tenantId}. Current score: ${session.score}. Reason: ${reason}`);
  }

  trustStore.set(tenantId, session);
  return session;
}

export function recordNormalRequest(tenantId: string): TrustSession {
  const session = getTrustSession(tenantId);
  if (session.score < 100) {
    session.score = Math.min(100, session.score + 5);
    if (session.score >= 30 && session.restrictedMode) {
      session.restrictedMode = false;
      logger.info(`✅ User ${tenantId} restored trust score to ${session.score}. Exited RESTRICTED MODE.`);
    }
  }
  trustStore.set(tenantId, session);
  return session;
}

export function isRestrictedMode(tenantId: string): boolean {
  return getTrustSession(tenantId).restrictedMode;
}
