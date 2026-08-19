// src/core/LLMService.ts
import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";
import { ChatMemory } from "./types";
import { logger } from "../logger";

export interface LLMConfig {
  geminiApiKey?: string;
  groqApiKey?: string;
  defaultModel?: string;
  temperature?: number;
}

export class LLMService {
  private gemini: GoogleGenAI | null = null;
  private groq: Groq | null = null;
  private chatMemories: Map<string, ChatMemory> = new Map();

  constructor(configOrGeminiKey?: LLMConfig | string, groqApiKey?: string) {
    let gKey: string | undefined;
    let grKey: string | undefined;

    if (typeof configOrGeminiKey === 'object' && configOrGeminiKey !== null) {
      gKey = configOrGeminiKey.geminiApiKey || process.env.GEMINI_API_KEY;
      grKey = configOrGeminiKey.groqApiKey || process.env.GROQ_API_KEY;
    } else {
      gKey = (typeof configOrGeminiKey === 'string' ? configOrGeminiKey : undefined) || process.env.GEMINI_API_KEY;
      grKey = groqApiKey || process.env.GROQ_API_KEY;
    }

    // Gemini
    if (gKey) {
      try {
        this.gemini = new GoogleGenAI({
          apiKey: gKey,
          httpOptions: { headers: { 'User-Agent': 'selin-ai' } }
        });
        logger.info("✅ Gemini client initialized");
      } catch (e) {
        logger.warn("⚠️ Gemini init failed");
      }
    }

    // Groq
    if (grKey) {
      try {
        this.groq = new Groq({ apiKey: grKey });
        logger.info("✅ Groq client initialized");
      } catch (e) {
        logger.warn("⚠️ Groq init failed");
      }
    }
  }

  public getMemory(chatId: string): ChatMemory {
    if (!this.chatMemories.has(chatId)) {
      this.chatMemories.set(chatId, { history: [] });
    }
    return this.chatMemories.get(chatId)!;
  }

  public clearMemory(chatId: string): void {
    this.chatMemories.delete(chatId);
  }

  // ==========================================
  // ОСНОВНОЙ МЕТОД — каскад из моделей
  // ==========================================
  public async smartCall(
    chatId: string,
    userMessage: string,
    systemPrompt?: string
  ): Promise<string> {
    const memory = this.getMemory(chatId);
    memory.history.push({ role: 'user', content: userMessage, timestamp: Date.now() });

    const context = memory.history.slice(-10);

    const defaultSystem = `Ты — Selin AI, интеллектуальный ассистент.
Отвечай как живой, умный и увлеченный собеседник.
Будь конкретным, полезным и креативным.
Никогда не повторяйся.
Если не знаешь — скажи честно, но предложи варианты решения.`;

    const finalSystem = systemPrompt || defaultSystem;

    // ---------- 1. ПОПЫТКА: Gemini 2.5 Flash ----------
    if (this.gemini) {
      try {
        const contents = context.map(msg => ({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        }));

        const result = await this.gemini.models.generateContent({
          model: "gemini-2.5-flash",
          contents: contents,
          config: {
            systemInstruction: finalSystem,
            temperature: 0.8
          }
        });

        const text = result.text?.trim();
        if (text) {
          memory.history.push({ role: 'assistant', content: text, timestamp: Date.now() });
          if (memory.history.length > 30) memory.history = memory.history.slice(-30);
          logger.info(`✅ [Gemini 2.5 Flash] Response for ${chatId}`);
          return text;
        }
      } catch (e: any) {
        logger.warn(`⚠️ Gemini 2.5 Flash failed: ${e?.message || e}`);
      }
    }

    // ---------- 2. ПОПЫТКА: Gemini 2.0 Flash ----------
    if (this.gemini) {
      try {
        const contents = context.map(msg => ({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        }));

        const result = await this.gemini.models.generateContent({
          model: "gemini-2.0-flash",
          contents: contents,
          config: {
            systemInstruction: finalSystem,
            temperature: 0.8
          }
        });

        const text = result.text?.trim();
        if (text) {
          memory.history.push({ role: 'assistant', content: text, timestamp: Date.now() });
          if (memory.history.length > 30) memory.history = memory.history.slice(-30);
          logger.info(`✅ [Gemini 2.0 Flash] Response for ${chatId}`);
          return text;
        }
      } catch (e: any) {
        logger.warn(`⚠️ Gemini 2.0 Flash failed: ${e?.message || e}`);
      }
    }

    // ---------- 3. ПОПЫТКА: Groq Llama 3.3 70B ----------
    if (this.groq) {
      try {
        const messages = [
          { role: 'system', content: finalSystem },
          ...context.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content
          }))
        ];

        const result = await this.groq.chat.completions.create({
          messages: messages as any,
          model: "llama-3.3-70b-versatile",
          temperature: 0.8,
          max_tokens: 2000
        });

        const text = result.choices[0]?.message?.content;
        if (text) {
          memory.history.push({ role: 'assistant', content: text, timestamp: Date.now() });
          if (memory.history.length > 30) memory.history = memory.history.slice(-30);
          logger.info(`✅ [Groq Llama 3.3 70B] Response for ${chatId}`);
          return text;
        }
      } catch (e: any) {
        logger.warn(`⚠️ Groq Llama 3.3 70B failed: ${e?.message || e}`);
      }
    }

    // ---------- 4. ПОПЫТКА: Groq Llama 3.1 8B ----------
    if (this.groq) {
      try {
        const messages = [
          { role: 'system', content: finalSystem },
          ...context.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content
          }))
        ];

        const result = await this.groq.chat.completions.create({
          messages: messages as any,
          model: "llama-3.1-8b-instant",
          temperature: 0.8,
          max_tokens: 1500
        });

        const text = result.choices[0]?.message?.content;
        if (text) {
          memory.history.push({ role: 'assistant', content: text, timestamp: Date.now() });
          if (memory.history.length > 30) memory.history = memory.history.slice(-30);
          logger.info(`✅ [Groq Llama 3.1 8B] Response for ${chatId}`);
          return text;
        }
      } catch (e: any) {
        logger.warn(`⚠️ Groq Llama 3.1 8B failed: ${e?.message || e}`);
      }
    }

    // ---------- 5. ПОПЫТКА: Groq Gemma 2 9B ----------
    if (this.groq) {
      try {
        const messages = [
          { role: 'system', content: finalSystem },
          ...context.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content
          }))
        ];

        const result = await this.groq.chat.completions.create({
          messages: messages as any,
          model: "gemma2-9b-it",
          temperature: 0.7,
          max_tokens: 1000
        });

        const text = result.choices[0]?.message?.content;
        if (text) {
          memory.history.push({ role: 'assistant', content: text, timestamp: Date.now() });
          if (memory.history.length > 30) memory.history = memory.history.slice(-30);
          logger.info(`✅ [Groq Gemma 2 9B] Response for ${chatId}`);
          return text;
        }
      } catch (e: any) {
        logger.warn(`⚠️ Groq Gemma 2 9B failed: ${e?.message || e}`);
      }
    }

    // ---------- 6. ПОСЛЕДНИЙ ШАНС: Упрощённый Gemini ----------
    if (this.gemini) {
      try {
        const result = await this.gemini.models.generateContent({
          model: "gemini-2.0-flash",
          contents: userMessage,
          config: {
            systemInstruction: finalSystem,
            temperature: 0.9
          }
        });

        const text = result.text?.trim();
        if (text) {
          memory.history.push({ role: 'assistant', content: text, timestamp: Date.now() });
          if (memory.history.length > 30) memory.history = memory.history.slice(-30);
          logger.info(`✅ [Gemini 2.0 Flash (simplified)] Response for ${chatId}`);
          return text;
        }
      } catch (e: any) {
        logger.warn(`⚠️ Simplified Gemini failed: ${e?.message || e}`);
      }
    }

    // ---------- 7. ВСЁ ПРОВАЛИЛОСЬ ----------
    logger.error(`❌ ALL LLM MODELS FAILED for ${chatId}`);
    return "Привет! Я — Selin AI. Похоже, все мои «мозги» перегружены. Попробуй через минуту, я перезагружаюсь!";
  }

  // ==========================================
  // СТАРЫЙ call() — для совместимости
  // ==========================================
  public async call(
    messages: Array<{ role: string; content: string }>,
    chatId?: string
  ): Promise<string> {
    if (chatId) {
      const lastUserMsg = messages.filter(m => m.role === 'user').pop();
      if (lastUserMsg) {
        return this.smartCall(chatId, lastUserMsg.content);
      }
    }

    // Fallback — просто спросить напрямую
    const lastMsg = messages.filter(m => m.role === 'user').pop();
    if (lastMsg) {
      return this.smartCall(chatId || 'default', lastMsg.content);
    }

    return "Привет! Я — Selin AI. Чем могу помочь?";
  }

  // ==========================================
  // generateWithFallback — для совместимости
  // ==========================================
  public async generateWithFallback(
    buildContents: () => any,
    cfg: any
  ): Promise<any> {
    try {
      const contents = buildContents();
      let systemInstruction = cfg?.systemInstruction || '';

      // Извлекаем текст запроса
      let query = '';
      if (Array.isArray(contents)) {
        for (const c of contents) {
          if (c.role === 'user' && c.parts) {
            if (Array.isArray(c.parts)) {
              for (const p of c.parts) {
                if (p.text) query += p.text;
              }
            } else if (typeof c.parts === 'string') {
              query += c.parts;
            }
          }
        }
      } else if (typeof contents === 'string') {
        query = contents;
      }

      if (!query) {
        return { text: 'Запрос пуст.', candidates: [{ content: { parts: [{ text: 'Запрос пуст.' }] } }] };
      }

      const response = await this.smartCall('fallback', query, systemInstruction);
      return {
        text: response,
        candidates: [{ content: { parts: [{ text: response }] } }]
      };
    } catch (e: any) {
      logger.error(`generateWithFallback error: ${e?.message || e}`);
      return {
        text: 'Произошла ошибка при обработке запроса.',
        candidates: [{ content: { parts: [{ text: 'Произошла ошибка при обработке запроса.' }] } }]
      };
    }
  }
}

// Экспорт синглтона
export const llmService = new LLMService();
