import { BaseAgent } from './base.agent';
import { Task, MessageContext, AIResponse, TaskType } from '../core/types';

/**
 * Агент персонального консьержа (Concierge Agent).
 * Отвечает за:
 * - Заказ такси и расчет маршрутов
 * - Доставку еды из ресторанов
 * - Поиск авиабилетов и бронирование отелей
 * - Повседневные поручения пользователя
 */
export class ConciergeAgent extends BaseAgent {
  public readonly name = 'ConciergeAgent';
  public readonly role = 'concierge';
  public readonly description = 'Персональный голосовой консьерж для бытовых и туристических задач.';

  constructor() {
    super('ConciergeAgent', 'Персональный голосовой консьерж для бытовых и туристических задач.');
    this.capabilities = [
      {
        name: 'concierge_service',
        description: 'Заказ такси, еды, бронирование билетов и отелей',
        supportedTaskTypes: [TaskType.ORDER, TaskType.TRAVEL],
        capabilities: [] as any,
        supportsVoice: true,
        supportsCamera: true,
        supportsLocation: true
      }
    ];
  }

  public canHandle(task: Task): boolean {
    if (task.type === TaskType.ORDER || task.type === TaskType.TRAVEL) return true;
    const msg = (task.payload?.message || '').toLowerCase();
    return msg.includes('такси') ||
           msg.includes('еда') ||
           msg.includes('доставка') ||
           msg.includes('билет') ||
           msg.includes('отель') ||
           msg.includes('забронируй');
  }

  public async process(message: string, _context: MessageContext): Promise<AIResponse> {
    return {
      text: 'Секунду! Обрабатываю ваш запрос через службу консьержа.',
      confidence: 0.95
    };
  }
}
