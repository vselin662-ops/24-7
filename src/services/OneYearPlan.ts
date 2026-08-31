import fs from 'fs';
import path from 'path';
import { logger } from '../logger';

export interface PlanChapter {
  b: string;       // Russian book name
  c: number;       // Chapter number
  ruName: string;  // e.g. "Бытие 1"
  en: string;      // e.g. "Genesis 1"
  abbrev: string;  // e.g. "gn"
}

export interface DayPlan {
  day: number;
  morning: PlanChapter[];
  noon: PlanChapter[];
  evening: {
    psalm: PlanChapter;
    proverb: PlanChapter;
  };
}

export const OT_CANONICAL_BOOKS: { ru: string; en: string; abbrev: string; ch: number }[] = [
  { ru: 'Бытие', en: 'Genesis', abbrev: 'gn', ch: 50 },
  { ru: 'Исход', en: 'Exodus', abbrev: 'ex', ch: 40 },
  { ru: 'Левит', en: 'Leviticus', abbrev: 'lv', ch: 27 },
  { ru: 'Числа', en: 'Numbers', abbrev: 'nm', ch: 36 },
  { ru: 'Второзаконие', en: 'Deuteronomy', abbrev: 'dt', ch: 34 },
  { ru: 'Иисус Навин', en: 'Joshua', abbrev: 'js', ch: 24 },
  { ru: 'Судьи', en: 'Judges', abbrev: 'jud', ch: 21 },
  { ru: 'Руфь', en: 'Ruth', abbrev: 'rt', ch: 4 },
  { ru: '1 Царств', en: '1 Samuel', abbrev: '1sm', ch: 31 },
  { ru: '2 Царств', en: '2 Samuel', abbrev: '2sm', ch: 24 },
  { ru: '3 Царств', en: '1 Kings', abbrev: '1kgs', ch: 22 },
  { ru: '4 Царств', en: '2 Kings', abbrev: '2kgs', ch: 25 },
  { ru: '1 Паралипоменон', en: '1 Chronicles', abbrev: '1ch', ch: 29 },
  { ru: '2 Паралипоменон', en: '2 Chronicles', abbrev: '2ch', ch: 36 },
  { ru: '1 Ездры', en: 'Ezra', abbrev: 'ezr', ch: 10 },
  { ru: 'Неемия', en: 'Nehemiah', abbrev: 'ne', ch: 13 },
  { ru: 'Есфирь', en: 'Esther', abbrev: 'et', ch: 10 },
  { ru: 'Иов', en: 'Job', abbrev: 'job', ch: 42 },
  { ru: 'Псалтирь', en: 'Psalms', abbrev: 'ps', ch: 150 },
  { ru: 'Притчи', en: 'Proverbs', abbrev: 'prv', ch: 31 },
  { ru: 'Екклесиаст', en: 'Ecclesiastes', abbrev: 'ec', ch: 12 },
  { ru: 'Песнь Песней', en: 'Song of Solomon', abbrev: 'so', ch: 8 },
  { ru: 'Исаия', en: 'Isaiah', abbrev: 'is', ch: 66 },
  { ru: 'Иеремия', en: 'Jeremiah', abbrev: 'jr', ch: 52 },
  { ru: 'Плач Иеремии', en: 'Lamentations', abbrev: 'lm', ch: 5 },
  { ru: 'Иезекииль', en: 'Ezekiel', abbrev: 'ez', ch: 48 },
  { ru: 'Даниил', en: 'Daniel', abbrev: 'dn', ch: 12 },
  { ru: 'Осия', en: 'Hosea', abbrev: 'ho', ch: 14 },
  { ru: 'Иоиль', en: 'Joel', abbrev: 'jl', ch: 3 },
  { ru: 'Амос', en: 'Amos', abbrev: 'am', ch: 9 },
  { ru: 'Авдий', en: 'Obadiah', abbrev: 'ob', ch: 1 },
  { ru: 'Иона', en: 'Jonah', abbrev: 'jn', ch: 4 },
  { ru: 'Михей', en: 'Micah', abbrev: 'mi', ch: 7 },
  { ru: 'Наум', en: 'Nahum', abbrev: 'na', ch: 3 },
  { ru: 'Аввакум', en: 'Habakkuk', abbrev: 'hk', ch: 3 },
  { ru: 'Софония', en: 'Zephaniah', abbrev: 'zp', ch: 3 },
  { ru: 'Аггей', en: 'Haggai', abbrev: 'hg', ch: 2 },
  { ru: 'Захария', en: 'Zechariah', abbrev: 'zc', ch: 14 },
  { ru: 'Малахия', en: 'Malachi', abbrev: 'ml', ch: 4 }
];

export const NT_CANONICAL_BOOKS: { ru: string; en: string; abbrev: string; ch: number }[] = [
  { ru: 'Матфея', en: 'Matthew', abbrev: 'mt', ch: 28 },
  { ru: 'Марка', en: 'Mark', abbrev: 'mk', ch: 16 },
  { ru: 'Луки', en: 'Luke', abbrev: 'lk', ch: 24 },
  { ru: 'Иоанна', en: 'John', abbrev: 'jo', ch: 21 },
  { ru: 'Деяния', en: 'Acts', abbrev: 'act', ch: 28 },
  { ru: 'Римлянам', en: 'Romans', abbrev: 'rm', ch: 16 },
  { ru: '1 Коринфянам', en: '1 Corinthians', abbrev: '1co', ch: 16 },
  { ru: '2 Коринфянам', en: '2 Corinthians', abbrev: '2co', ch: 13 },
  { ru: 'Галатам', en: 'Galatians', abbrev: 'gl', ch: 6 },
  { ru: 'Ефесянам', en: 'Ephesians', abbrev: 'eph', ch: 6 },
  { ru: 'Филиппийцам', en: 'Philippians', abbrev: 'ph', ch: 4 },
  { ru: 'Колоссянам', en: 'Colossians', abbrev: 'cl', ch: 4 },
  { ru: '1 Фессалоникийцам', en: '1 Thessalonians', abbrev: '1ts', ch: 5 },
  { ru: '2 Фессалоникийцам', en: '2 Thessalonians', abbrev: '2ts', ch: 3 },
  { ru: '1 Тимофею', en: '1 Timothy', abbrev: '1tm', ch: 6 },
  { ru: '2 Тимофею', en: '2 Timothy', abbrev: '2tm', ch: 4 },
  { ru: 'Титу', en: 'Titus', abbrev: 'tt', ch: 3 },
  { ru: 'Филимону', en: 'Philemon', abbrev: 'phm', ch: 1 },
  { ru: 'Евреям', en: 'Hebrews', abbrev: 'hb', ch: 13 },
  { ru: 'Иакова', en: 'James', abbrev: 'jm', ch: 5 },
  { ru: '1 Петра', en: '1 Peter', abbrev: '1pe', ch: 5 },
  { ru: '2 Петра', en: '2 Peter', abbrev: '2pe', ch: 3 },
  { ru: '1 Иоанна', en: '1 John', abbrev: '1jo', ch: 5 },
  { ru: '2 Иоанна', en: '2 John', abbrev: '2jo', ch: 1 },
  { ru: '3 Иоанна', en: '3 John', abbrev: '3jo', ch: 1 },
  { ru: 'Иуды', en: 'Jude', abbrev: 'jd', ch: 1 },
  { ru: 'Откровение', en: 'Revelation', abbrev: 're', ch: 22 }
];

export const GOSPEL_BOOKS: { ru: string; en: string; abbrev: string; ch: number }[] = [
  { ru: 'Матфея', en: 'Matthew', abbrev: 'mt', ch: 28 },
  { ru: 'Марка', en: 'Mark', abbrev: 'mk', ch: 16 },
  { ru: 'Луки', en: 'Luke', abbrev: 'lk', ch: 24 },
  { ru: 'Иоанна', en: 'John', abbrev: 'jo', ch: 21 }
];

export function buildOneYearPlan(): DayPlan[] {
  const otChapters: PlanChapter[] = [];
  for (const b of OT_CANONICAL_BOOKS) {
    for (let c = 1; c <= b.ch; c++) {
      otChapters.push({
        b: b.ru,
        c,
        ruName: `${b.ru} ${c}`,
        en: `${b.en} ${c}`,
        abbrev: b.abbrev
      });
    }
  }

  const ntChapters: PlanChapter[] = [];
  for (const b of NT_CANONICAL_BOOKS) {
    for (let c = 1; c <= b.ch; c++) {
      ntChapters.push({
        b: b.ru,
        c,
        ruName: `${b.ru} ${c}`,
        en: `${b.en} ${c}`,
        abbrev: b.abbrev
      });
    }
  }

  const gospelChapters: PlanChapter[] = [];
  for (const b of GOSPEL_BOOKS) {
    for (let c = 1; c <= b.ch; c++) {
      gospelChapters.push({
        b: b.ru,
        c,
        ruName: `${b.ru} ${c}`,
        en: `${b.en} ${c}`,
        abbrev: b.abbrev
      });
    }
  }

  const days: DayPlan[] = [];
  const totalOt = otChapters.length; // 929

  for (let d = 0; d < 365; d++) {
    const dayNum = d + 1;

    // 1. УТРО: Ветхий Завет (929 глав) распределены с накоплением остатка (Bresenham)
    const otStart = Math.floor((d * totalOt) / 365);
    const otEnd = Math.floor(((d + 1) * totalOt) / 365);
    const morning = otChapters.slice(otStart, otEnd);

    // 2. ОБЕД: Новый Завет (260 глав), дни без NT-главы (261-365) -> циклические Евангелия
    let noonItem: PlanChapter;
    if (d < ntChapters.length) {
      noonItem = ntChapters[d];
    } else {
      noonItem = gospelChapters[(d - ntChapters.length) % gospelChapters.length];
    }
    const noon = [noonItem];

    // 3. ВЕЧЕР: Псалтирь циклично (1..150) + Притчи по числу месяца (1..31)
    const psalmNum = (d % 150) + 1;
    const date = new Date(Date.UTC(2025, 0, 1 + d));
    const dayOfMonth = date.getUTCDate(); // 1..31

    const evening = {
      psalm: {
        b: 'Псалтирь',
        c: psalmNum,
        ruName: `Псалом ${psalmNum}`,
        en: `Psalm ${psalmNum}`,
        abbrev: 'ps'
      },
      proverb: {
        b: 'Притчи',
        c: dayOfMonth,
        ruName: `Притчи ${dayOfMonth}`,
        en: `Proverbs ${dayOfMonth}`,
        abbrev: 'prv'
      }
    };

    days.push({
      day: dayNum,
      morning,
      noon,
      evening
    });
  }

  return days;
}

let cachedPlan: DayPlan[] | null = null;

export function getOneYearPlan(): DayPlan[] {
  if (cachedPlan) return cachedPlan;

  const planPath = path.join(process.cwd(), 'data', 'one_year_plan.json');
  try {
    if (fs.existsSync(planPath)) {
      const raw = fs.readFileSync(planPath, 'utf8');
      cachedPlan = JSON.parse(raw);
      if (Array.isArray(cachedPlan) && cachedPlan.length === 365) {
        return cachedPlan;
      }
    }
  } catch (err) {
    logger.warn('⚠️ [OneYearPlan] Error reading one_year_plan.json, regenerating:', err);
  }

  const generated = buildOneYearPlan();
  try {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(planPath, JSON.stringify(generated, null, 2), 'utf8');
    logger.info('📖 [OneYearPlan] Generated and saved data/one_year_plan.json (365 days)');
  } catch (saveErr) {
    logger.error('❌ [OneYearPlan] Failed to save one_year_plan.json:', saveErr);
  }

  cachedPlan = generated;
  return cachedPlan;
}

// Helper: Get day of year (1..365) from date or timezone
export function getDayOfYear(date: Date = new Date(), timeZone: string = 'Europe/Moscow'): number {
  try {
    const localDateStr = new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
    const [year, month, day] = localDateStr.split('-').map(Number);
    const startOfYear = new Date(Date.UTC(year, 0, 1));
    const current = new Date(Date.UTC(year, month - 1, day));
    const diffMs = current.getTime() - startOfYear.getTime();
    const dayNum = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
    return Math.max(1, Math.min(365, dayNum));
  } catch {
    return 1;
  }
}

export function getPlanForDay(dayNumber: number): DayPlan {
  const plan = getOneYearPlan();
  const normalizedIndex = ((dayNumber - 1) % 365 + 365) % 365;
  return plan[normalizedIndex] || plan[0];
}

export const oneYearPlan = {
  getOneYearPlan,
  getPlanForDay,
  getDayOfYear
};
