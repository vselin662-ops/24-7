/**
 * Voice Normalization Utilities for Selin AI (TTS-only)
 * 
 * Rules:
 * a) Biblical references (e.g. 'Иоанна 3:17' -> 'Иоанна, глава третья, стих семнадцатый', 'Псалом 1:13' -> 'Псалом первый, стих тринадцатый')
 * b) Years (1000-2999) in appropriate cases (e.g. '1892 год' -> 'тысяча восемьсот девяносто второго года', 'в 1812 году' -> 'в тысяча восемьсот двенадцатом году')
 * c) Time of day HH:MM (e.g. 'на часах 13:15' -> 'на часах тринадцать часов пятнадцать минут')
 * d) 12-hour format (e.g. '5 часов вечера' -> 'пять часов вечера')
 */

export type OrdinalGenderCase = 'female' | 'male' | 'male_gen' | 'male_prep';

const ORD_UNITS: Record<number, Record<OrdinalGenderCase, string>> = {
  1: { female: 'первая', male: 'первый', male_gen: 'первого', male_prep: 'первом' },
  2: { female: 'вторая', male: 'второй', male_gen: 'второго', male_prep: 'втором' },
  3: { female: 'третья', male: 'третий', male_gen: 'третьего', male_prep: 'третьем' },
  4: { female: 'четвёртая', male: 'четвёртый', male_gen: 'четвёртого', male_prep: 'четвёртом' },
  5: { female: 'пятая', male: 'пятый', male_gen: 'пятого', male_prep: 'пятом' },
  6: { female: 'шестая', male: 'шестой', male_gen: 'шестого', male_prep: 'шестом' },
  7: { female: 'седьмая', male: 'седьмой', male_gen: 'седьмого', male_prep: 'седьмом' },
  8: { female: 'восьмая', male: 'восьмой', male_gen: 'восьмого', male_prep: 'восьмом' },
  9: { female: 'девятая', male: 'девятый', male_gen: 'девятого', male_prep: 'девятом' },
  10: { female: 'десятая', male: 'десятый', male_gen: 'десятого', male_prep: 'десятом' },
  11: { female: 'одиннадцатая', male: 'одиннадцатый', male_gen: 'одиннадцатого', male_prep: 'одиннадцатом' },
  12: { female: 'двенадцатая', male: 'двенадцатый', male_gen: 'двенадцатого', male_prep: 'двенадцатом' },
  13: { female: 'тринадцатая', male: 'тринадцатый', male_gen: 'тринадцатого', male_prep: 'тринадцатом' },
  14: { female: 'четырнадцатая', male: 'четырнадцатый', male_gen: 'четырнадцатого', male_prep: 'четырнадцатом' },
  15: { female: 'пятнадцатая', male: 'пятнадцатый', male_gen: 'пятнадцатого', male_prep: 'пятнадцатом' },
  16: { female: 'шестнадцатая', male: 'шестнадцатый', male_gen: 'шестнадцатого', male_prep: 'шестнадцатом' },
  17: { female: 'семнадцатая', male: 'семнадцатый', male_gen: 'семнадцатого', male_prep: 'семнадцатом' },
  18: { female: 'восемнадцатая', male: 'восемнадцатый', male_gen: 'восемнадцатого', male_prep: 'восемнадцатом' },
  19: { female: 'девятнадцатая', male: 'девятнадцатый', male_gen: 'девятнадцатого', male_prep: 'девятнадцатом' },
};

const ORD_TENS: Record<number, Record<OrdinalGenderCase, string>> = {
  20: { female: 'двадцатая', male: 'двадцатый', male_gen: 'двадцатого', male_prep: 'двадцатом' },
  30: { female: 'тридцатая', male: 'тридцатый', male_gen: 'тридцатого', male_prep: 'тридцатом' },
  40: { female: 'сороковая', male: 'сороковой', male_gen: 'сорокового', male_prep: 'сороковом' },
  50: { female: 'пятидесятая', male: 'пятидесятый', male_gen: 'пятидесятого', male_prep: 'пятидесятом' },
  60: { female: 'шестидесятая', male: 'шестидесятый', male_gen: 'шестидесятого', male_prep: 'шестидесятом' },
  70: { female: 'семидесятая', male: 'семидесятый', male_gen: 'семидесятого', male_prep: 'семидесятом' },
  80: { female: 'восьмидесятая', male: 'восьмидесятый', male_gen: 'восьмидесятого', male_prep: 'восьмидесятом' },
  90: { female: 'девяностая', male: 'девяностый', male_gen: 'девяностого', male_prep: 'девяностом' },
};

const ORD_HUNDREDS: Record<number, Record<OrdinalGenderCase, string>> = {
  100: { female: 'сотая', male: 'сотый', male_gen: 'сотого', male_prep: 'сотом' },
  200: { female: 'двухсотая', male: 'двухсотый', male_gen: 'двухсотого', male_prep: 'двухсотом' },
  300: { female: 'трёхсотая', male: 'трёхсотый', male_gen: 'трёхсотого', male_prep: 'трёхсотом' },
  400: { female: 'четырёхсотая', male: 'четырёхсотый', male_gen: 'четырёхсотого', male_prep: 'четырёхсотом' },
  500: { female: 'пятисотая', male: 'пятисотый', male_gen: 'пятисотого', male_prep: 'пятисотом' },
  600: { female: 'шестисотая', male: 'шестисотый', male_gen: 'шестисотого', male_prep: 'шестисотом' },
  700: { female: 'семисотая', male: 'семисотый', male_gen: 'семисотого', male_prep: 'семисотом' },
  800: { female: 'восьмисотая', male: 'восьмисотый', male_gen: 'восьмисотого', male_prep: 'восьмисотом' },
  900: { female: 'девятисотая', male: 'девятисотый', male_gen: 'девятисотого', male_prep: 'девятисотом' },
};

const CARD_TENS: Record<number, string> = {
  20: 'двадцать',
  30: 'тридцать',
  40: 'сорок',
  50: 'пятьдесят',
  60: 'шестьдесят',
  70: 'семьдесят',
  80: 'восемьдесят',
  90: 'девяносто',
};

const CARD_HUNDREDS: Record<number, string> = {
  100: 'сто',
  200: 'двести',
  300: 'триста',
  400: 'четыреста',
  500: 'пятьсот',
  600: 'шестьсот',
  700: 'семьсот',
  800: 'восемьсот',
  900: 'девятьсот',
};

/**
 * Переводит число в порядковое числительное нужного рода и падежа
 * @param n Число от 1 до 2999
 * @param genderCase 'female' (первая), 'male' (первый), 'male_gen' (первого), 'male_prep' (первом)
 */
export function числительное(n: number, genderCase: OrdinalGenderCase = 'male'): string {
  if (n <= 0) return String(n);

  const parts: string[] = [];

  // Тысячи
  const thousands = Math.floor(n / 1000);
  let rem = n % 1000;

  if (thousands > 0) {
    if (rem === 0) {
      if (thousands === 1) {
        const ord1000: Record<OrdinalGenderCase, string> = {
          female: 'тысячная',
          male: 'тысячный',
          male_gen: 'тысячного',
          male_prep: 'тысячном',
        };
        return ord1000[genderCase];
      } else if (thousands === 2) {
        const ord2000: Record<OrdinalGenderCase, string> = {
          female: 'двухтысячная',
          male: 'двухтысячный',
          male_gen: 'двухтысячного',
          male_prep: 'двухтысячном',
        };
        return ord2000[genderCase];
      }
    } else {
      if (thousands === 1) parts.push('тысяча');
      else if (thousands === 2) parts.push('две тысячи');
    }
  }

  // Сотни
  const hundreds = Math.floor(rem / 100) * 100;
  rem = rem % 100;

  if (hundreds > 0) {
    if (rem === 0) {
      parts.push(ORD_HUNDREDS[hundreds]?.[genderCase] || String(hundreds));
      return parts.join(' ');
    } else {
      parts.push(CARD_HUNDREDS[hundreds] || String(hundreds));
    }
  }

  // Десятки и единицы
  if (rem > 0) {
    if (rem < 20) {
      parts.push(ORD_UNITS[rem]?.[genderCase] || String(rem));
    } else {
      const tens = Math.floor(rem / 10) * 10;
      const units = rem % 10;

      if (units === 0) {
        parts.push(ORD_TENS[tens]?.[genderCase] || String(tens));
      } else {
        parts.push(CARD_TENS[tens] || String(tens));
        parts.push(ORD_UNITS[units]?.[genderCase] || String(units));
      }
    }
  }

  return parts.join(' ');
}

// Кардинальные числительные для часов и минут
const CARD_UNITS_HOURS: Record<number, string> = {
  0: 'ноль',
  1: 'один',
  2: 'два',
  3: 'три',
  4: 'четыре',
  5: 'пять',
  6: 'шесть',
  7: 'семь',
  8: 'восемь',
  9: 'девять',
  10: 'десять',
  11: 'одиннадцать',
  12: 'двенадцать',
  13: 'тринадцать',
  14: 'четырнадцать',
  15: 'пятнадцать',
  16: 'шестнадцать',
  17: 'семнадцать',
  18: 'восемнадцать',
  19: 'девятнадцать',
  20: 'двадцать',
  21: 'двадцать один',
  22: 'двадцать два',
  23: 'двадцать три',
};

function formatHoursText(h: number): string {
  const word = CARD_UNITS_HOURS[h] || String(h);
  if (h === 1 || h === 21) {
    return `${word} час`;
  }
  if ((h >= 2 && h <= 4) || (h >= 22 && h <= 24)) {
    return `${word} часа`;
  }
  return `${word} часов`;
}

function formatMinutesText(m: number): string {
  if (m === 0) return '';
  let word = '';
  if (m < 20) {
    if (m === 1) word = 'одна';
    else if (m === 2) word = 'две';
    else word = CARD_UNITS_HOURS[m] || String(m);
  } else {
    const tens = Math.floor(m / 10) * 10;
    const units = m % 10;
    const tensWord = CARD_TENS[tens] || String(tens);
    if (units === 0) {
      word = tensWord;
    } else if (units === 1) {
      word = `${tensWord} одна`;
    } else if (units === 2) {
      word = `${tensWord} две`;
    } else {
      word = `${tensWord} ${CARD_UNITS_HOURS[units]}`;
    }
  }

  const lastDigit = m % 10;
  const isTeen = m >= 11 && m <= 19;
  let unitForm = 'минут';
  if (!isTeen) {
    if (lastDigit === 1) unitForm = 'минута';
    else if (lastDigit >= 2 && lastDigit <= 4) unitForm = 'минуты';
  }

  return `${word} ${unitForm}`;
}

// Список библейских книг
const BIBLE_BOOKS_PATTERN =
  '(?:(?:1[-е]?|2[-е]?|3[-е]?|1|2|3|Первое|Второе|Третье)\\s+)?(?:Иоанна|Иоанн|Матфея|Матфей|Марка|Марк|Луки|Лука|Псалом|Псалмы|Псалтирь|Притчи|Притчей|Бытие|Бытия|Исход|Исхода|Левит|Числа|Чисел|Второзаконие|Второзакония|Иисуса\\s+Навина|Иисус\\s+Навин|Судей|Руфь|Царств|Паралипоменон|Ездры|Неемии|Есфирь|Иова|Иов|Екклесиаст|Екклесиаста|Песнь\\s+Песней|Песни\\s+Песней|Исаии|Исаия|Иеремии|Иеремия|Плач\\s+Иеремии|Иезекииля|Иезекииль|Даниила|Даниил|Осии|Осия|Иоиля|Иоиль|Амоса|Амос|Авдия|Авдий|Ионы|Иона|Михея|Михей|Наума|Наум|Аввакума|Аввакум|Софонии|Софония|Аггея|Аггей|Захарии|Захария|Малахии|Малахия|Деяния|Деяний|Деяниях|Римлянам|Коринфянам|Галатам|Ефесянам|Филиппийцам|Колоссянам|Фессалоникийцам|Солунянам|Тимофею|Титу|Филимону|Евреям|Иакова|Петра|Иуды|Откровение|Откровения)';

/**
 * а) Библейские ссылки
 * 'Иоанна 3:17' → 'Иоанна, глава третья, стих семнадцатый'
 * 'Псалом 1:13' → 'Псалом первый, стих тринадцатый'
 * 'Матфея 5:3' → 'Матфея, глава пятая, стих третий'
 */
export function normalizeBiblicalReferences(text: string): string {
  if (!text) return text;

  // 1. Поиск: "Книга X:Y" или "Книга X : Y"
  const regex = new RegExp(`(?<![а-яА-ЯёЁ0-9a-zA-Z])(${BIBLE_BOOKS_PATTERN})\\s+(\\d{1,3})\\s*:\\s*(\\d{1,3})(?![0-9])`, 'gi');

  let result = text.replace(regex, (_match, book, chStr, vStr) => {
    const chapterNum = parseInt(chStr, 10);
    const verseNum = parseInt(vStr, 10);

    const isPsalm = /^псалом|^псалтирь/i.test(book.trim());
    if (isPsalm) {
      const psOrd = числительное(chapterNum, 'male');
      const vOrd = числительное(verseNum, 'male');
      return `${book} ${psOrd}, стих ${vOrd}`;
    }

    const chOrd = числительное(chapterNum, 'female');
    const vOrd = числительное(verseNum, 'male');
    return `${book}, глава ${chOrd}, стих ${vOrd}`;
  });

  // 2. Обработка конструкций типа "глава X, стих Y" или "глава X:Y" без указания книги
  result = result.replace(/(?<![а-яА-ЯёЁ0-9a-zA-Z])глав[аеы]\s+(\\d{1,3})\\s*:\\s*(\\d{1,3})(?![0-9])/gi, (_match, chStr, vStr) => {
    const chapterNum = parseInt(chStr, 10);
    const verseNum = parseInt(vStr, 10);
    const chOrd = числительное(chapterNum, 'female');
    const vOrd = числительное(verseNum, 'male');
    return `глава ${chOrd}, стих ${vOrd}`;
  });

  return result;
}

/**
 * б) Годы (1000-2999)
 * '1892 год' → 'тысяча восемьсот девяносто второго года'
 * '1945 год' → 'тысяча девятьсот сорок пятого года'
 * '2026 год' → 'две тысячи двадцать шестого года'
 * 'в 1812 году' → 'в тысяча восемьсот двенадцатом году'
 * '1917-го' → 'тысяча девятьсот семнадцатого'
 * '1917-м' → 'тысяча девятьсот семнадцатом'
 */
export function normalizeYears(text: string): string {
  if (!text) return text;

  let result = text;

  // 1. "в 1812 году" / "в 1812-м году"
  result = result.replace(/(?<![а-яА-ЯёЁ0-9a-zA-Z])в\s+([12]\d{3})\s*(?:-м|-ом|-ем)?\s*(?:году|годе)(?![а-яА-ЯёЁ0-9])/gi, (_match, yStr) => {
    const y = parseInt(yStr, 10);
    return `в ${числительное(y, 'male_prep')} году`;
  });

  // 2. "в 1812-м"
  result = result.replace(/(?<![а-яА-ЯёЁ0-9a-zA-Z])в\s+([12]\d{3})-(?:м|ом|ем)(?![а-яА-ЯёЁ0-9])/gi, (_match, yStr) => {
    const y = parseInt(yStr, 10);
    return `в ${числительное(y, 'male_prep')}`;
  });

  // 3. "1917-го" / "1917-ого"
  result = result.replace(/(?<![а-яА-ЯёЁ0-9a-zA-Z])([12]\d{3})-(?:го|ого)(?![а-яА-ЯёЁ0-9])/gi, (_match, yStr) => {
    const y = parseInt(yStr, 10);
    return числительное(y, 'male_gen');
  });

  // 4. "1917-й" / "1917-ый"
  result = result.replace(/(?<![а-яА-ЯёЁ0-9a-zA-Z])([12]\d{3})-(?:й|ый|ий)(?![а-яА-ЯёЁ0-9])/gi, (_match, yStr) => {
    const y = parseInt(yStr, 10);
    return числительное(y, 'male');
  });

  // 5. "1917-м" / "1917-ом"
  result = result.replace(/(?<![а-яА-ЯёЁ0-9a-zA-Z])([12]\d{3})-(?:м|ом|ем)(?![а-яА-ЯёЁ0-9])/gi, (_match, yStr) => {
    const y = parseInt(yStr, 10);
    return числительное(y, 'male_prep');
  });

  // 6. "1892 год" / "1945 год" / "2026 год" / "1892 года" / "1892 г." / "1892 г"
  result = result.replace(/(?<![а-яА-ЯёЁ0-9a-zA-Z])([12]\d{3})\s*(?:год|года|г\.|г)(?![а-яА-ЯёЁ0-9])/gi, (_match, yStr) => {
    const y = parseInt(yStr, 10);
    return `${числительное(y, 'male_gen')} года`;
  });

  return result;
}

/**
 * в) Время суток (паттерн «HH:MM» в контексте времени)
 * «на часах 13:15» и «13:15» в контексте времени → «тринадцать часов пятнадцать минут»
 * Маркеры: 'час', 'время', 'сейчас', 'на часах', 'в', 'к', 'с', 'до', 'ровно', 'около'
 * Не трогать если двоеточие после 'глава'/'стих'/книги
 */
export function normalizeTimeOfDay(text: string): string {
  if (!text) return text;

  // Проверяем паттерн HH:MM (0-23 : 00-59) с возможным маркером
  const timeRegex = /(?<![а-яА-ЯёЁ0-9a-zA-Z])(?:\b(на\s+часах|время|сейчас|в|к|с|до|около|ровно|час(?:а|ов)?)\s+)?([01]?\d|2[0-3])\s*:\s*([0-5]\d)(?![0-9])/gi;

  return text.replace(timeRegex, (match, marker, hStr, mStr, offset, fullStr) => {
    // Проверка: не идёт ли перед этим слово "глава", "стих", "псалом" или библейская книга
    const prefix = fullStr.slice(Math.max(0, offset - 40), offset).toLowerCase();
    if (/(?:глав[аеы]|стих[ае]?|псалом|псалтирь|притч[ией]|быти[ея]|исход[а]?)\s*$/i.test(prefix)) {
      return match;
    }

    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);

    const hText = formatHoursText(h);
    const mText = formatMinutesText(m);
    const timeFormatted = mText ? `${hText} ${mText}` : hText;

    if (marker) {
      return `${marker} ${timeFormatted}`;
    }

    return timeFormatted;
  });
}

/**
 * г) Часы в 12-часовом формате
 * '5 часов вечера' → 'пять часов вечера'
 * '1 час ночи' → 'один час ночи'
 * '2 часа дня' → 'два часа дня'
 */
export function normalizeHours12(text: string): string {
  if (!text) return text;

  const hours12Words: Record<number, string> = {
    1: 'один',
    2: 'два',
    3: 'три',
    4: 'четыре',
    5: 'пять',
    6: 'шесть',
    7: 'семь',
    8: 'восемь',
    9: 'девять',
    10: 'десять',
    11: 'одиннадцать',
    12: 'двенадцать',
  };

  return text.replace(/(?<![а-яА-ЯёЁ0-9a-zA-Z])([1-9]|1[0-2])\s+(час(?:а|ов)?\s+(?:утра|дня|вечера|ночи))(?![а-яА-ЯёЁ0-9])/gi, (_match, digitStr, tail) => {
    const digit = parseInt(digitStr, 10);
    const word = hours12Words[digit] || digitStr;
    return `${word} ${tail}`;
  });
}

/**
 * Главная функция нормализации для голосового синтеза
 * Текст в чат отправляется БЕЗ этих замен.
 * Пайплайн TTS: cleanForMax -> prepareVoiceText -> normalizeForVoice -> edge-tts
 */
export function normalizeForVoice(text: string, prepareFn?: (t: string) => string): string {
  if (!text) return '';
  const initialText = text;

  // 1. Вызываем prepareVoiceText в начале (если передана функция или базовая логика)
  let res = prepareFn ? prepareFn(text) : text;
  if (!res) return '';

  // 2. Последовательно применяем правила нормализации:
  // а) Библейские ссылки (ПЕРВЫМИ, чтобы книги X:Y не путались со временем)
  res = normalizeBiblicalReferences(res);
  // б) Годы
  res = normalizeYears(res);
  // в) Время суток
  res = normalizeTimeOfDay(res);
  // г) 12-часовой формат
  res = normalizeHours12(res);

  console.log('🎙️ [TTS] нормализация: ' + JSON.stringify({ in: initialText, out: res }));
  return res;
}
