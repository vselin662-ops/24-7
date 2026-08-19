import { BaseAgent } from './BaseAgent';
import { Task, TaskType, AIResponse, AgentCapabilityType } from '../core/types';
import { LLMService, llmService } from '../core/LLMService';

/**
 * Агент разработки и отладки программного кода (CodingAgent).
 * 
 * Возможности:
 * - Написание чистого, типизированного и протестированного кода (TypeScript, Python, Go, SQL, Rust и др.)
 * - Диагностика багов, анализ стек-трейсов и оптимизация производительности
 * - Архитектурное проектирование API, баз данных и микросервисов
 * - Пошаговое объяснение сложных алгоритмов
 */
export class CodingAgent extends BaseAgent {
  public readonly name = 'CodingAgent';
  public readonly description = 'Разработка программного кода, отладка, рефакторинг, код-ревью и объяснение архитектуры.';

  constructor(llm: LLMService = llmService) {
    super('CodingAgent', 'Разработка программного кода, отладка, рефакторинг, код-ревью и объяснение архитектуры.', llm);
    this.capabilities = [
      {
        name: 'code_engineering',
        description: 'Разработка ПО, отладка и архитектура',
        supportedTaskTypes: [TaskType.CODING],
        capabilities: [AgentCapabilityType.CODE_EXECUTION, AgentCapabilityType.TEXT_GENERATION],
        supportsVoice: false,
        supportsCamera: false,
        supportsLocation: false
      }
    ];
  }

  public canHandle(task: Task): boolean {
    if (task.type === TaskType.CODING) return true;
    const msg = (task.payload?.message || '').toLowerCase();
    return msg.includes('код') ||
           msg.includes('функци') ||
           msg.includes('typescript') ||
           msg.includes('javascript') ||
           msg.includes('python') ||
           msg.includes('react') ||
           msg.includes('баг') ||
           msg.includes('ошибк') ||
           msg.includes('дебаг') ||
           msg.includes('рефактор') ||
           msg.includes('sql') ||
           msg.includes('api') ||
           msg.includes('скрипт') ||
           msg.includes('алгоритм');
  }

  public async execute(task: Task): Promise<AIResponse> {
    this.setStatus('busy');
    const userMessage = task.payload?.message || '';

    try {
      const systemPrompt = `Ты — Senior Principal Software Engineer и CodingAgent в Selin AI 2.0.
Твои стандарты:
- Пиши production-ready, безопасный, чистый и масштабируемый код с исчерпывающей TypeScript/Python типизацией.
- Форматируй код в блоки с указанием языка (\`\`\`typescript ... \`\`\`).
- Добавляй лаконичные комментарии к нетривиальным моментам.
- Предлагай лучшие практики, обработку краевых случаев и тесты.
- Объясняй логику четко, без лишней "воды".`;

      const prompt = `Запрос разработчика: "${userMessage}".
Напиши решение, объясни архитектурный подход и покажи готовый к запуску код.`;

      const aiText = await this.callLLM(prompt, systemPrompt);

      this.setStatus('idle');
      return {
        text: aiText,
        confidence: 0.98,
        suggestedReplies: [
          'Добавь юнит-тесты для этого кода',
          'Оптимизируй алгоритмическую сложность',
          'Объясни, как развернуть это решение'
        ],
        metadata: {
          category: 'development',
          hasCodeBlocks: aiText.includes('```')
        }
      };
    } catch (err: any) {
      return this.handleError(`Ошибка при генерации или анализе кода: ${err?.message || err}`, err);
    }
  }
}
