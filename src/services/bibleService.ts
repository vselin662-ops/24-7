import { sqliteDb } from "../../db";
import { logger } from "../logger";
import { cleanForMax } from "../utils/textUtils";
import { 
  getUserPlanConfig, 
  updateUserPlanConfig, 
  addUserRecentMotivation, 
  RUSSIAN_TIMEZONES,
  UserPlanConfig,
  PlanStatus 
} from "./ProfileService";
import { scriptureService } from "./ScriptureService";
import { 
  oneYearPlan, 
  DayPlan, 
  getUserPlanDay, 
  getPlanDaySummary, 
  getPlanContentsSummary, 
  skipUserPlanDays, 
  isPlanFileExisting 
} from "./OneYearPlan";
import { isOwner } from "../fintech/subscriptions";
import { llmService } from "../core/LLMService";

export { 
  getUserPlanDay, 
  getPlanDaySummary, 
  getPlanContentsSummary, 
  skipUserPlanDays, 
  isPlanFileExisting 
};

export interface BibleSlotConfig {
  slotIndex: number;
  type: 'voice';
  title: string;
  slotName: string;
}

export const BIBLE_SLOTS: Record<string, BibleSlotConfig> = {
  '07:30': { slotIndex: 0, type: 'voice', title: 'Утреннее чтение Плана Победы', slotName: '07:30_утро' },
  '13:00': { slotIndex: 1, type: 'voice', title: 'Дневное чтение Плана Победы', slotName: '13:00_день' },
  '21:00': { slotIndex: 2, type: 'voice', title: 'Вечернее чтение Плана Победы', slotName: '21:00_вечер' }
};

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

export function getNearestPlanSlotTime(cfg: UserPlanConfig): string {
  const tz = cfg?.tz || 'Europe/Moscow';
  let timeStr = '12:00';
  try {
    const now = new Date();
    timeStr = new Intl.DateTimeFormat('ru-RU', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(now);
  } catch {}

  const m = cfg?.slot_times?.m || '07:30';
  const n = cfg?.slot_times?.n || '13:00';
  const e = cfg?.slot_times?.e || '21:00';

  if (timeStr < m) return m;
  if (timeStr < n) return n;
  if (timeStr < e) return e;
  return m;
}

export const PLAN_QUESTION_EXTRA = {
  attachments: [
    {
      type: 'inline_keyboard',
      payload: {
        buttons: [
          [
            { type: 'callback', text: '▶️ Включить', payload: 'plan_on' },
            { type: 'callback', text: '❌ Отключить', payload: 'plan_off' }
          ],
          [
            { type: 'callback', text: '⚙️ План Победы', payload: 'plan_open' }
          ]
        ]
      }
    }
  ]
};

export const BRIEFING_QUESTION_EXTRA = {
  attachments: [
    {
      type: 'inline_keyboard',
      payload: {
        buttons: [
          [
            { type: 'callback', text: '⚙️ Брифинг', payload: 'brief_open' }
          ]
        ]
      }
    }
  ]
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

/**
 * День года от 1 до 365 (по часовому поясу пользователя)
 */
export function getDayOfYear(tz: string = 'Europe/Moscow'): number {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric'
    });
    const parts = formatter.formatToParts(now);
    const y = parseInt(parts.find(p => p.type === 'year')?.value || '2026', 10);
    const m = parseInt(parts.find(p => p.type === 'month')?.value || '1', 10);
    const d = parseInt(parts.find(p => p.type === 'day')?.value || '1', 10);

    const start = new Date(Date.UTC(y, 0, 1));
    const current = new Date(Date.UTC(y, m - 1, d));
    const diff = current.getTime() - start.getTime();
    const day = Math.floor(diff / (1000 * 60 * 60 * 24)) + 1;
    return Math.min(Math.max(day, 1), 365);
  } catch {
    return 1;
  }
}

export function getLocalTimeAndDate(tz: string = 'Europe/Moscow'): { timeStr: string; dateStr: string } {
  const now = new Date();
  const timeStr = new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(now);

  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz
  }).format(now);

  return { timeStr, dateStr };
}

/**
 * Проверка и запись в plan_sent_logs (строгая идемпотентность)
 */
export function markPlanSlotSent(chatId: string, slot: string, dateStr: string): boolean {
  if (!sqliteDb) return true;
  try {
    const exists = sqliteDb.prepare("SELECT 1 FROM plan_sent_logs WHERE chat_id = ? AND slot = ? AND date_str = ?")
      .get(chatId, slot, dateStr);
    if (exists) return false;

    sqliteDb.prepare("INSERT OR REPLACE INTO plan_sent_logs (chat_id, slot, date_str, created_at) VALUES (?, ?, ?, ?)")
      .run(chatId, slot, dateStr, Date.now());
    return true;
  } catch (err) {
    logger.warn(`⚠️ [Plan] Failed to check/mark plan_sent_logs for ${chatId}:`, err);
    return true;
  }
}

export function isPlanSlotAlreadySent(chatId: string, slot: string, dateStr: string): boolean {
  if (!sqliteDb) return false;
  try {
    const row = sqliteDb.prepare("SELECT 1 FROM plan_sent_logs WHERE chat_id = ? AND slot = ? AND date_str = ?")
      .get(chatId, slot, dateStr);
    return !!row;
  } catch {
    return false;
  }
}

/**
 * Получение священного текста для слота Плана Победы
 */
export async function getSlotScripture(dayNum: number, slot: 'm' | 'n' | 'e'): Promise<{ refStr: string; text: string }> {
  const plan: DayPlan = oneYearPlan.getPlanForDay(dayNum);
  
  if (slot === 'm') {
    // Утро: Ветхий Завет
    const morningReading = plan.morning[0];
    if (!morningReading) {
      const res = await scriptureService.getChapter('Бытие', 1, 5);
      return { refStr: 'Бытие 1', text: res?.text || '📖 Источник Писания временно недоступен.' };
    }
    const res = await scriptureService.getChapter(morningReading.b, morningReading.c, 5);
    const refStr = `${morningReading.b}, глава ${morningReading.c}`;
    return { refStr, text: res?.text || '📖 Источник Писания временно недоступен.' };
  }

  if (slot === 'n') {
    // День: Новый Завет / Евангелие
    const noonReading = plan.noon[0];
    if (!noonReading) {
      const res = await scriptureService.getChapter('От Матфея', 1, 5);
      return { refStr: 'Матфея 1', text: res?.text || '📖 Источник Писания временно недоступен.' };
    }
    const res = await scriptureService.getChapter(noonReading.b, noonReading.c, 5);
    const refStr = `${noonReading.b}, глава ${noonReading.c}`;
    return { refStr, text: res?.text || '📖 Источник Писания временно недоступен.' };
  }

  // Вечер: Псалом + Притчи
  const psalmNum = plan.evening.psalm.c;
  const proverbCh = plan.evening.proverb.c;

  const psalmRes = await scriptureService.getChapter('Псалтирь', psalmNum, 4);
  const proverbRes = await scriptureService.getPassage('Притчи', proverbCh, { start: 1, end: 3 });

  const refStr = `Псалом ${psalmNum} и Притчи ${proverbCh}:1-3`;
  const psalmText = psalmRes?.text || '';
  const proverbText = proverbRes?.text || '';

  const combinedText = `[Псалом ${psalmNum}]\n${psalmText}\n\n[Притчи ${proverbCh}:1-3]\n${proverbText}`.trim();
  return { refStr, text: combinedText || '📖 Источник Писания временно недоступен.' };
}

/**
 * Генерация разбора и мотивации через LLM
 */
export async function generateAnalysisAndMotivation(
  chatId: string,
  refStr: string,
  scriptureText: string,
  slot: 'm' | 'n' | 'e'
): Promise<{ analysis: string; motivation: string }> {
  if (!scriptureText || scriptureText.includes('временно недоступен')) {
    return {
      analysis: 'Слово Божие — светильник ноге моей и свет стезе моей.',
      motivation: 'Сохраняйте мир в сердце и уповайте на Господа в любых обстоятельствах.'
    };
  }

  const userPlanConfig = getUserPlanConfig(chatId);
  const recentMotivations = userPlanConfig.recent_motivations || [];
  const isEvening = slot === 'e';

  const systemPrompt = "Цитируй ТОЛЬКО переданный текст. Мотивация = одно конкретное действие.";
  const userPrompt = `Священный текст (${refStr}):\n«${scriptureText}»\n\nНедавние мотивации (не повторяй их ни в коем случае): ${recentMotivations.join('; ')}\n\nДай:\n1. Духовный разбор из 3-5 предложений (литературный русский язык, теплота, исторический контекст и применение).\n2. Одну конкретную практическую мотивацию на сегодня (${isEvening ? 'с краткой молитвой благодарения Богу на сон грядущим' : 'одно ясное и полезное духовное или жизненное действие'}).\n\nФормат ответа:\nРАЗБОР: <текст>\nМОТИВАЦИЯ: <текст>`;

  try {
    const raw = await llmService.smartCall(`plan_analysis_${chatId}_${slot}`, userPrompt, systemPrompt);
    let analysis = '';
    let motivation = '';

    const analysisMatch = raw.match(/РАЗБОР:\s*([\s\S]*?)(?=МОТИВАЦИЯ:|$)/i);
    const motivationMatch = raw.match(/МОТИВАЦИЯ:\s*([\s\S]*?)$/i);

    if (analysisMatch && analysisMatch[1]) {
      analysis = analysisMatch[1].trim();
    }
    if (motivationMatch && motivationMatch[1]) {
      motivation = motivationMatch[1].trim();
    }

    if (!analysis) {
      analysis = cleanForMax(raw.substring(0, 400));
    }
    if (!motivation) {
      motivation = 'Поблагодарите сегодня Бога за прожитый день и проявите доброту к ближнему.';
    }

    addUserRecentMotivation(chatId, motivation);

    return { analysis: cleanForMax(analysis), motivation: cleanForMax(motivation) };
  } catch (err: any) {
    logger.warn(`⚠️ [Plan] LLM analysis fallback for ${chatId}:`, err?.message || err);
    return {
      analysis: 'В этих священных строках заключена мудрость веков и поддержка для верующего сердца.',
      motivation: 'Сделайте сегодня одно доброе дело во славу Божию.'
    };
  }
}

/**
 * Сборка и отправка одного слота Плана Победы для конкретного пользователя
 */
export async function sendPlanSlotToUser(
  chatId: string,
  slot: 'm' | 'n' | 'e',
  sendTextMessageFn?: (chatId: number, text: string, extra?: any) => Promise<void>,
  sendVoiceMessageFn?: (chatId: number, text: string) => Promise<void>
): Promise<boolean> {
  const numericId = parseInt(chatId, 10);
  if (isNaN(numericId) || numericId <= 0) return false;

  const planConfig = getUserPlanConfig(chatId);
  const tz = planConfig.tz || 'Europe/Moscow';
  const dayNum = getUserPlanDay(chatId);
  const { dateStr } = getLocalTimeAndDate(tz);

  if (!markPlanSlotSent(chatId, slot, dateStr)) {
    return false;
  }

  const { refStr, text: scriptureText } = await getSlotScripture(dayNum, slot);
  const { analysis, motivation } = await generateAnalysisAndMotivation(chatId, refStr, scriptureText, slot);

  const slotTitle = slot === 'm' ? 'Утреннее чтение' : slot === 'n' ? 'Дневное чтение' : 'Вечернее чтение';
  const fullText = cleanForMax(`🕊 План Победы (День ${dayNum}/365 — ${slotTitle}: ${refStr}).\n\n«${scriptureText}»\n\n💭 Разбор:\n${analysis}\n\n💪 Мотивация на сегодня:\n${motivation}`);

  try {
    if (planConfig.voice_on !== 0) {
      try {
        if (sendVoiceMessageFn) {
          await sendVoiceMessageFn(numericId, fullText);
        } else {
          const { modernMaxAdapter } = await import("../../server");
          await modernMaxAdapter.sendVoice(numericId, fullText);
        }
      } catch (voiceErr: any) {
        logger.warn(`⚠️ [Plan] Voice delivery failed for ${chatId}, falling back to text: ${voiceErr?.message || voiceErr}`);
        if (sendTextMessageFn) {
          await sendTextMessageFn(numericId, fullText);
        } else {
          const { modernMaxAdapter } = await import("../../server");
          await modernMaxAdapter.safeSendMessageToChat(numericId, fullText);
        }
      }
    } else {
      if (sendTextMessageFn) {
        await sendTextMessageFn(numericId, fullText);
      } else {
        const { modernMaxAdapter } = await import("../../server");
        await modernMaxAdapter.safeSendMessageToChat(numericId, fullText);
      }
    }

    logger.info(`🕊 [Plan] chat=${chatId} slot=${slot} day=${dayNum} ref=${refStr} status=sent`);

    if (planConfig.plan_status === 'on_buttons') {
      try {
        const buttonsMsg = '⚙️ Настройки Плана Победы:';
        if (sendTextMessageFn) {
          await sendTextMessageFn(numericId, buttonsMsg, PLAN_POBEDY_EXTRA);
        } else {
          const { modernMaxAdapter } = await import("../../server");
          await modernMaxAdapter.safeSendMessageToChat(numericId, buttonsMsg, PLAN_POBEDY_EXTRA);
        }
      } catch (btnErr) {
        logger.warn(`⚠️ [Plan] Button sending failed for ${chatId}:`, btnErr);
      }
    }

    return true;
  } catch (err: any) {
    logger.error(`❌ [Plan] Error delivering slot ${slot} to ${chatId}:`, err?.message || err);
    return false;
  }
}

export async function sendImmediatePlanPobedyVerse(
  chatId: string | number,
  sendVoiceMessageFn?: (chatId: number, text: string) => Promise<void>,
  sendTextMessageFn?: (chatId: number, text: string, extra?: any) => Promise<void>
): Promise<void> {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  const config = getUserPlanConfig(cleanId);
  const now = new Date();
  const hour = parseInt(new Intl.DateTimeFormat('ru-RU', { timeZone: config.tz || 'Europe/Moscow', hour: '2-digit', hour12: false }).format(now), 10);
  
  let slot: 'm' | 'n' | 'e' = 'm';
  if (hour >= 12 && hour < 18) slot = 'n';
  else if (hour >= 18) slot = 'e';

  await sendPlanSlotToUser(cleanId, slot, sendTextMessageFn, sendVoiceMessageFn);
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

  const pendingTimestamp = biblePendingConfirmations.get(cleanId);
  if (pendingTimestamp) {
    if (now - pendingTimestamp <= 5 * 60 * 1000) {
      if (lower === 'да' || lower.startsWith('да ') || lower.startsWith('да,') || lower.startsWith('да.')) {
        biblePendingConfirmations.delete(cleanId);
        updateUserPlanConfig(cleanId, { plan_enabled: 1, plan_status: 'on_buttons' });
        try {
          sqliteDb?.prepare("INSERT OR REPLACE INTO bible_subs (chat_id, start_date, active, period_days) VALUES (?, ?, ?, ?)")
            .run(cleanId, new Date().toISOString().slice(0, 10), 1, 365);
        } catch {}

        sendImmediatePlanPobedyVerse(cleanId).catch(() => {});
        return 'План победы подключён на 365 дней. Отправляю первый стих голосом. Благословений!';
      }

      if (lower === 'нет' || lower.startsWith('нет ') || lower.startsWith('нет,') || lower.startsWith('нет.')) {
        biblePendingConfirmations.delete(cleanId);
        return 'Хорошо, не подключаю. Если передумаешь — просто скажи команду.';
      }
    } else {
      biblePendingConfirmations.delete(cleanId);
    }
  }

  if (lower.includes('включить план победы') || lower === 'включить план' || lower === 'plan_on' || lower === '/plan_on') {
    updateUserPlanConfig(cleanId, { plan_enabled: 1, plan_status: 'on_buttons' });
    try {
      sqliteDb?.prepare("INSERT OR REPLACE INTO bible_subs (chat_id, start_date, active, period_days) VALUES (?, ?, ?, ?)")
        .run(cleanId, new Date().toISOString().slice(0, 10), 1, 365);
    } catch {}
    sendImmediatePlanPobedyVerse(cleanId).catch(() => {});
    return '✅ План Победы включён! Отправляю стих дня голосом. Приятного прослушивания!';
  }

  // === КОМАНДА 1: 'план на сегодня' ===
  if (
    lower === 'план на сегодня' ||
    lower === 'план сегодня' ||
    lower === 'план_на_сегодня' ||
    lower === '/plan_today'
  ) {
    return getPlanDaySummary(cleanId, false);
  }

  // === КОМАНДА 2: 'план на завтра' ===
  if (
    lower === 'план на завтра' ||
    lower === 'план завтра' ||
    lower === 'план_на_завтра' ||
    lower === '/plan_tomorrow'
  ) {
    return getPlanDaySummary(cleanId, true);
  }

  // === КОМАНДА 3: 'план содержание' (только OWNER) ===
  if (
    lower === 'план содержание' ||
    lower === 'план_содержание' ||
    lower === '/plan_contents' ||
    lower === '/plan_content'
  ) {
    if (isOwner(cleanId)) {
      return getPlanContentsSummary();
    }
    return null; // от не-владельца -> игнор
  }

  // === КОМАНДА 4: 'план пропустить <N дней>' (только OWNER) ===
  const skipMatch = lower.match(/^план\s+пропустить\s+(-?\d+)(?:\s+дн[еяй]|\s+дня|\s+дней)?/i) ||
    lower.match(/^\/plan_skip\s+(-?\d+)/i);
  if (skipMatch) {
    if (isOwner(cleanId)) {
      const skipDays = parseInt(skipMatch[1], 10);
      return skipUserPlanDays(cleanId, skipDays);
    }
    return null; // от не-владельца -> игнор
  }

  const isPlanQuestion = /план[а-я]*\s+побед[а-я]*/i.test(lower) || /побед[а-я]*\s+план[а-я]*/i.test(lower) || lower === 'план победы' || lower === 'план_победы';
  if (isPlanQuestion) {
    logger.info(`❓ [Intent] fn=plan chat=${cleanId}`);
    const cfg = getUserPlanConfig(cleanId);
    const isEnabled = (cfg.plan_status === 'on_buttons' || cfg.plan_status === 'on_quiet' || cfg.plan_enabled === 1) && cfg.plan_status !== 'off';
    const statusStr = isEnabled ? 'включён' : 'отключён';
    const nextSlot = getNearestPlanSlotTime(cfg);
    return `🕊 План Победы: ${statusStr}. Ближайшее голосовое: ${nextSlot}. Утро=ВЗ, обед=НЗ, вечер=Псалом+Притчи.`;
  }

  if (lower === 'тест рассылки' || lower === 'тест_рассылки') {
    logger.info(`📖 [Bible Test] Running manual test broadcast for chatId ${cleanId}`);
    sendPlanSlotToUser(cleanId, 'm').catch(() => {});
    return 'Запущен ручной тест: отправляю чтение Плана Победы голосом в ваш чат.';
  }

  if (lower.includes('бог благ и милость его велика')) {
    const config = getUserPlanConfig(cleanId);
    if (config.plan_enabled === 1 && config.plan_status !== 'off') {
      updateUserPlanConfig(cleanId, { plan_enabled: 0, plan_status: 'off' });
      try {
        sqliteDb?.prepare("UPDATE bible_subs SET active = 0 WHERE chat_id = ?").run(cleanId);
      } catch {}
      return 'План победы остановлен. Возвращайся!';
    } else {
      biblePendingConfirmations.set(cleanId, Date.now());
      return 'Команда включает План победы на год: каждый день голосовые стихи и разборы по расписанию. Это твой личный годовой план. Отключить можно той же командой. Подключаем? Ответь: да или нет.';
    }
  }

  return null;
}

export async function checkAndSendBibleBroadcast(
  sendTextMessageFn?: (chatId: number, text: string, extra?: any) => Promise<void>,
  sendVoiceMessageFn?: (chatId: number, text: string) => Promise<void>
) {
  if (!sqliteDb) return;
  try {
    const users = sqliteDb.prepare(`
      SELECT chat_id, plan_status, plan_enabled, tz, slot_times, voice_on 
      FROM user_profiles 
      WHERE (plan_enabled = 1 OR plan_status IN ('on_buttons', 'on_quiet'))
    `).all() as any[];

    if (!users || users.length === 0) return;

    for (const u of users) {
      const cleanId = String(u.chat_id).replace(/^[a-z_]+/, '');
      if (u.plan_status === 'off') continue;

      const tz = u.tz || 'Europe/Moscow';
      let slot_times = { m: '07:30', n: '13:00', e: '21:00' };
      if (u.slot_times) {
        try {
          slot_times = { ...slot_times, ...JSON.parse(u.slot_times) };
        } catch {}
      }

      const { timeStr, dateStr } = getLocalTimeAndDate(tz);

      let targetSlot: 'm' | 'n' | 'e' | null = null;
      if (timeStr === slot_times.m) {
        targetSlot = 'm';
      } else if (timeStr === slot_times.n) {
        targetSlot = 'n';
      } else if (timeStr === slot_times.e) {
        targetSlot = 'e';
      }

      if (!targetSlot) continue;

      if (isPlanSlotAlreadySent(cleanId, targetSlot, dateStr)) {
        continue;
      }

      await sendPlanSlotToUser(cleanId, targetSlot, sendTextMessageFn, sendVoiceMessageFn);
    }
  } catch (err: any) {
    logger.error('❌ [Plan] Error in Plan Pobedy scheduler:', err);
  }
}

export function getPlanStatistics(): string {
  if (!sqliteDb) return 'База данных недоступна.';
  try {
    const totalActive = (sqliteDb.prepare("SELECT COUNT(*) as count FROM user_profiles WHERE plan_status IN ('on_buttons', 'on_quiet')").get() as any)?.count || 0;
    const totalQuiet = (sqliteDb.prepare("SELECT COUNT(*) as count FROM user_profiles WHERE plan_status = 'on_quiet'").get() as any)?.count || 0;
    const totalOff = (sqliteDb.prepare("SELECT COUNT(*) as count FROM user_profiles WHERE plan_status = 'off'").get() as any)?.count || 0;
    
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const sentLast24h = (sqliteDb.prepare("SELECT COUNT(*) as count FROM plan_sent_logs WHERE created_at >= ?").get(oneDayAgo) as any)?.count || 0;
    const briefingCount = (sqliteDb.prepare("SELECT COUNT(*) as count FROM user_profiles WHERE briefing_enabled = 1").get() as any)?.count || 0;

    return `📊 **Статистика Spirit Core**:\n\n` +
      `🕊 **План Победы**:\n` +
      `• Активных подписчиков: ${totalActive}\n` +
      `• В тихом режиме: ${totalQuiet}\n` +
      `• Отключено: ${totalOff}\n` +
      `• Отправлено слотов за 24ч: ${sentLast24h}\n\n` +
      `☀️ **Утренний брифинг**:\n` +
      `• Активных подписчиков: ${briefingCount}`;
  } catch (err: any) {
    return `Ошибка получения статистики: ${err?.message || err}`;
  }
}

export function startBibleScheduler(
  sendTextMessageFn?: (chatId: number, text: string, extra?: any) => Promise<void>,
  sendVoiceMessageFn?: (chatId: number, text: string) => Promise<void>
) {
  setInterval(() => checkAndSendBibleBroadcast(sendTextMessageFn, sendVoiceMessageFn), 20000);
  logger.info("🕊 Планировщик Плана Победы v2 запущен (интервал 20 сек)");
}
