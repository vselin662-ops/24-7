import { bibleLocalVerses } from "../data/bibleLocal";
import { getUserPlanDay } from "./OneYearPlan";
import { llmService } from "../core/LLMService";
import { sanitizeForTTS, cleanForMax } from "../utils/textUtils";
import { logger } from "../logger";

export interface SlotContent {
  text: string;
  voiceText: string;
}

/**
 * Офлайн-определение темы стиха по ключевым словам для красивого шаблона
 */
function getTheme(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('любов') || lower.includes('любви') || lower.includes('возлюб')) return 'любви и милосердии Божием';
  if (lower.includes('страх') || lower.includes('боя') || lower.includes('ужас')) return 'преодолении страха и надежде';
  if (lower.includes('путь') || lower.includes('идти') || lower.includes('стезе')) return 'жизненном пути и водительстве Господа';
  if (lower.includes('вер') || lower.includes('веру') || lower.includes('упова')) return 'силе веры и верности Бога';
  if (lower.includes('мир') || lower.includes('поко') || lower.includes('успок')) return 'душевном мире и Божьем покое';
  if (lower.includes('мудрост') || lower.includes('разум') || lower.includes('позна')) return 'Божественной мудрости и разуме';
  if (lower.includes('крепост') || lower.includes('сил') || lower.includes('укреп')) return 'Божьей силе и укреплении духа';
  if (lower.includes('пастырь') || lower.includes('нужд')) return 'заботе Господа о Своих детях';
  return 'уповании на Господа и Его великой благодати';
}

/**
 * Безопасный вызов LLM с таймаутом в 10 секунд
 */
async function callLLMWithTimeout(
  chatId: string,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('LLM timeout (10s)')), 10000)
  );

  const apiPromise = llmService.smartCall(
    `plan_build_${chatId}_${Date.now()}`,
    userPrompt,
    systemPrompt
  );

  return Promise.race([apiPromise, timeoutPromise]);
}

/**
 * Сборщик контента для Плана Победы (ШАГ 2)
 */
export async function buildSlotContent(
  chatId: string,
  slot: 'morning' | 'noon' | 'evening' | 'm' | 'n' | 'e'
): Promise<SlotContent> {
  const normSlot = slot === 'm' ? 'morning' : slot === 'n' ? 'noon' : slot === 'e' ? 'evening' : slot;
  const dayNum = getUserPlanDay(chatId);

  logger.info(`📋 [PlanContentBuilder] Сборка контента для ${chatId}, слот ${normSlot}, день ${dayNum}`);

  if (normSlot === 'morning') {
    const morningVerses = bibleLocalVerses.filter(v => v.slot === 'morning');
    const verse = morningVerses[(dayNum - 1) % morningVerses.length];

    let analysis = '';
    let motivation = '';

    try {
      const systemPrompt = "Ты — духовный наставник. Отвечай на русском языке строго по структуре.";
      const userPrompt = `Дай краткий духовный разбор и практическую мотивацию для этого стиха Ветхого Завета (${verse.reference}):\n«${verse.text}»\n\nТребования:\n1. РАЗБОР: ровно 2-3 предложения духовного осмысления стиха.\n2. МОТИВАЦИЯ: одно конкретное практическое действие на сегодня.\n\nФормат ответа:\nРазбор: <текст>\nМотивация: <текст>`;
      
      const raw = await callLLMWithTimeout(chatId, systemPrompt, userPrompt);
      const matches = raw.match(/Разбор:\s*([\s\S]*?)\s*Мотивация:\s*([\s\S]*)/i);
      if (matches) {
        analysis = matches[1].trim();
        motivation = matches[2].trim();
      } else {
        const parts = raw.split(/Мотивация:/i);
        analysis = parts[0].replace(/Разбор:/i, '').trim();
        motivation = parts[1]?.trim() || '';
      }
    } catch (err: any) {
      logger.warn(`⚠️ [PlanContentBuilder] Ошибка LLM для утра (${err.message || err}). Применяем офлайн-шаблон.`);
    }

    if (!analysis || !motivation) {
      const theme = getTheme(verse.text);
      analysis = `Это слово говорит о ${theme}. Пусть оно ведёт тебя сегодня: живи с миром в сердце и верой в Господа.`;
      motivation = `Проявите сегодня терпение и внимание к близкому человеку, поддержите его добрым словом.`;
    }

    const text = `🕊 **План Победы**\n🌅 **Утреннее чтение (День ${dayNum}/365)**\n📖 **${verse.reference}**\n\n«${verse.text}»\n\n💭 **Разбор**:\n${analysis}\n\n💪 **Мотивация**:\n${motivation}`;
    const voiceText = sanitizeForTTS(cleanForMax(text));

    return { text, voiceText };

  } else if (normSlot === 'noon') {
    const noonVerses = bibleLocalVerses.filter(v => v.slot === 'noon');
    const verse = noonVerses[(dayNum - 1) % noonVerses.length];

    let analysis = '';
    let motivation = '';

    try {
      const systemPrompt = "Ты — духовный наставник. Отвечай на русском языке строго по структуре.";
      const userPrompt = `Дай краткий духовный разбор и практическую мотивацию для этого стиха Евангелия (${verse.reference}):\n«${verse.text}»\n\nТребования:\n1. РАЗБОР: ровно 2-3 предложения духовного осмысления стиха.\n2. МОТИВАЦИЯ: одно конкретное практическое действие на сегодня.\n\nФормат ответа:\nРазбор: <текст>\nМотивация: <текст>`;
      
      const raw = await callLLMWithTimeout(chatId, systemPrompt, userPrompt);
      const matches = raw.match(/Разбор:\s*([\s\S]*?)\s*Мотивация:\s*([\s\S]*)/i);
      if (matches) {
        analysis = matches[1].trim();
        motivation = matches[2].trim();
      } else {
        const parts = raw.split(/Мотивация:/i);
        analysis = parts[0].replace(/Разбор:/i, '').trim();
        motivation = parts[1]?.trim() || '';
      }
    } catch (err: any) {
      logger.warn(`⚠️ [PlanContentBuilder] Ошибка LLM для обеда (${err.message || err}). Применяем офлайн-шаблон.`);
    }

    if (!analysis || !motivation) {
      const theme = getTheme(verse.text);
      analysis = `Это слово говорит о ${theme}. Пусть оно ведёт тебя сегодня: живи с миром в сердце и верой в Господа.`;
      motivation = `Посвятите 5 минут в середине дня тихой благодарственной молитве и доверьте все заботы Богу.`;
    }

    const text = `🕊 **План Победы**\n🌞 **Дневное чтение (День ${dayNum}/365)**\n📖 **${verse.reference}**\n\n«${verse.text}»\n\n💭 **Разбор**:\n${analysis}\n\n💪 **Мотивация**:\n${motivation}`;
    const voiceText = sanitizeForTTS(cleanForMax(text));

    return { text, voiceText };

  } else {
    // Evening slot: Psalm + Proverb + Prayer
    const eveningVerses = bibleLocalVerses.filter(v => v.slot === 'evening');
    const psalms = eveningVerses.filter(v => v.reference.toLowerCase().includes('псал'));
    const proverbs = eveningVerses.filter(v => v.reference.toLowerCase().includes('притч'));

    const psalm = psalms[(dayNum - 1) % psalms.length] || eveningVerses[0];
    const proverb = proverbs[(dayNum - 1) % proverbs.length] || eveningVerses[1];

    let analysis = '';
    let prayer = '';

    try {
      const systemPrompt = "Ты — духовный наставник. Отвечай на русском языке строго по структуре.";
      const userPrompt = `Дай краткий духовный разбор и вечернюю молитву на основе этих стихов (${psalm.reference} и ${proverb.reference}):\n1. «${psalm.text}»\n2. «${proverb.text}»\n\nТребования:\n1. РАЗБОР: ровно 2-3 предложения духовного осмысления этих стихов.\n2. МОЛИТВА: краткая, искренняя молитва благодарения Богу на сон грядущим.\n\nФормат ответа:\nРазбор: <текст>\nМолитва: <текст>`;
      
      const raw = await callLLMWithTimeout(chatId, systemPrompt, userPrompt);
      const matches = raw.match(/Разбор:\s*([\s\S]*?)\s*Молитва:\s*([\s\S]*)/i);
      if (matches) {
        analysis = matches[1].trim();
        prayer = matches[2].trim();
      } else {
        const parts = raw.split(/Молитва:/i);
        analysis = parts[0].replace(/Разбор:/i, '').trim();
        prayer = parts[1]?.trim() || '';
      }
    } catch (err: any) {
      logger.warn(`⚠️ [PlanContentBuilder] Ошибка LLM для вечера (${err.message || err}). Применяем офлайн-шаблон.`);
    }

    if (!analysis || !prayer) {
      const theme = getTheme(psalm.text + " " + proverb.text);
      analysis = `Это слово говорит о ${theme}. Пусть оно ведёт тебя сегодня: живи с миром в сердце и верой в Господа.`;
      prayer = `Господи, благодарю Тебя за этот день, за Твою милость и защиту. Прости мои согрешения и даруй мне мирный сон под Твоим кровом. Аминь.`;
    }

    const text = `🕊 **План Победы**\n🌙 **Вечернее чтение (День ${dayNum}/365)**\n📖 **${psalm.reference} & ${proverb.reference}**\n\n«${psalm.text}»\n\n«${proverb.text}»\n\n💭 **Разбор**:\n${analysis}\n\n🙏 **Молитва**:\n${prayer}`;
    const voiceText = sanitizeForTTS(cleanForMax(text));

    return { text, voiceText };
  }
}
