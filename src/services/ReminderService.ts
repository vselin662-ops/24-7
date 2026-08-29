import { sqliteDb } from "../../db";
import { logger } from "../logger";
import { llmService } from "../core/LLMService";

if (sqliteDb) {
  try {
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS reminders (
        chat_id TEXT,
        fire_at TEXT,
        text TEXT,
        done INTEGER DEFAULT 0
      );
    `);
    logger.info("📁 [Reminder] reminders table verified in SQLite.");
  } catch (err) {
    logger.error("❌ [Reminder] Database initialization failed:", err);
  }
}

export interface Reminder {
  chat_id: string;
  fire_at: string;
  text: string;
  done: number;
}

export async function parseReminderTime(rawTime: string): Promise<Date> {
  const now = new Date();
  const lower = rawTime.toLowerCase().trim();

  // 1. Regex check for "через час"
  if (lower === "через час") {
    return new Date(now.getTime() + 60 * 60 * 1000);
  }

  // 2. Regex check for "через X минут"
  const minMatch = lower.match(/через\s+(\d+)\s*(минут|мин)/);
  if (minMatch) {
    const mins = parseInt(minMatch[1], 10);
    return new Date(now.getTime() + mins * 60 * 1000);
  }

  // 3. Regex check for "через X часов/часа"
  const hrMatch = lower.match(/через\s+(\d+)\s*(час|ч)/);
  if (hrMatch) {
    const hrs = parseInt(hrMatch[1], 10);
    return new Date(now.getTime() + hrs * 60 * 60 * 1000);
  }

  // 4. Regex check for hh:mm
  const timeMatch = lower.match(/(?:в|на)\s+(\d{1,2})[:.-](\d{2})/);
  if (timeMatch) {
    const hr = parseInt(timeMatch[1], 10);
    const min = parseInt(timeMatch[2], 10);
    const target = new Date(now);
    target.setHours(hr, min, 0, 0);
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1); // Tomorrow
    }
    return target;
  }

  // 5. Regex check for "в X утра" or "в X вечера"
  const simpleHrMatch = lower.match(/(?:в|на)\s+(\d{1,2})\s*(утра|вечера|вечером|дня|ночи)?/);
  if (simpleHrMatch) {
    let hr = parseInt(simpleHrMatch[1], 10);
    const period = simpleHrMatch[2];
    if (period) {
      if ((period.includes("вечер") || period.includes("дня")) && hr < 12) {
        hr += 12;
      } else if (period.includes("ноч") && hr === 12) {
        hr = 0;
      }
    } else {
      // Deault heuristics
      if (hr < 8) {
        hr += 12; // 5 -> 17 (5 вечера)
      }
    }
    const target = new Date(now);
    target.setHours(hr, 0, 0, 0);
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    return target;
  }

  // 6. LLM fallback for advanced natural language
  try {
    const systemPrompt = `Парси выражение времени на русском. Текущее серверное время: ${now.toISOString()}.
Верни ТОЛЬКО валидную дату в формате ISO 8601 (например, 2026-08-28T09:00:00.000Z), соответствующую запросу. Никаких лишних слов, комментариев или разметки. Только ISO строка.`;
    const response = await llmService.smartCall("reminder_time_parser", rawTime, systemPrompt);
    const cleaned = response.replace(/[^0-9a-zA-Z-:]/g, "").trim();
    const parsedDate = new Date(cleaned);
    if (!isNaN(parsedDate.getTime())) {
      return parsedDate;
    }
  } catch (err) {
    logger.warn("⚠️ [Reminder] LLM time parser failed, falling back to 1 hour:", err);
  }

  // Final fallback: 1 hour
  return new Date(now.getTime() + 60 * 60 * 1000);
}

export async function addReminder(chatId: string | number, rawTime: string, text: string): Promise<Date> {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  const fireDate = await parseReminderTime(rawTime);
  const fireAtIso = fireDate.toISOString();

  if (sqliteDb) {
    sqliteDb.prepare(`
      INSERT INTO reminders (chat_id, fire_at, text, done)
      VALUES (?, ?, ?, 0)
    `).run(cleanId, fireAtIso, text);
    logger.info(`✅ [Reminder] Saved reminder for ${cleanId} at ${fireAtIso}: "${text}"`);
  }

  return fireDate;
}

export async function checkAndSendReminders(sendMsgFn: (chatId: string, text: string) => Promise<void>): Promise<void> {
  if (!sqliteDb) return;
  try {
    const nowIso = new Date().toISOString();
    const rows = sqliteDb.prepare("SELECT rowid as id, chat_id, text FROM reminders WHERE fire_at <= ? AND done = 0").all() as any[];

    for (const row of rows) {
      try {
        logger.info(`⏰ [Reminder] Firing reminder ID ${row.id} for ${row.chat_id}: "${row.text}"`);
        await sendMsgFn(row.chat_id, `🔔 Напоминание: ${row.text}`);
        sqliteDb.prepare("UPDATE reminders SET done = 1 WHERE rowid = ?").run(row.id);
      } catch (sendErr) {
        logger.error(`❌ [Reminder] Failed to send reminder ID ${row.id}:`, sendErr);
      }
    }
  } catch (err) {
    logger.error("❌ [Reminder] Error checking reminders:", err);
  }
}
