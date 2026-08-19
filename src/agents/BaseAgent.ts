import { Task, AIResponse, AgentCapability } from '../core/types';
import { LLMService, llmService } from '../core/LLMService';
import { logger } from '../logger';

export interface Agent {
  name: string;
  description: string;
  capabilities: AgentCapability[];
  canHandle(task: Task): boolean;
  execute(task: Task): Promise<AIResponse>;
  getStatus(): 'idle' | 'busy' | 'error';
}

/**
 * Базовый класс для всех агентов мультиагентной системы Selin AI 2.0.
 * Предоставляет унифицированное управление состоянием, вызовы LLM,
 * логирование и стандартизированную обработку ошибок.
 */
export abstract class BaseAgent implements Agent {
  public name: string;
  public description: string;
  public capabilities: AgentCapability[] = [];
  protected status: 'idle' | 'busy' | 'error' = 'idle';
  protected llm: LLMService;

  constructor(name: string, description: string, llm: LLMService = llmService) {
    this.name = name;
    this.description = description;
    this.llm = llm;
  }

  /**
   * Проверка возможности выполнения задачи данным агентом
   */
  public abstract canHandle(task: Task): boolean;

  /**
   * Выполнение задачи и генерация стандартизированного AIResponse
   */
  public abstract execute(task: Task): Promise<AIResponse>;

  /**
   * Получение текущего рабочего статуса агента
   */
  public getStatus(): 'idle' | 'busy' | 'error' {
    return this.status;
  }

  /**
   * Изменение рабочего статуса агента
   */
  protected setStatus(status: 'idle' | 'busy' | 'error'): void {
    this.status = status;
    this.logInfo(`Status transitioned to: ${status}`);
  }

  /**
   * Безопасный вызов языковой модели через фасад LLMService
   */
  protected async callLLM(prompt: string, systemPrompt?: string): Promise<string> {
    try {
      this.logInfo(`Executing LLM request (prompt: ${prompt.length} chars)`);
      const response = await this.llm.call([
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: prompt }
      ]);
      return response;
    } catch (error: any) {
      this.handleError(`LLM call failed in agent ${this.name}: ${error?.message || error}`, error);
      throw error;
    }
  }

  // ==========================================
  // Логирование и обработка ошибок
  // ==========================================

  /**
   * Информационное логирование с префиксом агента
   */
  protected logInfo(message: string, meta?: any): void {
    logger.info(`[${this.name}] ${message}`, meta ? { meta } : undefined);
  }

  /**
   * Предупреждающее логирование
   */
  protected logWarn(message: string, meta?: any): void {
    logger.warn(`[${this.name}] ⚠️ ${message}`, meta ? { meta } : undefined);
  }

  /**
   * Логирование ошибок
   */
  protected logError(message: string, meta?: any): void {
    logger.error(`[${this.name}] ❌ ${message}`, meta ? { meta } : undefined);
  }

  /**
   * Централизованная обработка ошибок с переводом агента в состояние 'error'
   * и генерацией безопасного ответа для пользователя
   */
  protected handleError(message: string, error?: any): AIResponse {
    this.setStatus('error');
    this.logError(message, error);

    return {
      text: `К сожалению, при обработке задачи агентом ${this.name} произошла ошибка.`,
      confidence: 0.0,
      metadata: {
        agent: this.name,
        error: message,
        timestamp: Date.now(),
        details: error instanceof Error ? error.message : String(error)
      }
    };
  }
}
