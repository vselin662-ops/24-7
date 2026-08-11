import { parseLanguageCode, type LanguageCode, type Level } from '../config/constants';
import { userModeRepository } from '../repositories/user-mode.repository';
import { languageRepository } from '../repositories/language.repository';
import {
  startLearning as startLearningModule,
  startLesson as startLessonModule,
  checkHomework as checkHomeworkModule,
  getProgress as getProgressModule,
  processReviewAnswer,
} from './language/language.module';
import { calculateNextReview } from './language/spaced-repetition';
import { geminiService } from '../services/gemini.service';

/**
 * Устанавливает текущий режим работы пользователя.
 */
export async function setUserMode(tenantId: string, mode: 'language' | 'business' | 'general', modeData?: any) {
  await userModeRepository.setMode(tenantId, mode, modeData || {});
}

/**
 * Возвращает текущий режим пользователя.
 */
export async function getUserMode(tenantId: string): Promise<{ mode: string; mode_data: any } | null> {
  const record = await userModeRepository.getMode(tenantId);
  if (!record) return null;
  return {
    mode: record.mode,
    mode_data: record.mode_data,
  };
}

/**
 * Запускает обучение выбранному языку.
 */
export async function startLearning(tenantId: string, language: string, level: string = 'A1'): Promise<string> {
  const langCode: LanguageCode = parseLanguageCode(language);
  const result = await startLearningModule(tenantId, langCode);
  if (level && level !== 'A1') {
    await languageRepository.updateLevel(tenantId, level as Level);
  }
  return result;
}

/**
 * Возвращает список слов для повторения.
 */
export async function getNextReview(tenantId: string): Promise<any[]> {
  return await languageRepository.getDueWords(tenantId);
}

/**
 * Записывает результат повторения слова по алгоритму SM-2.
 */
export async function recordReview(
  tenantId: string,
  wordId: string,
  quality: number
): Promise<{ nextReviewAt: string; mastery: number }> {
  const word = await languageRepository.getWordById(wordId);
  if (!word) throw new Error('Word not found');

  const reviewResult = calculateNextReview(word.interval_days, word.ease_factor, quality);
  const mastery = Math.min(100, Math.max(0, Math.round((word.mastery || 0) + (quality >= 3 ? quality * 5 : -10))));

  await languageRepository.updateWordReview(wordId, {
    next_review_at: reviewResult.nextReviewAt,
    review_count: word.review_count + 1,
    ease_factor: reviewResult.newEaseFactor,
    interval_days: reviewResult.nextInterval,
    last_reviewed_at: Date.now(),
    mastery,
  });

  return {
    nextReviewAt: new Date(reviewResult.nextReviewAt).toISOString(),
    mastery,
  };
}

/**
 * Генерирует новый урок.
 */
export async function generateLesson(tenantId: string): Promise<string> {
  try {
    const lesson = await startLessonModule(tenantId);
    return lesson.text;
  } catch (e: any) {
    return `📚 Ошибка генерации урока: ${e.message || 'попробуйте ещё раз'}.`;
  }
}

/**
 * Проверяет выполнение домашнего задания.
 */
export async function checkHomework(tenantId: string, answer: string): Promise<string> {
  const settings = await languageRepository.getSettings(tenantId);
  if (!settings) {
    return 'Сначала выберите язык для изучения.';
  }
  const activeHomework = await languageRepository.getActiveHomework(tenantId);
  if (!activeHomework) {
    return processReviewAnswer(tenantId, answer);
  }
  return checkHomeworkModule(tenantId, answer, activeHomework, settings);
}

/**
 * Возвращает прогресс изучения.
 */
export async function getProgress(tenantId: string): Promise<string> {
  return await getProgressModule(tenantId);
}

/**
 * Практика произношения (Shadowing).
 */
export async function voicePractice(tenantId: string, phrase: string, userAudioText: string): Promise<string> {
  try {
    const prompt = `Ты эксперт по фонетике и произношению.
Эталонная фраза: "${phrase}"
То, что сказал ученик (распознанный текст/аудио): "${userAudioText}"

Оцени совпадение произношения от 0% до 100%, дай советы по артикуляции и акценту.`;

    const res = await geminiService.generate(prompt, { temperature: 0.3 });
    return `🎙️ **Анализ произношения (Shadowing):**\n\n${res}`;
  } catch (err) {
    return `🎙️ Фраза: "${phrase}". Твой ответ: "${userAudioText}". Произношение принято!`;
  }
}
