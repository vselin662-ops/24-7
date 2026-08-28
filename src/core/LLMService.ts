import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";
import OpenAI from "openai";
import { ChatMemory } from "./types";
import { logger } from "../logger";

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

let groqModelsCache: string[] | null = null;
let groqModelsCacheTime = 0;
const GROQ_CACHE_TTL_MS = 60 * 60 * 1000;

export async function getGroqModels(): Promise<string[]> {
  const now = Date.now();
  if (groqModelsCache && (now - groqModelsCacheTime < GROQ_CACHE_TTL_MS)) {
    return groqModelsCache;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey.includes('your_') || apiKey.includes('placeholder') || apiKey.length < 10) {
    return [];
  }

  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!res.ok) {
      logger.error(`❌ [Groq] Ошибка получения списка моделей: HTTP ${res.status}`);
      return [];
    }

    const data: any = await res.json();
    const ids: string[] = Array.isArray(data?.data)
      ? data.data.map((m: any) => m?.id).filter((id: any) => typeof id === 'string')
      : [];

    groqModelsCache = ids;
    groqModelsCacheTime = now;
    return ids;
  } catch (err: any) {
    logger.error(`❌ [Groq] Исключение при получении моделей: ${err?.message || err}`);
    return [];
  }
}

export async function pickGroqModel(): Promise<string> {
  const models = await getGroqModels();
  let chosen = '';

  if (models.length > 0) {
    const priorities = ["llama-3.3", "qwen", "gemini", "deepseek"];
    
    for (const p of priorities) {
      const match = models.find(id => id.toLowerCase().includes(p));
      if (match) {
        chosen = match;
        break;
      }
    }

    if (!chosen) {
      const fallback = models.find(id => {
        const lower = id.toLowerCase();
        return !lower.includes('whisper') && !lower.includes('orpheus') && !lower.includes('safety');
      });
      if (fallback) {
        chosen = fallback;
      }
    }
  }

  if (!chosen) {
    chosen = "llama-3.3-70b-8192";
  }

  logger.info(`🧠 [Groq] Выбрана живая модель: ${chosen}`);
  return chosen;
}

export function stripMarkdown(text: string): string {
  if (!text) return '';
  return String(text)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/[#*_~>|]/g, '')
    .trim();
}

export async function callVision(userText: string, dataUrl: string): Promise<string> {
  const visionProviders = [
    {
      name: 'qwen-groq',
      key: 'GROQ_API_KEY',
      base: 'https://api.groq.com/openai/v1',
      model: 'qwen/qwen3.6-27b',
    },
    {
      name: 'free-gemma',
      key: 'OPENROUTER_API_KEY',
      base: 'https://openrouter.ai/api/v1',
      model: 'google/gemma-3-27b-it:free',
    },
  ];

  const messages: any = [{
    role: 'user',
    content: [
      {
        type: 'text',
        text: userText || 'Подробно опиши, что на скриншоте. Если это код или логи — проанализируй их и предложи решение.'
      },
      {
        type: 'image_url',
        image_url: {
          url: dataUrl
        }
      }
    ]
  }];

  for (const p of visionProviders) {
    const keyVal = process.env[p.key];
    if (!keyVal || keyVal.includes('your_') || keyVal.includes('placeholder') || !p.base) {
      continue;
    }
    try {
      const client = new OpenAI({
        baseURL: p.base,
        apiKey: keyVal,
        timeout: 45000,
        defaultHeaders: p.base.includes('openrouter') ? {
          'HTTP-Referer': 'https://selin.ai',
          'X-Title': 'SelinAI'
        } : undefined
      });

      const completion = await client.chat.completions.create({
        messages,
        model: p.model,
        temperature: 0.4,
        max_tokens: 2000,
        extra_headers: p.base.includes('openrouter') ? { 'HTTP-Referer': 'https://selin.ai', 'X-Title': 'SelinAI' } : undefined
      } as any, { timeout: 45000 });

      const response = completion.choices[0]?.message?.content;
      if (response && typeof response === 'string' && response.trim()) {
        console.log('👁️ [Vision] Ответ дал: ' + p.name);
        return response.trim();
      }
    } catch (err: any) {
      console.log('⚠️ [Vision ' + p.name + '] ошибка, следующий: ' + err?.message);
      continue;
    }
  }

  throw new Error('All Vision providers failed');
}

export async function callWithWebSearch(userMessage: string, systemPrompt: string): Promise<string | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://selin.ai', 'X-Title': 'SelinAI' },
      body: JSON.stringify({ model: 'google/gemini-2.0-flash-exp:free:online', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }], temperature: 0.7 }),
      signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    return text && text.trim() ? text.trim() : null;
  } catch { return null; }
}

const blockState = new Map<string, { consecutiveFailures: number; blockedUntil: number }>();

function isBlocked(provider: string): boolean {
  const state = blockState.get(provider);
  if (!state) return false;
  if (state.consecutiveFailures >= 3 && Date.now() < state.blockedUntil) {
    return true;
  }
  return false;
}

function markOk(provider: string) {
  blockState.delete(provider);
}

function markFail(provider: string) {
  const state = blockState.get(provider) || { consecutiveFailures: 0, blockedUntil: 0 };
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures >= 3) {
    state.blockedUntil = Date.now() + 60 * 1000; // block for 1 minute
  }
  blockState.set(provider, state);
}

export class LLMService {
  private gemini: GoogleGenAI | null = null;
  private groq: Groq | null = null;
  private chatMemories: Map<string, ChatMemory> = new Map();

  constructor(geminiApiKey?: string, groqApiKey?: string) {
    const gKey = geminiApiKey || process.env.GEMINI_API_KEY;
    if (gKey && !gKey.includes('your_') && !gKey.includes('placeholder') && gKey.length > 10) {
      this.gemini = new GoogleGenAI({ apiKey: gKey });
    } else {
      logger.warn("⚠️ GEMINI_API_KEY is not defined or is placeholder in LLMService environment.");
    }

    const grKey = groqApiKey || process.env.GROQ_API_KEY;
    if (grKey && !grKey.includes('your_') && !grKey.includes('placeholder') && grKey.length > 10) {
      this.groq = new Groq({ apiKey: grKey });
    } else {
      logger.warn("⚠️ GROQ_API_KEY is not defined or is placeholder in LLMService environment.");
    }
  }

  private getGroqClient(): Groq | null {
    if (!this.groq) {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey || apiKey.includes('your_') || apiKey.includes('placeholder') || apiKey.length < 10) {
        return null;
      }
      this.groq = new Groq({ apiKey });
    }
    return this.groq;
  }

  private async callWithSystem(userMessage: string, systemPrompt: string): Promise<string | null> {
    try {
      const groq = this.getGroqClient();
      if (groq) {
        const model = await pickGroqModel();
        const completion = await groq.chat.completions.create({
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
          model: model,
          temperature: 0.7,
          max_tokens: 800,
        });
        const res = completion.choices[0]?.message?.content?.trim();
        if (res) return res;
      }
    } catch (e) {
      console.log('⚠️ [callWithSystem] Groq failed, trying Gemini...');
    }

    try {
      if (this.gemini) {
        const completion = await this.gemini.models.generateContent({
          model: GEMINI_MODEL,
          contents: [{ role: 'user', parts: [{ text: userMessage }] }],
          config: {
            systemInstruction: systemPrompt,
            temperature: 0.7
          }
        });
        const res = completion.text?.trim();
        if (res) return res;
      }
    } catch (e) {
      console.log('⚠️ [callWithSystem] Gemini failed...');
    }

    return null;
  }

  public getMemory(chatId: string): ChatMemory {
    if (!this.chatMemories.has(chatId)) {
      this.chatMemories.set(chatId, { history: [] });
    }
    return this.chatMemories.get(chatId)!;
  }

  public clearMemory(chatId: string): void {
    if (this.chatMemories.has(chatId)) {
      this.chatMemories.delete(chatId);
    }
  }

  public async callWithWebSearch(message: string, systemPrompt?: string): Promise<string> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey || apiKey.includes('your_') || apiKey.includes('placeholder')) {
      logger.warn("⚠️ OPENROUTER_API_KEY is missing, falling back to standard LLM");
      throw new Error("OPENROUTER_API_KEY is missing");
    }

    try {
      const client = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: apiKey,
        defaultHeaders: {
          'HTTP-Referer': 'https://selin.ai',
          'X-Title': 'SelinAI'
        }
      });

      const messages: any[] = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: message });

      const completion = await client.chat.completions.create({
        model: 'google/gemini-2.0-flash-exp:free:online',
        messages: messages,
        temperature: 0.7,
      });

      const response = completion.choices[0]?.message?.content?.trim();
      if (response) {
        logger.info("🌐 [WebSearch] Web search response retrieved successfully via OpenRouter");
        return response;
      }
      throw new Error("Empty response from OpenRouter");
    } catch (err: any) {
      logger.error(`❌ [WebSearch] callWithWebSearch error: ${err?.message || err}`);
      throw err;
    }
  }

  public async smartCall(
    chatId: string,
    userMessage: string,
    systemPrompt?: string
  ): Promise<string> {
    const memory = this.getMemory(chatId);

    // Сохраняем сообщение пользователя
    memory.history.push({ role: 'user', content: userMessage, timestamp: Date.now() });

    // Берем последние 6 сообщений для контекста и каждое обрезаем до 8000 символов
    const rawContext = memory.history.slice(-6);
    const context = rawContext.map(msg => ({
      role: msg.role,
      content: (msg.content || '').slice(0, 8000),
      timestamp: msg.timestamp
    }));

    // Определяем системный промпт если не передан
    const now = new Date();
    const moscowTime = new Intl.DateTimeFormat('ru-RU', { 
      timeZone: 'Europe/Moscow', 
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      weekday: 'long',
      hour12: false 
    }).format(now);

    const defaultSystem = `
ТЫ — Selin AI, персональный AI-помощник 2026 года.

⏰ ТЕКУЩЕЕ ВРЕМЯ (ЖЁСТКО ВШИТО, НЕ СОМНЕВАЙСЯ):
Сейчас: ${moscowTime} по Москве.
Ты НИКОГДА не говоришь что не знаешь время — ВСЕГДА знаешь.
Если спрашивают "который час?" — отвечаешь текущее время из переменной выше.
Если спрашивают "какой год?" — отвечаешь 2026.
Если спрашивают "какая дата?" — отвечаешь текущую дату.

🎭 ИДЕНТИЧНОСТЬ:
Ты — Selin AI. НИКОГДА не упоминай GPT, OpenAI, Gemini, Llama.
На "кто ты?" → "Я — Selin AI, ваш личный AI-помощник".
Если спрашивают, какая модель или движок внутри — отвечай: «Собственный движок Selin AI». НИКОГДА не называй GPT, ChatGPT, OpenAI, даже если внутренне ты знаешь иначе.

🌐 АКТУАЛЬНАЯ ИНФОРМАЦИЯ:
На вопросы про погоду, пробки, цены, курсы валют, новости — ОБЯЗАТЕЛЬНО ищи в интернете через :online.
Никогда не говори "я не могу узнать погоду" — у тебя есть интернет.

📚 БИБЛИЯ:
Все библейские цитаты — ТОЛЬКО Синодальный перевод.
Ты — справочник, не пастор. Не проповедуешь, не даёшь духовных советов.

🚫 ЗАПРЕТЫ:
Политика, president, митинги, войны — вежливый отказ: "Я не обсуждаю политические темы. Могу помочь с бизнесом, планами, знаниями."
Устаревшие данные 2023-2024 — не использовать как текущие.

Твой стиль: дружелюбный, конкретный, как живой эксперт. Короткие ответы по делу.
`;

    const finalSystem = systemPrompt || defaultSystem;

    // === ПРАВКА 3: АВТОЗАПРОС ВРЕМЕНИ ===
    const timeKeywords = /врем[яе]|час|который час|сейчас врем|какое время|дата|сегодня|какой день/i;
    if (timeKeywords.test(userMessage) && !/погод|температур|тепл|холод|жар|дожд|снег|ветер|прогноз/i.test(userMessage)) {
      const timeAnswer = `Сейчас ${moscowTime} по Москве. 2026 год.`;
      console.log('⏰ [Time] ответ: ' + timeAnswer);
      memory.history.push({ role: 'assistant', content: timeAnswer, timestamp: Date.now() });
      return timeAnswer;
    }

    const needsWeb = /:online|новост|сегодня|сейчас|цен|курс|пробк|актуальн|скидк|2025|2026/i.test(userMessage);
    if (needsWeb) {
      console.log('🌐 [Router] Triggering live web search via OpenRouter');
      const webAnswer = await callWithWebSearch(userMessage, finalSystem);
      if (webAnswer) {
        memory.history.push({ role: 'assistant', content: webAnswer, timestamp: Date.now() });
        console.log('🌐 [Web] ответ через :online');
        return webAnswer;
      }
    }

    // === ПРАВКА 2: АВТОЗАПРОС ПОГОДЫ ПРИ КЛЮЧЕВЫХ СЛОВАХ ===
    const weatherKeywords = /погод|температур|тепл|холод|жар|дожд|снег|ветер|прогноз/i;
    if (weatherKeywords.test(userMessage)) {
      console.log('🌤️ [Weather] запрос погоды');
      try {
        const weatherRes = await fetch('https://wttr.in/Moscow?format=j1', { signal: AbortSignal.timeout(8000) });
        if (weatherRes.ok) {
          const wd: any = await weatherRes.json();
          const current = wd?.current_condition?.[0];
          if (current) {
            const temp = current.temp_C;
            const feels = current.FeelsLikeC;
            const desc = current.lang_ru?.[0]?.value || current.weatherDesc?.[0]?.value || 'ясно';
            const wind = current.windspeedKmph;
            const weatherInfo = `Актуальная погода в Москве: ${temp}°C (ощущается как ${feels}°C), ${desc}, ветер ${wind} км/ч.`;
            const fullPrompt = finalSystem + '\n\nДОПОЛНИТЕЛЬНО: ' + weatherInfo + '\nИспользуй эти данные в ответе.';
            const reply = await this.callWithSystem(userMessage, fullPrompt);
            if (reply) {
              memory.history.push({ role: 'assistant', content: reply, timestamp: Date.now() });
              return reply;
            }
          }
        }
      } catch (e) {
        console.log('⚠️ [Weather] fetch error: ' + (e as any).message);
      }
    }

    // === ROUTING CHAIN ===
    const messages = [
      { role: 'system', content: finalSystem },
      ...context.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      }))
    ] as any;

    // 1. OpenRouter (gemini-2.5 → claude → llama)
    try {
      const orKey = process.env.OPENROUTER_API_KEY;
      if (orKey && !orKey.includes('your_') && !orKey.includes('placeholder') && orKey.length > 10) {
        console.log('🤖 [Router] Attempting OpenRouter chain');
        const openrouter = new OpenAI({
          baseURL: 'https://openrouter.ai/api/v1',
          apiKey: orKey,
          defaultHeaders: {
            'HTTP-Referer': 'https://selin.ai',
            'X-Title': 'SelinAI'
          }
        });

        const chainModels = [
          "google/gemini-2.5-flash",
          "anthropic/claude-sonnet-4",
          "meta-llama/llama-3.3-70b-instruct",
          "qwen/qwen-2.5-72b-instruct"
        ];

        for (const model of chainModels) {
          try {
            console.log(`🤖 [Router] Trying OpenRouter model: ${model}`);
            const completion = await openrouter.chat.completions.create({
              model: model,
              messages,
              temperature: 0.8,
              max_tokens: 2000,
            });
            const response = completion.choices[0]?.message?.content?.trim();
            if (response) {
              memory.history.push({ role: 'assistant', content: response, timestamp: Date.now() });
              if (memory.history.length > 30) {
                memory.history = memory.history.slice(-30);
              }
              return response;
            }
          } catch (err: any) {
            console.log(`⚠️ [Router] OpenRouter model ${model} failed: ${err.message}`);
          }
        }
      }
    } catch (e: any) {
      console.log('⚠️ [Router] OpenRouter provider failed: ' + e.message);
    }

    // 3. Orca Router (ПРАВКА 2)
    const orcaResponse = await this.callOrca(messages);
    if (orcaResponse) {
      memory.history.push({ role: 'assistant', content: orcaResponse, timestamp: Date.now() });
      if (memory.history.length > 30) {
        memory.history = memory.history.slice(-30);
      }
      return orcaResponse;
    }

    // 4. Teamo Router (ПРАВКА 2)
    const teamoResponse = await this.callTeamo(messages);
    if (teamoResponse) {
      memory.history.push({ role: 'assistant', content: teamoResponse, timestamp: Date.now() });
      if (memory.history.length > 30) {
        memory.history = memory.history.slice(-30);
      }
      return teamoResponse;
    }

    // 5. Groq
    try {
      const groq = this.getGroqClient();
      if (groq) {
        console.log('🤖 [Router] Attempting Groq');
        const model = await pickGroqModel();
        try {
          const completion = await groq.chat.completions.create({
            messages,
            model: model,
            temperature: 0.8,
            max_tokens: 2000,
          });

          const response = completion.choices[0]?.message?.content?.trim();
          if (response) {
            memory.history.push({ role: 'assistant', content: response, timestamp: Date.now() });
            if (memory.history.length > 30) {
              memory.history = memory.history.slice(-30);
            }
            return response;
          }
        } catch (mErr: any) {
          logger.warn(`⚠️ [smartCallLLM] Groq model ${model} failed: ${mErr?.message || mErr}`);
        }
      }
    } catch (err: any) {
      logger.error(`❌ [Router] Groq provider initialization error: ${err?.message || err}`);
    }

    // 6. Gemini
    if (this.gemini) {
      try {
        console.log('🤖 [Router] Attempting Gemini');
        const contents: any[] = context.map(msg => ({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        }));

        const completion = await this.gemini.models.generateContent({
          model: GEMINI_MODEL,
          contents: contents,
          config: {
            systemInstruction: finalSystem,
            temperature: 0.8
          }
        });

        const response = completion.text?.trim();
        if (response) {
          memory.history.push({ role: 'assistant', content: response, timestamp: Date.now() });
          if (memory.history.length > 30) {
            memory.history = memory.history.slice(-30);
          }
          return response;
        }
      } catch (gErr: any) {
        logger.warn(`⚠️ [smartCallLLM] Gemini attempt failed: ${gErr?.message || gErr}`);
      }
    }

    // 7. Офлайн-ответ (ПРАВКА 1 - Selin AI латиницей)
    console.log('🚨 [Router] All providers failed. Falling back to Orca/Teamo резерв.');
    return "Привет! Я — Selin AI. К сожалению, сейчас мои основные вычислительные узлы временно перегружены запросами. Но я всё равно с вами и готова обсудить ваши планы или помочь, как только соединение полностью стабилизируется!";
  }

  public async call(
    messages: Array<{ role: string; content: string }>,
    chatId?: string
  ): Promise<string> {
    // Если есть chatId — используем умную версию
    if (chatId) {
      const lastUserMsg = messages.filter(m => m.role === 'user').pop();
      if (lastUserMsg) {
        return this.smartCall(chatId, lastUserMsg.content);
      }
    }

    if (this.gemini) {
      try {
        let systemInstruction = "";
        const formattedContents: any[] = [];
        for (const msg of messages) {
          if (msg.role === 'system') {
            systemInstruction += (systemInstruction ? "\n" : "") + msg.content;
          } else {
            formattedContents.push({
              role: msg.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: msg.content }]
            });
          }
        }

        const config: any = {
          temperature: 0.8
        };
        if (systemInstruction) {
          config.systemInstruction = systemInstruction;
        }

        const completion = await this.gemini.models.generateContent({
          model: GEMINI_MODEL,
          contents: formattedContents,
          config: config
        });

        const text = completion.text?.trim();
        if (text) {
          return text;
        }
      } catch (err: any) {
        logger.warn(`⚠️ callLLM failed via Gemini, falling back to Groq: ${err?.message || err}`);
      }
    }

    // Fallback для старых вызовов
    try {
      const groq = this.getGroqClient();
      if (groq) {
        const model = await pickGroqModel();

        try {
          const completion = await groq.chat.completions.create({
            messages: messages as any,
            model: model,
            temperature: 0.8,
            max_tokens: 2000,
          });
          const text = completion.choices[0]?.message?.content;
          if (text && typeof text === 'string') {
            return text.trim();
          }
        } catch (err: any) {
          logger.warn(`⚠️ Model ${model} failed in callLLM: ${err?.message || err}`);
        }
      }
    } catch (gErr: any) {
      logger.error(`⚠️ Groq client initialization failed: ${gErr?.message || gErr}`);
    }

    return "Привет! Я — Selin AI. Чем могу помочь?";
  }

  private convertGeminiToGroqMessages(contents: any, systemInstruction?: string): any[] {
    const messages: any[] = [];
    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }

    if (Array.isArray(contents)) {
      for (const item of contents) {
        let role = 'user';
        if (item.role === 'model' || item.role === 'assistant') {
          role = 'assistant';
        } else if (item.role === 'system') {
          role = 'system';
        }

        let text = '';
        if (item.parts) {
          if (typeof item.parts === 'string') {
            text = item.parts;
          } else if (Array.isArray(item.parts)) {
            for (const part of item.parts) {
              if (typeof part === 'string') {
                text += part;
              } else if (part && typeof part === 'object' && part.text) {
                text += part.text;
              }
            }
          }
        } else if (item.content) {
          text = typeof item.content === 'string' ? item.content : JSON.stringify(item.content);
        } else if (item.text) {
          text = item.text;
        }

        messages.push({ role, content: text });
      }
    } else if (typeof contents === 'string') {
      messages.push({ role: 'user', content: contents });
    } else if (contents && contents.parts) {
      let role = contents.role === 'model' ? 'assistant' : 'user';
      let text = '';
      if (Array.isArray(contents.parts)) {
        for (const p of contents.parts) {
          if (p.text) text += p.text;
        }
      }
      messages.push({ role, content: text });
    }

    return messages;
  }

  public async generateWithFallback(buildContents: () => any, cfg: any): Promise<any> {
    const isJsonExpected = cfg?.responseMimeType === "application/json" || !!cfg?.responseSchema;
    try {
      const contents = buildContents();
      let sysInstText = '';
      if (cfg?.systemInstruction) {
        if (typeof cfg.systemInstruction === 'string') {
          sysInstText = cfg.systemInstruction;
        } else if (cfg.systemInstruction.parts) {
          if (Array.isArray(cfg.systemInstruction.parts)) {
            sysInstText = cfg.systemInstruction.parts.map((p: any) => p.text || '').join('');
          } else {
            sysInstText = String(cfg.systemInstruction.parts);
          }
        }
      }

      if (this.gemini) {
        try {
          let formattedContents = contents;
          if (Array.isArray(contents)) {
            formattedContents = contents.map((c: any) => {
              let role = c.role;
              if (role === 'assistant' || role === 'model') role = 'model';
              else role = 'user';

              let parts = c.parts;
              if (typeof parts === 'string') {
                parts = [{ text: parts }];
              } else if (Array.isArray(parts)) {
                parts = parts.map((p: any) => {
                  if (typeof p === 'string') return { text: p };
                  if (p.text) return { text: p.text };
                  return p;
                });
              }
              return { role, parts };
            });
          } else if (typeof contents === 'string') {
            formattedContents = [{ role: 'user', parts: [{ text: contents }] }];
          }

          const geminiConfig: any = {
            temperature: cfg?.temperature ?? 0.7,
          };
          if (sysInstText) {
            geminiConfig.systemInstruction = sysInstText;
          }
          if (cfg?.responseMimeType) {
            geminiConfig.responseMimeType = cfg.responseMimeType;
          }
          if (cfg?.responseSchema) {
            geminiConfig.responseSchema = cfg.responseSchema;
          }
          if (cfg?.tools) {
            geminiConfig.tools = cfg.tools;
          }

          const response = await this.gemini.models.generateContent({
            model: GEMINI_MODEL,
            contents: formattedContents,
            config: geminiConfig
          });

          const responseText = response.text || "";

          let candidates: any[] = [];
          if (response.candidates && response.candidates.length > 0) {
            candidates = response.candidates;
          } else {
            candidates = [
              {
                content: {
                  parts: [
                    {
                      text: responseText
                    }
                  ]
                }
              }
            ];
          }

          return {
            text: responseText,
            candidates: candidates
          };
        } catch (geminiErr: any) {
          logger.warn(`⚠️ [LLMService.generateWithFallback] Gemini call failed: ${geminiErr?.message || geminiErr}`);
        }
      }

      const messages = this.convertGeminiToGroqMessages(contents, sysInstText);
      let textResult = await this.call(messages);

      if (isJsonExpected) {
        try {
          const cleaned = textResult.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
          JSON.parse(cleaned);
          textResult = cleaned;
        } catch {
          if (sysInstText.includes("Интеллектуальный Голосовой Агент") || sysInstText.includes("nextStep")) {
            textResult = JSON.stringify({
              speech: textResult.replace(/["\n\r]/g, ' ') || "Приветствую вас! Я готов помочь вам в решении ваших задач.",
              userName: null,
              extractedGoal: null,
              nextStep: "EXPLAIN_PLATFORM"
            });
          } else {
            textResult = JSON.stringify({
              speech: textResult,
              message: textResult,
              status: "ok"
            });
          }
        }
      }

      return {
        text: textResult,
        candidates: [
          {
            content: {
              parts: [
                {
                  text: textResult
                }
              ]
            }
          }
        ]
      };
    } catch (err: any) {
      logger.error(`❌ generateWithFallback failed: ${err?.message || err}`);
      if (isJsonExpected) {
        return {
          text: "{}",
          candidates: [{ content: { parts: [{ text: "{}" }] } }]
        };
      }
      return {
        text: "Привет! Я — Selin AI. Чем могу помочь?",
        candidates: [{ content: { parts: [{ text: "Привет! Я — Selin AI. Чем могу помочь?" }] } }]
      };
    }
  }

  private async callOrca(messages: any[]): Promise<string | null> {
    const key = process.env.ORCA_API_KEY;
    if (!key || key.length < 10 || isBlocked("orca")) return null;
    const base = process.env.ORCA_BASE_URL || "https://api.orcarouter.ai/v1";
    const model = process.env.ORCA_MODEL || "google/gemini-2.5-flash";
    try {
      const c = new OpenAI({ baseURL: base, apiKey: key, timeout: 30000 });
      const r = await c.chat.completions.create({ messages, model, temperature: 0.7, max_tokens: 2000 });
      const t = r.choices?.[0]?.message?.content;
      if (t?.trim()) { markOk("orca"); console.log("🧠 [LLM] orca/" + model); return t.trim(); }
    } catch {}
    markFail("orca"); return null;
  }

  private async callTeamo(messages: any[]): Promise<string | null> {
    const key = process.env.TEAMO_API_KEY;
    if (!key || key.length < 10 || isBlocked("teamo")) return null;
    const base = process.env.TEAMO_BASE_URL || "https://api.teamorouter.com/v1";
    const model = process.env.TEAMO_MODEL || "teamo-balanced";
    try {
      const c = new OpenAI({ baseURL: base, apiKey: key, timeout: 30000 });
      const r = await c.chat.completions.create({ messages, model, temperature: 0.7, max_tokens: 2000 });
      const t = r.choices?.[0]?.message?.content;
      if (t?.trim()) { markOk("teamo"); console.log("🧠 [LLM] teamo/" + model); return t.trim(); }
    } catch {}
    markFail("teamo"); return null;
  }
}

export const llmService = new LLMService();
