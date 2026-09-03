import { sqliteDb } from "../../db";
import { logger } from "../logger";
import {
  getUserBriefingConfig,
  updateUserBriefingConfig,
  getUserPlanConfig,
  updateUserPlanConfig,
  setPlanStatus,
  setBriefingEnabled,
  getTzCode,
  getNextRfTimezone,
  getNextSlotTime,
  MORNING_SLOT_OPTIONS,
  NOON_SLOT_OPTIONS,
  EVENING_SLOT_OPTIONS,
  setWaitingForCity,
  isWaitingForCity,
  RUSSIAN_TIMEZONES
} from "./ProfileService";
import { sendImmediatePlanPobedyVerse } from "./bibleService";
import { getLastCartList } from "./CartService";

export {
  isWaitingForCity,
  setWaitingForCity
};

export interface CallbackResult {
  handled: boolean;
  replyText: string;
  replyExtra?: any;
  sendImmediateVoice?: boolean;
}

export const activeMenuMap = new Map<string, 'briefing' | 'plan'>();

export async function handleTextCommand(
  chatId: string | number,
  rawText: string,
  isVoiceInput: boolean = false
): Promise<CallbackResult | null> {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  const trimmed = (rawText || '').trim();
  const lower = trimmed.toLowerCase();

  let action: string | null = null;

  if (lower === '⚙️ брифинг' || lower === 'брифинг настройки' || lower === 'настройки брифинга') {
    action = 'brief_open';
  } else if (lower.startsWith('🏙 город') || lower === '🏙 город' || lower === 'город') {
    action = 'brief_city';
  } else if (lower.startsWith('☀️ погода') || lower === '☀️ погода' || lower === 'погода') {
    action = 'brief_weather';
  } else if (lower.startsWith('📖 притча') || lower === '📖 притча' || lower === 'притча') {
    action = 'brief_parable';
  } else if (lower.startsWith('🎼 псалом') || lower === '🎼 псалом' || lower === 'псалом') {
    action = 'brief_psalm';
  } else if (lower.startsWith('✝️ стих') || lower === '✝️ стих' || lower === 'стих') {
    action = 'brief_verse';
  } else if (lower.startsWith('✅ готово') || lower === 'готово' || lower === '✅ готово') {
    action = 'brief_done';
  } else if (lower.startsWith('▶️ включить') || lower.includes('включить план') || lower === 'включить план победы') {
    action = 'plan_on';
  } else if (lower.startsWith('❌ отключить') || lower.includes('отключить план') || lower === 'отключить план победы' || lower === 'выключить план победы') {
    action = 'plan_off';
  } else if (lower === '⚙️ план победы' || lower === 'план победы' || lower === 'план победы настройки' || lower === 'настройки плана') {
    action = 'plan_open';
  } else if (lower.startsWith('🌅 утро') || lower.includes('утро')) {
    action = 'plan_time_m';
  } else if (lower.startsWith('🌞 обед') || lower.includes('обед')) {
    action = 'plan_time_n';
  } else if (lower.startsWith('🌙 вечер') || lower.includes('вечер')) {
    action = 'plan_time_e';
  } else if (lower.includes('пояс') || lower.includes('🌍')) {
    action = 'plan_tz';
  } else if (lower.startsWith('🔊 голос') || lower.includes('голос')) {
    action = 'plan_voice';
  }

  if (!action) return null;

  // Track active menu context for '✅ готово'
  if (action === 'brief_open') {
    activeMenuMap.set(cleanId, 'briefing');
  } else if (action === 'plan_open') {
    activeMenuMap.set(cleanId, 'plan');
  } else if (action === 'brief_done') {
    const active = activeMenuMap.get(cleanId);
    if (active === 'plan') {
      action = 'plan_done';
    }
    activeMenuMap.delete(cleanId);
  }

  // Log btn mode text action
  console.log(`🔘 [BTN] mode=text p=${action}`);
  logger.info(`🔘 [BTN] mode=text p=${action}`);

  return await handleCallback(cleanId, action, isVoiceInput);
}

/**
 * Геокодирование города через Nominatim OpenStreetMap
 */
export async function geocodeCityWithNominatim(cityNameOrQuery: string): Promise<{ resolvedCity?: string; lat?: number; lon?: number; error?: boolean }> {
  const query = (cityNameOrQuery || '').trim();
  if (!query || query.length < 2) return { error: true };

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'SelinAI-Assistant/2.0' }
    });
    if (res.ok) {
      const data: any = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const displayName = String(data[0].display_name || '');
        const resolved = displayName.split(',')[0].trim() || query;
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        return {
          resolvedCity: resolved,
          lat: !isNaN(lat) ? lat : undefined,
          lon: !isNaN(lon) ? lon : undefined
        };
      }
      return { error: true };
    }
    return { error: true };
  } catch (e: any) {
    logger.warn(`⚠️ [Nominatim] Geocoding failed for "${query}": ${e?.message || e}`);
    return { error: true };
  }
}

/**
 * Обработка ввода города (текст или гео)
 */
export async function handleCityInput(
  chatId: string | number,
  inputText: string,
  lat?: number,
  lon?: number
): Promise<{ success: boolean; city: string; reply: string }> {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  let resolvedCity = (inputText || '').trim();
  let resolvedLat = lat;
  let resolvedLon = lon;

  if (lat != null && lon != null && (!inputText || inputText === 'geo')) {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`, {
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': 'SelinAI-Assistant/2.0' }
      });
      if (res.ok) {
        const data: any = await res.json();
        const addr = data?.address;
        const c = addr?.city || addr?.town || addr?.village || addr?.hamlet || addr?.county || data?.display_name?.split(',')?.[0]?.trim();
        if (c) resolvedCity = c;
      }
    } catch {
      logger.warn(`⚠️ [Nominatim] Reverse geocoding failed for lat=${lat}, lon=${lon}`);
    }
  } else if (resolvedCity) {
    const geo = await geocodeCityWithNominatim(resolvedCity);
    if (geo.error || !geo.resolvedCity) {
      return {
        success: false,
        city: '',
        reply: 'Не понял город, напиши иначе.'
      };
    }
    resolvedCity = geo.resolvedCity;
    if (geo.lat != null) resolvedLat = geo.lat;
    if (geo.lon != null) resolvedLon = geo.lon;
  }

  if (!resolvedCity) {
    return {
      success: false,
      city: '',
      reply: 'Не понял город, напиши иначе.'
    };
  }

  updateUserBriefingConfig(cleanId, {
    city: resolvedCity,
    lat: resolvedLat,
    lon: resolvedLon
  });
  setWaitingForCity(cleanId, false);

  const reply = `✅ Город: ${resolvedCity}`;
  logger.info(`🏙 [City] Updated for ${cleanId}: city=${resolvedCity}, lat=${resolvedLat}, lon=${resolvedLon}`);
  return { success: true, city: resolvedCity, reply };
}

/**
 * Отрисовка интерактивного меню настроек Брифинга
 */
export function renderBriefingMenu(chatId: string | number): { text: string; extra: any } {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  activeMenuMap.set(cleanId, 'briefing');
  const cfg = getUserBriefingConfig(cleanId);

  const text = `⚙️ **Настройки Утреннего Брифинга**:\n\n` +
    `• 🏙 Город: **${cfg.city || 'Москва'}**\n` +
    `• ⏰ Время: **${cfg.time || '07:00'}**\n` +
    `• ☀️ Погода: ${cfg.include_weather ? 'вкл' : 'выкл'}\n` +
    `• 📖 Притча: ${cfg.include_parable ? 'вкл' : 'выкл'}\n` +
    `• 🎼 Псалом: ${cfg.include_psalm ? 'вкл' : 'выкл'}\n` +
    `• ✝️ Стих: ${cfg.include_verse ? 'вкл' : 'выкл'}\n\n` +
    `Нажимайте кнопки для переключения параметров.`;

  const extra = {
    attachments: [
      {
        type: 'inline_keyboard',
        payload: {
          buttons: [
            [
              { type: 'callback', text: `🏙 Город: ${cfg.city || 'Москва'}`, payload: 'brief_city' }
            ],
            [
              { type: 'callback', text: `☀️ Погода: ${cfg.include_weather ? 'вкл' : 'выкл'}`, payload: 'brief_weather' },
              { type: 'callback', text: `📖 Притча: ${cfg.include_parable ? 'вкл' : 'выкл'}`, payload: 'brief_parable' }
            ],
            [
              { type: 'callback', text: `🎼 Псалом: ${cfg.include_psalm ? 'вкл' : 'выкл'}`, payload: 'brief_psalm' },
              { type: 'callback', text: `✝️ Стих: ${cfg.include_verse ? 'вкл' : 'выкл'}`, payload: 'brief_verse' }
            ],
            [
              { type: 'callback', text: '✅ Готово', payload: 'brief_done' }
            ]
          ]
        }
      }
    ]
  };

  return { text, extra };
}

/**
 * Отрисовка интерактивного меню настроек Плана Победы
 */
export function renderPlanMenu(chatId: string | number): { text: string; extra: any } {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  activeMenuMap.set(cleanId, 'plan');
  const cfg = getUserPlanConfig(cleanId);
  const tzCode = getTzCode(cfg.tz);
  const isEnabled = (cfg.plan_status === 'on_buttons' || cfg.plan_status === 'on_quiet' || cfg.plan_enabled === 1) && cfg.plan_status !== 'off';

  const text = `⚙️ **Настройки Плана Победы**:\n\n` +
    `• 🕊 Статус: **${isEnabled ? 'Включен' : 'Отключен'}**\n` +
    `• 🌅 Утро: **${cfg.slot_times.m}**\n` +
    `• 🌞 Обед: **${cfg.slot_times.n}**\n` +
    `• 🌙 Вечер: **${cfg.slot_times.e}**\n` +
    `• 🌍 Пояс: **${tzCode}** (${cfg.tz || 'Europe/Moscow'})\n` +
    `• 🔊 Голос: **${cfg.voice_on !== 0 ? 'вкл' : 'выкл'}**\n\n` +
    `Нажимайте кнопки для изменения параметров.`;

  const extra = {
    attachments: [
      {
        type: 'inline_keyboard',
        payload: {
          buttons: [
            [
              { type: 'callback', text: `🌅 Утро: ${cfg.slot_times.m}`, payload: 'plan_time_m' },
              { type: 'callback', text: `🌞 Обед: ${cfg.slot_times.n}`, payload: 'plan_time_n' }
            ],
            [
              { type: 'callback', text: `🌙 Вечер: ${cfg.slot_times.e}`, payload: 'plan_time_e' },
              { type: 'callback', text: `🌍 ${tzCode}`, payload: 'plan_tz' }
            ],
            [
              { type: 'callback', text: `🔊 Голос: ${cfg.voice_on !== 0 ? 'вкл' : 'выкл'}`, payload: 'plan_voice' }
            ],
            [
              { type: 'callback', text: '✅ Готово', payload: 'plan_done' }
            ]
          ]
        }
      }
    ]
  };

  return { text, extra };
}

/**
 * Универсальный Callback-роутер
 */
export async function handleCallback(
  chatId: string | number,
  rawPayload: string,
  isVoiceInput: boolean = false
): Promise<CallbackResult> {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  const payload = (rawPayload || '').trim();
  const lower = payload.toLowerCase();

  // 1. Обязательный лог нажатия кнопки
  console.log(`🔘 [BTN] mode=callback p=${payload}`);
  logger.info(`🔘 [BTN] mode=callback p=${payload}`);

  // === 2. БРИФИНГ ===
  if (
    lower === 'brief_open' ||
    lower === 'briefing_settings' ||
    lower === 'brief_settings' ||
    lower === '⚙️ брифинг' ||
    lower === 'настройки брифинга' ||
    lower === '/briefing_settings'
  ) {
    const menu = renderBriefingMenu(cleanId);
    return {
      handled: true,
      replyText: menu.text,
      replyExtra: menu.extra
    };
  }

  if (lower === 'brief_city') {
    setWaitingForCity(cleanId, true);
    const replyText = '🏙 Напишите город текстом или пришлите геолокацию.';
    return {
      handled: true,
      replyText
    };
  }

  if (lower === 'brief_weather' || lower === 'brief_toggle_weather') {
    const cfg = getUserBriefingConfig(cleanId);
    updateUserBriefingConfig(cleanId, { include_weather: !cfg.include_weather });
    const menu = renderBriefingMenu(cleanId);
    return {
      handled: true,
      replyText: menu.text,
      replyExtra: menu.extra
    };
  }

  if (lower === 'brief_parable' || lower === 'brief_toggle_parable') {
    const cfg = getUserBriefingConfig(cleanId);
    updateUserBriefingConfig(cleanId, { include_parable: !cfg.include_parable });
    const menu = renderBriefingMenu(cleanId);
    return {
      handled: true,
      replyText: menu.text,
      replyExtra: menu.extra
    };
  }

  if (lower === 'brief_psalm' || lower === 'brief_toggle_psalm') {
    const cfg = getUserBriefingConfig(cleanId);
    updateUserBriefingConfig(cleanId, { include_psalm: !cfg.include_psalm });
    const menu = renderBriefingMenu(cleanId);
    return {
      handled: true,
      replyText: menu.text,
      replyExtra: menu.extra
    };
  }

  if (lower === 'brief_verse' || lower === 'brief_toggle_verse') {
    const cfg = getUserBriefingConfig(cleanId);
    updateUserBriefingConfig(cleanId, { include_verse: !cfg.include_verse });
    const menu = renderBriefingMenu(cleanId);
    return {
      handled: true,
      replyText: menu.text,
      replyExtra: menu.extra
    };
  }

  if (lower === 'brief_done') {
    return {
      handled: true,
      replyText: '✅ Брифинг настроен.'
    };
  }

  if (
    lower === 'briefing_off' ||
    lower === '🔕 отключить брифинг' ||
    lower === 'отключить брифинг' ||
    lower === '/briefing_off'
  ) {
    setBriefingEnabled(cleanId, 0);
    updateUserBriefingConfig(cleanId, { briefing_enabled: 0 });
    return {
      handled: true,
      replyText: '✅ Брифинг отключён. Включить: команда «включить брифинг».'
    };
  }

  if (
    lower === 'briefing_on' ||
    lower === 'включить брифинг' ||
    lower === '/briefing_on'
  ) {
    setBriefingEnabled(cleanId, 1);
    updateUserBriefingConfig(cleanId, { briefing_enabled: 1 });
    return {
      handled: true,
      replyText: '☀️ Утренний брифинг включён! Я буду присылать погоду и наставление каждое утро в 7:00.'
    };
  }

  // === 3. ПЛАН ПОБЕДЫ ===
  if (
    lower === 'plan_on' ||
    lower === 'включить план победы' ||
    lower === 'включить план' ||
    lower === '/plan_on'
  ) {
    setPlanStatus(cleanId, 'on_buttons');
    updateUserPlanConfig(cleanId, { plan_status: 'on_buttons', plan_enabled: 1 });
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());
    try {
      if (sqliteDb) {
        sqliteDb.prepare("INSERT OR REPLACE INTO bible_subs (chat_id, start_date, active, period_days) VALUES (?, ?, ?, ?)").run(cleanId, todayStr, 1, 365);
      }
    } catch {}

    // Отправляем стих сразу
    sendImmediatePlanPobedyVerse(cleanId).catch(err => {
      logger.warn(`⚠️ [Plan] Immediate verse error for ${cleanId}:`, err);
    });

    return {
      handled: true,
      replyText: '✅ План Победы включён!',
      sendImmediateVoice: true
    };
  }

  if (
    lower === 'plan_off' ||
    lower === 'отключить план победы' ||
    lower === 'выключить план победы' ||
    lower === 'стоп план победы' ||
    lower === '/plan_off'
  ) {
    setPlanStatus(cleanId, 'off');
    updateUserPlanConfig(cleanId, { plan_status: 'off', plan_enabled: 0 });
    try {
      if (sqliteDb) {
        sqliteDb.prepare("UPDATE bible_subs SET active = 0 WHERE chat_id = ?").run(cleanId);
      }
    } catch {}
    return {
      handled: true,
      replyText: '❌ План Победы выключен.'
    };
  }

  if (
    lower === 'plan_open' ||
    lower === 'plan_settings' ||
    lower === '⚙️ план победы' ||
    lower === 'настройки плана' ||
    lower === 'план победы настройки' ||
    lower === '/plan_settings'
  ) {
    const menu = renderPlanMenu(cleanId);
    return {
      handled: true,
      replyText: menu.text,
      replyExtra: menu.extra
    };
  }

  if (lower === 'plan_time_m') {
    const cfg = getUserPlanConfig(cleanId);
    const nextTime = getNextSlotTime(cfg.slot_times.m, MORNING_SLOT_OPTIONS);
    updateUserPlanConfig(cleanId, {
      slot_times: { ...cfg.slot_times, m: nextTime }
    });
    const menu = renderPlanMenu(cleanId);
    return {
      handled: true,
      replyText: menu.text,
      replyExtra: menu.extra
    };
  }

  if (lower === 'plan_time_n') {
    const cfg = getUserPlanConfig(cleanId);
    const nextTime = getNextSlotTime(cfg.slot_times.n, NOON_SLOT_OPTIONS);
    updateUserPlanConfig(cleanId, {
      slot_times: { ...cfg.slot_times, n: nextTime }
    });
    const menu = renderPlanMenu(cleanId);
    return {
      handled: true,
      replyText: menu.text,
      replyExtra: menu.extra
    };
  }

  if (lower === 'plan_time_e') {
    const cfg = getUserPlanConfig(cleanId);
    const nextTime = getNextSlotTime(cfg.slot_times.e, EVENING_SLOT_OPTIONS);
    updateUserPlanConfig(cleanId, {
      slot_times: { ...cfg.slot_times, e: nextTime }
    });
    const menu = renderPlanMenu(cleanId);
    return {
      handled: true,
      replyText: menu.text,
      replyExtra: menu.extra
    };
  }

  if (lower === 'plan_tz') {
    const cfg = getUserPlanConfig(cleanId);
    const nextTz = getNextRfTimezone(cfg.tz);
    updateUserPlanConfig(cleanId, { tz: nextTz.id });
    const menu = renderPlanMenu(cleanId);
    return {
      handled: true,
      replyText: menu.text,
      replyExtra: menu.extra
    };
  }

  if (lower === 'plan_voice' || lower === 'plan_toggle_voice') {
    const cfg = getUserPlanConfig(cleanId);
    const nextVoice = cfg.voice_on !== 0 ? 0 : 1;
    updateUserPlanConfig(cleanId, { voice_on: nextVoice });
    const menu = renderPlanMenu(cleanId);
    return {
      handled: true,
      replyText: menu.text,
      replyExtra: menu.extra
    };
  }

  if (lower === 'plan_done') {
    return {
      handled: true,
      replyText: '✅ Настройки Плана сохранены.'
    };
  }

  // === 4. СТАРЫЕ CALLBACKS И СОПУТСТВУЮЩИЕ ===
  if (lower === 'plan_keep' || lower === 'оставить как есть') {
    setPlanStatus(cleanId, 'on_quiet');
    updateUserPlanConfig(cleanId, { plan_status: 'on_quiet', plan_enabled: 1 });
    return {
      handled: true,
      replyText: '✅ План Победы сохранён в тихом режиме (без дополнительных кнопок). Приятного прослушивания!'
    };
  }

  if (lower === 'plan_choose_tz') {
    const buttons = RUSSIAN_TIMEZONES.slice(0, 6).map(tz => [
      { type: 'callback', text: tz.label, payload: `plan_tz_${tz.id}` }
    ]);
    const tzExtra = {
      attachments: [
        {
          type: 'inline_keyboard',
          payload: { buttons }
        }
      ]
    };
    return {
      handled: true,
      replyText: '🌍 Выберите ваш часовой пояс:',
      replyExtra: tzExtra
    };
  }

  if (lower.startsWith('plan_tz_')) {
    const tzId = payload.substring('plan_tz_'.length).trim();
    updateUserPlanConfig(cleanId, { tz: tzId });
    return {
      handled: true,
      replyText: `🌍 Часовой пояс установлен: **${tzId}**. Рассылка будет приходить по вашему местному времени.`
    };
  }

  if (lower === 'copy_cart' || lower === 'скопировать список' || lower === '/copy_cart') {
    const lastList = getLastCartList(cleanId);
    let copyReply = '';
    if (lastList) {
      copyReply = `📋 **Список продуктов для удобного копирования**:\n\n${lastList}`;
    } else {
      copyReply = 'Список продуктов пока не составлен. Напишите «Собери продукты на борщ», чтобы сформировать список!';
    }
    return {
      handled: true,
      replyText: copyReply
    };
  }

  // === 5. НЕИЗВЕСТНЫЙ PAYLOAD ===
  console.warn(`⚠️ [CB] unknown payload=${payload} chat=${cleanId}`);
  logger.warn(`⚠️ [CB] unknown payload=${payload} chat=${cleanId}`);

  return {
    handled: true,
    replyText: '🔧 В доработке.'
  };
}
