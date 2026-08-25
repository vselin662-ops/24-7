/**
 * Voice Normalization Utilities for Selin AI (TTS-only)
 * 
 * Strict pipeline:
 * cleanForMax -> prepareVoiceText -> normalizeForVoice (entire text) -> chunking for TTS
 * 
 * Rules (strictly in order, all with /g flag):
 * a) Biblical references (all 66 books + abbreviations + verse ranges)
 * b) Dates (e.g. '1 сентября 2026', '25 декабря')
 * c) Years 800-2099 (e.g. 'в 862 году', 'в 1892 году', '1945 год', '2026 год')
 * d) Centuries Roman IV-XXI (e.g. 'XIX век', 'XXI век', 'в XIX веке')
 * e) Time HH:MM (e.g. '13:15', '13:00')
 * f) Money (e.g. '200 руб', '1800₽')
 * g) Percentages (e.g. '50%')
 * h) Phone numbers (e.g. '+7 999 123-45-67')
 * i) Numbers 1-999 before nouns (e.g. '5 стихов', '7 часов')
 */

export type Gender = 'male' | 'female' | 'neuter';

const CARDINAL_UNITS: Record<number, Record<Gender, string>> = {
  0: { male: 'ноль', female: 'ноль', neuter: 'ноль' },
  1: { male: 'один', female: 'одна', neuter: 'одно' },
  2: { male: 'два', female: 'две', neuter: 'два' },
  3: { male: 'три', female: 'три', neuter: 'три' },
  4: { male: 'четыре', female: 'четыре', neuter: 'четыре' },
  5: { male: 'пять', female: 'пять', neuter: 'пять' },
  6: { male: 'шесть', female: 'шесть', neuter: 'шесть' },
  7: { male: 'семь', female: 'семь', neuter: 'семь' },
  8: { male: 'восемь', female: 'восемь', neuter: 'восемь' },
  9: { male: 'девять', female: 'девять', neuter: 'девять' },
  10: { male: 'десять', female: 'десять', neuter: 'десять' },
  11: { male: 'одиннадцать', female: 'одиннадцать', neuter: 'одиннадцать' },
  12: { male: 'двенадцать', female: 'двенадцать', neuter: 'двенадцать' },
  13: { male: 'тринадцать', female: 'тринадцать', neuter: 'тринадцать' },
  14: { male: 'четырнадцать', female: 'четырнадцать', neuter: 'четырнадцать' },
  15: { male: 'пятнадцать', female: 'пятнадцать', neuter: 'пятнадцать' },
  16: { male: 'шестнадцать', female: 'шестнадцать', neuter: 'шестнадцать' },
  17: { male: 'семнадцать', female: 'семнадцать', neuter: 'семнадцать' },
  18: { male: 'восемнадцать', female: 'восемнадцать', neuter: 'восемнадцать' },
  19: { male: 'девятнадцать', female: 'девятнадцать', neuter: 'девятнадцать' },
  20: { male: 'двадцать', female: 'двадцать', neuter: 'двадцать' },
};

const CARDINAL_TENS: Record<number, string> = {
  20: 'двадцать',
  30: 'тридцать',
  40: 'сорок',
  50: 'пятьдесят',
  60: 'шестьдесят',
  70: 'семьдесят',
  80: 'восемьдесят',
  90: 'девяносто',
};

const CARDINAL_HUNDREDS: Record<number, string> = {
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
 * 1. Количественные числительные 0-999999 словами
 * numberToWords(200) -> 'двести'
 * numberToWords(1800) -> 'тысяча восемьсот'
 * numberToWords(5) -> 'пять'
 */
export function numberToWords(n: number, gender: Gender = 'male'): string {
  if (n === 0) return 'ноль';
  if (n < 0) return 'минус ' + numberToWords(-n, gender);

  const parts: string[] = [];

  // Тысячи (1 - 999 тыс)
  const thousands = Math.floor(n / 1000);
  let rem = n % 1000;

  if (thousands > 0) {
    const thRem100 = thousands % 100;
    const thRem10 = thousands % 10;

    let thWord = 'тысяч';
    if (thRem100 < 10 || thRem100 >= 20) {
      if (thRem10 === 1) thWord = 'тысяча';
      else if (thRem10 >= 2 && thRem10 <= 4) thWord = 'тысячи';
    }

    if (thousands === 1) {
      parts.push('тысяча');
    } else {
      // Для тысяч единицы склоняются по женскому роду: 'одна тысяча', 'две тысячи'
      const thNumStr = numberToWordsUnder1000(thousands, 'female');
      parts.push(`${thNumStr} ${thWord}`);
    }
  }

  // Сотни, десятки, единицы (0 - 999)
  if (rem > 0) {
    parts.push(numberToWordsUnder1000(rem, gender));
  }

  return parts.join(' ');
}

function numberToWordsUnder1000(rem: number, gender: Gender): string {
  const parts: string[] = [];
  const hundreds = Math.floor(rem / 100) * 100;
  const rem100 = rem % 100;

  if (hundreds > 0) {
    parts.push(CARDINAL_HUNDREDS[hundreds] || String(hundreds));
  }

  if (rem100 > 0) {
    if (rem100 <= 20) {
      parts.push(CARDINAL_UNITS[rem100]?.[gender] || String(rem100));
    } else {
      const tens = Math.floor(rem100 / 10) * 10;
      const units = rem100 % 10;
      parts.push(CARDINAL_TENS[tens] || String(tens));
      if (units > 0) {
        parts.push(CARDINAL_UNITS[units]?.[gender] || String(units));
      }
    }
  }

  return parts.join(' ');
}

// Алиас для обратной совместимости
export const cardinal = numberToWords;

// ----------------------------------------------------
// ПОРЯДКОВЫЕ ЧИСЛИТЕЛЬНЫЕ
// ----------------------------------------------------

export type OrdinalGenderCase = 'male' | 'female' | 'male_gen' | 'male_prep';

const ORD_UNITS: Record<number, Record<OrdinalGenderCase, string>> = {
  1: { male: 'первый', female: 'первая', male_gen: 'первого', male_prep: 'первом' },
  2: { male: 'второй', female: 'вторая', male_gen: 'второго', male_prep: 'втором' },
  3: { male: 'третий', female: 'третья', male_gen: 'третьего', male_prep: 'третьем' },
  4: { male: 'четвёртый', female: 'четвёртая', male_gen: 'четвёртого', male_prep: 'четвёртом' },
  5: { male: 'пятый', female: 'пятая', male_gen: 'пятого', male_prep: 'пятом' },
  6: { male: 'шестой', female: 'шестая', male_gen: 'шестого', male_prep: 'шестом' },
  7: { male: 'седьмой', female: 'седьмая', male_gen: 'седьмого', male_prep: 'седьмом' },
  8: { male: 'восьмой', female: 'восьмая', male_gen: 'восьмого', male_prep: 'восьмом' },
  9: { male: 'девятый', female: 'девятая', male_gen: 'девятого', male_prep: 'девятом' },
  10: { male: 'десятый', female: 'десятая', male_gen: 'десятого', male_prep: 'десятом' },
  11: { male: 'одиннадцатый', female: 'одиннадцатая', male_gen: 'одиннадцатого', male_prep: 'одиннадцатом' },
  12: { male: 'двенадцатый', female: 'двенадцатая', male_gen: 'двенадцатого', male_prep: 'двенадцатом' },
  13: { male: 'тринадцатый', female: 'тринадцатая', male_gen: 'тринадцатого', male_prep: 'тринадцатом' },
  14: { male: 'четырнадцатый', female: 'четырнадцатая', male_gen: 'четырнадцатого', male_prep: 'четырнадцатом' },
  15: { male: 'пятнадцатый', female: 'пятнадцатая', male_gen: 'пятнадцатого', male_prep: 'пятнадцатом' },
  16: { male: 'шестнадцатый', female: 'шестнадцатая', male_gen: 'шестнадцатого', male_prep: 'шестнадцатом' },
  17: { male: 'семнадцатый', female: 'семнадцатая', male_gen: 'семнадцатого', male_prep: 'семнадцатом' },
  18: { male: 'восемнадцатый', female: 'восемнадцатая', male_gen: 'восемнадцатого', male_prep: 'восемнадцатом' },
  19: { male: 'девятнадцатый', female: 'девятнадцатая', male_gen: 'девятнадцатого', male_prep: 'девятнадцатом' },
  20: { male: 'двадцатый', female: 'двадцатая', male_gen: 'двадцатого', male_prep: 'двадцатом' },
};

const ORD_TENS: Record<number, Record<OrdinalGenderCase, string>> = {
  20: { male: 'двадцатый', female: 'двадцатая', male_gen: 'двадцатого', male_prep: 'двадцатом' },
  30: { male: 'тридцатый', female: 'тридцатая', male_gen: 'тридцатого', male_prep: 'тридцатом' },
  40: { male: 'сороковой', female: 'сороковая', male_gen: 'сорокового', male_prep: 'сороковом' },
  50: { male: 'пятидесятый', female: 'пятидесятая', male_gen: 'пятидесятого', male_prep: 'пятидесятом' },
  60: { male: 'шестидесятый', female: 'шестидесятая', male_gen: 'шестидесятого', male_prep: 'шестидесятом' },
  70: { male: 'семидесятый', female: 'семидесятая', male_gen: 'семидесятого', male_prep: 'семидесятом' },
  80: { male: 'восьмидесятый', female: 'восьмидесятая', male_gen: 'восьмидесятого', male_prep: 'восьмидесятом' },
  90: { male: 'девяностый', female: 'девяностая', male_gen: 'девяностого', male_prep: 'девяностом' },
};

const ORD_HUNDREDS: Record<number, Record<OrdinalGenderCase, string>> = {
  100: { male: 'сотый', female: 'сотая', male_gen: 'сотого', male_prep: 'сотом' },
  200: { male: 'двухсотый', female: 'двухсотая', male_gen: 'двухсотого', male_prep: 'двухсотом' },
  300: { male: 'трёхсотый', female: 'трёхсотая', male_gen: 'трёхсотого', male_prep: 'трёхсотом' },
  400: { male: 'четырёхсотый', female: 'четырёхсотая', male_gen: 'четырёхсотого', male_prep: 'четырёхсотом' },
  500: { male: 'пятисотый', female: 'пятисотая', male_gen: 'пятисотого', male_prep: 'пятисотом' },
  600: { male: 'шестисотый', female: 'шестисотая', male_gen: 'шестисотого', male_prep: 'шестисотом' },
  700: { male: 'семисотый', female: 'семисотая', male_gen: 'семисотого', male_prep: 'семисотом' },
  800: { male: 'восьмисотый', female: 'восьмисотая', male_gen: 'восьмисотого', male_prep: 'восьмисотом' },
  900: { male: 'девятисотый', female: 'девятисотая', male_gen: 'девятисотого', male_prep: 'девятисотом' },
};

/**
 * Базовая функция порядкового числительного
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
          male: 'тысячный',
          female: 'тысячная',
          male_gen: 'тысячного',
          male_prep: 'тысячном',
        };
        return ord1000[genderCase];
      } else if (thousands === 2) {
        const ord2000: Record<OrdinalGenderCase, string> = {
          male: 'двухтысячный',
          female: 'двухтысячная',
          male_gen: 'двухтысячного',
          male_prep: 'двухтысячном',
        };
        return ord2000[genderCase];
      }
    } else {
      if (thousands === 1) parts.push('тысяча');
      else if (thousands === 2) parts.push('две тысячи');
      else parts.push(`${numberToWords(thousands, 'female')} тысяч`);
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
      parts.push(CARDINAL_HUNDREDS[hundreds] || String(hundreds));
    }
  }

  // Десятки и единицы
  if (rem > 0) {
    if (rem <= 20) {
      parts.push(ORD_UNITS[rem]?.[genderCase] || String(rem));
    } else {
      const tens = Math.floor(rem / 10) * 10;
      const units = rem % 10;

      if (units === 0) {
        parts.push(ORD_TENS[tens]?.[genderCase] || String(tens));
      } else {
        parts.push(CARDINAL_TENS[tens] || String(tens));
        parts.push(ORD_UNITS[units]?.[genderCase] || String(units));
      }
    }
  }

  return parts.join(' ');
}

/**
 * Порядковое числительное мужского рода: первый, третий, семнадцатый
 */
export function ordinalM(n: number): string {
  return числительное(n, 'male');
}

/**
 * Порядковое числительное женского рода: первая, третья, семнадцатая
 */
export function ordinalF(n: number): string {
  return числительное(n, 'female');
}

/**
 * Порядковое числительное мужского рода в родительном падеже для годов и дат: первого, девяносто второго, две тысячи двадцать шестого
 */
export function ordinalGenM(n: number): string {
  return числительное(n, 'male_gen');
}

/**
 * Порядковое числительное мужского рода в предложном падеже для годов: первом, девяносто втором, две тысячи двадцать шестом
 */
export function ordinalPrepM(n: number): string {
  return числительное(n, 'male_prep');
}

/**
 * Преобразование года (800-2099) в звучание для речи
 * yearToSpeech(862) -> 'восемьсот шестьдесят второго'
 * yearToSpeech(1892) -> 'тысяча восемьсот девяносто второго'
 * yearToSpeech(2026) -> 'две тысячи двадцать шестого'
 * yearToSpeech(1892, true) -> 'тысяча восемьсот девяносто втором'
 */
export function yearToSpeech(year: number | string, isPrepositional: boolean = false): string {
  const y = typeof year === 'string' ? parseInt(year, 10) : year;
  if (isNaN(y)) return String(year);
  return isPrepositional ? ordinalPrepM(y) : ordinalGenM(y);
}

// ----------------------------------------------------
// ПРАВИЛА ЗАМЕНЫ (ВСЕ С ФЛАГОМ g, СТРОГИЙ ПОРЯДОК)
// ----------------------------------------------------

/**
 * а) Библейские ссылки:
 * ПОЛНЫЙ словарь русских названий и сокращений всех 66 книг Библии
 * (книга)\s+(\d{1,3})[:.](\d{1,3})(-\d{1,3})?
 */
const BIBLE_BOOKS_PATTERN = [
  // Ветхий Завет
  'Бытие', 'Быт', 'Бытия',
  'Исход', 'Исх', 'Исхода',
  'Левит', 'Лев', 'Левита',
  'Числа', 'Чис', 'Числ', 'Чисел',
  'Второзаконие', 'Втор', 'Второзакония',
  'Иисус Навин', 'Иисуса Навина', 'Навин', 'Нав',
  'Судьи', 'Судей', 'Суд',
  'Руфь', 'Руфи', 'Руф',
  '1\\s*Царств', '1-я\\s*Царств', '1Цар', '1\\s*Цар',
  '2\\s*Царств', '2-я\\s*Царств', '2Цар', '2\\s*Цар',
  '3\\s*Царств', '3-я\\s*Царств', '3Цар', '3\\s*Цар',
  '4\\s*Царств', '4-я\\s*Царств', '4Цар', '4\\s*Цар',
  '1\\s*Паралипоменон', '1-я\\s*Паралипоменон', '1Пар', '1\\s*Пар',
  '2\\s*Паралипоменон', '2-я\\s*Паралипоменон', '2Пар', '2\\s*Пар',
  'Ездра', 'Ездры', 'Езд',
  'Неемия', 'Неемии', 'Неем',
  'Есфирь', 'Есфири', 'Есф',
  'Иов', 'Иова',
  'Псалтирь', 'Псалом', 'Псалмы', 'Пс',
  'Притчи', 'Притчей', 'Притча', 'Притч', 'Прит',
  'Екклесиаст', 'Екклесиаста', 'Экклезиаст', 'Еккл', 'Екк',
  'Песнь\\s+Песней', 'Песни\\s+Песней', 'Песн', 'Песнь',
  'Исаия', 'Исаии', 'Исайи', 'Ис',
  'Иеремия', 'Иеремии', 'Иер',
  'Плач\\s+Иеремии', 'Плач',
  'Иезекииль', 'Иезекииля', 'Иез',
  'Даниил', 'Даниила', 'Дан',
  'Осия', 'Осии', 'Ос',
  'Иоиль', 'Иоиля', 'Иоил',
  'Амос', 'Амоса', 'Ам',
  'Авдий', 'Авдия', 'Авд',
  'Иона', 'Ионы', 'Ион',
  'Михей', 'Михея', 'Мих',
  'Наум', 'Наума',
  'Аввакум', 'Аввакума', 'Авв',
  'Софония', 'Софонии', 'Соф',
  'Аггей', 'Аггея', 'Агг',
  'Захария', 'Захарии', 'Зах',
  'Малахия', 'Малахии', 'Мал',

  // Новый Завет
  'Матфея', 'От\\s+Матфея', 'Матфей', 'Мф', 'Мт',
  'Марка', 'От\\s+Марка', 'Марк', 'Мк', 'Мр',
  'Луки', 'От\\s+Луки', 'Лука', 'Лк',
  'Иоанна', 'От\\s+Иоанна', 'Иоанн', 'Ин', 'Инн',
  'Деяния(?:\\s+апостолов)?', 'Деяний', 'Деян', 'Дея',
  'Иакова', 'Иак',
  '1\\s*Петра', '1-е\\s*Петра', '1Пет', '1\\s*Пет',
  '2\\s*Петра', '2-е\\s*Петра', '2Пет', '2\\s*Пет',
  '1\\s*Иоанна', '1-е\\s*Иоанна', '1Ин', '1\\s*Ин',
  '2\\s*Иоанна', '2-е\\s*Иоанна', '2Ин', '2\\s*Ин',
  '3\\s*Иоанна', '3-е\\s*Иоанна', '3Ин', '3\\s*Ин',
  'Иуды', 'Иуд',
  'Римлянам', 'К\\s+Римлянам', 'Рим',
  '1\\s*Коринфянам', '1-е\\s*Коринфянам', '1Кор', '1\\s*Кор',
  '2\\s*Коринфянам', '2-е\\s*Коринфянам', '2Кор', '2\\s*Кор',
  'Галатам', 'К\\s+Галатам', 'Гал',
  'Ефесянам', 'К\\s+Ефесянам', 'Еф', 'Ефес',
  'Филиппийцам', 'К\\s+Филиппийцам', 'Флп', 'Фил',
  'Колоссянам', 'К\\s+Колоссянам', 'Кол',
  '1\\s*Фессалоникийцам', '1\\s*Солунянам', '1Фесс', '1Сол',
  '2\\s*Фессалоникийцам', '2\\s*Солунянам', '2Фесс', '2Сол',
  '1\\s*Тимофею', '1-е\\s*Тимофею', '1Тим', '1\\s*Тим',
  '2\\s*Тимофею', '2-е\\s*Тимофею', '2Тим', '2\\s*Тим',
  'Титу', 'К\\s+Титу', 'Тит',
  'Филимону', 'К\\s+Филимону', 'Флм',
  'Евреям', 'К\\s+Евреям', 'Евр',
  'Откровение', 'Откровения', 'Апокалипсис', 'Откр', 'Отк',
].join('|');

export function replaceBiblicalReferences(text: string, countRef?: { count: number }): string {
  const bibleRegex = new RegExp(
    `(?<![а-яА-ЯёЁ0-9a-zA-Z])(${BIBLE_BOOKS_PATTERN})\\s+(\\d{1,3})[:.](\\d{1,3})(?:-(\\d{1,3}))?(?!\\d)`,
    'gi'
  );

  return text.replace(bibleRegex, (_match, book, chStr, vStartStr, vEndStr) => {
    if (countRef) countRef.count++;
    const ch = parseInt(chStr, 10);
    const vStart = parseInt(vStartStr, 10);
    const isPsalm = /^(?:псалом|псалтирь|псалмы|пс)$/i.test(book.trim());

    if (vEndStr) {
      const vEnd = parseInt(vEndStr, 10);
      if (isPsalm) {
        return `${book} ${ordinalM(ch)}, стихи с ${ordinalGenM(vStart)} по ${ordinalM(vEnd)}`;
      }
      return `${book}, глава ${ordinalF(ch)}, стихи с ${ordinalGenM(vStart)} по ${ordinalM(vEnd)}`;
    }

    if (isPsalm) {
      return `${book} ${ordinalM(ch)}, стих ${ordinalM(vStart)}`;
    }
    return `${book}, глава ${ordinalF(ch)}, стих ${ordinalM(vStart)}`;
  });
}

/**
 * б) Даты:
 * (\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(\s+(1\d{3}|20\d{2}))?
 * -> ordinalGenM(день) + ' ' + месяц (+ ' ' + yearToSpeech(год) + ' года')
 */
export function replaceDates(text: string, countRef?: { count: number }): string {
  const datesRegex = /(?<!\d)(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+(8\d{2}|9\d{2}|1\d{3}|20\d{2})(?:\s*года)?)?(?![а-яА-ЯёЁ])/gi;

  return text.replace(datesRegex, (_match, dayStr, monthStr, yearStr) => {
    if (countRef) countRef.count++;
    const day = parseInt(dayStr, 10);
    const daySpeech = ordinalGenM(day);

    if (yearStr) {
      const y = parseInt(yearStr, 10);
      return `${daySpeech} ${monthStr} ${yearToSpeech(y, false)} года`;
    }

    return `${daySpeech} ${monthStr}`;
  });
}

/**
 * в) Годы:
 * \b(8\d{2}|9\d{2}|1\d{3}|20\d{2})\s*(года|году|год|лет|г\.)
 * -> yearToSpeech + падеж из оригинала
 */
export function replaceYears(text: string, countRef?: { count: number }): string {
  const yearsRegex = /(?<!\d)(8\d{2}|9\d{2}|1\d{3}|20\d{2})\s*(года|году|год|лет|г\.)(?![а-яА-ЯёЁ])/gi;

  return text.replace(yearsRegex, (_match, yStr, suffix) => {
    if (countRef) countRef.count++;
    const y = parseInt(yStr, 10);
    const sufLower = suffix.toLowerCase();

    if (sufLower === 'году') {
      return `${yearToSpeech(y, true)} году`;
    }
    return `${yearToSpeech(y, false)} года`;
  });
}

/**
 * г) Века:
 * \b(IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|XVII|XVIII|XIX|XX|XXI)\s*(век|века|веке)
 * -> ordinalM(римское) + ' ' + склонение('век')
 */
const ROMAN_CENTURIES: Record<string, number> = {
  IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10,
  XI: 11, XII: 12, XIII: 13, XIV: 14, XV: 15, XVI: 16, XVII: 17, XVIII: 18, XIX: 19, XX: 20, XXI: 21
};

export function replaceCenturies(text: string, countRef?: { count: number }): string {
  const centuriesRegex = /(?<![а-яА-ЯёЁa-zA-Z0-9])(IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|XVII|XVIII|XIX|XX|XXI)\s*(век|века|веке|веком|веках)(?![а-яА-ЯёЁa-zA-Z0-9])/gi;

  return text.replace(centuriesRegex, (_match, roman, form) => {
    const n = ROMAN_CENTURIES[roman.toUpperCase()];
    if (!n) return _match;

    if (countRef) countRef.count++;
    const formLower = form.toLowerCase();

    if (formLower === 'веке') {
      return `${ordinalPrepM(n)} веке`;
    }
    if (formLower === 'века') {
      return `${ordinalGenM(n)} века`;
    }
    if (formLower === 'веком') {
      return `${ordinalM(n)} веком`;
    }
    return `${ordinalM(n)} век`;
  });
}

/**
 * д) Время:
 * \b([01]?\d|2[0-3]):([0-5]\d)\b
 * -> numberToWords(ч)+' часов '+numberToWords(м)+' минут' (м==0 -> 'ровно')
 */
export function replaceTime(text: string, countRef?: { count: number }): string {
  const timeRegex = /(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/g;

  return text.replace(timeRegex, (match, hStr, mStr, offset, fullStr) => {
    // Защита от стихов Библии
    const prefix = fullStr.slice(Math.max(0, offset - 30), offset).toLowerCase();
    if (/(?:глав[аеы]|стих[ае]?|псалом|псалтирь|притч[ией]|быти[ея]|исход[а]?)\s*$/i.test(prefix)) {
      return match;
    }

    if (countRef) countRef.count++;
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);

    const hWord = numberToWords(h);
    if (m === 0) {
      return `${hWord} часов ровно`;
    }
    const mWord = numberToWords(m);
    return `${hWord} часов ${mWord} минут`;
  });
}

/**
 * е) Деньги:
 * (\d[\d\s]*)\s*(₽|руб|руб\.|рублей|рубля) -> numberToWords+' рублей'
 */
export function replaceMoney(text: string, countRef?: { count: number }): string {
  const moneyRegex = /(?<!\d)(\d[\d\s]{0,8}\d|\d)\s*(₽|руб\.?|рублей|рубля|рубль)(?![а-яА-ЯёЁ\d])/gi;

  return text.replace(moneyRegex, (_match, amountStr) => {
    const cleanNum = parseInt(amountStr.replace(/\s+/g, ''), 10);
    if (isNaN(cleanNum)) return _match;

    if (countRef) countRef.count++;
    const numWord = numberToWords(cleanNum);

    const rem100 = cleanNum % 100;
    const rem10 = cleanNum % 10;

    let unit = 'рублей';
    if (rem100 < 10 || rem100 >= 20) {
      if (rem10 === 1) unit = 'рубль';
      else if (rem10 >= 2 && rem10 <= 4) unit = 'рубля';
    }

    return `${numWord} ${unit}`;
  });
}

/**
 * ж) Проценты:
 * (\d+)\s*(%|процентов|процент|процента) -> numberToWords+' процентов'
 */
export function replacePercentages(text: string, countRef?: { count: number }): string {
  const percentRegex = /(?<!\d)(\d+)\s*(%|процентов|процент|процента)(?![а-яА-ЯёЁ\d])/gi;

  return text.replace(percentRegex, (_match, numStr) => {
    const n = parseInt(numStr, 10);
    if (isNaN(n)) return _match;

    if (countRef) countRef.count++;
    const numWord = numberToWords(n);

    const rem100 = n % 100;
    const rem10 = n % 10;

    let unit = 'процентов';
    if (rem100 < 10 || rem100 >= 20) {
      if (rem10 === 1) unit = 'процент';
      else if (rem10 >= 2 && rem10 <= 4) unit = 'процента';
    }

    return `${numWord} ${unit}`;
  });
}

/**
 * з) Телефоны:
 * \+?7?[\s(-]*(\d{3})[\s)-]*(\d{3})[\s-]*(\d{2})[\s-]*(\d{2}) -> 'плюс семь, '+каждую цифру отдельно через запятую
 */
const DIGIT_WORDS: Record<string, string> = {
  '0': 'ноль',
  '1': 'один',
  '2': 'два',
  '3': 'три',
  '4': 'четыре',
  '5': 'пять',
  '6': 'шесть',
  '7': 'семь',
  '8': 'восемь',
  '9': 'девять',
};

export function replacePhoneNumbers(text: string, countRef?: { count: number }): string {
  const phoneRegex = /(?:\+7|8|\b7)?[\s(-]*(\d{3})[\s)-]*(\d{3})[\s-]*(\d{2})[\s-]*(\d{2})\b/g;

  return text.replace(phoneRegex, (_match, g1, g2, g3, g4) => {
    if (countRef) countRef.count++;
    const digits = `${g1}${g2}${g3}${g4}`.split('');
    const words = digits.map(d => DIGIT_WORDS[d] || d);

    return `плюс семь, ${words.join(', ')}`;
  });
}

/**
 * и) Остальные числа 1-999 перед существительными
 * (стихов, вопросов, дней, минут, секунд, раз, часов, человек, лет и т.д.)
 */
const NOUN_PATTERNS = [
  'стихов', 'стиха', 'стих',
  'вопросов', 'вопроса', 'вопрос',
  'дней', 'дня', 'день',
  'минут', 'минуты', 'минута',
  'секунд', 'секунды', 'секунда',
  'раз', 'раза',
  'часов', 'часа', 'час',
  'глав', 'главы', 'глава',
  'человек', 'людей',
  'месяцев', 'месяца', 'месяц',
  'лет'
].join('|');

export function replaceNumbersBeforeNouns(text: string, countRef?: { count: number }): string {
  const nounRegex = new RegExp(`(?<!\\d)(\\d{1,3})\\s+(${NOUN_PATTERNS})(?![а-яА-ЯёЁ])`, 'gi');

  return text.replace(nounRegex, (_match, numStr, noun) => {
    if (countRef) countRef.count++;
    const n = parseInt(numStr, 10);

    // Определение рода для правильного согласования единиц
    const isFemale = /^(?:минут[аы]?|секунд[аы]?|глав[аы]?)$/i.test(noun);
    const isNeuter = false;
    const gender: Gender = isFemale ? 'female' : isNeuter ? 'neuter' : 'male';

    const numWord = numberToWords(n, gender);
    return `${numWord} ${noun}`;
  });
}

/**
 * Главный универсальный нормализатор для голосового синтеза (TTS-only).
 * Обрабатывает ВЕСЬ текст целиком ДО разбивки на чанки.
 * 
 * Строгий порядок правил (все с флагом /g):
 * а) Библейские ссылки
 * б) Даты
 * в) Годы
 * г) Века
 * д) Время
 * е) Деньги
 * ж) Проценты
 * з) Телефоны
 * и) Остальные числа перед существительными
 */
export function normalizeForVoice(text: string, prepareFn?: (t: string) => string): string {
  if (!text) return '';

  let res = prepareFn ? prepareFn(text) : text;
  if (!res) return '';

  const counter = { count: 0 };

  // а) Библейские ссылки
  res = replaceBiblicalReferences(res, counter);

  // б) Даты
  res = replaceDates(res, counter);

  // в) Годы
  res = replaceYears(res, counter);

  // г) Века
  res = replaceCenturies(res, counter);

  // д) Время
  res = replaceTime(res, counter);

  // е) Деньги
  res = replaceMoney(res, counter);

  // ж) Проценты
  res = replacePercentages(res, counter);

  // з) Телефоны
  res = replacePhoneNumbers(res, counter);

  // и) Остальные числа перед существительными
  res = replaceNumbersBeforeNouns(res, counter);

  if (counter.count > 0) {
    console.log('🎙️ [TTS] norm замен: ' + counter.count);
  }

  return res;
}

// Алиасы для обратной совместимости
export const normalizeBiblicalReferences = (text: string) => replaceBiblicalReferences(text);
export const normalizeYears = (text: string) => replaceYears(text);
export const normalizeTimeOfDay = (text: string) => replaceTime(text);
export const normalizeHours12 = (text: string) => replaceNumbersBeforeNouns(text);
