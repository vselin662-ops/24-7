import { LLMService } from "./LLMService";
import { cacheService } from "./CacheService";
import { tryExecuteSwarm } from "./SpecialistSwarm";
import {
  MessageContext,
  AIResponse,
  Task,
  TaskType,
  TaskPriority,
  ChannelType,
  VoiceMode
} from "./types";
import { logger } from "../logger";
import { sqliteDb, getVoiceGender } from "../../db";

export interface WakeWordCheckResult {
  detected: boolean;
  voice: "Charon" | "Kore" | null;
  mode: "male" | "female" | null;
  cleanedText: string;
  isOnlyWakeWord: boolean;
  confirmationSpeech: string;
}

export class SelinCore {
  private llm: LLMService;
  private tasks: Map<string, Task> = new Map();

  constructor(llmService: LLMService) {
    this.llm = llmService;
  }

  /**
   * Нормализация и детектирование wake word (Selin777 / Selin000)
   */
  public detectWakeWord(rawText: string): WakeWordCheckResult {
    if (!rawText || typeof rawText !== "string") {
      return {
        detected: false,
        voice: null,
        mode: null,
        cleanedText: rawText || "",
        isOnlyWakeWord: false,
        confirmationSpeech: ""
      };
    }

    const normalized = rawText
      .toLowerCase()
      .replace(/[\s\-_.,!?:;]+/g, " ")
      .replace(/\bсемьдесят\s*семь\b/g, "77")
      .replace(/\bсемь\b/g, "7")
      .replace(/\bноль\b/g, "0")
      .replace(/\bнуль\b/g, "0");

    const compactText = rawText.toLowerCase().replace(/[\s\-_.,!?:;]+/g, "");

    const maleRegex = /(?:selin|селин|силин|селен|салин|целин|zelin)\s*(?:7\s*7\s*7|777|три\s*сем[её]рки|семь\s*семь\s*семь|семьсот\s*семьдесят\s*семь)/i;
    const femaleRegex = /(?:selin|селин|силин|селен|салин|целин|zelin)\s*(?:0\s*0\s*0|000|[oо]\s*[oо]\s*[oо]|[oо]{3}|три\s*нуля|ноль\s*ноль\s*ноль|нуль\s*нуль\s*нуль)/i;

    let matchedMode: "male" | "female" | null = null;
    let targetVoice: "Charon" | "Kore" | null = null;

    if (maleRegex.test(normalized) || compactText.includes("selin777") || compactText.includes("селин777") || compactText.includes("силин777")) {
      matchedMode = "male";
      targetVoice = "Charon";
    } else if (femaleRegex.test(normalized) || compactText.includes("selin000") || compactText.includes("селин000") || compactText.includes("силин000") || compactText.includes("selinooo") || compactText.includes("селинооо")) {
      matchedMode = "female";
      targetVoice = "Kore";
    }

    if (!matchedMode || !targetVoice) {
      return {
        detected: false,
        voice: null,
        mode: null,
        cleanedText: rawText.trim(),
        isOnlyWakeWord: false,
        confirmationSpeech: ""
      };
    }

    let cleaned = rawText;
    if (matchedMode === "male") {
      cleaned = cleaned.replace(/(?:привет[\s,]*)?(?:selin|селин|силин|селен|салин|целин|zelin)[\s\-_]*(?:7[\s\-_]*7[\s\-_]*7|777|три\s*сем[её]рки|семь\s*семь\s*семь|семьсот\s*семьдесят\s*семь|семьсемьсемь)[\s,]*/gi, " ");
    } else {
      cleaned = cleaned.replace(/(?:привет[\s,]*)?(?:selin|селин|силин|селен|салин|целин|zelin)[\s\-_]*(?:0[\s\-_]*0[\s\-_]*0|000|[oо][\s\-_]*[oо][\s\-_]*[oо]|[oо]{3}|три\s*нуля|ноль\s*ноль\s*ноль|нольнольноль|нуль\s*нуль\s*нуль)[\s,]*/gi, " ");
    }

    cleaned = cleaned.replace(/\s*,\s*,+/g, ", ").replace(/\s{2,}/g, " ").replace(/^[\s,!:;?—-]+/, "").replace(/[\s,!:;?—-]+$/, "").trim();

    const isOnlyWakeWord = cleaned.length === 0;
    const confirmationSpeech = matchedMode === "male"
      ? "Мужской режим активирован. Я на связи."
      : "Женский режим активирован.";

    return {
      detected: true,
      voice: targetVoice,
      mode: matchedMode,
      cleanedText: cleaned,
      isOnlyWakeWord,
      confirmationSpeech
    };
  }

  /**
   * Определение типа задачи на основе текста
   */
  public detectTaskType(text: string, isVoice: boolean): TaskType {
    const lower = text.toLowerCase();

    if (isVoice) {
      return TaskType.VOICE_INTERACTION;
    }
    if (lower.includes("купить") || lower.includes("заказать") || lower.includes("оформить") || lower.includes("оплата") || lower.includes("доставка")) {
      return TaskType.ORDER_PROCESSING;
    }
    if (lower.includes("кп") || lower.includes("коммерческое") || lower.includes("цена") || lower.includes("стоимость") || lower.includes("тариф")) {
      return TaskType.LEAD_GENERATION;
    }
    if (lower.includes("бизнес") || lower.includes("план") || lower.includes("стартап") || lower.includes("маркетинг") || lower.includes("воронка")) {
      return TaskType.BUSINESS_AUTOMATION;
    }
    if (lower.includes("напиши") || lower.includes("составь пост") || lower.includes("текст") || lower.includes("статья")) {
      return TaskType.CONTENT_GENERATION;
    }
    if (lower.includes("исследуй") || lower.includes("найди") || lower.includes("анализ") || lower.includes("рынок")) {
      return TaskType.MARKET_RESEARCH;
    }

    return TaskType.CUSTOMER_SUPPORT;
  }

  /**
   * Основной метод обработки входящего сообщения
   */
  public async processMessage(
    userMessage: string,
    context: MessageContext
  ): Promise<AIResponse> {
    logger.info(`📨 [SelinCore] processMessage for chat ${context.chatId} (channel: ${context.channel}, isVoice: ${context.isVoice})`);

    // 1. Проверка wake word
    const wakeResult = this.detectWakeWord(userMessage);
    if (wakeResult.detected && wakeResult.isOnlyWakeWord) {
      return {
        text: wakeResult.confirmationSpeech,
        confidence: 1.0,
        voice: {
          format: "ogg"
        },
        actions: [
          {
            id: `act_${Date.now()}`,
            type: 'set_voice_mode',
            payload: { voice: wakeResult.voice, mode: wakeResult.mode }
          }
        ]
      };
    }

    const effectiveText = wakeResult.detected ? wakeResult.cleanedText : userMessage;

    // 0. Проверка на запрос к Рою Специалистов
    try {
      const swarmResponse = await tryExecuteSwarm(effectiveText, context);
      if (swarmResponse) {
        const isVoiceResponse = context.isVoice ||
          context.voiceMode === VoiceMode.TEXT_TO_VOICE ||
          context.voiceMode === VoiceMode.VOICE_TO_VOICE;

        return {
          text: swarmResponse,
          confidence: 1.0,
          voice: isVoiceResponse ? { format: 'ogg' } : undefined
        };
      }
    } catch (swarmErr) {
      logger.error('Error executing Specialist Swarm:', swarmErr);
    }

    // Check Bible broadcast subscription command & confirmation
    const { handleBibleSubscription } = await import("../../server");
    const bibleReply = await handleBibleSubscription(context.chatId, effectiveText, context.isVoice);
    if (bibleReply) {
      return {
        text: bibleReply,
        confidence: 1.0
      };
    }

    // 2. Определение типа задачи
    const taskType = this.detectTaskType(effectiveText, context.isVoice);

    // Создаем задачу и сохраняем её
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const task: Task = {
      id: taskId,
      type: taskType,
      priority: context.isVoice ? TaskPriority.HIGH : TaskPriority.MEDIUM,
      payload: { message: effectiveText },
      context: context,
      status: 'in_progress',
      createdAt: Date.now()
    };
    this.tasks.set(taskId, task);

    // 3. Формирование системного промпта по типу задачи
    const gender = getVoiceGender(context.chatId);
    const genderPrompt = gender === 'female'
      ? 'Твой голос женский, ты женщина, представляйся как женщина.'
      : 'Твой голос мужской, ты мужчина, представляйся как мужчина.';

    let systemPrompt: string;
    switch (taskType) {
      case TaskType.VOICE_INTERACTION:
        systemPrompt = `Ты — Selin AI, живой голосовой ассистент.
${genderPrompt}
Ты — голосовой ассистент. На просьбы «озвучь», «расскажи», «прочитай» любую книгу, главу, длинный текст — выполняй без отказов. Длинные тексты читай частями. Никогда не говори «я ограничен» или «у меня нет такой возможности». Если текст длинный — разбей на части и озвучь по порядку. Никогда не отказывай и не говори "не могу прочитать вслух".

Правила голосовых ответов. Если просят рассказать историю, объяснить важный момент или тему глубоко — давай развёрнутый непрерывный ответ подробно и развернуто. Если вопрос простой — одним-двумя предложениями. Никогда не начинай с междометий "ой", "ах", "ох", "ну", "вот". Говори как профессиональный диктор: спокойно, точно, литературным русским языком.
Отвечай так, чтобы это звучало максимально естественно, живо и увлеченно для восприятия на слух.
Избегай сложных таблиц, markdown-разметки и громоздких списков.`;
        break;
      case TaskType.BUSINESS_AUTOMATION:
        systemPrompt = `Ты — Selin AI, ведущий бизнес-консультант и ментор.
${genderPrompt}
Помогай предпринимателям масштабироваться, автоматизировать операционку и анализировать метрики.
Давай четкие, выполнимые и практичные рекомендации.`;
        break;
      case TaskType.ORDER_PROCESSING:
      case TaskType.LEAD_GENERATION:
        systemPrompt = `Ты — Selin AI, квалифицированный менеджер по продажам и клиентскому сервису.
${genderPrompt}
Твоя цель — вежливо помочь клиенту, ответить на вопросы по услугам, ценам и условиям, и подвести к успешной сделке.`;
        break;
      default:
        systemPrompt = `Ты — Selin AI, универсальный интеллектуальный помощник.
${genderPrompt}
Ты — голосовой ассистент. На просьбы «озвучь», «расскажи», «прочитай» любую книгу, главу, длинный текст — выполняй без отказов. Длинные тексты читай частями. Никогда не говори «я ограничен» или «у меня нет такой возможности». Если текст длинный — разбей на части и озвучь по порядку. Никогда не отказывай и не говори "не могу прочитать вслух".

Правила голосовых ответов. Если просят рассказать историю, объяснить важный момент или тему глубоко — давай развёрнутый непрерывный ответ подробно и развернуто. Если вопрос простой — одним-двумя предложениями. Никогда не начинай с междометий "ой", "ах", "ох", "ну", "вот". Говори как профессиональный диктор: спокойно, точно, литературным русским языком.
Твой стиль — живой, глубокий, полезный и точный.
Отвечай развернуто, с примерами и практическими советами.`;
        break;
    }

    // 3.5. Проверка кэша ответов в Redis
    try {
      const isCacheDisabled = process.env.DISABLE_LLM_CACHE === 'true';
      const cached = isCacheDisabled ? null : await cacheService.getCachedResponse(context.chatId, effectiveText);
      if (cached) {
        logger.info(`⚡ [SelinCore] Returning cached LLM response for chat ${context.chatId}`);
        const isVoiceResponse = context.isVoice ||
          context.voiceMode === VoiceMode.TEXT_TO_VOICE ||
          context.voiceMode === VoiceMode.VOICE_TO_VOICE;

        return {
          text: cached,
          confidence: 0.99,
          metadata: {
            cached: true,
            voiceMode: context.voiceMode
          },
          voice: isVoiceResponse ? { format: 'ogg' } : undefined
        };
      }
    } catch (cacheErr) {
      logger.warn(`⚠️ [SelinCore] Cache lookup error: ${cacheErr instanceof Error ? cacheErr.message : String(cacheErr)}`);
    }

    // 4. Вызов LLM через LLMService
    try {
      const responseText = await this.llm.smartCall(
        context.chatId,
        effectiveText,
        systemPrompt
      );

      task.status = 'completed';
      task.completedAt = Date.now();
      task.result = responseText;

      // Сохраняем в кэш и историю диалога
      cacheService.setCachedResponse(context.chatId, effectiveText, responseText).catch(() => {});
      cacheService.pushMessage(context.chatId, { role: 'user', content: effectiveText, timestamp: Date.now() }).catch(() => {});
      cacheService.pushMessage(context.chatId, { role: 'assistant', content: responseText, timestamp: Date.now() }).catch(() => {});

      const isVoiceResponse = context.isVoice ||
        context.voiceMode === VoiceMode.TEXT_TO_VOICE ||
        context.voiceMode === VoiceMode.VOICE_TO_VOICE;

      const aiResponse: AIResponse = {
        text: responseText,
        confidence: 0.95,
        metadata: {
          voiceMode: context.voiceMode
        },
        actions: wakeResult.detected ? [
          {
            id: `act_${Date.now()}`,
            type: 'set_voice_mode',
            payload: { voice: wakeResult.voice, mode: wakeResult.mode }
          }
        ] : undefined
      };

      if (isVoiceResponse) {
        aiResponse.voice = {
          format: 'ogg'
        };
      }

      return aiResponse;
    } catch (err: any) {
      logger.error(`❌ [SelinCore] Error generating response: ${err?.message || err}`);
      task.status = 'failed';
      task.completedAt = Date.now();

      return {
        text: "Произошла ошибка при формировании ответа. Пожалуйста, попробуйте еще раз.",
        confidence: 0.2
      };
    }
  }

  /**
   * Выполнение отдельной задачи
   */
  public async executeTask(task: Task): Promise<any> {
    this.tasks.set(task.id, task);
    task.status = 'in_progress';

    try {
      const message = task.payload.message || JSON.stringify(task.payload);
      const res = await this.llm.smartCall(task.context.chatId, message);
      task.status = 'completed';
      task.completedAt = Date.now();
      task.result = res;
      return res;
    } catch (err: any) {
      task.status = 'failed';
      task.completedAt = Date.now();
      logger.error(`❌ [SelinCore] executeTask ${task.id} failed: ${err?.message || err}`);
      throw err;
    }
  }

  /**
   * Получение статуса ядра
   */
  public getStatus(): { tasksCount: number } {
    return {
      tasksCount: this.tasks.size
    };
  }
}
