import crypto from 'crypto';
import { geminiService } from '../../services/gemini.service';
import type { LanguageCode, Level, Lesson } from './types';
import { SUPPORTED_LANGUAGES, TOPICS_BY_LEVEL } from '../../config/constants';
import { logger } from '../../logger';

/**
 * Генерирует структурированный урок для любого языка и уровня через Gemini.
 *
 * @param language - код языка (en, es, de, fr, ...)
 * @param level - уровень (A1-C2)
 * @param lessonNum - номер урока в уровне (1-10)
 * @param reviewWords - слова для повторения из spaced repetition
 * @returns Структурированный урок с словами, диалогом, домашкой и квестом
 */
export async function generateLesson(
  language: LanguageCode,
  level: Level,
  lessonNum: number,
  reviewWords: Array<{ word: string; translation: string }>
): Promise<Lesson> {
  const langInfo = SUPPORTED_LANGUAGES[language];
  const topicIndex = Math.min(lessonNum - 1, 9);
  const topic = TOPICS_BY_LEVEL[level][topicIndex];
  const isReviewLesson = lessonNum === 10;

  const prompt = `Ты — профессиональный преподаватель ${langInfo.name} языка (${langInfo.nativeName}).
Составь урок для ученика.

ПАРАМЕТРЫ:
Язык: ${langInfo.nativeName}
Уровень ученика: ${level}
Номер урока: ${lessonNum} из 10 в уровне ${level}
Тема: ${topic}
${reviewWords.length > 0 ? `- Слова для повторения (включи их в урок): ${reviewWords.map(w => w.word).join(', ')}` : ''}
${isReviewLesson ? '- Это УРОК ПОВТОРЕНИЯ. Не давай новых слов. Создай комплексный тест по всем темам уровня.' : ''}

ТРЕБОВАНИЯ К УРОКУ:
1. Ровно 10 новых слов/фраз (если не урок повторения) с переводом на русский и примером использования
2. Диалог на 6-8 реплик между двумя персонажами на изучаемом языке
3. Домашнее задание — конкретное, выполнимое, требует голосового ответа
4. Квест — ролевая ситуация где ученик применяет все слова урока

ФОРМАТ ОТВЕТА — СТРОГО JSON:
{
"words": [
{"word": "слово на ${langInfo.nativeName}", "translation": "перевод на русский", "example": "пример предложения на ${langInfo.nativeName}"}
],
"dialogue": [
{"role": "имя персонажа", "text": "реплика на ${langInfo.nativeName}"},
{"role": "имя персонажа", "text": "перевод реплики на русский в скобках"}
],
"homework": "текст домашнего задания на русском",
"quest": "текст квеста на русском",
"grammar_note": "краткая заметка о грамматике урока на русском (если применимо)"
}

ВАЖНО:
Слова должны соответствовать уровню ${level}
Диалог должен быть естественным и использовать все 10 слов
Домашка должна требовать минимум 6-8 предложений на ${langInfo.nativeName}
Квест должен быть реалистичной ситуацией
Никаких выдуманных слов — только реальная лексика
Для китайского/японского/корейского/арабского добавляй транскрипцию
Верни ТОЛЬКО JSON без markdown обёртки`;

  const response = await geminiService.generate(prompt, { temperature: 0.7 });
  const lesson = parseLessonResponse(response);

  return {
    id: crypto.randomUUID(),
    language,
    level,
    lesson_num: lessonNum,
    topic,
    ...lesson,
    created_at: Date.now(),
  };
}

/**
 * Вспомогательная функция парсинга ответа от Gemini в объект урока.
 */
function parseLessonResponse(response: string): {
  words: any[];
  dialogue: any[];
  homework: string;
  quest: string;
  grammar_note?: string;
} {
  try {
    const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      words: Array.isArray(parsed.words) ? parsed.words : [],
      dialogue: Array.isArray(parsed.dialogue) ? parsed.dialogue : [],
      homework: parsed.homework || 'Составьте 5 предложений с новыми словами.',
      quest: parsed.quest || 'Примените новые слова в диалоге с ботом.',
      grammar_note: parsed.grammar_note || undefined,
    };
  } catch (e) {
    logger.error('Failed to parse lesson JSON from Gemini', { error: e, raw: response });
    return {
      words: [],
      dialogue: [],
      homework: 'Выучите новые слова урока.',
      quest: 'Составьте диалог с новыми словами.',
      grammar_note: undefined,
    };
  }
}
