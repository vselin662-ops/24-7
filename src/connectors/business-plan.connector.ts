import { BaseConnector } from "./base";
import { logger } from "../logger";
import { GoogleGenAI } from "@google/genai";

export interface BusinessPlanParams {
  businessIdea: string;
  targetAudience?: string;
  budgetRub?: number;
  timeframeMonths?: number;
  niche?: string;
}

export interface VisualPrompt {
  concept: string;
  imagenPrompt: string;
  midjourneyPrompt: string;
  dallePrompt: string;
}

export interface BusinessPlanResult {
  planTitle: string;
  executiveSummary: string;
  smartGoals: Array<{ goal: string; metric: string; deadline: string }>;
  executionPhases: Array<{ phase: string; duration: string; keyDeliverables: string[] }>;
  debateConsensus: {
    proponentSummary: string;
    criticSummary: string;
    finalStrategy: string;
  };
  visualPrompts: VisualPrompt[];
  fullPlanMarkdown: string;
}

export class BusinessPlanConnector extends BaseConnector<BusinessPlanParams, BusinessPlanResult> {
  public readonly name = "business_plan_connector";
  public readonly description = "Генерация полного бизнес-плана со стратегическим дебатом AI, SMART-целями и промтами для Imagen/Midjourney/DALL-E";

  protected async execute(params: BusinessPlanParams, tenantId?: string): Promise<BusinessPlanResult> {
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!geminiKey) {
      throw new Error("GEMINI_API_KEY не установлен в переменных окружения");
    }

    logger.info("📊 Запуск генератора бизнес-плана со встроенным дебатом", { tenantId, idea: params.businessIdea });

    const ai = new GoogleGenAI({ apiKey: geminiKey });

    const prompt = `Ты — команда из 3 топовых экспертов (Инноватор, Скептик-аудитор, Финансовый Стратег).
Проведи дебаты и составь исчерпывающий бизнес-план для идеи: "${params.businessIdea}".
Целевая аудитория: ${params.targetAudience || "Малый и средний бизнес"}.
Бюджет: ${params.budgetRub ? `${params.budgetRub} руб.` : "Оптимальный для старта"}.
Срок реализации: ${params.timeframeMonths || 6} месяцев.

Верни ответ СТРОГО в формате JSON со следующей структурой:
{
  "planTitle": "Название проекта и краткий слоган",
  "executiveSummary": "Резюме проекта (2-3 предложения)",
  "smartGoals": [
    { "goal": "Конкретная SMART цель", "metric": "Критерий успеха / KPI", "deadline": "Месяц 1" }
  ],
  "executionPhases": [
    { "phase": "Этап 1: Подготовка", "duration": "1 месяц", "keyDeliverables": ["Результат 1", "Результат 2"] }
  ],
  "debateConsensus": {
    "proponentSummary": "Аргументы ЗА от Инноватора",
    "criticSummary": "Риски от Скептика",
    "finalStrategy": "Итоговая сбалансированная стратегия"
  },
  "visualPrompts": [
    {
      "concept": "Логотип и брендбук",
      "imagenPrompt": "Prompt for Google Imagen...",
      "midjourneyPrompt": "Prompt for Midjourney v6...",
      "dallePrompt": "Prompt for DALL-E 3..."
    },
    {
      "concept": "Лендинг / Баннер компании",
      "imagenPrompt": "Prompt for Google Imagen...",
      "midjourneyPrompt": "Prompt for Midjourney...",
      "dallePrompt": "Prompt for DALL-E 3..."
    }
  ],
  "fullPlanMarkdown": "# Заголовок\\n\\nПодробный текст бизнес-плана..."
}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const responseText = response.text || "";
    let parsed: any = null;

    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      logger.warn("Ошибка парсинга JSON бизнес-плана, переход на форматирование", { error: e });
    }

    if (!parsed) {
      throw new Error("Не удалось сформировать структурный JSON бизнес-план от AI");
    }

    return {
      planTitle: parsed.planTitle || `Бизнес-план: ${params.businessIdea}`,
      executiveSummary: parsed.executiveSummary || "Инновационный проект с высокой маржинальностью.",
      smartGoals: parsed.smartGoals || [],
      executionPhases: parsed.executionPhases || [],
      debateConsensus: parsed.debateConsensus || {
        proponentSummary: "Высокий рыночный потенциал",
        criticSummary: "Необходим жесткий контроль расходов",
        finalStrategy: "Пошаговый запуск MVP"
      },
      visualPrompts: parsed.visualPrompts || [],
      fullPlanMarkdown: parsed.fullPlanMarkdown || responseText,
    };
  }

  protected async handleFallback(
    params: BusinessPlanParams,
    error: Error,
    tenantId?: string
  ): Promise<{ data?: BusinessPlanResult; fallbackUrl?: string; message?: string }> {
    // Offline / Local Template Strategy Fallback
    const fallbackTitle = `Стратегический план: ${params.businessIdea}`;

    const fallbackResult: BusinessPlanResult = {
      planTitle: fallbackTitle,
      executiveSummary: `Автономная бизнес-модель для запуска '${params.businessIdea}' с фокусом на минимальный риск и быстрый вывод MVP на рынок.`,
      smartGoals: [
        { goal: "Запуск минимального жизнеспособного продукта (MVP)", metric: "Первые 10 платящих клиентов", deadline: "Месяц 1" },
        { goal: "Выход на окупаемость по операционным расходам", metric: "Выручка 300 000 руб/мес", deadline: "Месяц 3" },
        { goal: "Масштабирование каналов привлечения", metric: "LTV / CAC > 3", deadline: "Месяц 6" }
      ],
      executionPhases: [
        { phase: "Фаза 1: Разработка и Упаковка", duration: "1 месяц", keyDeliverables: ["Лендинг + Бот", "Настройка рекламных кабинетов"] },
        { phase: "Фаза 2: Тестирование гипотез", duration: "2 месяца", keyDeliverables: ["Первые продажи", "Сбор обратной связи"] },
        { phase: "Фаза 3: Масштабирование", duration: "3 месяца", keyDeliverables: ["Автоматизация процессов", "Рост команды"] }
      ],
      debateConsensus: {
        proponentSummary: "Низкий порог входа, высокий спрос на автоматизацию.",
        criticSummary: "Риск высокой стоимости привлечения клиента на старте.",
        finalStrategy: "Запуск через закрытые продажи и контент-маркетинг с последующим масштабированием."
      },
      visualPrompts: [
        {
          concept: "Айдентика бренда",
          imagenPrompt: `Minimalist corporate logo for ${params.businessIdea}, premium vector art, dark mode aesthetics, high quality`,
          midjourneyPrompt: `Modern tech logo for ${params.businessIdea} --ar 1:1 --v 6.0 --style raw`,
          dallePrompt: `Vector graphic logo representing ${params.businessIdea}, clean lines, professional branding`
        },
        {
          concept: "Рекламный баннер",
          imagenPrompt: `Professional digital dashboard banner for ${params.businessIdea}, 3d render, soft neon accents`,
          midjourneyPrompt: `High tech product showcase for ${params.businessIdea} --ar 16:9`,
          dallePrompt: `SaaS product promotional image for ${params.businessIdea}, modern user experience visual`
        }
      ],
      fullPlanMarkdown: `# ${fallbackTitle}\n\n## 1. Резюме\nПроект направлен на реализацию идеи **${params.businessIdea}**.\n\n## 2. Ключевые этапы\n- Разработка MVP\n- Привлечение клиентов\n- Масштабирование`,
    };

    return {
      data: fallbackResult,
      message: `Генерация AI переведена на офлайн-шаблон (${error.message}). Готовы SMART-цели, этапы и промты для генерации айдентики.`,
    };
  }
}

import { sqliteDb } from "../../db";

function getGemini(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

export async function diagnoseBusiness(tenantId: string): Promise<string> {
  if (!sqliteDb) return "База данных недоступна.";
  const now = new Date().toISOString();

  const profile = sqliteDb.prepare("SELECT * FROM business_profile WHERE tenant_id = ?").get(tenantId);
  if (!profile) {
    sqliteDb.prepare(`
      INSERT INTO business_profile (tenant_id, niche, stage, revenue, team_size, main_problem, started_at)
      VALUES (?, 'Не указано', 'idea', 0, 1, 'Поиск бизнес-модели', ?)
    `).run(tenantId, now);
  }

  // Set user mode to business
  const nowStr = new Date().toISOString();
  sqliteDb.prepare(`
    INSERT INTO user_mode (tenant_id, mode, mode_data, updated_at)
    VALUES (?, 'business', '{"step":"diagnose"}', ?)
    ON CONFLICT(tenant_id) DO UPDATE SET mode = 'business', updated_at = excluded.updated_at
  `).run(tenantId, nowStr);

  const ai = getGemini();
  if (!ai) {
    return `💼 **Бизнес-диагностика начата!**\n\nОтветь на пару вопросов:\n1. Ваша ниша и идея?\n2. Стадия бизнеса (идея, MVP, есть продажи)?\n3. Текущий доход в месяц?\n4. Размер команды?\n5. Главная проблема прямо сейчас?`;
  }

  try {
    const prompt = `Ты строгий и опытный бизнес-ментор. Начни экспресс-диагностику бизнеса пользователя.
Задай 5 ключевых вопросов списком (Ниша, Стадия, Доход, Команда, Главный блокер), чтобы составить первичный бизнес-профиль.`;
    const res = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
    return `💼 **Экспресс-диагностика бизнеса:**\n\n${res.text}`;
  } catch (err) {
    return `💼 **Бизнес-диагностика:** Напиши подробнее о своей нише, текущем доходе и главной проблеме в бизнесе.`;
  }
}

export async function generateDailyTask(tenantId: string): Promise<string> {
  if (!sqliteDb) return "База данных недоступна.";

  const profile = sqliteDb.prepare("SELECT * FROM business_profile WHERE tenant_id = ?").get(tenantId);
  const niche = profile?.niche || "Общий бизнес";
  const stage = profile?.stage || "idea";

  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const ai = getGemini();

  if (!ai) {
    const taskId = `task_${Date.now()}`;
    sqliteDb.prepare(`
      INSERT INTO business_tasks (id, tenant_id, title, description, due_date, status)
      VALUES (?, ?, 'Исследование 3 главных конкурентов', 'Найди 3 прямых конкурента в твоей нише и выпиши их сильные и слабые стороны.', ?, 'pending')
    `).run(taskId, tenantId, tomorrow);

    return `🎯 **Задание на сегодня (Ниша: ${niche}):**\n\n**Задача:** Исследование 3 главных конкурентов\n**Что сделать:** Найди 3 конкурента и выпиши их цены и предложения.\n**Срок:** до завтра!`;
  }

  try {
    const prompt = `Ты бизнес-ментор. Ниша: ${niche}, стадия: ${stage}.
Сформируй ОДНУ конкретную и выполнимую задачу на сегодня, которая напрямую приведет к деньгам или привлечению клиентов.
Формат JSON: {"title": "string", "description": "string"}`;

    const res = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" }
    });

    const taskData = JSON.parse(res.text || "{}");
    const title = taskData.title || "Сделать 5 звонков клиентам";
    const desc = taskData.description || "Собрать обратную связь от потенциальных клиентов";

    const taskId = `task_${Date.now()}`;
    sqliteDb.prepare(`
      INSERT INTO business_tasks (id, tenant_id, title, description, due_date, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(taskId, tenantId, title, desc, tomorrow);

    return `🎯 **Бизнес-задание на сегодня:**\n\n📌 **${title}**\n📝 ${desc}\n\n*Когда выполнишь — напиши отчёт прямо сюда!*`;
  } catch (err) {
    return `🎯 **Задание на сегодня:** Сделай оффер для 3 потенциальных клиентов и собери от них обратную связь. Напиши отчёт после выполнения!`;
  }
}

export async function checkTask(tenantId: string, report: string): Promise<string> {
  if (!sqliteDb) return "База данных недоступна.";

  const pendingTask = sqliteDb.prepare(`
    SELECT * FROM business_tasks WHERE tenant_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1
  `).get(tenantId);

  const ai = getGemini();
  const now = new Date().toISOString();

  if (!pendingTask) {
    return "У вас нет активного бизнес-задания. Напишите 'задание', чтобы получить новую задачу от ментора!";
  }

  if (!ai) {
    sqliteDb.prepare("UPDATE business_tasks SET status = 'done', result = ?, completed_at = ? WHERE id = ?").run(report, now, pendingTask.id);
    return `✅ **Отчёт принят!** Задание "${pendingTask.title}" отмечено как выполненное.`;
  }

  try {
    const prompt = `Ты бизнес-тренер. Задача была: "${pendingTask.title}: ${pendingTask.description}"
Отчёт пользователя о выполнении: "${report}"

Оцени выполнение (done / partial / failed), дай разбор и конструктивные советы.
Верни ответ СТРОГО в JSON: {"status": "done" | "partial" | "failed", "feedback": "string"}`;

    const res = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" }
    });

    const evalData = JSON.parse(res.text || "{}");
    const status = evalData.status || "done";
    const feedback = evalData.feedback || "Отличная работа над выполнением задачи.";

    sqliteDb.prepare("UPDATE business_tasks SET status = ?, result = ?, completed_at = ? WHERE id = ?").run(status, report, now, pendingTask.id);

    // Update streak
    const streakRow = sqliteDb.prepare("SELECT * FROM business_streaks WHERE tenant_id = ?").get(tenantId);
    let curStreak = streakRow ? streakRow.current_streak + 1 : 1;
    let maxStreak = streakRow ? Math.max(streakRow.max_streak, curStreak) : 1;

    sqliteDb.prepare(`
      INSERT INTO business_streaks (tenant_id, current_streak, max_streak, last_active_date)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET
        current_streak = excluded.current_streak,
        max_streak = excluded.max_streak,
        last_active_date = excluded.last_active_date
    `).run(tenantId, curStreak, maxStreak, now);

    return `📊 **Разбор отчёта от ментора:**\n\nСтатус: ${status === 'done' ? '✅ Выполнено' : status === 'partial' ? '⚠️ Частично' : '❌ Не зачтено'}\n\n${feedback}\n\n🔥 Твой бизнес-стрик: ${curStreak} дней подряд!`;
  } catch (err) {
    sqliteDb.prepare("UPDATE business_tasks SET status = 'done', result = ?, completed_at = ? WHERE id = ?").run(report, now, pendingTask.id);
    return `✅ **Отчёт принят!** Задание было успешно сдано.`;
  }
}

export async function weeklyReview(tenantId: string): Promise<string> {
  if (!sqliteDb) return "База данных недоступна.";

  const doneCount = sqliteDb.prepare("SELECT COUNT(*) as cnt FROM business_tasks WHERE tenant_id = ? AND status = 'done'").get(tenantId)?.cnt || 0;
  const totalCount = sqliteDb.prepare("SELECT COUNT(*) as cnt FROM business_tasks WHERE tenant_id = ?").get(tenantId)?.cnt || 0;
  const streak = sqliteDb.prepare("SELECT current_streak FROM business_streaks WHERE tenant_id = ?").get(tenantId)?.current_streak || 0;

  return `📈 **Еженедельный бизнес-обзор:**

• **Выполнено задач:** ${doneCount} из ${totalCount}
• **Текущий стрик:** 🔥 ${streak} дней
• **Статус активности:** Высокий

**Рекомендации на следующую неделю:**
1. Провести не менее 3 встреч или звонков с клиентами.
2. Поднять средний чек или протестировать допродажи.
3. Автоматизировать 1 рутинный процесс.

Напиши 'задание', чтобы получить следующую задачу!`;
}

export async function salesRoleplay(tenantId: string, scenario: string = "Продажа услуги потенциальному клиенту"): Promise<string> {
  const ai = getGemini();

  // Set user mode to business_roleplay
  const nowStr = new Date().toISOString();
  if (sqliteDb) {
    sqliteDb.prepare(`
      INSERT INTO user_mode (tenant_id, mode, mode_data, updated_at)
      VALUES (?, 'business', ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET mode = 'business', mode_data = excluded.mode_data, updated_at = excluded.updated_at
    `).run(tenantId, JSON.stringify({ roleplay: true, scenario }), nowStr);
  }

  if (!ai) {
    return `🎭 **Ролевая игра: Симуляция продаж**\n\nСценарий: ${scenario}\n\n*Я клиент. Здравствуйте, расскажите, почему я должен купить именно у вас?*`;
  }

  try {
    const prompt = `Ты потенциальный клиентоориентированный покупатель со сомнениями и возражениями.
Сценарий ролевой игры: ${scenario}.
Поприветствуй продавца (пользователя), задай ему первый вопрос с возражением по цене или качеству, чтобы протестировать его навыки продаж.`;

    const res = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    return `🎭 **Симулятор продаж (Ролевая игра):**\nСценарий: *${scenario}*\n\n**Клиент (AI):** "${res.text}"\n\n*Ответь клиенту так, как если бы вы вели настоящие переговоры!*`;
  } catch (err) {
    return `🎭 **Симулятор продаж:** "Добрый день! Я посмотрел ваше предложение. Почему у вас дороже, чем у конкурентов?"`;
  }
}

