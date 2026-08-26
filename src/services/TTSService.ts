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
   * Основной метод синтеза речи. Возвращает готовый бинарный Buffer.
   */
  public async synthesize(text: string, options: TTSSynthesisOptions = {}): Promise<Buffer> {
    const cleanText = text.trim();
    if (!cleanText) {
      return this.generateSilentWav();
    }

    const cacheKey = this.getCacheKey(cleanText, options);

    // 1. Проверка кэша
    if (this.cache.has(cacheKey)) {
      logger.info(`[TTSService] Cache hit for key: ${cacheKey.slice(0, 8)}... (text: ${cleanText.slice(0, 30)}...)`);
      return this.cache.get(cacheKey)!.buffer;
    }

    logger.info(`[TTSService] Synthesizing speech (${cleanText.length} chars) via Edge TTS`);

    let audioBuffer: Buffer | null = null;
    let contentType = 'audio/mpeg';

    const voice = options.voice || 'ru-RU-DmitryNeural';
    const rate = options.rate || (voice === 'ru-RU-SvetlanaNeural' ? '-5%' : '-8%');
    const pitch = options.pitch || (voice === 'ru-RU-SvetlanaNeural' ? '-2Hz' : '-4Hz');

    // Попытка 1: MsEdgeTTS library (WebSocket)
    try {
      audioBuffer = await this.synthesizeWithLibrary(cleanText, voice, rate, pitch);
    } catch (err: any) {
      logger.warn(`[TTSService] Library MsEdgeTTS failed: ${err?.message || err}. Trying direct fetch Edge TTS.`);
    }

    // Попытка 2: Прямой fetch-SSML к Edge TTS (отказоустойчивый REST)
    if (!audioBuffer) {
      try {
        audioBuffer = await this.synthesizeEdgeDirect(cleanText, voice, rate, pitch);
      } catch (err: any) {
        logger.error(`[TTSService] Direct fetch Edge TTS failed: ${err?.message || err}`);
      }
    }

    // Попытка 3: Абсолютный офлайн-фолбэк (валидный WAV)
    if (!audioBuffer) {
      logger.warn('[TTSService] All Edge TTS attempts failed. Generating offline fallback tone.');
      audioBuffer = this.generateFallbackToneWav(cleanText);
      contentType = 'audio/wav';
    }

    // Сохранение в кэш
    this.cache.set(cacheKey, { contentType, buffer: audioBuffer });
    return audioBuffer;
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

  private getCacheKey(text: string, options: any): string {
    const payload = `${text}_${JSON.stringify(options || {})}`;
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

export async function synthesizeForChat(chatId: string | number | null | undefined, text: string): Promise<Buffer> {
  const cleanId = chatId ? String(chatId) : 'default';
  const gender = getVoiceGender(cleanId);
  
  let voice = 'ru-RU-DmitryNeural';
  let rate = '-8%';
  let pitch = '-4Hz';
  
  if (gender === 'female') {
    voice = 'ru-RU-SvetlanaNeural';
    rate = '-5%';
    pitch = '-2Hz';
  }
  
  const normalizedText = normalizeForVoice(text);
  if (!normalizedText.trim()) {
    return ttsService.synthesize("");
  }
  
  const count = (text.match(/\d+/g) || []).length;
  console.log(`🎙️ [TTS] voice=${voice} chat=${cleanId} rate=${rate} pitch=${pitch} замен=${count}`);
  
  const chunks = splitTextSmart(normalizedText, 250);
  const audioChunks: Buffer[] = [];
  
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    
    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      // Явная передача параметров rate и pitch
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
  } catch (err: any) {
    logger.warn(`⚠️ [synthesizeForChat] MsEdgeTTS failed: ${err.message || err}. Falling back to default ttsService.`);
    // Фолбэк на ttsService.synthesize с теми же параметрами голоса
    return ttsService.synthesize(normalizedText, { voice, rate, pitch });
  }
}
