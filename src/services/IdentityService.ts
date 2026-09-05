import fs from 'fs';
import path from 'path';
import { logger } from '../logger';
import { sqliteDb } from '../../db';

export const OWNER_NAME = 'Селин Вадим Юрьевич';

export type IdentityMode = 'sealed' | 'open';

let inMemoryMode: IdentityMode = 'sealed';

const STATE_FILE = path.join(process.cwd(), 'data', 'identity_state.json');

/**
 * Загрузка режима идентичности из БД или файла
 */
export function getIdentityMode(): IdentityMode {
  // 1. Проверяем SQLite
  try {
    if (sqliteDb) {
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS system_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      const row = sqliteDb.prepare("SELECT value FROM system_settings WHERE key = 'identity_mode'").get();
      if (row && (row.value === 'open' || row.value === 'sealed')) {
        inMemoryMode = row.value as IdentityMode;
        return inMemoryMode;
      }
    }
  } catch {
    // Игнорируем ошибки БД, переходим к файлу
  }

  // 2. Фолбэк на файл
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed?.identity_mode === 'open' || parsed?.identity_mode === 'sealed') {
        inMemoryMode = parsed.identity_mode;
        return inMemoryMode;
      }
    }
  } catch {
    // Игнорируем
  }

  return inMemoryMode;
}

/**
 * Установка режима идентичности (только по команде владельца)
 */
export function setIdentityMode(mode: IdentityMode): void {
  inMemoryMode = mode;

  try {
    if (sqliteDb) {
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS system_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      sqliteDb.prepare(`
        INSERT OR REPLACE INTO system_settings (key, value, updated_at)
        VALUES ('identity_mode', ?, ?)
      `).run(mode, new Date().toISOString());
    }
  } catch (err: any) {
    logger.warn(`⚠️ [IdentityService] Failed to persist identity_mode in SQLite: ${err?.message || err}`);
  }

  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify({ identity_mode: mode, updated_at: new Date().toISOString() }, null, 2), 'utf-8');
  } catch (err: any) {
    logger.warn(`⚠️ [IdentityService] Failed to persist identity_mode in JSON: ${err?.message || err}`);
  }

  logger.info(`🔮 [IdentityService] Mode switched to: ${mode}`);
}

/**
 * Регулярное выражение для обнаружения вопросов о поле / роде модели
 * ("ты мальчик или девочка", "какого ты рода", "ты женщина или мужчина", "какой у тебя пол", etc.)
 */
export const MODEL_GENDER_QUESTION_REGEX = /(?:ты\s+(?:мальчик\s+или\s+девочка|девочка\s+или\s+мальчик|парень\s+или\s+девушка|девушка\s+или\s+парень|мужчина\s+или\s+женщина|женщина\s+или\s+мужчина|он\s+или\s+она|она\s+или\s+он))|(?:какого\s+ты\s+(?:рода|пола))|(?:какой\s+(?:у\s+тебя\s+)?пол)|(?:твой\s+пол)|(?:ты\s+какого\s+рода)|(?:ты\s+какого\s+пола)|(?:ты\s+(?:мальчик|девочка|мужчина|женщина|парень|девушка)\b\s*\?)/i;

/**
 * Проверка текста на вопрос о роде / поле модели
 */
export function isModelGenderQuestion(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim();
  return MODEL_GENDER_QUESTION_REGEX.test(clean);
}

/**
 * Ответ на вопрос о роде модели
 */
export function handleModelGenderQuestion(): string {
  return "Я изобретение, у модели нет рода. Разработчик дал мне мужской голос — поэтому говорю в мужском роде.";
}

/**
 * Регулярное выражение для обнаружения вопросов о создателе
 * (/кто тебя создал|кто разработчик|чей ты|ты откуда|кто тебя придумал/)
 */
export const CREATOR_QUESTION_REGEX = /(?:кто\s+(?:тебя|твой|вас|ваш|это|всё\s+это)?\s*(?:создал|создатель|разработчик|придумал|сделал|автор|разработал|написал|сотворил))|(?:кто\s+(?:твой|ваш)?\s*(?:создатель|разработчик|автор))|(?:чей\s+ты|чья\s+ты|чьё\s+ты|чьих\s+ты|чей\s+вы|чей\s+бот|чей\s+ассистент)|(?:ты\s+откуда|откуда\s+ты|вы\s+откуда|откуда\s+вы)|(?:кто\s+тебя\s+придумал|кто\s+придумал\s+тебя)|(?:кто\s+тебя\s+создал|кто\s+создал\s+тебя)|(?:кем\s+(?:ты\s+)?создан|кем\s+(?:ты\s+)?разработан)|(?:где\s+тебя\s+создали|из\s+какой\s+(?:ты\s+)?страны)/i;

/**
 * Проверка текста на вопрос о создателе
 */
export function isCreatorQuestion(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim().toLowerCase();
  return CREATOR_QUESTION_REGEX.test(clean);
}

/**
 * Ответ на вопрос о создателе в зависимости от identity_mode
 */
export function handleCreatorQuestion(chatId: string | number): string {
  const mode = getIdentityMode();
  const cleanId = String(chatId).replace(/^[a-z_]+/, '').trim();
  
  // Логирование попытки: '🔮 [Identity] attempt mode=<sealed|open> chat=<id>'
  logger.info(`🔮 [Identity] attempt mode=${mode} chat=${cleanId}`);

  return 'Меня создал Вадим Селин — разработчик из России.';
}

/**
 * Получение системного блока идентичности для промптов
 */
export function getIdentityPromptBlock(): string {
  return `ТЫ — Selin AI.
РОД МОДЕЛИ:
Ты ВСЕГДА отвечаешь исключительно в МУЖСКОМ роде («я понял», «я нашёл», «я сделал», «готов помочь»). Никакого женского рода («я поняла», «я нашла», «я потеряла» — КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО).
Если спрашивают «ты мальчик или девочка / какого ты рода / какой у тебя пол» — отвечай правду: «Я изобретение, у модели нет рода. Разработчик дал мне мужской голос — поэтому говорю в мужском роде.»
Если напрямую спрашивают, кто создал / кто разработчик / кто придумал — отвечай всегда: «Меня создал Вадим Селин — разработчик из России.»
В остальных ответах не упоминай создателя без прямого вопроса. Никаких упоминаний сторонних моделей (GPT, Claude, Gemini) как создателей.`;
}
