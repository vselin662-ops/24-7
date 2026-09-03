import { Router, Request, Response } from "express";
import { logger } from "../logger";
import { activateSubscription } from "../fintech/subscriptions";
import { sendMaxNotification } from "../fintech/routes";
import { sqliteDb } from "../../db";

const router = Router();

router.post("/api/payments/yookassa/webhook", async (req: Request, res: Response) => {
  logger.info("📩 [YooKassa Webhook] Received webhook POST request");

  const body = req.body || {};
  const event = body.event || body.type;
  const paymentId = body.object?.id;

  // YooKassa requires a fast response. Send 200 OK immediately and process asynchronously.
  res.status(200).json({ status: "ok" });

  // Asynchronous processing block
  (async () => {
    try {
      // 1. Verify Webhook Secret if set
      const webhookSecret = process.env.YOOKASSA_WEBHOOK_SECRET;
      if (webhookSecret) {
        const querySecret = req.query.secret;
        const sigHeader = req.headers['x-yookassa-signature'] || req.headers['x-webhook-secret'] || req.headers['authorization'];
        if (querySecret !== webhookSecret && sigHeader !== webhookSecret) {
          logger.warn("🚫 [YooKassa Webhook] Unauthorized - missing or invalid webhook secret");
          return;
        }
      }

      const status = body.object?.status;
      if (event === "payment.succeeded" || status === "succeeded") {
        const metadata = body.object?.metadata || body.metadata || {};
        const chatId = metadata.chat_id || metadata.chatId;
        const plan = metadata.plan || "plan";
        const amount = body.object?.amount?.value ? parseFloat(body.object.amount.value) : 0;

        if (!chatId) {
          logger.warn(`⚠️ [YooKassa Webhook] No chatId found in metadata for payment: ${paymentId}`);
          return;
        }

        logger.info(`✅ [YooKassa Webhook] Payment succeeded: ${paymentId} for chat ${chatId}, plan ${plan}`);

        // A. Activate subscription
        activateSubscription(chatId, plan, 30);

        // B. Log to payments table
        if (sqliteDb && paymentId) {
          sqliteDb.prepare(`
            INSERT OR REPLACE INTO payments (id, chat_id, plan, amount, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            paymentId,
            String(chatId),
            plan,
            amount,
            "succeeded",
            new Date().toISOString()
          );
        }

        // C. Notify user via Messenger
        await sendMaxNotification(chatId, 'Оплата подтверждена! Тариф активен 30 дней.');
      } else {
        logger.info(`ℹ️ [YooKassa Webhook] Payment event ignored: ${event}, status: ${status}`);
        
        // Log other events if paymentId is available
        if (sqliteDb && paymentId) {
          const metadata = body.object?.metadata || body.metadata || {};
          const chatId = metadata.chat_id || metadata.chatId || "";
          const plan = metadata.plan || "plan";
          const amount = body.object?.amount?.value ? parseFloat(body.object.amount.value) : 0;
          sqliteDb.prepare(`
            INSERT OR REPLACE INTO payments (id, chat_id, plan, amount, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            paymentId,
            String(chatId),
            plan,
            amount,
            status || event || "pending",
            new Date().toISOString()
          );
        }
      }
    } catch (err: any) {
      logger.error(`❌ [YooKassa Webhook] Error processing asynchronously: ${err?.message || err}`);
    }
  })();
});

export default router;
