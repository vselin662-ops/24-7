import { sqliteDb } from '../../db';
import { logger } from '../logger';
import { getSubscription, isOwner } from '../fintech/subscriptions';
import { getUserSettings } from './ProfileService';
import { BIBLE_PLAN } from '../data/biblePlan';
import { getDayIndex } from './bibleService';
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

export async function fetchWeatherSummary(): Promise<string> {
  try {
    const res = await fetch('https://wttr.in/Moscow?format=%t,+%C,+ветер+%w', {
      signal: AbortSignal.timeout(8000),
      headers: {
        'Accept-Language': 'ru,ru-RU;q=0.9,en;q=0.8'
      }
    });
    if (res.ok) {
      const weather = (await res.text()).trim();
      if (weather && weather.length > 0 && !weather.includes('<html') && !weather.includes('Unknown location')) {
        return weather;
      }
    }
  } catch (err: any) {
    logger.warn('⚠️ [MorningBriefing] Weather fetch failed:', err?.message || err);
  }

  // Фолбэк на краткий формат
  try {
    const res = await fetch('https://wttr.in/Moscow?format=%t,+%C', {
      signal: AbortSignal.timeout(5000),
      headers: { 'Accept-Language': 'ru' }
    });
    if (res.ok) {
      const weather = (await res.text()).trim();
      if (weather && weather.length > 0 && !weather.includes('<html')) {
        return weather;
      }
    }
  } catch {}

  return '+15°C, ясно, ветер легкий';
}

export async function getTodayVerseSummary(chatId: string): Promise<string> {
  try {
    let startDate: string | null = null;
    if (sqliteDb) {
      try {
        const row = sqliteDb.prepare("SELECT start_date FROM bible_subs WHERE chat_id = ?").get(chatId) as any;
        if (row?.start_date) {
          startDate = row.start_date;
        }
      } catch {}
    }

    const moscowDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());
    const dayIndex = getDayIndex(startDate || moscowDateStr);
    const dayPlan = BIBLE_PLAN[dayIndex] || BIBLE_PLAN[0];
    const item = dayPlan[0]; // Первый стих дня (например, Псалом)

    if (item) {
      let verseText = '';
      try {
        const res = await fetch('https://bible-api.com/' + encodeURIComponent(item.en) + '?translation=russian', {
          signal: AbortSignal.timeout(6000)
        });
        if (res.ok) {
          const data: any = await res.json();
          verseText = (data?.text || '').trim().replace(/\s+/g, ' ');
        }
      } catch {}

      if (verseText) {
        return `«${verseText}» (${item.ru})`;
      }
      return `${item.ru}`;
    }
  } catch (err: any) {
    logger.warn('⚠️ [MorningBriefing] Verse fetch failed:', err?.message || err);
  }

  return 'Господь — Пастырь мой; я ни в чем не буду нуждаться (Псалтирь 22:1)';
}

export async function sendMorningBriefingToAll(
  sendText: (chatId: number, text: string, extra?: any) => Promise<void>
) {
  try {
    const candidateIds = new Set<string>();

    // 1. Из таблицы subscriptions
    if (sqliteDb) {
      try {
        const subRows = sqliteDb.prepare("SELECT chat_id FROM subscriptions WHERE active = 1").all() as any[];
        for (const r of subRows) {
          if (r.chat_id) candidateIds.add(String(r.chat_id).replace(/^[a-z_]+/, ''));
        }
      } catch {}

      // 2. Из таблицы user_profiles
      try {
        const profRows = sqliteDb.prepare("SELECT chat_id FROM user_profiles WHERE briefing_enabled = 1").all() as any[];
        for (const r of profRows) {
          if (r.chat_id) candidateIds.add(String(r.chat_id).replace(/^[a-z_]+/, ''));
        }
      } catch {}

      // 3. Из таблицы users
      try {
        const userRows = sqliteDb.prepare("SELECT chat_id FROM users WHERE greeted = 1").all() as any[];
        for (const r of userRows) {
          if (r.chat_id) candidateIds.add(String(r.chat_id).replace(/^[a-z_]+/, ''));
        }
      } catch {}
    }

    const OWNER = String(process.env.OWNER_CHAT_ID || '').trim();
    if (OWNER) {
      candidateIds.add(OWNER.replace(/^[a-z_]+/, ''));
    }

    const weather = await fetchWeatherSummary();

    for (const cleanId of candidateIds) {
      const numericId = parseInt(cleanId, 10);
      if (isNaN(numericId) || numericId <= 0) continue;

      // Проверка активности подписки
      const sub = getSubscription(cleanId);
      const isSubActive = !!(sub && Number(sub.active) === 1 && sub.paid_until && new Date(sub.paid_until).getTime() > Date.now());
      const isUserOwner = isOwner(cleanId);

      if (!isSubActive && !isUserOwner) {
        continue;
      }

      // Проверка настройки briefing_enabled
      const settings = getUserSettings(cleanId);
      if (settings.briefing_enabled !== 1) {
        continue;
      }

      const verse = await getTodayVerseSummary(cleanId);
      const briefingText = cleanForMax(`☀️ Доброе утро! Погода сегодня: ${weather}. Стих дня: ${verse}. Хорошего дня! 🙏`);

      try {
        await sendText(numericId, briefingText, DISABLE_BRIEFING_EXTRA);
        logger.info(`☀️ [MorningBriefing] Отправлен брифинг для chat_id=${cleanId}`);
      } catch (sendErr: any) {
        logger.error(`❌ [MorningBriefing] Ошибка отправки для chat_id=${cleanId}:`, sendErr?.message || sendErr);
      }
    }
  } catch (err: any) {
    logger.error('❌ [MorningBriefing] Ошибка в планировщике утреннего брифинга:', err);
  }
}

export function startMorningScheduler(
  sendText: (chatId: number, text: string, extra?: any) => Promise<void>,
  _sendVoice?: (chatId: number, text: string) => Promise<void>
) {
  setInterval(async () => {
    try {
      const now = new Date();
      const timeStr = new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Europe/Moscow',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(now);

      // Крон 0 7 * * * (07:00 Europe/Moscow)
      if (timeStr !== '07:00') return;

      const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(now);
      const g = global as any;
      if (g['briefing_7am_' + dateStr]) return;
      g['briefing_7am_' + dateStr] = true;

      logger.info(`☀️ [MorningBriefing] Запуск утренней рассылки 07:00 MSK (дата: ${dateStr})`);
      await sendMorningBriefingToAll(sendText);
    } catch (e: any) {
      logger.error('❌ [MorningBriefing] Scheduler error:', e);
    }
  }, 20000);

  logger.info("☀️ Планировщик утреннего брифинга 7:00 MSK запущен (интервал 20 сек, зона Europe/Moscow)");
}

