import { sqliteDb } from "../../db";
import { logger } from "../logger";
import { llmService } from "../core/LLMService";

export interface UserProfile {
  family_size?: number;
  diet_restrictions?: string[];
  stores?: string[];
  city?: string;
  interests?: string[];
  faith?: boolean;
}

export type PlanStatus = 'on_buttons' | 'on_quiet' | 'off';

export interface SlotTimes {
  m: string; // Morning slot e.g. "07:30"
  n: string; // Noon slot e.g. "13:00"
  e: string; // Evening slot e.g. "21:00"
}

export interface UserPlanConfig {
  plan_enabled: number;
  plan_status: PlanStatus;
  tz: string;
  slot_times: SlotTimes;
  voice_on: number; // 1 = voice, 0 = text only
  recent_motivations: string[];
  plan_day_offset?: number;
}

export interface BriefingConfig {
  city: string;
  lat?: number;
  lon?: number;
  include_weather: boolean;
  include_parable: boolean;
  include_psalm: boolean;
  include_verse: boolean;
  time: string; // e.g. "07:00"
  briefing_enabled: number; // 1 | 0
}

export interface UserSettings {
  chat_id: string;
  plan_status: PlanStatus;
  briefing_enabled: number; // 1 | 0
  tz: string;
  last_lat?: number;
  last_lon?: number;
  updated_at?: string;
}

// Default Russian timezones list
export const RUSSIAN_TIMEZONES = [
  { id: 'Europe/Kaliningrad', label: 'Калининград (UTC+2)', offset: 2 },
  { id: 'Europe/Moscow', label: 'Москва (UTC+3)', offset: 3 },
  { id: 'Europe/Samara', label: 'Самара (UTC+4)', offset: 4 },
  { id: 'Asia/Yekaterinburg', label: 'Екатеринбург (UTC+5)', offset: 5 },
  { id: 'Asia/Omsk', label: 'Омск (UTC+6)', offset: 6 },
  { id: 'Asia/Krasnoyarsk', label: 'Красноярск (UTC+7)', offset: 7 },
  { id: 'Asia/Irkutsk', label: 'Иркутск (UTC+8)', offset: 8 },
  { id: 'Asia/Yakutsk', label: 'Якутск (UTC+9)', offset: 9 },
  { id: 'Asia/Vladivostok', label: 'Владивосток (UTC+10)', offset: 10 },
  { id: 'Asia/Magadan', label: 'Магадан (UTC+11)', offset: 11 },
  { id: 'Asia/Kamchatka', label: 'Камчатка (UTC+12)', offset: 12 }
];

// Инициализация таблиц для онбординга и настроек пользователя
if (sqliteDb) {
  try {
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        chat_id TEXT PRIMARY KEY,
        profile_json TEXT,
        plan_enabled INTEGER DEFAULT 0,
        plan_status TEXT DEFAULT 'off',
        tz TEXT DEFAULT 'Europe/Moscow',
        slot_times TEXT DEFAULT '{"m":"07:30","n":"13:00","e":"21:00"}',
        voice_on INTEGER DEFAULT 1,
        recent_motivations TEXT DEFAULT '[]',
        briefing_config TEXT DEFAULT '{"city":"Москва","include_weather":true,"include_parable":true,"include_psalm":true,"include_verse":true,"time":"07:00","briefing_enabled":1}',
        briefing_enabled INTEGER DEFAULT 1,
        last_lat REAL,
        last_lon REAL,
        last_route TEXT,
        plan_day_offset INTEGER DEFAULT 0,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS plan_sent_logs (
        chat_id TEXT NOT NULL,
        slot TEXT NOT NULL,
        date_str TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (chat_id, slot, date_str)
      );

      CREATE TABLE IF NOT EXISTS briefing_sent_logs (
        chat_id TEXT NOT NULL,
        date_str TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (chat_id, date_str)
      );

      CREATE TABLE IF NOT EXISTS profile_offered (
        chat_id TEXT PRIMARY KEY,
        offered_at TEXT
      );
    `);

    // Гарантируем наличие всех колонок при миграции
    const columnsToEnsure = [
      { name: 'plan_enabled', sql: `ALTER TABLE user_profiles ADD COLUMN plan_enabled INTEGER DEFAULT 0;` },
      { name: 'plan_status', sql: `ALTER TABLE user_profiles ADD COLUMN plan_status TEXT DEFAULT 'off';` },
      { name: 'tz', sql: `ALTER TABLE user_profiles ADD COLUMN tz TEXT DEFAULT 'Europe/Moscow';` },
      { name: 'slot_times', sql: `ALTER TABLE user_profiles ADD COLUMN slot_times TEXT DEFAULT '{"m":"07:30","n":"13:00","e":"21:00"}';` },
      { name: 'voice_on', sql: `ALTER TABLE user_profiles ADD COLUMN voice_on INTEGER DEFAULT 1;` },
      { name: 'recent_motivations', sql: `ALTER TABLE user_profiles ADD COLUMN recent_motivations TEXT DEFAULT '[]';` },
      { name: 'briefing_config', sql: `ALTER TABLE user_profiles ADD COLUMN briefing_config TEXT;` },
      { name: 'briefing_enabled', sql: `ALTER TABLE user_profiles ADD COLUMN briefing_enabled INTEGER DEFAULT 1;` },
      { name: 'last_lat', sql: `ALTER TABLE user_profiles ADD COLUMN last_lat REAL;` },
      { name: 'last_lon', sql: `ALTER TABLE user_profiles ADD COLUMN last_lon REAL;` },
      { name: 'last_route', sql: `ALTER TABLE user_profiles ADD COLUMN last_route TEXT;` },
      { name: 'plan_day_offset', sql: `ALTER TABLE user_profiles ADD COLUMN plan_day_offset INTEGER DEFAULT 0;` }
    ];

    for (const col of columnsToEnsure) {
      try {
        sqliteDb.exec(col.sql);
      } catch {}
    }

    logger.info("📁 [Profile] user_profiles and Spirit Core tables verified.");
  } catch (err: any) {
    logger.error("❌ [Profile] Database initialization failed:", err);
  }
}

export function getUserSettings(chatId: string | number): UserSettings {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  if (!sqliteDb) {
    return { chat_id: cleanId, plan_status: 'off', briefing_enabled: 1, tz: 'Europe/Moscow' };
  }
  try {
    const row = sqliteDb.prepare("SELECT chat_id, plan_status, briefing_enabled, tz, last_lat, last_lon, updated_at FROM user_profiles WHERE chat_id = ?").get(cleanId) as any;
    if (row) {
      const planStatus: PlanStatus = (row.plan_status === 'on_buttons' || row.plan_status === 'on_quiet' || row.plan_status === 'off') ? row.plan_status : 'off';
      const briefingEnabled = (row.briefing_enabled === 0 || row.briefing_enabled === '0') ? 0 : 1;
      return {
        chat_id: cleanId,
        plan_status: planStatus,
        briefing_enabled: briefingEnabled,
        tz: row.tz || 'Europe/Moscow',
        last_lat: row.last_lat ? Number(row.last_lat) : undefined,
        last_lon: row.last_lon ? Number(row.last_lon) : undefined,
        updated_at: row.updated_at
      };
    }
  } catch (err) {
    logger.warn(`⚠️ [Profile] Failed to get user settings for ${cleanId}:`, err);
  }
  return { chat_id: cleanId, plan_status: 'off', briefing_enabled: 1, tz: 'Europe/Moscow' };
}

export function getUserPlanConfig(chatId: string | number): UserPlanConfig {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  const defaults: UserPlanConfig = {
    plan_enabled: 0,
    plan_status: 'off',
    tz: 'Europe/Moscow',
    slot_times: { m: '07:30', n: '13:00', e: '21:00' },
    voice_on: 1,
    recent_motivations: [],
    plan_day_offset: 0
  };

  if (!sqliteDb) return defaults;
  try {
    const row = sqliteDb.prepare("SELECT plan_enabled, plan_status, tz, slot_times, voice_on, recent_motivations, plan_day_offset FROM user_profiles WHERE chat_id = ?").get(cleanId) as any;
    if (row) {
      let slot_times: SlotTimes = defaults.slot_times;
      if (row.slot_times) {
        try {
          slot_times = { ...defaults.slot_times, ...JSON.parse(row.slot_times) };
        } catch {}
      }
      let recent_motivations: string[] = [];
      if (row.recent_motivations) {
        try {
          recent_motivations = JSON.parse(row.recent_motivations);
          if (!Array.isArray(recent_motivations)) recent_motivations = [];
        } catch {}
      }

      return {
        plan_enabled: row.plan_enabled !== null && row.plan_enabled !== undefined ? Number(row.plan_enabled) : (row.plan_status && row.plan_status !== 'off' ? 1 : 0),
        plan_status: (row.plan_status as PlanStatus) || 'off',
        tz: row.tz || 'Europe/Moscow',
        slot_times,
        voice_on: row.voice_on !== null && row.voice_on !== undefined ? Number(row.voice_on) : 1,
        recent_motivations,
        plan_day_offset: row.plan_day_offset !== null && row.plan_day_offset !== undefined ? Number(row.plan_day_offset) : 0
      };
    }
  } catch (err) {
    logger.warn(`⚠️ [Profile] Failed to get plan config for ${cleanId}:`, err);
  }
  return defaults;
}

export function updateUserPlanConfig(chatId: string | number, partial: Partial<UserPlanConfig>): void {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  if (!sqliteDb) return;
  const nowStr = new Date().toISOString();
  const current = getUserPlanConfig(cleanId);
  const updated: UserPlanConfig = {
    ...current,
    ...partial,
    slot_times: partial.slot_times ? { ...current.slot_times, ...partial.slot_times } : current.slot_times
  };

  try {
    const exists = sqliteDb.prepare("SELECT chat_id FROM user_profiles WHERE chat_id = ?").get(cleanId);
    if (exists) {
      sqliteDb.prepare(`
        UPDATE user_profiles 
        SET plan_enabled = ?, plan_status = ?, tz = ?, slot_times = ?, voice_on = ?, recent_motivations = ?, plan_day_offset = ?, updated_at = ?
        WHERE chat_id = ?
      `).run(
        updated.plan_enabled,
        updated.plan_status,
        updated.tz,
        JSON.stringify(updated.slot_times),
        updated.voice_on,
        JSON.stringify(updated.recent_motivations),
        updated.plan_day_offset ?? 0,
        nowStr,
        cleanId
      );
    } else {
      sqliteDb.prepare(`
        INSERT INTO user_profiles (chat_id, plan_enabled, plan_status, tz, slot_times, voice_on, recent_motivations, plan_day_offset, briefing_enabled, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        cleanId,
        updated.plan_enabled,
        updated.plan_status,
        updated.tz,
        JSON.stringify(updated.slot_times),
        updated.voice_on,
        JSON.stringify(updated.recent_motivations),
        updated.plan_day_offset ?? 0,
        1,
        nowStr
      );
    }
    logger.info(`📋 [Profile] Plan config updated for ${cleanId}: status=${updated.plan_status}, tz=${updated.tz}, voice_on=${updated.voice_on}`);
  } catch (err) {
    logger.error(`❌ [Profile] Failed to update plan config for ${cleanId}:`, err);
  }
}

export function addUserRecentMotivation(chatId: string | number, motivation: string): void {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  if (!sqliteDb || !motivation) return;
  try {
    const config = getUserPlanConfig(cleanId);
    const list = [motivation.trim(), ...config.recent_motivations.filter(m => m !== motivation.trim())].slice(0, 7);
    sqliteDb.prepare("UPDATE user_profiles SET recent_motivations = ? WHERE chat_id = ?")
      .run(JSON.stringify(list), cleanId);
  } catch (err) {
    logger.warn(`⚠️ [Profile] Failed to add recent motivation for ${cleanId}:`, err);
  }
}

export function getUserBriefingConfig(chatId: string | number): BriefingConfig {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  const defaults: BriefingConfig = {
    city: 'Москва',
    include_weather: true,
    include_parable: true,
    include_psalm: true,
    include_verse: true,
    time: '07:00',
    briefing_enabled: 1
  };

  if (!sqliteDb) return defaults;
  try {
    const row = sqliteDb.prepare("SELECT briefing_config, briefing_enabled, last_lat, last_lon FROM user_profiles WHERE chat_id = ?").get(cleanId) as any;
    if (row) {
      let cfg: BriefingConfig = { ...defaults };
      if (row.briefing_config) {
        try {
          cfg = { ...defaults, ...JSON.parse(row.briefing_config) };
        } catch {}
      }
      if (row.briefing_enabled !== undefined && row.briefing_enabled !== null) {
        cfg.briefing_enabled = Number(row.briefing_enabled) === 0 ? 0 : 1;
      }
      if (row.last_lat != null && row.last_lon != null && !cfg.lat && !cfg.lon) {
        cfg.lat = Number(row.last_lat);
        cfg.lon = Number(row.last_lon);
      }
      return cfg;
    }
  } catch (err) {
    logger.warn(`⚠️ [Profile] Failed to get briefing config for ${cleanId}:`, err);
  }
  return defaults;
}

export function updateUserBriefingConfig(chatId: string | number, partial: Partial<BriefingConfig>): void {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  if (!sqliteDb) return;
  const nowStr = new Date().toISOString();
  const current = getUserBriefingConfig(cleanId);
  const updated: BriefingConfig = {
    ...current,
    ...partial
  };

  try {
    const exists = sqliteDb.prepare("SELECT chat_id FROM user_profiles WHERE chat_id = ?").get(cleanId);
    if (exists) {
      sqliteDb.prepare(`
        UPDATE user_profiles 
        SET briefing_config = ?, briefing_enabled = ?, updated_at = ?
        WHERE chat_id = ?
      `).run(
        JSON.stringify(updated),
        updated.briefing_enabled,
        nowStr,
        cleanId
      );
    } else {
      sqliteDb.prepare(`
        INSERT INTO user_profiles (chat_id, briefing_config, briefing_enabled, plan_status, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        JSON.stringify(updated),
        updated.briefing_enabled,
        'off',
        nowStr
      );
    }
    logger.info(`☀️ [Profile] Briefing config updated for ${cleanId}: city=${updated.city}, enabled=${updated.briefing_enabled}, time=${updated.time}`);
  } catch (err) {
    logger.error(`❌ [Profile] Failed to update briefing config for ${cleanId}:`, err);
  }
}

export function setUserLocation(chatId: string | number, lat: number, lon: number): void {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  if (!sqliteDb) return;
  const nowStr = new Date().toISOString();
  try {
    const exists = sqliteDb.prepare("SELECT chat_id FROM user_profiles WHERE chat_id = ?").get(cleanId);
    if (exists) {
      sqliteDb.prepare("UPDATE user_profiles SET last_lat = ?, last_lon = ?, updated_at = ? WHERE chat_id = ?")
        .run(lat, lon, nowStr, cleanId);
    } else {
      sqliteDb.prepare("INSERT INTO user_profiles (chat_id, profile_json, plan_status, briefing_enabled, last_lat, last_lon, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(cleanId, null, 'off', 1, lat, lon, nowStr);
    }
    logger.info(`📍 [Profile] User location saved: ${lat}, ${lon} for ${cleanId}`);
  } catch (err) {
    logger.error(`❌ [Profile] Failed to save user location for ${cleanId}:`, err);
  }
}

export function getUserLocation(chatId: string | number): { lat: number; lon: number } | null {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  if (!sqliteDb) return null;
  try {
    const row = sqliteDb.prepare("SELECT last_lat, last_lon FROM user_profiles WHERE chat_id = ?").get(cleanId) as any;
    if (row && row.last_lat != null && row.last_lon != null && !isNaN(Number(row.last_lat)) && !isNaN(Number(row.last_lon))) {
      return { lat: Number(row.last_lat), lon: Number(row.last_lon) };
    }
  } catch (err) {
    logger.warn(`⚠️ [Profile] Failed to get location for ${cleanId}:`, err);
  }
  return null;
}

export function setPlanStatus(chatId: string | number, status: PlanStatus): void {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  if (!sqliteDb) return;
  const nowStr = new Date().toISOString();
  try {
    const exists = sqliteDb.prepare("SELECT chat_id FROM user_profiles WHERE chat_id = ?").get(cleanId);
    if (exists) {
      sqliteDb.prepare("UPDATE user_profiles SET plan_status = ?, updated_at = ? WHERE chat_id = ?").run(status, nowStr, cleanId);
    } else {
      sqliteDb.prepare("INSERT INTO user_profiles (chat_id, profile_json, plan_status, briefing_enabled, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run(cleanId, null, status, 1, nowStr);
    }
    logger.info(`📋 [Profile] plan_status set to "${status}" for ${cleanId}`);
  } catch (err) {
    logger.error(`❌ [Profile] Failed to set plan_status for ${cleanId}:`, err);
  }
}

export function setBriefingEnabled(chatId: string | number, enabled: number): void {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  if (!sqliteDb) return;
  const nowStr = new Date().toISOString();
  const val = enabled === 0 ? 0 : 1;
  try {
    const exists = sqliteDb.prepare("SELECT chat_id FROM user_profiles WHERE chat_id = ?").get(cleanId);
    if (exists) {
      sqliteDb.prepare("UPDATE user_profiles SET briefing_enabled = ?, updated_at = ? WHERE chat_id = ?").run(val, nowStr, cleanId);
    } else {
      sqliteDb.prepare("INSERT INTO user_profiles (chat_id, profile_json, plan_status, briefing_enabled, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run(cleanId, null, 'off', val, nowStr);
    }
    logger.info(`☀️ [Profile] briefing_enabled set to ${val} for ${cleanId}`);
  } catch (err) {
    logger.error(`❌ [Profile] Failed to set briefing_enabled for ${cleanId}:`, err);
  }
}

export interface SavedRoute {
  latA: number;
  lonA: number;
  latB: number;
  lonB: number;
  destName?: string;
  km: number;
  min: number;
  voiceText: string;
  textMsg: string;
  maneuversText?: string;
  timestamp: number;
}

export function saveUserLastRoute(chatId: string | number, route: SavedRoute): void {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  if (!sqliteDb) return;
  const nowStr = new Date().toISOString();
  try {
    const exists = sqliteDb.prepare("SELECT chat_id FROM user_profiles WHERE chat_id = ?").get(cleanId);
    const routeJson = JSON.stringify(route);
    if (exists) {
      sqliteDb.prepare("UPDATE user_profiles SET last_route = ?, updated_at = ? WHERE chat_id = ?")
        .run(routeJson, nowStr, cleanId);
    } else {
      sqliteDb.prepare("INSERT INTO user_profiles (chat_id, profile_json, plan_status, briefing_enabled, last_route, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(cleanId, null, 'off', 1, routeJson, nowStr);
    }
    logger.info(`💾 [Profile] Saved last route for ${cleanId} (${route.km}km / ${route.min}min)`);
  } catch (err) {
    logger.error(`❌ [Profile] Failed to save last route for ${cleanId}:`, err);
  }
}

export function getUserLastRoute(chatId: string | number): SavedRoute | null {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  if (!sqliteDb) return null;
  try {
    const row = sqliteDb.prepare("SELECT last_route FROM user_profiles WHERE chat_id = ?").get(cleanId) as any;
    if (row && row.last_route) {
      return JSON.parse(row.last_route) as SavedRoute;
    }
  } catch (err) {
    logger.warn(`⚠️ [Profile] Failed to get last route for ${cleanId}:`, err);
  }
  return null;
}

export async function getProfile(chatId: string | number): Promise<UserProfile | null> {
  if (!sqliteDb) return null;
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  try {
    const row = sqliteDb.prepare("SELECT profile_json FROM user_profiles WHERE chat_id = ?").get(cleanId) as any;
    if (row && row.profile_json) {
      return JSON.parse(row.profile_json) as UserProfile;
    }
  } catch (err) {
    logger.warn(`⚠️ [Profile] Failed to get profile for ${cleanId}:`, err);
  }
  return null;
}

export async function hasOfferedProfile(chatId: string | number): Promise<boolean> {
  if (!sqliteDb) return false;
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  try {
    const row = sqliteDb.prepare("SELECT chat_id FROM profile_offered WHERE chat_id = ?").get(cleanId);
    return !!row;
  } catch {
    return false;
  }
}

export async function markProfileOffered(chatId: string | number): Promise<void> {
  if (!sqliteDb) return;
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  try {
    sqliteDb.prepare("INSERT OR REPLACE INTO profile_offered (chat_id, offered_at) VALUES (?, ?)")
      .run(cleanId, new Date().toISOString());
  } catch (err) {
    logger.warn(`⚠️ [Profile] Failed to mark profile offered for ${cleanId}:`, err);
  }
}

export async function extractProfile(text: string, chatId: string | number): Promise<UserProfile | null> {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  const currentProfile = await getProfile(cleanId) || {};
  const existingJson = JSON.stringify(currentProfile);

  const systemPrompt = `Вытащи из текста факты о пользователе и объедини их с уже известными фактами: ${existingJson}.
Верни СТРОГО JSON следующей структуры: {family_size, diet_restrictions:[], stores:[], city, interests:[], faith:boolean}. Только JSON.
Правила объединения:
1. Не затирай старые факты, если новые их не опровергают.
2. Не выдумывай факты. Если чего-то нет в тексте, бери значение из известных фактов или оставь пустым/дефолтным.
3. diet_restrictions, stores, interests должны быть массивами строк.
4. faith - булево значение (true, если пользователь верит в Бога, православный, христианин и т.д.).
5. Не возвращай ничего, кроме валидного JSON. Убери любые markdown-теги вроде \`\`\`json.`;

  try {
    const response = await llmService.smartCall(`system_profile_extract_${cleanId}`, text, systemPrompt);
    const cleanedResponse = response.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleanedResponse) as UserProfile;

    if (sqliteDb) {
      sqliteDb.prepare(`
        INSERT OR REPLACE INTO user_profiles (chat_id, profile_json, updated_at)
        VALUES (?, ?, ?)
      `).run(cleanId, JSON.stringify(parsed), new Date().toISOString());
      logger.info(`✅ [Profile] Profile updated for chat ${cleanId}:`, parsed);
    }
    return parsed;
  } catch (err) {
    logger.error(`❌ [Profile] Failed to extract/save profile for chat ${cleanId}:`, err);
    return null;
  }
}

export async function profilePrompt(chatId: string | number): Promise<string> {
  const profile = await getProfile(chatId);
  if (!profile) return '';

  const parts: string[] = [];
  if (profile.family_size) parts.push(`семья ${profile.family_size} чел.`);
  if (profile.diet_restrictions && profile.diet_restrictions.length > 0) {
    parts.push(`ограничения в еде: ${profile.diet_restrictions.join(', ')}`);
  }
  if (profile.stores && profile.stores.length > 0) {
    parts.push(`магазины рядом: ${profile.stores.join(', ')}`);
  }
  if (profile.city) parts.push(`город: ${profile.city}`);
  if (profile.interests && profile.interests.length > 0) {
    parts.push(`интересы: ${profile.interests.join(', ')}`);
  }
  if (profile.faith !== undefined) {
    parts.push(`вера/религия: ${profile.faith ? 'православный христианин' : 'не указано'}`);
  }

  if (parts.length === 0) return '';
  return `ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ: ${parts.join(', ')}.`;
}
