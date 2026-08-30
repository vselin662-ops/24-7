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

export interface UserSettings {
  chat_id: string;
  plan_status: PlanStatus;
  briefing_enabled: number; // 1 | 0
  last_lat?: number;
  last_lon?: number;
  updated_at?: string;
}

// Инициализация таблиц для онбординга и настроек пользователя
if (sqliteDb) {
  try {
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        chat_id TEXT PRIMARY KEY,
        profile_json TEXT,
        plan_status TEXT DEFAULT 'off',
        briefing_enabled INTEGER DEFAULT 1,
        last_lat REAL,
        last_lon REAL,
        last_route TEXT,
        updated_at TEXT
      );
    `);

    // Гарантируем наличие колонок plan_status, briefing_enabled, last_lat, last_lon, last_route при миграции
    try {
      sqliteDb.exec(`ALTER TABLE user_profiles ADD COLUMN plan_status TEXT DEFAULT 'off';`);
    } catch {}
    try {
      sqliteDb.exec(`ALTER TABLE user_profiles ADD COLUMN briefing_enabled INTEGER DEFAULT 1;`);
    } catch {}
    try {
      sqliteDb.exec(`ALTER TABLE user_profiles ADD COLUMN last_lat REAL;`);
    } catch {}
    try {
      sqliteDb.exec(`ALTER TABLE user_profiles ADD COLUMN last_lon REAL;`);
    } catch {}
    try {
      sqliteDb.exec(`ALTER TABLE user_profiles ADD COLUMN last_route TEXT;`);
    } catch {}

    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS profile_offered (
        chat_id TEXT PRIMARY KEY,
        offered_at TEXT
      );
    `);
    logger.info("📁 [Profile] user_profiles and profile_offered tables verified.");
  } catch (err: any) {
    logger.error("❌ [Profile] Database initialization failed:", err);
  }
}

export function getUserSettings(chatId: string | number): UserSettings {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  if (!sqliteDb) {
    return { chat_id: cleanId, plan_status: 'off', briefing_enabled: 1 };
  }
  try {
    const row = sqliteDb.prepare("SELECT chat_id, plan_status, briefing_enabled, last_lat, last_lon, updated_at FROM user_profiles WHERE chat_id = ?").get(cleanId) as any;
    if (row) {
      const planStatus: PlanStatus = (row.plan_status === 'on_buttons' || row.plan_status === 'on_quiet' || row.plan_status === 'off') ? row.plan_status : 'off';
      const briefingEnabled = (row.briefing_enabled === 0 || row.briefing_enabled === '0') ? 0 : 1;
      return {
        chat_id: cleanId,
        plan_status: planStatus,
        briefing_enabled: briefingEnabled,
        last_lat: row.last_lat ? Number(row.last_lat) : undefined,
        last_lon: row.last_lon ? Number(row.last_lon) : undefined,
        updated_at: row.updated_at
      };
    }
  } catch (err) {
    logger.warn(`⚠️ [Profile] Failed to get user settings for ${cleanId}:`, err);
  }
  return { chat_id: cleanId, plan_status: 'off', briefing_enabled: 1 };
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
