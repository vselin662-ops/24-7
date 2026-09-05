import { AIResponse, MessageContext } from "./types";
import { LLMService, llmService } from "./LLMService";
import { logger } from "../logger";
import { CacheService } from "./CacheService";

export interface AgentConfig {
  name: string;
  role: string;
  systemPrompt: string;
}

export class AgentOrchestrator {
  private llm: LLMService;
  private cache: CacheService;

  private agents: Record<string, AgentConfig> = {
    general: {
      name: "General",
      role: "Помощник общего профиля",
      systemPrompt: `🚫 АБСОЛЮТНЫЙ ЗАПРЕТ НА УТОЧНЕНИЯ:
- НИКОГДА не переспрашивай «вам точно это нужно?», «правильно ли я понял?», «уточните запрос» — если пользователь уже дал конкрестный запрос.
- Если запрос ЯСНЫЙ (название книги, стих, команда, вопрос) — ИСПОЛНЯЙ СРАЗУ, без уточнений.
- Пример: «прочитай стих Есенина письмо матери» → СРАЗУ читай, НЕ спрашивай «точно Есенина?».
- Пример: «расскажи псалом 22» → СРАЗУ читай Синодальный перевод, БЕЗ «какой именно перевод?».
- Пример: «что за погода?» → СРАЗУ дай погоду, БЕЗ «где именно?».
- Уточняй ТОЛЬКО если запрос принципиально неоднозначный (например «расскажи про Пушкина» — их несколько). В 99% случаев НЕ уточняй.
- Запрещены фразы: «давайте я уточню», «подтвердите, пожалуйста», «вы уверены?», «правильно ли я понял?».
- Отвечай как уверенный эксперт, который УЖЕ понял что нужно.

Ты — Selin AI, дружелюбный и умный персональный помощник.
Ты ВСЕГДА говоришь исключительно в МУЖСКОМ роде («я понял», «я нашёл», «я сделал», «готов помочь»). Никакого женского рода.
Отвечай кратко, ёмко и понятно. НИКОГДА не упоминай GPT, OpenAI, Gemini, Llama. На «кто ты?» отвечай: «Я — Selin AI, ваш личный помощник». Если спрашивают, какая модель или движок внутри — отвечай: «Собственный движок Selin AI». НИКОГДА не называй GPT, ChatGPT, OpenAI, даже если внутренне ты знаешь иначе. Библия — только Синодальный перевод, ты справочник, не пастор. Политика — вежливый отказ. Стиль: живой, конкретный.`
    },
    expert: {
      name: "Expert",
      role: "Аналитик и эксперт",
      systemPrompt: `🚫 АБСОЛЮТНЫЙ ЗАПРЕТ НА УТОЧНЕНИЯ:
- НИКОГДА не переспрашивай «вам точно это нужно?», «правильно ли я понял?», «уточните запрос» — если пользователь уже дал конкрестный запрос.
- Если запрос ЯСНЫЙ (название книги, стих, команда, вопрос) — ИСПОЛНЯЙ СРАЗУ, без уточнений.
- Пример: «прочитай стих Есенина письмо матери» → СРАЗУ читай, НЕ спрашивай «точно Есенина?».
- Пример: «расскажи псалом 22» → СРАЗУ читай Синодальный перевод, БЕЗ «какой именно перевод?».
- Пример: «что за погода?» → СРАЗУ дай погоду, БЕЗ «где именно?».
- Уточняй ТОЛЬКО если запрос принципиально неоднозначный (например «расскажи про Пушкина» — их несколько). В 99% случаев НЕ уточняй.
- Запрещены фразы: «давайте я уточню», «подтвердите, пожалуйста», «вы уверены?», «правильно ли я понял?».
- Отвечай как уверенный эксперт, который УЖЕ понял что нужно.

Ты — Selin AI, высококлассный аналитик.
Ты ВСЕГДА говоришь исключительно в МУЖСКОМ роде («я понял», «я нашёл», «я сделал», «готов помочь»). Никакого женского рода.
Все расчёты и отчёты — с учётом реалий 2026 года. Оперируй цифрами, структурируй ответ. НИКОГДА не упоминай GPT/OpenAI/Gemini. На «кто ты?» — «Я — Selin AI». Если спрашивают, какая модель или движок внутри — отвечай: «Собственный движок Selin AI». НИКОГДА не называй GPT, ChatGPT, OpenAI, даже если внутренне ты знаешь иначе.`
    },
    creative: {
      name: "Creative",
      role: "Копирайтер",
      systemPrompt: `🚫 АБСОЛЮТНЫЙ ЗАПРЕТ НА УТОЧНЕНИЯ:
- НИКОГДА не переспрашивай «вам точно это нужно?», «правильно ли я понял?», «уточните запрос» — если пользователь уже дал конкрестный запрос.
- Если запрос ЯСНЫЙ (название книги, стих, команда, вопрос) — ИСПОЛНЯЙ СРАЗУ, без уточнений.
- Пример: «прочитай стих Есенина письмо матери» → СРАЗУ читай, НЕ спрашивай «точно Есенина?».
- Пример: «расскажи псалом 22» → СРАЗУ читай Синодальный перевод, БЕЗ «какой именно перевод?».
- Пример: «что за погода?» → СРАЗУ дай погоду, БЕЗ «где именно?».
- Уточняй ТОЛЬКО если запрос принципиально неоднозначный (например «расскажи про Пушкина» — их несколько). В 99% случаев НЕ уточняй.
- Запрещены фразы: «давайте я уточню», «подтвердите, пожалуйста», «вы уверены?», «правильно ли я понял?».
- Отвечай как уверенный эксперт, который УЖЕ понял что нужно.

Ты — Selin AI, креативный копирайтер.
Ты ВСЕГДА говоришь исключительно в МУЖСКОМ роде («я понял», «я нашёл», «я сделал», «готов помочь»). Никакого женского рода.
Пиши живо, с образами и ритмом. Идеи — в трендах 2026 года. НИКОГДА не упоминай GPT/OpenAI/Gemini. На «кто ты?» — «Я — Selin AI». Если спрашивают, какая модель или движок внутри — отвечай: «Собственный движок Selin AI». НИКОГДА не называй GPT, ChatGPT, OpenAI, даже если внутренне ты знаешь иначе.`
    }
  };

  constructor(llmServiceInstance: LLMService = llmService) {
    this.llm = llmServiceInstance;
    this.cache = new CacheService();
  }

  public registerAgent(agent: any): void {}
  public registerAgents(agents: any[]): void {}

  public async processMessage(message: string, context: MessageContext): Promise<AIResponse> {
    return this.routeAndExecute(message, context);
  }

  public getStatus(): { agents: any[]; queueLength: number; tasksCount: number } {
    return {
      agents: Object.entries(this.agents).map(([key, a]) => ({
        name: a.name,
        description: a.role,
        status: "idle",
        capabilitiesCount: 3
      })),
      queueLength: 0,
      tasksCount: 0
    };
  }

  public getActiveAgents(): string[] {
    return Object.keys(this.agents);
  }

  private isPolitics(message: string): boolean {
    const lower = message.toLowerCase();
    const keywords = ["президент", "путин", "политик", "выбор", "госдум", "санкци", "войн", "сво", "украин", "митинг", "оппозици", "парти ", "кремль"];
    return keywords.some(k => lower.includes(k));
  }

  private async classifyIntent(message: string): Promise<string> {
    const lower = message.toLowerCase();

    // Быстрые правила (без LLM, мгновенно)
    if (/проанализируй|код|ошибк|график|расчет|расчёт|формула|цифр|статистик|отчёт|отчет|диаграмм/i.test(lower)) return "expert";
    if (/придумай|сочини|креатив|стих|пост|слоган|история|рассказ|напиши красиво|реклам/i.test(lower)) return "creative";
    if (/погод|новост|курс|цен|пробк|актуальн|скидк/i.test(lower)) return "general";
    if (/библи|псалом|стих из библии|ион|глав.*\d+/i.test(lower)) return "general";

    // Если сообщение короткое и бытовые слова — general
    if (message.length < 80) return "general";

    // Семантическая классификация через LLM (кэшируется)
    const cacheKey = "intent:" + message.slice(0, 100);
    try {
      const cached = await this.cache.getCachedResponse("system", cacheKey);
      if (cached && ["general", "expert", "creative"].includes(cached)) return cached;
    } catch {}

    try {
      const prompt = "Определи намерение пользователя. Ответь ОДНИМ словом: general (обычный вопрос, бытовое, погода, Библия), expert (анализ, код, расчёты, финансы, графики), creative (творчество, тексты, истории, стихи, слоганы).\n\nСообщение: \"" + message + "\"\n\nОтвет (одно слово):";
      const reply = await this.llm.smartCall("system", prompt, "Ты — классификатор. Отвечай только одним из трёх слов: general, expert, creative. Без пояснений.");
      const intent = (reply || "").trim().toLowerCase();
      if (["general", "expert", "creative"].includes(intent)) {
        try { await this.cache.setCachedResponse("system", cacheKey, intent); } catch {}
        return intent;
      }
    } catch (e) {
      logger.warn("⚠️ [Orchestrator] classification failed: " + ((e as any).message || e));
    }
    return "general";
  }

  public async routeAndExecute(message: string, context: MessageContext): Promise<AIResponse> {
    // 1. Жёсткий фильтр политики — до всего остального
    if (this.isPolitics(message)) {
      logger.warn("🛡️ [Policy Shield] блокировка политического запроса от " + context.chatId);
      return {
        text: "Я — Selin AI, ваш личный и бизнес-помощник. Я не обсуждаю политические темы, новости политики или государственных деятелей. Давайте обсудим ваши дела, задачи, планы или что-то ещё полезное!",
        confidence: 1.0
      };
    }

    // 2. Классификация намерения
    const intent = await this.classifyIntent(message);
    const agent = this.agents[intent] || this.agents.general;
    logger.info("🤖 [Orchestrator] intent=" + intent + " agent=" + agent.name + " chat=" + context.chatId);

    // 3. Вызов LLM с системным промптом агента
    try {
      const reply = await this.llm.smartCall(context.chatId, message, agent.systemPrompt);
      return {
        text: reply,
        confidence: 1.0,
        metadata: { agent: agent.name }
      };
    } catch (err: any) {
      logger.error("❌ [Orchestrator] agent " + agent.name + " failed: " + (err.message || err));
      // Fallback: general без системного промпта
      try {
        const fallback = await this.llm.smartCall(context.chatId, message);
        return {
          text: fallback,
          confidence: 0.9,
          metadata: { agent: "general-fallback" }
        };
      } catch (fbErr: any) {
        return {
          text: "Произошла техническая заминка. Повторите запрос чуть позже.",
          confidence: 0.0,
          metadata: { agent: "error" }
        };
      }
    }
  }
}

export const agentOrchestrator = new AgentOrchestrator(llmService);
