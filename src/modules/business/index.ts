import type { IntelligenceModule, ActionResult } from '../base-module';
import type { Intent } from '../../core/intent-engine';
import type { Memory } from '../../core/memory';
import { llmService } from '../../core/LLMService';

export class BusinessModule implements IntelligenceModule {
  name = 'business';

  async processIntent(intent: Intent, memory: Memory): Promise<ActionResult> {
    const systemPrompt = `Ты — бизнес-наставник и AI-консультант Selin AI.
Дай структурированный, практический ответ с рекомендациями, ключевыми шагами и метриками успеха.`;

    const chatId = memory.context.tenantId || 'system_business';
    const text = await llmService.smartCall(chatId, intent.raw_text, systemPrompt);
    return { text };
  }

  getCapabilities(): string[] {
    return ['Бизнес-стратегирование', 'Составление бизнес-планов', 'Декомпозиция задач', 'Финансовый анализ'];
  }
}

export const businessModule = new BusinessModule();
