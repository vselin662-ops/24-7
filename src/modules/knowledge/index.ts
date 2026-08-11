import type { IntelligenceModule, ActionResult } from '../base-module';
import type { Intent } from '../../core/intent-engine';
import type { Memory } from '../../core/memory';
import { geminiService } from '../../services/gemini.service';

export class KnowledgeModule implements IntelligenceModule {
  name = 'knowledge';

  async processIntent(intent: Intent, _memory: Memory): Promise<ActionResult> {
    const text = await geminiService.generate(intent.raw_text, { temperature: 0.3 });
    return { text };
  }

  getCapabilities(): string[] {
    return ['Ответы на сложные вопросы', 'База знаний RAG', 'Поиск и аналитика'];
  }
}

export const knowledgeModule = new KnowledgeModule();
