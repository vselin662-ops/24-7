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
const MAX_TEXT_LIMIT = 3800;

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

export function parseImageGenerationPrompt(text: string): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith('/draw')) {
    const prompt = trimmed.substring(5).trim();
    return prompt || 'красивое изображение';
  }

  const triggers = [
    'сгенерируй фото',
    'сгенерируй картинку',
    'сгенерируй изображение',
    'покажи картинку',
    'покажи фото',
    'нарисуй мне',
    'нарисуй'
  ];

  for (const trig of triggers) {
    if (lower.startsWith(trig)) {
      let prompt = trimmed.substring(trig.length).trim();
      prompt = prompt.replace(/^[,:\s-]+/, '').trim();
      return prompt || 'красивое изображение';
    }
  }

  for (const trig of triggers) {
    const idx = lower.indexOf(trig);
    if (idx > 0 && /\s/.test(lower[idx - 1])) {
      let prompt = trimmed.substring(idx + trig.length).trim();
      prompt = prompt.replace(/^[,:\s-]+/, '').trim();
      if (prompt) return prompt;
    }
  }

  return null;
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

export function splitTextSmart(text: string, maxLen: number = 3800): string[] {
  if (!text || text.length <= maxLen) return text ? [text] : [];
  
  const chunks: string[] = [];
  let remaining = text.trim();
  
  while (remaining.length > maxLen) {
    const searchWindow = remaining.substring(0, maxLen);
    let splitIdx = -1;

    // 1. Ищем перенос строки
    const lastNewline = searchWindow.lastIndexOf('\n');
    if (lastNewline > maxLen * 0.4) {
      splitIdx = lastNewline + 1;
    } else {
      // 2. Ищем конец предложения (.!? с пробелом или переносом строки)
      const lastSentence = Math.max(
        searchWindow.lastIndexOf('. '),
        searchWindow.lastIndexOf('! '),
        searchWindow.lastIndexOf('? '),
        searchWindow.lastIndexOf('.\n'),
        searchWindow.lastIndexOf('!\n'),
        searchWindow.lastIndexOf('?\n')
      );
      if (lastSentence > maxLen * 0.4) {
        splitIdx = lastSentence + 2;
      } else {
        // 3. Ищем просто знак препинания
        const lastPunct = Math.max(
          searchWindow.lastIndexOf('.'),
          searchWindow.lastIndexOf('!'),
          searchWindow.lastIndexOf('?'),
          searchWindow.lastIndexOf(';')
        );
        if (lastPunct > maxLen * 0.4) {
          splitIdx = lastPunct + 1;
        } else {
          // 4. Ищем пробел
          const lastSpace = searchWindow.lastIndexOf(' ');
          if (lastSpace > maxLen * 0.4) {
            splitIdx = lastSpace + 1;
          } else {
            // 5. Жесткий срез
            splitIdx = maxLen;
          }
        }
      }
    }

    const chunk = remaining.substring(0, splitIdx).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.substring(splitIdx).trim();
  }

  if (remaining.trim()) {
    chunks.push(remaining.trim());
  }

  return chunks;
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
      const allChunks = splitTextSmart(trimmedText, MAX_TEXT_LIMIT);
      const chunks = allChunks.slice(0, 4);
      console.log(`✂️ [MAX] long text chunked: ${chunks.length} parts`);
      let lastMsg: unknown = null;
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const currentExtra = (i === 0) ? extra : undefined;
        try {
          lastMsg = await this.bot.api.sendMessageToChat(numericId, chunk as any, currentExtra);
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          logger.error("❌ [MaxAdapter] Max send failed in safeSendMessageToChat", {
            chatId: numericId,
            message: errorMsg,
            chunkIndex: i
          });
        }
        if (i < chunks.length - 1) {
          await new Promise(r => setTimeout(r, 600));
        }
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
   * Загрузка буфера изображения в MAX Storage
   */
  private async uploadImageBufferToMax(imageBuffer: Buffer, mimeType: string = 'image/png'): Promise<string | null> {
    if (!imageBuffer || imageBuffer.length === 0 || !this.bot) return null;
    try {
      const maxToken = this.token || process.env.MAX_BOT_TOKEN;
      const initRes = await fetch('https://platform-api.max.ru/uploads?type=image', {
        method: 'POST',
        headers: { 'Authorization': maxToken || '' },
        signal: AbortSignal.timeout(15000)
      });

      if (initRes.ok) {
        const initData: any = await initRes.json();
        const uploadToken = initData?.token;
        const uploadUrl = initData?.url;

        if (uploadUrl) {
          const form = new FormData();
          const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png';
          const fileBlob = new Blob([imageBuffer], { type: mimeType });
          form.append('data', fileBlob, `image.${ext}`);

          const uploadRes = await fetch(uploadUrl, {
            method: 'POST',
            body: form,
            signal: AbortSignal.timeout(25000)
          });

          if (uploadRes.ok) {
            const uploadJson: any = await uploadRes.json().catch(() => null);
            const tokenToUse = uploadJson?.token || uploadToken;
            return tokenToUse || null;
          } else {
            logger.warn(`⚠️ [MaxAdapter] Upload image to MAX storage failed with status ${uploadRes.status}`);
          }
        }
      } else {
        logger.warn(`⚠️ [MaxAdapter] Failed to init MAX image storage upload: ${initRes.status}`);
      }
    } catch (err: any) {
      logger.error(`❌ [MaxAdapter] uploadImageBufferToMax error: ${err.message || err}`);
    }
    return null;
  }

  /**
   * Генерация фото / изображений по запросу пользователя (Gemini Image Generation / Pollinations.ai)
   */
  public async generateAndSendImage(cleanId: string, userPrompt: string, isVoiceInput: boolean = false): Promise<boolean> {
    const enrichedPrompt = `${userPrompt}, high quality, detailed`;
    const caption = `🎨 Готово! ${userPrompt}`;
    const cleanIdStr = String(cleanId).replace(/^[a-z_]+/, '');
    const numericId = parseInt(cleanIdStr, 10);

    // 1. Попытка через Gemini Image Generation (если доступен ключ и медиа-загрузка)
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      const models = ['gemini-2.5-flash-image', 'gemini-2.0-flash-preview-image-generation'];
      for (const model of models) {
        try {
          const { GoogleGenAI } = await import('@google/genai');
          const ai = new GoogleGenAI({ apiKey: geminiKey });
          const response = await ai.models.generateContent({
            model,
            contents: enrichedPrompt,
            config: {
              responseModalities: ['IMAGE', 'TEXT'],
            } as any
          });

          const candidates = response?.candidates || [];
          let imageBuffer: Buffer | null = null;
          let mimeType = 'image/png';

          for (const candidate of candidates) {
            for (const part of candidate?.content?.parts || []) {
              if (part?.inlineData?.data) {
                mimeType = part.inlineData.mimeType || 'image/png';
                imageBuffer = Buffer.from(part.inlineData.data, 'base64');
                break;
              }
            }
            if (imageBuffer) break;
          }

          if (imageBuffer && imageBuffer.length > 0) {
            console.log('🎨 [ImageGen] engine=gemini');
            if (this.bot && !isNaN(numericId) && numericId > 0) {
              const uploadToken = await this.uploadImageBufferToMax(imageBuffer, mimeType);
              if (uploadToken) {
                await this.bot.api.sendMessageToChat(numericId, caption, {
                  attachments: [{
                    type: 'image',
                    payload: {
                      token: uploadToken
                    }
                  }] as any
                });
                if (isVoiceInput) {
                  await this.synthesizeAndSendVoice(cleanId, caption);
                }
                return true;
              }
            }
          }
        } catch (geminiErr: any) {
          logger.warn(`⚠️ [ImageGen] Gemini model ${model} failed: ${geminiErr?.message || geminiErr}`);
        }
      }
    }

    // 2. Fallback: Pollinations.ai (даёт готовый URL без ключа)
    try {
      const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(enrichedPrompt)}?width=1024&height=1024&nologo=true`;
      console.log('🎨 [ImageGen] engine=pollinations');

      // Попытка скачать буфер и загрузить в MAX
      let uploaded = false;
      try {
        const pRes = await fetch(pollinationsUrl, { signal: AbortSignal.timeout(15000) });
        if (pRes.ok) {
          const pBuf = Buffer.from(await pRes.arrayBuffer());
          const uploadToken = await this.uploadImageBufferToMax(pBuf, 'image/jpeg');
          if (uploadToken && this.bot && !isNaN(numericId) && numericId > 0) {
            await this.bot.api.sendMessageToChat(numericId, caption, {
              attachments: [{
                type: 'image',
                payload: {
                  token: uploadToken
                }
              }] as any
            });
            uploaded = true;
          }
        }
      } catch (uploadFallbackErr: any) {
        logger.warn(`⚠️ [ImageGen] Pollinations buffer upload fallback: ${uploadFallbackErr?.message || uploadFallbackErr}`);
      }

      // Если прямая загрузка буфера не сработала — отправляем через URL attachment
      if (!uploaded) {
        const extra = {
          attachments: [
            {
              type: 'image',
              payload: {
                url: pollinationsUrl
              }
            }
          ]
        };
        await this.safeSendMessageToChat(cleanId, caption, extra);
      }

      if (isVoiceInput) {
        await this.synthesizeAndSendVoice(cleanId, caption);
      }
      return true;
    } catch (pollErr: any) {
      logger.error(`❌ [ImageGen] Pollinations failed: ${pollErr?.message || pollErr}`);
      const errMsg = 'К сожалению, не удалось сгенерировать изображение. Попробуйте еще раз позже.';
      if (isVoiceInput) {
        await this.synthesizeAndSendVoice(cleanId, errMsg);
      } else {
        await this.safeSendMessageToChat(cleanId, errMsg);
      }
      return false;
    }
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
        if (audioBuffer && audioBuffer.length > 0) {
          const success = await this.sendSingleAudioBuffer(numericId, audioBuffer);
          if (success) {
            sentAtLeastOne = true;
          }
        }
      } catch (err: any) {
        logger.error(`❌ [MaxAdapter] Failed to send chunk voice: ${err.message || err}`);
      }
    }

    if (!sentAtLeastOne) {
      logger.warn('🔇 [TTS] all engines failed — text-only reply');
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
    const welcomeText = 'Здравствуйте! Я — Selin AI. 🙏 План Победы — ежедневное чтение Библии в MAX (стих дня + голосовой разбор по трудам отцов Церкви) — НАВСЕГДА БЕСПЛАТНО. Скажите «подписаться на Библию». 🤖 AI-помощник — безлимитные диалоги, зрение, напоминания, сбор продуктов — 199₽/мес, первые 3 дня бесплатно. Давайте знакомиться: нажмите микрофон и расскажите о себе — сколько вас в семье, есть ли ограничения в еде, какой магазин рядом. Я запомню и стану полезнее.';
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
        if (!isNaN(numericId) && numericId > 0 && audioBuffer && audioBuffer.length > 0) {
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
        await this.safeSendMessageToChat(cleanId, 'Здравствуйте! Я — Selin AI.');
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

      // Если прикреплена картинка и текст содержит подтверждение оплаты (или скриншот чека)
      const isPaymentProof = hasImage && (
        text.toLowerCase().includes('оплачен') ||
        text.toLowerCase().includes('оплатил') ||
        text.toLowerCase().includes('чек') ||
        text.toLowerCase().includes('сбп')
      );

      if (isPaymentProof) {
        const cleanId = String(chatId).replace(/^[a-z_]+/, '');
        const lower = text.toLowerCase().trim();
        let detectedTariff = 'Свет';
        if (lower.includes('год') || lower.includes('year') || lower.includes('2999')) {
          detectedTariff = 'Год';
        } else if (lower.includes('благодат') || lower.includes('blagodat') || lower.includes('399') || lower.includes('prem')) {
          detectedTariff = 'Благодать';
        } else if (lower.includes('свет') || lower.includes('svet') || lower.includes('199')) {
          detectedTariff = 'Свет';
        }

        const { savePaymentRequest } = await import("../fintech/payments");
        savePaymentRequest(cleanId, detectedTariff, true);

        // Уведомление владельцу
        const ownerId = process.env.OWNER_CHAT_ID || process.env.ADMIN_USER_ID || process.env.ADMIN_CHAT_ID;
        if (ownerId) {
          const ownerMsg = `💳 Заявка: chat=${cleanId}, тариф=${detectedTariff}. Активация: команда активировать ${cleanId} ${detectedTariff}`;
          await this.safeSendMessageToChat(ownerId, ownerMsg);
        }

        const userReply = `✅ Заявка на оплату тарифа "${detectedTariff}" принята со скриншотом чека! Мы проверим перевод по СБП и активируем подписку в ближайшее время.`;
        if (isVoiceInput) {
          await this.synthesizeAndSendVoice(cleanId, userReply);
        } else {
          await this.safeSendMessageToChat(cleanId, userReply);
        }
        return res.status(200).send('ok');
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

      // Генерация фото / изображений (триггеры: /draw, нарисуй, сгенерируй фото, сгенерируй картинку, покажи картинку)
      const imgPrompt = parseImageGenerationPrompt(text);
      if (imgPrompt) {
        await this.generateAndSendImage(cleanId, imgPrompt, isVoiceInput);
        return res.status(200).send('ok');
      }

      // === БЛОК 4 & 5 & 3: КОМАНДЫ, СБОР ПРОДУКТОВ, ОНБОРДИНГ ===

      // 0.1 Команда владельца 'активировать <chat_id> <tariff>'
      const activateMatch = text.trim().match(/^активировать\s+(\S+)(?:\s+(.+))?/i) || text.trim().match(/^\/activate\s+(\S+)(?:\s+(.+))?/i);
      if (activateMatch) {
        const targetChatId = activateMatch[1].replace(/^[a-z_]+/, '');
        const requestedTariff = (activateMatch[2] || 'Свет').trim();
        const { activateManualPayment } = await import("../fintech/payments");
        const actResult = activateManualPayment(targetChatId, requestedTariff);

        // Отправка подтверждения пользователю
        const userMsg = `✅ Оплата получена! Подписка ${actResult.tariffName} активна до ${actResult.dateStr}. Чек пришлю отдельным сообщением.`;
        await this.safeSendMessageToChat(targetChatId, userMsg);

        // Подтверждение владельцу
        const ownerAck = `✅ Подписка "${actResult.tariffName}" для chat_id=${targetChatId} успешно активирована до ${actResult.dateStr}. Статус заявки переведён в 'done'.`;
        if (isVoiceInput) {
          await this.synthesizeAndSendVoice(cleanId, ownerAck);
        } else {
          await this.safeSendMessageToChat(cleanId, ownerAck);
        }
        return res.status(200).send('ok');
      }

      // 0.2 Команда / callback '📋 Скопировать список'
      if (lowerText === 'copy_cart' || lowerText === 'скопировать список' || lowerText === '/copy_cart' || lowerText.includes('скопировать список')) {
        const { getLastCartList } = await import("../services/CartService");
        const lastList = getLastCartList(cleanId);
        let copyReply = '';
        if (lastList) {
          copyReply = `📋 **Список продуктов для удобного копирования**:\n\n${lastList}`;
        } else {
          copyReply = 'Список продуктов пока не составлен. Напишите «Собери продукты на борщ», чтобы сформировать список!';
        }
        await this.safeSendMessageToChat(cleanId, copyReply);
        return res.status(200).send('ok');
      }

      // 0.3 Команда 'оплачено' / 'оплатил' / 'оплатила' (без фото или при отдельном сообщении)
      const isPaidTrigger = lowerText === 'оплачено' || lowerText.startsWith('оплачено') ||
                            lowerText === 'оплатил' || lowerText.startsWith('оплатил') ||
                            lowerText === 'оплатила' || lowerText.startsWith('оплатила') ||
                            lowerText === '/paid' || lowerText === 'оплата';
      if (isPaidTrigger) {
        let detectedTariff = 'Свет';
        if (lowerText.includes('год') || lowerText.includes('year') || lowerText.includes('2999')) {
          detectedTariff = 'Год';
        } else if (lowerText.includes('благодат') || lowerText.includes('blagodat') || lowerText.includes('399') || lowerText.includes('prem')) {
          detectedTariff = 'Благодать';
        } else if (lowerText.includes('свет') || lowerText.includes('svet') || lowerText.includes('199')) {
          detectedTariff = 'Свет';
        }

        const { savePaymentRequest } = await import("../fintech/payments");
        savePaymentRequest(cleanId, detectedTariff, false);

        // Уведомление владельцу
        const ownerChatId = process.env.OWNER_CHAT_ID || process.env.ADMIN_USER_ID || process.env.ADMIN_CHAT_ID;
        if (ownerChatId) {
          const ownerMsg = `💳 Заявка: chat=${cleanId}, тариф=${detectedTariff}. Активация: команда активировать ${cleanId} ${detectedTariff}`;
          await this.safeSendMessageToChat(ownerChatId, ownerMsg);
        }

        const userReply = `✅ Заявка на оплату тарифа "${detectedTariff}" принята! Мы проверим перевод по СБП и активируем подписку в ближайшее время.`;
        if (isVoiceInput) {
          await this.synthesizeAndSendVoice(cleanId, userReply);
        } else {
          await this.safeSendMessageToChat(cleanId, userReply);
        }
        return res.status(200).send('ok');
      }

      // 0.4 Callbacks кнопок оплаты 'pay:<tariff>'
      if (lowerText.startsWith('pay:') || lowerText.startsWith('pay_')) {
        const planKey = lowerText.replace(/^pay[:_]/, '').trim() || 'svet';
        const { createPayment } = await import("../fintech/payments");
        const payRes = await createPayment(cleanId, planKey);
        if (payRes.mode === 'auto' && payRes.url) {
          const autoExtra = {
            attachments: [
              {
                type: 'inline_keyboard',
                payload: {
                  buttons: [
                    [
                      { type: 'link', text: '💳 Перейти к оплате', url: payRes.url }
                    ]
                  ]
                }
              }
            ]
          };
          await this.safeSendMessageToChat(cleanId, `Ссылка для оплаты тарифа:\n${payRes.url}`, autoExtra);
        } else {
          const sbpPhone = process.env.SBP_PHONE || '+7 (999) 000-00-00';
          const { PLANS } = await import("../fintech/subscriptions");
          const planObj = PLANS[planKey] || PLANS.svet;
          const manualText = `Выбран тариф "${planObj.name}" (${planObj.price}₽).\n\nОплата по СБП на номер ${sbpPhone}. После перевода отправьте сюда слово ОПЛАЧЕНО и скриншот чека.`;
          await this.safeSendMessageToChat(cleanId, manualText);
        }
        return res.status(200).send('ok');
      }

      // 1. /subscribe или 'подписка' или 'тарифы'
      if (lowerText === '/subscribe' || lowerText === 'подписка' || lowerText === 'тарифы' || lowerText === '/plans' || lowerText === '/tariffs') {
        const sbpPhone = process.env.SBP_PHONE || '+7 (999) 000-00-00';
        const reply = `Тарифы Selin AI:\n\n💡 Свет — 199₽ (безлимитные диалоги)\n🌟 Благодать — 399₽ (+приоритет и зрение без лимитов)\n📅 Год — 2999₽ (максимальная выгода)\n\nОплата по СБП на номер ${sbpPhone}. После перевода отправьте сюда слово ОПЛАЧЕНО и скриншот чека.`;
        const extra = {
          attachments: [
            {
              type: 'inline_keyboard',
              payload: {
                buttons: [
                  [
                    { text: '💡 Свет - 199₽', callback_data: 'pay:svet' },
                    { text: '🌟 Благодать - 399₽', callback_data: 'pay:blagodat' }
                  ],
                  [
                    { text: '📅 Год - 2999₽', callback_data: 'pay:year' }
                  ]
                ]
              }
            }
          ]
        };
        await this.safeSendMessageToChat(cleanId, reply, extra);
        return res.status(200).send('ok');
      }

      // 2. 'подписаться на библию' или '/bible'
      if (lowerText === 'подписаться на библию' || lowerText === '/bible') {
        const { handleBibleSubscription } = await import("../../server");
        const bibleReply = await handleBibleSubscription(cleanId, 'бог благ и милость его велика', isVoiceInput);
        if (bibleReply) {
          const finalReply = bibleReply + '\n\n🙏 Обратите внимание: План Победы предоставляется абсолютно БЕСПЛАТНО НАВСЕГДА.';
          if (isVoiceInput) {
            await this.synthesizeAndSendVoice(cleanId, finalReply);
          } else {
            await this.safeSendMessageToChat(cleanId, finalReply);
          }
        }
        return res.status(200).send('ok');
      }

      // 3. /remind [время] [текст] или 'напомни [время] [текст]'
      if (lowerText.startsWith('/remind ') || lowerText.startsWith('напомни ')) {
        const trigger = lowerText.startsWith('/remind ') ? '/remind ' : 'напомни ';
        const rawContent = text.substring(trigger.length).trim();
        const timeRegex = /^(?:через\s+\d+\s*(?:минут|мин|часов|часа|ч)|через\s+час|в\s+\d{1,2}[:.-]\d{2}|в\s+\d{1,2}\s*(?:утра|вечера|вечером|дня|ночи)?)/i;
        const match = rawContent.match(timeRegex);
        let timePart = 'через час';
        let reminderText = rawContent;

        if (match) {
          timePart = match[0];
          reminderText = rawContent.substring(timePart.length).trim();
        } else {
          const firstWord = rawContent.split(' ')[0];
          if (/^\d/.test(firstWord)) {
            timePart = firstWord;
            reminderText = rawContent.substring(firstWord.length).trim();
          }
        }

        if (!reminderText) {
          reminderText = 'Напоминание!';
        }

        try {
          const { addReminder } = await import("../services/ReminderService");
          const fireDate = await addReminder(cleanId, timePart, reminderText);
          const localTimeStr = fireDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
          const localDateStr = fireDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
          const reply = `✅ Напоминание создано! Я напомню вам "${reminderText}" ${localDateStr} в ${localTimeStr}.`;
          if (isVoiceInput) {
            await this.synthesizeAndSendVoice(cleanId, reply);
          } else {
            await this.safeSendMessageToChat(cleanId, reply);
          }
        } catch (rErr) {
          logger.error("❌ Failed to add reminder:", rErr);
          const reply = "Извините, не удалось создать напоминание. Попробуйте другой формат времени.";
          if (isVoiceInput) {
            await this.synthesizeAndSendVoice(cleanId, reply);
          } else {
            await this.safeSendMessageToChat(cleanId, reply);
          }
        }
        return res.status(200).send('ok');
      }

      // 4. /profile или 'мой профиль'
      if (lowerText === '/profile' || lowerText === 'мой профиль') {
        const { getProfile } = await import("../services/ProfileService");
        const profile = await getProfile(cleanId);
        if (profile && (profile.family_size || profile.diet_restrictions?.length || profile.stores?.length || profile.city || profile.interests?.length || profile.faith !== undefined)) {
          const parts = [];
          if (profile.family_size) parts.push(`Семья: ${profile.family_size} чел.`);
          if (profile.diet_restrictions?.length) parts.push(`Ограничения в еде: ${profile.diet_restrictions.join(', ')}`);
          if (profile.stores?.length) parts.push(`Магазины рядом: ${profile.stores.join(', ')}`);
          if (profile.city) parts.push(`Город: ${profile.city}`);
          if (profile.interests?.length) parts.push(`Интересы: ${profile.interests.join(', ')}`);
          if (profile.faith !== undefined) parts.push(`Вера/религия: ${profile.faith ? 'Православный христианин' : 'Не указано'}`);
          const reply = `👤 **Ваш профиль в Selin AI**:\n\n${parts.join('\n')}`;
          if (isVoiceInput) {
            await this.synthesizeAndSendVoice(cleanId, reply);
          } else {
            await this.safeSendMessageToChat(cleanId, reply);
          }
        } else {
          const reply = 'Ваш профиль пока пуст. Расскажите о себе (например: «Нас четверо, свинину не едим, магазин Пятёрочка рядом»), и я запомню ваши предпочтения!';
          if (isVoiceInput) {
            await this.synthesizeAndSendVoice(cleanId, reply);
          } else {
            await this.safeSendMessageToChat(cleanId, reply);
          }
        }
        return res.status(200).send('ok');
      }

      // 5. /cart, 'собери', 'продукты на', 'корзину'
      const isCartTrigger = lowerText.startsWith('/cart') || lowerText.includes('собери') || lowerText.includes('продукты на') || lowerText.includes('корзину') || lowerText.includes('корзина') || lowerText.includes('список продуктов');
      if (isCartTrigger) {
        const { getProfile } = await import("../services/ProfileService");
        const { buildCart } = await import("../services/CartService");
        const profile = await getProfile(cleanId);
        const cartResult = await buildCart(text, profile, cleanId);
        const cartKeyboardExtra = cartResult.extra || {
          attachments: [
            {
              type: 'inline_keyboard',
              payload: {
                buttons: [
                  [
                    { type: 'link', text: '🏪 Пятёрочка', url: 'https://5ka.ru' },
                    { type: 'link', text: '🥑 ВкусВилл', url: 'https://vkusvill.ru' },
                    { type: 'link', text: '🛒 Перекрёсток', url: 'https://www.perekrestok.ru' }
                  ],
                  [
                    { type: 'link', text: '🚕 Купер', url: 'https://kuper.ru' },
                    { type: 'link', text: '🥦 Лавка', url: 'https://lavka.yandex.ru' }
                  ],
                  [
                    { type: 'callback', text: '📋 Скопировать список', payload: 'copy_cart', callback_data: 'copy_cart' }
                  ]
                ]
              }
            }
          ]
        };
        await this.safeSendMessageToChat(cleanId, cartResult.text, cartKeyboardExtra);
        return res.status(200).send('ok');
      }

      // 6. Рассказ о себе (family/еда/магазин/город)
      const isAboutSelf = /(?:нас|семья|чел|едим|огранич|аллерги|свинин|магазин|живу|рядом|пятёрочк|вкусвилл|перекресток)/i.test(lowerText) &&
                          (/(?:семья|человек|едим|огранич|живу|магазин|город|аллерги|ограничен|религи|веру|христиа)/i.test(lowerText) || lowerText.includes("о себе"));
      if (isAboutSelf) {
        const { extractProfile } = await import("../services/ProfileService");
        const profile = await extractProfile(text, cleanId);
        if (profile && (profile.family_size || profile.diet_restrictions?.length || profile.stores?.length || profile.city || profile.interests?.length || profile.faith !== undefined)) {
          const parts = [];
          if (profile.family_size) parts.push(`семья ${profile.family_size} чел.`);
          if (profile.diet_restrictions?.length) parts.push(`ограничения в еде: ${profile.diet_restrictions.join(', ')}`);
          if (profile.stores?.length) parts.push(`магазины: ${profile.stores.join(', ')}`);
          if (profile.city) parts.push(`город: ${profile.city}`);
          if (profile.interests?.length) parts.push(`интересы: ${profile.interests.join(', ')}`);
          if (profile.faith !== undefined) parts.push(`вера: ${profile.faith ? 'православный христианин' : 'не указано'}`);
          const reply = `✅ Запомнил: ${parts.join(', ')}. Учту в советах.`;
          if (isVoiceInput) {
            await this.synthesizeAndSendVoice(cleanId, reply);
          } else {
            await this.safeSendMessageToChat(cleanId, reply);
          }
          return res.status(200).send('ok');
        }
      }

      // Иначе: обычная обработка через AI Core
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
      let replyText = response.text;

      // Если у пользователя нет профиля и ему еще не предлагали онбординг — предлагаем один раз после первого ответа
      try {
        const { getProfile, hasOfferedProfile, markProfileOffered } = await import("../services/ProfileService");
        const profile = await getProfile(cleanId);
        const wasOffered = await hasOfferedProfile(cleanId);
        if (!profile && !wasOffered) {
          replyText += `\n\n💡 Кстати, расскажите о себе (голосом или текстом) — я запомню и учту. Например: «Нас четверо, свинину не едим, магазин Пятёрочка рядом».`;
          await markProfileOffered(cleanId);
        }
      } catch (profErr) {
        logger.error("❌ Failed to offer profile onboarding:", profErr);
      }

      if (isVoiceInput) {
        await this.synthesizeAndSendVoice(cleanId, replyText);
      } else {
        await this.safeSendMessageToChat(cleanId, replyText);
      }

      return res.status(200).send('ok');

    } catch (err: any) {
      logger.error(`❌ Webhook error: ${err?.message || err}`);
      return res.status(200).send('ok');
    }
  }
}
