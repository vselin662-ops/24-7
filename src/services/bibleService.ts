import { sqliteDb } from "../../db";
import { logger } from "../logger";
import { BIBLE_PLAN } from "../data/biblePlan";
import { handleFintechCommand } from "../fintech/routes";
import { cleanForMax } from "../utils/textUtils";
import { getUserSettings, setPlanStatus, PlanStatus } from "./ProfileService";

export interface BibleSlotConfig {
  slotIndex: number;
  type: 'voice';
  title: string;
  slotName: string;
}

// План Победы: голосовые разборы стихов
export const BIBLE_SLOTS: Record<string, BibleSlotConfig> = {
  '09:00': { slotIndex: 0, type: 'voice', title: 'Утренний стих Плана Победы', slotName: '09:00_голос' },
  '09:30': { slotIndex: 0, type: 'voice', title: 'Утренний разбор Плана Победы', slotName: '09:30_голос' },
  '18:00': { slotIndex: 1, type: 'voice', title: 'Дневной стих Плана Победы', slotName: '18:00_голос' },
  '18:30': { slotIndex: 1, type: 'voice', title: 'Дневной разбор Плана Победы', slotName: '18:30_голос' },
  '21:00': { slotIndex: 2, type: 'voice', title: 'Вечерний стих Плана Победы', slotName: '21:00_голос' },
  '21:30': { slotIndex: 2, type: 'voice', title: 'Вечерний разбор Плана Победы', slotName: '21:30_голос' }
};

export const PLAN_POBEDY_BUTTONS = [
  [
    { type: 'callback', text: '✅ Оставить как есть', payload: 'plan_keep' }
  ],
  [
    { type: 'callback', text: '❌ Отключить План Победы', payload: 'plan_off' }
  ]
];

export const PLAN_POBEDY_EXTRA = {
  attachments: [
    {
      type: 'inline_keyboard',
      payload: {
        buttons: PLAN_POBEDY_BUTTONS
      }
    }
  ]
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

export async function sendImmediatePlanPobedyVerse(
  chatId: string | number,
  sendVoiceMessageFn?: (chatId: number, text: string) => Promise<void>,
  sendTextMessageFn?: (chatId: number, text: string, extra?: any) => Promise<void>
): Promise<void> {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  const numericId = parseInt(cleanId, 10);
  if (isNaN(numericId) || numericId <= 0) return;

  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());
  const dayIndex = getDayIndex(todayStr);
  const dayPlan = BIBLE_PLAN[dayIndex] || BIBLE_PLAN[0];
  const item = dayPlan[0];

  let verseText = '';
  if (item) {
    try {
      const res = await fetch('https://bible-api.com/' + encodeURIComponent(item.en) + '?translation=russian', {
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        const data: any = await res.json();
        verseText = (data?.text || '').trim();
      }
    } catch {}
  }

  const verseContent = verseText || (item ? item.ru : 'Господь — Пастырь мой; я ни в чем не буду нуждаться.');
  const commentary = cleanForMax(`План Победы. Стих дня (${item ? item.ru : 'Псалтирь 22:1'}): ${verseContent}. В этих святых словах сила и победа на каждый день вашей жизни.`);

  try {
    if (sendVoiceMessageFn) {
      await sendVoiceMessageFn(numericId, commentary);
    } else {
      const { modernMaxAdapter } = await import("../../server");
      await modernMaxAdapter.sendVoice(numericId, commentary);
    }

    // Если статус on_buttons — сразу прикрепляем 2 кнопки для удобства
    const settings = getUserSettings(cleanId);
    if (settings.plan_status === 'on_buttons') {
      if (sendTextMessageFn) {
        await sendTextMessageFn(numericId, '⚙️ Настройки Плана Победы:', PLAN_POBEDY_EXTRA);
      } else {
        const { modernMaxAdapter } = await import("../../server");
        await modernMaxAdapter.safeSendMessageToChat(numericId, '⚙️ Настройки Плана Победы:', PLAN_POBEDY_EXTRA);
      }
    }
  } catch (err: any) {
    logger.error(`❌ [Bible] Failed to send immediate verse to ${cleanId}:`, err);
  }
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
        setPlanStatus(cleanId, 'on_buttons');
        logger.info(`📖 [Bible] План победы подключен для chat_id ${cleanId}`);

        // Сразу отправляем стих голосом
        sendImmediatePlanPobedyVerse(cleanId).catch(() => {});
        return 'План победы подключён на 365 дней. Отправляю первый стих голосом. Благословений!';
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

  // 1.5. Ручной тест рассылки (отправка 3 стихов)
  if (lower === 'тест рассылки' || lower === 'тест_рассылки') {
    logger.info(`📖 [Bible Test] Running manual test broadcast for chatId ${cleanId}`);
    
    const sampleVerses = [
      { ru: "Псалом 22:1 — Господь — Пастырь мой; я ни в чем не буду нуждаться.", en: "Psalm 23:1" },
      { ru: "Иоанна 3:16 — Ибо так возлюбил Бог мир, что отдал Сына Своего Единородного...", en: "John 3:16" },
      { ru: "Римлянам 8:28 — Притом знаем, что любящим Бога, призванным по Его изволению, все содействует ко благу.", en: "Romans 8:28" }
    ];

    (async () => {
      try {
        const { modernMaxAdapter } = await import("../../server");
        for (let i = 0; i < sampleVerses.length; i++) {
          const verse = sampleVerses[i];
          try {
            await modernMaxAdapter.sendVoice(cleanId, `План Победы: стих ${i+1}. ${verse.ru}`);
          } catch (vErr) {
            logger.error(`❌ [Bible Test] Voice send error: ${vErr}`);
          }
          await new Promise(r => setTimeout(r, 1000));
        }
      } catch (err: any) {
        logger.error(`❌ [Bible Test] Error in test broadcast: ${err.message || err}`);
      }
    })();

    return 'Запущен ручной тест: отправляю стихи Плана Победы голосом в ваш чат.';
  }

  // 2. Обработка команды «включить план победы»
  if (lower.includes('включить план победы') || lower === 'включить план' || lower === 'план победы') {
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());
    try {
      sqliteDb.prepare("INSERT OR REPLACE INTO bible_subs (chat_id, start_date, active, period_days) VALUES (?, ?, ?, ?)").run(cleanId, todayStr, 1, 365);
    } catch {}
    setPlanStatus(cleanId, 'on_buttons');
    sendImmediatePlanPobedyVerse(cleanId).catch(() => {});
    return '✅ План Победы включён! Отправляю стих дня голосом. Приятного прослушивания!';
  }

  // 3. Обработка команды «бог благ и милость его велика»
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
    return 'Команда включает План победы на год: каждый день голосовые стихи и разборы по расписанию. Это твой личный годовой план. Отключить можно той же командой, но только через 30 дней после включения. Подключаем? Ответь: да или нет.';
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
  setPlanStatus(cleanId, 'off');
  logger.info(`📖 [Bible] План победы остановлен для chat_id ${cleanId}`);
  return 'План победы остановлен. Возвращайся!';
}

const executedBibleSlots = new Set<string>();
const localBroadcastSent = new Set<string>();

async function acquireLock(slotKey: string, chatId: string): Promise<boolean> {
  const userSlotKey = `${slotKey}:${chatId}`;

  // 1. Local lock
  if (localBroadcastSent.has(userSlotKey)) {
    return false;
  }
  localBroadcastSent.add(userSlotKey);

  // Keep local set size under control
  if (localBroadcastSent.size > 10000) {
    const oldest = Array.from(localBroadcastSent).slice(0, 2000);
    oldest.forEach(k => localBroadcastSent.delete(k));
  }

  // 2. Redis lock
  try {
    const { redisService } = await import("./RedisService");
    if (redisService.isAvailable() && redisService['client']) {
      const redisKey = `lock:bible_broadcast:${slotKey}:${chatId}`;
      const res = await redisService['client'].set(redisKey, "1", "EX", 3600, "NX");
      if (res !== "OK") {
        logger.info(`♻️ [Bible] Duplicate broadcast prevented by Redis lock for ${chatId} (slot: ${slotKey})`);
        return false;
      }
    }
  } catch (err) {
    logger.warn(`⚠️ [Bible] Redis lock error for ${chatId}:`, err);
  }

  return true;
}

export async function checkAndSendBibleBroadcast(
  sendTextMessageFn?: (chatId: number, text: string, extra?: any) => Promise<void>,
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

    // Собираем всех подписчиков Плана Победы (из bible_subs и user_profiles с plan_status != 'off')
    const candidates = new Map<string, { startDate: string }>();

    try {
      const activeSubs = sqliteDb.prepare("SELECT * FROM bible_subs WHERE active = 1").all() as any[];
      for (const sub of activeSubs) {
        const cleanId = String(sub.chat_id || sub.chatId || sub.id).replace(/^[a-z_]+/, '');
        if (cleanId) {
          candidates.set(cleanId, { startDate: String(sub.start_date || sub.startDate || moscowDateStr) });
        }
      }
    } catch (err) {}

    try {
      const profileSubs = sqliteDb.prepare("SELECT chat_id FROM user_profiles WHERE plan_status IN ('on_buttons', 'on_quiet')").all() as any[];
      for (const p of profileSubs) {
        const cleanId = String(p.chat_id).replace(/^[a-z_]+/, '');
        if (cleanId && !candidates.has(cleanId)) {
          candidates.set(cleanId, { startDate: moscowDateStr });
        }
      }
    } catch (err) {}

    if (candidates.size === 0) {
      return;
    }

    for (const [cleanId, { startDate }] of candidates.entries()) {
      const numericChatId = parseInt(cleanId, 10);
      if (isNaN(numericChatId) || numericChatId <= 0) continue;

      const userSettings = getUserSettings(cleanId);
      // Если статус 'off' — не отправляем
      if (userSettings.plan_status === 'off') {
        continue;
      }

      const daysPassed = getDaysPassed(startDate);
      if (daysPassed >= 365) {
        continue;
      }

      const dayIndex = getDayIndex(startDate);
      const dayPlan = BIBLE_PLAN[dayIndex] || BIBLE_PLAN[0];
      const item = dayPlan[slotConfig.slotIndex];
      if (!item) continue;

      const lockAcquired = await acquireLock(slotKey, cleanId);
      if (!lockAcquired) {
        continue;
      }

      // Загрузка стиха
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
      const commentary = cleanForMax(`План Победы (${item.ru}): ${verseContent}. В этих словах заложено глубокое духовное наставление и мир для вашего сердца.`);

      // 1. Отправляем ТОЛЬКО голосовое сообщение
      if (sendVoiceMessageFn) {
        await sendVoiceMessageFn(numericChatId, commentary);
      } else {
        const { modernMaxAdapter } = await import("../../server");
        await modernMaxAdapter.sendVoice(numericChatId, commentary);
      }
      logger.info(`📖 [Bible] День ${dayIndex} слот ${slotConfig.slotName} отправлен голосом ${cleanId}`);

      // 2. Если plan_status === 'on_buttons': отправляем сообщение с 2 кнопками
      if (userSettings.plan_status === 'on_buttons') {
        try {
          if (sendTextMessageFn) {
            await sendTextMessageFn(numericChatId, '⚙️ Настройки Плана Победы:', PLAN_POBEDY_EXTRA);
          } else {
            const { modernMaxAdapter } = await import("../../server");
            await modernMaxAdapter.safeSendMessageToChat(numericChatId, '⚙️ Настройки Плана Победы:', PLAN_POBEDY_EXTRA);
          }
        } catch (btnErr: any) {
          logger.warn(`⚠️ [Bible] Ошибка отправки кнопок Плана Победы для ${cleanId}:`, btnErr?.message || btnErr);
        }
      }
    }
  } catch (err: any) {
    logger.error('❌ Ошибка в рассылке Библии:', { error: err?.message || err });
  }
}

export function startBibleScheduler(
  sendTextMessageFn?: (chatId: number, text: string, extra?: any) => Promise<void>,
  sendVoiceMessageFn?: (chatId: number, text: string) => Promise<void>
) {
  try {
    sqliteDb.exec("CREATE TABLE IF NOT EXISTS bible_subs (chat_id TEXT PRIMARY KEY, start_date TEXT, active INTEGER, period_days INTEGER DEFAULT 365);");
  } catch (e) {}

  setInterval(() => checkAndSendBibleBroadcast(sendTextMessageFn, sendVoiceMessageFn), 20000);
  logger.info("📖 Планировщик годовой голосовой рассылки «План победы» запущен (интервал 20 сек, зона Europe/Moscow)");
}

