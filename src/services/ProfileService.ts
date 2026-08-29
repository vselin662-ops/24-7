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

// Инициализация таблиц для онбординга
if (sqliteDb) {
  try {
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        chat_id TEXT PRIMARY KEY,
        profile_json TEXT,
        updated_at TEXT
      );
    `);
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
