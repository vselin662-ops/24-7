import { sqliteDb } from "../../db";
import { logger } from "../logger";
import { PLANS, activateSubscription } from "./subscriptions";

// SQLite таблица payments и payment_requests
try {
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      chat_id TEXT,
      plan TEXT,
      amount INTEGER,
      status TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS payment_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      tariff TEXT NOT NULL,
      screenshot_seen INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      status TEXT DEFAULT 'pending'
    );
    CREATE INDEX IF NOT EXISTS idx_pay_req_chat ON payment_requests(chat_id, status);
  `);
} catch (e) {
  logger.warn('⚠️ [Fintech] Payments tables initialization note:', e);
}

export interface PaymentResult {
  mode: 'auto' | 'manual';
  url?: string;
  text?: string;
}

export interface PaymentRequest {
  id?: number;
  chat_id: string;
  tariff: string;
  screenshot_seen: number;
  created_at: string;
  status: string;
}

export function savePaymentRequest(
  chatId: string | number,
  tariff: string = 'month',
  screenshotSeen: boolean = false
): PaymentRequest {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  const nowStr = new Date().toISOString();
  const seen = screenshotSeen ? 1 : 0;

  // Normalize tariff name
  let normTariff = '199₽/мес';
  const lower = (tariff || '').toLowerCase().trim();
  if (lower.includes('год') || lower.includes('year') || lower.includes('1800')) {
    normTariff = '1800₽/год';
  } else {
    normTariff = '199₽/мес';
  }

  try {
    sqliteDb.prepare(`
      INSERT INTO payment_requests (chat_id, tariff, screenshot_seen, created_at, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).run(cleanId, normTariff, seen, nowStr);
  } catch (err) {
    logger.error('❌ Error saving payment request:', err);
  }

  return {
    chat_id: cleanId,
    tariff: normTariff,
    screenshot_seen: seen,
    created_at: nowStr,
    status: 'pending'
  };
}

export function activateManualPayment(
  chatId: string | number,
  tariff: string = 'month'
): { success: boolean; tariffName: string; planKey: string; paidUntil: string; dateStr: string; days: number } {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  const lower = (tariff || '').toLowerCase().trim();

  let planKey = 'month';
  let tariffName = '199₽/мес';
  let days = 30;

  if (lower.includes('год') || lower.includes('year') || lower.includes('1800') || lower.includes('365')) {
    planKey = 'year';
    tariffName = '1800₽/год';
    days = 365;
  } else {
    planKey = 'month';
    tariffName = '199₽/мес';
    days = 30;
  }

  const sub = activateSubscription(cleanId, planKey, days);

  try {
    sqliteDb.prepare(`
      UPDATE payment_requests
      SET status = 'done'
      WHERE chat_id = ? AND status = 'pending'
    `).run(cleanId);
  } catch (err) {
    logger.error('❌ Error updating payment_requests to done:', err);
  }

  const paidUntilDate = new Date(sub.paid_until);
  const dateStr = paidUntilDate.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  return {
    success: true,
    tariffName,
    planKey,
    paidUntil: sub.paid_until,
    dateStr,
    days
  };
}

export function getSubscribeText(): string {
  return '💳 Подписка Selin AI: • 199₽/мес • 1800₽/год (выгода 25%). Для подтверждения достаточно скинуть скрин оплаты сюда.';
}

export async function createPayment(chatId: string | number, plan: string = 'plan'): Promise<PaymentResult> {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  const normalizedPlan = (plan || 'plan').toLowerCase().trim();
  const planKey = PLANS[normalizedPlan] ? normalizedPlan : (normalizedPlan.includes('prem') || normalizedPlan.includes('благодат') ? 'blagodat' : (normalizedPlan.includes('год') || normalizedPlan.includes('year') ? 'year' : 'svet'));
  const planObj = PLANS[planKey] || PLANS.svet;
  const amount = planObj.price;
  const paymentId = `pay_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const nowStr = new Date().toISOString();

  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secretKey = process.env.YOOKASSA_SECRET_KEY || process.env.YOOKASSA_SECRET;

  if (shopId && secretKey) {
    try {
      const authHeader = 'Basic ' + Buffer.from(`${shopId}:${secretKey}`).toString('base64');
      const body = {
        amount: {
          value: Number(amount).toFixed(2),
          currency: 'RUB'
        },
        confirmation: {
          type: 'redirect',
          return_url: 'https://max.ru'
        },
        capture: true,
        description: 'Selin AI: ' + planObj.name,
        metadata: {
          chat_id: cleanId,
          plan: planKey
        }
      };

      const response = await fetch('https://api.yookassa.ru/v3/payments', {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
          'Idempotence-Key': paymentId
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000)
      });

      if (response.ok) {
        const data: any = await response.json();
        const yooId = data?.id || paymentId;
        const confirmationUrl = data?.confirmation?.confirmation_url || data?.confirmation?.url || 'https://max.ru';

        try {
          sqliteDb.prepare(`
            INSERT OR REPLACE INTO payments (id, chat_id, plan, amount, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(yooId, cleanId, planKey, amount, data?.status || 'pending', nowStr);

          // Duplicate to Redis
          try {
            const { redisService } = await import("../services/RedisService");
            if (redisService.isAvailable()) {
              const payData = { id: yooId, chat_id: cleanId, plan: planKey, amount, status: data?.status || 'pending', created_at: nowStr };
              await redisService.set(`pay:${yooId}`, JSON.stringify(payData));
              if (redisService['client']) {
                await redisService['client'].sadd('selin:payments_set', yooId);
              }
            }
          } catch (rErr) {
            logger.warn('⚠️ [Fintech] Redis payment duplication failed:', rErr);
          }
        } catch (dbErr) {
          logger.warn('⚠️ [Fintech] Error saving payment to db:', dbErr);
        }

        logger.info(`💳 [Fintech] ЮKassa платеж создан: ${yooId} для chat_id=${cleanId}, url=${confirmationUrl}`);
        return {
          mode: 'auto',
          url: confirmationUrl
        };
      } else {
        const errText = await response.text().catch(() => '');
        logger.error(`❌ [Fintech] ЮKassa API вернул ошибку ${response.status}: ${errText}`);
      }
    } catch (err: any) {
      logger.error(`❌ [Fintech] Исключение при создании платежа ЮKassa: ${err?.message || err}`);
    }
  }

  // Ручной режим / ссылка
  try {
    sqliteDb.prepare(`
      INSERT OR REPLACE INTO payments (id, chat_id, plan, amount, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(paymentId, cleanId, planKey, amount, 'pending_manual', nowStr);

    // Duplicate to Redis
    try {
      const { redisService } = await import("../services/RedisService");
      if (redisService.isAvailable()) {
        const payData = { id: paymentId, chat_id: cleanId, plan: planKey, amount, status: 'pending_manual', created_at: nowStr };
        await redisService.set(`pay:${paymentId}`, JSON.stringify(payData));
        if (redisService['client']) {
          await redisService['client'].sadd('selin:payments_set', paymentId);
        }
      }
    } catch (rErr) {
      logger.warn('⚠️ [Fintech] Redis payment duplication failed:', rErr);
    }
  } catch (dbErr) {
    logger.warn('⚠️ [Fintech] Error saving manual payment to db:', dbErr);
  }

  return {
    mode: 'manual',
    url: 'https://yoomoney.ru/to/4100119243483246',
    text: `💳 Подписка Selin AI: • 199₽/мес • 1800₽/год (выгода 25%). Для подтверждения достаточно скинуть скрин оплаты сюда.`
  };
}
