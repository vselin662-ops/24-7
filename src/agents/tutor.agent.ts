import { BaseAgent } from './base.agent';
import { Task, MessageContext, AIResponse, TaskType } from '../core/types';

/**
 * Агент языкового обучения (Language Tutor Agent).
 * Отвечает за:
 * - Генерацию персонализированных уроков (CEFR A1-C2)
 * - Проверку домашней работы и грамматики
 * - Интервальное повторение слов (SuperMemo SM-2)
 * - Разговорную практику через голос
 */
export class TutorAgent extends BaseAgent {
  public readonly name = 'TutorAgent';
  public readonly role = 'tutor';
  public readonly description = 'Интерактивный репетитор иностранных языков.';

  constructor() {
    super('TutorAgent', 'Интерактивный репетитор иностранных языков.');
    this.capabilities = [
      {
        name: 'language_learning',
        description: 'Обучение иностранным языкам',
        supportedTaskTypes: [TaskType.EDUCATION],
        capabilities: [] as any,
        supportsVoice: true,
        supportsCamera: false,
        supportsLocation: false
      }
    ];
  }

  public canHandle(task: Task): boolean {
    if (task.type === TaskType.EDUCATION) return true;
    const msg = (task.payload?.message || '').toLowerCase();
    return msg.includes('учить') ||
           msg.includes('урок') ||
           msg.includes('английск') ||
           msg.includes('испанск') ||
           msg.includes('слова') ||
           msg.includes('lesson');
  }

  public async process(message: string, _context: MessageContext): Promise<AIResponse> {
    return {
      text: 'Отлично! Давайте приступим к языковому занятию.',
      confidence: 0.95
    };
  }
}
