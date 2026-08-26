import { BaseAgent } from './BaseAgent';
import { Task, TaskType, AIResponse, AgentCapabilityType } from '../core/types';
import { LLMService, llmService } from '../core/LLMService';
import { logger } from '../logger';

/**
 * Агент погоды (WeatherAgent).
 * 
 * Возможности:
 * - Сбор актуальных погодных данных по любому городу
 * - Подбор рекомендаций по погоде (зонт, одежда)
 * - Формирование прогнозов
 */
export class WeatherAgent extends BaseAgent {
  public readonly name = 'WeatherAgent';
  public readonly description = 'Сбор актуальных погодных данных, составление прогнозов и рекомендаций.';

  constructor(llm: LLMService = llmService) {
    super('WeatherAgent', 'Сбор актуальных погодных данных, составление прогнозов и рекомендаций.', llm);
    this.capabilities = [
      {
        name: 'weather_lookup',
        description: 'Получение текущей погоды и прогноза',
        supportedTaskTypes: [TaskType.WEATHER],
        capabilities: [AgentCapabilityType.EXTERNAL_API_CALL, AgentCapabilityType.TEXT_GENERATION],
        supportsVoice: true,
        supportsCamera: false,
        supportsLocation: true
      }
    ];
  }

  public canHandle(task: Task): boolean {
    if (task.type === TaskType.WEATHER) return true;
    const msg = (task.payload?.message || '').toLowerCase();
    return msg.includes('погод') ||
           msg.includes('температур') ||
           msg.includes('дожд') ||
           msg.includes('снег') ||
           msg.includes('градус') ||
           msg.includes('прогноз') ||
           msg.includes('ветер') ||
           msg.includes('зонт');
  }

  public async execute(task: Task): Promise<AIResponse> {
    this.setStatus('busy');
    const userMessage = task.payload?.message || '';

    // Таблица соответствия городов для точного локального извлечения
    const COMMON_CITIES_MAP: Record<string, string> = {
      'москв': 'Москва',
      'питер': 'Санкт-Петербург',
      'спб': 'Санкт-Петербург',
      'сочи': 'Сочи',
      'казан': 'Казань',
      'новосибирск': 'Новосибирск',
      'екатеринбург': 'Екатеринбург',
      'париж': 'Париж',
      'лондон': 'Лондон',
      'дуба': 'Дубай',
      'стамбул': 'Стамбул',
      'краснодар': 'Краснодар',
      'самаре': 'Самара',
      'челябинск': 'Челябинск',
      'омск': 'Омск',
      'ростов': 'Ростов-на-Дону',
      'уфе': 'Уфа',
      'волгоград': 'Волгоград',
      'перм': 'Пермь',
      'воронеж': 'Воронеж',
      'саратов': 'Саратов',
      'тольятти': 'Тольятти'
    };

    let city = 'Москва';
    const lowerMsg = userMessage.toLowerCase();
    for (const [key, val] of Object.entries(COMMON_CITIES_MAP)) {
      if (lowerMsg.includes(key)) {
        city = val;
        break;
      }
    }

    try {
      // 1. Извлекаем город из сообщения пользователя с помощью LLM (как основной вариант)
      const cityExtractionPrompt = `Extract ONLY the city name in nominative case (именительный падеж, e.g. 'Москва', 'Лондон', 'Санкт-Петербург') from this user query.
If multiple cities or no cities are specified, return exactly 'Москва' (without quotes, punctuation or extra explanation).
Query: "${userMessage}"`;
      
      try {
        const cityRaw = await this.callLLM(cityExtractionPrompt);
        const cleanedCity = cityRaw.trim().replace(/[".]/g, '');
        // Если вернулась общая заглушка или слишком длинная строка, используем локальное совпадение
        if (cleanedCity && cleanedCity.length < 30 && !cleanedCity.includes('Selin') && !cleanedCity.includes('Привет') && !cleanedCity.includes('Чем могу')) {
          city = cleanedCity;
        }
      } catch (e) {
        logger.warn(`[WeatherAgent] LLM city extraction failed, using default/regex city: ${city}`);
      }

      // Лог по формату из инструкции:
      console.log('🌤 [Weather] agent=' + this.name + ' city=' + city);

      // 2. Получаем реальную погоду через API/wttr.in
      const weatherData = await this.fetchWeather(city);

      // 3. Формируем финальный красивый ответ пользователю через LLM
      const systemPrompt = `Ты — WeatherAgent в Selin AI 2.0. Твоя задача — предоставить дружелюбный, точный и емкий отчет о погоде на основе реальных данных. 
Дай полезные рекомендации (нужен ли зонт, как лучше одеться). Сделай ответ лаконичным, живым и приятным для чтения.`;

      const prompt = `Запрос пользователя: "${userMessage}".
Реальные данные о погоде: "${weatherData}".
Напиши красивый ответ пользователю в стиле Selin AI. Обязательно используй реальные данные (температуру, ветер, облачность). Добавь заботливые рекомендации по одежде или зонту.`;

      let aiText = "";
      try {
        aiText = await this.callLLM(prompt, systemPrompt);
      } catch (e) {
        logger.warn(`[WeatherAgent] LLM final speech generation failed, using structured fallback.`);
      }

      // Если LLM вернула общую заглушку или упала, делаем шикарный текстовый шаблон на реальных данных
      if (!aiText || aiText === "Привет! Я — Selin AI. Чем могу помочь?" || aiText.includes("Selin AI")) {
        aiText = `🌤️ **Прогноз погоды в городе ${city}:**\n\n${weatherData}\n\n*Рекомендация:* Одевайтесь по погоде. Если прогнозируется дождь или сырость, не забудьте взять с собой зонт! Желаю вам прекрасного дня! ☀️`;
      }

      this.setStatus('idle');
      return {
        text: aiText,
        confidence: 0.95,
        suggestedReplies: [
          `Какая погода в Санкт-Петербурге?`,
          `Нужен ли сегодня зонт в городе ${city}?`,
          `Какой прогноз на завтра?`
        ],
        metadata: {
          city,
          weatherData,
          timestamp: Date.now()
        }
      };
    } catch (err: any) {
      return this.handleError(`Ошибка при получении данных о погоде: ${err?.message || err}`, err);
    }
  }

  private async fetchWeather(city: string): Promise<string> {
    const apiKey = process.env.WEATHER_API_KEY || process.env.OPENWEATHER_API_KEY;
    if (apiKey) {
      try {
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric&lang=ru`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json() as any;
          const temp = Math.round(data.main?.temp);
          const feels = Math.round(data.main?.feels_like);
          const desc = data.weather?.[0]?.description || '';
          const humidity = data.main?.humidity;
          const wind = data.wind?.speed;
          return `В городе ${city} сейчас ${desc}, температура воздуха: ${temp > 0 ? '+' : ''}${temp}°C (ощущается как ${feels > 0 ? '+' : ''}${feels}°C), влажность: ${humidity}%, скорость ветра: ${wind} м/с.`;
        }
      } catch (e: any) {
        logger.warn(`[WeatherAgent] OpenWeatherMap failed, falling back to wttr.in: ${e.message || e}`);
      }
    }

    // Fallback to wttr.in JSON
    try {
      const wttrUrl = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
      const res = await fetch(wttrUrl);
      if (res.ok) {
        const data = await res.json() as any;
        const current = data.current_condition?.[0];
        if (current) {
          const temp = current.temp_C;
          const feels = current.FeelsLikeC;
          const desc = current.lang_ru?.[0]?.value || current.weatherDesc?.[0]?.value || '';
          const humidity = current.humidity;
          const wind = current.windspeedKmph;
          return `В городе ${city} сейчас ${desc}, температура воздуха: ${Number(temp) > 0 ? '+' : ''}${temp}°C (ощущается как ${Number(feels) > 0 ? '+' : ''}${feels}°C), влажность: ${humidity}%, ветер: ${Math.round(Number(wind) / 3.6)} м/с.`;
        }
      }
    } catch (e: any) {
      logger.warn(`[WeatherAgent] wttr.in JSON failed: ${e.message || e}`);
    }

    // Extreme fallback wttr.in text format
    try {
      const wttrUrl = `https://wttr.in/${encodeURIComponent(city)}?format=3`;
      const res = await fetch(wttrUrl);
      if (res.ok) {
        const text = await res.text();
        return text.trim();
      }
    } catch (e: any) {
      logger.warn(`[WeatherAgent] wttr.in text failed: ${e.message || e}`);
    }

    return `К сожалению, не удалось связаться с погодным сервером для города ${city}.`;
  }
}
