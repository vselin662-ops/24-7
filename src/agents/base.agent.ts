import { BaseAgent as NewBaseAgent, Agent } from './BaseAgent';
import { Task, MessageContext, AIResponse } from '../core/types';

export type { Agent };

/**
 * Базовый абстрактный класс для специализированных агентов.
 * Наследует функционал из BaseAgent.ts для обратной совместимости.
 */
export abstract class BaseAgent extends NewBaseAgent {
  public abstract readonly role: string;

  constructor(name: string = 'BaseAgent', description: string = 'AI Agent') {
    super(name, description);
  }

  public canHandle(taskOrMessage: Task | string, context?: MessageContext): boolean {
    if (typeof taskOrMessage === 'string') {
      return this.canHandleMessage(taskOrMessage, context!);
    }
    return this.canHandleTask(taskOrMessage);
  }

  public canHandleTask(_task: Task): boolean {
    return true;
  }

  public canHandleMessage(_message: string, _context: MessageContext): boolean {
    return true;
  }

  public async execute(task: Task): Promise<AIResponse> {
    return this.process(task.payload?.message || '', task.context);
  }

  public abstract process(message: string, context: MessageContext): Promise<AIResponse>;
}
