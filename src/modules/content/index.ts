import type { IntelligenceModule, ActionResult } from '../base-module';
import type { Intent } from '../../core/intent-engine';
import type { Memory } from '../../core/memory';
import { geminiService } from '../../services/gemini.service';

export class ContentModule implements IntelligenceModule {
  name = 'content';

  async processIntent(intent: Intent, _memory: Memory): Promise<ActionResult> {
    const prompt = `Ты — эксперт по контенту Selin AI.
Создай контент по запросу: "${intent.raw_text}"
Формат: пост, статья или контент-план с хэштегами и цепляющим заголовком.`;

    const text = await geminiService.generate(prompt, { temperature: 0.7 });
    return { text };
  }

  getCapabilities(): string[] {
    return ['Контент-планы', 'Посты для соцсетей', 'Копирайтинг', 'Сценарии'];
  }
}

export const contentModule = new ContentModule();
