import { BaseAgent } from './base.agent';
import { Task, MessageContext, AIResponse, TaskType } from '../core/types';

/**
 * Агент продаж и обработки заказов (Sales Agent).
 * Отвечает за:
 * - Квалификацию входящих лидов
 * - Формирование коммерческих предложений (КП)
 * - Консультацию по тарифам и стоимости
 * - Доведение клиента до успешной оплаты
 */
export class SalesAgent extends BaseAgent {
  public readonly name = 'SalesAgent';
  public readonly role = 'sales';
  public readonly description = 'Специализированный агент продаж, расчет смет и ведение сделок.';

  constructor() {
    super('SalesAgent', 'Специализированный агент продаж, расчет смет и ведение сделок.');
    this.capabilities = [
      {
        name: 'sales_funnel',
        description: 'Расчет тарифов и ведение сделок',
        supportedTaskTypes: [TaskType.MARKETING, TaskType.ORDER],
        capabilities: [] as any,
        supportsVoice: true,
        supportsCamera: false,
        supportsLocation: false
      }
    ];
  }

  public canHandle(task: Task): boolean {
    if (task.type === TaskType.MARKETING) return true;
    const msg = (task.payload?.message || '').toLowerCase();
    return msg.includes('купить') ||
           msg.includes('цена') ||
           msg.includes('стоимость') ||
           msg.includes('заказать') ||
           msg.includes('кп') ||
           msg.includes('тариф');
  }

  public async process(message: string, _context: MessageContext): Promise<AIResponse> {
    return {
      text: 'Здравствуйте! Я готов рассчитать стоимость и подобрать подходящий тариф.',
      confidence: 0.95
    };
  }
}
