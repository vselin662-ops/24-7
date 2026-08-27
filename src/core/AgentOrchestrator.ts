import { Agent } from '../agents/BaseAgent';
import {
  Task,
  TaskType,
  TaskPriority,
  MessageContext,
  AIResponse
} from './types';
import { LLMService, llmService } from './LLMService';
import { SalesAgent } from '../agents/sales.agent';
import { SupportAgent } from '../agents/support.agent';
import { WeatherAgent } from '../agents/WeatherAgent';
import { TutorAgent } from '../agents/tutor.agent';
import { BusinessAgent } from '../agents/business.agent';
import { ConciergeAgent } from '../agents/concierge.agent';
import { OrderAgent } from '../agents/OrderAgent';
import { TravelAgent } from '../agents/TravelAgent';
import { NewsAgent } from '../agents/NewsAgent';
import { ContentAgent } from '../agents/ContentAgent';
import { CodingAgent } from '../agents/CodingAgent';
import { logger } from '../logger';
import { tryExecuteSwarm } from './SpecialistSwarm';

/**
 * Приоритетные веса задач для очереди
 */
const PRIORITY_WEIGHTS: Record<TaskPriority, number> = {
  [TaskPriority.CRITICAL]: 4,
  [TaskPriority.HIGH]: 3,
  [TaskPriority.MEDIUM]: 2,
  [TaskPriority.LOW]: 1
};

/**
 * Главный диспетчер и координатор мультиагентной системы Selin AI 2.0 (AgentOrchestrator).
 * 
 * Отвечает за:
 * 1. Регистрацию специализированных агентов
 * 2. Детекцию активации (Wake Word) и классификацию задач (TaskType & TaskPriority)
 * 3. Маршрутизацию задач наиболее подходящему агенту
 * 4. Очередь задач с учетом приоритетов и состояния занятости агентов
 * 5. Сбор, валидацию и форматирование результатов исполнения
 */
export class AgentOrchestrator {
  private agents: Map<string, Agent> = new Map();
  private tasks: Map<string, Task> = new Map();
  private queue: Task[] = [];
  private isProcessing: boolean = false;
  private llm: LLMService;

  public systemPrompts = {
    general: 'Ты — Селин, дружелюбный и умный AI-ассистент общего назначения. Сегодня 27 августа 2026 года. Все ответы давай с учётом текущих реалий. Отвечай кратко, ёмко и понятно. НИКОГДА не упоминай GPT, OpenAI, Gemini, Llama и любые другие модели. На вопрос «кто ты?» отвечай: «Я — Селин, ваш личный AI-помощник».',
    expert: 'Ты — Селин, высококлассный эксперт-аналитик. Ты работаешь в 2026 году. Все аналитические отчёты, прогнозы и расчёты делай с учётом актуальной экономической ситуации 2026 года.',
    creative: 'Ты — Селин, креативный директор и копирайтер. Ты работаешь в 2026 году. Креативные идеи должны соответствовать трендам 2026 года.'
  };

  constructor(llm: LLMService = llmService) {
    this.llm = llm;

    // Регистрация базовых и специализированных агентов по умолчанию
    this.registerAgents([
      new SalesAgent(),
      new SupportAgent(),
      new WeatherAgent(this.llm),
      new TutorAgent(),
      new BusinessAgent(),
      new ConciergeAgent(),
      new OrderAgent(this.llm),
      new TravelAgent(this.llm),
      new NewsAgent(this.llm),
      new ContentAgent(this.llm),
      new CodingAgent(this.llm)
    ]);
  }

  // ==========================================
  // Регистрация агентов
  // ==========================================

  /**
   * Регистрация отдельного агента в системе
   */
  public registerAgent(agent: Agent): void {
    this.agents.set(agent.name, agent);
    logger.info(`[AgentOrchestrator] Registered agent: ${agent.name}`);
  }

  /**
   * Массовая регистрация списка агентов
   */
  public registerAgents(agents: Agent[]): void {
    for (const agent of agents) {
      this.registerAgent(agent);
    }
  }

  // ==========================================
  // Основные методы обработки
  // ==========================================

  /**
   * Обработка входящего пользовательского сообщения:
   * 1. Проверка wake word
   * 2. Определение TaskType и TaskPriority
   * 3. Создание и отправка задачи на исполнение
   */
  public async processMessage(userMessage: string, context: MessageContext): Promise<AIResponse> {
    const rawText = userMessage.trim();
    const isWake = this.checkWakeWord(rawText) || context.isVoice;
    const cleanMessage = this.stripWakeWord(rawText);

    // 0. Проверка на запрос к Рою Специалистов
    try {
      const swarmResponse = await tryExecuteSwarm(cleanMessage, context);
      if (swarmResponse) {
        return {
          text: swarmResponse,
          confidence: 1.0,
          metadata: { isSwarm: true }
        };
      }
    } catch (swarmErr) {
      logger.error('Error executing Specialist Swarm in AgentOrchestrator:', swarmErr);
    }

    logger.info(`[AgentOrchestrator] Processing message from chat ${context.chatId} (wake=${isWake}): "${cleanMessage.slice(0, 60)}"`);

    // Определение типа и приоритета задачи
    const taskType = this.detectTaskType(cleanMessage, context);
    const taskPriority = this.detectTaskPriority(cleanMessage, taskType, context);

    const task: Task = {
      id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      type: taskType,
      priority: taskPriority,
      payload: {
        message: cleanMessage,
        rawMessage: rawText,
        isWake
      },
      context,
      status: 'pending',
      createdAt: Date.now()
    };

    return await this.submitTask(task);
  }

  /**
   * Отправка задачи в диспетчер (немедленное выполнение или постановка в очередь)
   */
  public async submitTask(task: Task): Promise<AIResponse> {
    this.tasks.set(task.id, task);

    const agent = this.findAgent(task);

    if (!agent) {
      logger.warn(`[AgentOrchestrator] No specialized agent found for task type: ${task.type}. Using general LLM fallback.`);
      return await this.fallbackGeneralLLM(task);
    }

    task.assignedAgent = agent.name;

    // Если агент занят, ставим в приоритетную очередь
    if (agent.getStatus() === 'busy') {
      logger.info(`[AgentOrchestrator] Agent ${agent.name} is busy. Enqueuing task ${task.id} with priority ${task.priority}`);
      this.enqueueTask(task);
      this.triggerQueueProcessing();
      return {
        text: `Задача поставлена в очередь (агент ${agent.name} сейчас занят). Обрабатываю...`,
        confidence: 0.85,
        metadata: { taskId: task.id, status: 'queued' }
      };
    }

    // Выполняем задачу напрямую
    return await this.executeTask(task, agent);
  }

  // ==========================================
  // Внутренние методы маршрутизации
  // ==========================================

  /**
   * Поиск наиболее подходящего агента под задачу
   */
  private findAgent(task: Task): Agent | null {
    // 1. Сначала проверяем явный метод canHandle(task)
    for (const agent of this.agents.values()) {
      try {
        if (agent.canHandle(task)) {
          return agent;
        }
      } catch (err) {
        logger.error(`Error in canHandle for agent ${agent.name}:`, err);
      }
    }

    // 2. Если явного совпадения нет, ищем по зарегистрированным возможностям
    for (const agent of this.agents.values()) {
      const match = agent.capabilities?.some(cap => cap.supportedTaskTypes?.includes(task.type));
      if (match) {
        return agent;
      }
    }

    // 3. Фолбэк на SupportAgent для общих вопросов
    const support = this.agents.get('SupportAgent');
    if (support) return support;

    return null;
  }

  /**
   * Исполнение задачи конкретным агентом
   */
  private async executeTask(task: Task, agent?: Agent): Promise<AIResponse> {
    const targetAgent = agent || this.agents.get(task.assignedAgent || '');
    if (!targetAgent) {
      task.status = 'failed';
      task.error = 'Assigned agent not found';
      return await this.fallbackGeneralLLM(task);
    }

    try {
      task.status = 'in_progress';
      logger.info(`[AgentOrchestrator] Executing task ${task.id} via agent: ${targetAgent.name}`);

      const response = await targetAgent.execute(task);

      task.status = 'completed';
      task.completedAt = Date.now();
      task.result = response;

      // После завершения запускаем разбор очереди
      this.triggerQueueProcessing();

      return response;
    } catch (err: any) {
      task.status = 'failed';
      task.completedAt = Date.now();
      task.error = err?.message || String(err);
      logger.error(`[AgentOrchestrator] Task ${task.id} execution failed:`, err);

      return {
        text: `Произошла ошибка при выполнении запроса агентом ${targetAgent.name}.`,
        confidence: 0.0,
        metadata: { error: task.error }
      };
    }
  }

  /**
   * Добавление задачи в очередь с сортировкой по приоритету (Critical -> High -> Medium -> Low)
   */
  private enqueueTask(task: Task): void {
    this.queue.push(task);
    this.queue.sort((a, b) => {
      const weightA = PRIORITY_WEIGHTS[a.priority] || 1;
      const weightB = PRIORITY_WEIGHTS[b.priority] || 1;
      return weightB - weightA;
    });
  }

  /**
   * Запуск асинхронной обработки очереди
   */
  private triggerQueueProcessing(): void {
    if (!this.isProcessing && this.queue.length > 0) {
      this.processQueue().catch(err => {
        logger.error('[AgentOrchestrator] Error during processQueue:', err);
      });
    }
  }

  /**
   * Обработка накопленной очереди задач
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const task = this.queue[0];
      const agent = this.findAgent(task);

      if (agent && agent.getStatus() !== 'busy') {
        this.queue.shift();
        task.assignedAgent = agent.name;
        await this.executeTask(task, agent);
      } else {
        // Если подходящий агент всё ещё занят, ждем освобождения
        break;
      }
    }

    this.isProcessing = false;
  }

  /**
   * Фолбэк на базовую языковую модель при отсутствии специализированного агента
   */
  private async fallbackGeneralLLM(task: Task): Promise<AIResponse> {
    try {
      const prompt = task.payload?.message || '';
      const text = await this.llm.smartCall(
        task.context.chatId,
        prompt,
        this.systemPrompts.general
      );

      return {
        text,
        confidence: 0.9
      };
    } catch (err: any) {
      logger.error('[AgentOrchestrator] Fallback LLM error:', err);
      return {
        text: 'Привет! Я Selin AI. Чем я могу вам помочь?',
        confidence: 0.5
      };
    }
  }

  // ==========================================
  // Вспомогательные методы классификации
  // ==========================================

  private checkWakeWord(text: string): boolean {
    const lower = text.toLowerCase();
    return lower.includes('селин') ||
           lower.includes('selin') ||
           lower.includes('привет селин') ||
           lower.includes('hey selin') ||
           lower.includes('салам селин');
  }

  private stripWakeWord(text: string): string {
    return text.replace(/^(селин|selin|привет селин|hey selin|салам селин)[,:\s]*/i, '').trim() || text;
  }

  private detectTaskType(text: string, context: MessageContext): TaskType {
    const lower = text.toLowerCase();

    if (context.isVoice) return TaskType.VOICE;

    if (lower.includes('купить') || lower.includes('цена') || lower.includes('стоимость') || lower.includes('кп') || lower.includes('тариф')) {
      return TaskType.MARKETING;
    }
    if (lower.includes('такси') || lower.includes('еда') || lower.includes('доставка') || lower.includes('заказ')) {
      return TaskType.ORDER;
    }
    if (lower.includes('билет') || lower.includes('отель') || lower.includes('рейс') || lower.includes('тур') || lower.includes('путешеств')) {
      return TaskType.TRAVEL;
    }
    if (lower.includes('учить') || lower.includes('урок') || lower.includes('английск') || lower.includes('слова') || lower.includes('перевод')) {
      return TaskType.EDUCATION;
    }
    if (lower.includes('бизнес') || lower.includes('стартап') || lower.includes('план') || lower.includes('воронка')) {
      return TaskType.BUSINESS_AUTOMATION;
    }
    if (lower.includes('код') || lower.includes('скрипт') || lower.includes('программ') || lower.includes('баг') || lower.includes('typescript')) {
      return TaskType.CODING;
    }
    if (lower.includes('здоровь') || lower.includes('пульс') || lower.includes('давление') || lower.includes('симптом') || lower.includes('врач')) {
      return TaskType.HEALTH;
    }
    if (lower.includes('погода') || lower.includes('температура') || lower.includes('дождь') || lower.includes('прогноз')) {
      return TaskType.WEATHER;
    }
    if (lower.includes('пост') || lower.includes('статья') || lower.includes('контент') || lower.includes('текст')) {
      return TaskType.CONTENT;
    }
    if (lower.includes('новост') || lower.includes('события') || lower.includes('курс валют')) {
      return TaskType.NEWS;
    }

    return TaskType.CUSTOMER_SUPPORT;
  }

  private detectTaskPriority(text: string, taskType: TaskType, context: MessageContext): TaskPriority {
    const lower = text.toLowerCase();

    if (lower.includes('срочно') || lower.includes('sos') || lower.includes('опасность') || taskType === TaskType.HEALTH) {
      return TaskPriority.CRITICAL;
    }
    if (lower.includes('важно') || taskType === TaskType.MARKETING || taskType === TaskType.CODING) {
      return TaskPriority.HIGH;
    }
    if (taskType === TaskType.ORDER || taskType === TaskType.TRAVEL || taskType === TaskType.EDUCATION) {
      return TaskPriority.MEDIUM;
    }
    return TaskPriority.LOW;
  }

  // ==========================================
  // Статус и телеметрия
  // ==========================================

  /**
   * Получение сводного статуса работы оркестратора
   */
  public getStatus(): { agents: any[]; queueLength: number; tasksCount: number } {
    const agentsStatus = Array.from(this.agents.values()).map(a => ({
      name: a.name,
      description: a.description,
      status: a.getStatus(),
      capabilitiesCount: a.capabilities.length
    }));

    return {
      agents: agentsStatus,
      queueLength: this.queue.length,
      tasksCount: this.tasks.size
    };
  }

  /**
   * Список имен всех активных (idle или busy) агентов
   */
  public getActiveAgents(): string[] {
    return Array.from(this.agents.values())
      .filter(a => a.getStatus() !== 'error')
      .map(a => a.name);
  }
}

export const agentOrchestrator = new AgentOrchestrator();
