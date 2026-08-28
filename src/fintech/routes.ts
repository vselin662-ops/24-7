import { Router, Request, Response } from "express";
import { logger } from "../logger";
import { activateSubscription, getSubscription, isFeatureAllowed, PLANS } from "./subscriptions";
import { createPayment } from "./payments";

export const fintechRouter = Router();

// Вспомогательная функция отправки сообщения пользователю в MAX Messenger
export async function sendMaxNotification(chatId: string | number, message: string, extra?: any): Promise<boolean> {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  const numericId = parseInt(cleanId, 10);
  if (isNaN(numericId) || numericId <= 0) return false;

  try {
    const { modernMaxAdapter } = await import("../../server");
    if (modernMaxAdapter) {
      await modernMaxAdapter.safeSendMessageToChat(numericId, message, extra);
      return true;
    }
  } catch (err) {
    logger.warn(`⚠️ [Fintech] Failed to send Max notification to ${cleanId}:`, err);
  }
  return false;
}

// POST /api/yookassa/webhook
fintechRouter.post("/api/yookassa/webhook", async (req: Request, res: Response) => {
  try {
    const shopId = process.env.YOOKASSA_SHOP_ID;
    const secretKey = process.env.YOOKASSA_SECRET_KEY || process.env.YOOKASSA_SECRET;

    // 1. Verify Basic Auth if keys are configured
    if (shopId && secretKey) {
      const expectedHeader = "Basic " + Buffer.from(`${shopId}:${secretKey}`).toString("base64");
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== expectedHeader) {
        logger.warn("🚫 [YooKassa] webhook without valid auth");
        return res.status(403).send("Forbidden");
      }
    }

    const body = req.body || {};
    const event = body.event || body.type;
    const paymentId = body.object?.id;

    // 2. Automated mode check and idempotency
    if (shopId && secretKey && paymentId) {
      const basicAuth = Buffer.from(`${shopId}:${secretKey}`).toString("base64");
      const check = await fetch('https://api.yookassa.ru/v3/payments/' + paymentId, {
        headers: { 'Authorization': 'Basic ' + basicAuth },
        signal: AbortSignal.timeout(10000)
      });

      if (!check.ok) {
        logger.warn('🚨 [Pay] проверка платежа не прошла');
        return res.status(200).send('OK');
      }

      const pdata: any = await check.json();
      const pStatus = pdata.status;

      if (pStatus !== 'succeeded') {
        return res.status(200).send('OK');
      }

      // Idempotency check:
      const { queryGet, queryRun } = await import("../database/sessions.db");
      const alreadyProcessed = await queryGet<any>(
        "SELECT payment_id FROM processed_payments WHERE payment_id = ?",
        [paymentId]
      );

      if (alreadyProcessed) {
        logger.info(`♻️ [YooKassa] duplicate ignored: ${paymentId}`);
        return res.status(200).send("OK");
      }

      const metadata = pdata.metadata || {};
      const realChatId = metadata.chat_id || metadata.chatId;
      const realPlan = metadata.plan || "plan";

      if (realChatId) {
        await queryRun(
          "INSERT INTO processed_payments (payment_id, processed_at) VALUES (?, ?)",
          [paymentId, new Date().toISOString()]
        );

        activateSubscription(realChatId, realPlan, 30);
        await sendMaxNotification(realChatId, 'Оплата подтверждена! Тариф активен 30 дней.');
      }
    } else {
      // Manual fallback if YooKassa keys not configured
      const metadata = body.object?.metadata || body.metadata || {};
      const chatId = metadata.chat_id || metadata.chatId;
      const plan = metadata.plan || "plan";

      if (chatId && (event === "payment.succeeded" || event === "payment.waiting_for_capture")) {
        activateSubscription(chatId, plan, 30);
        await sendMaxNotification(chatId, 'Оплата подтверждена! Тариф активен 30 дней.');
      }
    }
  } catch (err: any) {
    logger.error(`❌ [Fintech] Ошибка в webhook ЮKassa: ${err?.message || err}`);
  }

  // ВСЕГДА 200 OK
  return res.status(200).send("OK");
});

// POST /api/robokassa/webhook (заглушка под цифровой рубль)
fintechRouter.post("/api/robokassa/webhook", async (req: Request, res: Response) => {
  try {
    const data = { ...req.query, ...req.body };
    const invId = data.InvId || data.inv_id || data.invId;
    const chatId = data.shp_chat_id || data.shp_chatId || data.chat_id || data.chatId;
    const plan = data.shp_plan || data.plan || "plan";

    if (chatId) {
      activateSubscription(chatId, plan, 30);
      await sendMaxNotification(chatId, "Оплата подтверждена! Тариф активен 30 дней.");
    }

    logger.info(`💎 [DigitalRuble] подтверждено ${invId || chatId || ""}`);
    if (invId) {
      return res.status(200).send(`OK${invId}`);
    }
  } catch (err: any) {
    logger.error(`❌ [Fintech] Ошибка в webhook Robokassa: ${err?.message || err}`);
  }

  // ВСЕГДА 200 OK
  return res.status(200).send("OK");
});

// GET /api/payments/status?chat_id=
fintechRouter.get("/api/payments/status", (req: Request, res: Response) => {
  const chatId = String(req.query.chat_id || req.query.chatId || "");
  if (!chatId) {
    return res.status(400).json({ error: "chat_id required" });
  }

  const sub = getSubscription(chatId);
  const allowed = isFeatureAllowed(chatId);

  return res.json({
    chat_id: chatId,
    subscription: sub,
    is_allowed: allowed,
    plans: PLANS
  });
});

/**
 * Обработчик финтех-команд для MAX и чатов
 */
export async function handleFintechCommand(
  chatId: string | number,
  text: string,
  isVoice: boolean = false
): Promise<{ handled: boolean; replyText?: string; extra?: any } | null> {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  const trimmed = (text || '').trim();
  const lower = trimmed.toLowerCase();

  // 1. Команда 'тарифы'
  if (lower === 'тарифы' || lower === '/tariffs' || lower === '/plans' || lower === 'тариф') {
    const replyText = 'Доступные тарифы Selin AI:\n\n1. План победы — 199 руб/мес или 1490 руб/год (2 месяца в подарок)\n2. Премиум — 499 руб/мес или 3990 руб/год.';

    const extra = {
      attachments: [
        {
          type: 'inline_keyboard',
          payload: {
            buttons: [
              [
                { text: 'План победы - 199 руб', callback_data: 'pay:plan' }
              ],
              [
                { text: 'Премиум - 499 руб', callback_data: 'pay:premium' }
              ]
            ]
          }
        }
      ]
    };

    // Если запрос из MAX messenger, пробуем отправить с кнопками
    sendMaxNotification(cleanId, replyText, extra).catch(() => {});

    return {
      handled: true,
      replyText,
      extra
    };
  }

  // 2. Callback или команда 'pay:<plan>'
  if (lower.startsWith('pay:') || lower.startsWith('pay_')) {
    const planKey = lower.replace(/^pay[:_]/, '').trim() || 'plan';
    const payRes = await createPayment(cleanId, planKey);

    if (payRes.mode === 'auto' && payRes.url) {
      const replyText = `Ссылка для оплаты тарифа "${PLANS[planKey]?.name || planKey}":\n${payRes.url}`;
      const extra = {
        attachments: [
          {
            type: 'inline_keyboard',
            payload: {
              buttons: [
                [
                  { text: 'Оплатить', url: payRes.url }
                ]
              ]
            }
          }
        ]
      };
      sendMaxNotification(cleanId, replyText, extra).catch(() => {});
      return {
        handled: true,
        replyText,
        extra
      };
    } else {
      const replyText = payRes.text || `Переведите оплату по СБП и отправьте команду "оплачено ${planKey}".`;
      return {
        handled: true,
        replyText
      };
    }
  }

  // 3. Команда 'оплачено <plan>'
  if (lower.startsWith('оплачено')) {
    return {
      handled: true,
      replyText: 'Заявка принята. После подтверждения открою доступ.'
    };
  }

  // 4. Админ-команда 'подтвердить <chat_id>'
  if (lower.startsWith('подтвердить')) {
    const adminChatId = String(process.env.ADMIN_CHAT_ID || '').trim();
    if (adminChatId && cleanId === adminChatId) {
      const targetChatId = trimmed.replace(/^подтвердить\s*/i, '').trim();
      if (targetChatId) {
        activateSubscription(targetChatId, 'plan', 30);
        await sendMaxNotification(targetChatId, 'Оплата подтверждена! Тариф активен 30 дней.');
        return {
          handled: true,
          replyText: `Подписка для ${targetChatId} активирована на 30 дней.`
        };
      } else {
        return {
          handled: true,
          replyText: 'Укажите chat_id пользователя: подтвердить <chat_id>'
        };
      }
    }
  }

  // 5. Проверка доступа для защищенных команд: 'бог благ и милость его велика' и 'что у нас сегодня'
  if (lower === 'бог благ и милость его велика' || lower.startsWith('что у нас сегодня')) {
    if (!isFeatureAllowed(cleanId)) {
      return {
        handled: true,
        replyText: 'Эта функция доступна на тарифе План победы. Напиши "тарифы".'
      };
    }
  }

  return null;
}
