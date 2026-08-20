// src/adapters/MaxAdapter.ts
import { Bot } from "@maxhub/max-bot-api";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { SelinCore } from "../core/SelinCore";
import { AIResponse, MessageContext, ChannelType, VoiceMode } from "../core/types";
import { logger } from "../logger";
import { VoiceService } from "../services/VoiceService";

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
   * Очистка текста от Markdown, ссылок, спецсимволов, эмодзи и обрезка до 500 символов
   */
  public cleanText(text: string): string {
    let cleaned = String(text || "")
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]+`/g, '')
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
      .replace(/[#*_~>|]/g, '')
      .replace(/[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) {
      return "";
    }

    const MAX_VOICE_LENGTH = 500;
    if (cleaned.length > MAX_VOICE_LENGTH) {
      let cutIndex = -1;
      const punctuationMarks = ['. ', '! ', '? ', '.\n', '!\n', '?\n', '\n'];

      for (const p of punctuationMarks) {
        const lastIdx = cleaned.lastIndexOf(p, MAX_VOICE_LENGTH);
        if (lastIdx > cutIndex && lastIdx >= 120) {
          cutIndex = lastIdx + 1;
        }
      }

      if (cutIndex === -1) {
        const lastSpace = cleaned.lastIndexOf(' ', MAX_VOICE_LENGTH - 25);
        cutIndex = lastSpace > 100 ? lastSpace : MAX_VOICE_LENGTH - 25;
      }

      cleaned = cleaned.slice(0, cutIndex).trim() + " Хотите, я продолжу?";
      logger.info(`✂️ [MaxAdapter] Text trimmed to ${cleaned.length} chars for audio speech`);
    }

    return cleaned;
  }

  /**
   * Безопасная отправка текстового сообщения в чат MAX
   */
  public async safeSendMessageToChat(
    chatId: number | string,
    text?: string | null,
    extra?: Record<string, unknown>
  ): Promise<unknown> {
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

    const textToSend = (text === "" && extra) ? undefined : (text ?? undefined);

    try {
      const message = await this.bot.api.sendMessageToChat(numericId, textToSend as any, extra);
      logger.info(`✅ [MaxAdapter] Message successfully sent to Max chat ${numericId}`);
      return message;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("❌ [MaxAdapter] Max send failed in safeSendMessageToChat", {
        chatId: numericId,
        message: errorMsg
      });

      // Fallback: попытаться отправить обычный текст если была отправка с вложениями
      if (extra && text) {
        try {
          return await this.bot.api.sendMessageToChat(numericId, text);
        } catch (fallbackErr: unknown) {
          const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          logger.error(`❌ [MaxAdapter] Fallback plain-text send failed: ${fbMsg}`);
        }
      }

      throw err;
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

    logger.info(`🎙️ [MaxAdapter] Starting voice synthesis for chat ${numericId} (${cleanedText.length} chars)`);

    let audioBuffer: Buffer | null = null;

    // --- Шаг 1 каскада: OpenAI TTS API ---
    const ttsBaseUrl = process.env.OPENAI_BASE_URL || process.env.TEAMO_BASE_URL || process.env.AGENT_ROUTER_BASE_URL;
    const ttsApiKey = process.env.OPENAI_API_KEY || process.env.TEAMO_API_KEY || process.env.AGENT_ROUTER_API_KEY;
    const ttsModel = process.env.OPENAI_TTS_MODEL || 'tts-1';
    const ttsVoice = process.env.OPENAI_TTS_VOICE || 'alloy';

    if (ttsBaseUrl && ttsApiKey) {
      try {
        let formattedUrl = ttsBaseUrl.trim();
        if (!formattedUrl.endsWith('/v1') && !formattedUrl.endsWith('/v1beta') && !formattedUrl.includes('/v1/') && !formattedUrl.includes('/v1beta/')) {
          formattedUrl = formattedUrl.replace(/\/$/, '') + '/v1';
        }

        const response = await fetch(`${formattedUrl}/audio/speech`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ttsApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: ttsModel,
            input: cleanedText,
            voice: ttsVoice,
            response_format: 'mp3'
          }),
          signal: AbortSignal.timeout(15000)
        });

        if (response.ok) {
          const arrayBuf = await response.arrayBuffer();
          audioBuffer = Buffer.from(arrayBuf);
          logger.info(`✅ [MaxAdapter] Speech synthesized via OpenAI TTS (${audioBuffer.length} bytes)`);
        } else {
          logger.warn(`⚠️ [MaxAdapter] OpenAI TTS returned status ${response.status}`);
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.warn(`⚠️ [MaxAdapter] OpenAI TTS failed, falling back to Edge TTS: ${errorMsg}`);
      }
    }

    // --- Шаг 2 каскада: Microsoft Edge TTS (MsEdgeTTS) ---
    if (!audioBuffer || audioBuffer.length === 0) {
      try {
        const tts = new MsEdgeTTS();
        const voiceName = process.env.EDGE_TTS_VOICE || 'ru-RU-SvetlanaNeural';
        await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
        const streamRes = tts.toStream(cleanedText);
        const readable = (streamRes && (streamRes as any).audioStream) ? (streamRes as any).audioStream : streamRes;

        const chunks: Buffer[] = [];
        for await (const chunk of readable) {
          if (Buffer.isBuffer(chunk)) {
            chunks.push(chunk);
          } else if (chunk instanceof Uint8Array) {
            chunks.push(Buffer.from(chunk));
          }
        }
        audioBuffer = Buffer.concat(chunks);
        logger.info(`✅ [MaxAdapter] Speech synthesized via Edge TTS (${audioBuffer.length} bytes)`);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.warn(`⚠️ [MaxAdapter] Edge TTS failed, falling back to VoiceService: ${errorMsg}`);
      }
    }

    // --- Шаг 3 каскада: VoiceService (Google Translate / Fallback) ---
    if (!audioBuffer || audioBuffer.length === 0) {
      try {
        audioBuffer = await this.voiceService.synthesize(cleanedText, { provider: 'auto', lang: 'ru' });
        if (audioBuffer && audioBuffer.length > 0) {
          logger.info(`✅ [MaxAdapter] Speech synthesized via VoiceService (${audioBuffer.length} bytes)`);
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.warn(`⚠️ [MaxAdapter] VoiceService synthesis failed: ${errorMsg}`);
      }
    }

    // --- Шаг 4: Загрузка в MAX Storage (MP3) и отправка в чат ---
    if (audioBuffer && audioBuffer.length > 0 && this.bot) {
      try {
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
            const fileBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });
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
                    token: uploadToken
                  }
                }] as any
              });
              logger.info(`🎤 [MaxAdapter] Voice message (MP3) successfully sent to chat ${numericId}`);
              return;
            } else {
              logger.warn(`⚠️ [MaxAdapter] Upload to MAX storage failed with status ${uploadRes.status}`);
            }
          }
        } else {
          logger.warn(`⚠️ [MaxAdapter] Failed to init MAX storage upload: ${initRes.status}`);
        }
      } catch (uploadErr: unknown) {
        const errorMsg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
        logger.error(`❌ [MaxAdapter] Storage upload error: ${errorMsg}`);
      }
    }

    // --- Шаг 5: Фолбэк на текстовое сообщение ---
    logger.warn(`⚠️ [MaxAdapter] Voice cascade completed without audio delivery, falling back to text for chat ${numericId}`);
    await this.safeSendMessageToChat(numericId, cleanedText);
  }

  /**
   * Скачивание аудиофайла из MAX Storage по токену
   */
  public async downloadAudio(token: string): Promise<Buffer> {
    const url = token.startsWith('http://') || token.startsWith('https://')
      ? token
      : `https://platform-api.max.ru/uploads/${token}`;
    const MAX_TOKEN = process.env.MAX_BOT_TOKEN || this.token;
    const response = await fetch(url, {
      headers: { 'Authorization': MAX_TOKEN || '' },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      throw new Error(`Failed to download audio: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
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
          return (data?.text || '').trim();
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
  public async sendMessage(chatId: string | number, response: AIResponse, isVoiceInput: boolean = false): Promise<void> {
    const cleanId = String(chatId).replace(/^[a-z_]+/, '');

    // Если пришло голосовое или ключевое слово для голоса → отвечаем голосом
    if (isVoiceInput) {
      try {
        await this.synthesizeAndSendVoice(cleanId, response.text);
        logger.info(`🎤 [MaxAdapter] Voice reply sent to chat ${cleanId}`);
        return;
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.warn(`⚠️ [MaxAdapter] Voice delivery failed, sending text fallback: ${errorMsg}`);
      }
    }

    // Если текст → отправляем текст (по умолчанию)
    await this.safeSendMessageToChat(cleanId, response.text);
  }

  /**
   * Обработка входящего webhook запроса от MAX Messenger
   */
  public async handleWebhook(req: any, res: any): Promise<void> {
    try {
      const raw = req.body || {};
      logger.info(`📨 [MaxAdapter] Webhook received`);

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

      // 2. Извлекаем текст
      let text = '';
      const textCandidates = [
        raw.text, raw.payload?.text, raw.body?.text,
        raw.message?.text, raw.message?.body?.text,
        raw.payload?.message?.text, raw.payload?.message?.body?.text,
        raw.body?.message?.text, raw.body?.message?.body?.text
      ];
      for (const cand of textCandidates) {
        if (cand !== undefined && cand !== null && String(cand).trim() !== '') {
          text = String(cand).trim();
          break;
        }
      }

      // 3. Проверяем аудио-вложения
      let isVoiceInput = false;
      let voiceToken = '';

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
        if (typeStr.includes('audio') || typeStr.includes('voice')) {
          isVoiceInput = true;
          voiceToken = att.payload?.token || att.token || att.payload?.url || att.url || '';
          logger.info(`🎤 Найдено аудио, token: ${voiceToken}`);
          break;
        }
      }

      // 4. Если голосовое — распознаём
      if (isVoiceInput && voiceToken) {
        try {
          const audioBuffer = await this.downloadAudio(voiceToken);
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

      if (!text || !text.trim()) {
        logger.warn('⚠️ Empty text after processing');
        return res.status(200).send('ok');
      }

      const cleanId = String(chatId).replace(/^[a-z_]+/, '');
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
