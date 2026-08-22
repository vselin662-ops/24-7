import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import { logger } from '../logger';

export interface TTSSynthesisOptions {
  voice?: string;
  speed?: number;
  pitch?: number;
  lang?: string;
  provider?: 'gemini' | 'elevenlabs' | 'edge' | 'google' | 'auto';
  elevenLabsApiKey?: string;
  voiceId?: string;
}

/**
 * Профессиональный сервис синтеза речи (TTSService) для Selin AI 2.0.
 * 
 * Особенности:
 * 1. MD5-кэширование синтезированных фрагментов в оперативной памяти
 * 2. Каскадный отказоустойчивый синтез речи (ElevenLabs -> Gemini -> Edge TTS -> Google Translate -> WAV Generator)
 * 3. Поддержка параметров голоса (voice, pitch, speed, lang)
 * 4. Нарезка длинного текста на смысловые фрагменты (chunking)
 */
export class TTSService {
  private cache: Map<string, { contentType: string; buffer: Buffer }> = new Map();
  private geminiClient: GoogleGenAI | null = null;

  constructor() {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      this.geminiClient = new GoogleGenAI({ apiKey: geminiKey });
    }
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

    logger.info(`[TTSService] Synthesizing speech (${cleanText.length} chars), provider: ${options.provider || 'auto'}`);

    let audioBuffer: Buffer | null = null;
    let contentType = 'audio/mpeg';

    const provider = options.provider || 'auto';
    const elevenKey = options.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY;
    const elevenVoice = options.voiceId || options.voice || '21m00Tcm4TlvDq8ikWAM'; // Rachel/Default
    const lang = options.lang || 'ru';
    const voice = options.voice || process.env.EDGE_TTS_VOICE || 'ru-RU-DmitryNeural';
    const speed = options.speed || 1.0;
    const pitch = options.pitch || 0.0;

    // 2. ElevenLabs (если передан ключ или выбран провайдер)
    if ((provider === 'elevenlabs' || (provider === 'auto' && elevenKey)) && elevenKey) {
      try {
        audioBuffer = await this.synthesizeElevenLabs(cleanText, elevenKey, elevenVoice);
        contentType = 'audio/mpeg';
      } catch (err: any) {
        logger.warn(`[TTSService] ElevenLabs failed: ${err?.message || err}. Falling back to next provider.`);
      }
    }

    // 3. Gemini TTS (если доступен ключ Gemini)
    if (!audioBuffer && (provider === 'gemini' || provider === 'auto') && (this.geminiClient || process.env.GEMINI_API_KEY)) {
      try {
        audioBuffer = await this.synthesizeGemini(cleanText, voice);
        if (audioBuffer) contentType = 'audio/wav';
      } catch (err: any) {
        logger.warn(`[TTSService] Gemini TTS failed: ${err?.message || err}. Falling back to next provider.`);
      }
    }

    // 4. Edge TTS
    if (!audioBuffer && (provider === 'edge' || provider === 'auto')) {
      try {
        audioBuffer = await this.synthesizeEdge(cleanText, voice, speed, pitch);
        if (audioBuffer) contentType = 'audio/mpeg';
      } catch (err: any) {
        logger.warn(`[TTSService] Edge TTS failed: ${err?.message || err}. Falling back to Google Translate.`);
      }
    }

    // 5. Google Translate TTS (высокая доступность)
    if (!audioBuffer) {
      try {
        audioBuffer = await this.synthesizeGoogleTranslate(cleanText, lang);
        if (audioBuffer) contentType = 'audio/mpeg';
      } catch (err: any) {
        logger.error(`[TTSService] Google Translate TTS failed: ${err?.message || err}`);
      }
    }

    // 6. Абсолютный фолбэк (валидный синтезированный WAV буфер)
    if (!audioBuffer) {
      logger.warn('[TTSService] All online TTS providers failed. Generating fallback audio tone.');
      audioBuffer = this.generateFallbackToneWav(cleanText);
      contentType = 'audio/wav';
    }

    // Сохранение в кэш
    this.cache.set(cacheKey, { contentType, buffer: audioBuffer });
    return audioBuffer;
  }

  // ==========================================
  // Провайдеры синтеза речи
  // ==========================================

  /**
   * Синтез через Google Gemini Audio Capabilities
   */
  private async synthesizeGemini(text: string, voice: string): Promise<Buffer> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY is not set');

    if (!this.geminiClient) {
      this.geminiClient = new GoogleGenAI({ apiKey: key });
    }

    const response = await this.geminiClient.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: `Generate spoken voice audio for the following text without commentary: "${text}"` }] }],
      config: {
        responseModalities: ['AUDIO']
      }
    });

    const candidates = response.candidates;
    if (candidates && candidates[0]?.content?.parts) {
      for (const part of candidates[0].content.parts) {
        if ((part as any).inlineData?.data) {
          return Buffer.from((part as any).inlineData.data, 'base64');
        }
      }
    }

    throw new Error('No audio returned from Gemini');
  }

  /**
   * Синтез через Microsoft Edge Neural TTS API
   */
  private async synthesizeEdge(text: string, voice: string, speed: number, pitch: number): Promise<Buffer> {
    const chunks = this.splitTextIntoChunks(text, 250);
    const audioChunks: Buffer[] = [];

    const ratePercent = `${Math.round((speed - 1.0) * 100)}%`;
    const pitchHz = `${Math.round(pitch)}Hz`;
    const selectedVoice = voice.includes('Neural') ? voice : (process.env.EDGE_TTS_VOICE || 'ru-RU-DmitryNeural');

    for (const chunk of chunks) {
      const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='ru-RU'><voice name='${selectedVoice}'><prosody rate='${ratePercent}' pitch='${pitchHz}'>${chunk}</prosody></voice></speak>`;

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

  /**
   * Синтез через Google Translate TTS
   */
  private async synthesizeGoogleTranslate(text: string, lang: string): Promise<Buffer> {
    const chunks = this.splitTextIntoChunks(text, 180);
    const buffers: Buffer[] = [];

    for (const chunk of chunks) {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=${encodeURIComponent(lang)}&client=tw-ob`;
      
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!res.ok) {
        throw new Error(`Google Translate TTS failed with status ${res.status}`);
      }

      const arrBuf = await res.arrayBuffer();
      buffers.push(Buffer.from(arrBuf));
    }

    return Buffer.concat(buffers);
  }

  /**
   * Синтез через ElevenLabs Multilingual V2
   */
  private async synthesizeElevenLabs(text: string, apiKey: string, voiceId: string): Promise<Buffer> {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`ElevenLabs API error (${res.status}): ${errText}`);
    }

    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
  }

  // ==========================================
  // Вспомогательные методы
  // ==========================================

  /**
   * Генерация уникального MD5-хэша для кэша
   */
  private getCacheKey(text: string, options: any): string {
    const payload = `${text}_${JSON.stringify(options || {})}`;
    return crypto.createHash('md5').update(payload).digest('hex');
  }

  /**
   * Разделение длинного текста на фрагменты по знакам препинания и пробелам
   */
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
          // Если одно предложение длиннее лимита, режем по словам
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

  /**
   * Генерация стандартного заголовка WAV (PCM)
   */
  private getWavHeader(dataLength: number, sampleRate: number = 24000, numChannels: number = 1, bitsPerSample: number = 16): Buffer {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // subchunk1size (16 for PCM)
    header.writeUInt16LE(1, 20);  // audioFormat (1 for PCM)
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28); // byteRate
    header.writeUInt16LE(numChannels * (bitsPerSample / 8), 32); // blockAlign
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);
    return header;
  }

  /**
   * Генерация бесшумного WAV
   */
  private generateSilentWav(): Buffer {
    const data = Buffer.alloc(4800); // 0.1s silence
    const header = this.getWavHeader(data.length, 24000, 1, 16);
    return Buffer.concat([header, data]);
  }

  /**
   * Генерация синтетического тонального сигнала для полного офлайн-фолбэка
   */
  private generateFallbackToneWav(text: string): Buffer {
    const sampleRate = 24000;
    const durationSec = Math.min(2.0, Math.max(0.4, text.length * 0.05));
    const totalSamples = Math.floor(sampleRate * durationSec);
    const data = Buffer.alloc(totalSamples * 2);

    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      // Приятная плавная гармоника 440Hz + 880Hz
      const sample = Math.sin(2 * Math.PI * 440 * t) * 0.3 + Math.sin(2 * Math.PI * 880 * t) * 0.1;
      const intSample = Math.floor(sample * 32767);
      data.writeInt16LE(intSample, i * 2);
    }

    const header = this.getWavHeader(data.length, sampleRate, 1, 16);
    return Buffer.concat([header, data]);
  }
}

export const ttsService = new TTSService();
