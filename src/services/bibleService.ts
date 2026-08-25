import { sqliteDb } from "../../db";
import { logger } from "../logger";
import { BIBLE_PLAN } from "../data/biblePlan";
import { handleFintechCommand } from "../fintech/routes";
import { cleanForMax } from "../utils/textUtils";

export interface BibleSlotConfig {
  slotIndex: number;
  type: 'text' | 'voice';
  title: string;
  slotName: string;
}

export const BIBLE_SLOTS: Record<string, BibleSlotConfig> = {
  '09:00': { slotIndex: 0, type: 'text', title: 'Утренний стих.', slotName: '09:00_текст' },
  '09:30': { slotIndex: 0, type: 'voice', title: 'Утренний разбор', slotName: '09:30_голос' },
  '18:00': { slotIndex: 1, type: 'text', title: 'Дневной стих.', slotName: '18:00_текст' },
  '18:30': { slotIndex: 1, type: 'voice', title: 'Дневной разбор', slotName: '18:30_голос' },
  '21:00': { slotIndex: 2, type: 'text', title: 'Вечерний стих.', slotName: '21:00_текст' },
  '21:30': { slotIndex: 2, type: 'voice', title: 'Вечерний разбор', slotName: '21:30_голос' }
};

export const biblePendingConfirmations = new Map<string, number>();

export function getDaysPassed(startDateStr: string): number {
  try {
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());
    const startMs = new Date(startDateStr + 'T00:00:00Z').getTime();
    const todayMs = new Date(todayStr + 'T00:00:00Z').getTime();
    if (isNaN(startMs) || isNaN(todayMs)) return 0;
    return Math.floor((todayMs - startMs) / (1000 * 60 * 60 * 24));
  } catch (e) {
    return 0;
  }
}

export function getDayIndex(startDateStr: string): number {
  const diffDays = getDaysPassed(startDateStr);
  return ((diffDays % 365) + 365) % 365;
}

export async function handleBibleSubscription(
  chatId: string | number,
  text: string,
  isVoice: boolean = false
): Promise<string | null> {
  if (!text) return null;
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const now = Date.now();

  // 0. Финтех-команды и проверка прав доступа
  const fintechResult = await handleFintechCommand(cleanId, text, isVoice);
  if (fintechResult && fintechResult.handled) {
    return fintechResult.replyText || null;
  }

  // 1. Проверка состояния ожидания подтверждения (TTL 5 минут = 300000 мс)
  const pendingTimestamp = biblePendingConfirmations.get(cleanId);
  if (pendingTimestamp) {
    if (now - pendingTimestamp <= 5 * 60 * 1000) {
      if (lower === 'да' || lower.startsWith('да ') || lower.startsWith('да,') || lower.startsWith('да.')) {
        biblePendingConfirmations.delete(cleanId);
        const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());
        try {
          sqliteDb.prepare("INSERT OR REPLACE INTO bible_subs (chat_id, start_date, active, period_days) VALUES (?, ?, ?, ?)").run(cleanId, todayStr, 1, 365);
        } catch (e) {
          try {
            sqliteDb.prepare("INSERT INTO bible_subs (chat_id, start_date, active, period_days) VALUES (?, ?, ?, ?)").run(cleanId, todayStr, 1, 365);
          } catch (err) {
            sqliteDb.prepare("INSERT OR REPLACE INTO bible_subs (chat_id, start_date, active) VALUES (?, ?, ?)").run(cleanId, todayStr, 1);
          }
        }
        logger.info(`📖 [Bible] План победы подключен для chat_id ${cleanId}`);
        return 'План победы подключён на 365 дней. Первые стихи придут по расписанию. Благословений!';
      }

      if (lower === 'нет' || lower.startsWith('нет ') || lower.startsWith('нет,') || lower.startsWith('нет.')) {
        biblePendingConfirmations.delete(cleanId);
        logger.info(`📖 [Bible] Отказ от подключения Плана победы для chat_id ${cleanId}`);
        return 'Хорошо, не подключаю. Если передумаешь - просто скажи команду.';
      }
    } else {
      biblePendingConfirmations.delete(cleanId);
    }
  }

  // 2. Обработка команды «бог благ и милость его велика»
  if (!lower.includes('бог благ и милость его велика')) {
    return null;
  }

  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());

  let currentSub: any = null;
  try {
    currentSub = sqliteDb.prepare("SELECT * FROM bible_subs WHERE chat_id = ?").get(cleanId);
  } catch (e) {
    try {
      currentSub = sqliteDb.prepare("SELECT * FROM bible_subs WHERE chatId = ?").get(cleanId);
    } catch (err) {}
  }

  const isActive = currentSub && Number(currentSub.active) === 1;
  const startDate = currentSub ? (currentSub.start_date || currentSub.startDate || todayStr) : todayStr;
  const daysPassed = getDaysPassed(startDate);

  // Если подписки нет или active=0, или прошло 365 и более дней
  if (!isActive || daysPassed >= 365) {
    biblePendingConfirmations.set(cleanId, Date.now());
    return 'Команда включает План победы на год: каждый день три стиха - утром в 9:00, днём в 18:00 и вечером в 21:00, а через полчаса после каждого - голосовой разбор. Это твой личный годовой план. Отключить можно той же командой, но только через 30 дней после включения. Подключаем? Ответь: да или нет.';
  }

  // Если active=1 и прошло меньше 30 дней
  if (daysPassed < 30) {
    const remainingDays = 30 - daysPassed;
    return `План победы активен. Отключить можно будет через ${remainingDays} дней (после 30 дней использования).`;
  }

  // Если active=1 и прошло от 30 до 365 дней: выключи (active=0)
  try {
    sqliteDb.prepare("INSERT OR REPLACE INTO bible_subs (chat_id, start_date, active, period_days) VALUES (?, ?, ?, ?)").run(cleanId, startDate, 0, currentSub.period_days || 365);
  } catch (e) {
    try {
      sqliteDb.prepare("UPDATE bible_subs SET active = 0 WHERE chat_id = ?").run(cleanId);
    } catch (err) {
      sqliteDb.prepare("INSERT OR REPLACE INTO bible_subs (chat_id, start_date, active) VALUES (?, ?, ?)").run(cleanId, startDate, 0);
    }
  }
  logger.info(`📖 [Bible] План победы остановлен для chat_id ${cleanId}`);
  return 'План победы остановлен. Возвращайся!';
}

const executedBibleSlots = new Set<string>();

export async function checkAndSendBibleBroadcast(
  sendTextMessageFn?: (chatId: number, text: string) => Promise<void>,
  sendVoiceMessageFn?: (chatId: number, text: string) => Promise<void>
) {
  try {
    const now = new Date();
    const moscowTimeStr = new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(now);
    const moscowDateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow'
    }).format(now);

    const slotConfig = BIBLE_SLOTS[moscowTimeStr];
    if (!slotConfig) {
      return;
    }

    const slotKey = `${moscowDateStr}_${moscowTimeStr}`;
    if (executedBibleSlots.has(slotKey)) {
      return;
    }
    executedBibleSlots.add(slotKey);

    if (executedBibleSlots.size > 200) {
      const keys = Array.from(executedBibleSlots);
      for (let i = 0; i < 50; i++) {
        executedBibleSlots.delete(keys[i]);
      }
    }

    let activeSubs: any[] = [];
    try {
      activeSubs = sqliteDb.prepare("SELECT * FROM bible_subs WHERE active = 1").all();
    } catch (e) {
      try {
        activeSubs = sqliteDb.prepare("SELECT * FROM bible_subs WHERE active = ?").all(1);
      } catch (err) {}
    }

    if (!activeSubs || activeSubs.length === 0) {
      return;
    }

    for (const sub of activeSubs) {
      const chatId = String(sub.chat_id || sub.chatId || sub.id);
      const cleanId = chatId.replace(/^[a-z_]+/, '');
      const numericChatId = parseInt(cleanId, 10);
      const startDate = String(sub.start_date || sub.startDate || moscowDateStr);
      const daysPassed = getDaysPassed(startDate);

      if (daysPassed >= 365) {
        continue;
      }

      const dayIndex = getDayIndex(startDate);
      const dayNum = dayIndex + 1;

      const dayPlan = BIBLE_PLAN[dayIndex] || BIBLE_PLAN[0];
      const item = dayPlan[slotConfig.slotIndex];
      if (!item) continue;

      if (slotConfig.type === 'text') {
        let verseText = '';
        try {
          const res = await fetch('https://bible-api.com/' + encodeURIComponent(item.en) + '?translation=russian', {
            signal: AbortSignal.timeout(10000)
          });
          if (res.ok) {
            const data: any = await res.json();
            verseText = (data?.text || '').trim();
          }
        } catch (fetchErr) {}

        let messageToSend = '';
        if (verseText) {
          messageToSend = `День ${dayNum}. ${slotConfig.title}\n\n${verseText}\n\n(${item.ru})`;
        } else {
          messageToSend = `День ${dayNum}. ${slotConfig.title}\n\n${item.ru}\n\n(текст подгрузится позже)`;
        }

        messageToSend = cleanForMax(messageToSend);
        if (sendTextMessageFn && !isNaN(numericChatId)) {
          await sendTextMessageFn(numericChatId, messageToSend);
        }
        logger.info(`📖 [Bible] День ${dayIndex} слот ${slotConfig.slotName} отправлен ${chatId}`);
      } else if (slotConfig.type === 'voice') {
        let verseText = '';
        try {
          const res = await fetch('https://bible-api.com/' + encodeURIComponent(item.en) + '?translation=russian', {
            signal: AbortSignal.timeout(10000)
          });
          if (res.ok) {
            const data: any = await res.json();
            verseText = (data?.text || '').trim();
          }
        } catch (fetchErr) {}

        const verseContent = verseText || item.ru;
        const prompt = `Сделай разбор этого библейского стиха: 150-200 слов, литературный русский, как учитель богословия, тепло и по делу, без markdown: ${verseContent}`;

        let commentary = `Разбор стиха (${item.ru}): ${verseContent}. В этих словах заложено глубокое духовное наставление и мир для вашего сердца.`;

        commentary = cleanForMax(commentary);
        if (sendVoiceMessageFn && !isNaN(numericChatId)) {
          await sendVoiceMessageFn(numericChatId, commentary);
        }
        logger.info(`📖 [Bible] День ${dayIndex} слот ${slotConfig.slotName} отправлен голосом ${chatId}`);
      }
    }
  } catch (err: any) {
    logger.error('❌ Ошибка в рассылке Библии:', { error: err?.message || err });
  }
}

export function startBibleScheduler(
  sendTextMessageFn?: (chatId: number, text: string) => Promise<void>,
  sendVoiceMessageFn?: (chatId: number, text: string) => Promise<void>
) {
  try {
    sqliteDb.exec("CREATE TABLE IF NOT EXISTS bible_subs (chat_id TEXT PRIMARY KEY, start_date TEXT, active INTEGER, period_days INTEGER DEFAULT 365);");
  } catch (e) {}

  setInterval(() => checkAndSendBibleBroadcast(sendTextMessageFn, sendVoiceMessageFn), 20000);
  logger.info("📖 Планировщик годовой рассылки «План победы» запущен (интервал 20 сек, зона Europe/Moscow)");
}
