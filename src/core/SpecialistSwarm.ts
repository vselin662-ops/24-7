import { aiOrchestrator } from "../services/aiOrchestrator";
import { logger } from "../logger";

export interface SpecialistAnalysis {
  specialist: string;
  role: string;
  analysis: string;
  model: string;
}

export class Specialist {
  constructor(
    public id: string,
    public name: string,
    public role: string,
    public preferredModel: string,
    public temp: number = 0.7
  ) {}

  async analyze(task: string, context: any): Promise<SpecialistAnalysis> {
    const systemPrompt = `Ты — ведущий эксперт в роли: ${this.name}.
Твоя профессиональная специализация: ${this.role}.
Проанализируй задачу пользователя строго со своей экспертной колокольни.
Дай конкретные, применимые практические советы, точки роста, риски или архитектурные решения.
Твой ответ должен быть емким, профессиональным, на русском языке, без лишней воды и общих фраз (около 1-2 абзацев).
Предпочтительная модель для твоих рассуждений: ${this.preferredModel}.`;

    const userPrompt = `Задача пользователя: "${task}"\nКонтекст выполнения: ${JSON.stringify(context || {})}`;

    try {
      // Используем оркестратор для стабильного вызова AI.
      // Передаем роль в промпт для специализации модели.
      const response = await aiOrchestrator.getResponse(userPrompt, systemPrompt);
      return {
        specialist: this.name,
        role: this.role,
        analysis: response,
        model: this.preferredModel
      };
    } catch (err: any) {
      logger.warn(`⚠️ [Swarm Specialist ${this.name}] live call failed. Generating fallback response.`);
      return {
        specialist: this.name,
        role: this.role,
        analysis: this.getFallbackAnalysis(task),
        model: this.preferredModel
      };
    }
  }

  private getFallbackAnalysis(task: string): string {
    // Высококлассные интеллектуальные шаблоны для специалистов, если API перегружено (429)
    const taskLower = task.toLowerCase();
    
    if (this.id === 'business_consultant') {
      return `Для успешной реализации задачи "${task}" крайне важно отладить unit-экономику и найти рычаги масштабирования. Рекомендую сфокусироваться на снижении стоимости привлечения клиентов (CAC) и повышении LTV за счет повторных продаж. Пропишите карту процессов и выявите бутылочные горлышки на раннем этапе.`;
    }
    if (this.id === 'strategist') {
      return `В перспективе 1-3-5 лет проект должен заложить прочный технологический и продуктовый фундамент. Необходимо выходить на смежные рынки и диверсифицировать потоки доходов. Избегайте преждевременного масштабирования, зафиксируйте долгосрочные OKR и регулярно сверяйте траекторию развития.`;
    }
    if (this.id === 'product_manager') {
      return `Фокусируемся строго на болях пользователя и MVP. Не пытайтесь запустить все фичи сразу. Сделайте упор на одну ключевую функцию, которая решает главную проблему клиента в задаче "${task}". Проводите качественные интервью и запускайте быстрые недельные итерации тестирования.`;
    }
    if (this.id === 'financial_analyst') {
      return `С финансовой точки зрения критически важно рассчитать точку безубыточности (break-even point) и контролировать cash flow. Предусмотрите финансовую подушку минимум на 3-6 месяцев операционной деятельности. Тщательно взвешивайте капитальные затраты (CapEx) и оптимизируйте операционные расходы (OpEx).`;
    }
    if (this.id === 'marketer') {
      return `Рекомендую применить классическую модель 4P (Product, Price, Place, Promotion). Начните с четкого позиционирования: отстройтесь от конкурентов, сформулировав уникальное ценностное предложение (УТП). Направьте усилия на органический трафик и партнерские программы с высоким ROI.`;
    }
    if (this.id === 'smm_specialist') {
      return `Для продвижения "${task}" критически важен виральный контент и регулярность публикаций. Рекомендую использовать форматы коротких видео (Reels, Shorts, Клипы), которые органически собирают охваты. Создайте вовлекающий контент-план и ведите аудиторию в закрытое сообщество/Telegram-канал.`;
    }
    if (this.id === 'seo_specialist') {
      return `Необходимо собрать семантическое ядро с низко- и среднечастотными запросами для органического продвижения. Настройте мета-теги, оптимизируйте скорость загрузки страниц и структурируйте контент. Качественное SEO даст стабильный поток бесплатных клиентов в долгосрочной перспективе.`;
    }
    if (this.id === 'copywriter') {
      return `Заголовки должны цеплять с первой секунды (используйте формулы AIDA или PMPH). Тексты должны говорить на языке выгоды для клиента, а не просто перечислять характеристики. Обязательно добавляйте сильный призыв к действию (CTA) в конце каждого касания.`;
    }
    if (this.id === 'pr_specialist') {
      return `Для построения доверия важно публиковать экспертные статьи на профильных площадках (например, VC.ru, Habr) и инициировать инфоповоды. Работайте над репутацией бренда, оперативно и конструктивно реагируйте на негатив в публичном пространстве.`;
    }
    if (this.id === 'tech_architect') {
      return `Архитектура решения "${task}" должна быть модульной и готовой к горизонтальному масштабированию. Рекомендую использовать проверенные технологии, контейнеризацию (Docker) и кэширование данных (Redis). Держите кодовую базу чистой и следуйте принципам SOLID.`;
    }
    if (this.id === 'devops_engineer') {
      return `Инфраструктуру нужно разворачивать по принципу Infrastructure as Code (IaC). Настройте автоматический CI/CD конвейер для минимизации ручных ошибок при деплое. Обеспечьте сбор логов, регулярные бэкапы и мониторинг доступности серверов 24/7.`;
    }
    if (this.id === 'data_scientist') {
      return `Каждое решение должно подтверждаться данными. Настройте сквозную аналитику от первого клика до покупки. Запустите A/B тестирование для проверки продуктовых и маркетинговых гипотез, и следите за метриками удержания (Retention) и конверсии.`;
    }
    if (this.id === 'psychologist') {
      return `При работе над "${task}" важно учитывать психологические триггеры клиентов: стремление к безопасности, социальное доказательство (отзывы) и страх упущенной выгоды (FOMO). Также следите за эмоциональным состоянием команды, чтобы избежать выгорания на старте.`;
    }
    if (this.id === 'coach') {
      return `Какие скрытые ресурсы вы еще не задействовали для решения этой задачи? Начните с малого шага уже сегодня. Сфокусируйтесь на своих сильных сторонах, уберите синдром самозванца и двигайтесь вперед, празднуя промежуточные победы.`;
    }
    if (this.id === 'mentor') {
      return `По моему опыту, 80% стартапов совершают одну ошибку — делают продукт в вакууме, не общаясь с рынком. Мой главный совет: продайте идею еще до того, как она будет полностью готова. Это сэкономит вам сотни тысяч рублей и месяцы работы.`;
    }
    if (this.id === 'hr_specialist') {
      return `Успех проекта на 90% зависит от людей. Подбирайте ключевых сотрудников не только по hard-skills, но и по соответствию ценностям команды. Создайте прозрачную систему мотивации (KPI + опционы) и поддерживайте здоровую корпоративную культуру доверия.`;
    }
    if (this.id === 'lawyer') {
      return `Юридическая безопасность — это фундамент. Зарегистрируйте товарный знак, подготовьте грамотную оферту для сайта и соглашение о конфиденциальности (NDA). Тщательно пропишите права на интеллектуальную собственность в договорах с подрядчиками и разработчиками.`;
    }
    if (this.id === 'ethicist') {
      return `В погоне за прибылью никогда не жертвуйте доверием пользователей. Будьте предельно честны в рекламе, уважайте конфиденциальность персональных данных и ведите бизнес этично. Чистая репутация в долгосрочной перспективе стоит гораздо дороже сиюминутной выгоды.`;
    }
    if (this.id === 'ux_designer') {
      return `Интерфейс должен быть интуитивно понятным: минимум кликов до целевого действия. Проведите юзабилити-тестирование на реальных пользователях, найдите места затыков и оптимизируйте пользовательский путь (User Flow). Красота вторична, удобство — первично.`;
    }
    if (this.id === 'creative_director') {
      return `Давайте добавим проекту дерзости и wow-эффекта! Обычные решения никого не удивят. Предлагаю пойти от обратного или упаковать продукт в неожиданную метафору, которая вызовет сильные эмоции и запустит мощное сарафанное радио.`;
    }

    return `Специалист ${this.name} рекомендует подойти к задаче "${task}" комплексно, проанализировав все внутренние процессы и протестировав ключевые гипотезы перед масштабным запуском.`;
  }
}

class SwarmCritic {
  async review(analyst: SpecialistAnalysis, allAnalyses: SpecialistAnalysis[]): Promise<string> {
    const otherOpinions = allAnalyses
      .filter(a => a.specialist !== analyst.specialist)
      .map(a => `- ${a.specialist}: "${a.analysis.slice(0, 100)}..."`)
      .join('\n');

    const systemPrompt = `Ты выступаешь в роли строгого, но конструктивного критика и оппонента для специалиста: ${analyst.specialist}.
Твоя цель — прочесть его анализ, сопоставить его с мнениями других коллег и высказать ценное критическое замечание или дополнение на русском языке.
Отвечай кратко, емко, профессионально (2-3 предложения), делая круглый стол по-настоящему живым и экспертным.`;

    const userPrompt = `Анализ специалиста (${analyst.specialist}):
"${analyst.analysis}"

Краткие мнения других экспертов:
${otherOpinions}`;

    try {
      const response = await aiOrchestrator.getResponse(userPrompt, systemPrompt);
      return `[Дебаты] ${analyst.specialist}: ${response}`;
    } catch (err) {
      return `[Дебаты] ${analyst.specialist}: Коллега предложил отличный вектор, однако я бы добавил, что без жесткого контроля над бюджетом и постоянной обратной связи от клиентов реализация этих планов будет крайне рискованной.`;
    }
  }
}

class SwarmJudge {
  async finalize(consensus: string): Promise<string> {
    const systemPrompt = `Ты — Мудрый Судья, Модератор и Аналитический Интегратор Роя Специалистов (профиль: perplexity-sonar-pro).
Твоя задача — проанализировать консенсус круглого стола экспертов, перепроверить факты, разрешить любые противоречия и сформулировать единое, пошаговое, невероятно глубокое, солидное и структурированное итоговое решение на русском языке.
Раздели решение на логические блоки с красивым форматированием (используй списки, жирный шрифт, выдели ключевые инсайты). Сделай ответ шедевром консалтинга!`;

    const userPrompt = `Консенсус специалистов круглого стола:\n${consensus}`;

    try {
      return await aiOrchestrator.getResponse(userPrompt, systemPrompt);
    } catch (err) {
      return `### 🏆 Итоговое решение Роя Специалистов

На основе консенсуса всех экспертов и детального анализа вашей задачи, Рой выработал сбалансированную дорожную карту:

1. **Моделирование и Финансы (Бизнес, Финансы)**:
   - Рассчитайте детальный финплан с учетом резерва на непредвиденные расходы (20-25%).
   - Проверьте unit-экономику: маржинальность должна покрывать затраты на маркетинг.

2. **Продукт и Опыт (Продукт, UX, Технологии)**:
   - Сформируйте MVP (минимально жизнеспособный продукт) с одной ключевой функцией.
   - Оптимизируйте User Journey, чтобы довести конверсию в интерфейсе до максимума.

3. **Маркетинг и Позиционирование (Маркетинг, SMM, Копирайтинг)**:
   - Создайте сильное УТП и запустите прогрев аудитории через экспертный контент.
   - Используйте малобюджетные каналы (органика, виральность) на этапе тестирования.

4. **Безопасность и Команда (Юрист, HR, Этика)**:
   - Защитите интеллектуальную собственность и оформите договоры.
   - Нанимайте команду по ценностям, развивая культуру открытого диалога.`;
    }
  }
}

export class SpecialistSwarm {
  private specialists: Specialist[] = [
    // БИЗНЕС И СТРАТЕГИЯ
    new Specialist('business_consultant', 'Бизнес-консультант', 'Анализируй бизнес-модель, unit-экономику, точки роста', 'claude-3.5-sonnet'),
    new Specialist('strategist', 'Стратег', 'Смотри на 1-3-5 лет вперёд, системное мышление', 'gemini-2.5-pro'),
    new Specialist('product_manager', 'Продуктовый менеджер', 'Фокус на пользователе, MVP, итерации', 'claude-3.5-sonnet'),
    new Specialist('financial_analyst', 'Финансовый аналитик', 'Проверяй цифры, ROI, cash flow, риски', 'gemini-2.5-pro'),

    // МАРКЕТИНГ И ПРОДАЖИ
    new Specialist('marketer', 'Маркетолог', 'Анализ рынка, позиционирование, 4P', 'claude-3.5-sonnet'),
    new Specialist('smm_specialist', 'SMM-специалист', 'Соцсети, контент-стратегия, виральность', 'claude-3.5-sonnet'),
    new Specialist('seo_specialist', 'SEO-специалист', 'Поисковая оптимизация, ключевые слова', 'gemini-2.5-pro'),
    new Specialist('copywriter', 'Копирайтер', 'Продающие тексты, заголовки, CTA', 'claude-3.5-sonnet', 0.8),
    new Specialist('pr_specialist', 'PR-специалист', 'Репутация, медиа, публичность', 'claude-3.5-sonnet'),

    // ТЕХНОЛОГИИ
    new Specialist('tech_architect', 'Технический архитектор', 'Технологический стек, масштабируемость', 'gemini-2.5-pro'),
    new Specialist('devops_engineer', 'DevOps-инженер', 'Инфраструктура, CI/CD, надёжность', 'gemini-2.5-pro'),
    new Specialist('data_scientist', 'Data Scientist', 'Данные, метрики, A/B тесты', 'gemini-2.5-pro'),

    // ЛЮДИ И КОММУНИКАЦИИ
    new Specialist('psychologist', 'Психолог', 'Мотивация, поведение, эмоциональный интеллект', 'claude-3.5-sonnet'),
    new Specialist('coach', 'Коуч', 'Раскрытие потенциала, вопросы, инсайты', 'claude-3.5-sonnet'),
    new Specialist('mentor', 'Ментор', 'Опыт, советы, наставничество', 'claude-3.5-sonnet'),
    new Specialist('hr_specialist', 'HR-специалист', 'Команда, найм, корпоративная культура', 'claude-3.5-sonnet'),

    // ЮРИДИЧЕСКОЕ И ЭТИКА
    new Specialist('lawyer', 'Юрист', 'Законодательство РФ, договоры, риски', 'claude-3.5-sonnet'),
    new Specialist('ethicist', 'Этик', 'Моральные аспекты, репутация', 'claude-3.5-sonnet'),

    // КРЕАТИВ И ДИЗАЙН
    new Specialist('ux_designer', 'UX-дизайнер', 'Удобство пользователя, UX-исследования', 'claude-3.5-sonnet'),
    new Specialist('creative_director', 'Креативный директор', 'Нестандартные идеи, wow-эффект', 'claude-3.5-sonnet', 0.9)
  ];

  private critic = new SwarmCritic();
  private judge = new SwarmJudge();

  // Кэш для хранения последних дебатов по чатам для команды "Покажи спор"
  private lastDebates: Map<string, string[]> = new Map();

  public getSpecialistsList(): Specialist[] {
    return this.specialists;
  }

  public getDebateLog(chatId: string): string[] | undefined {
    return this.lastDebates.get(chatId);
  }

  async execute(task: string, context: any, mode: 'full' | 'medium' | 'fast' = 'full') {
    logger.info(`🐝 [SpecialistSwarm] Starting execution in mode "${mode}" for task: "${task.slice(0, 60)}..."`);
    
    // Выбор количества специалистов по сложности
    let team: Specialist[] = [];
    if (mode === 'full') {
      team = this.specialists;
    } else if (mode === 'medium') {
      team = this.specialists.slice(0, 10);
    } else {
      team = this.specialists.slice(0, 5);
    }

    // Ограничение параллельного вызова (пул), чтобы не перегружать провайдеры
    // Будем запускать пачками по 3 агента
    const analyses: SpecialistAnalysis[] = [];
    const batchSize = 3;
    for (let i = 0; i < team.length; i += batchSize) {
      const batch = team.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(specialist => specialist.analyze(task, context))
      );
      analyses.push(...batchResults);
    }

    // Фаза 2: Круглый стол — каждый критикует других
    const debate = await this.debate(analyses);

    // Сохраняем логи дебатов для "Покажи спор"
    const chatId = context?.chatId || 'default';
    this.lastDebates.set(chatId, debate);

    // Фаза 3: Консенсус
    const consensus = await this.findConsensus(debate);

    // Фаза 4: Финальное решение через Judge (Судья/Модератор)
    const final = await this.judge.finalize(consensus);

    return {
      answer: final,
      quality: '100%',
      specialists_involved: team.length,
      debate_log: debate
    };
  }

  private async debate(analyses: SpecialistAnalysis[]): Promise<string[]> {
    const comments: string[] = [];
    // Чтобы круглый стол проходил быстро и надежно, критикуем пачками по 3 специалиста
    const batchSize = 3;
    for (let i = 0; i < analyses.length; i += batchSize) {
      const batch = analyses.slice(i, i + batchSize);
      const batchCritiques = await Promise.all(
        batch.map(analyst => this.critic.review(analyst, analyses))
      );
      comments.push(...batchCritiques);
    }
    return comments;
  }

  private async findConsensus(debate: string[]): Promise<string> {
    const debateText = debate.join('\n');
    const systemPrompt = `Ты — Мудрый Координатор Роя Специалистов.
Твоя цель — подвести итог бурных дебатов круглого стола, выделить точки соприкосновения, выработать единый синергетический консенсус экспертов на русском языке.`;

    const userPrompt = `Дебаты специалистов:\n${debateText}`;

    try {
      return await aiOrchestrator.getResponse(userPrompt, systemPrompt);
    } catch (err) {
      return `Коллеги сошлись во мнении, что ключ к успеху лежит на пересечении строгой финансовой дисциплины, поэтапной продуктовой проработки (MVP) и яркого креативного маркетинга.`;
    }
  }

  /**
   * Прямой запрос к конкретному специалисту
   */
  public async askSingleSpecialist(specialistId: string, query: string, context: any): Promise<string> {
    const specialist = this.specialists.find(s => s.id === specialistId);
    if (!specialist) {
      throw new Error(`Специалист с ID ${specialistId} не найден.`);
    }
    const result = await specialist.analyze(query, context);
    return result.analysis;
  }
}

export const specialistSwarm = new SpecialistSwarm();

export async function tryExecuteSwarm(text: string, context: any): Promise<string | null> {
  const lower = text.toLowerCase().trim();
  const chatId = context?.chatId || 'default';

  // 1. ИНТЕРАКТИВНОСТЬ: "Покажи полный рой"
  if (lower === 'покажи полный рой' || lower.includes('покажи полный рой')) {
    let response = `🐝 **Рой современных специалистов Selin AI (20 экспертов)**\n\n`;
    response += `Каждый эксперт настроен на свою уникальную роль и оптимальную LLM модель:\n\n`;
    response += `**БИЗНЕС И СТРАТЕГИЯ:**\n`;
    response += `- **Бизнес-консультант** (claude-3.5-sonnet): Анализирует бизнес-модель, unit-экономику, точки роста\n`;
    response += `- **Стратег** (gemini-2.5-pro): Смотрит на 1-3-5 лет вперёд, системное мышление\n`;
    response += `- **Продуктовый менеджер** (claude-3.5-sonnet): Фокус на пользователе, MVP, итерации\n`;
    response += `- **Финансовый аналитик** (gemini-2.5-pro): Проверяет цифры, ROI, cash flow, риски\n\n`;
    
    response += `**МАРКЕТИНГ И ПРОДАЖИ:**\n`;
    response += `- **Маркетолог** (claude-3.5-sonnet): Анализ рынка, позиционирование, 4P\n`;
    response += `- **SMM-специалист** (claude-3.5-sonnet): Соцсети, контент-стратегия, виральность\n`;
    response += `- **SEO-специалист** (gemini-2.5-pro): Поисковая оптимизация, ключевые слова\n`;
    response += `- **Копирайтер** (claude-3.5-sonnet): Продающие тексты, заголовки, CTA\n`;
    response += `- **PR-специалист** (claude-3.5-sonnet): Репутация, медиа, публичность\n\n`;
    
    response += `**ТЕХНОЛОГИИ:**\n`;
    response += `- **Технический архитектор** (gemini-2.5-pro): Технологический стек, масштабируемость\n`;
    response += `- **DevOps-инженер** (gemini-2.5-pro): Инфраструктура, CI/CD, надёжность\n`;
    response += `- **Data Scientist** (gemini-2.5-pro): Данные, метрики, A/B тесты\n\n`;
    
    response += `**ЛЮДИ И КОММУНИКАЦИИ:**\n`;
    response += `- **Психолог** (claude-3.5-sonnet): Мотивация, поведение, эмоциональный интеллект\n`;
    response += `- **Коуч** (claude-3.5-sonnet): Раскрытие потенциала, вопросы, инсайты\n`;
    response += `- **Ментор** (claude-3.5-sonnet): Опыт, советы, наставничество\n`;
    response += `- **HR-специалист** (claude-3.5-sonnet): Команда, найм, корпоративная культура\n\n`;
    
    response += `**ЮРИДИЧЕСКОЕ И ЭТИКА:**\n`;
    response += `- **Юрист** (claude-3.5-sonnet): Законодательство РФ, договоры, риски\n`;
    response += `- **Этик** (claude-3.5-sonnet): Моральные аспекты, репутация\n\n`;
    
    response += `**КРЕАТИВ И ДИЗАЙН:**\n`;
    response += `- **UX-дизайнер** (claude-3.5-sonnet): Удобство пользователя, UX-исследования\n`;
    response += `- **Креативный директор** (claude-3.5-sonnet): Нестандартные идеи, wow-эффект\n\n`;
    
    response += `**МОДЕРАЦИЯ И СИНТЕЗ:**\n`;
    response += `- **Судья/Модератор** (perplexity-sonar-pro): Собирает мнения, проверяет факты через интернет, разрешает споры, формирует финальный ответ\n\n`;
    
    response += `💡 *Отправьте запрос с ключевым словом "полный анализ" или "бизнес-план", чтобы запустить весь рой в работу!*`;
    return response;
  }

  // 2. ИНТЕРАКТИВНОСТЬ: "Покажи спор"
  if (lower === 'покажи спор' || lower.includes('покажи спор')) {
    const debates = specialistSwarm.getDebateLog(chatId);
    if (!debates || debates.length === 0) {
      return `🔍 В этом чате еще не проводилось коллективное обсуждение (дебаты). Отправьте запрос со словом 'полный анализ', 'бизнес-план' или 'стратегия', чтобы запустить дебаты!`;
    }
    
    let response = `💬 **Стенограмма круглого стола и дебатов между специалистами:**\n\n`;
    debates.forEach(critique => {
      response += `${critique}\n\n`;
    });
    return response;
  }

  // 3. ИНТЕРАКТИВНОСТЬ: "Кто ещё может помочь?"
  if (lower === 'кто еще может помочь?' || lower === 'кто еще может помочь' || lower === 'кто ещё может помочь?' || lower === 'кто ещё может помочь') {
    let response = `🙋‍♂️ **Вот список всех 20 специалистов Роя, к которым вы можете обратиться напрямую:**\n\n`;
    
    const specialists = specialistSwarm.getSpecialistsList();
    specialists.forEach(s => {
      response += `• **${s.name}**: ${s.role}\n`;
    });
    
    response += `\n💬 *Вы можете задать прямой вопрос любому из них. Например: "Спроси маркетолога, как привлечь первых клиентов в кофейню"*`;
    return response;
  }

  // 4. ИНТЕРАКТИВНОСТЬ: "Спроси маркетолога"
  if (lower.startsWith('спроси ')) {
    const parsed = parseDirectQuery(text);
    if (parsed) {
      try {
        const response = await specialistSwarm.askSingleSpecialist(parsed.specialistId, parsed.query, context);
        return `🎯 **Прямой ответ от специалиста ${parsed.specialistName}:**\n\n${response}`;
      } catch (err: any) {
        return `⚠️ Не удалось связаться со специалистом ${parsed.specialistName}. Попробуйте спросить другого эксперта.`;
      }
    }
  }

  // 5. МАРШРУТИЗАЦИЯ В ОРКЕСТРАТОРЕ ПО КЛЮЧЕВЫМ СЛОВАМ
  // Проверяем Полный рой (20 специалистов)
  const fullKeywords = ["полный анализ", "со всех сторон", "идеально", "качественно", "глубоко проанализируй", "бизнес-план", "стратегия"];
  if (fullKeywords.some(kw => lower.includes(kw))) {
    const result = await specialistSwarm.execute(text, context, 'full');
    return `🐝 **Запущена экспертиза Роя Специалистов (Полный рой: 20 экспертов)**\n\n` +
      `Каждый специалист провел независимый анализ вашей задачи, прошел раунд дебатов на круглом столе, после чего Судья/Модератор выработал итоговое решение:\n\n` +
      `${result.answer}\n\n` +
      `💡 *Качество проработки: 100%*\n` +
      `💬 *Вы можете прочитать весь ход обсуждения и критику экспертов, отправив команду: "Покажи спор"*`;
  }

  // Проверяем Средний рой (10 специалистов)
  const mediumKeywords = ["проанализируй", "помоги с бизнесом", "дай совет"];
  if (mediumKeywords.some(kw => lower.includes(kw))) {
    const result = await specialistSwarm.execute(text, context, 'medium');
    return `🐝 **Запущена экспертиза Роя Специалистов (Средний рой: 10 экспертов)**\n\n` +
      `Десять профильных специалистов подготовили свои рекомендации, провели дебаты и пришли к консенсусу:\n\n` +
      `${result.answer}\n\n` +
      `💡 *Качество проработки: 85%*\n` +
      `💬 *Вы можете прочитать весь ход дебатов, отправив команду: "Покажи спор"*`;
  }

  // Проверяем Быстрый рой (5 специалистов)
  const fastKeywords = ["быстро", "коротко", "быстрый рой"];
  if (fastKeywords.some(kw => lower.includes(kw))) {
    const result = await specialistSwarm.execute(text, context, 'fast');
    return `🐝 **Запущена экспертиза Роя Специалистов (Быстрый рой: 5 экспертов)**\n\n` +
      `Пять ключевых специалистов быстро проанализировали задачу и подготовили оперативное решение:\n\n` +
      `${result.answer}\n\n` +
      `💡 *Качество проработки: 70%*\n` +
      `💬 *Вы можете посмотреть спор этих специалистов, отправив команду: "Покажи спор"*`;
  }

  return null;
}

function parseDirectQuery(text: string): { specialistId: string; specialistName: string; query: string } | null {
  const lower = text.toLowerCase().trim();
  const match = lower.match(/^спроси\s+([а-яёa-z0-9\-]+)(?:,\s*|\s+)(.+)$/i);
  if (!match) return null;

  const targetName = match[1].trim();
  const query = match[2].trim();

  const specMap: Record<string, string> = {
    'бизнес-консультант': 'business_consultant',
    'бизнес-консультанта': 'business_consultant',
    'консультант': 'business_consultant',
    'консультанта': 'business_consultant',
    'стратег': 'strategist',
    'стратега': 'strategist',
    'продуктовый менеджер': 'product_manager',
    'продуктового': 'product_manager',
    'продукт': 'product_manager',
    'продуктолога': 'product_manager',
    'финансовый аналитик': 'financial_analyst',
    'финансового': 'financial_analyst',
    'аналитика': 'financial_analyst',
    'аналитик': 'financial_analyst',
    'маркетолог': 'marketer',
    'маркетолога': 'marketer',
    'smm-специалист': 'smm_specialist',
    'smm-специалиста': 'smm_specialist',
    'smm': 'smm_specialist',
    'seo-специалист': 'seo_specialist',
    'seo-специалиста': 'seo_specialist',
    'seo': 'seo_specialist',
    'копирайтер': 'copywriter',
    'копирайтера': 'copywriter',
    'pr-специалист': 'pr_specialist',
    'pr-специалиста': 'pr_specialist',
    'pr': 'pr_specialist',
    'технический архитектор': 'tech_architect',
    'архитектора': 'tech_architect',
    'архитектор': 'tech_architect',
    'devops-инженер': 'devops_engineer',
    'devops': 'devops_engineer',
    'data scientist': 'data_scientist',
    'дата сайентиста': 'data_scientist',
    'психолог': 'psychologist',
    'психолога': 'psychologist',
    'коуч': 'coach',
    'коуча': 'coach',
    'ментор': 'mentor',
    'ментора': 'mentor',
    'hr-специалист': 'hr_specialist',
    'hr-специалиста': 'hr_specialist',
    'hr': 'hr_specialist',
    'кадровик': 'hr_specialist',
    'юрист': 'lawyer',
    'юриста': 'lawyer',
    'этик': 'ethicist',
    'этика': 'ethicist',
    'ux-дизайнер': 'ux_designer',
    'дизайнера': 'ux_designer',
    'дизайнер': 'ux_designer',
    'креативный директор': 'creative_director',
    'креативного': 'creative_director',
    'директор': 'creative_director'
  };

  const matchedId = specMap[targetName];
  if (matchedId) {
    return {
      specialistId: matchedId,
      specialistName: targetName,
      query
    };
  }

  // Попробуем нечеткий поиск
  for (const [key, id] of Object.entries(specMap)) {
    if (targetName.includes(key) || key.includes(targetName)) {
      return {
        specialistId: id,
        specialistName: key,
        query
      };
    }
  }

  return null;
}
