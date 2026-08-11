export const SUPPORTED_LANGUAGES = {
  en: { name: 'Английский', nativeName: 'English' },
  es: { name: 'Испанский', nativeName: 'Español' },
  de: { name: 'Немецкий', nativeName: 'Deutsch' },
  fr: { name: 'Французский', nativeName: 'Français' },
  it: { name: 'Итальянский', nativeName: 'Italiano' },
  pt: { name: 'Португальский', nativeName: 'Português' },
  zh: { name: 'Китайский', nativeName: '中文' },
  ja: { name: 'Японский', nativeName: '日本語' },
  ko: { name: 'Корейский', nativeName: '한국어' },
  ar: { name: 'Арабский', nativeName: 'العربية' },
  tr: { name: 'Турецкий', nativeName: 'Türkçe' },
  hi: { name: 'Хинди', nativeName: 'हिन्दी' },
} as const;

export type LanguageCode = keyof typeof SUPPORTED_LANGUAGES;

export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type Level = (typeof LEVELS)[number];

export const LESSONS_PER_LEVEL = 10;
export const TOTAL_LESSONS = 60;

export const TOPICS_BY_LEVEL: Record<Level, string[]> = {
  A1: [
    'Приветствия и знакомство',
    'Числа и возраст',
    'Семья',
    'Еда и напитки',
    'Город и направления',
    'Время и распорядок дня',
    'Покупки и магазин',
    'Погода и времена года',
    'Хобби и свободное время',
    'Повторение A1 + тест',
  ],
  A2: [
    'Прошедшее время (Perfekt/Perfect)',
    'Прошедшее время (Präteritum/Past Simple)',
    'Будущее время',
    'Здоровье и врач',
    'Работа и профессия',
    'Путешествия и транспорт',
    'Эмоции и чувства',
    'Жильё и дом',
    'Сравнения и степени',
    'Повторение A2 + тест',
  ],
  B1: [
    'Subjuntivo/Konjunktiv — желания и сомнения',
    'Условные предложения',
    'Мнения и дебаты',
    'Новости и медиа',
    'Технологии и цифровая жизнь',
    'Экология и окружающая среда',
    'Культура и традиции страны',
    'Мечты и жизненные цели',
    'Сложные диалоги и конфликты',
    'Финальный экзамен B1',
  ],
  B2: [
    'Пассивный залог и каузатив',
    'Косвенная речь',
    'Академический стиль и эссе',
    'Философия и этика',
    'Экономика и финансы',
    'Политика и общество',
    'Наука и открытия',
    'Искусство и литература',
    'Психология и отношения',
    'Финальный экзамен B2',
  ],
  C1: [
    'Идиомы и фразеологизмы',
    'Стилистические нюансы',
    'Деловые переговоры',
    'Научные тексты и аннотации',
    'Юридический язык',
    'Медицинская терминология',
    'Литературный анализ',
    'Публичные выступления',
    'Перевод и интерпретация',
    'Финальный экзамен C1',
  ],
  C2: [
    'Диалекты и региональные варианты',
    'Историческое развитие языка',
    'Лингвистический анализ',
    'Художественный перевод',
    'Академическая публикация',
    'Одновременный перевод',
    'Языковая политика',
    'Создание контента на языке',
    'Мастерство и носитель',
    'Финальный экзамен C2 — уровень носителя',
  ],
};

/**
 * Нормализует текстовое название или код языка в поддерживаемый код языка.
 */
export function parseLanguageCode(input: string): LanguageCode {
  if (!input) return 'en';
  const lower = input.toLowerCase().trim();
  if (lower in SUPPORTED_LANGUAGES) {
    return lower as LanguageCode;
  }
  for (const [code, info] of Object.entries(SUPPORTED_LANGUAGES)) {
    if (
      info.name.toLowerCase() === lower ||
      info.nativeName.toLowerCase() === lower ||
      lower.includes(info.name.toLowerCase().slice(0, 4)) ||
      lower.includes(info.nativeName.toLowerCase().slice(0, 4))
    ) {
      return code as LanguageCode;
    }
  }
  return 'en';
}

