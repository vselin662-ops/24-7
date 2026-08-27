// src/adapters/MaxAdapter.ts
import { Bot } from "@maxhub/max-bot-api";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { SelinCore } from "../core/SelinCore";
import { AIResponse, MessageContext, ChannelType, VoiceMode } from "../core/types";
import { logger } from "../logger";
import { VoiceService } from "../services/VoiceService";
import { synthesizeForChat } from "../services/TTSService";
import { ensureMp3Buffer } from "../lib/audioConvert";
import { callVision, stripMarkdown } from "../core/LLMService";
import { sqliteDb, getVoiceConfig, setVoiceGender } from "../../db";

const processedMessages = new Map<string, number>();
const MESSAGE_TTL = 10 * 60 * 1000; // 10 минут
const MAX_TEXT_LIMIT = 8000;

export function getImageMimeType(buf: Buffer, contentTypeHeader?: string | null): string {
  if (contentTypeHeader && contentTypeHeader.startsWith('image/')) {
    const clean = contentTypeHeader.split(';')[0].trim().toLowerCase();
    if (clean) return clean;
  }
  if (buf.length >= 4) {
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
      return 'image/png';
    }
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
      return 'image/jpeg';
    }
    if (buf.slice(0, 4).toString() === 'RIFF' && buf.length >= 12 && buf.slice(8, 12).toString() === 'WEBP') {
      return 'image/webp';
    }
    if (buf.slice(0, 3).toString() === 'GIF') {
      return 'image/gif';
    }
  }
  return 'image/jpeg';
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

export { numberToWords, cardinal, ordinalM, ordinalF, ordinalGenM, ordinalPrepM, yearToSpeech, числительное, normalizeBiblicalReferences, normalizeYears, normalizeTimeOfDay, normalizeHours12 } from "../utils/voiceNormalizer";
import { normalizeForVoice as normalizeVoiceUtil } from "../utils/voiceNormalizer";

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

export function splitTextSmart(text: string, maxLen: number): string[] {
  const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || [text];
  const chunks: string[] = [];
  let current = '';
  for (const s of sentences) {
    if ((current + s).length > maxLen && current) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.map(c => c.length > maxLen ? c.substring(0, maxLen) : c);
}

export class MaxAdapter {
  private bot: Bot | null = null;
  private core: SelinCore;
  private token: string | undefined;
  private voiceService: VoiceService;
  private voiceModes: Map<string, VoiceMode> = new Map();
  private defaultVoiceMode: VoiceMode = VoiceMode.TEXT_TO_TEXT;

  constructor(core: SelinCore, token?: string, defaultMode: VoiceMode = VoiceMode.TEXT_TO_TEXT) {
    this.core = core;
    this.token = token || process.env.MAX_BOT_TOKEN;
    this.voiceService = new VoiceService();
    this.defaultVoiceMode = defaultMode;
    console.log('🔓 [Unblock] удалено запретов=4 лимит поднят до 8000');
  }

  /**
   * Установка режима работы с голосом для чата
   */
  public setVoiceMode(chatId: string | number, mode: VoiceMode): void {
    const cleanId = String(chatId).replace(/^[a-z_]+/, '');
    this.voiceModes.set(cleanId, mode);
    logger.info(`🔄 [MaxAdapter] Voice mode for chat ${cleanId} set to "${mode}"`);
  }

  /**
   * Получение текущего режима работы с голосом для чата
   */
  public getVoiceMode(chatId: string | number): VoiceMode {
    const cleanId = String(chatId).replace(/^[a-z_]+/, '');
    return this.voiceModes.get(cleanId) || this.defaultVoiceMode;
  }

  /**
   * Установка глобального режима по умолчанию
   */
  public setDefaultVoiceMode(mode: VoiceMode): void {
    this.defaultVoiceMode = mode;
    logger.info(`🔄 [MaxAdapter] Default voice mode set to "${mode}"`);
  }

  /**
   * Подключение к MAX API
   */
  public async connect(): Promise<void> {
    const tokenToUse = this.token || process.env.MAX_BOT_TOKEN;
    if (!tokenToUse) {
      logger.warn("⚠️ [MaxAdapter] MAX_BOT_TOKEN is missing. MaxAdapter will run in mock/unconnected mode.");
      return;
    }

    try {
      this.bot = new Bot(tokenToUse);
      logger.info("✅ [MaxAdapter] Connected to MAX Messenger API successfully.");
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`❌ [MaxAdapter] Failed to initialize MAX Bot: ${errorMsg}`);
    }
  }

  /**
   * Очистка и нормализация текста перед синтезом голоса
   */
  public cleanText(text: string): string {
    return normalizeForVoice(text);
  }

  /**
   * Безопасная отправка текстового сообщения в чат MAX
   */
  public async safeSendMessageToChat(
    chatId: number | string,
    text?: string | null,
    extra?: Record<string, unknown>
  ): Promise<unknown> {
    if (text) text = cleanForMax(text);
    if (!this.bot) {
      logger.warn("⚠️ [MaxAdapter] Cannot send message: bot instance is not connected.");
      return null;
    }

    const cleanIdStr = String(chatId).replace(/^[a-z_]+/, '');
    const numericId = parseInt(cleanIdStr, 10);
    if (isNaN(numericId) || numericId <= 0) {
      logger.error("❌ [MaxAdapter] Invalid numericId for safeSendMessageToChat", { raw: chatId, parsed: numericId });
      return null;
    }

    if (!text || text.trim() === '') {
      if (extra) {
        try {
          return await this.bot.api.sendMessageToChat(numericId, undefined as any, extra);
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          logger.error("❌ [MaxAdapter] Max send failed in safeSendMessageToChat", { chatId: numericId, message: errorMsg });
          return null;
        }
      }
      return null;
    }

    const trimmedText = text.trim();

    if (trimmedText.length > MAX_TEXT_LIMIT) {
      const chunks = splitTextSmart(trimmedText, MAX_TEXT_LIMIT);
      console.log('✂️ [MAX] длина ' + trimmedText.length + ', частей ' + chunks.length);
      let lastMsg: unknown = null;
      for (const chunk of chunks) {
        try {
          lastMsg = await this.bot.api.sendMessageToChat(numericId, chunk as any, extra);
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          logger.error("❌ [MaxAdapter] Max send failed in safeSendMessageToChat", {
            chatId: numericId,
            message: errorMsg
          });
        }
        await new Promise(r => setTimeout(r, 600));
      }
      return lastMsg;
    }

    try {
      const message = await this.bot.api.sendMessageToChat(numericId, trimmedText as any, extra);
      logger.info(`✅ [MaxAdapter] Message successfully sent to Max chat ${numericId}`);
      return message;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("❌ [MaxAdapter] Max send failed in safeSendMessageToChat", {
        chatId: numericId,
        message: errorMsg
      });

      // Fallback: попытаться отправить обычный текст если была отправка с вложениями
      if (extra && trimmedText) {
        try {
          return await this.bot.api.sendMessageToChat(numericId, trimmedText);
        } catch (fallbackErr: unknown) {
          const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          logger.error(`❌ [MaxAdapter] Fallback plain-text send failed: ${fbMsg}`);
        }
      }

      return null;
    }
  }

  /**
   * Вспомогательный метод отправки одного буфера аудио в MAX Storage
   */
  private async sendSingleAudioBuffer(numericId: number, audioBuffer: Buffer): Promise<boolean> {
    if (!audioBuffer || audioBuffer.length === 0 || !this.bot) return false;
    try {
      const mp3Buffer = await ensureMp3Buffer(audioBuffer);
      const maxToken = this.token || process.env.MAX_BOT_TOKEN;
      const initRes = await fetch('https://platform-api.max.ru/uploads?type=audio', {
        method: 'POST',
        headers: { 'Authorization': maxToken || '' },
        signal: AbortSignal.timeout(15000)
      });

      if (initRes.ok) {
        const initData: any = await initRes.json();
        const uploadToken = initData?.token;
        const uploadUrl = initData?.url;

        if (uploadToken && uploadUrl) {
          const form = new FormData();
          const fileBlob = new Blob([mp3Buffer], { type: 'audio/mpeg' });
          form.append('data', fileBlob, 'voice.mp3');

          const uploadRes = await fetch(uploadUrl, {
            method: 'POST',
            body: form,
            signal: AbortSignal.timeout(20000)
          });

          if (uploadRes.ok) {
            await new Promise(resolve => setTimeout(resolve, 1500));
            await this.bot.api.sendMessageToChat(numericId, '', {
              attachments: [{
                type: 'audio',
                payload: {
                  token: uploadToken,
                  filename: 'voice.mp3'
                }
              }] as any
            });
            logger.info(`🎤 [MaxAdapter] Voice message chunk successfully sent to chat ${numericId}`);
            return true;
          } else {
            logger.warn(`⚠️ [MaxAdapter] Upload to MAX storage failed with status ${uploadRes.status}`);
          }
        }
      } else {
        logger.warn(`⚠️ [MaxAdapter] Failed to init MAX storage upload: ${initRes.status}`);
      }
    } catch (err: any) {
      logger.error(`❌ [MaxAdapter] sendSingleAudioBuffer error: ${err.message || err}`);
    }
    return false;
  }

  /**
   * Синтез и отправка голосового сообщения (MP3) в чат MAX
   * 1. Очистка текста через cleanText (до 500 символов)
   * 2. Каскад TTS: OpenAI TTS -> Edge TTS -> VoiceService
   * 3. Загрузка в MAX Storage (POST https://platform-api.max.ru/uploads?type=audio)
   * 4. Отправка вложения { type: 'audio', payload: { token } }
   * 5. Фолбэк на текст при ошибках
   */
  public async synthesizeAndSendVoice(chatId: string | number, text: string): Promise<void> {
    const cleanIdStr = String(chatId).replace(/^[a-z_]+/, '');
    const numericId = parseInt(cleanIdStr.replace(/\D/g, ''), 10);

    if (isNaN(numericId) || numericId <= 0) {
      logger.error("❌ [MaxAdapter] Invalid chatId for voice synthesis", { chatId });
      return;
    }

    // 1. Очистка текста
    const cleanedText = this.cleanText(text);
    if (!cleanedText) {
      logger.warn("⚠️ [MaxAdapter] synthesizeAndSendVoice: text is empty after cleaning.");
      return;
    }

    // 2. Логика озвучки длинного текста:
    let chunks: string[] = [];
    if (cleanedText.length <= 800) {
      chunks = [cleanedText];
    } else {
      chunks = splitTextSmart(cleanedText, 1400).slice(0, 4);
    }
    chunks = chunks.filter(c => c && c.trim().length >= 10);
    console.log('🎙️ [TTS] символов=' + cleanedText.length + ' чанков=' + chunks.length);

    let sentAtLeastOne = false;
    for (const chunk of chunks) {
      try {
        const audioBuffer = await synthesizeForChat(chatId, chunk);
        const success = await this.sendSingleAudioBuffer(numericId, audioBuffer);
        if (success) {
          sentAtLeastOne = true;
        }
      } catch (err: any) {
        logger.error(`❌ [MaxAdapter] Failed to send chunk voice: ${err.message || err}`);
      }
    }

    // - если это глава книги -> озвучить главу полностью по чанкам + в конце текстом: "Хотите следующую главу? Напишите: далее".
    const isBookChapter = 
      text.toLowerCase().includes('глава') || 
      text.toLowerCase().includes('ион') || 
      text.toLowerCase().includes('книг') ||
      /глава\s+\d+/i.test(text);

    if (isBookChapter) {
      const nextChapterMsg = "Хотите следующую главу? Напишите: далее";
      await this.safeSendMessageToChat(chatId, nextChapterMsg);
    }

    if (!sentAtLeastOne) {
      logger.warn(`⚠️ [MaxAdapter] Voice cascade completed without audio delivery, falling back to text for chat ${numericId}`);
      await this.safeSendMessageToChat(numericId, cleanedText);
    }
  }

  /**
   * Скачивание аудиофайла из MAX по прямому URL
   */
  private async downloadAudio(fileUrl: string): Promise<Buffer> {
    const url = (fileUrl || '').trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new Error(`Нужна прямая ссылка payload.url, а не токен (получено: "${url}")`);
    }

    logger.info(`⬇️ [MaxAdapter] Скачивание аудио по прямой ссылке: ${url.substring(0, 80)}...`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'audio/*, application/octet-stream'
      },
      signal: AbortSignal.timeout(20000)
    });

    logger.info(`📊 [MaxAdapter] Ответ скачивания: HTTP ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'No error body');
      throw new Error(`Failed to download audio (HTTP ${response.status}): ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      throw new Error('Downloaded audio is empty');
    }

    logger.info(`✅ [MaxAdapter] Аудио успешно скачано: ${buffer.length} байт`);
    return buffer;
  }

  /**
   * Распознавание речи через Groq Whisper (whisper-large-v3, ru)
   */
  public async transcribeAudio(audioBuffer: Buffer): Promise<string> {
    const key = process.env.GROQ_API_KEY;
    if (key) {
      try {
        const form = new FormData();
        const fileBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });
        form.append('file', fileBlob, 'voice.mp3');
        form.append('model', 'whisper-large-v3');
        form.append('language', 'ru');

        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${key}` },
          body: form,
          signal: AbortSignal.timeout(25000)
        });

        if (response.ok) {
          const data = await response.json();
          let recognized = (data?.text || '').trim();
          const lower = recognized.toLowerCase();
          if (
            lower.includes('dimatorzok') ||
            lower.includes('дима торжок') ||
            lower.includes('субтитры') ||
            lower.includes('субтитрами') ||
            lower.includes('создал субтитры') ||
            lower.includes('редактор субтитров') ||
            lower.includes('продолжение следует') ||
            lower.includes('спасибо за просмотр')
          ) {
            logger.warn(`⚠️ [MaxAdapter] Filtered Whisper hallucination: "${recognized}"`);
            recognized = '';
          }
          return recognized;
        } else {
          logger.warn(`⚠️ [MaxAdapter] Groq Whisper returned status ${response.status}`);
        }
      } catch (groqErr: unknown) {
        const errorMsg = groqErr instanceof Error ? groqErr.message : String(groqErr);
        logger.warn(`⚠️ [MaxAdapter] Groq Whisper failed, trying VoiceService: ${errorMsg}`);
      }
    } else {
      logger.warn('⚠️ [MaxAdapter] GROQ_API_KEY is not set, falling back to VoiceService');
    }

    // Fallback на VoiceService STT
    try {
      const text = await this.voiceService.transcribe(audioBuffer, 'ru');
      return text.trim();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`❌ [MaxAdapter] VoiceService transcribe failed: ${errorMsg}`);
      return '';
    }
  }

  /**
   * Отправка ответа пользователю (голосом или текстом)
   */
  public async sendMessage(chatId: string | number, response: AIResponse | string, isVoiceInput: boolean = false): Promise<void> {
    const cleanId = String(chatId).replace(/^[a-z_]+/, '');
    const text = typeof response === 'string' ? response : response.text;

    // Если пришло голосовое или ключевое слово для голоса → отвечаем голосом
    if (isVoiceInput) {
      try {
        await this.synthesizeAndSendVoice(cleanId, text);
        logger.info(`🎤 [MaxAdapter] Voice reply sent to chat ${cleanId}`);
        return;
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.warn(`⚠️ [MaxAdapter] Voice delivery failed, sending text fallback: ${errorMsg}`);
      }
    }

    // Если текст → отправляем текст (по умолчанию)
    await this.safeSendMessageToChat(cleanId, text);
  }

  public async sendVoice(chatId: string | number, text: string): Promise<void> {
    const cleanId = String(chatId).replace(/^[a-z_]+/, '');
    await this.synthesizeAndSendVoice(cleanId, text);
  }

  public async sendWelcomeGreeting(cleanId: string): Promise<void> {
    const welcomeText = 'Приветствую вас! Рад видеть вас у себя. Я — Selin AI, ваш личный помощник. Я озвучиваю книги и Библию, нахожу свежие новости, цены и погоду в интернете, помогаю с бизнесом и планами, понимаю фото и голос. Спрашивайте о чём угодно!';
    const extra = {
      attachments: [
        {
          type: 'inline_keyboard',
          payload: {
            buttons: [
              [
                { text: '🚀 Настроить', callback_data: 'onboarding_start' },
                { text: '⏭ Позже', callback_data: 'onboarding_later' }
              ]
            ]
          }
        }
      ]
    };
    await this.safeSendMessageToChat(cleanId, welcomeText, extra);
    (async () => {
      try {
        const audioBuffer = await synthesizeForChat(cleanId, welcomeText);
        const numericId = parseInt(cleanId.replace(/\D/g, ''), 10);
        if (!isNaN(numericId) && numericId > 0) {
          await this.sendSingleAudioBuffer(numericId, audioBuffer);
          console.log('🎙️ [MAX] голосовое приветствие отправлено chat=' + cleanId);
        }
      } catch (err: any) {
        console.log('❌ [MAX] голосовое приветствие упало: ' + (err.message || err));
      }
    })();
  }

  /**
   * Обработка входящего webhook запроса от MAX Messenger
   */
  public async handleWebhook(req: any, res: any): Promise<void> {
    try {
      const raw = req.body || {};
      logger.info(`📨 [MaxAdapter] Webhook received`);

      // 1. Идемпотентность: извлечение ID сообщения и фильтрация дублей
      const messageId = raw.body?.mid || raw.body?.seq || raw.message?.body?.mid || raw.message_id || raw.mid || raw.seq || raw.payload?.mid || raw.payload?.seq;

      if (messageId) {
        const idStr = String(messageId);
        const now = Date.now();

        // Очистка старых записей (>10 минут)
        for (const [id, timestamp] of processedMessages.entries()) {
          if (now - timestamp > MESSAGE_TTL) {
            processedMessages.delete(id);
          }
        }

        if (processedMessages.has(idStr)) {
          console.log('♻️ [MAX] Дубль пропущен: ' + idStr);
          return res.status(200).send('ok');
        }

        processedMessages.set(idStr, now);
      }

      // 🔥 ЛОГ ВСЕГО ТЕЛА ЗАПРОСА — ЭТО НУЖНО ДЛЯ ОТЛАДКИ
      logger.info(`📦 RAW BODY: ${JSON.stringify(raw)}`);

      // 1. Извлекаем chatId
      let chatId = raw.chat_id || raw.payload?.chat_id || raw.body?.chat_id;
      if (!chatId && raw.message) chatId = raw.message.chat_id || raw.message.recipient?.chat_id;
      if (!chatId && raw.payload?.message) chatId = raw.payload.message.chat_id || raw.payload.message.recipient?.chat_id;
      if (!chatId) {
        logger.error("❌ No ChatID found");
        return res.status(200).send('ok');
      }

      // Check if event is bot_started
      const isBotStarted = 
        String(raw.event || '').toLowerCase() === 'bot_started' || 
        String(raw.body?.event || '').toLowerCase() === 'bot_started' || 
        String(raw.payload?.event || '').toLowerCase() === 'bot_started' || 
        String(raw.type || '').toLowerCase() === 'bot_started' || 
        String(raw.body?.type || '').toLowerCase() === 'bot_started' || 
        String(raw.payload?.type || '').toLowerCase() === 'bot_started' ||
        String(raw.action || '').toLowerCase() === 'bot_started' ||
        String(raw.payload?.action || '').toLowerCase() === 'bot_started';

      const cleanId = String(chatId).replace(/^[a-z_]+/, '');

      let isAlreadyGreeted = false;
      if (sqliteDb) {
        try {
          sqliteDb.exec('CREATE TABLE IF NOT EXISTS greeted_users (chat_id TEXT PRIMARY KEY, greeted_at TEXT);');
          const row = sqliteDb.prepare('SELECT chat_id FROM greeted_users WHERE chat_id = ?').get(cleanId);
          if (row) isAlreadyGreeted = true;
        } catch (dbErr: any) {
          logger.error('❌ [MaxAdapter] greeted check error: ' + (dbErr.message || dbErr));
        }
      }

      let text = '';
      let callbackData = raw.callback_data || raw.payload?.callback_data || raw.body?.callback_data || raw.message?.callback_data || raw.payload?.data || raw.body?.data || raw.body?.payload?.callback_data || raw.message?.body?.callback_data;

      const textCandidates = [
        raw.text, raw.payload?.text, raw.body?.text,
        raw.message?.text, raw.message?.body?.text,
        raw.payload?.message?.text, raw.payload?.message?.body?.text,
        raw.body?.message?.text, raw.body?.message?.body?.text
      ];
      for (const cand of textCandidates) {
        if (cand !== undefined && cand !== null && String(cand).trim() !== '') { text = String(cand).trim(); break; }
      }
      if (callbackData) { text = String(callbackData).trim(); }

      const lowerTextForStartCheck = text.toLowerCase().trim();
      const isStartCommand = isBotStarted || lowerTextForStartCheck === '/start' || lowerTextForStartCheck === 'начать' || lowerTextForStartCheck.startsWith('/start ') || lowerTextForStartCheck.startsWith('начать ');

      if (isStartCommand) {
        console.log('👋 [MAX] bot_started: ПОЛНОЕ приветствие chat=' + chatId);
        await this.sendWelcomeGreeting(cleanId);
        if (sqliteDb) { try { sqliteDb.prepare('INSERT OR REPLACE INTO greeted_users (chat_id, greeted_at) VALUES (?, ?)').run(cleanId, new Date().toISOString()); } catch (e) {} }
        return res.status(200).send('ok');
      }

      if (!isAlreadyGreeted && !callbackData) {
        console.log('👋 [MAX] первое сообщение: короткий привет и ПРОДОЛЖАЮ chat=' + chatId);
        await this.safeSendMessageToChat(cleanId, 'Здравствуйте! Я — Селин.');
        if (sqliteDb) { try { sqliteDb.prepare('INSERT OR REPLACE INTO greeted_users (chat_id, greeted_at) VALUES (?, ?)').run(cleanId, new Date().toISOString()); console.log('👋 [MAX] greeted сохранён chat=' + cleanId); } catch (e) {} }
      }

      // 3. Проверяем аудио-вложения и извлекаем прямой URL/токен
      let isVoiceInput = false;
      let audioUrlOrToken = '';

      // Прямое извлечение URL из вложений (raw.body?.attachments?.[0] || raw.attachments?.[0])
      const primaryAtt = raw.body?.attachments?.[0] || raw.attachments?.[0] || raw.payload?.attachments?.[0] || raw.message?.attachments?.[0];
      const directUrl = primaryAtt?.payload?.url || primaryAtt?.payload?.link || primaryAtt?.url || primaryAtt?.link;

      const allAttachments: any[] = [];
      const collectFrom = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj.attachments)) allAttachments.push(...obj.attachments);
        if (obj.payload && typeof obj.payload === 'object') collectFrom(obj.payload);
        if (obj.body && typeof obj.body === 'object') collectFrom(obj.body);
        if (obj.message && typeof obj.message === 'object') collectFrom(obj.message);
      };
      collectFrom(raw);

      logger.info(`📎 ATTACHMENTS: ${JSON.stringify(allAttachments)}`);

      for (const att of allAttachments) {
        const typeStr = String(att?.type || '').toLowerCase();
        const mediaTypeStr = String(att?.media_type || '').toLowerCase();
        if (typeStr.includes('audio') || typeStr.includes('voice') || mediaTypeStr.includes('audio') || mediaTypeStr.includes('voice')) {
          isVoiceInput = true;
          audioUrlOrToken = att.payload?.url || att.payload?.link || att.url || att.link || att.payload?.token || att.token || '';
          logger.info(`🎤 Найдено аудио во вложениях, url/token: ${audioUrlOrToken}`);
          break;
        }
      }

      // Если аудио найдено через прямой URL или флаг
      if (!audioUrlOrToken && directUrl) {
        const typeStr = String(primaryAtt?.type || raw.type || raw.body?.type || raw.payload?.type || '').toLowerCase();
        if (typeStr.includes('audio') || typeStr.includes('voice') || !text) {
          isVoiceInput = true;
          audioUrlOrToken = directUrl;
          logger.info(`🎤 Найдено прямое audio directUrl: ${audioUrlOrToken}`);
        }
      }

      if (!audioUrlOrToken && (raw.audio_url || raw.body?.audio_url || raw.payload?.audio_url)) {
        isVoiceInput = true;
        audioUrlOrToken = raw.audio_url || raw.body?.audio_url || raw.payload?.audio_url;
      }

      // 4. Если голосовое — распознаём
      if (isVoiceInput && audioUrlOrToken) {
        try {
          const audioBuffer = await this.downloadAudio(audioUrlOrToken);
          const transcribedText = await this.transcribeAudio(audioBuffer);
          if (transcribedText && transcribedText.trim()) {
            text = transcribedText.trim();
            logger.info(`📝 Распознано: "${text}"`);
          } else {
            await this.synthesizeAndSendVoice(chatId, 'Извините, я не расслышала. Повторите, пожалуйста.');
            return res.status(200).send('ok');
          }
        } catch (err: any) {
          logger.error(`❌ Ошибка обработки голоса: ${err?.message || err}`);
          await this.synthesizeAndSendVoice(chatId, 'Произошла ошибка при обработке голосового сообщения.');
          return res.status(200).send('ok');
        }
      }

      // 4.5. Проверяем наличие картинок/скриншотов во вложениях
      let hasImage = false;
      let imageUrl = '';

      for (const att of allAttachments) {
        const typeStr = String(att?.type || '').toLowerCase();
        const mediaTypeStr = String(att?.media_type || '').toLowerCase();
        if (
          typeStr === 'image' || typeStr === 'photo' ||
          mediaTypeStr === 'image' || mediaTypeStr === 'photo' ||
          typeStr.includes('image') || typeStr.includes('photo')
        ) {
          const candidate = att.payload?.url || att.payload?.link || att.url || att.link || att.file_url;
          if (candidate) {
            hasImage = true;
            imageUrl = String(candidate);
            break;
          }
        }
      }

      if (!hasImage && (raw.image_url || raw.body?.image_url || raw.payload?.image_url || raw.photo_url || raw.body?.photo_url || raw.payload?.photo_url)) {
        hasImage = true;
        imageUrl = String(raw.image_url || raw.body?.image_url || raw.payload?.image_url || raw.photo_url || raw.body?.photo_url || raw.payload?.photo_url);
      }

      if (!hasImage && directUrl) {
        const typeStr = String(primaryAtt?.type || raw.type || raw.body?.type || raw.payload?.type || '').toLowerCase();
        if (typeStr === 'image' || typeStr === 'photo' || typeStr.includes('image') || typeStr.includes('photo')) {
          hasImage = true;
          imageUrl = String(directUrl);
        }
      }

      // Если пришла картинка — скачиваем и запускаем callVision
      if (hasImage && imageUrl) {
        const cleanId = String(chatId).replace(/^[a-z_]+/, '');
        try {
          const imgRes = await fetch(imageUrl, {
            method: 'GET',
            signal: AbortSignal.timeout(20000)
          });

          if (!imgRes.ok) {
            throw new Error(`Failed to download image (HTTP ${imgRes.status})`);
          }

          const arrayBuffer = await imgRes.arrayBuffer();
          const buf = Buffer.from(arrayBuffer);
          console.log('🖼️ [MaxAdapter] Получена картинка, байт: ' + buf.length);

          if (buf.length > 4 * 1024 * 1024) {
            const heavyMsg = 'Картинка слишком тяжёлая, пришли скрин поменьше';
            if (isVoiceInput) {
              await this.synthesizeAndSendVoice(cleanId, heavyMsg);
            } else {
              await this.safeSendMessageToChat(cleanId, heavyMsg);
            }
            return res.status(200).send('ok');
          }

          const mime = getImageMimeType(buf, imgRes.headers.get('content-type'));
          const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;

          const visionResponse = await callVision(text, dataUrl);
          const finalReply = stripMarkdown(visionResponse);

          if (isVoiceInput) {
            await this.synthesizeAndSendVoice(cleanId, finalReply);
          } else {
            await this.safeSendMessageToChat(cleanId, finalReply);
          }

          return res.status(200).send('ok');
        } catch (visionErr: any) {
          logger.error(`❌ [MaxAdapter] Ошибка Vision: ${visionErr?.message || visionErr}`);
          const errMsg = 'Не удалось проанализировать изображение. Пожалуйста, попробуйте еще раз.';
          if (isVoiceInput) {
            await this.synthesizeAndSendVoice(cleanId, errMsg);
          } else {
            await this.safeSendMessageToChat(cleanId, errMsg);
          }
          return res.status(200).send('ok');
        }
      }

      if (!text || !text.trim()) {
        logger.warn('⚠️ Empty text after processing');
        return res.status(200).send('ok');
      }

      const lowerText = text.toLowerCase().trim();

      // Команда 'статистика' от OWNER
      const ownerId = process.env.ADMIN_USER_ID || process.env.OWNER_CHAT_ID;
      if (ownerId && String(cleanId) === String(ownerId).trim()) {
        if (lowerText === 'статистика') {
          const { getOwnerStatistics } = await import("../utils/stats");
          const stats = await getOwnerStatistics();
          if (isVoiceInput) {
            await this.synthesizeAndSendVoice(cleanId, stats);
          } else {
            await this.safeSendMessageToChat(cleanId, stats);
          }
          return res.status(200).send('ok');
        }
      }

      const norm = text.toLowerCase().trim().replace(/[\s\-_.,!?:;]+/g, '');
      if (norm === 'селин777' || norm === 'selin777' || norm.includes('селин777') || norm.includes('selin777')) {
        setVoiceGender(cleanId, 'male');
        const reply = 'Мужской голос активирован.';
        if (isVoiceInput) {
          await this.synthesizeAndSendVoice(cleanId, reply);
        } else {
          await this.safeSendMessageToChat(cleanId, reply);
        }
        return res.status(200).send('ok');
      }
      if (norm === 'селин000' || norm === 'selin000' || norm.includes('селин000') || norm.includes('selin000') || norm.includes('селинооо') || norm.includes('selinooo')) {
        setVoiceGender(cleanId, 'female');
        const reply = 'Женский голос активирован.';
        if (isVoiceInput) {
          await this.synthesizeAndSendVoice(cleanId, reply);
        } else {
          await this.safeSendMessageToChat(cleanId, reply);
        }
        return res.status(200).send('ok');
      }

      // Bible broadcast subscription & confirmation check
      const { handleBibleSubscription } = await import("../../server");
      const bibleReply = await handleBibleSubscription(cleanId, text, isVoiceInput);
      if (bibleReply) {
        if (isVoiceInput) {
          await this.synthesizeAndSendVoice(cleanId, bibleReply);
        } else {
          await this.safeSendMessageToChat(cleanId, bibleReply);
        }
        return res.status(200).send('ok');
      }

      const context: MessageContext = {
        chatId: cleanId,
        tenantId: `max_${cleanId}`,
        channel: ChannelType.MAX,
        isVoice: isVoiceInput,
        timestamp: Date.now()
      };

      const response = await this.core.processMessage(text, context);

      if (isVoiceInput) {
        await this.synthesizeAndSendVoice(cleanId, response.text);
      } else {
        await this.safeSendMessageToChat(cleanId, response.text);
      }

      return res.status(200).send('ok');

    } catch (err: any) {
      logger.error(`❌ Webhook error: ${err?.message || err}`);
      return res.status(200).send('ok');
    }
  }
}
