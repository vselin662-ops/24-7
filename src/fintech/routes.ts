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
    const body = req.body || {};
    const event = body.event || body.type;

    if (event === "payment.succeeded" || event === "payment.waiting_for_capture") {
      const metadata = body.object?.metadata || body.metadata || {};
      const chatId = metadata.chat_id || metadata.chatId;
      const plan = metadata.plan || "plan";

      if (chatId) {
        activateSubscription(chatId, plan, 30);
        await sendMaxNotification(chatId, "Оплата подтверждена! Тариф активен 30 дней.");
        logger.info(`💳 [Pay] подтверждено ${chatId}`);
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
    const replyText = `Доступные тарифы Selin AI:

1. План победы — 299 руб/мес (годовой библейский план, утренние, дневные и вечерние стихи с голосовыми разборами).
2. Премиум — 999 руб/мес (полный доступ ко всем возможностям и ассистентам).

Нажмите кнопку ниже или отправьте команду pay:plan / pay:premium для оплаты:`;

    const extra = {
      attachments: [
        {
          type: 'inline_keyboard',
          payload: {
            buttons: [
              [
                { text: 'План победы - 299 руб', callback_data: 'pay:plan' }
              ],
              [
                { text: 'Премиум - 999 руб', callback_data: 'pay:premium' }
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
