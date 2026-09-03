import { sqliteDb } from "../../db";
import { logger } from "../logger";
import { getLocalTimeAndDate, isPlanSlotAlreadySent, markPlanSlotSent } from "./bibleService";
import { buildSlotContent } from "./PlanContentBuilder";

export class PlanScheduler {
  private intervalId: NodeJS.Timeout | null = null;

  public start() {
    if (this.intervalId) {
      logger.warn("⚠️ [PlanScheduler] Scheduler is already running");
      return;
    }

    logger.info("🕊 [PlanScheduler] Запущен");
    this.intervalId = setInterval(() => this.checkAndSendBroadcasts(), 60000);
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info("🕊 [PlanScheduler] Остановлен");
    }
  }

  public async checkAndSendBroadcasts() {
    if (!sqliteDb) {
      logger.warn("⚠️ [PlanScheduler] Database not connected, skipping schedule check");
      return;
    }

    try {
      // 1. Выбирай пользователей с plan_enabled = 1
      const users = sqliteDb.prepare(`
        SELECT chat_id, plan_enabled, plan_status, tz, slot_times, voice_on, plan_day_offset 
        FROM user_profiles 
        WHERE plan_enabled = 1 AND plan_status != 'off'
      `).all() as any[];

      if (!users || users.length === 0) return;

      for (const u of users) {
        try {
          const chatId = String(u.chat_id);
          const tz = u.tz || 'Europe/Moscow';
          
          // 2. Вычисляй локальное время по timezone пользователя
          const { timeStr, dateStr } = getLocalTimeAndDate(tz);

          let slotTimes = { m: '07:30', n: '13:00', e: '21:00' };
          if (u.slot_times) {
            try {
              slotTimes = { ...slotTimes, ...JSON.parse(u.slot_times) };
            } catch {}
          }

          let slotKey: 'morning' | 'noon' | 'evening' | null = null;
          let shortSlot: 'm' | 'n' | 'e' = 'm';

          if (timeStr === slotTimes.m) {
            slotKey = 'morning';
            shortSlot = 'm';
          } else if (timeStr === slotTimes.n) {
            slotKey = 'noon';
            shortSlot = 'n';
          } else if (timeStr === slotTimes.e) {
            slotKey = 'evening';
            shortSlot = 'e';
          }

          // 3. Если время совпало со слотом (m/n/e) И сегодня ещё не отправлялось
          if (!slotKey) continue;

          if (isPlanSlotAlreadySent(chatId, shortSlot, dateStr)) {
            continue;
          }

          // 4. Сборка контента
          const content = await buildSlotContent(chatId, slotKey);

          // 5. Отправка контента
          const { modernMaxAdapter } = await import("../../server");

          if (u.voice_on === 1) {
            await modernMaxAdapter.sendToUser(chatId, content.text);
            await modernMaxAdapter.sendVoice(chatId, content.voiceText);
          } else {
            await modernMaxAdapter.sendToUser(chatId, content.text);
          }

          // 6. После отправки пиши в plan_sent_logs
          markPlanSlotSent(chatId, shortSlot, dateStr);

          // Лог: [PlanScheduler] Отправил слот {slot} юзеру {chatId} в {time} {tz}
          logger.info(`[PlanScheduler] Отправил слот ${shortSlot} юзеру ${chatId} в ${timeStr} ${tz}`);

        } catch (userErr: any) {
          logger.error(`❌ [PlanScheduler] Error sending to user ${u.chat_id}:`, userErr.message || userErr);
        }
      }
    } catch (err: any) {
      logger.error("❌ [PlanScheduler] Error in schedule check loop:", err.message || err);
    }
  }
}

export const planScheduler = new PlanScheduler();
