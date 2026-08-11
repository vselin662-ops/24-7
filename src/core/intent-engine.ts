import { geminiService } from '../services/gemini.service';
import { logger } from '../logger';

export type IntentType =
  | 'learn_language'
  | 'business_help'
  | 'order_taxi'
  | 'order_food'
  | 'book_hotel'
  | 'search_flights'
  | 'content_plan'
  | 'general_chat'
  | 'greeting'
  | 'farewell'
  | 'help'
  | 'settings'
  | 'robot_command'
  | 'face_detected'
  | 'guest_arrived'
  | 'service_request'
  | 'complaint'
  | 'payment'
  | 'reservation'
  | 'navigation'
  | 'entertainment';

export interface Intent {
  type: IntentType;
  confidence: number; // 0-1
  entities: Record<string, string>;
  raw_text: string;
}

export interface ConversationContext {
  tenantId: string;
  activeMode?: string;
  modeData?: Record<string, unknown>;
  lastMessages?: Array<{ role: string; content: string }>;
  emotionState?: string;
  location?: string;
}

/**
 * Движок понимания намерений.
 * Определяет ЧТО хочет пользователь из текста/голоса.
 */
export async function detectIntent(text: string, context?: ConversationContext): Promise<Intent> {
  if (!text || text.trim().length === 0) {
    return {
      type: 'general_chat',
      confidence: 1.0,
      entities: {},
      raw_text: text || '',
    };
  }

  const prompt = `Ты — NLU система ядра автономного интеллекта Selin AI.
Проанализируй входящий текст и определи главное намерение пользователя и извлеки сущности.

Текст: "${text}"
${context ? `Контекст режима: ${context.activeMode || 'general'}` : ''}

Типы намерений:
- learn_language: изучение языков, слова, уроки, перевод
- business_help: бизнес, стратегирование, планирование, задачи
- order_taxi: заказ такси или трансфера
- order_food: заказ еды или напитков
- book_hotel: бронирование отелей или жилья
- search_flights: поиск и бронирование билетов
- content_plan: генерация постов, статей, контент-планов
- robot_command: команды физическому роботу (движение, навигация, повернись)
- face_detected / guest_arrived: обнаружение гостя или визит
- service_request: запрос обслуживания в заведении
- complaint: жалоба или проблема
- payment: оплата, чеки, финансы
- reservation: бронь столика/мероприятия
- navigation: куда пройти, карта заведения
- entertainment: шутки, игры, история, викторина
- greeting / farewell / help / settings / general_chat

Ответь СТРОГО в формате JSON без markdown:
{
  "type": "строка из списка типов",
  "confidence": число от 0.0 до 1.0,
  "entities": { "ключ": "значение" }
}`;

  try {
    const rawResponse = await geminiService.generate(prompt, { temperature: 0.1 });
    const cleaned = rawResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);

    return {
      type: (parsed.type as IntentType) || 'general_chat',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.8,
      entities: parsed.entities || {},
      raw_text: text,
    };
  } catch (err) {
    logger.warn('Failed to detect intent via Gemini, falling back to rule-based detection', { error: err });
    return fallbackIntentDetection(text);
  }
}

function fallbackIntentDetection(text: string): Intent {
  const lower = text.toLowerCase();
  let type: IntentType = 'general_chat';

  if (lower.includes('язык') || lower.includes('урок') || lower.includes('слова') || lower.includes('учить') || lower.includes('english') || lower.includes('испанский')) {
    type = 'learn_language';
  } else if (lower.includes('бизнес') || lower.includes('план') || lower.includes('задач') || lower.includes('стратег')) {
    type = 'business_help';
  } else if (lower.includes('привет') || lower.includes('здравствуй') || lower.includes('hello')) {
    type = 'greeting';
  } else if (lower.includes('пока') || lower.includes('до свидания')) {
    type = 'farewell';
  } else if (lower.includes('такси')) {
    type = 'order_taxi';
  } else if (lower.includes('еда') || lower.includes('заказать')) {
    type = 'order_food';
  }

  return {
    type,
    confidence: 0.7,
    entities: {},
    raw_text: text,
  };
}
