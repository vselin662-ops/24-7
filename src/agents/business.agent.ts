import { BaseAgent } from './base.agent';
import { Task, MessageContext, AIResponse, TaskType } from '../core/types';

/**
 * Агент бизнес-консалтинга (Business Mentor Agent).
 * Отвечает за:
 * - Экспресс-диагностику бизнес-модели
 * - Генерацию ежедневных SMART-задач для основателя
 * - Анализ метрик и юнит-экономики
 * - Ролевые симуляции сложных переговоров
 */
export class BusinessAgent extends BaseAgent {
  public readonly name = 'BusinessAgent';
  public readonly role = 'business';
  public readonly description = 'AI-ментор для предпринимателей и стратегический советник.';

  constructor() {
    super('BusinessAgent', 'AI-ментор для предпринимателей и стратегический советник.');
    this.capabilities = [
      {
        name: 'business_mentor',
        description: 'Стратегический консалтинг и SMART-задачи',
        supportedTaskTypes: [TaskType.BUSINESS_AUTOMATION, TaskType.CONTENT],
        capabilities: [] as any,
        supportsVoice: true,
        supportsCamera: false,
        supportsLocation: false
      }
    ];
  }

  public canHandle(task: Task): boolean {
    if (task.type === TaskType.BUSINESS_AUTOMATION) return true;
    const msg = (task.payload?.message || '').toLowerCase();
    return msg.includes('бизнес') ||
           msg.includes('стартап') ||
           msg.includes('план') ||
           msg.includes('маркетинг') ||
           msg.includes('воронка') ||
           msg.includes('юнит-экономик');
  }

  public async process(message: string, _context: MessageContext): Promise<AIResponse> {
    return {
      text: 'Готов помочь с анализом вашей бизнес-модели и постановкой задач.',
      confidence: 0.95
    };
  }
}
