import fs from 'fs';
import path from 'path';
import { sqliteDb } from '../../db';
import { logger } from '../logger';

export interface ScriptureVerse {
  book: string;
  book_en?: string;
  abbrev?: string;
  chapter: number;
  verse: number;
  text: string;
}

export interface ScriptureResult {
  text: string;
  ref: string;
  source: 'file' | 'api';
  versesCount?: number;
}

const ALLOWED_PSALMS = [
  1, 2, 3, 8, 15, 22, 23, 26, 27, 33, 34, 37, 50, 51, 62, 84, 90, 102, 103, 120, 126, 127, 130, 145, 150
];

// Book name normalizer mapping (Russian synonyms, English names, abbreviations)
const BOOK_SYNONYMS: Record<string, string> = {
  // OT
  'бытие': 'Бытие', 'быт': 'Бытие', 'genesis': 'Бытие', 'gn': 'Бытие', 'gen': 'Бытие',
  'исход': 'Исход', 'исх': 'Исход', 'exodus': 'Исход', 'ex': 'Исход',
  'левит': 'Левит', 'лев': 'Левит', 'leviticus': 'Левит', 'lv': 'Левит',
  'числа': 'Числа', 'чис': 'Числа', 'чс': 'Числа', 'numbers': 'Числа', 'nm': 'Числа', 'num': 'Числа',
  'второзаконие': 'Второзаконие', 'вт': 'Второзаконие', 'втор': 'Второзаконие', 'deuteronomy': 'Второзаконие', 'dt': 'Второзаконие',
  'иисус навин': 'Иисус Навин', 'нав': 'Иисус Навин', 'ииснав': 'Иисус Навин', 'joshua': 'Иисус Навин', 'js': 'Иисус Навин', 'jos': 'Иисус Навин',
  'судьи': 'Судьи', 'суд': 'Судьи', 'judges': 'Судьи', 'jud': 'Судьи', 'jdg': 'Судьи',
  'руфь': 'Руфь', 'руф': 'Руфь', 'ruth': 'Руфь', 'rt': 'Руфь', 'rut': 'Руфь',
  '1 царств': '1 Царств', '1цар': '1 Царств', '1 samuel': '1 Царств', '1sm': '1 Царств', '1sam': '1 Царств',
  '2 царств': '2 Царств', '2цар': '2 Царств', '2 samuel': '2 Царств', '2sm': '2 Царств', '2sam': '2 Царств',
  '3 царств': '3 Царств', '3цар': '3 Царств', '1 kings': '3 Царств', '1kgs': '3 Царств', '1kg': '3 Царств',
  '4 царств': '4 Царств', '4цар': '4 Царств', '2 kings': '4 Царств', '2kgs': '4 Царств', '2kg': '4 Царств',
  '1 паралипоменон': '1 Паралипоменон', '1пар': '1 Паралипоменон', '1 chronicles': '1 Паралипоменон', '1ch': '1 Паралипоменон', '1chr': '1 Паралипоменон',
  '2 паралипоменон': '2 Паралипоменон', '2пар': '2 Паралипоменон', '2 chronicles': '2 Паралипоменон', '2ch': '2 Паралипоменон', '2chr': '2 Паралипоменон',
  '1 ездры': '1 Ездры', 'ездр': '1 Ездры', 'езд': '1 Ездры', 'ezra': '1 Ездры', 'ezr': '1 Ездры',
  'неемия': 'Неемия', 'неем': 'Неемия', 'nehemiah': 'Неемия', 'ne': 'Неемия', 'neh': 'Неемия',
  'есфирь': 'Есфирь', 'есф': 'Есфирь', 'esther': 'Есфирь', 'et': 'Есфирь', 'est': 'Есфирь',
  'иов': 'Иов', 'job': 'Иов', 'jb': 'Иов',
  'псалтирь': 'Псалтирь', 'псалом': 'Псалтирь', 'пс': 'Псалтирь', 'псал': 'Псалтирь', 'psalms': 'Псалтирь', 'psalm': 'Псалтирь', 'ps': 'Псалтирь',
  'притчи': 'Притчи', 'притч': 'Притчи', 'прит': 'Притчи', 'пр': 'Притчи', 'proverbs': 'Притчи', 'proverb': 'Притчи', 'prv': 'Притчи', 'pr': 'Притчи',
  'екклесиаст': 'Екклесиаст', 'еккл': 'Екклесиаст', 'екк': 'Екклесиаст', 'ecclesiastes': 'Екклесиаст', 'ec': 'Екклесиаст', 'ecc': 'Екклесиаст',
  'песнь песней': 'Песнь Песней', 'песн': 'Песнь Песней', 'песнь': 'Песнь Песней', 'song of solomon': 'Песнь Песней', 'so': 'Песнь Песней', 'song': 'Песнь Песней',
  'исаия': 'Исаия', 'ис': 'Исаия', 'исая': 'Исаия', 'isaiah': 'Исаия', 'is': 'Исаия', 'isa': 'Исаия',
  'иеремия': 'Иеремия', 'иер': 'Иеремия', 'jeremiah': 'Иеремия', 'jr': 'Иеремия', 'jer': 'Иеремия',
  'плач иеремии': 'Плач Иеремии', 'плач': 'Плач Иеремии', 'lamentations': 'Плач Иеремии', 'lm': 'Плач Иеремии', 'lam': 'Плач Иеремии',
  'иезекииль': 'Иезекииль', 'иез': 'Иезекииль', 'ezekiel': 'Иезекииль', 'ez': 'Иезекииль', 'ezk': 'Иезекииль',
  'даниил': 'Даниил', 'дан': 'Даниил', 'daniel': 'Даниил', 'dn': 'Даниил', 'dan': 'Даниил',
  'осия': 'Осия', 'ос': 'Осия', 'hosea': 'Осия', 'ho': 'Осия', 'hos': 'Осия',
  'иоиль': 'Иоиль', 'иоил': 'Иоиль', 'joel': 'Иоиль', 'jl': 'Иоиль', 'jol': 'Иоиль',
  'амос': 'Амос', 'ам': 'Амос', 'amos': 'Амос', 'am': 'Амос',
  'авдий': 'Авдий', 'авд': 'Авдий', 'obadiah': 'Авдий', 'ob': 'Авдий', 'oba': 'Авдий',
  'иона': 'Иона', 'ион': 'Иона', 'jonah': 'Иона', 'jn': 'Иона', 'jon': 'Иона',
  'михей': 'Михей', 'мих': 'Михей', 'micah': 'Михей', 'mi': 'Михей', 'mic': 'Михей',
  'наум': 'Наум', 'nahum': 'Наум', 'na': 'Наум', 'nah': 'Наум',
  'аввакум': 'Аввакум', 'авв': 'Аввакум', 'habakkuk': 'Аввакум', 'hk': 'Аввакум', 'hab': 'Аввакум',
  'софония': 'Софония', 'соф': 'Софония', 'zephaniah': 'Софония', 'zp': 'Софония', 'zep': 'Софония',
  'аггей': 'Аггей', 'агг': 'Аггей', 'haggai': 'Аггей', 'hg': 'Аггей', 'hag': 'Аггей',
  'захария': 'Захария', 'зах': 'Захария', 'zechariah': 'Захария', 'zc': 'Захария', 'zec': 'Захария',
  'малахия': 'Малахия', 'мал': 'Малахия', 'malachi': 'Малахия', 'ml': 'Малахия', 'mal': 'Малахия',

  // NT
  'матфея': 'Матфея', 'от матфея': 'Матфея', 'мф': 'Матфея', 'матф': 'Матфея', 'matthew': 'Матфея', 'mt': 'Матфея', 'matt': 'Матфея',
  'марка': 'Марка', 'от марка': 'Марка', 'мк': 'Марка', 'марк': 'Марка', 'mark': 'Марка', 'mk': 'Марка', 'mrk': 'Марка',
  'луки': 'Луки', 'от луки': 'Луки', 'лк': 'Луки', 'лук': 'Луки', 'luke': 'Луки', 'lk': 'Луки', 'luk': 'Луки',
  'иоанна': 'Иоанна', 'от иоанна': 'Иоанна', 'ин': 'Иоанна', 'иоан': 'Иоанна', 'john': 'Иоанна', 'jo': 'Иоанна', 'jhn': 'Иоанна',
  'деяния': 'Деяния', 'деян': 'Деяния', 'деяти': 'Деяния', 'acts': 'Деяния', 'act': 'Деяния',
  'римлянам': 'Римлянам', 'рим': 'Римлянам', 'к римлянам': 'Римлянам', 'romans': 'Римлянам', 'rm': 'Римлянам', 'rom': 'Римлянам',
  '1 коринфянам': '1 Коринфянам', '1кор': '1 Коринфянам', '1 corinthians': '1 Коринфянам', '1co': '1 Коринфянам', '1cor': '1 Коринфянам',
  '2 коринфянам': '2 Коринфянам', '2кор': '2 Коринфянам', '2 corinthians': '2 Коринфянам', '2co': '2 Коринфянам', '2cor': '2 Коринфянам',
  'галатам': 'Галатам', 'гал': 'Галатам', 'к галатам': 'Галатам', 'galatians': 'Галатам', 'gl': 'Галатам', 'gal': 'Галатам',
  'ефесянам': 'Ефесянам', 'ефес': 'Ефесянам', 'еф': 'Ефесянам', 'к ефесянам': 'Ефесянам', 'ephesians': 'Ефесянам', 'eph': 'Ефесянам',
  'филиппийцам': 'Филиппийцам', 'фил': 'Филиппийцам', 'к филиппийцам': 'Филиппийцам', 'philippians': 'Филиппийцам', 'ph': 'Филиппийцам', 'php': 'Филиппийцам',
  'колоссянам': 'Колоссянам', 'кол': 'Колоссянам', 'к колоссянам': 'Колоссянам', 'colossians': 'Колоссянам', 'cl': 'Колоссянам', 'col': 'Колоссянам',
  '1 фессалоникийцам': '1 Фессалоникийцам', '1фесс': '1 Фессалоникийцам', '1солунянам': '1 Фессалоникийцам', '1 thessalonians': '1 Фессалоникийцам', '1ts': '1 Фессалоникийцам', '1th': '1 Фессалоникийцам',
  '2 фессалоникийцам': '2 Фессалоникийцам', '2фесс': '2 Фессалоникийцам', '2солунянам': '2 Фессалоникийцам', '2 thessalonians': '2 Фессалоникийцам', '2ts': '2 Фессалоникийцам', '2th': '2 Фессалоникийцам',
  '1 тимофею': '1 Тимофею', '1тим': '1 Тимофею', '1 timothy': '1 Тимофею', '1tm': '1 Тимофею', '1tim': '1 Тимофею',
  '2 тимофею': '2 Тимофею', '2тим': '2 Тимофею', '2 timothy': '2 Тимофею', '2tm': '2 Тимофею', '2tim': '2 Тимофею',
  'титу': 'Титу', 'тит': 'Титу', 'к титу': 'Титу', 'titus': 'Титу', 'tt': 'Титу', 'tit': 'Титу',
  'филимону': 'Филимону', 'флм': 'Филимону', 'к филимону': 'Филимону', 'philemon': 'Филимону', 'phm': 'Филимону', 'phlm': 'Филимону',
  'евреям': 'Евреям', 'евр': 'Евреям', 'к евреям': 'Евреям', 'hebrews': 'Евреям', 'hb': 'Евреям', 'heb': 'Евреям',
  'иакова': 'Иакова', 'иак': 'Иакова', 'james': 'Иакова', 'jm': 'Иакова', 'jas': 'Иакова',
  '1 петра': '1 Петра', '1пет': '1 Петра', '1 peter': '1 Петра', '1pe': '1 Петра', '1pet': '1 Петра',
  '2 петра': '2 Петра', '2пет': '2 Петра', '2 peter': '2 Петра', '2pe': '2 Петра', '2pet': '2 Петра',
  '1 иоанна': '1 Иоанна', '1ин': '1 Иоанна', '1 john': '1 Иоанна', '1jo': '1 Иоанна', '1jhn': '1 Иоанна',
  '2 иоанна': '2 Иоанна', '2ин': '2 Иоанна', '2 john': '2 Иоанна', '2jo': '2 Иоанна', '2jhn': '2 Иоанна',
  '3 иоанна': '3 Иоанна', '3ин': '3 Иоанна', '3 john': '3 Иоанна', '3jo': '3 Иоанна', '3jhn': '3 Иоанна',
  'иуды': 'Иуды', 'иуд': 'Иуды', 'jude': 'Иуды', 'jd': 'Иуды', 'jde': 'Иуды',
  'откровение': 'Откровение', 'откр': 'Откровение', 'апокалипсис': 'Откровение', 'revelation': 'Откровение', 're': 'Откровение', 'rev': 'Откровение'
};

const ENGLISH_BOOK_NAMES: Record<string, string> = {
  'Бытие': 'Genesis', 'Исход': 'Exodus', 'Левит': 'Leviticus', 'Числа': 'Numbers', 'Второзаконие': 'Deuteronomy',
  'Иисус Навин': 'Joshua', 'Судьи': 'Judges', 'Руфь': 'Ruth', '1 Царств': '1 Samuel', '2 Царств': '2 Samuel',
  '3 Царств': '1 Kings', '4 Царств': '2 Kings', '1 Паралипоменон': '1 Chronicles', '2 Паралипоменон': '2 Chronicles',
  '1 Ездры': 'Ezra', 'Неемия': 'Nehemiah', 'Есфирь': 'Esther', 'Иов': 'Job', 'Псалтирь': 'Psalms', 'Притчи': 'Proverbs',
  'Екклесиаст': 'Ecclesiastes', 'Песнь Песней': 'Song of Solomon', 'Исаия': 'Isaiah', 'Иеремия': 'Jeremiah',
  'Плач Иеремии': 'Lamentations', 'Иезекииль': 'Ezekiel', 'Даниил': 'Daniel', 'Осия': 'Hosea', 'Иоиль': 'Joel',
  'Амос': 'Amos', 'Авдий': 'Obadiah', 'Иона': 'Jonah', 'Михей': 'Micah', 'Наум': 'Nahum', 'Аввакум': 'Habakkuk',
  'Софония': 'Zephaniah', 'Аггей': 'Haggai', 'Захария': 'Zechariah', 'Малахия': 'Malachi', 'Матфея': 'Matthew',
  'Марка': 'Mark', 'Луки': 'Luke', 'Иоанна': 'John', 'Деяния': 'Acts', 'Римлянам': 'Romans', '1 Коринфянам': '1 Corinthians',
  '2 Коринфянам': '2 Corinthians', 'Галатам': 'Galatians', 'Ефесянам': 'Ephesians', 'Филиппийцам': 'Philippians',
  'Колоссянам': 'Colossians', '1 Фессалоникийцам': '1 Thessalonians', '2 Фессалоникийцам': '2 Thessalonians',
  '1 Тимофею': '1 Timothy', '2 Тимофею': '2 Timothy', 'Титу': 'Titus', 'Филимону': 'Philemon', 'Евреям': 'Hebrews',
  'Иакова': 'James', '1 Петра': '1 Peter', '2 Петра': '2 Peter', '1 Иоанна': '1 John', '2 Иоанна': '2 John',
  '3 Иоанна': '3 John', 'Иуды': 'Jude', 'Откровение': 'Revelation'
};

class ScriptureServiceImpl {
  private fileVersesMap: Map<string, ScriptureVerse> = new Map();
  private chapterVersesMap: Map<string, ScriptureVerse[]> = new Map();
  private isLoaded = false;
  private lastApiRequestTime = 0;

  constructor() {
    this.initDbTables();
    this.loadSynodalFile();
  }

  private initDbTables() {
    if (sqliteDb) {
      try {
        sqliteDb.exec(`
          CREATE TABLE IF NOT EXISTS scripture_cache (
            ref TEXT PRIMARY KEY,
            text TEXT NOT NULL,
            fetched_at INTEGER NOT NULL
          );
          CREATE TABLE IF NOT EXISTS user_psalm_history (
            chat_id TEXT NOT NULL,
            psalm_num INTEGER NOT NULL,
            date_str TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (chat_id, date_str)
          );
        `);
      } catch (err) {
        logger.warn('⚠️ [Scripture] DB table creation warning:', err);
      }
    }
  }

  public normalizeBookName(book: string): string {
    if (!book) return '';
    const clean = book.trim().toLowerCase().replace(/[.,;:!?]+/g, '');
    if (BOOK_SYNONYMS[clean]) {
      return BOOK_SYNONYMS[clean];
    }
    for (const [syn, standard] of Object.entries(BOOK_SYNONYMS)) {
      if (clean === syn || clean.startsWith(syn + ' ')) {
        return standard;
      }
    }
    return book.trim();
  }

  public loadSynodalFile(): boolean {
    const jsonPath = path.join(process.cwd(), 'data', 'bible_synodal.json');
    try {
      if (fs.existsSync(jsonPath)) {
        const raw = fs.readFileSync(jsonPath, 'utf8');
        const verses: ScriptureVerse[] = JSON.parse(raw);
        if (Array.isArray(verses) && verses.length > 0) {
          this.fileVersesMap.clear();
          this.chapterVersesMap.clear();

          for (const v of verses) {
            const canonicalBook = this.normalizeBookName(v.book);
            const key = `${canonicalBook.toLowerCase()}_${v.chapter}_${v.verse}`;
            this.fileVersesMap.set(key, v);

            const chKey = `${canonicalBook.toLowerCase()}_${v.chapter}`;
            let list = this.chapterVersesMap.get(chKey);
            if (!list) {
              list = [];
              this.chapterVersesMap.set(chKey, list);
            }
            list.push(v);
          }

          this.isLoaded = true;
          logger.info(`📖 [Scripture] Loaded ${verses.length} verses from data/bible_synodal.json`);
          return true;
        }
      }
    } catch (err) {
      logger.error('❌ [Scripture] Failed to load data/bible_synodal.json:', err);
    }
    return false;
  }

  // Rate-limited API fallback (1 req/s) with 30-day SQLite caching
  private async fetchFromApi(refQuery: string): Promise<string | null> {
    const cacheKey = refQuery.toLowerCase().trim();

    // 1. Check SQLite 30-day cache
    if (sqliteDb) {
      try {
        const row = sqliteDb.prepare("SELECT text, fetched_at FROM scripture_cache WHERE ref = ?").get(cacheKey) as any;
        if (row && row.text) {
          const ageDays = (Date.now() - Number(row.fetched_at)) / (1000 * 60 * 60 * 24);
          if (ageDays < 30) {
            return row.text;
          }
        }
      } catch (dbErr) {
        logger.warn('⚠️ [Scripture] Cache read error:', dbErr);
      }
    }

    // Rate limiter: wait if <1000ms since last request
    const now = Date.now();
    const elapsed = now - this.lastApiRequestTime;
    if (elapsed < 1000) {
      await new Promise(r => setTimeout(r, 1000 - elapsed));
    }
    this.lastApiRequestTime = Date.now();

    const translations = ['russian_synodal', 'russian'];
    for (const translation of translations) {
      try {
        const url = `https://bible-api.com/${encodeURIComponent(refQuery)}?translation=${translation}`;
        const res = await fetch(url, {
          signal: AbortSignal.timeout(8000),
          headers: { 'Accept': 'application/json' }
        });
        if (res.ok) {
          const data: any = await res.json();
          const text = (data?.text || '').trim();
          if (text) {
            // Save to cache
            if (sqliteDb) {
              try {
                sqliteDb.prepare("INSERT OR REPLACE INTO scripture_cache (ref, text, fetched_at) VALUES (?, ?, ?)")
                  .run(cacheKey, text, Date.now());
              } catch {}
            }
            return text;
          }
        }
      } catch (fetchErr: any) {
        logger.warn(`⚠️ [Scripture] API fallback request failed for ${refQuery} (${translation}):`, fetchErr?.message || fetchErr);
      }
    }

    return null;
  }

  /**
   * 1.3. getPassage(book, ch, verses?)
   */
  public async getPassage(
    book: string,
    chapter: number,
    verses?: number[] | string | { start: number; end?: number }
  ): Promise<ScriptureResult | null> {
    const canonicalBook = this.normalizeBookName(book);
    let verseList: number[] = [];

    if (verses) {
      if (Array.isArray(verses)) {
        verseList = verses;
      } else if (typeof verses === 'object' && verses.start) {
        const start = verses.start;
        const end = verses.end || start;
        for (let i = start; i <= end; i++) verseList.push(i);
      } else if (typeof verses === 'string') {
        const parts = verses.split(/[,-]/);
        if (verses.includes('-')) {
          const [start, end] = parts.map(p => parseInt(p.trim(), 10)).filter(n => !isNaN(n));
          if (start && end) {
            for (let i = start; i <= end; i++) verseList.push(i);
          }
        } else {
          verseList = parts.map(p => parseInt(p.trim(), 10)).filter(n => !isNaN(n));
        }
      }
    }

    const refStr = verseList.length > 0
      ? `${canonicalBook} ${chapter}:${verseList.join(',')}`
      : `${canonicalBook} ${chapter}`;

    // 1. Try Local File
    if (this.isLoaded) {
      const chKey = `${canonicalBook.toLowerCase()}_${chapter}`;
      const allChapterVerses = this.chapterVersesMap.get(chKey);

      if (allChapterVerses && allChapterVerses.length > 0) {
        let selected: ScriptureVerse[] = [];
        if (verseList.length > 0) {
          const set = new Set(verseList);
          selected = allChapterVerses.filter(v => set.has(v.verse));
        } else {
          selected = allChapterVerses;
        }

        if (selected.length > 0) {
          const text = selected.map(v => `${v.verse}. ${v.text}`).join(' ');
          logger.info(`📖 [Scripture] src=file ref=${refStr}`);
          return {
            text,
            ref: refStr,
            source: 'file',
            versesCount: selected.length
          };
        }
      }
    }

    // 2. Fallback to API
    const enBook = ENGLISH_BOOK_NAMES[canonicalBook] || canonicalBook;
    const apiRef = verseList.length > 0
      ? `${enBook}+${chapter}:${verseList.join(',')}`
      : `${enBook}+${chapter}`;

    const apiText = await this.fetchFromApi(apiRef);
    if (apiText) {
      logger.info(`📖 [Scripture] src=api ref=${refStr}`);
      return {
        text: apiText,
        ref: refStr,
        source: 'api'
      };
    }

    // 3. Unavailable -> log and return null (NEVER hallucinate!)
    logger.error(`❌ [Scripture] Source unavailable for ref=${refStr}`);
    return null;
  }

  /**
   * 1.3. getChapter(book, ch)
   */
  public async getChapter(book: string, chapter: number, maxVerses?: number): Promise<ScriptureResult | null> {
    const canonicalBook = this.normalizeBookName(book);
    const refStr = `${canonicalBook} ${chapter}`;

    if (this.isLoaded) {
      const chKey = `${canonicalBook.toLowerCase()}_${chapter}`;
      const all = this.chapterVersesMap.get(chKey);
      if (all && all.length > 0) {
        const slice = maxVerses ? all.slice(0, maxVerses) : all;
        const text = slice.map(v => `${v.verse}. ${v.text}`).join(' ');
        logger.info(`📖 [Scripture] src=file ref=${refStr}`);
        return {
          text,
          ref: refStr,
          source: 'file',
          versesCount: slice.length
        };
      }
    }

    const enBook = ENGLISH_BOOK_NAMES[canonicalBook] || canonicalBook;
    const apiRef = `${enBook}+${chapter}`;
    const apiText = await this.fetchFromApi(apiRef);
    if (apiText) {
      logger.info(`📖 [Scripture] src=api ref=${refStr}`);
      return {
        text: apiText,
        ref: refStr,
        source: 'api'
      };
    }

    logger.error(`❌ [Scripture] Source unavailable for chapter ${refStr}`);
    return null;
  }

  /**
   * 1.3. randomPsalm(chatId?) from [1,2,3,8,15,22,23,26,27,33,34,37,50,51,62,84,90,102,103,120,126,127,130,145,150]
   * Does not repeat for 3 consecutive days for the same user!
   */
  public async randomPsalm(chatId?: string | number): Promise<{ psalmNum: number; text: string; ref: string; source: 'file' | 'api' } | null> {
    const cleanId = chatId ? String(chatId).replace(/^[a-z_]+/, '') : 'default';
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());

    // 1. Get recent psalms (last 3 days)
    const recentPsalms: number[] = [];
    if (sqliteDb) {
      try {
        const rows = sqliteDb.prepare(
          "SELECT psalm_num FROM user_psalm_history WHERE chat_id = ? ORDER BY created_at DESC LIMIT 3"
        ).all(cleanId) as any[];
        for (const r of rows) {
          if (r.psalm_num) recentPsalms.push(Number(r.psalm_num));
        }
      } catch (err) {}
    }

    // Filter available psalms
    const pool = ALLOWED_PSALMS.filter(p => !recentPsalms.includes(p));
    const candidateList = pool.length > 0 ? pool : ALLOWED_PSALMS;

    // Pick pseudorandom or deterministic index
    const randomIndex = Math.floor(Math.random() * candidateList.length);
    const chosenPsalm = candidateList[randomIndex];

    // Fetch Psalm (first 3-5 verses or whole psalm)
    const passage = await this.getChapter('Псалтирь', chosenPsalm, 4);
    if (!passage) {
      // Fallback text if unavailable
      logger.error(`❌ [Scripture] Psalm ${chosenPsalm} not available`);
      return null;
    }

    // Record in user history
    if (sqliteDb) {
      try {
        sqliteDb.prepare(
          "INSERT OR REPLACE INTO user_psalm_history (chat_id, psalm_num, date_str, created_at) VALUES (?, ?, ?, ?)"
        ).run(cleanId, chosenPsalm, todayStr, Date.now());
      } catch {}
    }

    return {
      psalmNum: chosenPsalm,
      text: passage.text,
      ref: `Псалом ${chosenPsalm}`,
      source: passage.source
    };
  }
}

export const ScriptureService = new ScriptureServiceImpl();
export const scriptureService = ScriptureService;
