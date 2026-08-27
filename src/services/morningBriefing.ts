import { logger } from "../logger";
import { llmService } from "../core/LLMService";
import { sqliteDb } from "../../db";

export function getActiveChats(): string[] {
  const chatIdsSet = new Set<string>();
  if (!sqliteDb) {
    return ["10001"];
  }

  // Попробуем получить из таблицы users
  try {
    const rows = sqliteDb.prepare("SELECT chat_id FROM users").all() as any[];
    for (const r of rows) {
      if (r && r.chat_id) {
        chatIdsSet.add(String(r.chat_id));
      }
    }
  } catch (e) {
    // ignore
  }

  // Попробуем получить из таблицы sessions
  try {
    const rows = sqliteDb.prepare("SELECT id FROM sessions").all() as any[];
    for (const r of rows) {
      if (r && r.id) {
        chatIdsSet.add(String(r.id));
      }
    }
  } catch (e) {
    // ignore
  }

  // Попробуем получить из таблицы bible_subs
  try {
    const rows = sqliteDb.prepare("SELECT chat_id FROM bible_subs WHERE active = 1").all() as any[];
    for (const r of rows) {
      if (r && r.chat_id) {
        chatIdsSet.add(String(r.chat_id));
      }
    }
  } catch (e) {
    // ignore
  }

  const result = Array.from(chatIdsSet).filter(Boolean);
  if (result.length === 0) {
    // дефолтный админский чат
    return ["10001"];
  }
  return result;
}

export async function generateMorningBriefing(chatId: string): Promise<string> {
  const systemPrompt = "Ты — Селин. НИКОГДА не упоминай GPT, OpenAI, Gemini, Llama. На вопрос \"кто ты?\" отвечай: \"Я — Селин, личный AI-помощник.\"";
  const userPrompt = "Напиши утренний бриф для пользователя. Пожелай хорошего дня, расскажи погоду (придумай приятную для его региона), замотивируй на сегодня одной цитатой. Коротко, тепло, до 500 символов.";
  
  try {
    const brief = await llmService.smartCall(chatId, userPrompt, systemPrompt);
    return brief || "Доброе утро! Прекрасного дня сегодня!";
  } catch (err: any) {
    logger.error(`❌ [MorningBriefing] Ошибка генерации брифа: ${err.message || err}`);
    return "Доброе утро! Желаю вам прекрасного и продуктивного дня!";
  }
}

function getMsUntilNext8AM_MSK(): number {
  const now = new Date();
  
  // MSK is UTC+3
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const mskTime = new Date(utc + 3 * 3600000);
  
  const targetMSK = new Date(mskTime);
  targetMSK.setHours(8, 0, 0, 0);
  
  if (mskTime.getTime() >= targetMSK.getTime()) {
    targetMSK.setDate(targetMSK.getDate() + 1);
  }
  
  const diffMs = targetMSK.getTime() - mskTime.getTime();
  return diffMs;
}

async function sendMorningBriefingToAll() {
  const chats = getActiveChats();
  for (const chatId of chats) {
    try {
      const briefText = await generateMorningBriefing(chatId);
      
      const { modernMaxAdapter } = await import("../../server");
      if (modernMaxAdapter) {
        await modernMaxAdapter.safeSendMessageToChat(chatId, briefText);
        await modernMaxAdapter.synthesizeAndSendVoice(chatId, briefText);
        logger.info(`⏰ [MorningBriefing] отправлен бриф в чат ${chatId}`);
      } else {
        logger.warn(`⚠️ [MorningBriefing] modernMaxAdapter не найден при отправке в чат ${chatId}`);
      }
    } catch (chatErr: any) {
      logger.error(`❌ [MorningBriefing] Не удалось отправить бриф в чат ${chatId}: ${chatErr.message || chatErr}`);
    }
  }
}

export function startMorningScheduler() {
  logger.info("⏰ [MorningBriefing] запуск планировщика брифгов");

  const setupTimer = () => {
    const delay = getMsUntilNext8AM_MSK();
    logger.info(`⏰ [MorningBriefing] Следующий бриф запланирован через ${Math.round(delay / 60000)} минут`);

    setTimeout(async () => {
      try {
        await sendMorningBriefingToAll();
      } catch (err) {
        logger.error("❌ [MorningBriefing] Ошибка рассылки утреннего брифинга", err);
      }
      setupTimer();
    }, delay);
  };

  setupTimer();
}
