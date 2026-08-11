import { generateLesson } from './lesson-generator';
import { calculateNextReview, assessQuality } from './spaced-repetition';
import { languageRepository } from '../../repositories/language.repository';
import { userModeRepository } from '../../repositories/user-mode.repository';
import { geminiService } from '../../services/gemini.service';
import type { LanguageCode, Level, LanguageSettings } from './types';
import { SUPPORTED_LANGUAGES, LEVELS, LESSONS_PER_LEVEL } from '../../config/constants';

/**
 * Начинает изучение нового языка для пользователя.
 * Проводит короткий тест для определения уровня.
 *
 * @param tenantId - идентификатор пользователя
 * @param language - код целевого языка
 * @returns Приветственное сообщение и тестовый вопрос
 */
export async function startLearning(tenantId: string, language: LanguageCode): Promise<string> {
  const langInfo = SUPPORTED_LANGUAGES[language];
  if (!langInfo) {
    return `Неподдерживаемый язык. Доступные: ${Object.values(SUPPORTED_LANGUAGES).map((l) => l.name).join(', ')}`;
  }

  await languageRepository.saveSettings({
    tenant_id: tenantId,
    target_language: language,
    native_language: 'ru',
    level: 'A1',
    daily_goal: 10,
    streak: 0,
    total_words_learned: 0,
    current_lesson: 1,
    started_at: new Date().toISOString(),
  });

  await userModeRepository.setMode(tenantId, 'language', { language });

  const levelTestPrompt = `Ты преподаватель ${langInfo.nativeName}. Задай один короткий вопрос на ${langInfo.nativeName} для определения уровня ученика (A1-C2). Вопрос должен быть понятен даже новичку. Верни ТОЛЬКО вопрос.`;
  const testQuestion = await geminiService.generate(levelTestPrompt, { temperature: 0.5 });

  return `Отлично! Начинаем изучение ${langInfo.name} языка 🌍\n\nСначала определим твой уровень. Ответь на вопрос:\n\n${testQuestion}\n\nОтветь голосом или текстом — я определю твой уровень и подберу программу.`;
}

/**
 * Обрабатывает входящее сообщение в режиме изучения языка.
 * Маршрутизирует: определение уровня → повторение → урок → домашка → квест.
 */
export async function processMessage(tenantId: string, text: string, _isVoice: boolean = false): Promise<string> {
  const settings = await languageRepository.getSettings(tenantId);
  if (!settings) {
    return 'Сначала выбери язык для изучения. Скажи: хочу учить английский / испанский / немецкий / французский / китайский / японский / корейский / итальянский / португальский / арабский / турецкий.';
  }

  const langInfo = SUPPORTED_LANGUAGES[settings.target_language];

  // 1. Если уровень ещё не определён — определить из ответа
  if (settings.level === 'A1' && settings.current_lesson === 1 && settings.total_words_learned === 0) {
    const detectedLevel = await detectLevel(settings.target_language, text);
    await languageRepository.updateLevel(tenantId, detectedLevel);
    settings.level = detectedLevel;
    const lessonNum = getLessonNumberForLevel(detectedLevel);
    await languageRepository.updateCurrentLesson(tenantId, lessonNum);
    return `Твой уровень: ${detectedLevel} 👏\nНачинаем с урока ${lessonNum}. Готов? Скажи "начнём" или "давай".`;
  }

  // 2. Проверить есть ли активное домашнее задание
  const activeHomework = await languageRepository.getActiveHomework(tenantId);
  if (activeHomework && !activeHomework.homework_done) {
    return await checkHomework(tenantId, text, activeHomework, settings);
  }

  // 3. Проверить слова для повторения сегодня
  const dueWords = await languageRepository.getDueWords(tenantId);
  if (dueWords.length > 0) {
    return await startReview(tenantId, dueWords, settings);
  }

  // 4. Предложить новый урок
  const currentLesson = settings.current_lesson;
  const maxLesson = 60;
  if (currentLesson > maxLesson) {
    return `🎉 Поздравляю! Ты прошёл все 60 уроков и достиг уровня C2 в ${langInfo.name} языке!\n\nХочешь начать другой язык? Скажи: хочу учить [язык].`;
  }

  return `Сегодня урок ${currentLesson}. Тема готова.\n\nСкажи "начнём" чтобы начать урок, или "повторение" чтобы повторить старые слова.\n\n📊 Твой прогресс: ${settings.total_words_learned} слов выучено, серия: ${settings.streak} дней 🔥`;
}

/**
 * Определяет уровень ученика по ответу на тестовый вопрос.
 */
export async function detectLevel(language: LanguageCode, answer: string): Promise<Level> {
  const langInfo = SUPPORTED_LANGUAGES[language];
  const prompt = `Определи уровень владения ${langInfo.nativeName} языком по этому ответу ученика. Ответ ученика: "${answer}" Верни ТОЛЬКО одну букву с цифрой: A1, A2, B1, B2, C1 или C2. Без объяснений.`;
  const result = await geminiService.generate(prompt, { temperature: 0 });
  const level = result.trim().toUpperCase() as Level;
  return LEVELS.includes(level) ? level : 'A1';
}

/**
 * Проверяет домашнее задание и даёт обратную связь.
 */
export async function checkHomework(
  tenantId: string,
  answer: string,
  homework: any,
  settings: LanguageSettings
): Promise<string> {
  const langInfo = SUPPORTED_LANGUAGES[settings.target_language];
  const prompt = `Ты преподаватель ${langInfo.nativeName}. Ученик выполнил домашнее задание.
ЗАДАНИЕ: ${homework.homework}
ОТВЕТ УЧЕНИКА: ${answer}

Оцени ответ:
1. Правильность грамматики (ошибки перечисли)
2. Использование лексики урока
3. Полнота ответа
4. Общая оценка 1-10

Формат: коротко, по делу, на русском. Сначала похвали за усилия, потом укажи ошибки, потом дай оценку.`;

  const feedback = await geminiService.generate(prompt, { temperature: 0.3 });
  await languageRepository.markHomeworkDone(homework.id);
  await languageRepository.incrementStreak(tenantId);
  const nextLesson = settings.current_lesson + 1;
  await languageRepository.updateCurrentLesson(tenantId, nextLesson);

  return `${feedback}\n\n✅ Домашка принята! Серия: ${settings.streak + 1} дней 🔥\n\nСледующий урок: ${nextLesson}. Скажи "начнём" когда будешь готов.`;
}

/**
 * Начинает сессию повторения слов по алгоритму SM-2.
 */
export async function startReview(
  tenantId: string,
  dueWords: any[],
  settings: LanguageSettings
): Promise<string> {
  const langInfo = SUPPORTED_LANGUAGES[settings.target_language];
  const word = dueWords[0];
  await userModeRepository.setMode(tenantId, 'language', {
    language: settings.target_language,
    reviewing_word_id: word.id,
  });

  return `🔄 Время повторения! У тебя ${dueWords.length} слов для повторения сегодня.\n\nКак будет "${word.translation}" на ${langInfo.nativeName}?\n\nПодсказка: ${word.example ? word.example.substring(0, 30) + '...' : 'вспомни урок'}`;
}

/**
 * Обрабатывает ответ на повторение слова.
 */
export async function processReviewAnswer(tenantId: string, answer: string): Promise<string> {
  const modeData = await userModeRepository.getModeData(tenantId);
  const wordId = modeData?.reviewing_word_id;
  if (!wordId) {
    return processMessage(tenantId, answer, false);
  }

  const word = await languageRepository.getWordById(wordId);
  if (!word) {
    return 'Ошибка: слово не найдено. Продолжаем обычный режим.';
  }

  const quality = assessQuality(word.word, answer);
  const result = calculateNextReview(word.interval_days, word.ease_factor, quality);

  await languageRepository.updateWordReview(wordId, {
    next_review_at: result.nextReviewAt,
    review_count: word.review_count + 1,
    ease_factor: result.newEaseFactor,
    interval_days: result.nextInterval,
    last_reviewed_at: Date.now(),
    mastery: Math.min(5, quality),
  });

  const feedback =
    quality >= 4 ? '✅ Отлично!' : quality >= 3 ? '👍 Почти! Правильный ответ: ' + word.word : '❌ Правильный ответ: ' + word.word;

  const remaining = await languageRepository.getDueWords(tenantId);
  if (remaining.length > 0) {
    const nextWord = remaining[0];
    await userModeRepository.setMode(tenantId, 'language', {
      language: modeData.language,
      reviewing_word_id: nextWord.id,
    });
    return `${feedback}\n\nСледующее слово: как будет "${nextWord.translation}"? (Осталось: ${remaining.length})`;
  }

  await userModeRepository.setMode(tenantId, 'language', { language: modeData.language });
  return `${feedback}\n\n🎉 Все слова повторены! Отличная работа.\n\nСкажи "урок" для нового урока или "пока" для выхода.`;
}

/**
 * Генерирует и отправляет голосовой/текстовый урок.
 */
export async function startLesson(tenantId: string): Promise<{ text: string; audioText: string }> {
  const settings = await languageRepository.getSettings(tenantId);
  if (!settings) throw new Error('Language settings not found');

  const langInfo = SUPPORTED_LANGUAGES[settings.target_language];
  const levelInCourse = ((settings.current_lesson - 1) % LESSONS_PER_LEVEL) + 1;
  const dueWords = await languageRepository.getDueWords(tenantId);

  const lesson = await generateLesson(
    settings.target_language,
    settings.level,
    levelInCourse,
    dueWords.slice(0, 5)
  );

  for (const w of lesson.words) {
    await languageRepository.addWord({
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      word: w.word,
      translation: w.translation,
      example: w.example,
      transcription: w.transcription,
      next_review_at: Date.now() + 60 * 1000,
      review_count: 0,
      ease_factor: 2.5,
      interval_days: 1,
      last_reviewed_at: null,
      mastery: 0,
      created_at: new Date().toISOString(),
    });
  }

  await languageRepository.saveLesson({
    id: lesson.id,
    tenant_id: tenantId,
    lesson_num: settings.current_lesson,
    topic: lesson.topic,
    words_json: JSON.stringify(lesson.words),
    dialogue_json: JSON.stringify(lesson.dialogue),
    homework: lesson.homework,
    homework_done: 0,
    completed_at: null,
    created_at: new Date().toISOString(),
  });

  await languageRepository.addWordsLearned(tenantId, lesson.words.length);

  const wordsList = lesson.words
    .map((w, i) => `${i + 1}. ${w.word}${w.transcription ? ` [${w.transcription}]` : ''} — ${w.translation}\n   Пример: ${w.example}`)
    .join('\n\n');

  const dialogueText = lesson.dialogue.map((d) => `${d.role}: ${d.text}`).join('\n');

  const textResponse = `📚 Урок ${settings.current_lesson}: ${lesson.topic}\nУровень: ${settings.level} | ${langInfo.name}\n${lesson.grammar_note ? `\n📝 Грамматика: ${lesson.grammar_note}\n` : ''}\n📖 Новые слова:\n\n${wordsList}\n\n💬 Диалог:\n\n${dialogueText}\n\n📝 Домашнее задание:\n${lesson.homework}\n\n🎯 Квест дня:\n${lesson.quest}`;

  const audioText = `Урок ${settings.current_lesson}. Тема: ${lesson.topic}. ${lesson.words.slice(0, 5).map((w) => `${w.word}. ${w.translation}.`).join(' ')} Домашнее задание: ${lesson.homework}. Квест: ${lesson.quest}`;

  return { text: textResponse, audioText };
}

/**
 * Возвращает статистику прогресса пользователя.
 */
export async function getProgress(tenantId: string): Promise<string> {
  const settings = await languageRepository.getSettings(tenantId);
  if (!settings) return 'Ты ещё не начал изучение языка.';

  const langInfo = SUPPORTED_LANGUAGES[settings.target_language];
  const stats = await languageRepository.getStats(tenantId);
  const dueToday = await languageRepository.getDueWords(tenantId);

  return (
    `📊 Твой прогресс в ${langInfo.name}:\n\n` +
    `📈 Уровень: ${settings.level}\n` +
    `📚 Урок: ${settings.current_lesson} из 60\n` +
    `📝 Слов выучено: ${settings.total_words_learned}\n` +
    `🔄 Повторить сегодня: ${dueToday.length}\n` +
    `🔥 Серия: ${settings.streak} дней\n` +
    `⭐ Мастерство слов: ${stats.masteredWords}/${stats.totalWords}\n\n` +
    `Команды: "урок" | "повторение" | "прогресс" | "сменить язык" | "обычный режим"`
  );
}

/**
 * Переключает на другой язык.
 */
export async function switchLanguage(tenantId: string, language: LanguageCode): Promise<string> {
  const langInfo = SUPPORTED_LANGUAGES[language];
  if (!langInfo) {
    const available = Object.entries(SUPPORTED_LANGUAGES)
      .map(([code, info]) => `${info.name} (${code})`)
      .join(', ');
    return `Неподдерживаемый язык. Доступные: ${available}`;
  }

  await languageRepository.saveSettings({
    tenant_id: tenantId,
    target_language: language,
    native_language: 'ru',
    level: 'A1',
    daily_goal: 10,
    streak: 0,
    total_words_learned: 0,
    current_lesson: 1,
    started_at: new Date().toISOString(),
  });

  return `Переключились на ${langInfo.name} 🌍\nНачинаем с нуля. Готов? Скажи "начнём".`;
}

function getLessonNumberForLevel(level: Level): number {
  const levelIndex = LEVELS.indexOf(level);
  return levelIndex * LESSONS_PER_LEVEL + 1;
}
