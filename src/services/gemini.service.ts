import { GoogleGenAI } from '@google/genai';
import { logger } from '../logger';

/**
 * Сервис для взаимодействия с Gemini API.
 */
class GeminiService {
  private ai: GoogleGenAI | null = null;

  private getClient(): GoogleGenAI {
    if (!this.ai) {
      const key = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
      this.ai = new GoogleGenAI({ apiKey: key });
    }
    return this.ai;
  }

  /**
   * Генерирует текстовый ответ с помощью модели Gemini.
   *
   * @param prompt - Входной промпт
   * @param options - Дополнительные параметры (температура, модель)
   * @returns Сгенерированный текст
   */
  async generate(prompt: string, options: { temperature?: number; model?: string } = {}): Promise<string> {
    try {
      const ai = this.getClient();
      const model = options.model || 'gemini-2.5-flash';
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          temperature: options.temperature ?? 0.7,
        },
      });
      return response.text || '';
    } catch (err) {
      logger.error('Error generating text with Gemini', { error: err });
      throw err;
    }
  }
}

export const geminiService = new GeminiService();
