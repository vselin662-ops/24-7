import { sqliteDb } from "../../db";
import { logger } from "../logger";
import { getProfile } from "./ProfileService";

export interface UserStyleProfile {
  verbosity: number; // 0.0 (ultra-concise) to 1.0 (detailed), default 0.5
  strictness: number; // 0.0 (informal/casual) to 1.0 (strict business/formal), default 0.5
  warmth: number; // 0.0 (factual/cool) to 1.0 (warm/friendly), default 0.5
}

const DEFAULT_STYLE: UserStyleProfile = {
  verbosity: 0.5,
  strictness: 0.5,
  warmth: 0.5
};

// Хранилище последнего ответа бота для каждого чата для привязки к фидбеку
const lastResponses = new Map<string, string>();

// Инициализация таблицы style_memory
if (sqliteDb) {
  try {
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS style_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        pattern TEXT NOT NULL,
        score INTEGER DEFAULT 1,
        updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_style_memory_chat ON style_memory(chat_id);
    `);
  } catch (err) {
    logger.error("❌ [Personality] Failed to initialize style_memory table:", err);
  }
}

/**
 * Получить текущий профиль стиля пользователя
 */
export async function getStyleProfile(chatId: string | number): Promise<UserStyleProfile> {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  if (!sqliteDb) return { ...DEFAULT_STYLE };

  try {
    const row = sqliteDb.prepare("SELECT personality_json FROM user_profiles WHERE chat_id = ?").get(cleanId) as any;
    if (row && row.personality_json) {
      const parsed = JSON.parse(row.personality_json);
      return {
        verbosity: typeof parsed.verbosity === 'number' ? parsed.verbosity : DEFAULT_STYLE.verbosity,
        strictness: typeof parsed.strictness === 'number' ? parsed.strictness : DEFAULT_STYLE.strictness,
        warmth: typeof parsed.warmth === 'number' ? parsed.warmth : DEFAULT_STYLE.warmth
      };
    }
  } catch (err) {
    logger.warn(`⚠️ [Personality] Error reading style for ${cleanId}:`, err);
  }

  return { ...DEFAULT_STYLE };
}

/**
 * Сохранить профиль стиля пользователя
 */
export async function saveStyleProfile(chatId: string | number, style: UserStyleProfile): Promise<void> {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  if (!sqliteDb) return;

  try {
    const nowStr = new Date().toISOString();
    const styleJson = JSON.stringify(style);

    const exists = sqliteDb.prepare("SELECT chat_id FROM user_profiles WHERE chat_id = ?").get(cleanId);
    if (exists) {
      sqliteDb.prepare("UPDATE user_profiles SET personality_json = ?, updated_at = ? WHERE chat_id = ?")
        .run(styleJson, nowStr, cleanId);
    } else {
      sqliteDb.prepare("INSERT INTO user_profiles (chat_id, personality_json, updated_at) VALUES (?, ?, ?)")
        .run(cleanId, styleJson, nowStr);
    }

    // Получаем интенты для обязательного лога
    const profile = await getProfile(cleanId);
    const intents = profile?.intents || [];
    logger.info(`[Personality] юзер ${cleanId}: intents=${JSON.stringify(intents)}, стиль обновлён.`);
    console.log(`[Personality] юзер ${cleanId}: intents=${JSON.stringify(intents)}, стиль обновлён.`);
  } catch (err) {
    logger.error(`❌ [Personality] Failed to save style for ${cleanId}:`, err);
  }
}

/**
 * Запомнить последний ответ бота для чата
 */
export function recordLastResponse(chatId: string | number, responseText: string): void {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  if (responseText && responseText.trim().length > 0) {
    lastResponses.set(cleanId, responseText.trim());
  }
}

/**
 * Извлечь структурный паттерн из ответа
 */
function extractPatternFromText(text: string): string {
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  const hasBullets = lines.some(l => /^[•\-\*–—\d\.]/.test(l.trim()));
  const isShort = lines.length <= 3 && text.length < 250;

  if (isShort && hasBullets) {
    return "Краткий вывод первой фразой + 2-3 компактных пункта сути";
  } else if (isShort) {
    return "Прямой лаконичный ответ в 1-3 предложениях без вводных слов";
  } else if (hasBullets) {
    return "Структурированный ответ с маркированным списком ключевых тезисов";
  } else {
    return "Последовательное изложение по сути с выделением главного";
  }
}

/**
 * Сохранить успешный паттерн в style_memory
 */
export async function saveSuccessfulPattern(chatId: string | number, pattern: string): Promise<void> {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  if (!sqliteDb || !pattern) return;

  try {
    const existing = sqliteDb.prepare("SELECT id, score FROM style_memory WHERE chat_id = ? AND pattern = ?").get(cleanId, pattern) as any;
    const nowStr = new Date().toISOString();

    if (existing) {
      sqliteDb.prepare("UPDATE style_memory SET score = score + 1, updated_at = ? WHERE id = ?")
        .run(nowStr, existing.id);
    } else {
      sqliteDb.prepare("INSERT INTO style_memory (chat_id, pattern, score, updated_at) VALUES (?, ?, 1, ?)")
        .run(cleanId, pattern, nowStr);
    }
  } catch (err) {
    logger.warn(`⚠️ [Personality] Failed to save pattern for ${cleanId}:`, err);
  }
}

/**
 * Понизить скор паттерна в style_memory
 */
export async function downvotePattern(chatId: string | number, pattern: string): Promise<void> {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  if (!sqliteDb || !pattern) return;

  try {
    const existing = sqliteDb.prepare("SELECT id, score FROM style_memory WHERE chat_id = ? AND pattern = ?").get(cleanId, pattern) as any;
    if (existing) {
      const newScore = Math.max(0, (existing.score || 1) - 1);
      sqliteDb.prepare("UPDATE style_memory SET score = ?, updated_at = ? WHERE id = ?")
        .run(newScore, new Date().toISOString(), existing.id);
    }
  } catch (err) {
    logger.warn(`⚠️ [Personality] Failed to downvote pattern for ${cleanId}:`, err);
  }
}

/**
 * Подтянуть лучший паттерн для этого юзера
 */
export async function getBestPattern(chatId: string | number): Promise<string | null> {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  if (!sqliteDb) return null;

  try {
    const row = sqliteDb.prepare("SELECT pattern FROM style_memory WHERE chat_id = ? AND score > 0 ORDER BY score DESC, id DESC LIMIT 1").get(cleanId) as any;
    if (row && row.pattern) {
      return row.pattern;
    }
  } catch (err) {
    logger.warn(`⚠️ [Personality] Failed to get best pattern for ${cleanId}:`, err);
  }

  return null;
}

/**
 * Анализ реакции пользователя и корректировка стиля
 * Реакции: спасибо / тупишь / переделай / подробнее и т.д.
 * Возвращает true, если зафиксирована и обработана реакция.
 */
export async function analyzeFeedback(chatId: string | number, text: string): Promise<boolean> {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  const cleanText = text.trim().toLowerCase();
  const currentStyle = await getStyleProfile(cleanId);
  let styleChanged = false;

  const lastResp = lastResponses.get(cleanId);

  // 1. Положительная реакция ("спасибо", "отлично", "красава", "супер", "молодец", "класс")
  const isPositive = /^(?:спасибо|благодарю|отлично|супер|красава|молодец|класс|то что надо|идеально|круто|чётко|четко|молодчина|понял спасибо)[!.,]*$/i.test(cleanText) ||
                     /(?:^|\s)(?:спасибо большое|отличный ответ|так держать|именно то)(?:$|[!.,\s])/i.test(cleanText);

  if (isPositive) {
    currentStyle.warmth = Math.min(1.0, +(currentStyle.warmth + 0.05).toFixed(2));
    styleChanged = true;

    if (lastResp) {
      const pattern = extractPatternFromText(lastResp);
      await saveSuccessfulPattern(cleanId, pattern);
    }
  }

  // 2. Негативная реакция ("тупишь", "хватит тупить", "бред", "чушь", "не то", "ерунда")
  const isNegative = /(?:тупишь|хватит тупить|ты тупой|бред|чушь|не то|неправильно|глупость|ерунда|лажа)/i.test(cleanText);
  if (isNegative) {
    currentStyle.strictness = Math.min(1.0, +(currentStyle.strictness + 0.1).toFixed(2));
    currentStyle.verbosity = Math.max(0.1, +(currentStyle.verbosity - 0.1).toFixed(2));
    styleChanged = true;

    if (lastResp) {
      const pattern = extractPatternFromText(lastResp);
      await downvotePattern(cleanId, pattern);
    }
  }

  // 3. Запрос на краткость ("переделай", "короче", "слишком длинно", "сократи", "кратко")
  const isShorten = /(?:переделай|короче|слишком длинно|сократи|кратко|много воды|хватит воды|покороче)/i.test(cleanText);
  if (isShorten) {
    currentStyle.verbosity = Math.max(0.1, +(currentStyle.verbosity - 0.15).toFixed(2));
    currentStyle.strictness = Math.min(1.0, +(currentStyle.strictness + 0.05).toFixed(2));
    styleChanged = true;
  }

  // 4. Запрос на подробность ("подробнее", "разверни", "распиши", "мало")
  const isExpand = /(?:подробнее|разверни|мало|поподробнее|распиши|дополни|детальнее)/i.test(cleanText);
  if (isExpand) {
    currentStyle.verbosity = Math.min(1.0, +(currentStyle.verbosity + 0.15).toFixed(2));
    styleChanged = true;
  }

  if (styleChanged) {
    await saveStyleProfile(cleanId, currentStyle);
    return true;
  }

  return false;
}

/**
 * Формирование инструкций стиля для системного промпта
 */
export async function getStyleDirectives(chatId: string | number): Promise<string> {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  const style = await getStyleProfile(cleanId);
  const bestPattern = await getBestPattern(cleanId);
  const profile = await getProfile(cleanId);
  const intents = profile?.intents || [];

  const styleHints: string[] = [];

  // Вербозность
  if (style.verbosity <= 0.3) {
    styleHints.push("Предельная лаконичность: 1-2 предложения, вывод в начале, никакой воды.");
  } else if (style.verbosity >= 0.7) {
    styleHints.push("Развёрнутый и обстоятельный ответ с деталями и пояснениями.");
  } else {
    styleHints.push("Кратко и по делу: 1-3 предложения для простых вопросов, 2-3 тезиса для сложных.");
  }

  // Строгость
  if (style.strictness >= 0.7) {
    styleHints.push("Деловой, строгий тон, оперируй фактами и цифрами.");
  } else if (style.strictness <= 0.3) {
    styleHints.push("Лёгкий, дружеский, живой тон общения.");
  }

  // Теплота
  if (style.warmth >= 0.7) {
    styleHints.push("Тёплый, поддерживающий стиль общения.");
  }

  // Влияние намерений (intents)
  if (intents.includes("заказы") || intents.some(i => i.toLowerCase().includes("заказ"))) {
    styleHints.push("Приоритет: помощь с заказами и доставкой — строгий деловой стиль, предельно кратко.");
  }
  if (intents.includes("разговор") || intents.some(i => i.toLowerCase().includes("разговор"))) {
    styleHints.push("Приоритет: свободный живой диалог, непринуждённое общение.");
  }
  if (intents.includes("Библия") || intents.some(i => i.toLowerCase().includes("библия"))) {
    styleHints.push("Приоритет: духовная поддержка, Библия и План Победы.");
  }

  let prompt = `ИНДИВИДУАЛЬНЫЙ СТИЛЬ ПОЛЬЗОВАТЕЛЯ:\n${styleHints.map(h => `- ${h}`).join('\n')}`;

  if (bestPattern) {
    prompt += `\n- Проверенный паттерн для этого пользователя: "${bestPattern}". Придерживайся схожей структуры.`;
  }

  return prompt;
}
