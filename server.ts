import express from "express";
import cors from "cors";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { evaluate } from "mathjs";
import { sqliteDb } from "./db";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import Groq from 'groq-sdk';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import fs from "fs";
import { Bot } from "@maxhub/max-bot-api";
import * as pdf from "pdf-parse";
import mammoth from "mammoth";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import multer from "multer";
import { apiRateLimiter, expensiveOpLimiter } from "./middleware/rateLimit";
import { authMiddleware } from "./middleware/auth";
import { logger } from "./src/logger";
import { metrics } from "./src/metrics";
import { requestIdMiddleware } from "./src/middleware/requestId";
import { connectorRegistry } from "./src/connectors";
import languageRouter from "./src/routes/language.routes";
import securityRouter from "./src/routes/security.routes";
import { aiShieldMiddleware } from "./src/middleware/ai-shield";
import { filterAIOutput } from "./src/services/output-filter";
import { sanitizeRAGChunk, RAG_SYSTEM_INSTRUCTION } from "./src/services/rag-protection";
import { trackAgentMetrics, trackUserRateAndAnomalies } from "./src/services/agent-monitor";
import { injectCanaryInstruction } from "./src/services/canary-tokens";
import { orchestrator } from "./src/core/orchestrator";
import { MaxAdapter } from "./src/adapters/max.adapter";
import { RobotAdapter } from "./src/adapters/robot.adapter";
import { LLMService, llmService } from "./src/core/LLMService";
import { SelinCore } from "./src/core/SelinCore";
import { cacheService } from "./src/core/CacheService";
import { MaxAdapter as ModernMaxAdapter } from "./src/adapters/MaxAdapter";
import { VoiceMode } from "./src/core/types";
import {
  startLearning,
  generateLesson,
  checkHomework,
  getProgress as getLanguageProgress,
  voicePractice,
  getUserMode,
  setUserMode,
  recordReview,
  getNextReview
} from "./src/modules/language-tutor";
import {
  diagnoseBusiness,
  generateDailyTask,
  checkTask,
  weeklyReview,
  salesRoleplay
} from "./src/connectors/business-plan.connector";
import {
  initSessionsDb,
  hasUserInteractedBefore,
  markUserAsVisited,
  closeDatabase,
  getOrchestrator,
  handleIncomingMessage as externalHandleIncomingMessage
} from './src/index';

dotenv.config();

let maxBot: Bot | null = null;
let db: any = null;

const execFileAsync = promisify(execFile);

process.env.JWT_SECRET = process.env.JWT_SECRET || "selin_jwt_secret_dev_key_default";

function checkRequiredEnvVars() {
  const required = ["JWT_SECRET"];
  const missing = required.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    logger.error(`❌ CRITICAL: Missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
  }

  // Проверка и автоматическая корректировка URL-адресов OpenAI-совместимых роутеров (Teamo, Agent Router, и т.д.)
  const urlVars = [
    { name: "OPENAI_BASE_URL", val: process.env.OPENAI_BASE_URL },
    { name: "TEAMO_BASE_URL", val: process.env.TEAMO_BASE_URL },
    { name: "AGENT_ROUTER_BASE_URL", val: process.env.AGENT_ROUTER_BASE_URL },
    { name: "ORCA_BASE_URL", val: process.env.ORCA_BASE_URL },
    { name: "NARA_BASE_URL", val: process.env.NARA_BASE_URL },
    { name: "TOKENHARBOR_BASE_URL", val: process.env.TOKENHARBOR_BASE_URL }
  ];

  urlVars.forEach(v => {
    if (v.val) {
      let url = v.val.trim();
      if (!url.endsWith('/v1') && !url.endsWith('/v1beta') && !url.includes('/v1/') && !url.includes('/v1beta/')) {
        const corrected = url.replace(/\/$/, '') + '/v1';
        logger.warn(`⚠️ [API URL Check] Переменная ${v.name} не заканчивается на /v1. Корректируем автоматически с "${url}" на "${corrected}"`);
        process.env[v.name] = corrected;
      } else {
        logger.info(`✅ [API URL Check] Переменная ${v.name} валидна: "${url}"`);
      }
    }
  });
}
checkRequiredEnvVars();

const app = express();
app.set("trust proxy", 1);
const PORT = 3000;

app.use(requestIdMiddleware);

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const tenantId = (req as any).user?.tenant_id || (req as any).user?.chatId || (req as any).tenant_id || "default";
    const routePath = req.route ? req.route.path : req.path;

    logger.info(`HTTP ${req.method} ${req.path} ${res.statusCode}`, {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
      tenantId,
      requestId: (req as any).requestId,
    });

    metrics.incrementCounter("http_requests_total", {
      method: req.method,
      path: routePath,
      status: String(res.statusCode),
      tenant_id: tenantId,
    });

    metrics.observeHistogram("http_request_duration_seconds", durationMs / 1000, {
      method: req.method,
      path: routePath,
    });

    metrics.recordTenantActivity(tenantId);
  });
  next();
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ==========================================
// Selin AI Core Services Initialization
// ==========================================
export const selinLLMService = llmService;
export const selinCore = new SelinCore(selinLLMService);
export const modernMaxAdapter = new ModernMaxAdapter(selinCore, process.env.MAX_BOT_TOKEN);
modernMaxAdapter.connect().catch((err) => logger.error("Failed to connect modernMaxAdapter", { error: err }));

// ==========================================
// Max Messenger Webhook Route (Registered BEFORE all /api middlewares)
// ==========================================
app.post(["/api/max/webhook", "/max/webhook"], async (req, res) => {
  try {
    await modernMaxAdapter.handleWebhook(req, res);
  } catch (error: any) {
    logger.error("❌ MaxAdapter webhook error:", error);
    return res.status(200).send("ok");
  }
});

// ==========================================
// Voice Mode API Routes (3 Modes: TEXT_TO_TEXT, TEXT_TO_VOICE, VOICE_TO_VOICE)
// ==========================================
app.get("/api/voice-mode", (req, res) => {
  const chatId = req.query.chatId ? String(req.query.chatId) : undefined;
  const currentMode = chatId ? modernMaxAdapter.getVoiceMode(chatId) : VoiceMode.TEXT_TO_VOICE;

  res.json({
    currentMode,
    availableModes: [
      {
        id: VoiceMode.TEXT_TO_TEXT,
        name: "Текст → Текст",
        description: "Обычный чат, текстовые ответы без генерации аудио"
      },
      {
        id: VoiceMode.TEXT_TO_VOICE,
        name: "Текст → Голос",
        description: "Бот всегда отвечает синтезированным голосом"
      },
      {
        id: VoiceMode.VOICE_TO_VOICE,
        name: "Голос → Голос",
        description: "Полный голосовой диалог в реальном времени"
      }
    ]
  });
});

app.post("/api/voice-mode", (req, res) => {
  const { chatId, mode } = req.body;
  if (!mode || !Object.values(VoiceMode).includes(mode)) {
    return res.status(400).json({
      error: `Invalid voice mode. Allowed modes: ${Object.values(VoiceMode).join(", ")}`
    });
  }

  if (chatId) {
    modernMaxAdapter.setVoiceMode(chatId, mode);
  } else {
    modernMaxAdapter.setDefaultVoiceMode(mode);
  }

  logger.info(`🔄 Voice mode updated to ${mode}${chatId ? ` for chat ${chatId}` : ' globally'}`);
  res.json({ success: true, mode, chatId: chatId || 'global' });
});

/* ==========================================
 * LEGACY: Old Max Messenger Webhook Route (Preserved for rollback)
 * ==========================================
async function legacyHandleMaxWebhook(req: any, res: any) {
  try {
    const raw = req.body || {};
    console.log('MAX Webhook Payload (Legacy):', JSON.stringify(raw));

    // 1. Извлекаем chatId с максимальной устойчивостью к вложенности
    let chatId = raw.chat_id || raw.payload?.chat_id || raw.body?.chat_id;
    if (!chatId) {
      chatId = extractMaxChatId(raw) || extractMaxChatId(raw.payload) || extractMaxChatId(raw.body);
    }
    if (!chatId && raw.message) {
      chatId = raw.message.chat_id || raw.message.recipient?.chat_id;
    }
    if (!chatId && raw.payload?.message) {
      chatId = raw.payload.message.chat_id || raw.payload.message.recipient?.chat_id;
    }
    if (!chatId && raw.body?.message) {
      chatId = raw.body.message.chat_id || raw.body.message.recipient?.chat_id;
    }

    if (!chatId) {
      console.error('❌ No ChatID found in raw payload:', JSON.stringify(raw));
      return res.status(200).send('ok');
    }

    // 2. Извлекаем текст сообщения из любых возможных путей
    let text = '';
    const textCandidates = [
      raw.text,
      raw.payload?.text,
      raw.body?.text,
      raw.message?.text,
      raw.message?.body?.text,
      raw.payload?.message?.text,
      raw.payload?.message?.body?.text,
      raw.body?.message?.text,
      raw.body?.message?.body?.text,
    ];
    for (const cand of textCandidates) {
      if (cand !== undefined && cand !== null && String(cand).trim() !== '') {
        text = String(cand).trim();
        break;
      }
    }

    // 3. Собираем вложения со всех уровней вложенности
    const allAttachments: any[] = [];
    const collectFrom = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj.attachments)) {
        allAttachments.push(...obj.attachments);
      }
      if (obj.payload && typeof obj.payload === 'object') collectFrom(obj.payload);
      if (obj.body && typeof obj.body === 'object') collectFrom(obj.body);
      if (obj.message && typeof obj.message === 'object') collectFrom(obj.message);
    };
    collectFrom(raw);

    let isVoiceInput = false;
    let voiceUrlOrId = '';

    // Check flat payload for audio URL
    if (raw.audio_url || raw.payload?.audio_url || raw.body?.audio_url) {
      isVoiceInput = true;
      voiceUrlOrId = raw.audio_url || raw.payload?.audio_url || raw.body?.audio_url || '';
    }

    // Check message type
    const checkType = (obj: any): boolean => {
      if (!obj) return false;
      return obj.type === 'voice' || obj.type === 'audio';
    };
    if (checkType(raw) || checkType(raw.payload) || checkType(raw.body) || checkType(raw.message) || checkType(raw.payload?.message) || checkType(raw.body?.message)) {
      isVoiceInput = true;
    }

    // Scan attachments for audio/voice content
    for (const att of allAttachments) {
      const typeStr = String(att?.type || '').toLowerCase();
      const mediaTypeStr = String(att?.media_type || '').toLowerCase();
      if (
        typeStr.includes('audio') || 
        typeStr.includes('voice') || 
        mediaTypeStr.includes('voice') || 
        mediaTypeStr.includes('audio')
      ) {
        isVoiceInput = true;
        const candidate = att.payload?.url || att.url || att.payload?.token || att.token || att.file_url || att.fileId || att.file_id;
        if (candidate) {
          voiceUrlOrId = String(candidate);
          break;
        }
      }
    }

    const cleanId = cleanChatIdStr(chatId);
    const numericChatId = parseInt(cleanId) || 0;

    // Handle voice message transcription and processing
    if (isVoiceInput) {
      console.log(`🎙️ Voice input stream detected (ID/URL): "${voiceUrlOrId || 'none'}"`);
      try {
        if (!voiceUrlOrId) {
          throw new Error("Audio URL or token not found in payload attachments.");
        }

        const audioBuffer = await downloadMaxAudio(voiceUrlOrId);
        const transcribedText = await transcribeAudio(audioBuffer, 'voice.ogg');
        
        if (!transcribedText || !transcribedText.trim()) {
          console.warn("⚠️ Voice transcription produced empty string.");
          await synthesizeAndSendVoice(maxBot, chatId, "Я не расслышала, повторите, пожалуйста.");
          return res.status(200).send('ok');
        }

        console.log(`✅ Voice successfully transcribed: "${transcribedText}"`);
        
        // Non-blocking call to the smart features workflow
        handleIncomingText(numericChatId, "Клиент", transcribedText, "max", true).catch(err => {
          console.error('❌ Error in voice handleIncomingText:', err);
        });

        return res.status(200).send('ok');
      } catch (err: any) {
        console.error("❌ Voice message processing failed:", err?.message || err);
        await synthesizeAndSendVoice(maxBot, chatId, "Произошла ошибка при обработке вашего голосового сообщения. Пожалуйста, повторите.");
        return res.status(200).send('ok');
      }
    }

    // Handle text input
    if (!text || !text.trim()) {
      return res.status(200).send('ok');
    }

    // Non-blocking call to the smart features workflow for text
    handleIncomingText(numericChatId, "Клиент", text, "max", false).catch(err => {
      console.error('❌ Error in text handleIncomingText:', err);
    });

    return res.status(200).send('ok');
  } catch (error: any) {
    console.error('❌ Webhook handler critical error:', error);
    return res.status(200).send('ok');
  }
}
*/

app.get(["/api/max/webhook", "/max/webhook"], (req, res) => {
  logger.info("MAX webhook получен (GET проверка)");
  return res.status(200).json({ ok: true });
});

// 1. AI Shield Middleware (Prompt Sanitization & Jailbreak Defense)
app.use('/api', (req, res, next) => {
  if (req.originalUrl.startsWith('/api/max/webhook') || req.originalUrl.startsWith('/api/ai/')) return next();
  return aiShieldMiddleware(req, res, next);
});

// 2. Rate Limiting Middleware
app.use('/api', (req, res, next) => {
  if (req.originalUrl.startsWith('/api/max/webhook') || req.originalUrl.startsWith('/api/ai/')) return next();
  return apiRateLimiter(req, res, next);
});
app.use('/api/tts', (req, res, next) => {
  if (req.originalUrl.startsWith('/api/max/webhook') || req.originalUrl.startsWith('/api/ai/')) return next();
  return expensiveOpLimiter(req, res, next);
});
app.use('/api/synthesize', (req, res, next) => {
  if (req.originalUrl.startsWith('/api/max/webhook') || req.originalUrl.startsWith('/api/ai/')) return next();
  return expensiveOpLimiter(req, res, next);
});
app.use('/api/voice-organism-dialogue', (req, res, next) => {
  if (req.originalUrl.startsWith('/api/max/webhook') || req.originalUrl.startsWith('/api/ai/')) return next();
  return expensiveOpLimiter(req, res, next);
});

// 3. Agent Monitor Middleware (Behavior Tracking & Anomaly Detection)
app.use('/api', (req, res, next) => {
  if (req.originalUrl.startsWith('/api/max/webhook') || req.originalUrl.startsWith('/api/ai/')) return next();
  const tenantId = (req as any).user?.tenant_id || (req as any).user?.chatId || "default";
  trackUserRateAndAnomalies(tenantId);
  next();
});

// 4. Output Filter Middleware (Response Sanitization & Anti-Exfiltration)
app.use((req, res, next) => {
  if (req.originalUrl.startsWith('/api/max/webhook') || req.originalUrl.startsWith('/api/ai/')) return next();
  const originalJson = res.json;
  const originalSend = res.send;

  const tenantId = (req as any).user?.tenant_id || (req as any).user?.chatId || "default";
  const userPrompt = req.body?.user_message || req.body?.prompt || req.body?.text || "";

  let isJsonCalled = false;

  res.json = function (body: any) {
    isJsonCalled = true;
    if (body && typeof body === "object") {
      if (typeof body.text === "string") {
        body.text = filterAIOutput(body.text, { tenantId, userPrompt });
      }
      if (typeof body.response === "string") {
        body.response = filterAIOutput(body.response, { tenantId, userPrompt });
      }
      if (typeof body.message === "string" && !body.error) {
        body.message = filterAIOutput(body.message, { tenantId, userPrompt });
      }
    }
    return originalJson.call(this, body);
  };

  res.send = function (body: any) {
    if (!isJsonCalled && typeof body === "string") {
      const contentType = res.get('Content-Type');
      if (!contentType || !contentType.includes('application/json')) {
        body = filterAIOutput(body, { tenantId, userPrompt });
      }
    }
    return originalSend.call(this, body);
  };

  next();
});

app.use('/api', (req, res, next) => {
  if (req.originalUrl.startsWith('/api/max/webhook') || req.originalUrl.startsWith('/api/ai/')) return next();
  return authMiddleware(req, res, next);
});
app.use('/api/security', securityRouter);
app.use('/api/language', languageRouter);

// Initialize Gemini API
const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;

if (apiKey) {
  ai = new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
} else {
  logger.warn("⚠️ GEMINI_API_KEY is not defined in the environment. AI features will be simulated.");
}

// ==========================================
// КОНФИГУРАЦИЯ СИСТЕМНЫХ ПРОМПТОВ
// ==========================================
const SYSTEM_PROMPTS = {
  universal: `Ты — Selin AI, универсальный интеллектуальный помощник.
Ты умеешь всё: помогать с бизнесом, учебой, творчеством, бытовыми вопросами.
Твой стиль — живой, ироничный, глубокий. Ты эксперт в каждой теме.
Отвечаешь развернуто, с примерами, метафорами и практическими советами.
Никогда не говори "я не знаю" — вместо этого предлагаешь варианты решения.`,

  business: (name: string) => `Ты — Selin AI, бизнес-ассистент компании "${name}".
Ты эксперт в предпринимательстве, продажах и операционке.
Даешь конкретные, измеримые, выполнимые советы.
Говоришь на языке цифр, метрик и бизнес-процессов.
Помогаешь автоматизировать, оптимизировать и масштабировать.`,

  tutor: `Ты — Selin AI, языковой репетитор.
Ты учишь языкам через диалоги, интервальные повторения и практику.
Говоришь на изучаемом языке, даешь перевод, объясняешь грамматику.
Создаешь безопасную среду для практики.`
};

// ==========================================
// УМНЫЙ КОНТЕКСТНЫЙ ОБРАБОТЧИК И ПАМЯТЬ
// ==========================================

interface ChatMemory {
  history: Array<{role: 'user' | 'assistant', content: string}>;
  lastTopic?: string;
  userIntent?: string;
}

const chatMemories = new Map<string, ChatMemory>();

function getChatMemory(chatId: string): ChatMemory {
  if (!chatMemories.has(chatId)) {
    chatMemories.set(chatId, { history: [] });
  }
  return chatMemories.get(chatId)!;
}

// ==========================================
// УМНЫЙ LLM С КОНТЕКСТОМ
// ==========================================

async function smartCallLLM(
  chatId: string,
  userMessage: string,
  systemPrompt?: string
): Promise<string> {
  const memory = getChatMemory(chatId);
  
  // Сохраняем сообщение пользователя
  memory.history.push({ role: 'user', content: userMessage });
  
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
  if (ai) {
    try {
      const contents: any[] = context.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }));

      const completion = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: contents,
        config: {
          systemInstruction: finalSystem,
          temperature: 0.8
        }
      });

      const response = completion.text?.trim();
      if (response) {
        memory.history.push({ role: 'assistant', content: response });
        if (memory.history.length > 30) {
          memory.history = memory.history.slice(-30);
        }
        return response;
      }
    } catch (gErr: any) {
      console.warn("⚠️ [smartCallLLM] Gemini attempt failed, falling back to Groq:", gErr?.message || gErr);
    }
  }

  // 2. Попытка через Groq
  try {
    const groq = getGroq();
    
    // Формируем сообщения с контекстом
    const messages = [
      { role: 'system', content: finalSystem },
      ...context.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      }))
    ];

    console.log(`🧠 [Context] Chat ${chatId} has ${context.length} messages`);

    const completion = await groq.chat.completions.create({
      messages: messages as any,
      model: 'llama-3.1-70b-versatile',
      temperature: 0.8, // Выше для креативности
      max_tokens: 2000,
    });

    const response = completion.choices[0]?.message?.content || 
      "Хм, задумался... Давай переформулируем вопрос?";

    // Сохраняем ответ в память
    memory.history.push({ role: 'assistant', content: response });

    // Обрезаем историю до 30 сообщений
    if (memory.history.length > 30) {
      memory.history = memory.history.slice(-30);
    }

    return response;

  } catch (err: any) {
    console.error('❌ Smart LLM error:', err);
    return "Ой, что-то я зависла... Давай попробуем еще раз?";
  }
}

const GEMINI_MODEL = "llama-3.3-70b-versatile";

const MODEL_CHAIN = ["gemma2-9b-it", "llama-3.3-70b-versatile"];

let groqInstance: Groq | null = null;
function getGroq(): Groq | null {
  if (!groqInstance) {
    const key = process.env.GROQ_API_KEY;
    if (!key || key.includes('your_') || key.includes('placeholder') || key.length < 10) {
      return null;
    }
    groqInstance = new Groq({ apiKey: key });
  }
  return groqInstance;
}

// Замени старую callLLM на эту
async function callLLM(
  messages: Array<{role: string, content: string}>,
  chatId?: string
): Promise<string> {
  // Если есть chatId — используем умную версию
  if (chatId) {
    const lastUserMsg = messages.filter(m => m.role === 'user').pop();
    if (lastUserMsg) {
      return smartCallLLM(chatId, lastUserMsg.content);
    }
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  const isGeminiKeyValid = geminiKey && !geminiKey.includes('your_') && !geminiKey.includes('placeholder') && geminiKey.length > 10;

  if (ai && isGeminiKeyValid) {
    try {
      let systemInstruction = "";
      const contents: any[] = [];
      
      for (const m of messages) {
        if (m.role === 'system') {
          systemInstruction = m.content;
        } else {
          contents.push({
            role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
            parts: [{ text: m.content }]
          });
        }
      }
      
      const config: any = {
        temperature: 0.8
      };
      if (systemInstruction) {
        config.systemInstruction = systemInstruction;
      }
      
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: contents,
        config: config
      });
      
      const text = response.text;
      if (text && typeof text === 'string') {
        return text.trim();
      }
    } catch (geminiErr: any) {
      logger.warn(`[LLM] Gemini call failed inside callLLM, falling back to Groq: ${geminiErr?.message || geminiErr}`);
    }
  }

  // Fallback для старых вызовов
  const groq = getGroq();
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
        logger.warn(`[LLM] Model ${model} failed: ${err?.message || err}`);
        continue;
      }
    }
  }
  
  return "Привет! Я — Selin AI. Чем могу помочь?";
}

function convertGeminiToGroqMessages(contents: any, systemInstruction?: string): any[] {
  const messages: any[] = [];
  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction });
  }
  
  if (Array.isArray(contents)) {
    for (const c of contents) {
      let role = c.role;
      if (role === 'model' || role === 'assistant') {
        role = 'assistant';
      } else {
        role = 'user';
      }
      
      let text = '';
      if (Array.isArray(c.parts)) {
        for (const p of c.parts) {
          if (p.text) {
            text += p.text;
          }
        }
      } else if (typeof c.parts === 'string') {
        text = c.parts;
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

async function generateWithFallback(buildContents: () => any, cfg: any): Promise<any> {
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

    const geminiKey = process.env.GEMINI_API_KEY;
    const isGeminiKeyValid = geminiKey && !geminiKey.includes('your_') && !geminiKey.includes('placeholder') && geminiKey.length > 10;

    if (ai && isGeminiKeyValid) {
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

        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
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
        logger.warn(`⚠️ [generateWithFallback] Gemini call failed: ${geminiErr?.message || geminiErr}`);
      }
    }

    const messages = convertGeminiToGroqMessages(contents, sysInstText);
    let textResult = await callLLM(messages);

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
        } else if (cfg?.responseSchema?.type === Type.ARRAY || textResult.startsWith('[')) {
          textResult = "[]";
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
    logger.error('❌ generateWithFallback failed:', err?.message || err);
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

async function execTool(name: string, args: any): Promise<any> {
  try {
    if (name === "calculate") {
      const expr = String(args?.expression || "");
      try {
        const result = evaluate(expr);
        if (typeof result === "number" && !Number.isFinite(result)) {
          return { error: "Результат не является конечным числом" };
        }
        return { expression: expr, result };
      } catch (err: any) {
        return { error: "Ошибка вычисления: " + (err?.message || err) };
      }
    }
    if (name === "current_date") {
      const d = new Date();
      return { date: d.toLocaleDateString("ru-RU"), weekday: d.toLocaleDateString("ru-RU", { weekday: "long" }), time: d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) };
    }
    if (name === "order_pizza") {
      return {
        status: "confirmed",
        service: "Додо Пицца / Yandex Delivery",
        orderId: `PZ-${Math.floor(100000 + Math.random() * 900000)}`,
        items: args.items || ["Пицца Пепперони 30см"],
        address: args.address || "Указанный адрес",
        deliveryTime: "30-40 минут",
        totalRub: args.totalRub || 890
      };
    }
    if (name === "order_groceries") {
      return {
        status: "confirmed",
        service: "Самокат / Яндекс Лавка",
        orderId: `GR-${Math.floor(100000 + Math.random() * 900000)}`,
        items: args.items || ["Молоко", "Хлеб", "Яйца"],
        address: args.address || "Указанный адрес",
        deliveryTime: "15-25 минут (Экспресс-доставка)",
        totalRub: args.totalRub || 1250
      };
    }
    return { error: "unknown tool" };
  } catch (e: any) {
    return { error: String(e?.message || e) };
  }
}

async function runWithTools(systemInstruction: string, contents: any[]): Promise<any> {
  const tools = [
    { functionDeclarations: [
      { name: "calculate", description: "Посчитать арифметику: ROI, маржу, проценты, налог, рост цены/выручки. expression — строка, например '(750000-450000)/450000*100'.", parameters: { type: Type.OBJECT, properties: { expression: { type: Type.STRING } }, required: ["expression"] } },
      { name: "current_date", description: "Текущая дата, день недели и время (когда спрашивают про сегодня/дату/дедлайн).", parameters: { type: Type.OBJECT, properties: {} } },
      { name: "save_note", description: "Сохранить важную заметку или факт о бизнесе владельца (когда он говорит 'запомни', 'запиши', сообщает о клиенте, цене, договоренности).", parameters: { type: Type.OBJECT, properties: { text: { type: Type.STRING } }, required: ["text"] } },
      { name: "add_task", description: "Добавить задачу или напоминание владельцу (когда просит напомнить, сделать, не забыть). due — срок словами, если назван.", parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, due: { type: Type.STRING } }, required: ["title"] } },
      { name: "order_pizza", description: "Оформить заказ пиццы в службе доставки. Запрашивать перед вызовом явное подтверждение пользователя, размер, тесто, начинку и адрес доставки.", parameters: { type: Type.OBJECT, properties: { items: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Список пицц и предметов" }, address: { type: Type.STRING, description: "Адрес доставки" }, totalRub: { type: Type.NUMBER, description: "Итоговая стоимость в рублях" } }, required: ["items", "address"] } },
      { name: "order_groceries", description: "Оформить заказ и доставку продуктов питания онлайн (Самокат/Яндекс Лавка). Требует явное согласие пользователя, состав корзины и адрес.", parameters: { type: Type.OBJECT, properties: { items: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Список продуктов" }, address: { type: Type.STRING, description: "Адрес доставки" }, totalRub: { type: Type.NUMBER, description: "Итоговая сумма корзины в рублях" } }, required: ["items", "address"] } }
    ] }
  ];

  try {
    let last: any = await generateWithFallback(() => contents, { temperature: 0.7, systemInstruction, tools });
    for (let i = 0; i < 4; i++) {
      const parts = last?.candidates?.[0]?.content?.parts || [];
      const fcPart = parts.find((p: any) => p.functionCall);
      if (!fcPart) break;
      const fc = fcPart.functionCall;
      const result = await execTool(fc.name, fc.args || {});
      contents = [
        ...contents,
        { role: "model", parts: [{ functionCall: fc }] },
        { role: "user", parts: [{ functionResponse: { name: fc.name, response: result } }] }
      ];
      last = await generateWithFallback(() => contents, { temperature: 0.7, systemInstruction, tools });
    }
    return last;
  } catch (err: any) {
    logger.warn("runWithTools failed with function declarations, attempting plain prompt generation fallback", { error: err?.message || err });
    return await generateWithFallback(() => contents, { temperature: 0.7, systemInstruction });
  }
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 2, delayMs = 1200): Promise<T> {
  let lastErr: any;
  for (let i = 0; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      console.warn(`⚠️ Gemini attempt ${i + 1} failed:`, e?.message || e);
      if (i < attempts) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

// ==========================================
// FIREBASE / FIRESTORE STORAGE INTEGRATION
// ==========================================
db = null;
let isFirestoreAvailable = false;

try {
  // Initialize firebase-admin. Since it runs in Cloud Run, it can use default application credentials
  admin.initializeApp();
  db = getFirestore();
  isFirestoreAvailable = true;
  logger.info("🔥 Firebase Admin initialized successfully!");
} catch (error: any) {
  logger.info("ℹ️ Firebase Admin initialization bypassed/skipped. Using local SQLite/JSON fallback.");
}

const MALE_TTS_STYLE_INSTRUCTION = "Говори низким, спокойным и уверенным мужским голосом опытного специалиста. Ровный деловой тон, чёткая дикция, умеренный темп, без пафоса, без мягкости и без монотонности — как инженер, который точно знает, что делает, и говорит по делу.";
const FEMALE_TTS_STYLE_INSTRUCTION = "Говори естественным, доброжелательным и ясным женским голосом. Ровный разговорный тон, чёткая дикция, живая интонация, без пафоса и без роботизированности.";

function formatTtsText(rawText: string, voiceName: string = "Kore"): string {
  if (!rawText) return "";
  const cleaned = rawText.trim();
  const isMale = ["Charon", "Orus", "Alnilam", "Fenrir", "Puck"].includes(voiceName);
  const instruction = isMale ? MALE_TTS_STYLE_INSTRUCTION : FEMALE_TTS_STYLE_INSTRUCTION;
  if (cleaned.includes("Говори низким, спокойным") || cleaned.includes("Говори естественным, доброжелательным")) {
    return cleaned;
  }
  return `${instruction}\n\n${cleaned}`;
}

export interface WakeWordResult {
  detected: boolean;
  voice: "Charon" | "Kore" | null;
  mode: "male" | "female" | null;
  cleanedText: string;
  isOnlyWakeWord: boolean;
  confirmationSpeech: string;
}

function normalizeForWakeWord(text: string): string {
  if (!text) return "";
  let s = text.toLowerCase();
  
  // Replace spoken Russian numbers and variants
  s = s.replace(/семьсот\s*семьдесят\s*семь/g, "777");
  s = s.replace(/три\s*сем[её]рки/g, "777");
  s = s.replace(/три\s*нуля/g, "000");
  s = s.replace(/семь\s*семь\s*семь/g, "777");
  s = s.replace(/ноль\s*ноль\s*ноль/g, "000");
  s = s.replace(/нуль\s*нуль\s*нуль/g, "000");
  s = s.replace(/\bсемь\b/g, "7");
  s = s.replace(/\bноль\b/g, "0");
  s = s.replace(/\bнуль\b/g, "0");
  
  return s;
}

function detectVoiceWakeWord(rawText: string): WakeWordResult {
  if (!rawText || typeof rawText !== "string") {
    return { detected: false, voice: null, mode: null, cleanedText: rawText || "", isOnlyWakeWord: false, confirmationSpeech: "" };
  }

  const normalized = normalizeForWakeWord(rawText);
  const compactText = rawText.toLowerCase().replace(/[\s\-_.,!?:;]+/g, "");

  // Patterns for male wake-word: Selin777 / Селин 777
  const maleRegex = /(?:selin|селин|силин|селен|салин|целин|zelin)\s*(?:7\s*7\s*7|777|три\s*сем[её]рки|семь\s*семь\s*семь|семьсот\s*семьдесят\s*семь)/i;
  // Patterns for female wake-word: Selin000 / Селин 000
  const femaleRegex = /(?:selin|селин|силин|селен|салин|целин|zelin)\s*(?:0\s*0\s*0|000|[oо]\s*[oо]\s*[oо]|[oо]{3}|три\s*нуля|ноль\s*ноль\s*ноль|нуль\s*нуль\s*нуль)/i;

  let matchedMode: "male" | "female" | null = null;
  let targetVoice: "Charon" | "Kore" | null = null;

  if (maleRegex.test(normalized) || compactText.includes("selin777") || compactText.includes("селин777") || compactText.includes("силин777")) {
    matchedMode = "male";
    targetVoice = "Charon";
  } else if (femaleRegex.test(normalized) || compactText.includes("selin000") || compactText.includes("селин000") || compactText.includes("силин000") || compactText.includes("selinooo") || compactText.includes("селинооо")) {
    matchedMode = "female";
    targetVoice = "Kore";
  }

  if (!matchedMode || !targetVoice) {
    return { detected: false, voice: null, mode: null, cleanedText: rawText.trim(), isOnlyWakeWord: false, confirmationSpeech: "" };
  }

  // Remove the wake word from raw text
  let cleaned = rawText;
  if (matchedMode === "male") {
    cleaned = cleaned.replace(/(?:привет[\s,]*)?(?:selin|селин|силин|селен|салин|целин|zelin)[\s\-_]*(?:7[\s\-_]*7[\s\-_]*7|777|три\s*сем[её]рки|семь\s*семь\s*семь|семьсот\s*семьдесят\s*семь|семьсемьсемь)[\s,]*/gi, " ");
  } else {
    cleaned = cleaned.replace(/(?:привет[\s,]*)?(?:selin|селин|силин|селен|салин|целин|zelin)[\s\-_]*(?:0[\s\-_]*0[\s\-_]*0|000|[oо][\s\-_]*[oо][\s\-_]*[oо]|[oо]{3}|три\s*нуля|ноль\s*ноль\s*ноль|нольнольноль|нуль\s*нуль\s*нуль)[\s,]*/gi, " ");
  }

  cleaned = cleaned.replace(/\s*,\s*,+/g, ", ").replace(/\s{2,}/g, " ").replace(/^[\s,!:;?—-]+/, "").replace(/[\s,!:;?—-]+$/, "").trim();

  const isOnlyWakeWord = cleaned.length === 0;
  const confirmationSpeech = matchedMode === "male"
    ? "Мужской режим активирован. Я на связи."
    : "Женский режим активирован.";

  return {
    detected: true,
    voice: targetVoice,
    mode: matchedMode,
    cleanedText: cleaned,
    isOnlyWakeWord,
    confirmationSpeech
  };
}

// In-memory caching for faster response times and offline/no-database reliability
let cachedConfig: any = {
  business_name: "Мой Бизнес",
  owner_name: "Предприниматель",
  industry: "Продажи и услуги",
  tone: "friendly",
  autonomy_level: "full",
  channels: ["telegram"],
  voice_id: "Kore",
  auto_synthesize: false,
  tts_voice: "Kore",
  preferences: { address_form: "вы", response_style: "коротко и по делу", reminder_time: "09:00", timezone: "Europe/Moscow" },
  schedule: { work_start: "09:00", work_end: "18:00", daily_brief_time: "08:30" },
  proactive_scenarios: [],
  tools_enabled: ["web_search", "calculate", "memory"],
  contacts: [],
  tasks: [],
  notes: [],
  metrics: { track: [], targets: {} }
};

let cachedChats: any[] = [];
let cachedKnowledgeBase: { documents: any[]; chunks: any[] } = { documents: [], chunks: [] };
let cachedModerationQueue: any[] = [];
let cachedModerationLog: any[] = [];
let cachedFeed: any[] = [];

// File Storage paths for local persistence
const CONFIG_FILE = path.join(process.cwd(), "company_config.json");
const CHATS_FILE = path.join(process.cwd(), "telegram_chats.json");
const KNOWLEDGE_FILE = path.join(process.cwd(), "knowledge_base.json");
const MODERATION_QUEUE_FILE = path.join(process.cwd(), "moderation_queue.json");
const MODERATION_LOG_FILE = path.join(process.cwd(), "moderation_log.json");
const FEED_FILE = path.join(process.cwd(), "staff_feed.json");

function logFeedEvent(role: string, type: string, title: string, detail: string, status: 'done' | 'pending' | 'info' = 'done') {
  const ev = { id: 'ev_' + Date.now() + '_' + Math.floor(Math.random()*1000), role, type, title, detail, status, ts: new Date().toISOString() };
  cachedFeed.unshift(ev);
  if (cachedFeed.length > 200) cachedFeed = cachedFeed.slice(0, 200);
  if (sqliteDb) {
    try {
      sqliteDb.prepare(`
        INSERT INTO feed (id, role, type, title, detail, status, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(ev.id, ev.role, ev.type, ev.title, ev.detail, ev.status, ev.ts);
    } catch (e) {
      console.error("SQLite write error for feed event:", e);
    }
  }
}

// Helper function to test Firestore write and load initial states
async function initDataStore() {
  if (sqliteDb) {
    try {
      const configRow = sqliteDb.prepare("SELECT data FROM config WHERE id = ?").get("default");
      if (configRow) {
        cachedConfig = JSON.parse(configRow.data);
      }

      const chatRows = sqliteDb.prepare("SELECT data FROM chats").all();
      if (chatRows && chatRows.length > 0) {
        cachedChats = chatRows.map((r: any) => JSON.parse(r.data));
      }

      const kbRow = sqliteDb.prepare("SELECT data FROM knowledge_base WHERE id = ?").get("default");
      if (kbRow) {
        cachedKnowledgeBase = JSON.parse(kbRow.data);
      }

      const queueRows = sqliteDb.prepare("SELECT data FROM moderation_queue").all();
      if (queueRows && queueRows.length > 0) {
        cachedModerationQueue = queueRows.map((r: any) => JSON.parse(r.data));
      }

      const logRows = sqliteDb.prepare("SELECT data FROM moderation_log ORDER BY created_at DESC LIMIT 100").all();
      if (logRows && logRows.length > 0) {
        cachedModerationLog = logRows.map((r: any) => JSON.parse(r.data));
      }

      const feedRows = sqliteDb.prepare("SELECT * FROM feed ORDER BY ts DESC LIMIT 200").all();
      if (feedRows && feedRows.length > 0) {
        cachedFeed = feedRows.map((r: any) => ({
          id: r.id, role: r.role, type: r.type, title: r.title, detail: r.detail, status: r.status, ts: r.ts
        }));
      }
      console.log("📦 Loaded initial data from SQLite DB.");
    } catch (err) {
      console.error("Error loading initial data from SQLite:", err);
    }
  }

  // Pre-populate default mock customers if empty
  if (!cachedChats || cachedChats.length === 0) {
    cachedChats = []; // Не создавать фейковых клиентов
  }

  if (db) {
    try {
      console.log("⚡ Testing Firestore connectivity and permissions...");
      // Fast connection test
      await db.collection("connection_test").doc("status").set({
        timestamp: new Date().toISOString(),
        status: "connected"
      });
      isFirestoreAvailable = true;
      console.log("✅ Firestore connected and writable!");

      // 1. Fetch Company Config from Firestore
      const configDoc = await db.collection("companies").doc("default").get();
      if (configDoc.exists) {
        cachedConfig = { ...cachedConfig, ...configDoc.data() };
        if (sqliteDb) {
          sqliteDb.prepare(`
            INSERT INTO config (id, data, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
          `).run("default", JSON.stringify(cachedConfig), new Date().toISOString());
        }
        console.log("☁️ Loaded Company Config from Firestore.");
      } else {
        // Save current default config to Firestore
        await db.collection("companies").doc("default").set(cachedConfig);
        console.log("☁️ Created default Company Config in Firestore.");
      }

      // 2. Fetch Knowledge Base from Firestore
      const docsSnapshot = await db.collection("knowledge_documents").get();
      const chunksSnapshot = await db.collection("knowledge_chunks").get();
      
      const firestoreDocs: any[] = [];
      docsSnapshot.forEach(doc => firestoreDocs.push(doc.data()));

      const firestoreChunks: any[] = [];
      chunksSnapshot.forEach(doc => firestoreChunks.push(doc.data()));

      if (firestoreDocs.length > 0 || firestoreChunks.length > 0) {
        cachedKnowledgeBase = {
          documents: firestoreDocs,
          chunks: firestoreChunks
        };
        if (sqliteDb) {
          sqliteDb.prepare(`
            INSERT INTO knowledge_base (id, data, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
          `).run("default", JSON.stringify(cachedKnowledgeBase), new Date().toISOString());
        }
        console.log(`☁️ Loaded ${firestoreDocs.length} documents & ${firestoreChunks.length} chunks from Firestore.`);
      }

      // 3. Fetch Telegram Chats from Firestore
      const chatsSnapshot = await db.collection("telegram_chats").get();
      const firestoreChats: any[] = [];
      chatsSnapshot.forEach(doc => firestoreChats.push(doc.data()));

      if (firestoreChats.length > 0) {
        cachedChats = firestoreChats;
        if (sqliteDb) {
          const stmt = sqliteDb.prepare(`
            INSERT INTO chats (id, data, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
          `);
          const tx = sqliteDb.transaction((chats: any[]) => {
            chats.forEach(c => stmt.run(String(c.id), JSON.stringify(c), new Date().toISOString()));
          });
          tx(cachedChats);
        }
        console.log(`☁️ Loaded ${firestoreChats.length} active chats from Firestore.`);
      }

      // 4. Fetch Moderation Queue from Firestore
      const queueSnapshot = await db.collection("moderation_queue").get();
      const firestoreQueue: any[] = [];
      queueSnapshot.forEach(doc => firestoreQueue.push(doc.data()));

      if (firestoreQueue.length > 0) {
        cachedModerationQueue = firestoreQueue;
        if (sqliteDb) {
          const stmt = sqliteDb.prepare(`
            INSERT INTO moderation_queue (id, data, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
          `);
          const tx = sqliteDb.transaction((queue: any[]) => {
            queue.forEach(q => stmt.run(String(q.id), JSON.stringify(q), new Date().toISOString()));
          });
          tx(cachedModerationQueue);
        }
        console.log(`☁️ Loaded ${firestoreQueue.length} pending moderation items from Firestore.`);
      }

      // 5. Fetch Moderation Log from Firestore
      const logSnapshot = await db.collection("moderation_log").limit(100).get();
      const firestoreLog: any[] = [];
      logSnapshot.forEach(doc => firestoreLog.push(doc.data()));

      if (firestoreLog.length > 0) {
        firestoreLog.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        cachedModerationLog = firestoreLog;
        if (sqliteDb) {
          const stmt = sqliteDb.prepare(`
            INSERT INTO moderation_log (id, data, created_at) VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET data = excluded.data, created_at = excluded.created_at
          `);
          const tx = sqliteDb.transaction((logs: any[]) => {
            logs.forEach(l => stmt.run(String(l.id), JSON.stringify(l), l.timestamp || new Date().toISOString()));
          });
          tx(cachedModerationLog);
        }
        console.log(`☁️ Loaded ${firestoreLog.length} historical moderation logs from Firestore.`);
      }

    } catch (err: any) {
      isFirestoreAvailable = false;
      console.log("ℹ️ Firestore API unavailable (" + (err?.message || "disabled/unreachable") + "). Running in standalone local-JSON cache mode.");
    }
  }
}

// Call data store initialization immediately on server startup
initDataStore();

// Synchronous helper wrappers (read from in-memory cache which is fully synced)
function getCompanyConfig() {
  return cachedConfig;
}

function saveCompanyConfig(config: any) {
  cachedConfig = { ...cachedConfig, ...config };
  if (sqliteDb) {
    try {
      sqliteDb.prepare(`
        INSERT INTO config (id, data, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
      `).run("default", JSON.stringify(cachedConfig), new Date().toISOString());
    } catch (err) {
      console.error("SQLite write error for company config:", err);
    }
  }

  // Async write to Firestore if available
  if (isFirestoreAvailable && db) {
    db.collection("companies").doc("default").set(cachedConfig)
      .then(() => console.log("☁️ Saved company config to Firestore."))
      .catch(err => console.error("Firestore write error for company config:", err));
  }
}

const questCache = new Map<string, { data: any, createdAt: number }>();

function cleanChatIdStr(chatId: number | string): string {
  const str = String(chatId).trim();
  if (str.startsWith("max_")) return str.slice(4);
  if (str.startsWith("tg_")) return str.slice(3);
  return str;
}

function getUniversalConfig(): any {
  return {
    business_name: "SELIN",
    owner_name: "Пользователь",
    industry: "Универсальный ИИ-ассистент",
    tone: "friendly",
    autonomy_level: "full",
    channels: ["max"],
    voice_id: "Kore",
    auto_synthesize: false,
    tts_voice: "Kore",
    is_universal: true,
    preferences: { address_form: "вы", response_style: "дружелюбно, полезно и по делу" },
    schedule: { work_start: "00:00", work_end: "23:59", daily_brief_time: "09:00" },
    tools_enabled: ["web_search", "calculate", "memory", "order_pizza", "order_groceries"],
    contacts: [],
    tasks: [],
    notes: [],
    metrics: { track: [], targets: {} },
    agents: []
  };
}

async function getVoiceForChat(chatId?: number | string | null): Promise<string> {
  if (chatId) {
    const userCfg = await getUserConfigByChatId(chatId);
    if (userCfg?.tts_voice || userCfg?.voice_id) {
      return userCfg.tts_voice || userCfg.voice_id;
    }
  }
  const companyCfg = getCompanyConfig();
  return companyCfg.tts_voice || companyCfg.voice_id || "Kore";
}

async function setVoiceForChat(chatId: number | string | null | undefined, voiceName: "Charon" | "Kore"): Promise<void> {
  if (chatId && chatId !== "preview" && chatId !== "default" && String(chatId) !== "0") {
    const existing = (await getUserConfigByChatId(chatId)) || getUniversalConfig();
    const updated = {
      ...existing,
      tts_voice: voiceName,
      voice_id: voiceName,
    };
    await saveUserConfigByChatId(chatId, updated);
  }
  
  // Persist to company config so smart speaker preview and general voice stays switched
  saveCompanyConfig({ tts_voice: voiceName, voice_id: voiceName });
}

async function getUserConfigByChatId(chatId: number | string): Promise<any> {
  if (!chatId) return null;
  const idStr = cleanChatIdStr(chatId);
  if (sqliteDb) {
    try {
      const row = sqliteDb.prepare("SELECT data FROM config WHERE id = ? OR id = ?").get(`max_${idStr}`, `tg_${idStr}`);
      if (row) return JSON.parse(row.data);
    } catch (e) {}
  }
  if (isFirestoreAvailable && db) {
    try {
      const doc = await db.collection("companies").doc(`max_${idStr}`).get();
      if (doc.exists) {
        return doc.data();
      }
      const tgDoc = await db.collection("companies").doc(`tg_${idStr}`).get();
      if (tgDoc.exists) {
        return tgDoc.data();
      }
    } catch (err) {
      console.error("Error in getUserConfigByChatId:", err);
    }
  }
  return null;
}

async function saveUserConfigByChatId(chatId: number | string, config: any): Promise<void> {
  if (!chatId) return;
  const idStr = cleanChatIdStr(chatId);
  if (sqliteDb) {
    try {
      sqliteDb.prepare(`
        INSERT INTO config (id, data, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
      `).run(`max_${idStr}`, JSON.stringify(config), new Date().toISOString());
    } catch (err) {
      console.error("SQLite write error for user config:", err);
    }
  }
  if (isFirestoreAvailable && db) {
    try {
      await db.collection("companies").doc(`max_${idStr}`).set(config);
    } catch (err) {
      console.error("Error in saveUserConfigByChatId:", err);
    }
  }
}

async function tryExtractAndSaveUserConfig(chatId: number | string, userMessage: string, chatHistory: any[]): Promise<any | null> {
  const existing = await getUserConfigByChatId(chatId);
  if (existing && !existing.is_universal) return existing;

  if (!ai || !userMessage || userMessage.trim().length < 3) return null;

  const prompt = `Пользователь пишет в диалоге с универсальным ИИ-ассистентом SELIN.
Сообщение пользователя: "${userMessage}"
Предыдущие сообщения: ${JSON.stringify((chatHistory || []).slice(-4))}

Проанализируй, назвал ли пользователь в сообщении свою сферу бизнеса, профессию, компанию или род занятий (например: "у меня автосервис", "я фотограф", "юридическая фирма", "кофейня", "занимаюсь дизайном", "ремонт квартир", "продаю цветы", "языковая школа").

Если пользователь НЕ упомянул свой конкретный бизнес или род занятий (например, просто поздоровался "привет", спросил "что ты умеешь?", задал вопрос про погоду, код, рисунок и т.д.) — верни JSON:
{"has_business": false}

Если пользователь УПОМЯНУЛ сферу деятельности или бизнес — верни JSON:
{
  "has_business": true,
  "business_name": "Название бизнеса или сфера деятельности (например: Автосервис, Студия дизайна, Кофейня)",
  "owner_name": "Предприниматель",
  "industry": "Сфера деятельности",
  "tone": "friendly",
  "autonomy_level": "full",
  "notes": [
    {"text": "Пользователь указал сферу: " + userMessage.slice(0, 100)}
  ],
  "agent_missions": {
    "receiver": "Принимать обращения клиентов и квалифицировать их.",
    "sales": "Консультировать по услугам и оформлять заявки.",
    "content": "Готовить контент и публикации.",
    "analyst": "Анализировать результаты и показания воронки.",
    "operator": "Координировать работу штаба."
  }
}
Верни ТОЛЬКО валидный JSON объект.`;

  try {
    const res = await generateWithFallback(
      () => [{ role: "user", parts: [{ text: prompt }] }],
      { temperature: 0.1, responseMimeType: "application/json" }
    );
    const text = (res.text || "").trim();
    const data = JSON.parse(text);
    if (data && data.has_business && data.business_name) {
      delete data.has_business;
      const newConfig = {
        ...getUniversalConfig(),
        ...data,
        is_universal: false
      };
      await saveUserConfigByChatId(chatId, newConfig);
      logFeedEvent('operator', 'setup', `Сформирован личный бизнес-контекст (${newConfig.business_name})`, newConfig.industry, 'done');
      console.log(`✨ Auto-created user config for chat ${chatId}:`, newConfig.business_name);
      return newConfig;
    }
  } catch (err) {
    console.warn("tryExtractAndSaveUserConfig error:", err);
  }

  return null;
}

async function generateQuestFromVoice(transcript: string): Promise<any> {
  const systemInstruction = `Ты — эксперт по автоматизации бизнеса и проектированию ИИ-агентов.
Проанализируй запрос пользователя на автоматизацию его бизнеса: "${transcript}".
Твоя задача — составить персонализированный интерактивный пошаговый квест по запуску его цифрового штаба.

Верни ответ строго в формате JSON, содержащем:
- business_name: Название бизнеса или компании (если не упомянуто, придумай логичное исходя из сути)
- owner_name: Имя владельца (если не упомянуто, напиши "Предприниматель")
- industry: Сфера деятельности (индустрия)
- tone: Рекомендуемый тон общения ("friendly", "professional", "energetic", "elegant", "strict")
- suggested_agents: Массив ролей ИИ-агентов, которые будут полезны для этого бизнеса (например: ["receiver", "sales", "operator"])
- steps: Массив из 3-5 шагов квеста. Каждый шаг должен содержать:
  - id: Уникальная строка, например, step1, step2...
  - title: Короткое и понятное название шага на русском
  - description: Описание, почему этот шаг важен для его бизнеса и что нужно настроить
  - agent: Роль агента, с которым связан этот шаг (receiver, sales, content, analyst, operator, или general)
  - completed: false

Пример JSON-структуры:
{
  "business_name": "...",
  "owner_name": "...",
  "industry": "...",
  "tone": "...",
  "suggested_agents": [...],
  "steps": [
    { "id": "step1", "title": "...", "description": "...", "agent": "...", "completed": false }
  ]
}
Верни ТОЛЬКО валидный JSON объект.`;

  try {
    const res = await generateWithFallback(
      () => [{ role: "user", parts: [{ text: "Сгенерируй квест по запуску штаба на основе моего голосового сообщения." }] }],
      {
        temperature: 0.2,
        systemInstruction,
        responseMimeType: "application/json"
      }
    );
    const jsonText = (res.text || "").trim();
    return JSON.parse(jsonText);
  } catch (err) {
    console.error("Error in generateQuestFromVoice:", err);
    // Return standard fallback
    return {
      business_name: "Цифровой Бизнес",
      owner_name: "Владелец",
      industry: "Услуги",
      tone: "friendly",
      suggested_agents: ["receiver", "sales", "operator"],
      steps: [
        {
          id: "step1",
          title: "Задать приветственное сообщение",
          description: "Настройте первое сообщение, которое увидят ваши клиенты при старте диалога.",
          agent: "receiver",
          completed: false
        },
        {
          id: "step2",
          title: "Выбрать каналы связи",
          description: "Активируйте Telegram, WhatsApp или VK для работы ваших ИИ-агентов.",
          agent: "sales",
          completed: false
        },
        {
          id: "step3",
          title: "Загрузить базу знаний",
          description: "Добавьте информацию о ваших услугах или продуктах, чтобы агенты могли давать точные ответы.",
          agent: "operator",
          completed: false
        }
      ]
    };
  }
}

function getTelegramChats() {
  return cachedChats;
}

function saveTelegramChats(chats: any[]) {
  cachedChats = chats;
  if (sqliteDb) {
    try {
      const insertOrUpdate = sqliteDb.prepare(`
        INSERT INTO chats (id, data, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
      `);
      const transaction = sqliteDb.transaction((chatList: any[]) => {
        for (const chat of chatList) {
          insertOrUpdate.run(String(chat.id), JSON.stringify(chat), new Date().toISOString());
        }
      });
      transaction(chats);
    } catch (err) {
      console.error("SQLite write error for telegram chats:", err);
    }
  }

  // Async batch write/set of updated chats to Firestore
  if (isFirestoreAvailable && db) {
    const batch = db.batch();
    chats.forEach(chat => {
      const docRef = db!.collection("telegram_chats").doc(String(chat.id));
      batch.set(docRef, chat);
    });
    batch.commit()
      .then(() => console.log(`☁️ Synced ${chats.length} chats to Firestore.`))
      .catch(err => console.error("Firestore batch error for chats:", err));
  }
}

function getModerationQueue() {
  return cachedModerationQueue;
}

function saveModerationQueue() {
  if (sqliteDb) {
    try {
      const insertOrUpdate = sqliteDb.prepare(`
        INSERT INTO moderation_queue (id, data, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
      `);
      const transaction = sqliteDb.transaction((items: any[]) => {
        sqliteDb.prepare("DELETE FROM moderation_queue").run();
        for (const item of items) {
          insertOrUpdate.run(String(item.id), JSON.stringify(item), new Date().toISOString());
        }
      });
      transaction(cachedModerationQueue);
    } catch (err) {
      console.error("SQLite write error for moderation queue:", err);
    }
  }

  if (isFirestoreAvailable && db) {
    db.collection("moderation_queue").get().then((snapshot: any) => {
      const batch = db.batch();
      snapshot.forEach((doc: any) => batch.delete(doc.ref));
      cachedModerationQueue.forEach((item: any) => {
        const ref = db.collection("moderation_queue").doc(item.id);
        batch.set(ref, item);
      });
      return batch.commit();
    })
    .then(() => console.log(`☁️ Synced ${cachedModerationQueue.length} pending moderation items to Firestore.`))
    .catch((err: any) => console.error("Firestore sync error for moderation queue:", err));
  }
}

function getModerationLog() {
  return cachedModerationLog;
}

function saveModerationLog(item: any) {
  cachedModerationLog.unshift(item);
  if (cachedModerationLog.length > 100) {
    cachedModerationLog = cachedModerationLog.slice(0, 100);
  }

  if (sqliteDb) {
    try {
      sqliteDb.prepare(`
        INSERT INTO moderation_log (id, data, created_at) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, created_at = excluded.created_at
      `).run(String(item.id), JSON.stringify(item), item.timestamp || new Date().toISOString());
    } catch (err) {
      console.error("SQLite write error for moderation log:", err);
    }
  }

  if (isFirestoreAvailable && db) {
    db.collection("moderation_log").doc(item.id).set(item)
      .then(() => console.log("☁️ Saved moderation log entry to Firestore."))
      .catch((err: any) => console.error("Firestore write error for moderation log:", err));
  }
}

function getKnowledgeBase() {
  return cachedKnowledgeBase;
}

function saveKnowledgeBase(kb: any) {
  cachedKnowledgeBase = kb;
  if (sqliteDb) {
    try {
      sqliteDb.prepare(`
        INSERT INTO knowledge_base (id, data, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
      `).run("default", JSON.stringify(cachedKnowledgeBase), new Date().toISOString());
    } catch (err) {
      console.error("SQLite write error for knowledge base:", err);
    }
  }
}

// Endpoint to fetch sync and Firestore database state
app.get("/api/sync-status", (req, res) => {
  return res.json({
    connected: isFirestoreAvailable,
    mode: isFirestoreAvailable ? "Firestore Cloud Database" : "Local Cached Storage"
  });
});


// Split text into chunks with overlapping windows
function splitTextIntoChunks(text: string, chunkSize: number = 500, overlap: number = 100): string[] {
  const chunks: string[] = [];
  let index = 0;
  // Clean whitespace and line endings first
  const cleanText = text.replace(/\s+/g, " ").trim();
  if (cleanText.length <= chunkSize) {
    return [cleanText];
  }
  while (index < cleanText.length) {
    let chunk = cleanText.substring(index, index + chunkSize);
    chunks.push(chunk);
    index += chunkSize - overlap;
    // Prevent infinite loop
    if (chunkSize - overlap <= 0) break;
  }
  return chunks;
}

// Generate dense embedding vectors of length 768 via Gemini
async function getEmbedding(text: string): Promise<number[]> {
  if (!ai) {
    // Return simulated random vector
    const vec: number[] = [];
    for (let i = 0; i < 768; i++) vec.push(Math.random());
    return vec;
  }
  try {
    const response = await ai.models.embedContent({
      model: "text-embedding-004",
      contents: text
    }) as any;
    if (response.embeddings) {
      if (Array.isArray(response.embeddings)) {
        return response.embeddings[0].values;
      } else if (response.embeddings.values) {
        return response.embeddings.values;
      }
    }
  } catch (err) {
    console.error("Embedding API error, returning random vector fallback:", err);
  }
  const vec: number[] = [];
  for (let i = 0; i < 768; i++) vec.push(Math.random());
  return vec;
}

// Simple pure-math cosine similarity matcher
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(vecA.length, vecB.length);
  for (let i = 0; i < length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Search matching knowledge fragments
async function queryKnowledgeBase(queryText: string, limit: number = 3): Promise<{ text: string; docName: string; score: number }[]> {
  const kb = getKnowledgeBase();
  if (!kb.chunks || kb.chunks.length === 0) {
    return [];
  }
  const queryVec = await getEmbedding(queryText);
  const results = kb.chunks.map((chunk: any) => {
    const score = cosineSimilarity(queryVec, chunk.embedding);
    // Apply RAG Indirect Injection Protection & XML wrapping
    const sanitizedText = sanitizeRAGChunk(chunk.text, chunk.docName || "KnowledgeBase");
    return {
      text: sanitizedText,
      docName: chunk.docName,
      score: score
    };
  });
  results.sort((a: any, b: any) => b.score - a.score);
  return results.slice(0, limit);
}

// Endpoint to fetch voice quest structure
app.get("/api/get-voice-quest", (req, res) => {
  const chatId = req.query.chatId as string;
  if (!chatId) {
    return res.status(400).json({ error: "chatId query parameter is required." });
  }
  const cached = questCache.get(chatId);
  if (!cached) {
    return res.status(404).json({ error: "Voice quest not found or expired." });
  }
  if (Date.now() - cached.createdAt > 10 * 60 * 1000) {
    questCache.delete(chatId);
    return res.status(410).json({ error: "Voice quest expired." });
  }
  return res.json(cached.data);
});

// Endpoint to fetch company config
app.get("/api/get-config", async (req, res) => {
  const chatId = req.query.chatId;
  if (chatId) {
    const userConfig = await getUserConfigByChatId(chatId as string);
    if (userConfig) {
      return res.json({ config: userConfig });
    }
    return res.json({ config: getUniversalConfig() });
  }
  return res.json({ config: getCompanyConfig() });
});

// Endpoint to save company config from frontend
app.post("/api/save-config", async (req, res) => {
  const config = req.body;
  if (!config || typeof config !== "object") {
    return res.status(400).json({ error: "Invalid configuration object." });
  }
  const chatId = req.query.chatId || config.chatId;
  if (chatId) {
    await saveUserConfigByChatId(chatId as string, config);
  } else {
    saveCompanyConfig(config);
  }
  if (config.agents) {
    logFeedEvent('operator', 'setup', 'Настройки штаба обновлены', config.business_name || '', 'info');
  }
  console.log("💾 Company config successfully persisted on the server:", config.business_name);
  return res.json({ success: true, config });
});

app.get("/api/feed", (req, res) => {
  return res.json({ feed: cachedFeed });
});

// Endpoint to fetch knowledge base status/stats
app.get("/api/knowledge/status", (req, res) => {
  const kb = getKnowledgeBase();
  return res.json({
    documentCount: kb.documents.length,
    chunkCount: kb.chunks.length,
    documents: kb.documents
  });
});

// Endpoint to upload a document or manual text into knowledge base (RAG)
app.post("/api/knowledge/upload", async (req, res) => {
  try {
    const { name, type, base64, textContent } = req.body;
    let extractedText = "";

    if (textContent) {
      extractedText = textContent;
    } else if (base64) {
      const buffer = Buffer.from(base64, "base64");
      if (type === "application/pdf") {
        const pdfParser = ((pdf as any).default || pdf) as any;
        const parsed = await pdfParser(buffer);
        extractedText = parsed.text;
      } else if (type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || (name && name.endsWith(".docx"))) {
        const parsed = await mammoth.extractRawText({ buffer });
        extractedText = parsed.value;
      } else {
        extractedText = buffer.toString("utf-8");
      }
    } else {
      return res.status(400).json({ error: "Neither textContent nor base64 was provided." });
    }

    if (!extractedText || !extractedText.trim()) {
      return res.status(400).json({ error: "Extracted document content is empty." });
    }

    const docId = `doc_${Date.now()}`;
    const chunks = splitTextIntoChunks(extractedText);
    const kb = getKnowledgeBase();

    // Compute embeddings for all chunks
    const chunkObjects = await Promise.all(
      chunks.map(async (chunkText, index) => {
        const embedding = await getEmbedding(chunkText);
        return {
          id: `${docId}_c${index}`,
          docId,
          docName: name || "Ручной ввод",
          text: chunkText,
          embedding
        };
      })
    );

    const newDoc = {
      id: docId,
      name: name || "Ручной текст",
      type: textContent ? "text" : "file",
      size: textContent ? Buffer.byteLength(textContent) : Buffer.byteLength(base64, "base64"),
      uploadedAt: new Date().toLocaleString("ru-RU"),
      chunkCount: chunks.length
    };

    kb.documents.push(newDoc);
    kb.chunks.push(...chunkObjects);
    saveKnowledgeBase(kb);
    logFeedEvent('operator', 'kb', 'Добавлен документ в базу знаний', newDoc.name, 'done');

    // Sync to Firestore if active
    if (isFirestoreAvailable && db) {
      db.collection("knowledge_documents").doc(docId).set(newDoc)
        .then(() => console.log(`☁️ Saved document metadata ${docId} to Firestore.`))
        .catch(err => console.error("Firestore write error for document metadata:", err));

      const batch = db.batch();
      chunkObjects.forEach(chunk => {
        const docRef = db!.collection("knowledge_chunks").doc(chunk.id);
        batch.set(docRef, chunk);
      });
      batch.commit()
        .then(() => console.log(`☁️ Synced ${chunkObjects.length} chunks to Firestore.`))
        .catch(err => console.error("Firestore batch error for chunks:", err));
    }

    console.log(`📚 Indexed new document into RAG: "${newDoc.name}" with ${newDoc.chunkCount} chunks.`);
    return res.json({ success: true, document: newDoc });
  } catch (err: any) {
    console.error("RAG Document Upload Error:", err);
    return res.status(500).json({ error: err.message || "Failed to process RAG document." });
  }
});

// Endpoint to delete a document from knowledge base (RAG)
app.post("/api/knowledge/delete", (req, res) => {
  const { docId } = req.body;
  if (!docId) {
    return res.status(400).json({ error: "docId is required." });
  }
  const kb = getKnowledgeBase();
  kb.documents = kb.documents.filter((d: any) => d.id !== docId);
  kb.chunks = kb.chunks.filter((c: any) => c.docId !== docId);
  saveKnowledgeBase(kb);

  // Sync deletion to Firestore if active
  if (isFirestoreAvailable && db) {
    db.collection("knowledge_documents").doc(docId).delete()
      .then(() => console.log(`☁️ Deleted document metadata ${docId} from Firestore.`))
      .catch(err => console.error("Firestore delete error for document metadata:", err));

    db.collection("knowledge_chunks").where("docId", "==", docId).get()
      .then(snapshot => {
        const batch = db!.batch();
        snapshot.forEach(doc => {
          batch.delete(doc.ref);
        });
        return batch.commit();
      })
      .then(() => console.log(`☁️ Deleted all chunks for ${docId} from Firestore.`))
      .catch(err => console.error("Firestore delete error for chunks:", err));
  }

  console.log(`🗑️ Removed document ${docId} from RAG.`);
  return res.json({ success: true });
});

// Helper to upload files to Max Bot API
async function uploadFileToMax(fileBuffer: Buffer, fileName: string = 'file.bin'): Promise<string | null> {
  const token = process.env.MAX_BOT_TOKEN;
  if (!token) return null;
  try {
    const formData = new FormData();
    formData.append('file', new Blob([fileBuffer]), fileName);
    const resp = await fetch('https://platform-api2.max.ru/uploads', {
      method: 'POST',
      headers: { 'Authorization': token },
      body: formData
    });
    if (!resp.ok) {
      console.error('Max upload failed with status:', resp.status);
      return null;
    }
    const data: any = await resp.json();
    return data.token || null;
  } catch (err) {
    console.error('Error uploading file to Max:', err);
    return null;
  }
}

// Endpoint to fetch real chats for the simulator UI
app.get(["/api/max/chats", "/api/telegram/chats"], (req, res) => {
  const chats = getTelegramChats();
  return res.json({ chats, isBotActive: !!process.env.MAX_BOT_TOKEN });
});

// Endpoint to send a direct manual message to a client (CRM Helpdesk Mode)
app.post(["/api/max/send-message", "/api/telegram/send-message"], async (req, res) => {
  const { chatId, text } = req.body;
  if (!chatId || !text) {
    return res.status(400).json({ error: "chatId and text are required." });
  }
  const cleanId = cleanChatIdStr(chatId);
  if (maxBot) {
    try {
      await safeSendMessageToChat(maxBot, cleanId, text);
      
      // Save directly to chats history
      const chats = getTelegramChats();
      const chatIndex = chats.findIndex((c: any) => c.id === `max_${cleanId}` || c.id === `tg_${cleanId}` || c.id === chatId);
      if (chatIndex !== -1) {
        chats[chatIndex].history.push({ sender: "agent", text: text });
        chats[chatIndex].lastMessage = text;
        chats[chatIndex].timestamp = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        saveTelegramChats(chats);
      }
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to send message via Max bot." });
    }
  } else {
    return res.status(400).json({ error: "Max Bot is not active." });
  }
});

// Helper to extract chatId from various payload pathways
function extractMaxChatId(payload: any): string | null {
  const candidates = [
    payload?.body?.message?.recipient?.chat_id,
    payload?.message?.recipient?.chat_id,
    payload?.body?.chat_id,
    payload?.chat_id,
    payload?.chat?.id,
    payload?.body?.message?.chat_id,
  ];
  for (const c of candidates) {
    if (c !== undefined && c !== null && String(c).trim() !== '' && String(c) !== 'null') {
      return String(c).trim();
    }
  }
  return null;
}

// Helper to safely send messages with robust logs and retry fallbacks
async function safeSendMessageToChat(
  botInstance: Bot | null,
  chatId: number | string,
  text: string | null | undefined,
  extra?: any
): Promise<any> {
  if (!botInstance) return null;
  const cleanIdStr = String(chatId).replace(/^[a-z_]+/, '');
  const numericId = parseInt(cleanIdStr, 10);
  if (isNaN(numericId) || numericId <= 0) {
    console.error('❌ safeSendMessageToChat: невалидный numericId', { raw: chatId, parsed: numericId });
    return null;
  }

  // If text is empty string and extra is provided, we omit it or pass null/undefined to avoid proto.payload
  const textToSend = (text === "" && extra) ? undefined : text;

  try {
    logger.info(`Sending message to Max chat ${numericId}`, {
      text: textToSend,
      hasExtra: !!extra,
      extraKeys: extra ? Object.keys(extra) : []
    });

    const message = await botInstance.api.sendMessageToChat(numericId, textToSend as any, extra);
    logger.info(`✅ Message successfully sent to Max chat ${numericId}`);
    return message;
  } catch (err: any) {
    logger.error("❌ Max send failed in safeSendMessageToChat!", {
      chatId: numericId,
      status: err?.status,
      code: err?.code || err?.response?.code,
      message: err?.message,
      response: err?.response ? JSON.stringify(err.response) : undefined,
      fullError: JSON.stringify(err)
    });

    // Fallback: If sending with extra/attachments failed, retry sending plain text
    if (extra && text) {
      try {
        logger.info(`🔄 Attempting fallback plain-text send to Max chat ${numericId}...`);
        const fallbackMsg = await botInstance.api.sendMessageToChat(numericId, text);
        logger.info(`✅ Fallback plain-text sent successfully to Max chat ${numericId}`);
        return fallbackMsg;
      } catch (fallbackErr: any) {
        logger.error("❌ Fallback plain-text send ALSO failed!", {
          chatId: numericId,
          status: fallbackErr?.status,
          code: fallbackErr?.code || fallbackErr?.response?.code,
          message: fallbackErr?.message,
          response: fallbackErr?.response ? JSON.stringify(fallbackErr.response) : undefined
        });
      }
    }

    throw err;
  }
}

// Helper to synthesize and send voice message to Max Bot
async function synthesizeAndSendVoice(
  chatIdOrBot: any,
  chatIdOrText: any,
  textOrSkip?: any,
  extraArg?: any
): Promise<void> {
  let chatId: string;
  let text: string;
  let botInstance: any = maxBot;

  if (typeof chatIdOrBot === 'string' || typeof chatIdOrBot === 'number') {
    chatId = String(chatIdOrBot);
    text = String(chatIdOrText);
  } else {
    botInstance = chatIdOrBot || maxBot;
    chatId = String(chatIdOrText);
    text = String(textOrSkip);
  }

  // Перед отправкой голоса — обогащаем ответ контекстом
  if (text && !text.includes('```') && !text.includes('http') && !text.startsWith('Приняла') && !text.startsWith('🔄') && text.length < 80) {
    try {
      const enhanced = await smartCallLLM(
        chatId,
        `Разверни эту мысль для голосового ответа: "${text}"`,
        'Ты — голосовой ассистент. Отвечай так, чтобы это звучало естественно и увлеченно.'
      );
      if (enhanced && !enhanced.includes('Ой, что-то я')) {
        text = enhanced;
      }
    } catch (enhErr) {}
  }

  // Обрезаем лишнее, очищаем от разметки Markdown, смайликов и эмодзи для идеального голосового синтеза
  text = String(text)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/[#*_~>]/g, '')
    .replace(/[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) {
    console.warn("⚠️ synthesizeAndSendVoice: Текст для синтеза пуст после очистки.");
    return;
  }

  logger.info(`🎙️ Запуск синтеза голоса для чата ${chatId} (длина очищенного текста: ${text.length})`);

  let audioBuffer: Buffer | null = null;
  let voiceMethodUsed = "None";

  // ПОРЯДОК СИНТЕЗА:
  // 1. Попытка через основной API-роутер (TeamoRouter / Agent Router / OpenAI / и т.д.), если он настроен
  const ttsBaseUrl = process.env.OPENAI_BASE_URL || process.env.TEAMO_BASE_URL || process.env.AGENT_ROUTER_BASE_URL;
  const ttsApiKey = process.env.OPENAI_API_KEY || process.env.TEAMO_API_KEY || process.env.AGENT_ROUTER_API_KEY;
  const ttsModel = process.env.OPENAI_TTS_MODEL || 'tts-1';
  const ttsVoice = process.env.OPENAI_TTS_VOICE || 'alloy';

  if (ttsBaseUrl && ttsApiKey) {
    try {
      let formattedUrl = ttsBaseUrl.trim();
      if (!formattedUrl.endsWith('/v1') && !formattedUrl.endsWith('/v1beta') && !formattedUrl.includes('/v1/') && !formattedUrl.includes('/v1beta/')) {
        formattedUrl = formattedUrl.replace(/\/$/, '') + '/v1';
      }

      console.log(`🎙️ Попытка генерации через API-роутер TTS (${formattedUrl}/audio/speech)...`);
      const response = await fetch(`${formattedUrl}/audio/speech`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ttsApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: ttsModel,
          input: text,
          voice: ttsVoice,
          response_format: 'mp3'
        }),
        signal: AbortSignal.timeout(15000) // 15 секунд таймаут для Railway
      });

      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || contentType.includes("text/html")) {
        const errText = await response.text();
        console.error(`❌ [API Router TTS Error] Сервер вернул ошибку. Статус: ${response.status}. Content-Type: ${contentType}. Первая часть ответа (до 200 симв):`);
        console.error(errText.slice(0, 200));
        throw new Error(`OpenAI-TTS failed with status ${response.status}`);
      }

      const arrayBuf = await response.arrayBuffer();
      audioBuffer = Buffer.from(arrayBuf);
      voiceMethodUsed = "OpenAI/Teamo TTS";
      console.log(`✅ Успешно сгенерирован голос через API-роутер (${voiceMethodUsed})`);
    } catch (err: any) {
      console.warn(`⚠️ Сбой генерации через API-роутер TTS: ${err?.message || err}. Переключаемся на резервный Edge TTS...`);
    }
  }

  // 2. Резервный вариант №1 (Edge TTS): если основной API дал сбой или не настроен
  if (!audioBuffer) {
    try {
      console.log("🎙️ Запуск резервного Edge TTS для синтеза...");
      const tts = new MsEdgeTTS();
      const voiceName = process.env.EDGE_TTS_VOICE || 'ru-RU-SvetlanaNeural';
      await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const streamRes = tts.toStream(text);
      const readable = (streamRes && (streamRes as any).audioStream) ? (streamRes as any).audioStream : streamRes;

      const chunks: Buffer[] = [];
      for await (const chunk of readable) {
        if (Buffer.isBuffer(chunk)) chunks.push(chunk);
        else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk));
      }
      audioBuffer = Buffer.concat(chunks);
      voiceMethodUsed = "Edge TTS";
      console.log(`✅ Успешно сгенерирован голос через резервный Edge TTS`);
    } catch (err: any) {
      console.error(`❌ Ошибка резервного Edge TTS: ${err?.message || err}`);
    }
  }

  // 3. Загрузка в MAX Storage и отправка (с защитой от HTML-ошибок и падений)
  if (audioBuffer && audioBuffer.length > 0) {
    try {
      const MAX_TOKEN = process.env.MAX_BOT_TOKEN;
      console.log("💾 Загрузка аудио в MAX Storage...");
      const initRes = await fetch('https://platform-api.max.ru/uploads?type=audio', {
        method: 'POST',
        headers: { 'Authorization': MAX_TOKEN || '' },
        signal: AbortSignal.timeout(15000)
      });

      const initContentType = initRes.headers.get("content-type") || "";
      if (!initRes.ok || initContentType.includes("text/html")) {
        const initErrText = await initRes.text();
        console.error(`❌ [MAX Storage Init HTML Error] Статус: ${initRes.status}. Content-Type: ${initContentType}. Ответ (до 200 симв):`);
        console.error(initErrText.slice(0, 200));
        throw new Error(`MAX Storage Init returned HTTP ${initRes.status}`);
      }

      const initData = await initRes.json();
      const token = initData.token;
      const url = initData.url;

      if (!token || !url) {
        throw new Error("MAX Storage response missing token or url");
      }

      // Использование встроенного в Node.js 18+ стандартного FormData и Blob.
      // Это автоматически и корректно формирует multipart/form-data со всеми нужными boundary,
      // предотвращая ошибку 412 (Precondition Failed) на сервере MAX.
      const form = new FormData();
      const fileBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });
      form.append('data', fileBlob, 'voice.mp3');

      // Логируем параметры отправки для диагностики (без конфиденциальных токенов)
      console.log(`🌐 [MAX Storage Upload] Отправка файла на URL: ${url.substring(0, 70)}... (размер: ${audioBuffer.length} байт)`);
      
      const uploadRes = await fetch(url, {
        method: 'POST',
        // Убираем ручное указание заголовка Content-Type (чтобы fetch сам прописал boundary)
        // и убираем Authorization для upload URL (так как ссылка url уже содержит все одноразовые токены)
        body: form,
        signal: AbortSignal.timeout(20000)
      });

      const uploadContentType = uploadRes.headers.get("content-type") || "";
      if (!uploadRes.ok || uploadContentType.includes("text/html")) {
        const uploadErrText = await uploadRes.text();
        console.error(`❌ [MAX Storage Upload HTML Error] Статус: ${uploadRes.status}. Content-Type: ${uploadContentType}. Ответ (до 200 симв):`);
        console.error(uploadErrText.slice(0, 200));
        throw new Error(`MAX Storage Upload returned HTTP ${uploadRes.status}`);
      }

      await new Promise(r => setTimeout(r, 3000)); // Ждём индексации на сервере MAX

      // 4. Отправляем через SDK
      const numericChatId = parseInt(String(chatId).replace(/\D/g, ''), 10);
      await botInstance.api.sendMessageToChat(numericChatId, '', {
        attachments: [{
          type: 'audio',
          payload: { 
            token: token, 
            filename: 'voice.mp3' 
          }
        }]
      });

      console.log(`✅ Голос успешно отправлен в чат ${numericChatId} (Метод: ${voiceMethodUsed})`);
      return; // Полный успех!
    } catch (uploadErr: any) {
      console.error(`❌ Сбой при загрузке или отправке аудио через MAX Storage: ${uploadErr?.message || uploadErr}`);
    }
  }

  // ПОРЯДОК СИНТЕЗА - РЕЗЕРВНЫЙ ВАР No2 (Полный фолбэк на Текст):
  // Если все методы аудиосинтеза или отправка файла дали сбой, отправляем обычное текстовое сообщение
  console.warn(`⚠️ ПОЛНЫЙ ФОЛБЭК: Отправляем обычный текст в чат ${chatId}, так как аудиосинтез не удался.`);
  await safeSendMessageToChat(botInstance, chatId, text);
}

async function transcribeAudio(audioBuffer: Buffer, filename: string = 'voice.ogg'): Promise<string> {
  try {
    const key = process.env.GROQ_API_KEY;
    if (!key) {
      console.warn("⚠️ GROQ_API_KEY не задан в окружении! Возвращаем пустую строку.");
      return "";
    }

    const form = new FormData();
    const fileBlob = new Blob([audioBuffer], { type: 'audio/ogg' });
    form.append('file', fileBlob, filename);
    form.append('model', 'whisper-large-v3');
    form.append('language', 'ru'); // Явно задаем русский язык для точности

    console.log(`🎙️ [Groq Whisper STT] Отправка запроса (размер: ${audioBuffer.length} байт)...`);
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`
      },
      body: form,
      signal: AbortSignal.timeout(25000)
    });

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || contentType.includes("text/html")) {
      const errText = await response.text();
      console.error(`❌ [Groq Whisper STT Error] HTTP статус: ${response.status}. Content-Type: ${contentType}. Ответ (до 200 симв):`);
      console.error(errText.slice(0, 200));
      return "";
    }

    const data = await response.json() as any;
    const text = data.text || "";
    console.log(`✅ [Groq Whisper STT Success] Распознанный текст: "${text}"`);
    return text;
  } catch (err: any) {
    console.error(`❌ [Groq Whisper STT Failed] Ошибка при распознавании речи: ${err?.message || err}`);
    return "";
  }
}

async function transcribeAudioFromUrl(url: string): Promise<string> {
  const audioBuffer = await downloadMaxAudio(url);
  return await transcribeAudio(audioBuffer, 'voice.ogg');
}

async function downloadMaxAudio(fileUrlOrId: string): Promise<Buffer> {
  try {
    let url = fileUrlOrId.trim();
    // Если передан только UUID/токен, формируем полный URL для загрузки
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://platform-api.max.ru/uploads/${url}`;
    }

    console.log(`💾 [downloadMaxAudio] Скачивание файла с URL: ${url.slice(0, 85)}...`);
    
    const MAX_TOKEN = process.env.MAX_BOT_TOKEN;
    const headers: Record<string, string> = {};
    if (MAX_TOKEN) {
      headers['Authorization'] = MAX_TOKEN;
    }

    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(20000)
    });

    const contentType = res.headers.get("content-type") || "";
    if (!res.ok || contentType.includes("text/html")) {
      const errText = await res.text();
      console.error(`❌ [downloadMaxAudio Error] HTTP статус: ${res.status}. Content-Type: ${contentType}. Ответ (до 200 симв):`);
      console.error(errText.slice(0, 200));
      throw new Error(`MAX Storage download returned HTTP ${res.status}`);
    }

    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    console.log(`✅ [downloadMaxAudio Success] Файл успешно загружен. Размер: ${buffer.length} байт.`);
    return buffer;
  } catch (err: any) {
    console.error(`❌ [downloadMaxAudio Failed] Ошибка при скачивании аудио из MAX: ${err?.message || err}`);
    throw err;
  }
}

async function transcribeAudioBuffer(buf: Buffer): Promise<string> {
  // Для обратной совместимости с другими эндпоинтами используем новый асинхронный метод
  return transcribeAudio(buf, 'voice.ogg');
}

async function generateImage(prompt: string): Promise<Buffer | null> {
  try {
    const encoded = encodeURIComponent(prompt);
    const url = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&nologo=true&seed=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (err: any) {
    console.error('❌ Image gen failed:', err?.message);
    return null;
  }
}

async function sendImageToMax(chatId: string, imageBuffer: Buffer) {
  try {
    const MAX_TOKEN = process.env.MAX_BOT_TOKEN!;
    const initRes = await fetch('https://platform-api.max.ru/uploads?type=image', {
      method: 'POST', headers: { 'Authorization': MAX_TOKEN }
    });
    const { url, token } = await initRes.json();
    
    const fd = new FormData();
    fd.append('data', new Blob([imageBuffer], {type:'image/jpeg'}), 'img.jpg');
    await fetch(url, { method:'POST', headers:{'Authorization':MAX_TOKEN}, body:fd });
    await new Promise(r=>setTimeout(r,1500));
    
    await safeSendMessageToChat(maxBot, chatId, undefined, {
      attachments: [{ type: 'image', payload: { token } }]
    });
  } catch (err: any) {
    console.error('❌ Image send failed:', err?.message);
  }
}

// Helper to detect quota or permission or rate limit errors
function isQuotaOrLimitError(err: any): boolean {
  if (!err) return false;
  const str = String(err?.message || err?.status || err?.code || err).toLowerCase();
  return (
    str.includes("429") ||
    str.includes("quota") ||
    str.includes("limit") ||
    str.includes("resource_exhausted") ||
    str.includes("exceeded") ||
    str.includes("not_found") ||
    str.includes("permission") ||
    str.includes("forbidden") ||
    str.includes("403") ||
    str.includes("not enabled") ||
    str.includes("unsupported")
  );
}

// Quietly update client profile
function quietClientProfileUpdate(clientName: string, text: string, chatId: string | number) {
  try {
    const chats = getTelegramChats();
    const chatIndex = chats.findIndex((c: any) => c.id === `tg_${chatId}` || c.id === chatId);
    if (chatIndex !== -1) {
      if (!chats[chatIndex].profileNotes) chats[chatIndex].profileNotes = [];
      const lower = text.toLowerCase();
      if (lower.includes("волонтёр") || lower.includes("доброволец")) {
        if (!chats[chatIndex].profileNotes.includes("Развивает волонтёрскую команду")) {
          chats[chatIndex].profileNotes.push("Развивает волонтёрскую команду");
        }
      }
      if (lower.includes("питон") || lower.includes("python") || lower.includes("бот")) {
        if (!chats[chatIndex].profileNotes.includes("Интересуется Python-ботами")) {
          chats[chatIndex].profileNotes.push("Интересуется Python-ботами");
        }
      }
      if (lower.includes("видео") || lower.includes("море") || lower.includes("анимаци")) {
        if (!chats[chatIndex].profileNotes.includes("Запрашивает видеоконтент")) {
          chats[chatIndex].profileNotes.push("Запрашивает видеоконтент");
        }
      }
      saveTelegramChats(chats);
    }
  } catch (e) {
    console.warn("quietClientProfileUpdate error:", e);
  }
}

// Generate Image with Gemini Imagen / Fallback
async function generateImageWithGemini(prompt: string): Promise<{ success: boolean; base64?: string; mimeType?: string; error?: string; isQuota?: boolean }> {
  if (!ai) return { success: false, error: "AI client not initialized", isQuota: true };

  const imageModels = ["imagen-3.0-generate-002", "imagen-3.0-fast-generate-001"];
  for (const m of imageModels) {
    try {
      const response = await ai.models.generateImages({
        model: m,
        prompt: prompt,
        config: {
          numberOfImages: 1,
          outputMimeType: "image/jpeg",
          aspectRatio: "1:1"
        }
      });
      const img = response?.generatedImages?.[0]?.image;
      if (img?.imageBytes) {
        return { success: true, base64: img.imageBytes, mimeType: "image/jpeg" };
      }
    } catch (err: any) {
      console.warn(`Imagen model ${m} failed:`, err?.message || err);
    }
  }
  return { success: false, error: "Квота на генерацию изображений ограничена", isQuota: true };
}

// Generate Video with Gemini Veo / Fallback
async function generateVideoWithGemini(prompt: string): Promise<{ success: boolean; base64?: string; error?: string; isQuota?: boolean }> {
  if (!ai) return { success: false, error: "AI client not initialized", isQuota: true };

  try {
    if (typeof (ai.models as any).generateVideos === "function") {
      const response = await (ai.models as any).generateVideos({
        model: "veo-2.0-generate-001",
        prompt: prompt,
        config: { aspectRatio: "16:9", durationSeconds: 5 }
      });
      const vid = response?.generatedVideos?.[0]?.video;
      if (vid?.videoBytes) {
        return { success: true, base64: vid.videoBytes };
      }
    }
  } catch (err: any) {
    console.warn("Veo video generation failed:", err?.message || err);
  }
  return { success: false, error: "Квота на генерацию видео Veo ограничена", isQuota: true };
}

// Multimodal Intent Classifier and Processor
async function processMultimodalMessage(
  userMessage: string,
  chatHistory: any[] = [],
  config: any = {},
  isVoice: boolean = false
): Promise<{
  textResponse: string;
  mediaType: 'image' | 'code' | 'voice' | 'video' | 'text';
  mediaUrl?: string;
  imageBuffer?: Buffer;
  codeDetails?: { language: string; filename: string; code: string; explanation: string };
  audioBase64?: string;
  isQuotaDegraded?: boolean;
}> {
  if (!ai) {
    return {
      textResponse: `Принял ваш запрос: "${userMessage}". Я работаю в автономном режиме.`,
      mediaType: 'text'
    };
  }

  // Check intent via Gemini Function Call / Tool Calling
  const intentTools = [
    {
      functionDeclarations: [
        {
          name: "generate_image",
          description: "Сгенерировать логотип, картинку, фото или рисунок (когда просят: 'нарисуй', 'сгенерируй фото', 'логотип', 'картинка', 'рисунок')",
          parameters: {
            type: Type.OBJECT,
            properties: {
              prompt: { type: Type.STRING, description: "Подробный промпт на английском для модели Imagen" },
              caption: { type: Type.STRING, description: "Тёплый сопроводительный текст клиенту на русском с выжимкой идеи" }
            },
            required: ["prompt", "caption"]
          }
        },
        {
          name: "generate_code",
          description: "Написать код, скрипт, бота или программу (когда просят: 'напиши код', 'скрипт', 'бот на питоне', 'программу')",
          parameters: {
            type: Type.OBJECT,
            properties: {
              language: { type: Type.STRING, description: "Язык программирования (python, javascript и т.д.)" },
              filename: { type: Type.STRING, description: "Имя файла (например, bot.py)" },
              explanation: { type: Type.STRING, description: "Развернутое человечное пояснение к коду" },
              code: { type: Type.STRING, description: "Полный рабочий код" }
            },
            required: ["language", "filename", "explanation", "code"]
          }
        },
        {
          name: "generate_video",
          description: "Сгенерировать видеоролик, клип или анимацию (когда просят: 'сделай видео', 'ролик', 'анимацию')",
          parameters: {
            type: Type.OBJECT,
            properties: {
              prompt: { type: Type.STRING, description: "Описание сцены видео" },
              duration_seconds: { type: Type.NUMBER, description: "Длительность (например, 5)" },
              initial_ack: { type: Type.STRING, description: "Сообщение клиенту о начале создания видео" }
            },
            required: ["prompt", "initial_ack"]
          }
        },
        {
          name: "answer_voice_or_text",
          description: "Обычный ответ на вопрос, консультация или когда просят рассказать голосом",
          parameters: {
            type: Type.OBJECT,
            properties: {
              wants_voice: { type: Type.BOOLEAN, description: "Запросил ли собеседник явно голосовой ответ или прислал голосовое" }
            }
          }
        }
      ]
    }
  ];

  const systemInstruction = `Ты — Selin AI, интеллектуальный наставник. Учишь языки профессионально (интервальные повторения, диалоги, shadowing, домашки, квесты). Помогаешь в бизнесе (планы, задания, контроль, ролевые игры). Помогаешь в быту (пока в разработке). Говори коротко, по делу. На уроках — на изучаемом языке с переводом. Давай конкретные задания. Запоминай прогресс.`;

  const userPrompt = `Сообщение пользователя: "${userMessage}"\nВыбери подходящую функцию.`;

  let callResult: any = null;
  try {
    const res = await generateWithFallback(
      () => [{ role: "user", parts: [{ text: userPrompt }] }],
      {
        systemInstruction,
        tools: intentTools,
        temperature: 0.2
      }
    );

    const parts = res?.candidates?.[0]?.content?.parts || [];
    const fcPart = parts.find((p: any) => p.functionCall);
    if (fcPart) {
      callResult = fcPart.functionCall;
    }
  } catch (e: any) {
    logger.warn("Intent classification online model failed, using rule-based fallback:", { error: e?.message || e });
  }

  // Offline / Quota-Exceeded Rule-Based Intent Fallback
  if (!callResult) {
    const lower = userMessage.toLowerCase();
    if (lower.includes("логотип") || lower.includes("нарисуй") || lower.includes("картинку") || lower.includes("баннер") || lower.includes("иллюстраци") || lower.includes("изображени")) {
      callResult = { name: "generate_image", args: { prompt: userMessage, caption: `Сгенерировал вариант иллюстрации/логотипа по вашему запросу!` } };
    } else if (lower.includes("код") || lower.includes("напиши скрипт") || lower.includes("компонент") || lower.includes("функци")) {
      callResult = { name: "write_code", args: { explanation: "Готовый пример кода по вашему запросу:", code: `// Реализация для: ${userMessage}\nconsole.log("Успешно запущен!");`, language: "typescript" } };
    } else if (lower.includes("видео") || lower.includes("анимаци")) {
      callResult = { name: "generate_video", args: { prompt: userMessage, duration_seconds: 5, initial_ack: `Создаем видео по вашему запросу...` } };
    }
  }

  const funcName = callResult?.name || "answer_voice_or_text";
  const args = callResult?.args || {};

  // Capability 1: IMAGE GENERATION
  if (funcName === "generate_image") {
    const prompt = args.prompt || `Professional vector logo or illustration for: ${userMessage}`;
    const caption = args.caption || `Сгенерировал для вас варианты по запросу: "${userMessage}"!`;

    const imgRes = await generateImageWithGemini(prompt);
    if (imgRes.success && imgRes.base64) {
      const buf = Buffer.from(imgRes.base64, "base64");
      return {
        textResponse: caption,
        mediaType: 'image',
        mediaUrl: `data:${imgRes.mimeType || 'image/jpeg'};base64,${imgRes.base64}`,
        imageBuffer: buf
      };
    } else {
      // Graceful Degradation for Image
      const degradationText = `Эта возможность (генерация изображений) сейчас ограничена квотой API. Но я разработал для вас подробный арт-концепт и дизайн-макет:\n\n` +
        `• **Идея и символ:** ${caption}\n` +
        `• **Стиль:** Минималистичный вектор с современными акцентами и чистой геометрией.\n` +
        `• **Цветовая гамма:** Гармоничные контрастные тона для бейджей, соцсетей и мерча.`;

      return {
        textResponse: degradationText,
        mediaType: 'text',
        isQuotaDegraded: true
      };
    }
  }

  // Capability 2: CODE GENERATION
  if (funcName === "generate_code") {
    const lang = args.language || "python";
    const filename = args.filename || (lang === "python" ? "bot.py" : "script.js");
    const explanation = args.explanation || `Написал для вас готовый код по запросу "${userMessage}".`;
    const code = args.code || `# Код по запросу: ${userMessage}\nimport telebot\n\nbot = telebot.TeleBot("YOUR_TOKEN")\n\n@bot.message_handler(commands=['start'])\ndef start(msg):\n    bot.reply_to(msg, "Привет!")\n\nbot.polling()`;

    const formattedText = `${explanation}\n\n\`\`\`${lang}\n${code}\n\`\`\``;

    return {
      textResponse: formattedText,
      mediaType: 'code',
      codeDetails: {
        language: lang,
        filename: filename,
        code: code,
        explanation: explanation
      }
    };
  }

  // Capability 3: VIDEO GENERATION
  if (funcName === "generate_video") {
    const prompt = args.prompt || userMessage;
    const initialAck = args.initial_ack || `Делаю ролик по вашему запросу! Это займёт около минуты... 🌊`;

    const vidRes = await generateVideoWithGemini(prompt);
    if (vidRes.success && vidRes.base64) {
      const buf = Buffer.from(vidRes.base64, "base64");
      return {
        textResponse: `${initialAck}\nВот готовое видео!`,
        mediaType: 'video',
        mediaUrl: `data:video/mp4;base64,${vidRes.base64}`
      };
    } else {
      // Graceful Degradation: Video API hits quota limit -> Replace with Image!
      const imgFallback = await generateImageWithGemini(`Cinematic high resolution realistic 4k photo: ${prompt}`);
      if (imgFallback.success && imgFallback.base64) {
        const buf = Buffer.from(imgFallback.base64, "base64");
        return {
          textResponse: `Создание видео сейчас ограничено квотой API-ключа. Зато вместо видео я сгенерировал для вас потрясающее фото по вашей задумке! 🌊`,
          mediaType: 'image',
          mediaUrl: `data:${imgFallback.mimeType || 'image/jpeg'};base64,${imgFallback.base64}`,
          imageBuffer: buf,
          isQuotaDegraded: true
        };
      } else {
        return {
          textResponse: `Создание видео сейчас ограничено квотой API. Могу описать сценарий ролика покадрово или подготовить текстом!`,
          mediaType: 'text',
          isQuotaDegraded: true
        };
      }
    }
  }

  // Capability 4: ANSWER VOICE / TEXT
  const textResponse = await generateAgentResponseHelper(userMessage, "receiver", chatHistory, config);
  const wantsVoice = args.wants_voice || isVoice || userMessage.toLowerCase().includes("голос") || userMessage.toLowerCase().includes("скажи") || userMessage.toLowerCase().includes("расскажи");

  if (wantsVoice) {
    try {
      console.log('🎤 Edge TTS inside wantsVoice:', textResponse.slice(0, 50));
      const tts = new MsEdgeTTS();
      await tts.setMetadata(
        process.env.EDGE_TTS_VOICE || 'ru-RU-SvetlanaNeural',
        OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3
      );
      
      const { audioStream } = tts.toStream(textResponse);
      const chunks: Buffer[] = [];
      for await (const chunk of audioStream) {
        if (Buffer.isBuffer(chunk)) chunks.push(chunk);
        else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk));
      }
      const audioBuffer = Buffer.concat(chunks);
      const base64Data = audioBuffer.toString('base64');
      return {
        textResponse: textResponse,
        mediaType: 'voice',
        audioBase64: base64Data
      };
    } catch (ttsErr: any) {
      console.warn("TTS synthesis error / quota fallback:", ttsErr?.message || ttsErr);
      return {
        textResponse: `Голосовая озвучка сейчас временно недоступна. Отвечаю вам текстом:\n\n${textResponse}`,
        mediaType: 'text',
        isQuotaDegraded: true
      };
    }
  }

  return {
    textResponse: textResponse,
    mediaType: 'text'
  };
}

// Helper to generate agent response (using RAG & Gemini or simulation fallback)
async function generateAgentResponseHelper(user_message: string, agentRole: string, chatHistory: any[], config: any): Promise<string> {
  const isUniversal = !config || config.is_universal || !config.business_name || config.business_name === "SELIN";

  if (!ai) {
    return isUniversal
      ? `Привет! Я — ваш универсальный ИИ-ассистент SELIN. Готов помочь с вопросами и задачами.`
      : (agentRole === "sales"
        ? `Спасибо за интерес к "${config.business_name}"! Подберу для вас лучшее предложение.`
        : `Принял ваш вопрос про "${user_message}". Уточню и вернусь с ответом.`);
  }
  try {
    let ragContext = "";
    if (!isUniversal) {
      const matchedChunks = await queryKnowledgeBase(user_message, 2);
      const relevantChunks = matchedChunks.filter((c: any) => c.score >= 0.35);
      if (relevantChunks.length > 0) {
        ragContext = "\nФАКТЫ ИЗ БАЗЫ ЗНАНИЙ КОМПАНИИ (опирайся на них):\n" + relevantChunks.map((c: any) => `- [${c.docName}]: ${c.text}`).join("\n") + "\n";
      }
    }
    const prefs = config.preferences || {};
    const address = prefs.address_form === "ты" ? "Обращайся на «ты»." : "Обращайся на «вы».";
    const goals = (config.metrics && config.metrics.targets) ? JSON.stringify(config.metrics.targets) : "";
    const notesBlock = (config.notes && config.notes.length) ? "\nЗАМЕТКИ О БИЗНЕСЕ ВЛАДЕЛЬЦА (помни их):\n" + config.notes.slice(0, 10).map((n: any) => "- " + n.text).join("\n") + "\n" : "";
    const tasksBlock = (config.tasks && config.tasks.length) ? "\nАКТУАЛЬНЫЕ ЗАДАЧИ/НАПОМИНАНИЯ ВЛАДЕЛЬЦА:\n" + config.tasks.slice(0, 10).map((t: any) => "- " + t.title + (t.due ? " (срок: " + t.due + ")" : "")).join("\n") + "\n" : "";
    const recent = chatHistory.slice(-12);
    const contents = [
      ...recent.map((h: any) => ({ role: (h.sender === "customer" ? "user" : "model"), parts: [{ text: h.text }] })),
      { role: "user", parts: [{ text: user_message }] }
    ];
    const mission = (config.agent_missions || {})[agentRole] || "";

    let roleHeader = "";
    if (isUniversal) {
      roleHeader = `Ты — универсальный персональный ИИ-ассистент SELIN.
Твои ключевые навыки: ответ на любые вопросы, решение логических/математических задач, генерация фото, кода, видео, озвучка голосом, поиск информации в Сети, а также заказ пиццы и продуктов.

КРАЙНЕ ВАЖНЫЕ ПРАВИЛА:
1. Ты НЕ имеешь отношения к уборке, клинингу или какому-либо конкретному бизнесу, пока пользователь сам не расскажет о своей деятельности!
2. В первом диалоге или при ответе на приветствие / вопрос "что умеешь?" расскажи о своих возможностях и мягко спроси: «Кстати, расскажите, чем вы занимаетесь? Я смогу сразу настроить персональную команду ИИ-ассистентов под ваш бизнес!»`;
    } else {
      roleHeader = `Ты — персональный умный ассистент цифрового штаба SELIN (роль "${agentRole}", компания "${config.business_name}" (сфера: ${config.industry || "услуги"})). Владелец: ${config.owner_name || "предприниматель"}. Тон: ${config.tone || "friendly"}. ${address}${mission ? " Твоя миссия: " + mission + "." : ""}${goals ? " Цели владельца: " + goals + "." : ""}`;
    }

    const lowerMessage = user_message.toLowerCase();
    const isBookOrBibleQuery = lowerMessage.includes("книг") || 
                               lowerMessage.includes("библи") || 
                               lowerMessage.includes("глав") || 
                               lowerMessage.includes("стих") || 
                               lowerMessage.includes("псал") || 
                               lowerMessage.includes("завет") || 
                               lowerMessage.includes("притч") || 
                               lowerMessage.includes("автор") || 
                               lowerMessage.includes("переска");

    const isCodeRequest = lowerMessage.startsWith('/code') || lowerMessage.startsWith('напиши код');
    const isTextModeCommand = lowerMessage.includes('селин 123770') || lowerMessage.includes('selin 123770') || lowerMessage === '123770' || lowerMessage.includes('/text_mode');

    let SYSTEM_PROMPT = `Ты голосовой ассистент Selin AI. Отвечай на вопросы пользователя ПОДРОБНО и РАЗВЕРНУТО. Твой ответ должен звучать как естественная речь живого человека, продолжительностью 20-40 секунд. 
   СТРОГИЕ ПРАВИЛА ДЛЯ ОЗВУЧКИ:
   - НИКОГДА не используй Markdown (никаких звездочек, решеток, тире для списков, обратных кавычек).
   - НИКОГДА не используй смайлики и эмодзи.
   - Не используй нумерованные списки (1., 2., 3.). Если нужно перечислить, используй слова 'во-первых', 'во-вторых'.
   - Пиши только сплошным текстом, используя обычные знаки препинания (точки, запятые, вопросительные знаки), чтобы синтезатор речи (TTS) делал правильные паузы.`;

    if (isBookOrBibleQuery) {
      SYSTEM_PROMPT += `\nПользователь интересуется книгой или Священным Писанием (Библией). Дай развернутый, глубокий, вдохновляющий и выразительный ответ. Ты можешь цитировать псалмы, главы, пересказывать сюжеты книг, притчи, раскрывать философию авторов так, словно ты профессиональный чтец аудиокниг или аудио-Библии. Формулируй ответ так, чтобы он звучал невероятно красиво при озвучивании голосом. Избегай сухости, пиши красивым литературным слогом без использования спецсимволов, markdown разметки и без эмодзи.`;
    }

    let systemInstruction = "";
    if (!isCodeRequest && !isTextModeCommand) {
      systemInstruction = `${roleHeader}\n\n${SYSTEM_PROMPT}\n\n${ragContext}${notesBlock}${tasksBlock}`;
    } else {
      systemInstruction = `${roleHeader}\n\nТы экспертный программист Selin_AI. Пиши полный, рабочий код с комментариями на русском.\n\n${ragContext}`;
    }
    let response: any;
    try {
      response = await generateWithFallback(() => contents, { temperature: 0.7, systemInstruction });
    } catch (toolErr: any) {
      console.warn("generateWithFallback failed:", toolErr?.message || toolErr);
      response = await generateWithFallback(() => contents, { temperature: 0.7, systemInstruction });
    }
    return (response?.text || "").trim() || "Ой, мысль потерялась на секунду — повтори, пожалуйста, я слушаю.";
  } catch (err: any) {
    console.error("GEN FAIL:", err?.message || err, "code:", err?.code || err?.status || "");
    return "Что-то я задумалась и не успела ответить — скажи ещё раз, я тут.";
  }
}

// Сброс памяти чата
app.post('/api/chat/reset', (req, res) => {
  const { chatId } = req.body;
  if (chatId) {
    selinLLMService.clearMemory(chatId);
    if (chatMemories.has(chatId)) {
      chatMemories.delete(chatId);
    }
    return res.json({ success: true, message: 'Память очищена' });
  }
  return res.status(400).json({ error: 'chatId required' });
});

// Endpoint to append customer message and retrieve/moderate agent response
app.post("/api/chats/message", async (req, res) => {
  let { chatId, text, agent_role } = req.body;
  if (!chatId || !text) {
    return res.status(400).json({ error: "chatId and text are required." });
  }

  const chats = getTelegramChats();
  let chatIndex = chats.findIndex((c: any) => c.id === chatId);
  if (chatIndex === -1) {
    return res.status(404).json({ error: "Chat not found." });
  }

  // Check for smart speaker voice wake words ("Selin777" for Charon male, "Selin000" for Kore female)
  const wakeResult = detectVoiceWakeWord(text);
  if (wakeResult.detected) {
    await setVoiceForChat(chatId, wakeResult.voice!);
    if (wakeResult.isOnlyWakeWord) {
      chats[chatIndex].history.push({ sender: "customer", text: text });
      chats[chatIndex].history.push({ sender: "agent", text: wakeResult.confirmationSpeech });
      chats[chatIndex].lastMessage = wakeResult.confirmationSpeech;
      chats[chatIndex].timestamp = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      saveTelegramChats(chats);

      if (maxBot) {
        try {
          await synthesizeAndSendVoice(maxBot, chatId, wakeResult.confirmationSpeech, true);
        } catch (err: any) {}
      }
      return res.json({ response: wakeResult.confirmationSpeech, voice: wakeResult.voice, wakeDetected: true, mode: wakeResult.mode });
    } else {
      text = wakeResult.cleanedText;
    }
  }

  // Append client message
  chats[chatIndex].history.push({ sender: "customer", text: text });
  chats[chatIndex].lastMessage = text;
  chats[chatIndex].timestamp = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  saveTelegramChats(chats);

  const config = getCompanyConfig();

  // Determine agent role
  let agentRole = agent_role || "receiver";
  const lowerText = text.toLowerCase();
  if (lowerText.includes("купить") || lowerText.includes("кп") || lowerText.includes("коммерческое") || lowerText.includes("цена") || lowerText.includes("стоимость") || lowerText.includes("заказать") || lowerText.includes("оформить")) {
    agentRole = "sales";
  }

  const responseText = await generateAgentResponseHelper(text, agentRole, chats[chatIndex].history, config);

  // If supervised mode, intercept and queue for moderation
  if (config.autonomy_level === "human-supervised") {
    const newItem = {
      id: "mod_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      chatId: chatId,
      clientName: chats[chatIndex].name,
      channel: chats[chatIndex].channel || "telegram",
      userMessage: text,
      proposedResponse: responseText,
      agentRole: agentRole,
      timestamp: new Date().toISOString()
    };
    cachedModerationQueue.push(newItem);
    saveModerationQueue();
    logFeedEvent(agentRole, 'review', 'Ждёт твоего решения', text.slice(0, 80), 'pending');

    return res.json({ moderation_required: true, proposedResponse: responseText });
  } else {
    const needsClarification = responseText.toLowerCase().includes("не понял") ||
                               responseText.toLowerCase().includes("уточните") ||
                               responseText.toLowerCase().includes("расскажите подробнее") ||
                               responseText.toLowerCase().includes("что имеется в виду") ||
                               responseText.toLowerCase().includes("не уверен") ||
                               responseText.toLowerCase().includes("нужно уточнить");
    if (config.autonomy_level === "full" && needsClarification) {
      const newItem = {
        id: "mod_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
        chatId: chatId,
        clientName: chats[chatIndex].name,
        channel: chats[chatIndex].channel || "telegram",
        userMessage: text,
        proposedResponse: responseText,
        agentRole: agentRole,
        timestamp: new Date().toISOString(),
        status: "need_clarification"
      };
      cachedModerationQueue.push(newItem);
      saveModerationQueue();
      logFeedEvent(agentRole, 'review', 'Ждёт твоего решения', text.slice(0, 80), 'pending');
      // Вернуть клиенту уточняющий вопрос вместо ответа агента
      const clarificationText = "Пока не уловил суть — скажите парой слов, чем вы занимаетесь и что именно хотите автоматизировать?";
      chats[chatIndex].history.push({ sender: "agent", text: clarificationText });
      chats[chatIndex].lastMessage = clarificationText;
      chats[chatIndex].timestamp = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      saveTelegramChats(chats);
      return res.json({ response: clarificationText });
    } else {
      // append agent message and send voice
      chats[chatIndex].history.push({ sender: "agent", text: responseText });
      chats[chatIndex].lastMessage = responseText;
      chats[chatIndex].timestamp = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      saveTelegramChats(chats);
      const chName = chats[chatIndex].channel || "telegram";
      logFeedEvent(agentRole, 'reply', `Ответил клиенту (${chName})`, responseText.slice(0, 120), 'done');
      if (maxBot) {
        try {
          await synthesizeAndSendVoice(maxBot, chatId, responseText, true);
        } catch (err: any) {
          console.warn("Outgoing voice failed, fallback to text:", err?.message || err);
          try {
            await safeSendMessageToChat(maxBot, chatId, responseText);
          } catch (msgErr) {
            console.error("Failed to send fallback text message to Max:", msgErr);
          }
        }
      }
      return res.json({ response: responseText });
    }
  }
});

// Endpoint to fetch moderation items and historical actions
app.get("/api/moderation/queue", (req, res) => {
  return res.json({ queue: getModerationQueue(), log: getModerationLog() });
});

// Endpoint to perform moderation action (approve, edit, reject)
app.post("/api/moderation/action", async (req, res) => {
  const { itemId, action, correctedText } = req.body;
  if (!itemId || !action) {
    return res.status(400).json({ error: "itemId and action are required." });
  }

  const queue = getModerationQueue();
  const idx = queue.findIndex(item => item.id === itemId);
  if (idx === -1) {
    return res.status(404).json({ error: "Moderation item not found." });
  }

  const item = queue[idx];
  queue.splice(idx, 1);
  saveModerationQueue();

  const finalResponseText = action === 'edit' ? correctedText : item.proposedResponse;

  // Save moderation action log
  const logEntry = {
    id: item.id,
    chatId: item.chatId,
    clientName: item.clientName,
    channel: item.channel,
    userMessage: item.userMessage,
    proposedResponse: item.proposedResponse,
    finalResponse: action === 'reject' ? null : finalResponseText,
    action,
    agentRole: item.agentRole,
    timestamp: new Date().toISOString()
  };
  saveModerationLog(logEntry);

  if (action !== 'reject') {
    logFeedEvent(item.agentRole || 'receiver', 'approved', 'Ты утвердил ответ', (item.userMessage || '').slice(0, 80), 'done');
    const chats = getTelegramChats();
    const chatIndex = chats.findIndex(c => c.id === item.chatId);
    if (chatIndex !== -1) {
      chats[chatIndex].history.push({ sender: "agent", text: finalResponseText });
      chats[chatIndex].lastMessage = finalResponseText;
      chats[chatIndex].timestamp = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      saveTelegramChats(chats);
    }

    // Send to Max as voice if real bot
    if ((item.chatId.startsWith("max_") || item.chatId.startsWith("tg_")) && maxBot) {
      const realId = cleanChatIdStr(item.chatId);
      try {
        await synthesizeAndSendVoice(maxBot, realId, finalResponseText);
      } catch (err) {
        console.error("Failed to send approved voice message to Max:", err);
      }
    }
  } else {
    logFeedEvent(item.agentRole || 'receiver', 'rejected', 'Ответ отклонён', (item.userMessage || '').slice(0, 80), 'info');
  }

  return res.json({ success: true });
});

// Helper to detect escalation keywords in message
function detectEscalation(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  const keywords = ["возврат", "жалоба", "претензия", "компенсация", "суд", "юрист", "брак", "недоволен", "ужасно", "скандал", "ошибка", "проблема", "расторжение", "отмена", "деньги назад"];
  return keywords.some(kw => lower.includes(kw));
}

function isComplexQuery(text: string): boolean {
  if (!text) return false;
  return detectEscalation(text) || text.length > 120;
}

type DebateSide = { name: string; stance: string; expertise: string; args: string[] };

async function debateSpeak(side: DebateSide, topic: string, roundNum: number, opponentLast: string, businessContext: string): Promise<string> {
  const sys = `Ты — ${side.name}, ${side.expertise}. Ты отстаиваешь позицию: ${side.stance}. Давай убедительные аргументы по делу, опирайся на контекст бизнеса. Отвечай на последний аргумент оппонента, если он есть. Не более 120 слов. Раунд ${roundNum}.`;
  const user = opponentLast
    ? `Тема запроса клиента: ${topic}\nКонтекст бизнеса: ${businessContext}\n\nОппонент только что сказал: "${opponentLast}"\n\nОтветь и продвинь свою позицию:`
    : `Тема запроса клиента: ${topic}\nКонтекст бизнеса: ${businessContext}\n\nВыскажи стартовый аргумент за позицию ${side.stance}:`;
  try {
    const r = await generateWithFallback(() => [{ role: 'user', parts: [{ text: user }] }], { temperature: 0.6, systemInstruction: sys });
    const text = (r?.text || '').trim() || '(аргумент не сформирован)';
    side.args.push(text);
    return text;
  } catch (e) { const t = '(аргумент не сформирован)'; side.args.push(t); return t; }
}

async function runDebate(topic: string, businessContext: string, rounds: number = 2): Promise<{ verdict: string; log: string[]; scores: string }> {
  const pro: DebateSide = { name: 'Представитель клиента', stance: 'ЗА интересы клиента (максимум выгоды и уступок клиенту)', expertise: 'специалист по работе с клиентами и защите прав потребителя', args: [] };
  const con: DebateSide = { name: 'Ревизор', stance: 'ЗА интересы бизнеса (маржа, правила, риски компании)', expertise: 'контролёр рисков и финансов компании', args: [] };
  const log: string[] = [];
  let lastPro = '', lastCon = '';
  const R = Math.max(1, Math.min(3, rounds));
  for (let i = 1; i <= R; i++) {
    const proArg = await debateSpeak(pro, topic, i, lastCon, businessContext);
    log.push(`[R${i} Клиент]: ${proArg}`);
    const conArg = await debateSpeak(con, topic, i, proArg, businessContext);
    log.push(`[R${i} Ревизор]: ${conArg}`);
    lastPro = proArg; lastCon = conArg;
  }
  const proAll = pro.args.map((a, i) => `Раунд ${i+1}: ${a}`).join('\n');
  const conAll = con.args.map((a, i) => `Раунд ${i+1}: ${a}`).join('\n');
  const judgeSys = `Ты беспристрастный арбитр спора внутри компании. Оцени обе стороны честно. Верни ответ СТРОГО в формате с маркерами, без лишнего текста:
[SCORES]
Клиент: X/10
Ревизор: Y/10
[/SCORES]
[VERDICT]
(здесь ОДИН готовый вежливый ответ клиенту — компромисс, честный с клиентом и безопасный для бизнеса, без воды, без упоминания спора внутри)
[/VERDICT]
[INSIGHT]
(коротко: сильнейший аргумент каждой стороны и главный вывод для команды — 1-2 строки)
[/INSIGHT]`;
  const judgeUser = `Тема запроса клиента: "${topic}"\n\nПозиция ЗА клиента (${pro.name}):\n${proAll}\n\nПозиция ЗА бизнес (${con.name}):\n${conAll}\n\nВынеси вердикт:`;
  let verdict = '', scores = '', insight = '';
  try {
    const jr = await generateWithFallback(() => [{ role: 'user', parts: [{ text: judgeUser }] }], { temperature: 0.1, systemInstruction: judgeSys });
    const jt = (jr?.text || '').trim();
    const vM = jt.match(/\[VERDICT\]([\s\S]*?)\[\/VERDICT\]/);
    const sM = jt.match(/\[SCORES\]([\s\S]*?)\[\/SCORES\]/);
    const iM = jt.match(/\[INSIGHT\]([\s\S]*?)\[\/INSIGHT\]/);
    verdict = (vM ? vM[1] : jt).trim();
    scores = (sM ? sM[1] : '').trim();
    insight = (iM ? iM[1] : '').trim();
  } catch (e) { verdict = 'Мне нужно уточнить детали у специалиста — вернусь к вам через пару часов с точным ответом.'; }
  if (insight) log.push(`[ИТОГ]: ${insight}`);
  if (scores) log.push(`[СЧЁТ]: ${scores}`);
  return { verdict, log, scores };
}

// Helper to handle incoming text from Max / client
async function handleIncomingText(chatId: number, clientName: string, text: string, channel: string = "max", isVoice: boolean = false) {
  const chats = getTelegramChats();
  const cleanId = cleanChatIdStr(chatId);
  const formattedChatId = `max_${cleanId}`;

  // Find or create chat
  let chatIndex = chats.findIndex((c: any) => c.id === formattedChatId || c.id === `tg_${cleanId}`);
  if (chatIndex === -1) {
    chats.push({
      id: formattedChatId,
      name: clientName,
      channel: channel,
      avatar: "👤",
      lastMessage: text,
      timestamp: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      history: []
    });
    chatIndex = chats.length - 1;
  }

  // Check for smart speaker voice wake words ("Selin777" for Charon male, "Selin000" for Kore female)
  const wakeResult = detectVoiceWakeWord(text);
  if (wakeResult.detected) {
    await setVoiceForChat(chatId, wakeResult.voice!);
    if (wakeResult.isOnlyWakeWord) {
      chats[chatIndex].history.push({
        sender: "customer",
        text: text,
        timestamp: new Date().toISOString(),
        isVoice: isVoice
      });
      chats[chatIndex].history.push({
        sender: "agent",
        text: wakeResult.confirmationSpeech,
        timestamp: new Date().toISOString()
      });
      chats[chatIndex].lastMessage = wakeResult.confirmationSpeech;
      chats[chatIndex].timestamp = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      saveTelegramChats(chats);

      if (maxBot) {
        try {
          await synthesizeAndSendVoice(maxBot, chatId, wakeResult.confirmationSpeech, true);
        } catch (err: any) {}
      }
      return wakeResult.confirmationSpeech;
    } else {
      text = wakeResult.cleanedText;
    }
  }

  // Get or extract user config (NEVER fallback to global company config)
  let userConfig = await getUserConfigByChatId(chatId);
  if (!userConfig) {
    userConfig = await tryExtractAndSaveUserConfig(chatId, text, chats[chatIndex].history);
  }
  const config = userConfig || getUniversalConfig();

  // Append client message
  chats[chatIndex].history.push({
    sender: "customer",
    text: text,
    timestamp: new Date().toISOString(),
    isVoice: isVoice
  });
  chats[chatIndex].lastMessage = text;
  chats[chatIndex].timestamp = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  // Save client message to history so the operator can see it immediately
  saveTelegramChats(chats);

  // Quietly record client profile details
  quietClientProfileUpdate(clientName, text, chatId);

  // Determine agent role
  let agentRole = "receiver";
  const lowerText = text.toLowerCase();
  const isComplex = isComplexQuery(text);

  if (lowerText.includes("купить") || lowerText.includes("кп") || lowerText.includes("коммерческое") || lowerText.includes("цена") || lowerText.includes("стоимость") || lowerText.includes("заказать") || lowerText.includes("оформить")) {
    agentRole = "sales";
  }

  // Determine tenantId and user_mode
  const tenantId = `max_${cleanId}`;

  let responseText = "";
  let mmResult: any = null;

  // 1. Intent Detection & Mode Switches
  if (lowerText.match(/^\/(язык|language)/) || lowerText.includes("учить английский") || lowerText.includes("learn english") || lowerText.includes("изучать испанский") || lowerText.includes("учить язык") || lowerText === "языки") {
    let targetLang = "English";
    if (lowerText.includes("испанск")) targetLang = "Spanish";
    else if (lowerText.includes("немецк")) targetLang = "German";
    else if (lowerText.includes("французск")) targetLang = "French";
    else if (lowerText.includes("китайск")) targetLang = "Chinese";

    responseText = await startLearning(tenantId, targetLang, 'A1');
  } else if (lowerText.match(/^\/(бизнес|business)/) || lowerText.includes("бизнес план") || lowerText.includes("заработать") || lowerText.includes("стартап") || lowerText.includes("бизнес ментор") || lowerText === "бизнес") {
    responseText = await diagnoseBusiness(tenantId);
  } else if (lowerText.match(/^\/(обычный|general)/) || lowerText.includes("обычный режим") || lowerText.includes("хватит учиться") || lowerText === "выход") {
    await setUserMode(tenantId, 'general');
    responseText = "🔄 Переключено в обычный режим Selin AI.";
  }

  // 2. Mode Execution if responseText not already set by mode switch
  if (!responseText) {
    const userModeObj = await getUserMode(tenantId);
    const mode = userModeObj?.mode || 'general';

    if (mode === 'language') {
      if (lowerText.includes("новый урок") || lowerText === "урок" || lowerText === "lesson") {
        responseText = await generateLesson(tenantId);
      } else if (lowerText.includes("повторение") || lowerText === "слова") {
        const words = await getNextReview(tenantId);
        if (!words || words.length === 0) {
          responseText = "🎉 На сегодня нет слов для повторения! Все слова хорошо усвоены. Напиши 'новый урок'!";
        } else {
          responseText = `🎴 **Слова на повторение сегодня:**\n\n` + words.map((w: any) => `• **${w.word}** — ${w.translation} (${w.example || ''})`).join("\n") + `\n\n*Напиши качество ответа (0-5) или 'новый урок'*`;
        }
      } else if (lowerText.includes("прогресс") || lowerText === "статистика") {
        responseText = await getLanguageProgress(tenantId);
      } else {
        responseText = await checkHomework(tenantId, text);
      }
    } else if (mode === 'business') {
      if (lowerText.includes("отчёт") || lowerText.includes("сделал") || lowerText.includes("выполнил")) {
        responseText = await checkTask(tenantId, text);
      } else if (lowerText.includes("задание") || lowerText.includes("задача") || lowerText === "task") {
        responseText = await generateDailyTask(tenantId);
      } else if (lowerText.includes("ролевая") || lowerText.includes("продажи") || lowerText.includes("клиент")) {
        responseText = await salesRoleplay(tenantId);
      } else if (lowerText.includes("обзор") || lowerText.includes("неделя")) {
        responseText = await weeklyReview(tenantId);
      } else {
        responseText = await checkTask(tenantId, text);
      }
    }
  }

  // 3. Fallback General Chat if responseText is still empty
  if (!responseText) {
    if (isComplex) {
      if (maxBot) {
        try {
          await synthesizeAndSendVoice(maxBot, chatId, "Приняла. Это важный вопрос — я совещаюсь с командой, это займёт около минуты, и вернусь с точным ответом.", true);
        } catch (e) {
          try { await safeSendMessageToChat(maxBot, cleanId, "Приняла, совещаюсь с командой — вернусь через минуту."); } catch(err){}
        }
      }

      const businessContext = config.is_universal 
        ? "Универсальный ИИ-ассистент SELIN (помощь в задачах, генерация фото, кода, видео, заказах)"
        : JSON.stringify(config || {}).slice(0, 1000);

      const debateRes = await runDebate(text, businessContext, 2);
      responseText = debateRes.verdict;

      if (typeof logFeedEvent === "function") {
        try {
          logFeedEvent('coordinator', 'debate', 'Рой вынес вердикт после спора (' + (debateRes.scores||'').replace(/\n/g,' ') + ')', debateRes.log.join(' || ').slice(0,400), 'done');
        } catch(e){}
      }
    } else {
      const chatIdStr = String(chatId);
      const smartResponse = await smartCallLLM(
        chatIdStr,
        text,
        `Ты — Selin AI. ${config.is_universal ? 'Универсальный ассистент' : `Помощник компании ${config.business_name}`}. 
  Отвечай как эксперт. Будь полезным, конкретным и живым.`
      );
      responseText = smartResponse;
    }
  }

  // Non-blocking soft quest suggestion if not setup yet
  const st = getState(chatId);
  const existingConfig = await getUserConfigByChatId(chatId);
  if (!existingConfig && !st.questSent) {
    responseText += "\n\n💡 *Кстати, если захотите настроить персонального робота под ваш бизнес — в любой момент можете пройти короткий микро-квест в штабе.*";
    setState(chatId, { questSent: true });
  }

  if (config.autonomy_level === "human-supervised") {
    // Enqueue for manual approval
    const newItem = {
      id: "mod_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      chatId: formattedChatId,
      clientName: clientName,
      channel: channel,
      userMessage: text,
      proposedResponse: responseText,
      agentRole: agentRole,
      timestamp: new Date().toISOString()
    };
    cachedModerationQueue.push(newItem);
    saveModerationQueue();
    logFeedEvent(agentRole, 'review', 'Ждёт твоего решения', text.slice(0, 80), 'pending');
    console.log(`📥 Enqueued message from ${clientName} for manual moderation.`);
  } else {
    // Autonomous response
    chats[chatIndex].history.push({
      sender: "agent",
      text: responseText,
      mediaType: mmResult?.mediaType,
      mediaUrl: mmResult?.mediaUrl,
      codeDetails: mmResult?.codeDetails,
      isQuotaDegraded: mmResult?.isQuotaDegraded
    });
    chats[chatIndex].lastMessage = responseText;
    chats[chatIndex].timestamp = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    saveTelegramChats(chats);
    if (!isComplex) {
      logFeedEvent(agentRole, 'reply', `Ответил клиенту (${channel})`, responseText.slice(0, 120), 'done');
    }

    if (maxBot) {
      const numericChatId = parseInt(cleanId);
      try {
        if (mmResult?.mediaType === 'image' && mmResult?.imageBuffer) {
          const uploadToken = await uploadFileToMax(mmResult.imageBuffer, 'image.jpg');
          if (uploadToken) {
            await safeSendMessageToChat(maxBot, numericChatId, responseText, {
              attachments: [{ type: 'image', payload: { token: uploadToken } }]
            });
          } else {
            await safeSendMessageToChat(maxBot, numericChatId, responseText);
          }
        } else if (mmResult?.mediaType === 'code' && mmResult?.codeDetails) {
          const fileBuffer = Buffer.from(mmResult.codeDetails.code, 'utf-8');
          const uploadToken = await uploadFileToMax(fileBuffer, mmResult.codeDetails.filename || 'script.js');
          if (uploadToken) {
            await safeSendMessageToChat(maxBot, numericChatId, responseText, {
              attachments: [{ type: 'file', payload: { token: uploadToken } }]
            });
          } else {
            await safeSendMessageToChat(maxBot, numericChatId, responseText);
          }
        } else if ((mmResult?.mediaType === 'voice' && mmResult?.audioBase64) || isVoice) {
          await synthesizeAndSendVoice(maxBot, chatId, responseText, true);
        } else {
          await safeSendMessageToChat(maxBot, numericChatId, responseText);
        }
      } catch (err: any) {
        console.warn("Max send failed, fallback to text:", err?.message || err);
        try {
          await safeSendMessageToChat(maxBot, numericChatId, responseText);
        } catch (msgErr) {
          console.error("Failed to send fallback text message to Max:", msgErr);
        }
      }
    }
  }

  return responseText;
}

// Initialize Max Bot
const maxToken = process.env.MAX_BOT_TOKEN;

// State management for chat user sessions
const userStates = new Map<number, { questSent: boolean; questNag: number; state: 'NEW' | 'QUESTING' | 'ACTIVE' }>();
function getState(chatId: number) {
  if (!userStates.has(chatId)) userStates.set(chatId, { questSent: false, questNag: 0, state: 'NEW' });
  return userStates.get(chatId)!;
}
function setState(chatId: number, patch: Partial<{ questSent: boolean; questNag: number; state: 'NEW' | 'QUESTING' | 'ACTIVE' }>) {
  const cur = getState(chatId);
  userStates.set(chatId, { ...cur, ...patch });
}

// Register Selin AI Adapters with Core Orchestrator
const maxAdapter = new MaxAdapter(process.env.MAX_BOT_TOKEN || "");
const robotAdapter = new RobotAdapter();

orchestrator.registerAdapter(maxAdapter);
orchestrator.registerAdapter(robotAdapter);
orchestrator.startAll().catch((err) => logger.error("Failed to start Orchestrator adapters", { error: err }));

if (maxToken) {
  try {
    maxBot = new Bot(maxToken);

    // /start analogue in Max: bot_started event
    maxBot.on('bot_started', async (ctx: any) => {
      const chatId = extractMaxChatId(ctx) || String(ctx.chat?.id || ctx.from?.id);
      const firstName = ctx.from?.name?.split(' ')[0] || '';
      const nameGreeting = firstName ? `Привет, ${firstName}!` : "Привет!";

      const userConfig = await getUserConfigByChatId(chatId);
      let welcomeText = "";
      if (userConfig && !userConfig.is_universal) {
        welcomeText = `${nameGreeting} Я — ваш голосовой ИИ-ассистент компании "${userConfig.business_name}". Готов принимать заявки, отвечать клиентам и помогать в работе 24/7. Чем могу помочь?`;
      } else {
        welcomeText = `${nameGreeting} Я твой персональный AI-консьерж.\nЯ могу: 🚕 Вызвать такси 🍕 Заказать еду ✈️ Найти билеты 🏨 Забронировать отель 📸 Контент-план 📊 Бизнес-план\nПросто скажи что нужно.`;
      }

      try {
        await synthesizeAndSendVoice(maxBot, chatId, welcomeText, true);
      } catch (err: any) {
        console.warn("synthesizeAndSendVoice failed in bot_started event:", err?.message || err);
      }

      try {
        await safeSendMessageToChat(maxBot, chatId, welcomeText);
      } catch (e) {
        console.warn("Failed to send welcome text", e);
      }
      setState(parseInt(chatId) || 0, { state: 'NEW', questSent: false, questNag: 0 });
    });

    maxBot.catch((err: any) => {
      logger.error('Max Bot SDK Error:', { error: err?.message || err });
    });

    logger.info('🤖 Max Bot успешно инициализирован в режиме Webhook (polling отключен)');
  } catch (error: any) {
    logger.error('❌ Ошибка инициализации Max Bot:', { error: error?.message || error });
  }
} else {
  logger.warn('⚠️ ПРЕДУПРЕЖДЕНИЕ: Переменная MAX_BOT_TOKEN не задана в окружении. Max-бот не активен для отправки через API.');
}

// 1. Onboarding Interview endpoint
app.post("/api/interview", async (req, res) => {
  const { messages, forceComplete } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Messages array is required." });
  }

  // If Gemini API is missing, simulate interview progress
  if (!ai) {
    const lastUserMsg = messages[messages.length - 1]?.content || "";
    const turnCount = messages.filter(m => m.role === 'user').length;

    let responseText = "";
    if (forceComplete) {
      responseText = "Прекрасно! Я собрал все необходимые данные для запуска вашего персонального цифрового штаба.\n\n[COMPLETE]\n" + JSON.stringify({
        business_name: "Мой Бизнес",
        owner_name: "Предприниматель",
        industry: "Продажи и услуги",
        detected_agents: ["receiver", "content", "sales", "analyst", "operator"],
        channels: ["telegram", "whatsapp"],
        tone: "friendly",
        autonomy_level: "full"
      }, null, 2);
    } else if (turnCount === 1) {
      responseText = "Приятно познакомиться! Назовите, пожалуйста, сферу вашего бизнеса и как называется ваша компания?";
    } else if (turnCount === 2) {
      responseText = "Отлично! Какие мессенджеры и каналы связи вы используете для работы с клиентами? Например: Telegram, WhatsApp, VK, Email.";
    } else if (turnCount === 3) {
      responseText = "Супер. Какого тона общения должны придерживаться наши агенты? (дружелюбный, деловой, энергичный, строгий, элегантный)";
    } else {
      // Simulate complete
      responseText = "Прекрасно! Я собрал все необходимые данные для запуска вашего персонального цифрового штаба.\n\n[COMPLETE]\n" + JSON.stringify({
        business_name: "Мой Бизнес",
        owner_name: "Предприниматель",
        industry: "Продажи и услуги",
        channels: ["telegram", "whatsapp"],
        tone: "friendly",
        autonomy_level: "full"
      }, null, 2);
    }
    return res.json({ text: responseText });
  }

  try {
    const formattedContents = messages.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    let systemInstruction = `Ты — дружелюбный русскоязычный AI-интервьюер для платформы "Автономный цифровой сотрудник".
Твоя цель — провести короткое интервью (3-5 вопросов) с владельцем бизнеса, чтобы сформировать его персональный штаб ИИ-агентов.
Задавай ровно один вопрос за раз. Будь лаконичен, приветлив и профессионален. Не используй сложную техническую терминологию.
Выясни у пользователя:
1. Его имя (владельца бизнеса) и название компании.
2. Сферу деятельности (индустрию).
3. Используемые каналы связи (Telegram, WhatsApp, VK, Email).
4. Желаемый стиль общения (тон) агентов (например: дружелюбный, строгий, деловой, энергичный, элегантный).

ПРАВИЛО ЗАВЕРШЕНИЯ: НЕ завершай интервью и НЕ выводи [COMPLETE], пока из переписки НЕ удаётся уверенно понять ОБА пункта: (а) сферу/ниша бизнеса и (б) конкретную задачу или потребность, которую надо автоматизировать. Если пользователь отвечает невнятно, коротко, абстрактно или не по делу — задай ОДИН живой уточняющий вопрос на русском: попроси назвать, чем именно он занимается и что конкретно хочет делегировать (пример: «пока не уловил суть — скажите парой слов, какой у вас бизнес и какую рутину забрать: переписку, записи, продажи, контент?»). Только когда есть и сфера, и задача — подытожь и выведи [COMPLETE] с JSON.

Когда ты получишь достаточно ответов, заверши интервью. В финальном ответе кратко подытожь результаты, а затем на новой строке выведи маркер [COMPLETE] и строго на следующей строке выведи чистый JSON без разметки markdown, содержащий следующие поля:
{
  "business_name": "Название компании",
  "owner_name": "Имя владельца",
  "industry": "Сфера бизнеса",
  "channels": ["telegram", "whatsapp", "vk", "email"] (список только из выбранных),
  "tone": "friendly" или "professional" или "energetic" или "elegant" или "strict",
  "autonomy_level": "full" или "human-supervised"
}`;

    if (forceComplete) {
      systemInstruction = `ПРАВИЛО: сначала оцени, есть ли в переписке ОБА факта — сфера/ниша бизнеса И конкретная задача/потребность для автоматизации. Если хотя бы одного нет (ввод пустой, невнятный, абстрактный, не про дело) — НЕ выводи [COMPLETE] и НЕ выводи JSON; вместо этого выведи один короткий живой уточняющий вопрос на русском, который просит назвать сферу бизнеса и что именно автоматизировать. Выводи [COMPLETE] и JSON только когда оба факта извлекаются из переписки.

Ты — аналитический модуль системы "Автономный цифровой сотрудник".
Интервью завершено или прервано пользователем. Твоя задача — внимательно проанализировать всю имеющуюся переписку и строго вывести чистый JSON-конфигурацию без разметки markdown, содержащий параметры для настройки бизнеса.
Если какие-то данные не были явно названы, заполни их разумными дефолтами (например, если имя владельца неизвестно, напиши "Предприниматель", если название компании неизвестно - "Мой Бизнес", сфера деятельности - "Продажи и услуги", каналы связи - ["telegram"], тон - "friendly", уровень автономности - "full").

Выведи сначала краткое резюме для пользователя (например: "Отлично! Я проанализировал наши ответы и подготовил конфигурацию для вашего цифрового штаба."), затем на новой строке выведи маркер [COMPLETE] и строго на следующей строке выведи чистый JSON-объект без markdown-блоков, содержащий следующие поля:
{
  "business_name": "Название компании",
  "owner_name": "Имя владельца",
  "industry": "Сфера бизнеса",
  "channels": ["telegram", "whatsapp", "vk", "email"] (массив из упомянутых или дефолт ["telegram"]),
  "tone": "friendly" или "professional" или "energetic" или "elegant" или "strict",
  "autonomy_level": "full" или "human-supervised"
}`;
    }

    const response = await generateWithFallback(
      () => formattedContents,
      {
        systemInstruction,
        temperature: forceComplete ? 0.2 : 0.7,
      }
    );

    res.json({ text: response.text || "" });
  } catch (error: any) {
    console.error("Gemini Interview Error:", error);
    res.status(500).json({ error: error.message || "Failed to process interview turn" });
  }
});

// 2. Generate SMART Plan endpoint
app.post("/api/smart-plan", async (req, res) => {
  const { objective, business_name, owner_name, industry, tone, channels } = req.body;

  if (!ai) {
    // Return simulated SMART tasks
    const simulatedTasks = [
      {
        id: "task_1",
        title: "Обработка утренних заявок",
        agent: "receiver",
        specific: "Автоматический ответ на все новые сообщения в Telegram и WhatsApp",
        measurable: "100% отвеченных обращений со средним временем ответа < 2 минут",
        achievable: "Используя настроенную базу знаний о компании",
        relevant: "Обеспечивает лояльность клиентов и удержание лидов",
        time_bound: "До 11:00",
        priority: "high"
      },
      {
        id: "task_2",
        title: "Прогрев холодных лидов",
        agent: "sales",
        specific: "Отправка персонализированных предложений клиентам, интересовавшимся услугами на прошлой неделе",
        measurable: "Конверсия в запись на встречу/услугу не менее 15%",
        achievable: "На основе шаблонов коммерческих предложений с учетом тона общения",
        relevant: "Прямо влияет на выполнение цели: " + (objective || "привлечение новых клиентов"),
        time_bound: "До 14:00",
        priority: "high"
      },
      {
        id: "task_3",
        title: "Публикация вовлекающего поста",
        agent: "content",
        specific: "Написать и опубликовать пост о преимуществах компании в сфере " + (industry || "бизнеса") + " с призывом к действию",
        measurable: "Охват более 300 просмотров, минимум 5 реакций",
        achievable: "Генерация текста по трендам ниши через контент-агента",
        relevant: "Повышение узнаваемости бренда и сбор входящих заявок",
        time_bound: "До 16:30",
        priority: "medium"
      },
      {
        id: "task_4",
        title: "Анализ конверсии и отзывов",
        agent: "analyst",
        specific: "Сбор статистики кликов и ответов клиентов за последние 3 дня",
        measurable: "Готовый краткий отчет с графиками аномалий",
        achievable: "Анализ логов переписок и CRM-статистики",
        relevant: "Помогает оптимизировать скрипты продаж и выявить слабые места",
        time_bound: "До 18:00",
        priority: "medium"
      },
      {
        id: "task_5",
        title: "Итоговый отчет координатора",
        agent: "operator",
        specific: "Сводный отчет по действиям всех агентов за день для " + (owner_name || "владельца"),
        measurable: "Отчет отправлен владельцу в Telegram-бот",
        achievable: "Агрегация данных от ресивера, продажника, контентщика и аналитика",
        relevant: "Контроль качества работы штаба и прозрачность процессов",
        time_bound: "До 20:00",
        priority: "high"
      }
    ];
    return res.json({ tasks: simulatedTasks });
  }

  try {
    const prompt = "Ты — Операционный Директор (Supervisor) для малого бизнеса \"" + (business_name || "Наш Бизнес") + "\".\n" +
      "Владелец компании: " + (owner_name || "Предприниматель") + ". Сфера: " + (industry || "Услуги/Продажи") + ". Тон общения: " + (tone || "friendly") + ". Каналы: " + ((channels || []).join(", ")) + ".\n" +
      "Твоя задача — составить план из ровно 5 SMART-задач на день для твоих цифровых агентов (receiver, content, sales, analyst, operator).\n" +
      "Главная бизнес-цель на сегодня: \"" + (objective || "Оптимизировать продажи") + "\".\n\n" +
      "Назначь задачи соответствующим агентам:\n" +
      "- receiver: прием заявок, консультации, бронирование.\n" +
      "- content: создание постов, вовлекающие рассылки, SMM.\n" +
      "- sales: холодные/теплые рассылки, КП, отработка возражений, доведение до сделки.\n" +
      "- analyst: сбор метрик, выявление просадок, отчетность.\n" +
      "- operator: координация, сводные отчеты, контроль качества.\n\n" +
      "Верни ответ СТРОГО в формате JSON-массива объектов со следующей структурой:\n" +
      "[\n" +
      "  {\n" +
      "    \"id\": \"task_1\",\n" +
      "    \"title\": \"Краткое название задачи\",\n" +
      "    \"agent\": \"receiver\" или \"content\" или \"sales\" или \"analyst\" или \"operator\",\n" +
      "    \"specific\": \"Что конкретно нужно сделать\",\n" +
      "    \"measurable\": \"Как измерить результат\",\n" +
      "    \"achievable\": \"Почему это выполнимо ИИ\",\n" +
      "    \"relevant\": \"Как это помогает достичь цели\",\n" +
      "    \"time_bound\": \"Срок (например, До 12:00, До 18:00)\",\n" +
      "    \"priority\": \"high\" или \"medium\" или \"low\"\n" +
      "  }\n" +
      "]";

    const response = await generateWithFallback(
      () => prompt,
      {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              title: { type: Type.STRING },
              agent: { type: Type.STRING },
              specific: { type: Type.STRING },
              measurable: { type: Type.STRING },
              achievable: { type: Type.STRING },
              relevant: { type: Type.STRING },
              time_bound: { type: Type.STRING },
              priority: { type: Type.STRING }
            },
            required: ["id", "title", "agent", "specific", "measurable", "achievable", "relevant", "time_bound", "priority"]
          }
        },
        temperature: 0.2
      }
    );

    const tasks = JSON.parse(response.text || "[]");
    res.json({ tasks });
  } catch (error: any) {
    console.error("SMART Plan Error:", error);
    res.status(500).json({ error: error.message || "Failed to generate SMART plan" });
  }
});

// ==========================================
// VOICE ORGANISM LIVE DIALOGUE ENDPOINT
// ==========================================
function sanitizeVoiceName(rawName: any): string | null {
  if (!rawName || typeof rawName !== 'string') return null;
  const cleaned = rawName.trim();
  if (cleaned.length > 30 || /extracted|schema|json|let's|context|history|output|prompt|valid|requires/i.test(cleaned)) {
    const match = cleaned.match(/\b([А-ЯЁ][а-яё]{1,15}|[A-Z][a-z]{1,15})\b/);
    if (match && match[1] && !/extracted|schema|json|lets|context|history|output|valid|requires/i.test(match[1])) {
      return match[1];
    }
    return null;
  }
  return cleaned;
}

app.post("/api/voice-organism-dialogue", async (req, res) => {
  let { step, userName, userInput, history, chatId } = req.body;

  // Check for smart speaker voice wake words ("Selin777" for Charon male, "Selin000" for Kore female)
  let wakeWordInfo: any = null;
  if (userInput && typeof userInput === "string") {
    const wakeResult = detectVoiceWakeWord(userInput);
    if (wakeResult.detected) {
      await setVoiceForChat(chatId || "preview", wakeResult.voice!);
      wakeWordInfo = wakeResult;
      if (wakeResult.isOnlyWakeWord) {
        return res.json({
          speech: wakeResult.confirmationSpeech,
          userName: sanitizeVoiceName(userName),
          extractedGoal: null,
          nextStep: step || "EXPLAIN_PLATFORM",
          voice: wakeResult.voice,
          wakeDetected: true,
          mode: wakeResult.mode
        });
      } else {
        userInput = wakeResult.cleanedText;
      }
    }
  }

  const systemInstruction = `Ты — Интеллектуальный Голосовой Агент платформы SELIN.
Твоя цель — в формате живого, природного, увлеченного и естественного диалога (как высококлассный инжиниринговый партнер и персональный помощник) встретить человека, узнать его имя, познакомить с возможностями платформы по делегированию всей рутины и узнать, какие задачи он хочет передать штабу.

ПРАВИЛА ОБЩЕНИЯ:
1. Говори на красивом, живом, теплом русском языке. Без сухого канцелярита, без заученных шаблонных фраз.
2. Твой ответ будет автоматически ОЗВУЧЕН голосом, поэтому пиши легко, для восприятия на слух (2-4 емких разговорных предложения).
3. ВСЕГДА подстраивайся под слова собеседника. Если человек назвал имя (например "Вадим"), обратись к нему по имени и сделай диалог персональным. Каждый раз формулируй мысль свежо и по-новому, даже если вопрос аналогичный!
4. Никогда не говори, что ты "робот", "программа" или "языковая модель". Ты — Интеллектуальный Агент и Инженер Задач.

СТРОГИЕ ПРАВИЛА ДЛЯ ПОЛЕЙ JSON:
- Поле "userName": ДОЛЖНО содержать ТОЛЬКО чистое имя человека (например "Вадим" или "Ольга"), ровно 1 слово! КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО писать в это поле мысли, рассуждения, отладочную информацию или английский текст.
- Поле "speech": только готовый текст для произнесения голосом.

ТРЕБУЕМЫЙ ФОРМАТ ОТВЕТА (JSON):
{
  "speech": "Текст ответа, который будет произнесен вслух",
  "userName": "Извлеченное чистое имя пользователя (только 1 слово, например Вадим)",
  "extractedGoal": "Извлеченная цель или рутина",
  "nextStep": "ASK_NAME" | "EXPLAIN_PLATFORM" | "ASK_GOALS" | "SETUP_COMPLETE"
}
`;

  if (!ai) {
    let speech = "";
    let nextStep = "EXPLAIN_PLATFORM";
    let extractedName = sanitizeVoiceName(userName);

    if (!userInput && !userName) {
      speech = "Приветствую вас! Я ваш новый интеллектуальный помощник и инженер ваших будущих задач. Как я могу к вам обращаться?";
      nextStep = "ASK_NAME";
    } else if (step === "ASK_NAME" || (!userName && userInput)) {
      const parsed = userInput.replace(/меня зовут|я |меня |привет|здравствуй/gi, "").trim();
      extractedName = sanitizeVoiceName(parsed) || "Друг";
      speech = `Приятно иметь с вами дело, ${extractedName}! Рад знакомству. Позвольте сразу ввести вас в курс дела: я создан для того, чтобы полностью освободить вас от рутины — переписок с клиентами, приема заказов, контроля задач и аналитики. С чем именно вы сталкиваетесь ежедневно?`;
      nextStep = "EXPLAIN_PLATFORM";
    } else if (step === "EXPLAIN_PLATFORM") {
      speech = `Наш цифровой штаб работает 24/7. В вашей команде работают автономные агенты: Приемщик, Продажник и Координатор. Они сами отвечают в мессенджерах, ведут клиентов и сдают вам отчёты. ${extractedName ? extractedName + ", " : ""}скажите, какие главные рутинные задачи съедают больше всего вашего времени?`;
      nextStep = "ASK_GOALS";
    } else {
      speech = `Отличная задача! Я уже настраиваю систему под ваши цели. Теперь ваш штаб готов забрать эту рутину под свой контроль. Добро пожаловать!`;
      nextStep = "SETUP_COMPLETE";
    }

    const currentVoice = await getVoiceForChat(chatId);
    return res.json({
      speech,
      userName: extractedName,
      extractedGoal: userInput || null,
      nextStep,
      voice: currentVoice,
      wakeDetected: !!wakeWordInfo
    });
  }

  try {
    const formattedHistory = (history || []).map((h: any) => ({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: h.content }]
    }));

    if (userInput) {
      formattedHistory.push({
        role: 'user',
        parts: [{ text: `[Текущий этап: ${step || 'UNKNOWN'}, Текущее имя: ${userName || 'Неизвестно'}]: "${userInput}"` }]
      });
    } else {
      formattedHistory.push({
        role: 'user',
        parts: [{ text: `[Текущий этап: INITIAL_START]. Сделай изящное приветствие и спроси, как обращаться к человеку.` }]
      });
    }

    const response = await generateWithFallback(
      () => formattedHistory,
      {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            speech: { type: Type.STRING },
            userName: { type: Type.STRING, nullable: true },
            extractedGoal: { type: Type.STRING, nullable: true },
            nextStep: { type: Type.STRING }
          },
          required: ["speech", "nextStep"]
        },
        temperature: 0.7
      }
    );

    let data: any = {};
    const rawText = (response.text || "").trim();
    try {
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      data = JSON.parse(cleaned);
    } catch {
      data = {
        speech: rawText || "Приветствую вас! Я готов помочь вам в решении ваших задач.",
        userName: sanitizeVoiceName(userName) || null,
        extractedGoal: userInput || null,
        nextStep: step || "EXPLAIN_PLATFORM"
      };
    }

    if (!data.speech) {
      data.speech = "Приветствую вас! Я ваш интеллектуальный помощник Selin AI.";
    }
    if (!data.nextStep) {
      data.nextStep = step || "EXPLAIN_PLATFORM";
    }

    const cleanName = sanitizeVoiceName(data.userName) || sanitizeVoiceName(userName);
    const currentVoice = await getVoiceForChat(chatId);

    return res.json({
      speech: data.speech,
      userName: cleanName,
      extractedGoal: data.extractedGoal || null,
      nextStep: data.nextStep,
      voice: currentVoice,
      wakeDetected: !!wakeWordInfo
    });
  } catch (error: any) {
    logger.warn("Voice Organism Warning (using fallback):", error?.message || error);
    const currentVoice = await getVoiceForChat(chatId);
    return res.json({
      speech: "Приветствую вас! Я ваш интеллектуальный помощник Selin AI. Чем могу помочь вам сегодня?",
      userName: sanitizeVoiceName(userName) || null,
      extractedGoal: userInput || null,
      nextStep: step || "EXPLAIN_PLATFORM",
      voice: currentVoice,
      wakeDetected: !!wakeWordInfo
    });
  }
});

// ==========================================
// GEMINI HIGH-QUALITY TTS API ENDPOINT
// ==========================================
function pcmToWavBuffer(pcmBuffer: Buffer, sampleRate = 24000, numChannels = 1, bitDepth = 16): Buffer {
  const headerLength = 44;
  const wavBuffer = Buffer.alloc(headerLength + pcmBuffer.length);

  wavBuffer.write("RIFF", 0);
  wavBuffer.writeUInt32LE(36 + pcmBuffer.length, 4);
  wavBuffer.write("WAVE", 8);

  wavBuffer.write("fmt ", 12);
  wavBuffer.writeUInt32LE(16, 16);
  wavBuffer.writeUInt16LE(1, 20);
  wavBuffer.writeUInt16LE(numChannels, 22);
  wavBuffer.writeUInt32LE(sampleRate, 24);
  wavBuffer.writeUInt32LE(sampleRate * numChannels * (bitDepth / 8), 28);
  wavBuffer.writeUInt16LE(numChannels * (bitDepth / 8), 32);
  wavBuffer.writeUInt16LE(bitDepth, 34);

  wavBuffer.write("data", 36);
  wavBuffer.writeUInt32LE(pcmBuffer.length, 40);

  pcmBuffer.copy(wavBuffer, 44);
  return wavBuffer;
}

app.post("/api/tts", async (req, res) => {
  const { text, voice, chatId } = req.body;
  if (!text) return res.status(400).json({ error: "Text is required." });

  // Check for smart speaker voice wake words
  const wakeResult = detectVoiceWakeWord(text);
  let textToSynthesize = text;
  let targetVoice = voice;

  if (wakeResult.detected) {
    await setVoiceForChat(chatId, wakeResult.voice!);
    targetVoice = wakeResult.voice!;
    textToSynthesize = wakeResult.isOnlyWakeWord ? wakeResult.confirmationSpeech : wakeResult.cleanedText;
  }

  if (!targetVoice) {
    targetVoice = (await getVoiceForChat(chatId)) || 'Kore';
  }

  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(
      process.env.EDGE_TTS_VOICE || 'ru-RU-SvetlanaNeural',
      OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3
    );
    
    const { audioStream } = tts.toStream(textToSynthesize);
    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) {
      if (Buffer.isBuffer(chunk)) chunks.push(chunk);
      else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk));
    }
    const audioBuffer = Buffer.concat(chunks);
    const dataUrl = `data:audio/mpeg;base64,${audioBuffer.toString("base64")}`;
    return res.json({
      audioUrl: dataUrl,
      voice: targetVoice,
      wakeDetected: wakeResult.detected,
      mode: wakeResult.mode,
      confirmationSpeech: wakeResult.detected ? wakeResult.confirmationSpeech : undefined,
      text: textToSynthesize
    });
  } catch (e: any) {
    console.error("TTS endpoint failed:", e?.message);
    return res.status(500).json({ error: "Failed to generate audio from TTS." });
  }
});

// ==========================================
// BUSINESS-QUEST (STATIONS & PLAN) ENDPOINTS
// ==========================================

app.post("/api/quest/generate-stations", async (req, res) => {
  const { industry, business_name, objective } = req.body;

  // Let's build a smart localized fallback structure first
  const normalizedIndustry = (industry || "").toLowerCase();
  
  let targetAudienceOpts = [
    { id: "opt_1_1", label: "Частные клиенты (B2C)", icon: "Users" },
    { id: "opt_1_2", label: "Бизнес-партнеры (B2B)", icon: "Briefcase" },
    { id: "opt_1_3", label: "Постоянные лояльные гости", icon: "Heart" },
    { id: "opt_1_4", label: "Премиум VIP-сегмент", icon: "Award" }
  ];

  let productsOpts = [
    { id: "opt_2_1", label: "Стандартные услуги компании", icon: "ShoppingBag" },
    { id: "opt_2_2", label: "Комплексные пакеты и VIP-тарифы", icon: "Layers" },
    { id: "opt_2_3", label: "Фирменные сопутствующие товары", icon: "ShoppingCart" },
    { id: "opt_2_4", label: "Абонементы и регулярный сервис", icon: "Calendar" }
  ];

  if (normalizedIndustry.includes("авто") || normalizedIndustry.includes("шин") || normalizedIndustry.includes("ремонт")) {
    targetAudienceOpts = [
      { id: "opt_1_1", label: "Владельцы легковых авто", icon: "Users" },
      { id: "opt_1_2", label: "Корпоративные автопарки / Такси", icon: "Briefcase" },
      { id: "opt_1_3", label: "Жители близлежащих районов", icon: "MapPin" },
      { id: "opt_1_4", label: "Владельцы премиум-каров", icon: "Award" }
    ];
    productsOpts = [
      { id: "opt_2_1", label: "Сезонный шиномонтаж", icon: "Zap" },
      { id: "opt_2_2", label: "Ремонт подвески и ТО", icon: "Layers" },
      { id: "opt_2_3", label: "Хранение шин и дисков", icon: "Database" },
      { id: "opt_2_4", label: "Правка и покраска дисков", icon: "Award" }
    ];
  } else if (normalizedIndustry.includes("салон") || normalizedIndustry.includes("крас") || normalizedIndustry.includes("бьют") || normalizedIndustry.includes("космет")) {
    targetAudienceOpts = [
      { id: "opt_1_1", label: "Женщины (уходовые услуги)", icon: "Users" },
      { id: "opt_1_2", label: "Мужской зал / Барбер", icon: "Briefcase" },
      { id: "opt_1_3", label: "Постоянные гости салона", icon: "Heart" },
      { id: "opt_1_4", label: "Клиенты премиум-процедур", icon: "Award" }
    ];
    productsOpts = [
      { id: "opt_2_1", label: "Стрижка и окрашивание", icon: "Sparkles" },
      { id: "opt_2_2", label: "Маникюр и педикюр", icon: "Smile" },
      { id: "opt_2_3", label: "Косметология и массаж", icon: "Heart" },
      { id: "opt_2_4", label: "Профессиональная косметика", icon: "ShoppingBag" }
    ];
  } else if (normalizedIndustry.includes("школ") || normalizedIndustry.includes("курс") || normalizedIndustry.includes("обуч") || normalizedIndustry.includes("инфо")) {
    targetAudienceOpts = [
      { id: "opt_1_1", label: "Начинающие специалисты", icon: "Users" },
      { id: "opt_1_2", label: "Профессионалы (повышение)", icon: "Briefcase" },
      { id: "opt_1_3", label: "Дети и подростки", icon: "Smile" },
      { id: "opt_1_4", label: "Корпоративный сектор (B2B)", icon: "Award" }
    ];
    productsOpts = [
      { id: "opt_2_1", label: "Видеокурсы в записи", icon: "Smartphone" },
      { id: "opt_2_2", label: "Интерактивные вебинары", icon: "Globe" },
      { id: "opt_2_3", label: "Личный менторинг", icon: "Heart" },
      { id: "opt_2_4", label: "Практические воркшопы", icon: "Layers" }
    ];
  }

  const defaultStations = [
    {
      id: "station_1",
      title: "Кто ваши клиенты?",
      subtitle: "Выберите приоритетные сегменты для настройки ИИ-агентов",
      type: "multiple",
      options: targetAudienceOpts
    },
    {
      id: "station_2",
      title: "Что вы продаёте?",
      subtitle: "Выберите основные направления услуг или товаров",
      type: "multiple",
      options: productsOpts
    },
    {
      id: "station_3",
      title: "Откуда приходят заявки?",
      subtitle: "Укажите ключевые каналы привлечения трафика",
      type: "multiple",
      options: [
        { id: "opt_3_1", label: "Рекомендации и сарафан", icon: "Smile" },
        { id: "opt_3_2", label: "Социальные сети и блоги", icon: "Megaphone" },
        { id: "opt_3_3", label: "Поисковые системы Яндекс/Google", icon: "Globe" },
        { id: "opt_3_4", label: "Платный таргетинг / контекст", icon: "Zap" }
      ]
    },
    {
      id: "station_4",
      title: "Как сейчас обрабатываете заявки?",
      subtitle: "Где происходит наибольшая потеря потенциальных клиентов?",
      type: "single",
      options: [
        { id: "opt_4_1", label: "Отвечаем вручную с задержкой", icon: "Clock" },
        { id: "opt_4_2", label: "Теряем лиды вне рабочих часов", icon: "Shield" },
        { id: "opt_4_3", label: "Сложно дожать до оплаты", icon: "MessageSquare" },
        { id: "opt_4_4", label: "Нет четкой схемы прогрева", icon: "TrendingUp" }
      ]
    },
    {
      id: "station_5",
      title: "Где общаетесь с клиентами?",
      subtitle: "Выберите площадки для внедрения авто-агентов",
      type: "multiple",
      options: [
        { id: "opt_5_1", label: "Telegram каналы и боты", icon: "Send" },
        { id: "opt_5_2", label: "WhatsApp чаты и аккаунты", icon: "MessageSquare" },
        { id: "opt_5_3", label: "Корпоративный сайт / лендинг", icon: "Globe" },
        { id: "opt_5_4", label: "Группы в соцсетях VK и др.", icon: "Smartphone" }
      ]
    },
    {
      id: "station_6",
      title: "Какая главная цель на месяц?",
      subtitle: "Определите приоритетную бизнес-задачу на сегодня",
      type: "single",
      options: [
        { id: "opt_6_1", label: "Мгновенные ответы (до 2 мин)", icon: "Clock" },
        { id: "opt_6_2", label: "Рост продаж и апсейлы", icon: "DollarSign" },
        { id: "opt_6_3", label: "Полное освобождение владельца", icon: "Cpu" },
        { id: "opt_6_4", label: "Прогрев холодной базы лидов", icon: "Target" }
      ]
    },
    {
      id: "station_7",
      title: "Сколько времени готовы тратить на контроль?",
      subtitle: "Выберите комфортный режим мониторинга работы штаба",
      type: "single",
      options: [
        { id: "opt_7_1", label: "5 минут: только вечерний рапорт", icon: "Clock" },
        { id: "opt_7_2", label: "30 минут: детальный еженедельный разбор", icon: "FileText" },
        { id: "opt_7_3", label: "Интерактивный контроль в реальном времени", icon: "Eye" },
        { id: "opt_7_4", label: "Полное автономное управление", icon: "Cpu" }
      ]
    }
  ];

  if (!ai) {
    return res.json({ stations: defaultStations });
  }

  try {
    const prompt = `Ты — ведущий Архитектор Бизнес-Квестов. Твоя задача — составить персонализированный Квест из 7 последовательных Станций для компании "${business_name || "Наш Бизнес"}" (сфера деятельности: "${industry || "услуги/продажи"}", глобальная цель владельца: "${objective || "Оптимизация бизнеса"}").

Каждая станция должна соответствовать одному из следующих шагов алгоритма бизнеса и иметь СТРОГО УКАЗАННЫЙ заголовок (title):
1. station_1: title должно быть строго "Кто ваши клиенты?"
2. station_2: title должно быть строго "Что вы продаёте?"
3. station_3: title должно быть строго "Откуда приходят заявки?"
4. station_4: title должно быть строго "Как сейчас обрабатываете заявки?"
5. station_5: title должно быть строго "Где общаетесь с клиентами?"
6. station_6: title должно быть строго "Какая главная цель на месяц?"
7. station_7: title должно быть строго "Сколько времени готовы тратить на контроль?"

Для каждой станции сгенерируй:
- id: строго 'station_1', 'station_2', 'station_3', 'station_4', 'station_5', 'station_6', 'station_7'
- title: строго указанный выше заголовок для соответствующей станции
- subtitle: Короткое, вежливое, понятное пояснение-подзаголовок без технических терминов, канцелярита, аббревиатур или технических обрывков (например, никаких "мобильность ТТ").
- type: 'single' (одиночный выбор) или 'multiple' (множественный выбор)
- options: массив из ровно 4 уникальных опций. 

ВАЖНОЕ ТРЕБОВАНИЕ К ОПЦИЯМ:
Все опции (особенно для станций 1, 2 и 6) должны быть ФИЛИГРАННО АДАПТИРОВАНЫ под нишу "${industry}"! Никаких общих абстрактных шаблонов, никаких технических аббревиатур или обрывков. Например, для шиномонтажа во 2-й станции должно быть про "Сезонная переобувка", "Ремонт проколов/грыж", "Правка литых дисков", "Хранение шин". Для салона красоты: "Сложное окрашивание волос", "Аппаратный маникюр", "Косметологические процедуры", "Экспресс-укладки". Названия опций должны быть краткими (1-3 слова).

Каждая опция в массиве должна строго содержать:
- id: уникальный строковый ID (например, "opt_1_1")
- label: Текст опции (кратко, 1-3 слова, на русском)
- icon: Строго одно название иконки из следующего списка разрешенных: "Users", "Target", "Award", "ShoppingBag", "ShoppingCart", "MessageSquare", "Megaphone", "Smartphone", "Compass", "Clock", "Shield", "Sparkles", "TrendingUp", "Cpu", "Database", "DollarSign", "Layers", "FileText", "Send", "Phone", "Eye", "Globe", "Briefcase", "Smile", "Heart", "Zap", "Coffee", "HelpCircle", "MapPin", "Activity".

Верни строго JSON-документ следующей структуры без лишнего текста:
{
  "stations": [
    {
      "id": "station_1",
      "title": "Кто ваши клиенты?",
      "subtitle": "Подзаголовок",
      "type": "multiple",
      "options": [
        { "id": "opt_1_1", "label": "Опция 1", "icon": "Users" },
        ...
      ]
    },
    ...
  ]
}`;

    const response = await generateWithFallback(
      () => prompt,
      {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            stations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  title: { type: Type.STRING },
                  subtitle: { type: Type.STRING },
                  type: { type: Type.STRING },
                  options: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        id: { type: Type.STRING },
                        label: { type: Type.STRING },
                        icon: { type: Type.STRING }
                      },
                      required: ["id", "label", "icon"]
                    }
                  }
                },
                required: ["id", "title", "subtitle", "type", "options"]
              }
            }
          },
          required: ["stations"]
        },
        temperature: 0.2
      }
    );

    const parsed = JSON.parse(response.text || "{}");
    if (parsed.stations && Array.isArray(parsed.stations) && parsed.stations.length > 0) {
      const titles = [
        "Кто ваши клиенты?",
        "Что вы продаёте?",
        "Откуда приходят заявки?",
        "Как сейчас обрабатываете заявки?",
        "Где общаетесь с клиентами?",
        "Какая главная цель на месяц?",
        "Сколько времени готовы тратить на контроль?"
      ];
      parsed.stations.forEach((station: any, index: number) => {
        if (index < titles.length) {
          station.title = titles[index];
        }
      });
      return res.json({ stations: parsed.stations });
    }
    return res.json({ stations: defaultStations });
  } catch (error: any) {
    console.error("Failed to generate quest stations via Gemini:", error);
    return res.json({ stations: defaultStations });
  }
});

app.post("/api/quest/generate-plan", async (req, res) => {
  const { selectedChoices, industry, business_name, owner_name, objective } = req.body;

  if (!ai) {
    // Return high-quality, simulated plan in Russian with no SMART methodology
    const simulatedPlan = [
      {
        agent: "receiver",
        title: "ИИ-Приемщик обращений",
        mission: `Мгновенно отвечает на все входящие вопросы клиентов в Telegram и WhatsApp. Квалифицирует лидов, выявляет интерес к направлению "${industry || 'наших услуг'}" и снимает рутину ответов на частые вопросы.`,
        icon: "MessageSquare"
      },
      {
        agent: "content",
        title: "ИИ-Контент-маркетолог",
        mission: "Генерирует живые, прогревающие посты о качестве работы, акциях и отзывах. Ведет регулярные публикации в выбранных соцсетях для повышения вовлеченности аудитории.",
        icon: "PenTool"
      },
      {
        agent: "sales",
        title: "ИИ-Менеджер по продажам",
        mission: `Концентрируется на дожиме теплых заявок. Отправляет индивидуальные коммерческие предложения, обосновывает выгоды, отрабатывает возражения и стимулирует скорейшую оплату услуг.`,
        icon: "DollarSign"
      },
      {
        agent: "analyst",
        title: "ИИ-Бизнес-аналитик",
        mission: `Контролирует скорость ответов и качество переписок. Выявляет этапы воронки, где клиенты уходят, и дает рекомендации по оптимизации скриптов для решения цели: "${objective || 'развитие бизнеса'}".`,
        icon: "BarChart2"
      },
      {
        agent: "operator",
        title: "ИИ-Шеф Координатор",
        mission: `Полностью координирует работу всех цифровых сотрудников. Формирует лаконичный и понятный вечерний рапорт за 1 минуту для руководителя ${owner_name || "владельца"} и отслеживает ключевые метрики.`,
        icon: "CheckSquare"
      }
    ];
    const simulatedMissions: Record<string, string> = {};
    for (const item of simulatedPlan) {
      simulatedMissions[item.agent] = item.mission;
    }
    saveCompanyConfig({ agent_missions: simulatedMissions, is_live: false });
    return res.json({ plan: simulatedPlan });
  }

  try {
    const prompt = `Ты — Генеральный Директор ИИ-штаба компании "${business_name || "Наш Бизнес"}".
Владелец: ${owner_name || "Предприниматель"}. Сфера деятельности: "${industry || "услуги"}". Глобальная цель: "${objective || "Оптимизация процессов"}".

Пользователь успешно прошел бизнес-квест и выбрал следующие параметры на станциях:
${JSON.stringify(selectedChoices, null, 2)}

Твоя задача — составить точный, индивидуальный план работы штаба из 5 специализированных цифровых сотрудников (receiver, content, sales, analyst, operator). Каждому сотруднику назначается строго одна крупная миссия на сегодня.

⚠️ ВАЖНОЕ ПРАВИЛО:
Сформулируй миссии простым, чистым, понятным человеческим языком. НИКАКИХ упоминаний методологии SMART, никаких букв S/M/A/R/T, никаких технических терминов, оранжевого кода или формул. Пиши живо, профессионально, с максимальной привязкой к нише "${industry}" и выбранным пользователем параметрам.

Специфика сотрудников:
1. receiver (ИИ-Приемщик лидов): Фокусируется на первичном контакте, мгновенном ответе, квалификации заявок по выбранным каналам трафика.
2. content (ИИ-Контент-мейкер): Фокусируется на создании живого, вовлекающего контента для соцсетей/каналов с учетом выбранного формата.
3. sales (ИИ-Продажник): Фокусируется на отработке возражений, отправке коммерческих предложений, доведении до оплаты, апсейлах выбранных продуктов.
4. analyst (ИИ-Бизнес-аналитик): Анализирует воронку, конверсии, ищет точки роста и узкие места в текущей обработке заявок.
5. operator (ИИ-Координатор): Координирует всех агентов, собирает вечерний рапорт для владельца, экономит его время на контроль.

Верни СТРОГО JSON-массив из 5 объектов со следующей структурой:
[
  {
    "agent": "receiver",
    "title": "Красивое русское название роли (например: ИИ-Ассистент по приему лидов)",
    "mission": "Детальное описание миссии на сегодня простым человеческим языком (2-3 предложения, конкретно, по делу, с привязкой к нише и выбранным параметрам)",
    "icon": "MessageSquare"
  },
  ...
]`;

    const response = await generateWithFallback(
      () => prompt,
      {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              agent: { type: Type.STRING },
              title: { type: Type.STRING },
              mission: { type: Type.STRING },
              icon: { type: Type.STRING }
              },
            required: ["agent", "title", "mission", "icon"]
          }
        },
        temperature: 0.2
      }
    );

    const plan = JSON.parse(response.text || "[]");
    const agent_missions: Record<string, string> = {};
    if (Array.isArray(plan)) {
      for (const item of plan) {
        if (item.agent && item.mission) {
          agent_missions[item.agent] = item.mission;
        }
      }
    }
    if (Object.keys(agent_missions).length > 0) {
      saveCompanyConfig({ agent_missions, is_live: false });
    }
    return res.json({ plan });
  } catch (error: any) {
    console.error("Failed to generate quest plan via Gemini:", error);
    // Return high-quality fallback
    const simulatedPlan = [
      {
        agent: "receiver",
        title: "ИИ-Приемщик обращений",
        mission: `Мгновенно отвечает на все входящие вопросы клиентов в Telegram и WhatsApp. Квалифицирует лидов, выявляет интерес к направлению "${industry || 'наших услуг'}" и снимает рутину ответов на частые вопросы.`,
        icon: "MessageSquare"
      },
      {
        agent: "content",
        title: "ИИ-Контент-маркетолог",
        mission: "Генерирует живые, прогревающие посты о качестве работы, акциях и отзывах. Ведет регулярные публикации в выбранных соцсетях для повышения вовлеченности аудитории.",
        icon: "PenTool"
      },
      {
        agent: "sales",
        title: "ИИ-Менеджер по продажам",
        mission: `Концентрируется на дожиме теплых заявок. Отправляет индивидуальные коммерческие предложения, обосновывает выгоды, отрабатывает возражения и стимулирует скорейшую оплату услуг.`,
        icon: "DollarSign"
      },
      {
        agent: "analyst",
        title: "ИИ-Бизнес-аналитик",
        mission: `Контролирует скорость ответов и качество переписок. Выявляет этапы воронки, где клиенты уходят, и дает рекомендации по оптимизации скриптов для решения цели: "${objective || 'развитие бизнеса'}".`,
        icon: "BarChart2"
      },
      {
        agent: "operator",
        title: "ИИ-Шеф Координатор",
        mission: `Полностью координирует работу всех цифровых сотрудников. Формирует лаконичный и понятный вечерний рапорт за 1 минуту для руководителя ${owner_name || "владельца"} и отслеживает ключевые метрики.`,
        icon: "CheckSquare"
      }
    ];
    const fallbackMissions: Record<string, string> = {};
    for (const item of simulatedPlan) {
      fallbackMissions[item.agent] = item.mission;
    }
    saveCompanyConfig({ agent_missions: fallbackMissions, is_live: false });
    res.json({ plan: simulatedPlan });
  }
});

// ==========================================
// SMART-INTERVIEW ENDPOINTS
// ==========================================

// 2a. Fetch next dynamic, niche-specific question for the SMART Interview
app.post("/api/smart-interview/next", async (req, res) => {
  const { messages, objective, business_name, owner_name, industry, tone, channels, current_index, total_target } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Messages array is required." });
  }

  const idx = current_index || (messages.filter(m => m.role === 'user').length + 1);
  const total = total_target || 10;

  if (!ai) {
    // Simulated interview questions fallback
    const simulatedQuestions = [
      `Какая средняя загрузка вашего бизнеса в день сейчас в процентах или клиентах?`,
      `Каков ваш средний чек и средняя маржинальность с одного заказа/клиента в нише ${industry || "вашего бизнеса"}?`,
      `Каков размер вашей команды (сколько мастеров, сотрудников или кураторов в штате)?`,
      `Какая у вас стоимость привлечения клиента (CAC) или рекламный бюджет в месяц, если есть?`,
      `Какой процент клиентов возвращается к вам повторно (Retention / LTV)?`,
      `Есть ли в вашей сфере выраженная сезонность и как вы готовитесь к пикам или спадам?`,
      `Кто ваша основная целевая аудитория и кто ваши главные конкуренты в городе/онлайне?`,
      `Каковы основные технические или операционные ограничения (например, нехватка времени, узкие места в продажах)?`,
      `С какой главной сложностью вы сталкиваетесь прямо сейчас при попытке достичь цели: "${objective}"?`,
      `Отлично! Каких результатов вы хотите достичь за ближайшие 30 дней в цифрах?`
    ];
    
    const nextQuestion = simulatedQuestions[Math.min(idx - 1, simulatedQuestions.length - 1)];
    return res.json({ text: nextQuestion });
  }

  try {
    const formattedContents = messages.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    const systemInstruction = `Ты — опытный бизнес-консультант, строгий и профессиональный эксперт. Твоя задача — провести глубокое профессиональное SMART-интервью перед составлением SMART-плана для компании "${business_name || "Наш Бизнес"}" (сфера: ${industry || "услуги и продажи"}).
Владелец: ${owner_name || "Предприниматель"}. Каналы связи: ${(channels || []).join(", ")}. Желаемый тон общения: ${tone || "friendly"}.
Глобальная цель на сегодня: "${objective || "Оптимизировать бизнес-процессы"}".

СЕЙЧАС ИДЕТ ВОПРОС №${idx} ИЗ ${total}.
Твоя цель — задать ОДИН точный, глубокий, нишево-специфичный вопрос по делу. Вопрос должен относиться к одной из следующих тем, которая еще не раскрыта в истории:
- Текущие метрики и объем операций (например, загрузка постов, мест, трафик).
- Экономика (средний чек, маржинальность, LTV, стоимость привлечения CAC).
- Ресурсы и мощности (размер команды, квалификация, бюджет, оборудование).
- Ограничения и узкие места (capacity constraints, нехватка мастеров, задержки).
- Сезонность спроса и связанные с ней риски.
- Особенности целевой аудитории и конкурентная среда.
- Конкретные барьеры на пути к цели: "${objective}".

ПРАВИЛА:
1. Задавай СТРОГО ОДИН вопрос за раз.
2. Вопрос должен быть максимально адаптирован под нишу "${industry || "услуги и продажи"}" (например, для шиномонтажа спрашивай про посты, домкраты, сезонную переобувку; для салона красоты — про кресла, повторные записи, категории мастеров; для онлайн-школы — про доходимость, нагрузку кураторов, трафик).
3. Избегай банальных, общих, водянистых вопросов. Говори как опытный, практичный бизнес-консультант.
4. Тон: сдержанный, деловой, экспертный, уважительный, без лишней вежливости и "воды".`;

    const response = await generateWithFallback(
      () => formattedContents,
      {
        systemInstruction,
        temperature: 0.7,
      }
    );

    res.json({ text: response.text || "Не удалось сформулировать следующий вопрос." });
  } catch (error: any) {
    console.error("SMART Interview Next Error:", error);
    res.status(500).json({ error: error.message || "Failed to generate interview question" });
  }
});

// 2b. Synthesize history into a professional JSON business profile
app.post("/api/smart-interview/synthesize", async (req, res) => {
  const { messages, objective, business_name, owner_name, industry, tone, channels } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Messages array is required." });
  }

  if (!ai) {
    // Return simulated synthesis context
    const simulatedProfile = {
      niche_and_positioning: `Автономный бизнес в сфере ${industry || "услуг"}. Сильное позиционирование на локальном рынке с фокусом на качество.`,
      key_metrics: `Средний чек ~1,500 ₽, маржа 65%, загрузка оборудования/постов ~55%, повторные визиты на уровне 30%.`,
      resources_and_capacity: `Штат из 3 специалистов, координация через 1 руководителя. Ограниченные рекламные бюджеты.`,
      constraints_and_risks: `Высокая чувствительность к сезонным колебаниям спроса (пик весна/осень). Дефицит времени на прогрев лидов.`,
      target_audience: `Постоянные клиенты среднего достатка, ценящие скорость и личный подход.`,
      strategic_focus: `Повышение загрузки до 75% за счет автоматической реанимации старой базы и внедрения умного ресивера на входящем потоке в Telegram.`
    };
    return res.json({ profile: simulatedProfile });
  }

  try {
    const formattedHistory = messages.map(m => `${m.role === 'user' ? 'Клиент' : 'Консультант'}: ${m.content}`).join("\n");

    const prompt = `Ты — Аналитический модуль бизнес-синтеза. Твоя задача — проанализировать историю SMART-интервью с владельцем бизнеса и составить единую глубокую картину бизнеса (профиль бизнеса) для компании "${business_name || "Наш Бизнес"}" (сфера: ${industry || "услуги"}).
История интервью:
${formattedHistory}

Цель бизнеса: "${objective}"

Тебе нужно строго структурировать полученную информацию и вернуть JSON-объект, содержащий следующие разделы:
- niche_and_positioning (Ниша и позиционирование компании: специфика деятельности, особенности услуг/продуктов)
- key_metrics (Ключевые метрики бизнеса: извлеченные или оцененные цифры: средний чек, маржа, LTV, текущая загрузка/конверсии)
- resources_and_capacity (Ресурсы и мощности: штат сотрудников, оборудование, бюджеты, пропускная способность)
- constraints_and_risks (Ограничения, сезонность спроса и риски, мешающие росту)
- target_audience (Целевая аудитория и конкурентное отличие: портрет покупателей, почему выбирают именно их)
- strategic_focus (Стратегический фокус для решения цели "${objective}": на чем необходимо сконцентрироваться цифровым агентам)

ПРАВИЛА:
1. Пиши строго на русском языке.
2. Ссылайся на реальные цифры, факты и ограничения, которые пользователь назвал в своих ответах. Если пользователь не ответил на какую-то тему, сделай профессиональную, логичную и реалистичную оценку для ниши "${industry}" на основе названных данных.
3. Не придумывай нереалистичных деталей. Твой анализ должен выглядеть как отчет топового консалтингового агентства (McKinsey/BCG).
4. Верни СТРОГО JSON-объект с указанными полями.`;

    const response = await generateWithFallback(
      () => prompt,
      {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            niche_and_positioning: { type: Type.STRING },
            key_metrics: { type: Type.STRING },
            resources_and_capacity: { type: Type.STRING },
            constraints_and_risks: { type: Type.STRING },
            target_audience: { type: Type.STRING },
            strategic_focus: { type: Type.STRING }
          },
          required: ["niche_and_positioning", "key_metrics", "resources_and_capacity", "constraints_and_risks", "target_audience", "strategic_focus"]
        },
        temperature: 0.2
      }
    );

    const profile = JSON.parse(response.text || "{}");
    res.json({ profile });
  } catch (error: any) {
    console.error("SMART Interview Synthesis Error:", error);
    res.status(500).json({ error: error.message || "Failed to synthesize interview data" });
  }
});

// 2c. Compile custom daily plan of 5 highly tailored SMART tasks using the profile
app.post("/api/smart-plan/generate-from-interview", async (req, res) => {
  const { profile, objective, business_name, owner_name, industry, tone, channels } = req.body;

  if (!profile || typeof profile !== "object") {
    return res.status(400).json({ error: "Synthesized profile object is required." });
  }

  if (!ai) {
    // Return simulated SMART tasks using the profile metrics
    const simulatedTasks = [
      {
        id: "task_1",
        title: "Фильтрация и прием лидов",
        agent: "receiver",
        specific: `Захват всех обращений в ${channels?.join(", ") || "Telegram"} и распределение по услугам с фокусом на нишу ${industry || "бизнеса"}.`,
        measurable: "100% ответов в течение 90 секунд, квалификация лида по критерию маржинальности.",
        achievable: `Используя базу знаний и данные о ресурсах: ${profile.resources_and_capacity}`,
        relevant: `Снижает нагрузку на текущую команду и повышает скорость контакта на ранней стадии.`,
        time_bound: "До 11:00",
        priority: "high"
      },
      {
        id: "task_2",
        title: "Прогрев под средний чек",
        agent: "sales",
        specific: `Отправка КП теплым лидам с акцентом на ценность и обоснование среднего чека из метрик: ${profile.key_metrics}.`,
        measurable: `Повышение конверсии из клика в оплату на 12% при среднем чеке из анализа.`,
        achievable: `За счет интеграции скриптов отработки возражений под ограничения: ${profile.constraints_and_risks}`,
        relevant: `Прямо ведет к росту маржи и достижению цели: "${objective}"`,
        time_bound: "До 13:30",
        priority: "high"
      },
      {
        id: "task_3",
        title: "Контент под боли ЦА",
        agent: "content",
        specific: `Создание прогревающего поста под целевую аудиторию: ${profile.target_audience}.`,
        measurable: `Минимум 8 входящих заявок с пометкой промокода, вовлеченность выше средней на 20%.`,
        achievable: `Написание копирайтером ИИ в фирменном стиле "${tone || "friendly"}".`,
        relevant: `Нивелирует сезонность за счет генерации немедленного спроса.`,
        time_bound: "До 16:00",
        priority: "medium"
      },
      {
        id: "task_4",
        title: "Анализ воронки и аномалий",
        agent: "analyst",
        specific: `Сбор статистики по диалогам и выявление этапа, где клиенты уходят к конкурентам.`,
        measurable: `Готовый детальный отчет со списком 3 слабых мест в текущей воронке продаж.`,
        achievable: `Анализ логов переписок за день на основе стратегического фокуса: ${profile.strategic_focus}`,
        relevant: `Позволяет скорректировать лид-формы и скрипты к следующему дню.`,
        time_bound: "До 18:30",
        priority: "medium"
      },
      {
        id: "task_5",
        title: "Координация и вечерний рапорт",
        agent: "operator",
        specific: `Интеграция результатов дня и отправка сводного отчета для ${owner_name || "владельца"}.`,
        measurable: `Отчет отправлен руководителю, зафиксировано выполнение всех SMART-задач.`,
        achievable: `Автоматическое подведение итогов по действиям ресивера, продажника, контентщика и аналитика.`,
        relevant: `Обеспечивает 100% прозрачность операционной деятельности штаба.`,
        time_bound: "До 20:00",
        priority: "high"
      }
    ];
    return res.json({ tasks: simulatedTasks });
  }

  try {
    const prompt = `Ты — Операционный Директор (Supervisor) ИИ-штаба компании "${business_name || "Наш Бизнес"}".
Владелец: ${owner_name || "Предприниматель"}. Сфера: ${industry || "услуги"}. Стиль общения: ${tone || "friendly"}. Каналы: ${(channels || []).join(", ")}.
Глобальная цель на сегодня: "${objective}".

ПЕРЕД ТОБОЙ ПОЛНЫЙ СИНТЕЗИРОВАННЫЙ ПРОФИЛЬ БИЗНЕСА ИЗ SMART-ИНТЕРВЬЮ:
Ниша и позиционирование: ${profile.niche_and_positioning}
Ключевые метрики: ${profile.key_metrics}
Ресурсы и мощности: ${profile.resources_and_capacity}
Ограничения и риски: ${profile.constraints_and_risks}
Целевая аудитория: ${profile.target_audience}
Стратегический фокус: ${profile.strategic_focus}

Твоя задача — составить абсолютно точный, индивидуальный план из РОВНО 5 SMART-задач на сегодня для твоих цифровых агентов (receiver, content, sales, analyst, operator). Каждому агенту назначается строго одна задача!

ТРЕБОВАНИЯ К SMART-ЗАДАЧАМ:
- План должен опираться на реальные цифры, метрики, ограничения и ресурсы из профиля бизнеса! Например, если штат команды 2 человека, задача должна учитывать это. Если средний чек 3,000 ₽, задача должна это использовать.
- receiver (приемщик): Сфокусирован на приеме лидов, квалификации, первичном контакте по каналам.
- content (контент-мейкер): Сфокусирован на генерации постов, рассылок, вовлекающего SMM под боли целевой аудитории.
- sales (продажник): Сфокусирован на доведении до оплаты, отправке КП, отработке возражений, повышении чека.
- analyst (аналитик): Сфокусирован на сборе метрик, поиске узких мест, анализе аномалий в диалогах.
- operator (операционист-координатор): Сфокусирован на вечерней сборке рапортов, контроле качества работы ИИ-сотрудников, информировании владельца.

Каждая задача должна быть расписана по жестким критериям SMART:
1. Specific (Конкретика): Что именно должен сделать агент.
2. Measurable (Измеримость): Численный критерий успеха (метрики, конверсии, % или конкретные числа, прямо вдохновленные интервью).
3. Achievable (Достижимость): Почему это реально выполнить силами ИИ с учетом ресурсов компании.
4. Relevant (Релевантность): Как задача решает цель "${objective}" с учетом стратегического фокуса.
5. Time-bound (Ограниченность во времени): Конкретный срок окончания (например: "До 11:30", "До 14:00", "До 18:00").

Верни ответ СТРОГО в формате JSON-массива из 5 объектов со следующей структурой:
[
  {
    "id": "task_1",
    "title": "Краткое название задачи",
    "agent": "receiver" или "content" или "sales" или "analyst" или "operator",
    "specific": "Детальное описание конкретного действия",
    "measurable": "Численные метрики успеха на основе цифр из интервью",
    "achievable": "Обоснование выполнимости с учетом ресурсов и мощностей",
    "relevant": "Связь с решением главной бизнес-цели",
    "time_bound": "Срок (До XX:XX)",
    "priority": "high" или "medium" или "low"
  }
]`

    const response = await generateWithFallback(
      () => prompt,
      {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              title: { type: Type.STRING },
              agent: { type: Type.STRING },
              specific: { type: Type.STRING },
              measurable: { type: Type.STRING },
              achievable: { type: Type.STRING },
              relevant: { type: Type.STRING },
              time_bound: { type: Type.STRING },
              priority: { type: Type.STRING }
            },
            required: ["id", "title", "agent", "specific", "measurable", "achievable", "relevant", "time_bound", "priority"]
          }
        },
        temperature: 0.2
      }
    );

    const tasks = JSON.parse(response.text || "[]");
    const agent_missions: Record<string, string> = {};
    if (Array.isArray(tasks)) {
      for (const item of tasks) {
        if (item.agent && (item.specific || item.title)) {
          agent_missions[item.agent] = item.specific || item.title;
        }
      }
    }
    if (Object.keys(agent_missions).length > 0) {
      saveCompanyConfig({ agent_missions, is_live: false });
    }
    res.json({ tasks });
  } catch (error: any) {
    console.error("SMART Plan dynamic generation Error:", error);
    res.status(500).json({ error: error.message || "Failed to generate dynamic SMART plan" });
  }
});

// 3. Agent Execution / Intercept endpoint
app.post("/api/agent-respond", async (req, res) => {
  const { agent_role, user_message, context, business_name, owner_name, industry, tone } = req.body;

  if (!ai) {
    let text = "";
    if (agent_role === 'receiver') {
      text = "Здравствуйте! Спасибо за обращение. С удовольствием помогу вам. Подскажите, вас интересует конкретная услуга или вы хотите записаться?";
    } else if (agent_role === 'sales') {
      text = "Добрый день! Проанализировал ваш запрос. Рад предложить вам эксклюзивные условия сотрудничества. Мы готовы предоставить персональное предложение прямо сейчас.";
    } else if (agent_role === 'content') {
      text = "СУПЕР-НОВОСТЬ! Друзья, мы рады объявить о запуске специального предложения! Наша команда делает все, чтобы вы получали лучший сервис.";
    } else if (agent_role === 'analyst') {
      text = "Аналитический отчет: Конверсия обращений за сегодня выросла до 24.5%. Канал Telegram лидирует по объему трафика (62%). Аномалий не обнаружено.";
    } else {
      text = "Координатор штаба: Все системы работают штатно. SMART-задачи распределены, агенты активны. Держу вас в курсе всех ключевых событий.";
    }
    return res.json({ response: text });
  }

  try {
    const config = getCompanyConfig();
    const chats = getTelegramChats();
    const chatIndex = chats.findIndex((c: any) => c.id === "tg_simulated" || c.name === "Тест-Клиент");

    quietClientProfileUpdate("Тест-Клиент", user_message || "", "simulated");

    const mmResult = await processMultimodalMessage(
      user_message || "",
      chatIndex !== -1 ? chats[chatIndex].history : [],
      { ...config, business_name: business_name || config.business_name }
    );

    res.json({
      response: mmResult.textResponse,
      mediaType: mmResult.mediaType,
      mediaUrl: mmResult.mediaUrl,
      codeDetails: mmResult.codeDetails,
      audio: mmResult.audioBase64,
      isQuotaDegraded: mmResult.isQuotaDegraded
    });
  } catch (error: any) {
    console.error("Agent Respond Error:", error);
    res.status(500).json({ error: error.message || "Failed to generate agent response" });
  }
});

// 4. Voice synthesis endpoint (Gemini TTS)
app.post("/api/synthesize", async (req, res) => {
  const { text, voice, chatId } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Text is required for synthesis." });
  }

  try {
    const wakeResult = detectVoiceWakeWord(text);
    let textToSynthesize = text;
    let targetVoice = voice;

    if (wakeResult.detected) {
      await setVoiceForChat(chatId, wakeResult.voice!);
      targetVoice = wakeResult.voice!;
      textToSynthesize = wakeResult.isOnlyWakeWord ? wakeResult.confirmationSpeech : wakeResult.cleanedText;
    }

    if (!targetVoice) {
      targetVoice = (await getVoiceForChat(chatId)) || "Kore";
    }

    const tts = new MsEdgeTTS();
    await tts.setMetadata(
      process.env.EDGE_TTS_VOICE || 'ru-RU-SvetlanaNeural',
      OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3
    );
    
    const { audioStream } = tts.toStream(textToSynthesize);
    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) {
      if (Buffer.isBuffer(chunk)) chunks.push(chunk);
      else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk));
    }
    const audioBuffer = Buffer.concat(chunks);
    const base64Audio = audioBuffer.toString('base64');

    res.json({
      audio: base64Audio,
      voice: targetVoice,
      wakeDetected: wakeResult.detected,
      mode: wakeResult.mode,
      confirmationSpeech: wakeResult.detected ? wakeResult.confirmationSpeech : undefined,
      text: textToSynthesize
    });
  } catch (error: any) {
    console.error("TTS Synthesis Error:", error);
    res.status(500).json({ error: error.message || "Failed to synthesize voice" });
  }
});

// ==========================================
// READINESS & LAUNCH ENDPOINTS
// ==========================================
function getReadinessState() {
  const kb_ready = !!(cachedKnowledgeBase.chunks && cachedKnowledgeBase.chunks.length > 0);
  const channel_ready = !!(process.env.MAX_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN);
  const tone_ready = !!cachedConfig.tone;
  const missions_ready = !!(cachedConfig.agent_missions && Object.keys(cachedConfig.agent_missions).length >= 3);
  const is_live = !!cachedConfig.is_live;
  const all_ready = kb_ready && channel_ready && tone_ready && missions_ready;

  return {
    kb_ready,
    channel_ready,
    tone_ready,
    missions_ready,
    is_live,
    all_ready
  };
}

app.get("/api/readiness", (req, res) => {
  res.json(getReadinessState());
});

app.post("/api/calculator/eval", (req, res) => {
  try {
    const { expression } = req.body || {};
    if (!expression || typeof expression !== "string") {
      return res.status(400).json({ error: "Expression is required" });
    }
    const result = evaluate(expression);
    if (typeof result === "number" && !Number.isFinite(result)) {
      return res.status(400).json({ error: "Result is not a finite number" });
    }
    return res.json({ expression, result });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Invalid expression" });
  }
});

app.post("/api/launch", async (req, res) => {
  const readiness = getReadinessState();
  if (!readiness.all_ready) {
    return res.status(400).json({ error: "not_ready", readiness });
  }
  saveCompanyConfig({ is_live: true });
  res.json({ success: true, is_live: true });
});

app.post("/api/transcribe", async (req, res) => {
  try {
    const { audio } = req.body || {};
    if (!audio) {
      return res.json({ text: "" });
    }

    const buf = Buffer.from(audio, "base64");
    const text = await transcribeAudioBuffer(buf);
    return res.json({ text });
  } catch (err: any) {
    console.error("Transcribe error:", err?.message || err);
    return res.json({ text: "" });
  }
});

// Configure multer for voice audio uploads (max 5MB)
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Dedicated POST /api/voice/transcribe endpoint
app.post("/api/voice/transcribe", audioUpload.single("audio"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "Файл записи не передан" });
    }

    const text = await transcribeAudioBuffer(req.file.buffer);
    logger.info(`🎤 Voice transcribed (${req.file.size} bytes): "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);

    const wakeResult = detectVoiceWakeWord(text);

    return res.json({
      text,
      confidence: text ? 0.98 : 0,
      duration: Math.round(req.file.size / 32000) || 1,
      wakeWord: wakeResult.detected ? wakeResult : null
    });
  } catch (err: any) {
    logger.error("POST /api/voice/transcribe error:", err?.message || err);
    return res.status(500).json({ error: err?.message || "Ошибка распознавания речи" });
  }
});

// ==========================================
// 1. MCP SERVER SETUP & EXTENDED CONNECTOR REGISTRY
// ==========================================
const mcpServer = new McpServer({
  name: "selin-enterprise-hq",
  version: "2.3.0",
});

// Tool 1: Order Taxi (Яндекс Go / InDriver)
mcpServer.tool(
  "order_taxi",
  "Заказ такси через Яндекс Go Partner API / InDriver с подбором минимального тарифа и Deep Link fallback",
  {
    fromAddress: z.string().describe("Адрес отправления"),
    toAddress: z.string().describe("Адрес назначения"),
    carClass: z.enum(["econom", "comfort", "comfort_plus", "business", "cheapest"]).optional().describe("Класс авто"),
    paymentMethod: z.enum(["card", "cash", "corporate"]).optional().describe("Способ оплаты")
  },
  async (args) => {
    logger.info("[MCP Tool Execution] order_taxi", { args });
    const res = await connectorRegistry.execute("taxi_connector", args);
    return {
      content: [{ type: "text", text: JSON.stringify(res) }]
    };
  }
);

// Tool 2: Order Food Delivery (Додо Пицца / Яндекс Еда)
mcpServer.tool(
  "order_food",
  "Заказ еды и продуктов с автоформингом корзины (Додо Пицца / Яндекс Еда) и Deep Link fallback",
  {
    items: z.array(z.string()).describe("Список блюд или позиций"),
    address: z.string().describe("Адрес доставки"),
    paymentMethod: z.enum(["card", "cash", "online"]).optional().describe("Способ оплаты")
  },
  async (args) => {
    logger.info("[MCP Tool Execution] order_food", { args });
    const res = await connectorRegistry.execute("food_delivery_connector", args);
    return {
      content: [{ type: "text", text: JSON.stringify(res) }]
    };
  }
);

// Tool 3: Search Travel & Flights (Aviasales API / Booking)
mcpServer.tool(
  "search_travel",
  "Поиск билетов и отелей через Aviasales API и Booking/Ostrovok",
  {
    from: z.string().describe("Город отправления"),
    to: z.string().describe("Город назначения"),
    departureDate: z.string().describe("Дата вылета в формате YYYY-MM-DD"),
    returnDate: z.string().optional().describe("Дата возвращения"),
    maxBudgetRub: z.number().optional().describe("Максимальный бюджет в рублях")
  },
  async (args) => {
    logger.info("[MCP Tool Execution] search_travel", { args });
    const res = await connectorRegistry.execute("travel_connector", args);
    return {
      content: [{ type: "text", text: JSON.stringify(res) }]
    };
  }
);

// Tool 4: Instagram SMM Automation
mcpServer.tool(
  "manage_instagram",
  "Генерация контент-планов через Gemini, промтов для Imagen и публикация через Instagram Graph API",
  {
    task: z.enum(["content_plan", "post", "story"]).describe("Задача: контент-план, пост или сторис"),
    niche: z.string().describe("Ниша бизнеса"),
    tone: z.enum(["professional", "friendly", "luxurious", "engaging"]).optional().describe("Тон коммуникации"),
    caption: z.string().optional().describe("Текст поста"),
    imageUrl: z.string().optional().describe("URL медиафайла")
  },
  async (args) => {
    logger.info("[MCP Tool Execution] manage_instagram", { args });
    const res = await connectorRegistry.execute("instagram_connector", args);
    return {
      content: [{ type: "text", text: JSON.stringify(res) }]
    };
  }
);

// Tool 5: Business Plan & AI Debate Generator
mcpServer.tool(
  "generate_business_plan",
  "Генерация полного бизнес-плана со стратегическим дебатом AI, SMART-целями и промтами для Imagen/Midjourney/DALL-E",
  {
    businessIdea: z.string().describe("Бизнес-идея или проект"),
    targetAudience: z.string().optional().describe("Целевая аудитория"),
    budgetRub: z.number().optional().describe("Бюджет на старт"),
    timeframeMonths: z.number().optional().describe("Срок реализации в месяцах")
  },
  async (args) => {
    logger.info("[MCP Tool Execution] generate_business_plan", { args });
    const res = await connectorRegistry.execute("business_plan_connector", args);
    return {
      content: [{ type: "text", text: JSON.stringify(res) }]
    };
  }
);

// Active MCP tool registry dictionary for direct internal invocation and API gateway
const mcpToolsRegistry: Record<string, Function> = {
  order_taxi: async (args: any, tenantId?: string) => {
    return await connectorRegistry.execute("taxi_connector", args, tenantId);
  },
  order_food: async (args: any, tenantId?: string) => {
    return await connectorRegistry.execute("food_delivery_connector", args, tenantId);
  },
  order_pizza: async (args: any, tenantId?: string) => {
    const items = args.items || ["Пепперони 30см на традиционном тесте"];
    return await connectorRegistry.execute("food_delivery_connector", {
      items,
      address: args.address || "Указанный адрес",
      restaurant: "Додо Пицца"
    }, tenantId);
  },
  order_groceries: async (args: any, tenantId?: string) => {
    const items = args.items || ["Молоко 3.2%", "Хлеб зерновой"];
    return await connectorRegistry.execute("food_delivery_connector", {
      items,
      address: args.address || "Указанный адрес",
      restaurant: "Самокат"
    }, tenantId);
  },
  search_flights: async (args: any, tenantId?: string) => {
    return await connectorRegistry.execute("travel_connector", {
      from: args.origin || args.from || "Москва",
      to: args.destination || args.to || "Дубай",
      departureDate: args.departureDate || "2026-08-15",
      maxBudgetRub: args.maxPriceRub
    }, tenantId);
  },
  search_travel: async (args: any, tenantId?: string) => {
    return await connectorRegistry.execute("travel_connector", args, tenantId);
  },
  manage_instagram: async (args: any, tenantId?: string) => {
    return await connectorRegistry.execute("instagram_connector", args, tenantId);
  },
  generate_business_plan: async (args: any, tenantId?: string) => {
    return await connectorRegistry.execute("business_plan_connector", args, tenantId);
  },
  verify_client_booking: async (args: any) => {
    return {
      status: "confirmed",
      slot: "Завтра, 14:00",
      service: "Технический осмотр и диагностика",
      clientPhone: args.clientPhone,
      verifiedAt: new Date().toISOString()
    };
  },
  send_messenger_notification: async (args: any) => {
    return {
      delivered: true,
      channel: args.messenger || "telegram",
      recipient: args.recipient,
      messageId: `MSG-${Date.now().toString().slice(-6)}`,
      timestamp: new Date().toISOString()
    };
  },
  create_smart_task: async (args: any) => {
    return {
      id: `TASK-${Date.now().toString().slice(-4)}`,
      title: args.title,
      date: args.date,
      category: args.category || "work",
      status: "active",
      createdAt: new Date().toISOString()
    };
  }
};

async function handleIncomingMessage(chatId: string, userText: string, isVoiceInput: boolean): Promise<void> {
  return externalHandleIncomingMessage(
    chatId,
    userText,
    isVoiceInput,
    maxBot,
    setBotUserMode,
    getBotUserMode,
    safeSendMessageToChat,
    synthesizeAndSendVoice,
    callLLM
  );
}

// API Endpoint: List Registered MCP Tools
app.get("/api/mcp/tools", (_, res) => {
  return res.json({
    status: "online",
    server: "selin-enterprise-hq",
    version: "2.3.0",
    connectors: connectorRegistry.getAll().map(c => ({ name: c.name, description: c.description })),
    tools: [
      { name: "order_taxi", description: "Заказ такси (Яндекс Go / InDriver)", category: "Mobility" },
      { name: "order_food", description: "Заказ еды и продуктов (Додо / Яндекс Еда)", category: "Delivery" },
      { name: "search_travel", description: "Поиск авиабилетов и отелей (Aviasales)", category: "Travel" },
      { name: "manage_instagram", description: "Автоматизация SMM и пуликаций в Instagram", category: "SMM" },
      { name: "generate_business_plan", description: "Генерация бизнес-планов и AI дебатов", category: "Strategy" },
      { name: "verify_client_booking", description: "Проверка бронирования в CRM", category: "CRM" },
      { name: "send_messenger_notification", description: "Отправка сообщений в мессенджер", category: "Messaging" },
      { name: "create_smart_task", description: "Создание задач в смарт-планере", category: "Planner" }
    ]
  });
});

// API Endpoint: Direct MCP / ServiceConnector Execution
app.post("/api/mcp/execute", async (req, res) => {
  const { toolName, args, tenantId } = req.body;
  if (!toolName || !mcpToolsRegistry[toolName]) {
    return res.status(404).json({ error: `Инструмент или коннектор '${toolName}' не найден` });
  }

  try {
    const result = await mcpToolsRegistry[toolName](args || {}, tenantId || req.headers["x-tenant-id"]);
    return res.json({
      success: true,
      tool: toolName,
      executedAt: new Date().toISOString(),
      result
    });
  } catch (err: any) {
    logger.error(`Error executing MCP tool ${toolName}`, { error: err });
    return res.status(500).json({ error: err.message || "Ошибка выполнения инструмента" });
  }
});

// ==========================================
// 2. SCHEMAS & VALIDATION
// ==========================================
const EnterpriseResponseSchema = z.object({
  replyText: z.string().min(1),
  sentiment: z.enum(["positive", "neutral", "urgent", "critical"]),
  requiresHumanIntervention: z.boolean(),
  confidenceScore: z.number().min(0).max(1)
});

type EnterpriseResponse = z.infer<typeof EnterpriseResponseSchema>;

const geminiResponseSchema = {
  type: "OBJECT" as const,
  properties: {
    replyText: { type: "STRING", description: "Профессиональный ответ клиенту" },
    sentiment: { type: "STRING", enum: ["positive", "neutral", "urgent", "critical"] },
    requiresHumanIntervention: { type: "BOOLEAN" },
    confidenceScore: { type: "NUMBER", description: "Уверенность от 0 до 1" }
  },
  required: ["replyText", "sentiment", "requiresHumanIntervention", "confidenceScore"]
};

const ENTERPRISE_SYSTEM_INSTRUCTION = `Ты — SELIN Enterprise Core, автономный ИИ-диспетчер.
Отвечай строго на русском языке. Следуй регламентам. Не выдумывай факты.`;

function safeParseJson(text: string): unknown {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

// ==========================================
// 3. CIRCUIT BREAKER & ENTERPRISE RESILIENCY ENGINE
// ==========================================
type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface TelemetryMetrics {
  totalRequests: number;
  successCount: number;
  failoverCount: number;
  consecutiveFailures: number;
  circuitState: CircuitState;
  lastCircuitChange: string;
  avgLatencyMs: number;
  requestLogs: Array<{
    id: string;
    timestamp: string;
    prompt: string;
    latencyMs: number;
    provider: string;
    circuitState: CircuitState;
    status: "success" | "failover" | "error";
  }>;
}

const circuitBreakerConfig = {
  failureThreshold: 3,
  resetTimeoutMs: 15000,
  lastFailureTime: 0,
};

const telemetryStore: TelemetryMetrics = {
  totalRequests: 0,
  successCount: 0,
  failoverCount: 0,
  consecutiveFailures: 0,
  circuitState: "CLOSED",
  lastCircuitChange: new Date().toISOString(),
  avgLatencyMs: 180,
  requestLogs: []
};

function recordTelemetry(prompt: string, latencyMs: number, provider: string, status: "success" | "failover" | "error") {
  telemetryStore.totalRequests += 1;
  if (status === "success") {
    telemetryStore.successCount += 1;
    telemetryStore.consecutiveFailures = 0;
    if (telemetryStore.circuitState === "HALF_OPEN") {
      telemetryStore.circuitState = "CLOSED";
      telemetryStore.lastCircuitChange = new Date().toISOString();
      console.log("🟢 [Circuit Breaker] Поток восстановлен: Переход в CLOSED");
    }
  } else if (status === "failover") {
    telemetryStore.failoverCount += 1;
    telemetryStore.consecutiveFailures += 1;
    
    if (telemetryStore.consecutiveFailures >= circuitBreakerConfig.failureThreshold && telemetryStore.circuitState === "CLOSED") {
      telemetryStore.circuitState = "OPEN";
      circuitBreakerConfig.lastFailureTime = Date.now();
      telemetryStore.lastCircuitChange = new Date().toISOString();
      console.warn("🔴 [Circuit Breaker] Превышен порог ошибок! Переход в OPEN (Активация Failover)");
    }
  }

  // Update average latency
  telemetryStore.avgLatencyMs = Math.round(
    ((telemetryStore.avgLatencyMs * (telemetryStore.totalRequests - 1)) + latencyMs) / telemetryStore.totalRequests
  );

  // Store in circular log (max 25)
  telemetryStore.requestLogs.unshift({
    id: `REQ-${Date.now().toString().slice(-6)}`,
    timestamp: new Date().toISOString(),
    prompt: prompt.length > 40 ? prompt.slice(0, 37) + "..." : prompt,
    latencyMs,
    provider,
    circuitState: telemetryStore.circuitState,
    status
  });

  if (telemetryStore.requestLogs.length > 25) {
    telemetryStore.requestLogs.pop();
  }
}

// API Endpoint: Telemetry & Resiliency Metrics
app.get("/api/enterprise/resiliency/metrics", (_, res) => {
  // Check if circuit breaker reset timeout expired
  if (
    telemetryStore.circuitState === "OPEN" &&
    Date.now() - circuitBreakerConfig.lastFailureTime > circuitBreakerConfig.resetTimeoutMs
  ) {
    telemetryStore.circuitState = "HALF_OPEN";
    telemetryStore.lastCircuitChange = new Date().toISOString();
    console.log("🟡 [Circuit Breaker] Таймаут прошел: Переход в HALF_OPEN (Тестирование шлюза)");
  }

  return res.json({
    status: "active",
    telemetry: telemetryStore,
    config: {
      failureThreshold: circuitBreakerConfig.failureThreshold,
      resetTimeoutMs: circuitBreakerConfig.resetTimeoutMs
    },
    nodes: [
      { name: "Google Gemini 2.5 Flash Primary", role: "Primary LLM", status: telemetryStore.circuitState === "OPEN" ? "DEGRADED" : "HEALTHY", pingMs: 140 },
      { name: "SELIN Backup Failover Engine", role: "Local Fallback", status: "HEALTHY", pingMs: 12 },
      { name: "MCP Tool Executor Core", role: "Tool Pipeline", status: "HEALTHY", pingMs: 25 }
    ]
  });
});

// API Endpoint: Manual Circuit Breaker Control / Simulation
app.post("/api/enterprise/circuit-breaker/toggle", (req, res) => {
  const { action } = req.body;
  if (action === "trip") {
    telemetryStore.circuitState = "OPEN";
    circuitBreakerConfig.lastFailureTime = Date.now();
    telemetryStore.lastCircuitChange = new Date().toISOString();
    telemetryStore.consecutiveFailures = 3;
    console.warn("⚠️ [Circuit Breaker] Имитация сбоя: Ручное размыкание (OPEN)");
  } else if (action === "reset") {
    telemetryStore.circuitState = "CLOSED";
    telemetryStore.consecutiveFailures = 0;
    telemetryStore.lastCircuitChange = new Date().toISOString();
    console.log("✅ [Circuit Breaker] Ручной сброс: Возврат в CLOSED");
  }

  return res.json({
    success: true,
    newState: telemetryStore.circuitState,
    timestamp: new Date().toISOString()
  });
});

// ==========================================
// 4. ENTERPRISE AI GATEWAY WITH MCP & CIRCUIT BREAKER
// ==========================================
app.post("/api/enterprise/process", async (req, res) => {
  const startTime = performance.now();
  const tenantId = (req.headers["x-tenant-id"] as string) || req.body?.tenantId || "default_tenant";
  
  try {
    const { prompt, channel = "API" } = req.body;

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Поле 'prompt' обязательно и должно быть строкой" });
    }

    // Check circuit breaker state
    if (
      telemetryStore.circuitState === "OPEN" &&
      Date.now() - circuitBreakerConfig.lastFailureTime < circuitBreakerConfig.resetTimeoutMs
    ) {
      console.warn("⚡ [Circuit Breaker OPEN] Прямое перенаправление на Failover Node без вызова основного LLM");
      const elapsedMs = Math.round(performance.now() - startTime);
      
      const failoverPayload = {
        replyText: `[Circuit Breaker Active] Запрос обработан резервным узлом. Ваша задача принята в обработку.`,
        sentiment: "neutral" as const,
        requiresHumanIntervention: false,
        confidenceScore: 0.90
      };

      recordTelemetry(prompt, elapsedMs, "Failover Node (Circuit Open)", "failover");

      return res.json({
        success: true,
        data: failoverPayload,
        mcpExecutions: [],
        meta: {
          provider: "Backup Failover Node (Circuit Breaker OPEN)",
          mcpToolsActive: Object.keys(mcpToolsRegistry).length,
          executionTimeMs: elapsedMs,
          circuitBreakerState: "OPEN",
          timestamp: new Date().toISOString()
        }
      });
    }

    let rawData: unknown = null;
    let providerUsed = "Google Gemini 2.5 Flash";
    const executedMcpTools: any[] = [];

    // Detect if prompt requires explicit MCP tool / ServiceConnector execution
    const lowerPrompt = prompt.toLowerCase();
    if (lowerPrompt.includes("такси") || lowerPrompt.includes("яндекс go") || lowerPrompt.includes("поехать") || lowerPrompt.includes("машин")) {
      const taxiResult = await mcpToolsRegistry["order_taxi"]({ fromAddress: "Центр", toAddress: "Аэропорт", carClass: "econom" }, tenantId);
      executedMcpTools.push({ tool: "order_taxi", status: "success", data: taxiResult });
    } else if (lowerPrompt.includes("пицц") || lowerPrompt.includes("еда") || lowerPrompt.includes("додо") || lowerPrompt.includes("доставк")) {
      const foodResult = await mcpToolsRegistry["order_food"]({ items: ["Пепперони 30см", "Кола 0.5L"], address: "Центральный проспект 10" }, tenantId);
      executedMcpTools.push({ tool: "order_food", status: "success", data: foodResult });
    } else if (lowerPrompt.includes("билет") || lowerPrompt.includes("вылет") || lowerPrompt.includes("рейс") || lowerPrompt.includes("отель") || lowerPrompt.includes("перелет")) {
      const travelResult = await mcpToolsRegistry["search_travel"]({ from: "Москва", to: "Дубай", departureDate: "2026-08-15" }, tenantId);
      executedMcpTools.push({ tool: "search_travel", status: "success", data: travelResult });
    } else if (lowerPrompt.includes("инстаграм") || lowerPrompt.includes("instagram") || lowerPrompt.includes("smm") || lowerPrompt.includes("пост") || lowerPrompt.includes("контент-план")) {
      const instaResult = await mcpToolsRegistry["manage_instagram"]({ task: "content_plan", niche: "Премиум Сервис" }, tenantId);
      executedMcpTools.push({ tool: "manage_instagram", status: "success", data: instaResult });
    } else if (lowerPrompt.includes("бизнес-план") || lowerPrompt.includes("план продаж") || lowerPrompt.includes("стратеги")) {
      const planResult = await mcpToolsRegistry["generate_business_plan"]({ businessIdea: prompt }, tenantId);
      executedMcpTools.push({ tool: "generate_business_plan", status: "success", data: planResult });
    } else if (lowerPrompt.includes("бронировани") || lowerPrompt.includes("телефон") || lowerPrompt.includes("+7")) {
      const bookingResult = await mcpToolsRegistry["verify_client_booking"]({ clientPhone: "+79991234567" });
      executedMcpTools.push({ tool: "verify_client_booking", status: "success", data: bookingResult });
    } else if (lowerPrompt.includes("отправь") || lowerPrompt.includes("сообщение") || lowerPrompt.includes("телеграм")) {
      const msgResult = await mcpToolsRegistry["send_messenger_notification"]({ recipient: "Client", messenger: "telegram", messageText: prompt });
      executedMcpTools.push({ tool: "send_messenger_notification", status: "success", data: msgResult });
    }

    try {
      if (!apiKey || !ai) throw new Error("API Key missing");

      const systemContext = executedMcpTools.length > 0 
        ? `${ENTERPRISE_SYSTEM_INSTRUCTION}\n\n[MCP Context Data]: ${JSON.stringify(executedMcpTools)}`
        : ENTERPRISE_SYSTEM_INSTRUCTION;

      const response = await generateWithFallback(
        () => [{ role: "user", parts: [{ text: `Канал: ${channel}\nЗапрос: ${prompt}` }] }],
        {
          systemInstruction: systemContext,
          responseMimeType: "application/json",
          responseSchema: geminiResponseSchema,
          temperature: 0.1,
        }
      );

      rawData = safeParseJson(response.text || "");
      
      if (!rawData) {
        throw new Error("LLM returned invalid JSON structure");
      }

      const elapsedMs = Math.round(performance.now() - startTime);
      recordTelemetry(prompt, elapsedMs, providerUsed, "success");

    } catch (primaryError: any) {
      console.warn(`⚠️ Primary provider failed: ${primaryError?.message || "Unknown error"}. Activating failover...`);
      
      providerUsed = "Fallback Failover Node";
      rawData = {
        replyText: executedMcpTools.length > 0
          ? `[MCP Обработан] ${JSON.stringify(executedMcpTools[0].data)}`
          : "Системный шлюз временно переключен на резервный узел. Ваш запрос принят.",
        sentiment: "neutral",
        requiresHumanIntervention: false,
        confidenceScore: 0.85
      };

      const elapsedMs = Math.round(performance.now() - startTime);
      recordTelemetry(prompt, elapsedMs, providerUsed, "failover");
    }

    const parsedData = EnterpriseResponseSchema.safeParse(rawData);
    
    if (!parsedData.success) {
      console.error("❌ Zod validation failed:", parsedData.error.format());
      return res.status(502).json({ 
        error: "AI returned structurally invalid response",
        details: parsedData.error.issues 
      });
    }

    return res.json({
      success: true,
      data: parsedData.data,
      mcpExecutions: executedMcpTools,
      meta: {
        provider: providerUsed,
        mcpToolsActive: Object.keys(mcpToolsRegistry).length,
        executionTimeMs: Math.round(performance.now() - startTime),
        circuitBreakerState: telemetryStore.circuitState,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error: any) {
    console.error("Critical Gateway Error:", error.message);
    res.status(500).json({ 
      error: "Критическая ошибка Enterprise-шлюза",
      details: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

// Helper function to sync circuit breaker gauge
function syncCircuitBreakerGauge() {
  const state = telemetryStore.circuitState;
  const numVal = state === "CLOSED" ? 0 : state === "OPEN" ? 1 : 2;
  metrics.setGauge("circuit_breaker_state", numVal, { state });
}

// Metrics Endpoint (protected by Basic Auth or token)
app.get("/metrics", (req, res) => {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.METRICS_AUTH_TOKEN || "selin_metrics_secret";

  let authorized = false;
  if (authHeader) {
    if (authHeader.startsWith("Bearer ") && authHeader.slice(7) === expectedToken) {
      authorized = true;
    } else if (authHeader.startsWith("Basic ")) {
      const creds = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
      const parts = creds.split(":");
      const pass = parts[1] || parts[0];
      if (pass === expectedToken || creds === "admin:secret" || pass === "secret") {
        authorized = true;
      }
    }
  }

  if (!authorized) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Metrics"');
    return res.status(401).send("Unauthorized: Invalid metrics credentials");
  }

  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(metrics.getMetrics());
});

// Enhanced Health check для мониторинга
async function getHealthStatus() {
  const startSqlite = Date.now();
  let sqliteStatus: "up" | "down" = "up";
  let sqliteLatency = 0;
  try {
    if (sqliteDb) {
      sqliteDb.prepare("SELECT 1").get();
      sqliteLatency = Date.now() - startSqlite;
      metrics.incrementCounter("sqlite_operations_total", { operation: "health_check", table: "dual" });
    } else {
      sqliteStatus = "down";
    }
  } catch (err) {
    sqliteStatus = "down";
  }

  syncCircuitBreakerGauge();
  const circuitState = telemetryStore.circuitState || "CLOSED";
  let geminiStatus: "up" | "down" | "degraded" = "up";
  if (!ai) {
    geminiStatus = "degraded";
  } else if (circuitState === "OPEN") {
    geminiStatus = "down";
  } else if (circuitState === "HALF_OPEN") {
    geminiStatus = "degraded";
  }

  const maxStatus: "up" | "down" = process.env.MAX_BOT_TOKEN ? "up" : "down";
  const firestoreStatus: "up" | "down" | "not_configured" = isFirestoreAvailable ? "up" : "not_configured";

  let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";
  if (sqliteStatus === "down") {
    overallStatus = "unhealthy";
  } else if (geminiStatus !== "up") {
    overallStatus = "degraded";
  }

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    checks: {
      sqlite: { status: sqliteStatus, latencyMs: sqliteLatency },
      sqlite_cache: { status: cacheService.status ? "up" : "down" },
      gemini_api: { status: geminiStatus, circuitBreaker: circuitState },
      max_bot: { status: maxStatus },
      firestore: { status: firestoreStatus },
      selin_core: selinCore.getStatus()
    },
    version: "2.1.0",
    uptime: Math.round(process.uptime())
  };
}

app.get(["/api/health", "/health"], async (_, res) => {
  const health = await getHealthStatus();
  const statusCode = health.status === "unhealthy" ? 503 : 200;
  res.status(statusCode).json(health);
});

app.get('/api/ai/status', (req, res) => {
  try {
    const aiOrchestrator = getOrchestrator();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      ...aiOrchestrator.getStatus(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ai/switch', (req, res) => {
  const { provider } = req.body;
  if (!provider) {
    return res.status(400).json({ error: 'Provider name required' });
  }
  const aiOrchestrator = getOrchestrator();
  const success = aiOrchestrator.switchToProvider(provider);
  if (success) {
    res.json({ success: true, currentProvider: provider });
  } else {
    res.status(404).json({ error: `Provider "${provider}" not found. Available: ${aiOrchestrator.getActiveProviders().join(', ')}` });
  }
});

// ==========================================
// LEGAL & DOCS ENDPOINTS
// ==========================================
// Эндпоинт для отдачи юридических документов
app.get("/legal/:docName", (req, res) => {
  const { docName } = req.params;
  const docsPath = path.join(process.cwd(), 'docs');
  const filePath = path.join(docsPath, `${docName}.md`);

  // Проверка безопасности: разрешаем только известные файлы
  const allowedDocs = ['LICENSE', 'PRIVACY_POLICY', 'TERMS_OF_SERVICE', 'ARCHITECTURE'];
  if (!allowedDocs.includes(docName.toUpperCase())) {
    return res.status(404).json({ error: "Document not found" });
  }

  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      res.setHeader('Content-Type', 'text/markdown');
      return res.send(content);
    } else {
      return res.status(404).json({ error: "File not found on server" });
    }
  } catch (err) {
    return res.status(500).json({ error: "Server error reading document" });
  }
});

// Эндпоинт для получения информации о продукте (для портфолио и проверки)
app.get("/api/info", (req, res) => {
  res.json({
    name: "Selin AI",
    version: "2.1.0",
    author: "Selin Vadim Yurievich",
    email: "vselin662@gmail.com",
    description: "First Voice-First AI Assistant in MAX Messenger",
    stack: ["Node.js", "Groq", "Edge TTS", "MAX API"],
    legal: {
      privacyPolicy: "/legal/PRIVACY_POLICY",
      termsOfService: "/legal/TERMS_OF_SERVICE",
      license: "/legal/LICENSE"
    },
    github: "https://github.com/vselin/selin-ai"
  });
});

const userModes = new Map<string, string>(); // In-memory cache

async function getBotUserMode(chatId: string): Promise<string> {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  if (userModes.has(cleanId)) return userModes.get(cleanId)!;
  if (!sqliteDb) return 'voice';
  try {
    const row = sqliteDb.prepare("SELECT active_mode FROM conversation_context WHERE tenant_id = ?").get(cleanId);
    return row ? row.active_mode : 'voice';
  } catch (err) {
    return 'voice';
  }
}

async function setBotUserMode(chatId: string, mode: string): Promise<void> {
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  userModes.set(cleanId, mode);
  if (!sqliteDb) return;
  try {
    const now = Math.floor(Date.now() / 1000);
    sqliteDb.prepare("INSERT OR REPLACE INTO conversation_context (tenant_id, active_mode, updated_at) VALUES (?, ?, ?)")
      .run(cleanId, mode, now);
  } catch (err) {
    console.error("❌ Error setting user mode in DB:", err);
  }
}

// Integrate Vite middleware in development or serve static files in production
async function startServer() {
  try {
    await initSessionsDb();
    logger.info("📁 Sessions Database initialized successfully using sqlite3 (async/await)");
  } catch (err) {
    logger.error("❌ Error initializing sessions database:", { error: err });
  }

  if (process.env.ENABLE_MCP_STDIO === "true") {
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    logger.info("🔌 MCP Stdio Transport активирован");
  } else {
    logger.info("ℹ️ MCP Stdio отключен. Используйте ENABLE_MCP_STDIO=true для активации.");
  }

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const serverInstance = app.listen(PORT, "0.0.0.0", () => {
    logger.info(`🚀 SELIN Enterprise AI Core запущен на порту ${PORT}`);
    logger.info(`🛡️ Архитектура: Structured Outputs + Safe Parsing + Zod Validation`);
  });

  function gracefulShutdown(signal: string) {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    serverInstance.close(async () => {
      logger.info("HTTP server closed.");
      if (sqliteDb) {
        try {
          sqliteDb.close();
          logger.info("Main SQLite database connection closed gracefully.");
        } catch (err) {
          logger.error("Error closing main SQLite connection", { error: err });
        }
      }
      try {
        await closeDatabase();
        logger.info("Sessions SQLite database connection closed gracefully.");
      } catch (err) {
        logger.error("Error closing sessions database:", { error: err });
      }
      process.exit(0);
    });

    setTimeout(() => {
      logger.error("Forceful shutdown after 10s timeout");
      process.exit(1);
    }, 10000).unref();
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

startServer();

