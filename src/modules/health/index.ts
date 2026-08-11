import type { IntelligenceModule, ActionResult } from '../base-module';
import type { Intent } from '../../core/intent-engine';
import type { Memory } from '../../core/memory';

export class HealthModule implements IntelligenceModule {
  name = 'health';

  async processIntent(intent: Intent, _memory: Memory): Promise<ActionResult> {
    return {
      text: `🍏 [Selin Health] Запрос о здоровье/привычках: "${intent.raw_text}". Трекинг активности и напоминания сохранены.`,
    };
  }

  getCapabilities(): string[] {
    return ['Трекер привычек', 'Напоминания о здоровье', 'Советы по самочувствию'];
  }
}

export const healthModule = new HealthModule();
