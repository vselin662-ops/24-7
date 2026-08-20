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
  private defaultVoiceMode: VoiceMode = VoiceMode.TEXT_TO_VOICE;

  constructor(core: SelinCore, token?: string, defaultMode: VoiceMode = VoiceMode.TEXT_TO_VOICE) {
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
   * Синтез и отправка голосового сообщения в чат MAX
   * 1. Очистка текста от Markdown и спецсимволов
   * 2. Обрезка до 500 символов с сохранением целых предложений
   * 3. Добавление "Хотите, я продолжу?" при обрезке
   * 4. Каскад TTS: OpenAI TTS -> Edge TTS -> VoiceService (Google/Fallback)
   * 5. Загрузка в MAX Storage (MP3) и отправка в чат
   */
  public async synthesizeAndSendVoice(chatId: string | number, text: string): Promise<void> {
    const cleanIdStr = String(chatId).replace(/^[a-z_]+/, '');
    const numericId = parseInt(cleanIdStr.replace(/\D/g, ''), 10);

    if (isNaN(numericId) || numericId <= 0) {
      logger.error("❌ [MaxAdapter] Invalid chatId for voice synthesis", { chatId });
      return;
    }

    // 1. Очистка текста от Markdown, кода, ссылок, эмодзи и спецсимволов
    let cleanText = String(text || "")
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]+`/g, '')
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
      .replace(/[#*_~>|]/g, '')
      .replace(/[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanText) {
      logger.warn("⚠️ [MaxAdapter] synthesizeAndSendVoice: text is empty after cleaning.");
      return;
    }

    // 2. Обрезка текста до 500 символов (~1.5 мин речи) с сохранением целых предложений
    const MAX_VOICE_LENGTH = 500;
    if (cleanText.length > MAX_VOICE_LENGTH) {
      let cutIndex = -1;
      const punctuationMarks = ['. ', '! ', '? ', '.\n', '!\n', '?\n', '\n'];

      for (const p of punctuationMarks) {
        const lastIdx = cleanText.lastIndexOf(p, MAX_VOICE_LENGTH);
        if (lastIdx > cutIndex && lastIdx >= 120) {
          cutIndex = lastIdx + 1;
        }
      }

      if (cutIndex === -1) {
        const lastSpace = cleanText.lastIndexOf(' ', MAX_VOICE_LENGTH - 25);
        cutIndex = lastSpace > 100 ? lastSpace : MAX_VOICE_LENGTH - 25;
      }

      cleanText = cleanText.slice(0, cutIndex).trim() + " Хотите, я продолжу?";
      logger.info(`✂️ [MaxAdapter] Text trimmed to ${cleanText.length} chars for audio speech`);
    }

    logger.info(`🎙️ [MaxAdapter] Starting voice synthesis for chat ${numericId} (${cleanText.length} chars)`);

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
            input: cleanText,
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

    // --- Шаг 2 каскада: Microsoft Edge TTS ---
    if (!audioBuffer || audioBuffer.length === 0) {
      try {
        const tts = new MsEdgeTTS();
        const voiceName = process.env.EDGE_TTS_VOICE || 'ru-RU-SvetlanaNeural';
        await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
        const streamRes = tts.toStream(cleanText);
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

    // --- Шаг 3 каскада: VoiceService (Google Translate / ElevenLabs / Generator) ---
    if (!audioBuffer || audioBuffer.length === 0) {
      try {
        audioBuffer = await this.voiceService.synthesize(cleanText, { provider: 'auto', lang: 'ru' });
        if (audioBuffer && audioBuffer.length > 0) {
          logger.info(`✅ [MaxAdapter] Speech synthesized via VoiceService (${audioBuffer.length} bytes)`);
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.warn(`⚠️ [MaxAdapter] VoiceService synthesis failed: ${errorMsg}`);
      }
    }

    // --- Шаг 4: Загрузка в MAX Storage и отправка в чат ---
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
              logger.info(`🎤 [MaxAdapter] Voice message successfully sent to chat ${numericId}`);
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
    logger.warn(`⚠️ [MaxAdapter] Voice cascade completed without delivery, falling back to text for chat ${numericId}`);
    await this.safeSendMessageToChat(numericId, cleanText);
  }

  /**
   * Скачивание аудиофайла из MAX Messenger
   */
  private async downloadAudio(token: string): Promise<Buffer> {
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
   * Транскрибация аудио через Whisper STT (Groq API)
   */
  private async transcribeAudio(audioBuffer: Buffer): Promise<string> {
    const key = process.env.GROQ_API_KEY;
    if (!key) {
      logger.warn('⚠️ GROQ_API_KEY не задан');
      return '';
    }

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

    if (!response.ok) {
      throw new Error(`STT failed: ${response.status}`);
    }

    const data = await response.json();
    return data?.text || '';
  }

  /**
   * Отправка ответа пользователю с учетом режима работы с голосом (VoiceMode)
   * 1. TEXT_TO_TEXT: отправка текстового сообщения
   * 2. TEXT_TO_VOICE: синтез и отправка голосового сообщения (с фолбэком на текст)
   * 3. VOICE_TO_VOICE: полный голосовой диалог (синтез голоса с фолбэком на текст)
   */
  public async sendMessage(chatId: string, response: AIResponse, isVoiceInput: boolean = false): Promise<void> {
    const cleanId = String(chatId).replace(/^[a-z_]+/, '');

    // Если пришло голосовое → отвечаем голосом
    if (isVoiceInput) {
      try {
        await this.synthesizeAndSendVoice(cleanId, response.text);
        logger.info(`🎤 Голосовой ответ на голосовое сообщение`);
        return;
      } catch (err) {
        logger.warn('⚠️ Голос упал, отправляем текст');
      }
    }

    // Если текст → текст (по умолчанию)
    await this.safeSendMessageToChat(cleanId, response.text);
  }

  /**
   * Обработка входящего webhook запроса от MAX Messenger
   */
  public async handleWebhook(req: any, res: any): Promise<void> {
    try {
      const raw = req.body || {};
      logger.info(`📨 [MaxAdapter] Webhook received`);

      // 1. Извлекаем chatId
      let chatId = raw.chat_id || raw.payload?.chat_id || raw.body?.chat_id;
      if (!chatId && raw.message) {
        chatId = raw.message.chat_id || raw.message.recipient?.chat_id;
      }
      if (!chatId && raw.payload?.message) {
        chatId = raw.payload.message.chat_id || raw.payload.message.recipient?.chat_id;
      }

      if (!chatId) {
        logger.error("❌ [MaxAdapter] No ChatID found in webhook payload");
        return res.status(200).send('ok');
      }

      // 2. Извлекаем текст
      let text = '';
      const textCandidates = [
        raw.text,
        raw.payload?.text,
        raw.body?.text,
        raw.message?.text,
        raw.message?.body?.text,
        raw.payload?.message?.text
      ];
      for (const cand of textCandidates) {
        if (cand !== undefined && cand !== null && String(cand).trim() !== '') {
          text = String(cand).trim();
          break;
        }
      }

      // 3. Определяем, голосовое ли сообщение
      let isVoiceInput = false;
      let voiceToken = '';

      // Проверяем attachments
      const attachments = raw.attachments || raw.message?.attachments || raw.payload?.attachments || [];
      for (const att of attachments) {
        if (att.type === 'audio' || att.type === 'voice') {
          isVoiceInput = true;
          voiceToken = att.payload?.token || att.token || att.payload?.url || att.url || '';
          break;
        }
      }

      if (raw.type === 'voice' || raw.type === 'audio') {
        isVoiceInput = true;
        if (!voiceToken) {
          voiceToken = raw.audio_url || raw.payload?.audio_url || raw.voice_token || '';
        }
      }

      const cleanId = String(chatId).replace(/^[a-z_]+/, '');

      // Если это голосовое сообщение
      if (isVoiceInput && voiceToken) {
        try {
          // Скачиваем аудио
          const audioBuffer = await this.downloadAudio(voiceToken);
          // Распознаём речь
          const transcribedText = await this.transcribeAudio(audioBuffer);
          if (!transcribedText || transcribedText.trim() === '') {
            // Отвечаем голосом: "Не расслышал, повторите"
            await this.synthesizeAndSendVoice(cleanId, 'Извините, я не расслышала. Повторите, пожалуйста.');
            return res.status(200).send('ok');
          }
          text = transcribedText;
        } catch (err) {
          logger.error('Voice recognition failed:', err);
          // Если распознать не удалось — отвечаем голосом с просьбой повторить
          try {
            await this.synthesizeAndSendVoice(cleanId, 'Извините, возникла ошибка при обработке аудио. Повторите, пожалуйста.');
          } catch {
            await this.safeSendMessageToChat(cleanId, 'Извините, не удалось распознать голосовое сообщение.');
          }
          return res.status(200).send('ok');
        }
      }

      if (!text || !text.trim()) {
        logger.warn(`⚠️ [MaxAdapter] Empty text after processing webhook for chatId ${cleanId}`);
        return res.status(200).send('ok');
      }

      // 5. Проверка команд смены режима голоса
      const lowerText = text.trim().toLowerCase();
      if (lowerText === '/mode text' || lowerText === '/text' || lowerText === '/режим текст') {
        this.setVoiceMode(cleanId, VoiceMode.TEXT_TO_TEXT);
        await this.safeSendMessageToChat(
          cleanId,
          "💬 Режим изменен: Текст → Текст (обычный чат без голосовых сообщений)."
        );
        return res.status(200).send('ok');
      }

      if (lowerText === '/mode voice' || lowerText === '/mode text_to_voice' || lowerText === '/tts' || lowerText === '/режим голос') {
        this.setVoiceMode(cleanId, VoiceMode.TEXT_TO_VOICE);
        await this.safeSendMessageToChat(
          cleanId,
          "🎤 Режим изменен: Текст → Голос (бот будет озвучивать свои ответы)."
        );
        return res.status(200).send('ok');
      }

      if (lowerText === '/mode voice_to_voice' || lowerText === '/mode v2v' || lowerText === '/v2v' || lowerText === '/режим диалог') {
        this.setVoiceMode(cleanId, VoiceMode.VOICE_TO_VOICE);
        try {
          await this.synthesizeAndSendVoice(
            cleanId,
            "Голосовой диалог активирован. Я на связи и буду отвечать вам голосом."
          );
        } catch {
          await this.safeSendMessageToChat(
            cleanId,
            "🎙️ Режим изменен: Голос → Голос (полный голосовой диалог)."
          );
        }
        return res.status(200).send('ok');
      }

      if (lowerText === '/mode' || lowerText === '/modes' || lowerText === '/режим') {
        const current = this.getVoiceMode(cleanId);
        const modeDesc = {
          [VoiceMode.TEXT_TO_TEXT]: "1. Текст → Текст (обычный чат)",
          [VoiceMode.TEXT_TO_VOICE]: "2. Текст → Голос (бот отвечает голосом)",
          [VoiceMode.VOICE_TO_VOICE]: "3. Голос → Голос (полный голосовой диалог)"
        }[current] || current;

        const info = `⚙️ Режимы работы с голосом в Selin AI 2.0:\n\n` +
          `Текущий режим: ${modeDesc}\n\n` +
          `Для переключения отправьте команду:\n` +
          `• /mode text — Текст → Текст (обычный чат)\n` +
          `• /mode voice — Текст → Голос (бот отвечает голосом)\n` +
          `• /mode voice_to_voice — Голос → Голос (полный голосовой диалог)`;

        await this.safeSendMessageToChat(cleanId, info);
        return res.status(200).send('ok');
      }

      const currentChatMode = this.getVoiceMode(cleanId);

      const context: MessageContext = {
        chatId: cleanId,
        tenantId: `max_${cleanId}`,
        channel: ChannelType.MAX,
        isVoice: isVoiceInput,
        voiceMode: currentChatMode,
        timestamp: Date.now()
      };

      // 6. Передача в SelinCore и отправка ответа
      try {
        const response = await this.core.processMessage(text, context);
        await this.sendMessage(cleanId, response, isVoiceInput);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(`❌ [MaxAdapter] Error processing message in SelinCore: ${errorMsg}`);
      }

      return res.status(200).send('ok');
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`❌ [MaxAdapter] handleWebhook critical error: ${errorMsg}`);
      return res.status(200).send('ok');
    }
  }
}
