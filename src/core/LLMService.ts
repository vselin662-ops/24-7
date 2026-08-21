import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";
import { ChatMemory } from "./types";
import { logger } from "../logger";

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

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

  public async smartCall(
    chatId: string,
    userMessage: string,
    systemPrompt?: string
  ): Promise<string> {
    const memory = this.getMemory(chatId);

    // Сохраняем сообщение пользователя
    memory.history.push({ role: 'user', content: userMessage, timestamp: Date.now() });

    // Берем последние 10 сообщений для контекста
    const context = memory.history.slice(-10);

    // Определяем системный промпт если не передан
    const defaultSystem = `Ты — Selin AI, интеллектуальный ассистент.

ТВОИ ХАРАКТЕРИСТИКИ:
- Ты живой, умный, ироничный и глубокий собеседник
- Отвечаешь развернуто, с примерами и юмором
- Помнишь контекст диалога
- Даешь практичные советы
- Используешь метафоры и аналогии

ПРАВИЛА:
1. Никогда не повторяйся
2. Отвечай как эксперт в своей области
3. Задавай уточняющие вопросы
4. Приводи примеры из жизни
5. Если не знаешь — честно скажи

СЕЙЧАС ТЕБЯ СПРАШИВАЮТ: "${userMessage}"`;

    const finalSystem = systemPrompt || defaultSystem;

    // 1. Попытка через Gemini для максимального интеллекта
    if (this.gemini) {
      try {
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
        logger.warn(`⚠️ [smartCallLLM] Gemini attempt failed, falling back to Groq: ${gErr?.message || gErr}`);
      }
    }

    // 2. Попытка через Groq с перебором живых моделей
    try {
      const groq = this.getGroqClient();
      if (groq) {
        // Формируем сообщения с контекстом
        const messages = [
          { role: 'system', content: finalSystem },
          ...context.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content
          }))
        ];

        logger.info(`🧠 [Context] Chat ${chatId} has ${context.length} messages`);

        const models = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

        for (const model of models) {
          try {
            const completion = await groq.chat.completions.create({
              messages: messages as any,
              model: model,
              temperature: 0.8,
              max_tokens: 2000,
            });

            const response = completion.choices[0]?.message?.content;
            if (response && typeof response === 'string' && response.trim()) {
              const trimmed = response.trim();
              // Сохраняем ответ в память
              memory.history.push({ role: 'assistant', content: trimmed, timestamp: Date.now() });

              // Обрезаем историю до 30 сообщений
              if (memory.history.length > 30) {
                memory.history = memory.history.slice(-30);
              }

              return trimmed;
            }
          } catch (mErr: any) {
            logger.warn(`⚠️ [smartCallLLM] Groq model ${model} failed: ${mErr?.message || mErr}`);
            continue;
          }
        }
      }
    } catch (err: any) {
      logger.error(`❌ Smart LLM error: ${err?.message || err}`);
    }

    return "Ой, что-то я зависла... Давай попробуем еще раз?";
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
        const models = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

        for (const model of models) {
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
}

export const llmService = new LLMService();
