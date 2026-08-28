import { sqliteDb } from "../../db";
import { logger } from "../logger";
import { PLANS } from "./subscriptions";

// SQLite таблица payments
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
  `);
} catch (e) {
  logger.warn('⚠️ [Fintech] Payments table initialization note:', e);
}

export interface PaymentResult {
  mode: 'auto' | 'manual';
  url?: string;
  text?: string;
}

export async function createPayment(chatId: string | number, plan: string = 'plan'): Promise<PaymentResult> {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  const normalizedPlan = (plan || 'plan').toLowerCase().trim();
  const planKey = PLANS[normalizedPlan] ? normalizedPlan : (normalizedPlan.includes('prem') ? 'premium' : 'plan');
  const planObj = PLANS[planKey] || PLANS.plan;
  const amount = planObj.price;
  const paymentId = `pay_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const nowStr = new Date().toISOString();

  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secretKey = process.env.YOOKASSA_SECRET_KEY;

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

  // Ручной режим по СБП
  const sbpPhone = process.env.SBP_PHONE || 'укажи в настройках';
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
    text: `Переведи ${amount} руб по СБП на номер ${sbpPhone} и отправь команду "оплачено ${planKey}".`
  };
}
