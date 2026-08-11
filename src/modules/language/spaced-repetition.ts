import type { ReviewResult } from './types';

/**
 * Алгоритм SM-2 (SuperMemo 2) для интервальных повторений.
 * Чистая функция без side effects.
 *
 * @param currentInterval - текущий интервал в днях
 * @param easeFactor - текущий фактор лёгкости (минимум 1.3)
 * @param quality - качество ответа 0-5 (0=полностью забыл, 5=идеально)
 * @returns Новые параметры для следующего повторения
 */
export function calculateNextReview(
  currentInterval: number,
  easeFactor: number,
  quality: number
): ReviewResult {
  const clampedQuality = Math.max(0, Math.min(5, quality));
  let newInterval: number;
  let newEaseFactor = easeFactor + (0.1 - (5 - clampedQuality) * (0.08 + (5 - clampedQuality) * 0.02));
  if (newEaseFactor < 1.3) newEaseFactor = 1.3;
  if (clampedQuality < 3) {
    newInterval = 1;
  } else {
    if (currentInterval === 1) {
      newInterval = 1;
    } else if (currentInterval <= 1) {
      newInterval = 6;
    } else {
      newInterval = Math.round(currentInterval * newEaseFactor);
    }
  }
  const nextReviewAt = Date.now() + newInterval * 24 * 60 * 60 * 1000;
  return {
    nextInterval: newInterval,
    newEaseFactor: Math.round(newEaseFactor * 100) / 100,
    nextReviewAt,
  };
}

/**
 * Определяет качество ответа пользователя на повторение.
 * @param expectedWord - ожидаемое слово
 * @param userAnswer - ответ пользователя
 * @returns quality 0-5
 */
export function assessQuality(expectedWord: string, userAnswer: string): number {
  const normalizedExpected = expectedWord.toLowerCase().trim();
  const normalizedAnswer = userAnswer.toLowerCase().trim();
  if (normalizedAnswer === normalizedExpected) return 5;
  if (levenshteinDistance(normalizedExpected, normalizedAnswer) <= 1) return 4;
  if (levenshteinDistance(normalizedExpected, normalizedAnswer) <= 2) return 3;
  if (normalizedAnswer.includes(normalizedExpected) || normalizedExpected.includes(normalizedAnswer)) return 2;
  if (normalizedAnswer.length > 0) return 1;
  return 0;
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}
