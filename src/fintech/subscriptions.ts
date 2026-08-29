import { sqliteDb } from "../../db";
import { logger } from "../logger";

export const PLANS: Record<string, { name: string; price: number; days: number }> = {
  month: { name: 'Месяц', price: 199, days: 30 },
  year: { name: 'Год', price: 1800, days: 365 },
  svet: { name: 'Месяц', price: 199, days: 30 },
  plan: { name: 'Месяц', price: 199, days: 30 }
};

// SQLite таблица subscriptions
try {
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      chat_id TEXT PRIMARY KEY,
      plan TEXT,
      paid_until TEXT,
      active INTEGER
    );
  `);
} catch (e) {
  logger.warn('⚠️ [Fintech] Subscriptions table initialization note:', e);
}

export interface Subscription {
  chat_id: string;
  plan: string;
  paid_until: string;
  active: number;
}

export function getSubscription(chatId: string | number): Subscription | null {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  try {
    const row = sqliteDb.prepare("SELECT * FROM subscriptions WHERE chat_id = ?").get(cleanId);
    return row || null;
  } catch (e) {
    try {
      const row = sqliteDb.prepare("SELECT * FROM subscriptions WHERE chatId = ?").get(cleanId);
      return row || null;
    } catch (err) {
      return null;
    }
  }
}

export function activateSubscription(chatId: string | number, plan: string = 'plan', days: number = 30): Subscription {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  const normalizedPlan = (plan || 'plan').toLowerCase().trim();
  const planKey = PLANS[normalizedPlan] ? normalizedPlan : (normalizedPlan.includes('prem') ? 'premium' : 'plan');
  const paidUntilDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const paidUntil = paidUntilDate.toISOString();

  try {
    sqliteDb.prepare(`
      INSERT OR REPLACE INTO subscriptions (chat_id, plan, paid_until, active)
      VALUES (?, ?, ?, 1)
    `).run(cleanId, planKey, paidUntil);
  } catch (e) {
    try {
      sqliteDb.prepare(`
        INSERT INTO subscriptions (chat_id, plan, paid_until, active)
        VALUES (?, ?, ?, 1)
      `).run(cleanId, planKey, paidUntil);
    } catch (err) {
      logger.error('❌ [Fintech] Error activating subscription:', err);
    }
  }

  // Duplicate to Redis
  import("../services/RedisService").then(({ redisService }) => {
    if (redisService.isAvailable()) {
      const subData = { chat_id: cleanId, plan: planKey, paid_until: paidUntil, active: 1 };
      redisService.set(`sub:${cleanId}`, JSON.stringify(subData)).then(() => {
        if (redisService['client']) {
          redisService['client'].sadd('selin:subscriptions_set', cleanId).catch(() => {});
        }
      }).catch(() => {});
    }
  }).catch((rErr) => {
    logger.warn('⚠️ [Fintech] Redis subscription duplication failed:', rErr);
  });

  logger.info(`💳 [Fintech] Подписка активирована: chat_id=${cleanId}, тариф=${planKey}, до=${paidUntil}`);
  return {
    chat_id: cleanId,
    plan: planKey,
    paid_until: paidUntil,
    active: 1
  };
}

export function isFeatureAllowed(chatId: string | number): boolean {
  const sub = getSubscription(chatId);
  if (!sub) return false;
  if (Number(sub.active) !== 1) return false;
  if (!sub.paid_until) return false;

  const paidUntilMs = new Date(sub.paid_until).getTime();
  if (isNaN(paidUntilMs)) return false;

  return paidUntilMs > Date.now();
}

export function isOwner(chatId: string | number): boolean {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '').trim();
  const ownerIds = [
    process.env.OWNER_CHAT_ID,
    process.env.ADMIN_USER_ID,
    process.env.ADMIN_CHAT_ID
  ].filter(Boolean).map(id => String(id).replace(/^[a-z_]+/, '').trim());
  return ownerIds.length > 0 && ownerIds.includes(cleanId);
}

export function checkAccess(chatId: string | number): boolean {
  if (isOwner(chatId)) return true;
  return isFeatureAllowed(chatId);
}

