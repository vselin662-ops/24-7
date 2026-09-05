import { logger } from "../logger";
import { normalizeForVoice as normalizeVoiceUtil, normalizeForSpeech as normalizeSpeechUtil } from "./voiceNormalizer";
import { preprocessTextForTTS, applyStressDict, prepareIntonation, TTSEngineType } from "../services/StressService";

/**
 * Словарь ударений (STRESS_DICT) для правильного произношения TTS.
 * Символ ударения: комбинируемый акут (combining acute) U+0301.
 */
export const STRESS_DICT: Record<string, string> = {
  // Формы слова "понять"
  "понял": "по\u0301нял",
  "поняла": "по\u0301няла",
  "поняли": "по\u0301няли",
  "поняло": "по\u0301няло",

  // Формы слова "начать"
  "начал": "на\u0301чал",
  "начала": "начала\u0301",
  "начали": "на\u0301чали",

  // Частые глаголы и частые жертвы TTS
  "занял": "за\u0301нял",
  "позвонит": "позвони\u0301т",
  "включит": "включи\u0301т",
  "отключит": "отключи\u0301т",

  // Дополнительные формы
  "звонит": "звони\u0301т",
  "перезвонит": "перезвони\u0301т",
  "включат": "включа\u0301т",
  "отключат": "отключа\u0301т",
  "селин": "Сели\u0301н",
  "помощник": "помо\u0301щник",
  "голосом": "го\u0301лосом",
  "дешевле": "деше\u0301вле",
  "кофе": "ко\u0301фе"
};

/**
 * Регистронезависимое применение словаря ударений STRESS_DICT с сохранением регистра слова
 */
export function applyStress(text: string): string {
  if (!text) return '';
  let result = text;

  for (const [key, stressedVal] of Object.entries(STRESS_DICT)) {
    const wordKey = key.trim().toLowerCase();
    if (!wordKey) continue;

    // Регулярное выражение с границами русских слов
    const regex = new RegExp(`(?<![а-яА-ЯёЁa-zA-Z0-9])${wordKey}(?![а-яА-ЯёЁa-zA-Z0-9])`, 'gi');

    if (regex.test(result)) {
      result = result.replace(regex, (matched) => {
        let replacement: string;
        if (matched === matched.toUpperCase() && matched !== matched.toLowerCase()) {
          replacement = stressedVal.toUpperCase();
        } else if (matched[0] === matched[0].toUpperCase() && matched[0] !== matched[0].toLowerCase()) {
          replacement = stressedVal.charAt(0).toUpperCase() + stressedVal.slice(1);
        } else {
          replacement = stressedVal.toLowerCase();
        }
        logger.info(`🎙️ [TTS] stress-applied: "${matched}" -> "${replacement}"`);
        return replacement;
      });
    }
  }

  return result;
}

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


// Словарь числительных в падежах (формат: именительный/родительный/дательный/творительный/предложный)
const NUMERALS_DICT: Record<string, string> = {
  "1": "один/одного/одному/одним/одном",
  "2": "два/двух/двум/двумя/двух",
  "3": "три/трёх/трём/тремя/трёх",
  "4": "четыре/четырёх/четырём/четырьмя/четырёх",
  "5": "пять/пяти/пяти/пятью/пяти",
  "6": "шесть/шести/шести/шестью/шести",
  "7": "семь/семи/семи/семью/семи",
  "8": "восемь/восьми/восьми/восьмью/восьми",
  "9": "девять/девяти/девяти/девятью/девяти",
  "10": "десять/десяти/десяти/десятью/десяти",
  "11": "одиннадцать/одиннадцати/одиннадцати/одиннадцатью/одиннадцати",
  "12": "двенадцать/двенадцати/двенадцати/двенадцатью/двенадцати",
  "13": "тринадцать/тринадцати/тринадцати/тринадцатью/тринадцати",
  "14": "четырнадцать/четырнадцати/четырнадцати/четырнадцатью/четырнадцати",
  "15": "пятнадцать/пятнадцати/пятнадцати/пятнадцатью/пятнадцати",
  "16": "шестнадцать/шестнадцати/шестнадцати/шестнадцатью/шестнадцати",
  "17": "семнадцать/семнадцати/семнадцати/семнадцатью/семнадцати",
  "18": "восемнадцать/восемнадцати/восемнадцати/восемнадцатью/восемнадцати",
  "19": "девятнадцать/девятнадцати/девятнадцати/девятнадцатью/девятнадцати",
  "20": "двадцать/двадцати/двадцати/двадцатью/двадцати",
  "21": "двадцать один/двадцати одного/двадцати одному/двадцатью одним/двадцати одном",
  "22": "двадцать два/двадцати двух/двадцати двум/двадцатью двумя/двадцати двух",
  "23": "двадцать три/двадцати трёх/двадцати трём/двадцатью тремя/двадцати трёх",
  "24": "двадцать четыре/двадцати четырёх/двадцати четырём/двадцатью четырьмя/двадцати четырёх",
  "25": "двадцать пять/двадцати пяти/двадцати пяти/двадцатью пятью/двадцати пяти",
  "26": "двадцать шесть/двадцати шести/двадцати шести/двадцатью шестью/двадцати шести",
  "27": "двадцать семь/двадцати семи/двадцати семи/двадцатью семью/двадцати семи",
  "28": "двадцать восемь/двадцати восьми/двадцати восьми/двадцатью восьмью/двадцати восьми",
  "29": "двадцать девять/двадцати девяти/двадцати девяти/двадцатью девятью/двадцати девяти",
  "30": "тридцать/тридцати/тридцати/тридцатью/тридцати",
  "40": "сорок/сорока/сорока/сорока/сорока",
  "50": "пятьдесят/пятидесяти/пятидесяти/пятьюдесятью/пятидесяти",
  "60": "шестьдесят/шестидесяти/шестидесяти/шестьюдесятью/шестидесяти",
  "70": "семьдесят/семидесяти/семидесяти/семьюдесятью/семидесяти",
  "80": "восемьдесят/восьмидесяти/восьмидесяти/восьмьюдесятью/восьмидесяти",
  "90": "девяносто/девяноста/девяноста/девяноста/девяноста",
  "100": "сто/ста/ста/ста/ста"
};

const WORD_TO_DIGIT: Record<string, string> = {
  "один": "1", "одна": "1", "одно": "1",
  "два": "2", "две": "2",
  "три": "3",
  "четыре": "4",
  "пять": "5",
  "шесть": "6",
  "семь": "7",
  "восемь": "8",
  "девять": "9",
  "десять": "10",
  "одиннадцать": "11",
  "двенадцать": "12",
  "тринадцать": "13",
  "четырнадцать": "14",
  "пятнадцать": "15",
  "шестнадцать": "16",
  "семнадцать": "17",
  "восемнадцать": "18",
  "девятнадцать": "19",
  "двадцать": "20",
  "тридцать": "30",
  "сорок": "40",
  "пятьдесят": "50",
  "шестьдесят": "60",
  "семьдесят": "70",
  "восемьдесят": "80",
  "девяносто": "90",
  "сто": "100"
};

type RussianCase = 'nom' | 'gen' | 'dat' | 'ins' | 'pre' | 'acc';

export function getDeclinedNumber(numStr: string, rCase: RussianCase): string {
  const s = numStr.trim();
  
  if (NUMERALS_DICT[s]) {
    const parts = NUMERALS_DICT[s].split('/');
    switch (rCase) {
      case 'nom': return parts[0];
      case 'gen': return parts[1];
      case 'dat': return parts[2];
      case 'ins': return parts[3];
      case 'pre': return parts[4];
      case 'acc':
        return parts[0];
    }
  }

  const val = parseInt(s, 10);
  if (!isNaN(val) && val > 20 && val < 100) {
    const tens = Math.floor(val / 10) * 10;
    const units = val % 10;
    if (units === 0) {
      return getDeclinedNumber(String(tens), rCase);
    } else {
      const tensDeclined = getDeclinedNumber(String(tens), rCase);
      const unitsDeclined = getDeclinedNumber(String(units), rCase);
      return `${tensDeclined} ${unitsDeclined}`;
    }
  }

  return s;
}

function parseNumber(str: string): string | null {
  const s = str.toLowerCase().trim();
  if (/^\d+$/.test(s)) return s;
  if (WORD_TO_DIGIT[s]) return WORD_TO_DIGIT[s];
  return null;
}

export function normalizeNumeralsAndPrepositions(text: string): string {
  if (!text) return "";
  let res = text;

  // 1. Нормализация диапазонов числительных: "1-2" -> "от 1 до 2"
  res = res.replace(/(?<![а-яА-ЯёЁ\d])(\d+)\s*-\s*(\d+)(?![а-яА-ЯёЁ\d])/g, 'от $1 до $2');

  // 2. Правила предлогов (regex):
  // а) "от X до Y [лет/месяцев/дней]" (и вообще "от X до Y") -> родительный падеж (gen)
  res = res.replace(/(?<![а-яА-ЯёЁ\d])от\s+([а-яА-ЯёЁ\d]+)\s+до\s+([а-яА-ЯёЁ\d]+)(?![а-яА-ЯёЁ\d])/gi, (match, xStr, yStr) => {
    const xNum = parseNumber(xStr);
    const yNum = parseNumber(yStr);
    if (xNum && yNum) {
      const xDecl = getDeclinedNumber(xNum, 'gen');
      const yDecl = getDeclinedNumber(yNum, 'gen');
      const isTitleCase = match.startsWith('От');
      return `${isTitleCase ? 'От' : 'от'} ${xDecl} до ${yDecl}`;
    }
    return match;
  });

  // б) "между X и Y" -> творительный падеж (ins)
  res = res.replace(/(?<![а-яА-ЯёЁ\d])между\s+([а-яА-ЯёЁ\d]+)\s+и\s+([а-яА-ЯёЁ\d]+)(?![а-яА-ЯёЁ\d])/gi, (match, xStr, yStr) => {
    const xNum = parseNumber(xStr);
    const yNum = parseNumber(yStr);
    if (xNum && yNum) {
      const xDecl = getDeclinedNumber(xNum, 'ins');
      const yDecl = getDeclinedNumber(yNum, 'ins');
      const isTitleCase = match.startsWith('Между');
      return `${isTitleCase ? 'Между' : 'между'} ${xDecl} и ${yDecl}`;
    }
    return match;
  });

  // в) "с X по Y" -> X родительный, Y винительный (acc)
  res = res.replace(/(?<![а-яА-ЯёЁ\d])с\s+([а-яА-ЯёЁ\d]+)\s+по\s+([а-яА-ЯёЁ\d]+)(?![а-яА-ЯёЁ\d])/gi, (match, xStr, yStr) => {
    const xNum = parseNumber(xStr);
    const yNum = parseNumber(yStr);
    if (xNum && yNum) {
      const xDecl = getDeclinedNumber(xNum, 'gen');
      const yDecl = getDeclinedNumber(yNum, 'acc');
      const isTitleCase = match.startsWith('С');
      return `${isTitleCase ? 'С' : 'с'} ${xDecl} по ${yDecl}`;
    }
    return match;
  });

  // 3. Контекст: после числительного смотрим следующее слово (лет/месяцев/дней) для выбора падежа:
  // - "лет/месяцев/дней" -> родительный
  // - "год/месяц/день" -> винительный
  const PLURAL_STEMS = /^(лет|месяцев|дней|часов)/i;
  const SINGULAR_STEMS = /^(год|месяц|день|дн|час)/i;

  res = res.replace(/(?<![а-яА-ЯёЁ\d])(\d+)\s+([а-яА-ЯёЁ]+)(?![а-яА-ЯёЁ\d])/gi, (match, numStr, noun) => {
    if (PLURAL_STEMS.test(noun)) {
      const declined = getDeclinedNumber(numStr, 'gen');
      return `${declined} ${noun}`;
    }
    if (SINGULAR_STEMS.test(noun)) {
      const declined = getDeclinedNumber(numStr, 'acc');
      return `${declined} ${noun}`;
    }
    return match;
  });

  return res;
}


/**
 * Очистка и фонетическая оптимизация текста перед озвучкой в TTS
 */
export function sanitizeForTTS(text: string): string {
  if (!text) return "";

  // Нормализуем числительные и предлоги в самом начале
  let cleaned = normalizeNumeralsAndPrepositions(text);

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

  // 6. Ударения из STRESS_DICT (U+0301)
  cleaned = applyStress(cleaned);

  // 7. Убирает двойные пробелы и лишние символы
  cleaned = cleaned.replace(/\s+/g, ' ');
  cleaned = cleaned.trim();

  return cleaned;
}


