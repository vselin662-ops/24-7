import { logger } from '../logger';

/**
 * Сервис распознавания речи (Speech-to-Text).
 * Отвечает за:
 * - Прием аудиофайлов (OGG, MP3, WAV)
 * - Транскрибацию через Groq Whisper-large-v3 или внешние STT API
 * - Постобработку и нормализацию распознанного текста
 */
export class STTService {
  /**
   * Транскрибация аудиофайла в текст
   */
  public async transcribe(audioBuffer: Buffer, language: string = 'ru'): Promise<string> {
    const key = process.env.GROQ_API_KEY;
    if (!key) {
      logger.warn('[STTService] GROQ_API_KEY is not defined.');
      return '';
    }

    try {
      const form = new FormData();
      const fileBlob = new Blob([audioBuffer], { type: 'audio/ogg' });
      form.append('file', fileBlob, 'voice.ogg');
      form.append('model', 'whisper-large-v3');
      form.append('language', language);

      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`
        },
        body: form,
        signal: AbortSignal.timeout(25000)
      });

      if (!response.ok) {
        throw new Error(`STT failed with status ${response.status}`);
      }

      const data: any = await response.json();
      return (data?.text || '').trim();
    } catch (err: any) {
      logger.error(`[STTService] Transcription error: ${err?.message || err}`);
      return '';
    }
  }
}

export const sttService = new STTService();
