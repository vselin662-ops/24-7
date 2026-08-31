import fs from 'fs';
import path from 'path';
import { logger } from '../logger';

export type TTSEngineType = 'yandex' | 'edge' | 'gemini' | 'openai' | 'default';

let stressDict: Record<string, string> = {};
const DICT_PATH = path.join(process.cwd(), 'data', 'stress_dict.json');

/**
 * Загрузка словаря ударений из data/stress_dict.json
 */
export function loadStressDict(): Record<string, string> {
  try {
    if (fs.existsSync(DICT_PATH)) {
      const raw = fs.readFileSync(DICT_PATH, 'utf-8');
      stressDict = JSON.parse(raw);
    } else {
      stressDict = {};
    }
  } catch (err: any) {
    logger.warn(`⚠️ [StressService] Failed to load stress dictionary: ${err?.message || err}`);
    stressDict = {};
  }
  return stressDict;
}

// Первичная загрузка
loadStressDict();

/**
 * Получение текущего словаря
 */
export function getStressDict(): Record<string, string> {
  if (Object.keys(stressDict).length === 0) {
    return loadStressDict();
  }
  return stressDict;
}

/**
 * Добавление или обновление слова в словаре ударений (команда владельца)
 */
export function addStressWord(word: string, pattern: string): { success: boolean; word: string; pattern: string } {
  const cleanWord = word.trim().toLowerCase();
  const cleanPattern = pattern.trim();
  if (!cleanWord || !cleanPattern) {
    return { success: false, word: cleanWord, pattern: cleanPattern };
  }

  loadStressDict();
  stressDict[cleanWord] = cleanPattern;

  try {
    const dir = path.dirname(DICT_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DICT_PATH, JSON.stringify(stressDict, null, 2), 'utf-8');
    logger.info(`🎙️ [TTS] Stress word added/updated: "${cleanWord}" -> "${cleanPattern}"`);
    return { success: true, word: cleanWord, pattern: cleanPattern };
  } catch (err: any) {
    logger.error(`❌ [StressService] Failed to save stress dictionary: ${err?.message || err}`);
    return { success: false, word: cleanWord, pattern: cleanPattern };
  }
}

/**
 * Конвертация разметки вида '+а' или 'а+' в целевой формат движка:
 * - Yandex SpeechKit: '+' перед ударной гласной (например 'семь+я', 'тв+орог')
 * - Edge TTS / Microsoft: combining acute U+0301 ('́') ПОСЛЕ ударной гласной (например 'семья́', 'тво́рог')
 * - Gemini TTS / OpenAI: combining acute U+0301 ('́') или чистый текст
 */
export function formatStressForEngine(pattern: string, engine: TTSEngineType = 'edge'): string {
  if (!pattern) return '';

  const vowels = 'аеёиоуыэюяАЕЁИОУЫЭЮЯ';

  if (engine === 'yandex') {
    // В Yandex плюс ставится перед ударной гласной (или после, яндекс принимает оба, но документировано +гласная)
    return pattern;
  }

  if (engine === 'edge' || engine === 'gemini') {
    // Для Edge / Gemini заменяем +гласная или гласная+ на гласная + U+0301 (combining acute)
    let res = pattern;
    // Случай 1: '+а' -> 'а́'
    res = res.replace(/\+([аеёиоуыэюяАЕЁИОУЫЭЮЯ])/g, '$1\u0301');
    // Случай 2: 'а+' -> 'а́'
    res = res.replace(/([аеёиоуыэюяАЕЁИОУЫЭЮЯ])\+/g, '$1\u0301');
    return res;
  }

  // Для fallback / openai без спецсимволов, если там буква 'ё' — сохраняем ё
  return pattern.replace(/\+/g, '');
}

/**
 * Применение словаря ударений к тексту:
 * 1. Ищет слова по границам (word boundaries) без учёта регистра
 * 2. Сохраняет регистр первой буквы, если слово начиналось с заглавной
 * 3. Логирует '🎙 [TTS] stress-applied: <слово>'
 */
export function applyStressDict(text: string, engine: TTSEngineType = 'edge'): string {
  if (!text) return '';

  const dict = getStressDict();
  let result = text;

  for (const [rawKey, rawPattern] of Object.entries(dict)) {
    // Если ключ содержит пояснения в скобках, берем только само слово (например 'замок (строение)' -> 'замок')
    const wordKey = rawKey.replace(/\s*\([^)]*\)/g, '').trim().toLowerCase();
    if (!wordKey) continue;

    const enginePattern = formatStressForEngine(rawPattern, engine);
    if (!enginePattern) continue;

    // Регулярное выражение с границами русских слов
    const regex = new RegExp(`(?<![а-яА-ЯёЁa-zA-Z0-9])${wordKey}(?![а-яА-ЯёЁa-zA-Z0-9])`, 'gi');

    if (regex.test(result)) {
      result = result.replace(regex, (matched) => {
        logger.info(`🎙 [TTS] stress-applied: ${matched}`);
        // Сохраняем регистр первой буквы
        if (matched[0] && matched[0] === matched[0].toUpperCase() && matched[0] !== matched[0].toLowerCase()) {
          return enginePattern.charAt(0).toUpperCase() + enginePattern.slice(1);
        }
        return enginePattern;
      });
    }
  }

  return result;
}

/**
 * ШАГ 3: Интонация и форматирование предложений:
 * - Предложения > 15 слов разбиваются на 2 части по естественным паузам (запятая, союз, тире)
 * - Сохраняются запятые, тире (паузы) — НЕ склеиваются в сплошной текст
 * - Восклицательные знаки в приветствиях и восклицаниях обязательно сохраняются (эмоция)
 */
export function prepareIntonation(text: string): string {
  if (!text) return '';

  // Сначала разбиваем на базовые предложения, сохраняя знаки препинания (. ! ? … \n)
  const rawSentences = text.split(/(?<=[.!?…\n])\s+/);
  const processedSentences: string[] = [];

  for (const sent of rawSentences) {
    const trimmed = sent.trim();
    if (!trimmed) continue;

    // Считаем количество слов в предложении
    const words = trimmed.split(/\s+/).filter(Boolean);

    if (words.length > 15) {
      // Ищем место для разбиения на 2 части ближе к середине
      // Приоритет 1: запятая, точка с запятой, тире, двоеточие
      const commaSplit = splitAtPunctuation(trimmed);
      if (commaSplit) {
        processedSentences.push(...commaSplit);
        continue;
      }

      // Приоритет 2: союзы (и, но, а, чтобы, когда, который, если, потому что) ближе к середине
      const conjunctionSplit = splitAtConjunction(trimmed);
      if (conjunctionSplit) {
        processedSentences.push(...conjunctionSplit);
        continue;
      }

      // Приоритет 3: просто середина по словам
      const mid = Math.floor(words.length / 2);
      const part1 = words.slice(0, mid).join(' ') + ',';
      const part2 = words.slice(mid).join(' ');
      processedSentences.push(part1, part2);
    } else {
      processedSentences.push(trimmed);
    }
  }

  return processedSentences.join(' ');
}

function splitAtPunctuation(sent: string): string[] | null {
  const parts = sent.split(/(?<=[,;:\—\-])\s+/);
  if (parts.length < 2) return null;

  // Находим точку разбиения ближе к середине
  const totalWords = sent.split(/\s+/).length;
  let accumulatedWords = 0;
  let splitIndex = -1;

  for (let i = 0; i < parts.length - 1; i++) {
    accumulatedWords += parts[i].split(/\s+/).length;
    if (accumulatedWords >= totalWords * 0.35 && accumulatedWords <= totalWords * 0.75) {
      splitIndex = i;
      break;
    }
  }

  if (splitIndex !== -1) {
    const part1 = parts.slice(0, splitIndex + 1).join(' ').trim();
    let part2 = parts.slice(splitIndex + 1).join(' ').trim();
    // Делаем первую букву второго предложения заглавной, если предыдущее закончилось точкой или паузой
    if (part1.endsWith('.')) {
      part2 = part2.charAt(0).toUpperCase() + part2.slice(1);
    }
    return [part1, part2];
  }

  return null;
}

function splitAtConjunction(sent: string): string[] | null {
  const conjRegex = /\s+(и|а|но|чтобы|когда|если|хотя|потому что|так как|который|которая|которые)\s+/i;
  const match = conjRegex.exec(sent);
  if (!match || match.index < sent.length * 0.25 || match.index > sent.length * 0.75) {
    return null;
  }

  const part1 = sent.substring(0, match.index).trim() + '.';
  const part2 = match[1].charAt(0).toUpperCase() + match[1].slice(1) + ' ' + sent.substring(match.index + match[0].length).trim();
  return [part1, part2];
}

/**
 * Полный пайплайн препроцессинга TTS:
 * 1. Интонация (разбивка длинных >15 слов, сохранение запятых/тире/восклицаний)
 * 2. Применение ударного словаря с разметкой для выбранного движка
 */
export function preprocessTextForTTS(text: string, engine: TTSEngineType = 'edge'): string {
  if (!text) return '';
  const withIntonation = prepareIntonation(text);
  const withStress = applyStressDict(withIntonation, engine);
  return withStress;
}
