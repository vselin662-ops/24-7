import type { Intent } from './intent-engine';
import type { Memory } from './memory';
import type { ConversationContext } from './intent-engine';

export type ActionType =
  | 'respond_text'
  | 'respond_voice'
  | 'execute_tool'
  | 'start_lesson'
  | 'check_homework'
  | 'generate_plan'
  | 'create_task'
  | 'roleplay'
  | 'order_service'
  | 'navigate'
  | 'control_robot'
  | 'alert_human';

export interface Action {
  type: ActionType;
  payload: Record<string, unknown>;
  priority: number; // 1-10
  requires_confirmation: boolean;
}

/**
 * Движок принятия решений.
 * Определяет ЧТО ДЕЛАТЬ на основе намерения + памяти + контекста.
 */
export class DecisionEngine {
  async decide(intent: Intent, memory: Memory, context: ConversationContext): Promise<Action[]> {
    const actions: Action[] = [];
    const tenantId = context.tenantId;

    switch (intent.type) {
      case 'learn_language':
        const rawText = (intent?.raw_text || '').toLowerCase();
        if (rawText.includes('уро') || rawText.includes('начн')) {
          actions.push({
            type: 'start_lesson',
            payload: { tenantId, language: intent.entities.language || 'en' },
            priority: 9,
            requires_confirmation: false,
          });
        } else {
          actions.push({
            type: 'respond_text',
            payload: { tenantId, text: '' }, // handled by language module router
            priority: 8,
            requires_confirmation: false,
          });
        }
        break;

      case 'business_help':
        actions.push({
          type: 'respond_text',
          payload: { tenantId, intent, module: 'business' },
          priority: 8,
          requires_confirmation: false,
        });
        break;

      case 'robot_command':
      case 'navigation':
        actions.push({
          type: 'control_robot',
          payload: { tenantId, command: intent.type, entities: intent.entities, text: intent.raw_text },
          priority: 9,
          requires_confirmation: false,
        });
        actions.push({
          type: 'respond_text',
          payload: { tenantId, text: `Команда роботу принята: ${intent.raw_text}` },
          priority: 5,
          requires_confirmation: false,
        });
        break;

      case 'order_taxi':
      case 'order_food':
      case 'book_hotel':
      case 'search_flights':
      case 'service_request':
        actions.push({
          type: 'order_service',
          payload: { tenantId, serviceType: intent.type, entities: intent.entities, text: intent.raw_text },
          priority: 9,
          requires_confirmation: true,
        });
        break;

      case 'greeting':
        actions.push({
          type: 'respond_text',
          payload: {
            tenantId,
            text: 'Привет! Я Selin AI — ваш автономный интеллект. Могу помочь с изучением языков, бизнес-задачами, бытовыми сервисами или навигацией. Что вас интересует?',
          },
          priority: 10,
          requires_confirmation: false,
        });
        break;

      default:
        actions.push({
          type: 'respond_text',
          payload: { tenantId, text: '', fallback: true },
          priority: 5,
          requires_confirmation: false,
        });
        break;
    }

    return actions;
  }
}

export const decisionEngine = new DecisionEngine();
