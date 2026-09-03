import { normalizeForVoice as normalizeVoiceUtil, normalizeForSpeech as normalizeSpeechUtil } from "./voiceNormalizer";
import { preprocessTextForTTS, applyStressDict, prepareIntonation, TTSEngineType } from "../services/StressService";

export function cleanForMax(text: string): string {
  if (!text) return '';
  return String(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/^\s*[-=|]{3,}\s*$/gm, '')
    .replace(/\|/g, ' ')
    .replace(/[_~]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function prepareVoiceText(text: string): string {
  if (!text) return '';
  let res = cleanForMax(text);
  res = res.replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{27BF}\u{FE0F}]/gu, '');
  res = res.replace(/[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, '');
  res = res.replace(/https?:\/\/\S+/g, '');
  res = res.replace(/^(Ой|Ах|Ох|Ну|Вот|Слушай|Значит)[,! ]+/gi, '');
  res = res.replace(/[*#]/g, '');
  res = res.replace(/\s+/g, ' ').trim();
  if (res.length > 8000) {
    const sub = res.slice(0, 8000);
    const lastDot = sub.lastIndexOf('.');
    if (lastDot > 0) {
      res = sub.slice(0, lastDot).trim() + '...';
    } else {
      res = sub.trim() + '...';
    }
  }
  return res.trim();
}

/**
 * Умная нормализация чисел для голосового произношения (ТОЛЬКО для TTS)
 * Пайплайн TTS: cleanForMax -> prepareVoiceText -> normalizeForVoice (ВЕСЬ текст целиком) -> ТОЛЬКО ПОТОМ разбивка на чанки для TTS
 */
export function normalizeForVoice(text: string): string {
  if (!text) return '';
  const pre = prepareVoiceText(text);
  if (!pre) return '';
  return normalizeVoiceUtil(pre);
}

/**
 * Глобальный нормализатор для всех TTS ответов (ШАГ 5)
 */
export function normalizeForSpeech(text: string, engine: TTSEngineType = 'edge'): string {
  if (!text) return '';
  const normalized = normalizeSpeechUtil(text);
  return preprocessTextForTTS(normalized, engine);
}

export { preprocessTextForTTS, applyStressDict, prepareIntonation };
export type { TTSEngineType };

/**
 * Правильная нарезка текста на чанки по границам предложений (ШАГ 2):
 * 1. Режет ТОЛЬКО по границам предложений: после . ! ? …
 * 2. Если предложение длиннее 300 символов — режет по запятым.
 * 3. НИКОГДА не режет внутри фразы или слова.
 */
export function chunkText(text: string, maxLen: number = 300): string[] {
  if (!text || !text.trim()) return [];
  const raw = text.trim();
  if (raw.length <= maxLen) return [raw];

  const result: string[] = [];
  // Режем строго по границам предложений (. ! ? …)
  const sentences = raw.split(/(?<=[.!?…])\s+/);
  let current = '';

  for (const sentence of sentences) {
    if (!sentence || !sentence.trim()) continue;

    if ((current ? current + ' ' + sentence : sentence).length <= maxLen) {
      current = current ? current + ' ' + sentence : sentence;
    } else {
      if (current) {
        result.push(current.trim());
        current = '';
      }

      // Если отдельное предложение длиннее maxLen — режем по запятым
      if (sentence.length > maxLen) {
        const clauses = sentence.split(/(?<=,)\s+/);
        let temp = '';
        for (const clause of clauses) {
          if (!clause || !clause.trim()) continue;
          if ((temp ? temp + ' ' + clause : clause).length <= maxLen) {
            temp = temp ? temp + ' ' + clause : clause;
          } else {
            if (temp) {
              result.push(temp.trim());
              temp = '';
            }
            if (clause.length > maxLen) {
              // Если кусок всё ещё длиннее maxLen — режем строго по словам, не ломая слова
              const words = clause.split(/\s+/);
              let wTemp = '';
              for (const w of words) {
                if ((wTemp ? wTemp + ' ' + w : w).length <= maxLen) {
                  wTemp = wTemp ? wTemp + ' ' + w : w;
                } else {
                  if (wTemp) result.push(wTemp.trim());
                  wTemp = w;
                }
              }
              if (wTemp) temp = wTemp;
            } else {
              temp = clause;
            }
          }
        }
        if (temp && temp.trim()) {
          current = temp;
        }
      } else {
        current = sentence;
      }
    }
  }

  if (current && current.trim()) {
    result.push(current.trim());
  }

  return result.length > 0 ? result : [raw];
}

/**
 * Алиас для обратной совместимости
 */
export const splitTextSmart = chunkText;


/**
 * Очистка и фонетическая оптимизация текста перед озвучкой в TTS
 */
export function sanitizeForTTS(text: string): string {
  if (!text) return "";

  let cleaned = text;

  // 1. Номер дня в голосе убирай полностью (или пиши словами)
  // Убираем выражения типа "План Победы (День 246/365 — Утреннее чтение: Псалтирь 22:1)"
  // А также любые упоминания "День 246" или "день 246/365"
  cleaned = cleaned.replace(/день\s+\d+(\/\d+)?(\s*[-—]\s*)?/gi, '');

  // 2. Удаляет ВСЁ содержимое в скобках вместе со скобками
  cleaned = cleaned.replace(/\([^)]*\)/g, '');
  cleaned = cleaned.replace(/\[[^\]]*\]/g, '');
  cleaned = cleaned.replace(/\{[^}]*\}/g, '');

  // 3. Удаляет служебные фразы
  cleaned = cleaned.replace(/источник\s+писания\s+временно\s+недоступен/gi, '');
  cleaned = cleaned.replace(/временно\s+недоступен/gi, '');
  cleaned = cleaned.replace(/недоступен/gi, '');

  // 4. Исправляет ошибки
  cleaned = cleaned.replace(/тот-же/gi, 'тот же');
  cleaned = cleaned.replace(/не\s+доступин/gi, '');

  // 5. Фонетические замены для верного произношения
  cleaned = cleaned.replace(/\bГоспода\b/g, 'Госпада');
  cleaned = cleaned.replace(/\bгоспода\b/g, 'госпада');
  cleaned = cleaned.replace(/\bГосподу\b/g, 'Госпаду');
  cleaned = cleaned.replace(/\bгосподу\b/g, 'госпаду');
  cleaned = cleaned.replace(/\bГосподом\b/g, 'Госпадом');
  cleaned = cleaned.replace(/\bгосподом\b/g, 'госпадом');
  cleaned = cleaned.replace(/\bвовеки\b/gi, 'во веки');

  // 6. Убирает двойные пробелы и лишние символы
  cleaned = cleaned.replace(/\s+/g, ' ');
  cleaned = cleaned.trim();

  return cleaned;
}


