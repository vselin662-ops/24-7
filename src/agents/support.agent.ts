import { BaseAgent } from './base.agent';
import { Task, MessageContext, AIResponse, TaskType } from '../core/types';

/**
 * Агент клиентской поддержки (Customer Support Agent).
 * Отвечает за:
 * - Ответы на частые вопросы по базе знаний (FAQ)
 * - Помощь в решении технических и сервисных сложностей
 * - Передачу сложных вопросов оператору-человеку
 */
export class SupportAgent extends BaseAgent {
  public readonly name = 'SupportAgent';
  public readonly role = 'support';
  public readonly description = 'Агент клиентской поддержки и работы с базой знаний.';

  constructor() {
    super('SupportAgent', 'Агент клиентской поддержки и работы с базой знаний.');
    this.capabilities = [
      {
        name: 'support_faq',
        description: 'Ответы на вопросы и база знаний',
        supportedTaskTypes: [TaskType.CUSTOMER_SUPPORT, TaskType.NEWS],
        capabilities: [] as any,
        supportsVoice: true,
        supportsCamera: true,
        supportsLocation: true
      }
    ];
  }

  public canHandle(task: Task): boolean {
    return task.type === TaskType.CUSTOMER_SUPPORT || task.type === TaskType.NEWS;
  }

  public async process(message: string, _context: MessageContext): Promise<AIResponse> {
    return {
      text: 'Спасибо за обращение! Я помогу вам разобраться с этим вопросом.',
      confidence: 0.9
    };
  }
}
