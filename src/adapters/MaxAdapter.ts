import { Bot } from "@maxhub/max-bot-api";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { SelinCore } from "../core/SelinCore";
import { AIResponse, MessageContext, ChannelType } from "../core/types";
import { logger } from "../logger";

export class MaxAdapter {
  private bot: Bot | null = null;
  private core: SelinCore;
  private token: string | undefined;

  constructor(core: SelinCore, token?: string) {
    this.core = core;
    this.token = token || process.env.MAX_BOT_TOKEN;
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
    } catch (err: any) {
      logger.error(`❌ [MaxAdapter] Failed to initialize MAX Bot: ${err?.message || err}`);
    }
  }

  /**
   * Безопасная отправка сообщения в чат MAX
   */
  public async safeSendMessageToChat(
    chatId: number | string,
    text: string | null | undefined,
    extra?: any
  ): Promise<any> {
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

    const textToSend = (text === "" && extra) ? undefined : text;

    try {
      const message = await this.bot.api.sendMessageToChat(numericId, textToSend as any, extra);
      logger.info(`✅ [MaxAdapter] Message successfully sent to Max chat ${numericId}`);
      return message;
    } catch (err: any) {
      logger.error("❌ [MaxAdapter] Max send failed in safeSendMessageToChat", {
        chatId: numericId,
        message: err?.message
      });

      // Fallback: попытаться отправить обычный текст если была отправка с вложениями
      if (extra && text) {
        try {
          return await this.bot.api.sendMessageToChat(numericId, text);
        } catch (fallbackErr: any) {
          logger.error(`❌ [MaxAdapter] Fallback plain-text send failed: ${fallbackErr?.message || fallbackErr}`);
        }
      }

      throw err;
    }
  }

  /**
   * Синтез и отправка голосового сообщения в чат MAX
   */
  public async synthesizeAndSendVoice(chatId: string | number, text: string): Promise<void> {
    const cleanIdStr = String(chatId).replace(/^[a-z_]+/, '');
    const numericId = parseInt(cleanIdStr, 10);

    // Очистка текста от Markdown и спецсимволов для чистого синтеза речи
    let cleanText = String(text)
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]+`/g, '')
      .replace(/[#*_~>]/g, '')
      .replace(/[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanText) {
      logger.warn("⚠️ [MaxAdapter] synthesizeAndSendVoice: text is empty after cleaning.");
      return;
    }

    logger.info(`🎙️ [MaxAdapter] Starting voice synthesis for chat ${numericId} (${cleanText.length} chars)`);

    let audioBuffer: Buffer | null = null;

    // 1. Попытка через внешний TTS API (OpenAI / Teamo)
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
        }
      } catch (err: any) {
        logger.warn(`⚠️ [MaxAdapter] OpenAI TTS failed, fallback to Edge TTS: ${err?.message || err}`);
      }
    }

    // 2. Резервный синтез через MsEdgeTTS
    if (!audioBuffer) {
      try {
        const tts = new MsEdgeTTS();
        const voiceName = process.env.EDGE_TTS_VOICE || 'ru-RU-SvetlanaNeural';
        await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
        const streamRes = tts.toStream(cleanText);
        const readable = (streamRes && (streamRes as any).audioStream) ? (streamRes as any).audioStream : streamRes;

        const chunks: Buffer[] = [];
        for await (const chunk of readable) {
          if (Buffer.isBuffer(chunk)) chunks.push(chunk);
          else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk));
        }
        audioBuffer = Buffer.concat(chunks);
      } catch (err: any) {
        logger.error(`❌ [MaxAdapter] Edge TTS failed: ${err?.message || err}`);
      }
    }

    // 3. Загрузка в MAX Storage и отправка
    if (audioBuffer && audioBuffer.length > 0 && this.bot) {
      try {
        const maxToken = this.token || process.env.MAX_BOT_TOKEN;
        const initRes = await fetch('https://platform-api.max.ru/uploads?type=audio', {
          method: 'POST',
          headers: { 'Authorization': maxToken || '' },
          signal: AbortSignal.timeout(15000)
        });

        if (initRes.ok) {
          const initData = await initRes.json();
          const token = initData.token;
          const url = initData.url;

          if (token && url) {
            const form = new FormData();
            const fileBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });
            form.append('data', fileBlob, 'voice.mp3');

            const uploadRes = await fetch(url, {
              method: 'POST',
              body: form,
              signal: AbortSignal.timeout(20000)
            });

            if (uploadRes.ok) {
              await new Promise(r => setTimeout(r, 2000));
              await this.bot.api.sendMessageToChat(numericId, '', {
                attachments: [{
                  type: 'audio',
                  payload: {
                    token: token
                  } as any
                }]
              });
              logger.info(`✅ [MaxAdapter] Voice successfully sent to chat ${numericId}`);
              return;
            }
          }
        }
      } catch (uploadErr: any) {
        logger.error(`❌ [MaxAdapter] Storage upload error: ${uploadErr?.message || uploadErr}`);
      }
    }

    // Фолбэк на текстовое сообщение
    await this.safeSendMessageToChat(numericId, cleanText);
  }

  /**
   * Скачивание аудиофайла из MAX Messenger
   */
  private async downloadAudio(fileUrlOrId: string): Promise<Buffer> {
    let url = fileUrlOrId.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://platform-api.max.ru/uploads/${url}`;
    }

    const maxToken = this.token || process.env.MAX_BOT_TOKEN;
    const response = await fetch(url, {
      headers: maxToken ? { 'Authorization': maxToken } : {},
      signal: AbortSignal.timeout(25000)
    });

    if (!response.ok) {
      throw new Error(`Failed to download audio from MAX. Status: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Транскрибация аудио через Whisper STT
   */
  private async transcribeAudio(audioBuffer: Buffer): Promise<string> {
    const key = process.env.GROQ_API_KEY;
    if (!key) {
      logger.warn("⚠️ [MaxAdapter] GROQ_API_KEY is not defined for STT.");
      return "";
    }

    const form = new FormData();
    const fileBlob = new Blob([audioBuffer], { type: 'audio/ogg' });
    form.append('file', fileBlob, 'voice.ogg');
    form.append('model', 'whisper-large-v3');
    form.append('language', 'ru');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`
      },
      body: form,
      signal: AbortSignal.timeout(25000)
    });

    if (!response.ok) {
      throw new Error(`STT request failed with status ${response.status}`);
    }

    const data: any = await response.json();
    return data?.text || "";
  }

  /**
   * Отправка ответа пользователю
   */
  public async sendMessage(chatId: string, response: AIResponse): Promise<void> {
    const cleanId = chatId.replace(/^[a-z_]+/, '');

    if (response.voice && response.text) {
      try {
        await this.synthesizeAndSendVoice(cleanId, response.text);
        return;
      } catch (err: any) {
        logger.warn(`⚠️ [MaxAdapter] synthesizeAndSendVoice failed, falling back to text: ${err?.message || err}`);
      }
    }

    await this.safeSendMessageToChat(cleanId, response.text);
  }

  /**
   * Обработка входящего webhook запроса
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

      // 3. Проверяем аудиовложения
      let isVoiceInput = false;
      let voiceUrlOrId = raw.audio_url || raw.payload?.audio_url || '';

      const allAttachments: any[] = [];
      if (Array.isArray(raw.attachments)) allAttachments.push(...raw.attachments);
      if (Array.isArray(raw.payload?.attachments)) allAttachments.push(...raw.payload.attachments);
      if (Array.isArray(raw.message?.attachments)) allAttachments.push(...raw.message.attachments);

      for (const att of allAttachments) {
        const typeStr = String(att?.type || '').toLowerCase();
        if (typeStr.includes('audio') || typeStr.includes('voice')) {
          isVoiceInput = true;
          voiceUrlOrId = att.payload?.url || att.url || att.payload?.token || att.token || att.file_url || voiceUrlOrId;
          break;
        }
      }

      if (raw.type === 'voice' || raw.type === 'audio') {
        isVoiceInput = true;
      }

      const cleanId = String(chatId).replace(/^[a-z_]+/, '');

      // Если голосовое сообщение — транскрибируем
      if (isVoiceInput && voiceUrlOrId) {
        try {
          const audioBuffer = await this.downloadAudio(voiceUrlOrId);
          const transcribedText = await this.transcribeAudio(audioBuffer);
          if (transcribedText && transcribedText.trim()) {
            text = transcribedText.trim();
          }
        } catch (vErr: any) {
          logger.error(`❌ [MaxAdapter] Voice processing failed: ${vErr?.message || vErr}`);
        }
      }

      if (!text || !text.trim()) {
        return res.status(200).send('ok');
      }

      const context: MessageContext = {
        chatId: cleanId,
        tenantId: `max_${cleanId}`,
        channel: ChannelType.MAX,
        isVoice: isVoiceInput,
        timestamp: Date.now()
      };

      // Неблокирующая передача в SelinCore
      this.core.processMessage(text, context).then(async (aiResponse) => {
        await this.sendMessage(cleanId, aiResponse);
      }).catch(err => {
        logger.error(`❌ [MaxAdapter] Error processing message in SelinCore: ${err?.message || err}`);
      });

      return res.status(200).send('ok');
    } catch (err: any) {
      logger.error(`❌ [MaxAdapter] handleWebhook critical error: ${err?.message || err}`);
      return res.status(200).send('ok');
    }
  }
}
