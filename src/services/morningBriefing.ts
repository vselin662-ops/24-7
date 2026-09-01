import { sqliteDb } from '../../db';
import { logger } from '../logger';
import { getSubscription, isOwner } from '../fintech/subscriptions';
import { 
  getUserBriefingConfig, 
  updateUserBriefingConfig, 
  getUserPlanConfig, 
  getUserSettings,
  BriefingConfig 
} from './ProfileService';
import { scriptureService } from './ScriptureService';
import { oneYearPlan } from './OneYearPlan';
import { getDayOfYear, getLocalTimeAndDate } from './bibleService';
import { cleanForMax } from '../utils/textUtils';

export const DISABLE_BRIEFING_BUTTONS = [
  [
    { type: 'callback', text: '🔕 Отключить брифинг', payload: 'briefing_off' }
  ]
];

export const DISABLE_BRIEFING_EXTRA = {
  attachments: [
    {
      type: 'inline_keyboard',
      payload: {
        buttons: DISABLE_BRIEFING_BUTTONS
      }
    }
  ]
};

export interface WeatherData {
  temp_C: string;
  feelsLike_C: string;
  windspeedKmph: string;
  description: string;
}

/**
 * Получение погоды через wttr.in format=j2 (только метрические единицы, русский язык)
 */
export async function fetchWeatherForUser(cityOrLocation: string): Promise<string> {
  const query = encodeURIComponent(cityOrLocation.trim() || 'Moscow');
  try {
    const res = await fetch(`https://wttr.in/${query}?format=j2&lang=ru`, {
      signal: AbortSignal.timeout(8000),
      headers: {
        'Accept-Language': 'ru,ru-RU;q=0.9,en;q=0.8',
        'User-Agent': 'curl/7.88.1'
      }
    });

    if (res.ok) {
      const data: any = await res.json();
      const curr = data?.current_condition?.[0];
      if (curr) {
        const temp = curr.temp_C ? (Number(curr.temp_C) > 0 ? `+${curr.temp_C}` : curr.temp_C) : '+15';
        const feels = curr.FeelsLikeC ? (Number(curr.FeelsLikeC) > 0 ? `+${curr.FeelsLikeC}` : curr.FeelsLikeC) : temp;
        const wind = curr.windspeedKmph ? `${curr.windspeedKmph} км/ч` : '5 км/ч';
        const desc = curr.lang_ru?.[0]?.value || curr.weatherDesc?.[0]?.value || 'ясно';

        const feelsPart = feels !== temp ? ` (ощущается как ${feels}°C)` : '';
        return `${temp}°C${feelsPart}, ${desc.toLowerCase()}, ветер ${wind}`;
      }
    }
  } catch (err: any) {
    logger.warn(`⚠️ [MorningBriefing] Weather j2 fetch failed for ${cityOrLocation}:`, err?.message || err);
  }

  // Фолбэк на короткий текстовый запрос
  try {
    const res = await fetch(`https://wttr.in/${query}?format=%t,+%C,+ветер+%w&lang=ru`, {
      signal: AbortSignal.timeout(5000),
      headers: { 'Accept-Language': 'ru' }
    });
    if (res.ok) {
      const text = (await res.text()).trim();
      if (text && !text.includes('<html') && !text.includes('Unknown location')) {
        return text;
      }
    }
  } catch {}

  return 'погода недоступна';
}

/**
 * Идемпотентная отметка об отправке утреннего брифинга
 */
export function markBriefingSent(chatId: string, dateStr: string): boolean {
  if (!sqliteDb) return true;
  try {
    const exists = sqliteDb.prepare("SELECT 1 FROM briefing_sent_logs WHERE chat_id = ? AND date_str = ?")
      .get(chatId, dateStr);
    if (exists) return false;

    sqliteDb.prepare("INSERT OR REPLACE INTO briefing_sent_logs (chat_id, date_str, created_at) VALUES (?, ?, ?)")
      .run(chatId, dateStr, Date.now());
    return true;
  } catch (err) {
    logger.warn(`⚠️ [Briefing] Failed to mark briefing_sent_logs for ${chatId}:`, err);
    return true;
  }
}

export function isBriefingAlreadySent(chatId: string, dateStr: string): boolean {
  if (!sqliteDb) return false;
  try {
    const row = sqliteDb.prepare("SELECT 1 FROM briefing_sent_logs WHERE chat_id = ? AND date_str = ?")
      .get(chatId, dateStr);
    return !!row;
  } catch {
    return false;
  }
}

/**
 * Генерация полного текста брифинга для конкретного пользователя
 */
export async function buildUserMorningBriefing(chatId: string, userName?: string): Promise<string> {
  const config: BriefingConfig = getUserBriefingConfig(chatId);
  const userSettings = getUserSettings(chatId);
  const tz = userSettings.tz || 'Europe/Moscow';
  const name = userName ? userName.split(' ')[0] : 'друг';

  const parts: string[] = [`☀️ Доброе утро, ${name}!`];

  // 1. Погода
  if (config.include_weather) {
    const cityTarget = config.lat && config.lon ? `${config.lat},${config.lon}` : (config.city || 'Москва');
    const weather = await fetchWeatherForUser(cityTarget);
    const cityName = config.city || 'вашем городе';
    if (weather === 'погода недоступна') {
      parts.push('Погода недоступна.');
    } else {
      parts.push(`В ${cityName}: ${weather}.`);
    }
  }

  // 2. Притча: глава = числу дня месяца (1-31), 2-3 стиха
  if (config.include_parable) {
    try {
      const now = new Date();
      const dayOfMonth = parseInt(new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric' }).format(now), 10) || 1;
      const parableRes = await scriptureService.getPassage('Притчи', dayOfMonth, { start: 1, end: 3 });
      if (parableRes?.text && !parableRes.text.includes('недоступен')) {
        parts.push(`Притча ${dayOfMonth}: «${parableRes.text}»`);
      }
    } catch (pErr) {
      logger.warn(`⚠️ [Briefing] Parable error for ${chatId}:`, pErr);
    }
  }

  // 3. Псалом: randomPsalm(chatId) с не-повторением 3 дня
  if (config.include_psalm) {
    try {
      const psalm = await scriptureService.randomPsalm(chatId);
      if (psalm?.text && !psalm.text.includes('недоступен')) {
        parts.push(`Псалом ${psalm.psalmNum}: «${psalm.text}»`);
      }
    } catch (psErr) {
      logger.warn(`⚠️ [Briefing] Psalm error for ${chatId}:`, psErr);
    }
  }

  // 4. Стих дня: из сегодняшнего чтения Плана Победы
  if (config.include_verse) {
    try {
      const dayNum = getDayOfYear(tz);
      const plan = oneYearPlan.getPlanForDay(dayNum);
      const reading = plan.morning[0] || { b: 'Бытие', c: 1 };
      const verseRes = await scriptureService.getPassage(reading.b, reading.c, { start: 1, end: 1 });
      if (verseRes?.text && !verseRes.text.includes('недоступен')) {
        parts.push(`Стих дня (${reading.b} ${reading.c}:1): «${verseRes.text}»`);
      }
    } catch (vErr) {
      logger.warn(`⚠️ [Briefing] Verse error for ${chatId}:`, vErr);
    }
  }

  parts.push('Хорошего и благословенного дня! 🙏');
  return cleanForMax(parts.join(' '));
}

/**
 * Отправка брифинга конкретному пользователю
 */
export async function sendMorningBriefingToUser(
  chatId: string | number,
  userName?: string,
  sendTextMessageFn?: (chatId: number, text: string, extra?: any) => Promise<void>,
  sendVoiceMessageFn?: (chatId: number, text: string) => Promise<void>,
  force: boolean = false
): Promise<boolean> {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '').trim();
  const numericId = parseInt(cleanId, 10);
  if (isNaN(numericId) || numericId <= 0) return false;

  const userSettings = getUserSettings(cleanId);
  const briefingConfig = getUserBriefingConfig(cleanId);
  const planConfig = getUserPlanConfig(cleanId);
  const tz = userSettings.tz || 'Europe/Moscow';
  const { dateStr } = getLocalTimeAndDate(tz);

  if (!force && isBriefingAlreadySent(cleanId, dateStr)) {
    return false;
  }

  let text = '';
  try {
    text = await buildUserMorningBriefing(cleanId, userName);
  } catch (buildErr: any) {
    logger.warn(`⚠️ [Briefing] err Failed to build full briefing for ${cleanId}: ${buildErr?.message || buildErr}`);
    const name = userName ? userName.split(' ')[0] : 'друг';
    text = `☀️ Доброе утро, ${name}! Желаю вам благословенного, мирного и продуктивного дня! 🙏`;
  }

  let delivered = false;

  try {
    if (planConfig.voice_on !== 0) {
      try {
        if (sendVoiceMessageFn) {
          await sendVoiceMessageFn(numericId, text);
          delivered = true;
        } else {
          const { modernMaxAdapter } = await import('../../server');
          await modernMaxAdapter.sendVoice(numericId, text);
          delivered = true;
        }
      } catch (voiceErr: any) {
        logger.warn(`⚠️ [Briefing] err Voice delivery failed for chat=${cleanId}, falling back to text: ${voiceErr?.message || voiceErr}`);
        console.warn(`⚠️ [Briefing] err Voice delivery failed for chat=${cleanId}, falling back to text`);
        // Fallback to text
        if (sendTextMessageFn) {
          await sendTextMessageFn(numericId, text, DISABLE_BRIEFING_EXTRA);
          delivered = true;
        } else {
          const { modernMaxAdapter } = await import('../../server');
          await modernMaxAdapter.safeSendMessageToChat(numericId, text, DISABLE_BRIEFING_EXTRA);
          delivered = true;
        }
      }
    } else {
      if (sendTextMessageFn) {
        await sendTextMessageFn(numericId, text, DISABLE_BRIEFING_EXTRA);
        delivered = true;
      } else {
        const { modernMaxAdapter } = await import('../../server');
        await modernMaxAdapter.safeSendMessageToChat(numericId, text, DISABLE_BRIEFING_EXTRA);
        delivered = true;
      }
    }

    if (delivered) {
      if (!force) {
        markBriefingSent(cleanId, dateStr);
      }
      const cityName = briefingConfig.city || 'Москва';
      logger.info(`☀️ [Briefing] sent chat=${cleanId} city=${cityName}`);
      console.log(`☀️ [Briefing] sent chat=${cleanId} city=${cityName}`);
      return true;
    }

    return false;
  } catch (err: any) {
    const reason = err?.message || String(err);
    logger.error(`⚠️ [Briefing] err Delivery failed for chat=${cleanId}: ${reason}`);
    console.error(`⚠️ [Briefing] err Delivery failed for chat=${cleanId}: ${reason}`);
    return false;
  }
}

/**
 * Проверка расписания брифинга для всех пользователей (тик каждую минуту)
 */
export async function checkAndSendMorningBriefings(
  sendTextMessageFn?: (chatId: number, text: string, extra?: any) => Promise<void>,
  sendVoiceMessageFn?: (chatId: number, text: string) => Promise<void>
) {
  if (!sqliteDb) return;
  try {
    // Получаем всех потенциальных пользователей из базы
    let candidateRows: any[] = [];
    try {
      candidateRows = sqliteDb.prepare(`
        SELECT DISTINCT chat_id FROM (
          SELECT chat_id FROM user_profiles WHERE (briefing_enabled IS NULL OR briefing_enabled != 0)
          UNION
          SELECT chat_id FROM subscriptions WHERE active = 1
          UNION
          SELECT chat_id FROM user_sessions
          UNION
          SELECT chat_id FROM users
        )
      `).all() as any[];
    } catch {
      try {
        candidateRows = sqliteDb.prepare(`
          SELECT chat_id FROM user_profiles WHERE (briefing_enabled IS NULL OR briefing_enabled != 0)
        `).all() as any[];
      } catch {}
    }

    if (!candidateRows || candidateRows.length === 0) return;

    for (const row of candidateRows) {
      const cleanId = String(row.chat_id || '').replace(/^[a-z_]+/, '').trim();
      const numericId = parseInt(cleanId, 10);
      if (isNaN(numericId) || numericId <= 0) continue;

      try {
        const sub = getSubscription(cleanId);
        const isSubActive = !!(sub && Number(sub.active) === 1 && sub.paid_until && new Date(sub.paid_until).getTime() > Date.now());
        const isUserOwner = isOwner(cleanId);

        if (!isSubActive && !isUserOwner) {
          continue;
        }

        const cfg: BriefingConfig = getUserBriefingConfig(cleanId);
        if (cfg.briefing_enabled === 0) continue;

        const userSettings = getUserSettings(cleanId);
        const tz = userSettings.tz || 'Europe/Moscow';
        const { timeStr, dateStr } = getLocalTimeAndDate(tz);

        const targetTime = (cfg.time || '07:00').trim();
        const normTarget = targetTime.length === 4 ? `0${targetTime}` : targetTime;
        const normCurrent = timeStr.length === 4 ? `0${timeStr}` : timeStr;

        if (normCurrent !== normTarget) continue;

        if (isBriefingAlreadySent(cleanId, dateStr)) {
          continue;
        }

        let userName = '';
        try {
          const userRow = sqliteDb.prepare("SELECT name, username FROM users WHERE chat_id = ?").get(cleanId) as any;
          userName = userRow?.name || userRow?.username || '';
        } catch {}

        await sendMorningBriefingToUser(cleanId, userName, sendTextMessageFn, sendVoiceMessageFn, false);
      } catch (userLoopErr: any) {
        const reason = userLoopErr?.message || String(userLoopErr);
        logger.error(`⚠️ [Briefing] err Processing user ${cleanId}: ${reason}`);
        console.error(`⚠️ [Briefing] err Processing user ${cleanId}: ${reason}`);
      }
    }
  } catch (err: any) {
    const reason = err?.message || String(err);
    logger.error(`⚠️ [Briefing] err Scheduler run error: ${reason}`);
    console.error(`⚠️ [Briefing] err Scheduler run error: ${reason}`);
  }
}

export function startMorningScheduler(
  sendTextMessageFn?: (chatId: number, text: string, extra?: any) => Promise<void>,
  sendVoiceMessageFn?: (chatId: number, text: string) => Promise<void>
) {
  // Крон тикает каждую минуту (60 000 мс)
  setInterval(() => {
    checkAndSendMorningBriefings(sendTextMessageFn, sendVoiceMessageFn).catch((err) => {
      logger.error(`⚠️ [Briefing] err Cron tick failed: ${err?.message || err}`);
    });
  }, 60000);

  // Выполняем первую проверку сразу при старте (с задержкой 3 сек)
  setTimeout(() => {
    checkAndSendMorningBriefings(sendTextMessageFn, sendVoiceMessageFn).catch(() => {});
  }, 3000);

  logger.info("☀️ [Briefing] Планировщик утреннего брифинга запущен (тик каждую минуту)");
}
