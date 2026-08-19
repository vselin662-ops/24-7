import { BaseAgent } from './BaseAgent';
import { Task, TaskType, AIResponse, AgentCapabilityType } from '../core/types';
import { LLMService, llmService } from '../core/LLMService';

/**
 * Агент мониторинга и дайджеста новостей (NewsAgent).
 * 
 * Возможности:
 * - Сбор и анализ свежих новостей технологий, ИИ и бизнеса
 * - Генерация структурированных утренних и вечерних дайджестов
 * - Оценка тональности и ключевых выводов для пользователя
 */
export class NewsAgent extends BaseAgent {
  public readonly name = 'NewsAgent';
  public readonly description = 'Мониторинг новостей, подготовка аналитических дайджестов и трендов.';

  constructor(llm: LLMService = llmService) {
    super('NewsAgent', 'Мониторинг новостей, подготовка аналитических дайджестов и трендов.', llm);
    this.capabilities = [
      {
        name: 'news_digest',
        description: 'Формирование новостных сводок и дайджестов',
        supportedTaskTypes: [TaskType.NEWS],
        capabilities: [AgentCapabilityType.WEB_SEARCH, AgentCapabilityType.TEXT_GENERATION],
        supportsVoice: true,
        supportsCamera: false,
        supportsLocation: false
      }
    ];
  }

  public canHandle(task: Task): boolean {
    if (task.type === TaskType.NEWS) return true;
    const msg = (task.payload?.message || '').toLowerCase();
    return msg.includes('новост') ||
           msg.includes('дайджест') ||
           msg.includes('что нового') ||
           msg.includes('тренды') ||
           msg.includes('события дня') ||
           msg.includes('рынок') ||
           msg.includes('сводка');
  }

  public async execute(task: Task): Promise<AIResponse> {
    this.setStatus('busy');
    const userMessage = task.payload?.message || '';

    try {
      const systemPrompt = `Ты — NewsAgent в Selin AI 2.0. Ты опытный новостной аналитик и редактор.
Твоя задача — предоставить емкий, объективный и структурированный дайджест главных событий с акцентом на технологии, AI, экономику и инновации.
Формат ответа:
1. 🔥 Главная тема дня
2. 🤖 Технологии и AI
3. 💼 Рынки и Бизнес
4. 💡 Ключевой инсайт / Вывод`;

      const prompt = `Запрос пользователя: "${userMessage}".
Подготовь актуальный, свежий и интересный новостной дайджест. Выдели самые важные тренды и дай емкую аналитическую выжимку.`;

      const aiText = await this.callLLM(prompt, systemPrompt);

      this.setStatus('idle');
      return {
        text: aiText,
        confidence: 0.94,
        suggestedReplies: [
          'Расскажи подробнее про AI тренды',
          'Что происходит на фондовом рынке?',
          'Сделай краткую выжимку в 3 пункта'
        ],
        metadata: {
          category: 'digest',
          timestamp: Date.now()
        }
      };
    } catch (err: any) {
      return this.handleError(`Ошибка при формировании новостного дайджеста: ${err?.message || err}`, err);
    }
  }
}
