import type { IntelligenceModule, ActionResult } from '../base-module';
import type { Intent } from '../../core/intent-engine';
import type { Memory } from '../../core/memory';

export class RobotModule implements IntelligenceModule {
  name = 'robot';

  async processIntent(intent: Intent, _memory: Memory): Promise<ActionResult> {
    return {
      text: `🤖 [Selin Hardware Robot] Команда принята: "${intent.raw_text}". Сервоприводы и экран готовы к выполнению.`,
      data: {
        action: 'move_head',
        params: { angle: 45, emotion: 'smile' },
      },
    };
  }

  getCapabilities(): string[] {
    return ['Управление движением', 'Распознавание гостей (компьютерное зрение)', 'Ориентация в помещении'];
  }
}

export const robotModule = new RobotModule();
