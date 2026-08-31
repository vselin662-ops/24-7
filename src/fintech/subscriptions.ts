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

    CREATE TABLE IF NOT EXISTS reminder_sent_logs (
      chat_id TEXT NOT NULL,
      reminder_type TEXT NOT NULL,
      date_str TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (chat_id, reminder_type, date_str)
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

export function markReminderSent(chatId: string, reminderType: string, dateStr: string): boolean {
  if (!sqliteDb) return true;
  try {
    const exists = sqliteDb.prepare("SELECT 1 FROM reminder_sent_logs WHERE chat_id = ? AND reminder_type = ? AND date_str = ?")
      .get(chatId, reminderType, dateStr);
    if (exists) return false;

    sqliteDb.prepare("INSERT OR REPLACE INTO reminder_sent_logs (chat_id, reminder_type, date_str, created_at) VALUES (?, ?, ?, ?)")
      .run(chatId, reminderType, dateStr, Date.now());
    return true;
  } catch {
    return true;
  }
}

/**
 * Проверка и отправка напоминаний об окончании подписки (9:00 ежедневно)
 */
export async function checkAndSendSubscriptionReminders(
  sendTextMessageFn?: (chatId: number, text: string, extra?: any) => Promise<void>
) {
  if (!sqliteDb) return;
  try {
    const now = new Date();
    const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(now);
    const subs = sqliteDb.prepare("SELECT * FROM subscriptions WHERE active = 1").all() as any[];

    const { SUBSCRIPTION_EXTRA } = await import("../adapters/MaxAdapter");

    for (const sub of subs) {
      const cleanId = String(sub.chat_id).replace(/^[a-z_]+/, '');
      const numericId = parseInt(cleanId, 10);
      if (isNaN(numericId) || numericId <= 0) continue;
      if (isOwner(cleanId)) continue; // Владельцу напоминания не нужны

      if (!sub.paid_until) continue;
      const paidUntilMs = new Date(sub.paid_until).getTime();
      if (isNaN(paidUntilMs)) continue;

      const diffMs = paidUntilMs - Date.now();
      const daysLeft = Math.ceil(diffMs / (24 * 60 * 60 * 1000));

      let reminderText = '';
      let reminderType = '';

      if (daysLeft === 3) {
        reminderType = 'days_3';
        reminderText = '🔔 Подписка заканчивается через 3 дня. Продлить — кнопки ниже.';
      } else if (daysLeft === 1) {
        reminderType = 'days_1';
        reminderText = '⏰ Завтра подписка закончится. Продли, чтобы Селин не замолчал.';
      } else if (daysLeft <= 0 && daysLeft >= -1) {
        reminderType = 'days_0';
        reminderText = '😢 Подписка закончилась. Спасибо, что был с нами! Продли — и я снова в строю.';
      }

      if (reminderType && reminderText) {
        if (!markReminderSent(cleanId, reminderType, dateStr)) {
          continue;
        }

        logger.info(`🔔 [Sub] reminder: chat=${cleanId} days=${daysLeft}`);

        try {
          if (sendTextMessageFn) {
            await sendTextMessageFn(numericId, reminderText, SUBSCRIPTION_EXTRA);
          } else {
            const { modernMaxAdapter } = await import("../../server");
            await modernMaxAdapter.safeSendMessageToChat(numericId, reminderText, SUBSCRIPTION_EXTRA);
          }
        } catch (err: any) {
          logger.error(`❌ [Sub] Reminder delivery failed for ${cleanId}:`, err?.message || err);
        }
      }
    }
  } catch (err: any) {
    logger.error('❌ [Sub] Error checking subscription reminders:', err);
  }
}

export function startSubscriptionReminderScheduler(
  sendTextMessageFn?: (chatId: number, text: string, extra?: any) => Promise<void>
) {
  setInterval(async () => {
    try {
      const now = new Date();
      const moscowTime = new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Europe/Moscow',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(now);

      if (moscowTime !== '09:00') return;

      const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(now);
      const g = global as any;
      if (g['sub_reminder_9am_' + dateStr]) return;
      g['sub_reminder_9am_' + dateStr] = true;

      logger.info(`🔔 [Sub] Запуск ежедневной проверки подписок 09:00 MSK (дата: ${dateStr})`);
      await checkAndSendSubscriptionReminders(sendTextMessageFn);
    } catch (e: any) {
      logger.error('❌ [Sub] Scheduler error:', e);
    }
  }, 20000);

  logger.info("🔔 Планировщик напоминаний подписки 9:00 MSK запущен (интервал 20 сек)");
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
  const OWNER = String(process.env.OWNER_CHAT_ID || '').trim();
  const sender = String(chatId).replace(/^[a-z_]+/, '').trim();
  return OWNER !== '' && sender === OWNER;
}

export function checkAccess(chatId: string | number): boolean {
  if (isOwner(chatId)) return true;
  return isFeatureAllowed(chatId);
}

