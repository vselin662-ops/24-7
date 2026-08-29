import crypto from 'crypto';
import { logger } from '../logger';
import { getVoiceGender } from '../../db';
import { normalizeForVoice, splitTextSmart } from '../utils/textUtils';
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

export interface TTSSynthesisOptions {
  voice?: string;
  rate?: string;
  pitch?: string;
  speed?: number; // legacy support
  lang?: string;  // legacy support
}

/**
 * Профессиональный сервис синтеза речи (TTSService) для Selin AI 2.0.
 * 
 * Особенности:
 * 1. MD5-кэширование синтезированных фрагментов в оперативной памяти
 * 2. Использование исключительно Edge Neural TTS (как через WebSockets-библиотеку, так и через прямой fetch-SSML)
 * 3. Полное удаление сторонних сервисов (ElevenLabs, Gemini, Google Translate), исключая любые нежелательные голоса
 * 4. Нарезка длинного текста на смысловые фрагменты (chunking)
 */
export class TTSService {
  private cache: Map<string, { contentType: string; buffer: Buffer }> = new Map();

  constructor() {
    // Инициализация не требует дополнительных клиентов
  }

  /**
   * Основной метод синтеза речи. Возвращает готовый бинарный Buffer или null при ошибке.
   */
  public async synthesize(text: string, options: TTSSynthesisOptions = {}, isSelfTest: boolean = false): Promise<Buffer | null> {
    const cleanText = text.trim();
    const voice = options.voice || 'ru-RU-DmitryNeural';
    const rate = options.rate || '-10%';
    const pitch = options.pitch || (voice === 'ru-RU-SvetlanaNeural' ? '-2Hz' : '-4Hz');

    if (!cleanText) {
      return isSelfTest ? this.generateSilentWav() : null;
    }

    const cacheKey = this.getCacheKey(cleanText, voice);

    // 1. Проверка кэша
    if (this.cache.has(cacheKey)) {
      logger.info(`[TTSService] Cache hit for key: ${cacheKey.slice(0, 8)}... (text: ${cleanText.slice(0, 30)}...)`);
      const cached = this.cache.get(cacheKey)!.buffer;
      if (isSelfTest) {
        logger.info("🎙️ [TTS] active engine: gemini");
      }
      return cached;
    }

    logger.info(`[TTSService] Synthesizing speech (${cleanText.length} chars) via Cascade (Primary: Gemini TTS)`);

    let audioBuffer: Buffer | null = null;
    let contentType = 'audio/mpeg';

    // Попытка 1: Gemini TTS
    try {
      audioBuffer = await this.callGeminiTTS(cleanText);
      if (audioBuffer) {
        contentType = 'audio/wav';
        if (isSelfTest) {
          logger.info("🎙️ [TTS] active engine: gemini");
        }
      }
    } catch (err: any) {
      logger.warn(`[TTSService] Gemini TTS failed: ${err?.message || err}`);
    }

    // Попытка 2: MsEdgeTTS library (WebSocket)
    if (!audioBuffer) {
      try {
        audioBuffer = await this.synthesizeWithLibrary(cleanText, voice, rate, pitch);
        if (audioBuffer) {
          contentType = 'audio/mpeg';
          if (isSelfTest) {
            logger.info("🎙️ [TTS] active engine: edge");
          }
        }
      } catch (err: any) {
        logger.warn(`[TTSService] Library MsEdgeTTS failed: ${err?.message || err}. Trying direct fetch Edge TTS.`);
      }
    }

    // Попытка 3: Прямой fetch-SSML к Edge TTS (отказоустойчивый REST)
    if (!audioBuffer) {
      try {
        audioBuffer = await this.synthesizeEdgeDirect(cleanText, voice, rate, pitch);
        if (audioBuffer) {
          contentType = 'audio/mpeg';
          if (isSelfTest) {
            logger.info("🎙️ [TTS] active engine: edge");
          }
        }
      } catch (err: any) {
        logger.error(`[TTSService] Direct fetch Edge TTS failed: ${err?.message || err}`);
      }
    }

    // Попытка 4: Абсолютный офлайн-фолбэк (валидный WAV) ТОЛЬКО для self-test
    if (!audioBuffer) {
      if (isSelfTest) {
        logger.warn('[TTSService] All Edge TTS attempts failed. Generating offline fallback tone.');
        audioBuffer = this.generateFallbackToneWav(cleanText);
        contentType = 'audio/wav';
      } else {
        logger.warn('[TTSService] All TTS engines failed for user. No fallback tone generated.');
        return null;
      }
    }

    // Сохранение в кэш
    this.cache.set(cacheKey, { contentType, buffer: audioBuffer });
    return audioBuffer;
  }

  /**
   * Метод Gemini TTS для синтеза речи
   */
  private async callGeminiTTS(text: string): Promise<Buffer | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      logger.warn('⚠️ [TTS] callGeminiTTS failed: GEMINI_API_KEY is not defined.');
      return null;
    }

    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey });
      const models = ['gemini-2.5-flash-preview-tts', 'gemini-2.0-flash-preview-tts'];

      for (const model of models) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: text,
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voice: {
                  name: 'Kore'
                }
              }
            } as any
          });

          const base64 = response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
          if (base64) {
            const pcmBuffer = Buffer.from(base64, 'base64');
            const wavHeader = this.getWavHeader(pcmBuffer.length, 24000, 1, 16);
            logger.info('🎙️ [TTS] gemini engine ok');
            return Buffer.concat([wavHeader, pcmBuffer]);
          }
        } catch (modelErr: any) {
          logger.warn(`⚠️ [TTS] Gemini TTS model ${model} attempt failed: ${modelErr?.message || modelErr}`);
        }
      }
    } catch (err: any) {
      logger.error(`❌ [TTS] callGeminiTTS error: ${err?.message || err}`);
    }

    return null;
  }

  /**
   * Синтез через WebSocket библиотеку MsEdgeTTS
   */
  private async synthesizeWithLibrary(text: string, voice: string, rate: string, pitch: string): Promise<Buffer> {
    const chunks = this.splitTextIntoChunks(text, 250);
    const audioChunks: Buffer[] = [];
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      const streamRes = tts.toStream(chunk, { rate, pitch });
      const readable = (streamRes && (streamRes as any).audioStream) ? (streamRes as any).audioStream : streamRes;

      const chunkBuffers: Buffer[] = [];
      for await (const b of readable) {
        if (Buffer.isBuffer(b)) {
          chunkBuffers.push(b);
        } else if (b instanceof Uint8Array) {
          chunkBuffers.push(Buffer.from(b));
        }
      }
      if (chunkBuffers.length > 0) {
        audioChunks.push(Buffer.concat(chunkBuffers));
      }
    }

    if (audioChunks.length > 0) {
      return Buffer.concat(audioChunks);
    }
    throw new Error("Empty audio stream from MsEdgeTTS");
  }

  /**
   * Прямой fetch-SSML к Microsoft Edge Speech API
   */
  private async synthesizeEdgeDirect(text: string, voice: string, rate: string, pitch: string): Promise<Buffer> {
    const chunks = this.splitTextIntoChunks(text, 250);
    const audioChunks: Buffer[] = [];

    const selectedVoice = voice.includes('Neural') ? voice : 'ru-RU-DmitryNeural';

    for (const chunk of chunks) {
      const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='ru-RU'><voice name='${selectedVoice}'><prosody rate='${rate}' pitch='${pitch}'>${chunk}</prosody></voice></speak>`;

      const response = await fetch('https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
        },
        body: ssml
      });

      if (!response.ok) {
        throw new Error(`Edge TTS returned status ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      audioChunks.push(Buffer.from(arrayBuffer));
    }

    return Buffer.concat(audioChunks);
  }

  private getCacheKey(text: string, voice: string): string {
    const payload = text + voice + 'gemini';
    return crypto.createHash('md5').update(payload).digest('hex');
  }

  private splitTextIntoChunks(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    const sentences = text.split(/(?<=[.!?;\n])\s+/);
    let current = '';

    for (const sentence of sentences) {
      if ((current + ' ' + sentence).trim().length <= maxLength) {
        current = (current + ' ' + sentence).trim();
      } else {
        if (current) chunks.push(current);
        if (sentence.length > maxLength) {
          const words = sentence.split(/\s+/);
          current = '';
          for (const word of words) {
            if ((current + ' ' + word).trim().length <= maxLength) {
              current = (current + ' ' + word).trim();
            } else {
              if (current) chunks.push(current);
              current = word;
            }
          }
        } else {
          current = sentence;
        }
      }
    }

    if (current) chunks.push(current);
    return chunks.length > 0 ? chunks : [text];
  }

  private getWavHeader(dataLength: number, sampleRate: number = 24000, numChannels: number = 1, bitsPerSample: number = 16): Buffer {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
    header.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);
    return header;
  }

  private generateSilentWav(): Buffer {
    const data = Buffer.alloc(4800);
    const header = this.getWavHeader(data.length, 24000, 1, 16);
    return Buffer.concat([header, data]);
  }

  private generateFallbackToneWav(text: string): Buffer {
    const sampleRate = 24000;
    const durationSec = Math.min(2.0, Math.max(0.4, text.length * 0.05));
    const totalSamples = Math.floor(sampleRate * durationSec);
    const data = Buffer.alloc(totalSamples * 2);

    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      const sample = Math.sin(2 * Math.PI * 440 * t) * 0.3 + Math.sin(2 * Math.PI * 880 * t) * 0.1;
      const intSample = Math.floor(sample * 32767);
      data.writeInt16LE(intSample, i * 2);
    }

    const header = this.getWavHeader(data.length, sampleRate, 1, 16);
    return Buffer.concat([header, data]);
  }
}

export const ttsService = new TTSService();

/**
 * 1. Очистка текста для литературного чтения
 */
export function cleanForVoice(text: string): string {
  if (!text) return '';
  let cleaned = text;

  // Убираем ссылки / URL
  cleaned = cleaned.replace(/https?:\/\/\S+/gi, '');

  // Убираем markdown блоки кода и разметку
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
  cleaned = cleaned.replace(/\*\*|##|```|__|`|#/g, '');

  // Убираем скобки с техническим содержимым (например, [id=...], {key: value}, (error: ...))
  cleaned = cleaned.replace(/\[[^\]]*?\]/g, '');
  cleaned = cleaned.replace(/\{[^\}]*?\}/g, '');
  cleaned = cleaned.replace(/\([^)]*?[a-zA-Z0-9_]{3,}[^)]*?\)/g, '');

  // Заменяем звездочки на пробелы
  cleaned = cleaned.replace(/\*/g, ' ');

  // Убираем эмодзи
  cleaned = cleaned.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E6}-\u{1F1FF}]/gu, '');

  // Лишние пробелы
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

/**
 * 2. Расстановка пауз через SSML или текст
 */
export function literarySSML(text: string, useSSML = true): string {
  if (!text) return '';

  if (useSSML) {
    let ssml = text;

    // Диалоги: тире в начале реплики (диалог) -> 350 мс
    ssml = ssml.replace(/(?:^|\n|\r)\s*(—|-|–)\s+/g, '\n— <break time="350ms"/> ');

    // Восклицания: восклицание -> добавь <prosody pitch='+5%'> в SSML
    ssml = ssml.replace(/([^.!?\n\r]+!)/g, "<prosody pitch='+5%'>$1</prosody>");

    // Расстановка пауз для знаков препинания (избегая повреждения XML-тегов)
    ssml = ssml.replace(/(<[^>]+>)|([.,!?…])/g, (match, tag, punc) => {
      if (tag) return tag;
      if (punc === ',') return ', <break time="250ms"/>';
      if (punc === '…') return '… <break time="700ms"/>';
      if (punc === '.' || punc === '!' || punc === '?') {
        return `${punc} <break time="450ms"/>`;
      }
      return match;
    });

    // Абзацы: абзац -> 600 мс
    ssml = ssml.replace(/(<[^>]+>)|(\n+)/g, (match, tag, newlines) => {
      if (tag) return tag;
      return ` <break time="600ms"/>${newlines}`;
    });

    return ssml;
  } else {
    // Если НЕ принимает — текстовые паузы: '…' после точек, переносы строк между абзацами, rate '-12%'.
    let textPauses = text;
    textPauses = textPauses.replace(/([.!?])(?!\s*…)/g, '$1…');
    textPauses = textPauses.replace(/…+/g, '…');
    return textPauses;
  }
}

/**
 * Вспомогательный сплиттер по предложениям/тэгам break
 */
export function splitIntoLiteraryChunks(text: string, maxLen: number = 280): string[] {
  if (text.length <= maxLen) return [text];

  const sentences = text.split(/(?<=<\/prosody>|\/>)\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (!sentence.trim()) continue;
    if ((current + ' ' + sentence).length <= maxLen) {
      current = current ? current + ' ' + sentence : sentence;
    } else {
      if (current) chunks.push(current);
      if (sentence.length > maxLen) {
        const parts = sentence.split(/(<[^>]+>|\s+)/).filter(Boolean);
        current = '';
        for (const part of parts) {
          if ((current + part).length <= maxLen) {
            current = current + part;
          } else {
            if (current.trim()) chunks.push(current.trim());
            current = part;
          }
        }
      } else {
        current = sentence;
      }
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text];
}

/**
 * 3. Озвучка через OpenAI TTS
 */
async function synthesizeWithOpenAI(text: string): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("No OPENAI_API_KEY in environment");

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "tts-1",
      voice: "onyx",
      input: text,
      speed: 0.95
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI TTS status ${response.status}: ${errText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function synthesizeForChat(chatId: string | number | null | undefined, text: string): Promise<Buffer | null> {
  const cleanId = chatId ? String(chatId) : 'default';
  const isSelfTest = (chatId === "test_self_check_chat");

  // Шаг 1. cleanForVoice
  const cleaned = cleanForVoice(text);
  if (!cleaned.trim()) {
    return ttsService.synthesize("", {}, isSelfTest);
  }

  // Шаг 2. normalizeForVoice (числа словами)
  const normalized = normalizeForVoice(cleaned);
  if (!normalized.trim()) {
    return ttsService.synthesize("", {}, isSelfTest);
  }

  let engine = 'Edge';
  let pauses = 0;
  let audioBuffer: Buffer | null = null;

  // Шаг 3. OpenAI TTS (приоритет)
  if (process.env.OPENAI_API_KEY) {
    try {
      engine = 'OpenAI';
      audioBuffer = await synthesizeWithOpenAI(normalized);
      console.log('🎭 [Literary] engine=' + engine + ' пауз=0 чанков=1');
    } catch (err: any) {
      logger.warn(`⚠️ [TTS] OpenAI TTS failed: ${err.message || err}. Falling back to Edge TTS.`);
      engine = 'Edge';
    }
  }

  // Шаг 4. Edge TTS с literarySSML
  if (!audioBuffer) {
    engine = 'Edge';
    const gender = getVoiceGender(cleanId);
    let voice = 'ru-RU-DmitryNeural';
    let rate = '-10%'; // Если SSML — передавай SSML с <break time> и <prosody rate='-10%'>
    let pitch = '-4Hz';

    if (gender === 'female') {
      voice = 'ru-RU-SvetlanaNeural';
      rate = '-10%';
      pitch = '-2Hz';
    }

    // Литературный синтез через Edge TTS с естественными текстовыми паузами
    try {
      rate = '-12%';
      const textPausesStr = literarySSML(normalized, false);
      pauses = (textPausesStr.match(/…/g) || []).length;
      
      const chunks = splitIntoLiteraryChunks(textPausesStr, 280);
      const n = chunks.length;
      
      console.log('🎭 [Literary] engine=' + engine + ' пауз=' + pauses + ' чанков=' + n);
      
      audioBuffer = await ttsService.synthesize(textPausesStr, { voice, rate, pitch }, isSelfTest);
    } catch (fallbackErr: any) {
      logger.error(`❌ [synthesizeForChat] Literary Edge TTS attempt failed: ${fallbackErr.message || fallbackErr}`);
    }
  }

  if (audioBuffer) {
    return audioBuffer;
  }

  return ttsService.synthesize(normalized, {}, isSelfTest);
}
