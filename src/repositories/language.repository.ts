import { sqliteDb } from '../../db';
import type { LanguageSettings, LanguageProgress, Level, LanguageCode } from '../modules/language/types';

/**
 * Репозиторий для работы с данными языкового обучения в SQLite.
 */
class LanguageRepository {
  /**
   * Сохраняет настройки языкового обучения пользователя.
   *
   * @param settings - Настройки пользователя
   */
  async saveSettings(settings: LanguageSettings): Promise<void> {
    if (!sqliteDb) return;
    const stmt = sqliteDb.prepare(`
      INSERT INTO language_settings (
        tenant_id, target_language, native_language, level, daily_goal, streak, total_words_learned, current_lesson, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET
        target_language = excluded.target_language,
        native_language = excluded.native_language,
        level = excluded.level,
        daily_goal = excluded.daily_goal,
        streak = excluded.streak,
        total_words_learned = excluded.total_words_learned,
        current_lesson = excluded.current_lesson
    `);
    stmt.run(
      settings.tenant_id,
      settings.target_language,
      settings.native_language || 'ru',
      settings.level || 'A1',
      settings.daily_goal || 10,
      settings.streak || 0,
      settings.total_words_learned || 0,
      settings.current_lesson || 1,
      settings.started_at || new Date().toISOString()
    );
  }

  /**
   * Получает настройки языкового обучения пользователя.
   *
   * @param tenantId - Идентификатор пользователя
   * @returns Настройки или null
   */
  async getSettings(tenantId: string): Promise<LanguageSettings | null> {
    if (!sqliteDb) return null;
    const stmt = sqliteDb.prepare(`SELECT * FROM language_settings WHERE tenant_id = ?`);
    const row = stmt.get(tenantId);
    if (!row) return null;
    return {
      tenant_id: row.tenant_id,
      target_language: row.target_language as LanguageCode,
      native_language: row.native_language || 'ru',
      level: (row.level || 'A1') as Level,
      daily_goal: Number(row.daily_goal) || 10,
      streak: Number(row.streak) || 0,
      total_words_learned: Number(row.total_words_learned) || 0,
      current_lesson: Number(row.current_lesson) || 1,
      started_at: row.started_at || new Date().toISOString(),
    };
  }

  /**
   * Обновляет уровень владения языком.
   *
   * @param tenantId - Идентификатор пользователя
   * @param level - Новый уровень (A1-C2)
   */
  async updateLevel(tenantId: string, level: Level): Promise<void> {
    if (!sqliteDb) return;
    const stmt = sqliteDb.prepare(`UPDATE language_settings SET level = ? WHERE tenant_id = ?`);
    stmt.run(level, tenantId);
  }

  /**
   * Обновляет текущий номер урока.
   *
   * @param tenantId - Идентификатор пользователя
   * @param lessonNum - Номер урока
   */
  async updateCurrentLesson(tenantId: string, lessonNum: number): Promise<void> {
    if (!sqliteDb) return;
    const stmt = sqliteDb.prepare(`UPDATE language_settings SET current_lesson = ? WHERE tenant_id = ?`);
    stmt.run(lessonNum, tenantId);
  }

  /**
   * Увеличивает счетчик изученных слов.
   *
   * @param tenantId - Идентификатор пользователя
   * @param count - Количество добавленных слов
   */
  async addWordsLearned(tenantId: string, count: number): Promise<void> {
    if (!sqliteDb) return;
    const stmt = sqliteDb.prepare(`
      UPDATE language_settings
      SET total_words_learned = COALESCE(total_words_learned, 0) + ?
      WHERE tenant_id = ?
    `);
    stmt.run(count, tenantId);
  }

  /**
   * Увеличивает серию (streak) активных дней.
   *
   * @param tenantId - Идентификатор пользователя
   */
  async incrementStreak(tenantId: string): Promise<void> {
    if (!sqliteDb) return;
    const stmt = sqliteDb.prepare(`
      UPDATE language_settings
      SET streak = COALESCE(streak, 0) + 1
      WHERE tenant_id = ?
    `);
    stmt.run(tenantId);
  }

  /**
   * Добавляет новое слово в прогресс.
   *
   * @param word - Запись о слове
   */
  async addWord(word: LanguageProgress): Promise<void> {
    if (!sqliteDb) return;
    const stmt = sqliteDb.prepare(`
      INSERT INTO language_progress (
        id, tenant_id, word, translation, example, transcription,
        next_review_at, review_count, ease_factor, interval_days, last_reviewed_at, mastery, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      word.id,
      word.tenant_id,
      word.word,
      word.translation,
      word.example || '',
      word.transcription || '',
      word.next_review_at,
      word.review_count || 0,
      word.ease_factor || 2.5,
      word.interval_days || 1,
      word.last_reviewed_at || null,
      word.mastery || 0,
      word.created_at || new Date().toISOString()
    );
  }

  /**
   * Возвращает слово по его идентификатору.
   *
   * @param id - Идентификатор слова
   */
  async getWordById(id: string): Promise<LanguageProgress | null> {
    if (!sqliteDb) return null;
    const stmt = sqliteDb.prepare(`SELECT * FROM language_progress WHERE id = ?`);
    const row = stmt.get(id);
    if (!row) return null;
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      word: row.word,
      translation: row.translation,
      example: row.example || '',
      transcription: row.transcription || '',
      next_review_at: Number(row.next_review_at) || 0,
      review_count: Number(row.review_count) || 0,
      ease_factor: Number(row.ease_factor) || 2.5,
      interval_days: Number(row.interval_days) || 1,
      last_reviewed_at: row.last_reviewed_at ? Number(row.last_reviewed_at) : null,
      mastery: Number(row.mastery) || 0,
      created_at: row.created_at || '',
    };
  }

  /**
   * Обновляет параметры повторения слова после ответа.
   *
   * @param id - Идентификатор слова
   * @param data - Частичные данные прогресса
   */
  async updateWordReview(id: string, data: Partial<LanguageProgress>): Promise<void> {
    if (!sqliteDb) return;
    const fields: string[] = [];
    const values: any[] = [];

    if (data.next_review_at !== undefined) {
      fields.push('next_review_at = ?');
      values.push(data.next_review_at);
    }
    if (data.review_count !== undefined) {
      fields.push('review_count = ?');
      values.push(data.review_count);
    }
    if (data.ease_factor !== undefined) {
      fields.push('ease_factor = ?');
      values.push(data.ease_factor);
    }
    if (data.interval_days !== undefined) {
      fields.push('interval_days = ?');
      values.push(data.interval_days);
    }
    if (data.last_reviewed_at !== undefined) {
      fields.push('last_reviewed_at = ?');
      values.push(data.last_reviewed_at);
    }
    if (data.mastery !== undefined) {
      fields.push('mastery = ?');
      values.push(data.mastery);
    }

    if (fields.length === 0) return;
    values.push(id);

    const stmt = sqliteDb.prepare(`UPDATE language_progress SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }

  /**
   * Возвращает список слов, требующих повторения на данный момент.
   *
   * @param tenantId - Идентификатор пользователя
   */
  async getDueWords(tenantId: string): Promise<LanguageProgress[]> {
    if (!sqliteDb) return [];
    const now = Date.now();
    const stmt = sqliteDb.prepare(`
      SELECT * FROM language_progress
      WHERE tenant_id = ? AND (next_review_at <= ? OR next_review_at IS NULL OR next_review_at = 0)
      ORDER BY next_review_at ASC
      LIMIT 20
    `);
    const rows = stmt.all(tenantId, now);
    return rows.map((row: any) => ({
      id: row.id,
      tenant_id: row.tenant_id,
      word: row.word,
      translation: row.translation,
      example: row.example || '',
      transcription: row.transcription || '',
      next_review_at: Number(row.next_review_at) || 0,
      review_count: Number(row.review_count) || 0,
      ease_factor: Number(row.ease_factor) || 2.5,
      interval_days: Number(row.interval_days) || 1,
      last_reviewed_at: row.last_reviewed_at ? Number(row.last_reviewed_at) : null,
      mastery: Number(row.mastery) || 0,
      created_at: row.created_at || '',
    }));
  }

  /**
   * Возвращает неоконченное домашнее задание пользователя.
   *
   * @param tenantId - Идентификатор пользователя
   */
  async getActiveHomework(tenantId: string): Promise<any | null> {
    if (!sqliteDb) return null;
    const stmt = sqliteDb.prepare(`
      SELECT * FROM language_lessons
      WHERE tenant_id = ? AND homework_done = 0
      ORDER BY lesson_num DESC
      LIMIT 1
    `);
    return stmt.get(tenantId) || null;
  }

  /**
   * Отмечает домашнее задание как выполненное.
   *
   * @param lessonId - Идентификатор урока
   */
  async markHomeworkDone(lessonId: string): Promise<void> {
    if (!sqliteDb) return;
    const stmt = sqliteDb.prepare(`
      UPDATE language_lessons
      SET homework_done = 1, completed_at = ?
      WHERE id = ?
    `);
    stmt.run(new Date().toISOString(), lessonId);
  }

  /**
   * Сохраняет сгенерированный урок.
   *
   * @param lesson - Данные урока
   */
  async saveLesson(lesson: any): Promise<void> {
    if (!sqliteDb) return;
    const stmt = sqliteDb.prepare(`
      INSERT INTO language_lessons (
        id, tenant_id, lesson_num, topic, words_json, dialogue_json, homework, homework_done, completed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        topic = excluded.topic,
        words_json = excluded.words_json,
        dialogue_json = excluded.dialogue_json,
        homework = excluded.homework
    `);
    stmt.run(
      lesson.id,
      lesson.tenant_id,
      lesson.lesson_num,
      lesson.topic,
      lesson.words_json,
      lesson.dialogue_json,
      lesson.homework,
      lesson.homework_done || 0,
      lesson.completed_at || null,
      lesson.created_at || new Date().toISOString()
    );
  }

  /**
   * Возвращает статистику выученных слов и мастерства.
   *
   * @param tenantId - Идентификатор пользователя
   */
  async getStats(tenantId: string): Promise<{ totalWords: number; masteredWords: number }> {
    if (!sqliteDb) return { totalWords: 0, masteredWords: 0 };
    const totalStmt = sqliteDb.prepare(`SELECT COUNT(*) as count FROM language_progress WHERE tenant_id = ?`);
    const totalRow = totalStmt.get(tenantId);

    const masteredStmt = sqliteDb.prepare(`SELECT COUNT(*) as count FROM language_progress WHERE tenant_id = ? AND mastery >= 4`);
    const masteredRow = masteredStmt.get(tenantId);

    return {
      totalWords: Number(totalRow?.count) || 0,
      masteredWords: Number(masteredRow?.count) || 0,
    };
  }
}

export const languageRepository = new LanguageRepository();
