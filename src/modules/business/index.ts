import type { IntelligenceModule, ActionResult } from '../base-module';
import type { Intent } from '../../core/intent-engine';
import type { Memory } from '../../core/memory';
import { geminiService } from '../../services/gemini.service';

export class BusinessModule implements IntelligenceModule {
  name = 'business';

  async processIntent(intent: Intent, _memory: Memory): Promise<ActionResult> {
    const prompt = `Ты — бизнес-наставник и AI-консультант Selin AI.
Пользователь обратился с бизнес-запросом: "${intent.raw_text}"

Дай структурированный, практический ответ с рекомендациями, ключевыми шагами и метриками успеха.`;

    const text = await geminiService.generate(prompt, { temperature: 0.5 });
    return { text };
  }

  getCapabilities(): string[] {
    return ['Бизнес-стратегирование', 'Составление бизнес-планов', 'Декомпозиция задач', 'Финансовый анализ'];
  }
}

export const businessModule = new BusinessModule();
