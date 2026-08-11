import { geminiService } from '../services/gemini.service';
import { logger } from '../logger';

export type UserEmotion = 'happy' | 'sad' | 'angry' | 'neutral' | 'excited' | 'tired' | 'confused';
export type SuggestedTone = 'energetic' | 'calm' | 'supportive' | 'professional' | 'playful';

export interface VoiceFeatures {
  pitch?: number;
  speed?: number;
  volume?: number;
}

export interface EmotionState {
  user_emotion: UserEmotion;
  confidence: number;
  suggested_tone: SuggestedTone;
}

/**
 * Эмоциональный интеллект.
 * Анализирует эмоции пользователя и адаптирует стиль общения.
 */
export class EmotionEngine {
  async analyze(text: string, voiceFeatures?: VoiceFeatures): Promise<EmotionState> {
    if (!text || text.trim().length === 0) {
      return {
        user_emotion: 'neutral',
        confidence: 1.0,
        suggested_tone: 'calm',
      };
    }

    const prompt = `Ты — модель эмоционального интеллекта Selin AI.
Проанализируй текст сообщения и определи эмоцию пользователя и рекомендуемый тон ответа.

Текст сообщения: "${text}"
${voiceFeatures ? `Параметры голоса: скорость=${voiceFeatures.speed || 1}, громкость=${voiceFeatures.volume || 1}` : ''}

Возможные эмоции: happy, sad, angry, neutral, excited, tired, confused.
Возможные тоны ответа: energetic, calm, supportive, professional, playful.

Верни СТРОГО JSON без markdown:
{
  "user_emotion": "одно значение из списка эмоций",
  "confidence": число от 0.0 до 1.0,
  "suggested_tone": "одно значение из списка тонов"
}`;

    try {
      const response = await geminiService.generate(prompt, { temperature: 0.1 });
      const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);

      return {
        user_emotion: (parsed.user_emotion as UserEmotion) || 'neutral',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.8,
        suggested_tone: (parsed.suggested_tone as SuggestedTone) || 'calm',
      };
    } catch (err) {
      logger.warn('Failed to analyze emotion via Gemini, falling back to neutral', { error: err });
      return {
        user_emotion: 'neutral',
        confidence: 0.7,
        suggested_tone: 'calm',
      };
    }
  }
}

export const emotionEngine = new EmotionEngine();
