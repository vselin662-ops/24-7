import { BaseAgent } from './BaseAgent';
import { Task, TaskType, AIResponse, AgentCapabilityType } from '../core/types';
import { LLMService, llmService } from '../core/LLMService';

export interface OrderItem {
  name: string;
  quantity: number;
  pricePerUnitRub: number;
}

export interface SmartFeeBreakdown {
  itemsSubtotal: number;
  deliveryFee: number;
  serviceTierFee: number;
  tierName: 'Standard' | 'Express Priority' | 'VIP Concierge';
  surgeMultiplier: number;
  volumeDiscountRub: number;
  totalRub: number;
}

/**
 * Агент оформления и расчета заказов (OrderAgent).
 * 
 * Возможности:
 * - Сбор и валидация позиций заказа
 * - Расчет стоимости с использованием алгоритма Smart Fee Matrix (из проекта Pilgrim)
 * - Динамические сервисные сборы, скидки на объем и учет пиковых нагрузок
 * - Формирование чека и действий для оплаты
 */
export class OrderAgent extends BaseAgent {
  public readonly name = 'OrderAgent';
  public readonly description = 'Сбор заказов, проверка цен, расчет Smart Fee Matrix и оформление.';

  constructor(llm: LLMService = llmService) {
    super('OrderAgent', 'Сбор заказов, проверка цен, расчет Smart Fee Matrix и оформление.', llm);
    this.capabilities = [
      {
        name: 'order_processing',
        description: 'Прием, расчет и подтверждение заказов',
        supportedTaskTypes: [TaskType.ORDER, TaskType.MARKETING],
        capabilities: [AgentCapabilityType.EXTERNAL_API_CALL, AgentCapabilityType.TEXT_GENERATION],
        supportsVoice: true,
        supportsCamera: false,
        supportsLocation: true
      }
    ];
  }

  public canHandle(task: Task): boolean {
    if (task.type === TaskType.ORDER) return true;
    const msg = (task.payload?.message || '').toLowerCase();
    return msg.includes('заказ') ||
           msg.includes('купить') ||
           msg.includes('доставка') ||
           msg.includes('чек') ||
           msg.includes('оформить') ||
           msg.includes('корзина') ||
           msg.includes('рассчитай заказ') ||
           msg.includes('стоимость заказа');
  }

  public async execute(task: Task): Promise<AIResponse> {
    this.setStatus('busy');
    const userMessage = task.payload?.message || '';

    try {
      // 1. Извлечение позиций заказа или парсинг через LLM
      const sampleItems = this.parseOrderItems(userMessage);
      
      // 2. Расчет по Smart Fee Matrix
      const isExpress = userMessage.toLowerCase().includes('срочно') || userMessage.toLowerCase().includes('экспресс');
      const feeMatrix = this.calculateSmartFeeMatrix(sampleItems, isExpress ? 'Express Priority' : 'Standard');

      // 3. Формирование ответа через LLM
      const systemPrompt = `Ты — OrderAgent в системе Selin AI 2.0. Твоя задача — профессионально, вежливо и понятно подтвердить детали заказа, разложить расчет по Smart Fee Matrix и предоставить итоговую сумму. Отвечай кратко, структурированно, с форматированием.`;

      const prompt = `Пользователь сделал запрос на заказ: "${userMessage}".
Расчет стоимости по алгоритму Smart Fee Matrix:
- Товары/услуги: ${feeMatrix.itemsSubtotal} ₽
- Доставка: ${feeMatrix.deliveryFee} ₽
- Сервисный сбор (${feeMatrix.tierName}): ${feeMatrix.serviceTierFee} ₽
- Скидка на объем: -${feeMatrix.volumeDiscountRub} ₽
- Коэффициент нагрузки: x${feeMatrix.surgeMultiplier}
ИТОГО К ОПЛАТЕ: ${feeMatrix.totalRub} ₽.

Сформируй понятный, красивый ответ для клиента с детализацией и вопросом о подтверждении оплаты.`;

      const aiText = await this.callLLM(prompt, systemPrompt);

      this.setStatus('idle');
      return {
        text: aiText,
        confidence: 0.96,
        actions: [
          {
            id: `action_order_${Date.now()}`,
            type: 'confirm_order',
            payload: {
              items: sampleItems,
              feeMatrix,
              chatId: task.context.chatId
            },
            description: `Оформить заказ на сумму ${feeMatrix.totalRub} ₽`
          }
        ],
        metadata: {
          feeMatrix,
          itemsCount: sampleItems.length,
          totalRub: feeMatrix.totalRub
        }
      };
    } catch (err: any) {
      return this.handleError(`Ошибка при обработке заказа: ${err?.message || err}`, err);
    }
  }

  /**
   * Логика Smart Fee Matrix (из архитектуры Pilgrim):
   * Динамический расчет базовой стоимости, сервисного сбора, коэффициента нагрузки и скидок
   */
  public calculateSmartFeeMatrix(
    items: OrderItem[],
    tier: 'Standard' | 'Express Priority' | 'VIP Concierge' = 'Standard',
    surgeMultiplier: number = 1.0
  ): SmartFeeBreakdown {
    const itemsSubtotal = items.reduce((sum, item) => sum + (item.pricePerUnitRub * item.quantity), 0);

    // Базовая стоимость доставки
    let deliveryFee = itemsSubtotal > 3000 ? 0 : 350;

    // Сервисный сбор по тиру
    let tierPercent = 0.05; // 5% Standard
    if (tier === 'Express Priority') tierPercent = 0.10;
    if (tier === 'VIP Concierge') tierPercent = 0.15;

    let serviceTierFee = Math.round(Math.max(150, itemsSubtotal * tierPercent));

    // Скидки на объем
    let volumeDiscountRub = 0;
    if (itemsSubtotal >= 10000) {
      volumeDiscountRub = Math.round(itemsSubtotal * 0.10); // 10% скидка
    } else if (itemsSubtotal >= 5000) {
      volumeDiscountRub = Math.round(itemsSubtotal * 0.05); // 5% скидка
    }

    const subtotalWithFees = (itemsSubtotal + deliveryFee + serviceTierFee - volumeDiscountRub) * surgeMultiplier;
    const totalRub = Math.round(Math.max(0, subtotalWithFees));

    return {
      itemsSubtotal,
      deliveryFee,
      serviceTierFee,
      tierName: tier,
      surgeMultiplier,
      volumeDiscountRub,
      totalRub
    };
  }

  private parseOrderItems(text: string): OrderItem[] {
    // Демонстрационный интеллектуальный парсер с дефолтным набором при неструктурированном вводе
    const items: OrderItem[] = [];
    const lower = text.toLowerCase();

    if (lower.includes('пицц') || lower.includes('еда') || lower.includes('обед')) {
      items.push({ name: 'Комбо-сет «Гурман»', quantity: 1, pricePerUnitRub: 1890 });
      items.push({ name: 'Фирменный напиток', quantity: 2, pricePerUnitRub: 250 });
    } else if (lower.includes('кофе') || lower.includes('капучино')) {
      items.push({ name: 'Капучино XL (Овсяное молоко)', quantity: 2, pricePerUnitRub: 380 });
      items.push({ name: 'Круассан миндальный', quantity: 2, pricePerUnitRub: 290 });
    } else {
      items.push({ name: 'Заказ по запросу клиента', quantity: 1, pricePerUnitRub: 2400 });
    }

    return items;
  }
}
