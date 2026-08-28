import { sqliteDb } from "../../db";
import { logger } from "../logger";
import { redisService } from "../services/RedisService";

export async function restoreFromRedis(): Promise<void> {
  try {
    if (!redisService.isAvailable()) {
      logger.info("ℹ️ [Restore] Redis is not available, skipping restore check.");
      return;
    }

    const client = redisService['client'];
    if (!client) return;

    logger.info("🔄 [Restore] Checking if SQLite databases need restoration from Redis...");

    // 1. Restore subscriptions
    let subCount = 0;
    try {
      const row: any = sqliteDb.prepare("SELECT COUNT(*) as count FROM subscriptions").get();
      subCount = row?.count || 0;
    } catch (err) {
      logger.warn("⚠️ [Restore] Subscriptions table query issue:", err);
    }

    if (subCount === 0) {
      logger.info("🔄 [Restore] subscriptions table is empty in SQLite. Attempting restore from Redis Set 'selin:subscriptions_set'...");
      try {
        const chatIds = await client.smembers("selin:subscriptions_set");
        if (chatIds && chatIds.length > 0) {
          let restored = 0;
          for (const chatId of chatIds) {
            const dataStr = await redisService.get(`sub:${chatId}`);
            if (dataStr) {
              try {
                const sub = JSON.parse(dataStr);
                sqliteDb.prepare(`
                  INSERT OR REPLACE INTO subscriptions (chat_id, plan, paid_until, active)
                  VALUES (?, ?, ?, ?)
                `).run(sub.chat_id, sub.plan, sub.paid_until, sub.active);
                restored++;
              } catch (parseErr) {
                logger.error(`❌ [Restore] Failed to parse subscription for ${chatId}:`, parseErr);
              }
            }
          }
          logger.info(`✅ [Restore] Successfully restored ${restored} subscriptions from Redis.`);
        } else {
          logger.info("ℹ️ [Restore] No subscription records found in Redis.");
        }
      } catch (redisErr) {
        logger.error("❌ [Restore] Error restoring subscriptions from Redis:", redisErr);
      }
    } else {
      logger.info(`ℹ️ [Restore] Subscriptions SQLite table has ${subCount} records. Skipping restore.`);
    }

    // 2. Restore payments
    let payCount = 0;
    try {
      const row: any = sqliteDb.prepare("SELECT COUNT(*) as count FROM payments").get();
      payCount = row?.count || 0;
    } catch (err) {
      logger.warn("⚠️ [Restore] Payments table query issue:", err);
    }

    if (payCount === 0) {
      logger.info("🔄 [Restore] payments table is empty in SQLite. Attempting restore from Redis Set 'selin:payments_set'...");
      try {
        const payIds = await client.smembers("selin:payments_set");
        if (payIds && payIds.length > 0) {
          let restored = 0;
          for (const payId of payIds) {
            const dataStr = await redisService.get(`pay:${payId}`);
            if (dataStr) {
              try {
                const pay = JSON.parse(dataStr);
                sqliteDb.prepare(`
                  INSERT OR REPLACE INTO payments (id, chat_id, plan, amount, status, created_at)
                  VALUES (?, ?, ?, ?, ?, ?)
                `).run(pay.id, pay.chat_id, pay.plan, pay.amount, pay.status, pay.created_at);
                restored++;
              } catch (parseErr) {
                logger.error(`❌ [Restore] Failed to parse payment for ${payId}:`, parseErr);
              }
            }
          }
          logger.info(`✅ [Restore] Successfully restored ${restored} payments from Redis.`);
        } else {
          logger.info("ℹ️ [Restore] No payment records found in Redis.");
        }
      } catch (redisErr) {
        logger.error("❌ [Restore] Error restoring payments from Redis:", redisErr);
      }
    } else {
      logger.info(`ℹ️ [Restore] Payments SQLite table has ${payCount} records. Skipping restore.`);
    }

  } catch (globalErr) {
    logger.error("❌ [Restore] Unhandled error during restoreFromRedis:", globalErr);
  }
}
