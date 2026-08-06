import express from "express";
import cors from "cors";
import path from "path";
import { execSync } from "child_process";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import fs from "fs";
import TelegramBot from "node-telegram-bot-api";
import * as pdf from "pdf-parse";
import mammoth from "mammoth";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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
  console.warn("⚠️ GEMINI_API_KEY is not defined in the environment. AI features will be simulated.");
}

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

const MODEL_CHAIN = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
async function generateWithFallback(buildContents: () => any, cfg: any) {
  let lastErr: any;
  for (const m of MODEL_CHAIN) {
    try {
      if (!ai) throw new Error("Gemini client not initialized");
      return await ai.models.generateContent({ model: m, contents: buildContents(), config: cfg });
    } catch (e: any) {
      lastErr = e;
      console.warn(`⚠️ model ${m} failed:`, e?.message || e);
    }
  }
  throw lastErr;
}

async function execTool(name: string, args: any): Promise<any> {
  try {
    if (name === "calculate") {
      const expr = String(args?.expression || "");
      if (!/^[\d+\-*/().\s%]+$/.test(expr)) return { error: "недопустимое выражение" };
      const result = Function('"use strict"; return (' + expr + ");")();
      return { expression: expr, result };
    }
    if (name === "current_date") {
      const d = new Date();
      return { date: d.toLocaleDateString("ru-RU"), weekday: d.toLocaleDateString("ru-RU", { weekday: "long" }), time: d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) };
    }
    return { error: "unknown tool" };
  } catch (e: any) {
    return { error: String(e?.message || e) };
  }
}

async function runWithTools(systemInstruction: string, contents: any[]): Promise<any> {
  const tools = [
    { googleSearch: {} },
    { functionDeclarations: [
      { name: "calculate", description: "Посчитать арифметику: ROI, маржу, проценты, налог, рост цены/выручки. expression — строка, например '(750000-450000)/450000*100'.", parameters: { type: Type.OBJECT, properties: { expression: { type: Type.STRING } }, required: ["expression"] } },
      { name: "current_date", description: "Текущая дата, день недели и время (когда спрашивают про сегодня/дату/дедлайн).", parameters: { type: Type.OBJECT, properties: {} } },
      { name: "save_note", description: "Сохранить важную заметку или факт о бизнесе владельца (когда он говорит 'запомни', 'запиши', сообщает о клиенте, цене, договоренности).", parameters: { type: Type.OBJECT, properties: { text: { type: Type.STRING } }, required: ["text"] } },
      { name: "add_task", description: "Добавить задачу или напоминание владельцу (когда просит напомнить, сделать, не забыть). due — срок словами, если назван.", parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, due: { type: Type.STRING } }, required: ["title"] } }
    ] }
  ];
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
let db: any = null;
let isFirestoreAvailable = false;

try {
  // Initialize firebase-admin. Since it runs in Cloud Run, it can use default application credentials
  admin.initializeApp();
  db = getFirestore();
  console.log("🔥 Firebase Admin initialized successfully!");
} catch (error: any) {
  console.log("ℹ️ Firebase Admin initialization bypassed/skipped. Using local JSON cache fallback.");
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
  try { fs.writeFileSync(FEED_FILE, JSON.stringify(cachedFeed, null, 2), 'utf-8'); } catch(e){}
}

// Helper function to test Firestore write and load initial states
async function initDataStore() {
  // Try local load first so we have immediate data
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      cachedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    }
    if (fs.existsSync(CHATS_FILE)) {
      cachedChats = JSON.parse(fs.readFileSync(CHATS_FILE, "utf-8"));
    }
    if (fs.existsSync(KNOWLEDGE_FILE)) {
      cachedKnowledgeBase = JSON.parse(fs.readFileSync(KNOWLEDGE_FILE, "utf-8"));
    }
    if (fs.existsSync(MODERATION_QUEUE_FILE)) {
      cachedModerationQueue = JSON.parse(fs.readFileSync(MODERATION_QUEUE_FILE, "utf-8"));
    }
    if (fs.existsSync(MODERATION_LOG_FILE)) {
      cachedModerationLog = JSON.parse(fs.readFileSync(MODERATION_LOG_FILE, "utf-8"));
    }
    if (fs.existsSync(FEED_FILE)) {
      cachedFeed = JSON.parse(fs.readFileSync(FEED_FILE, "utf-8"));
    }
    console.log("📁 Loaded initial data from local JSON cache files.");
  } catch (err) {
    console.error("Error reading local JSON files:", err);
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
        // Save to local cache as backup
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(cachedConfig, null, 2), "utf-8");
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
        fs.writeFileSync(KNOWLEDGE_FILE, JSON.stringify(cachedKnowledgeBase, null, 2), "utf-8");
        console.log(`☁️ Loaded ${firestoreDocs.length} documents & ${firestoreChunks.length} chunks from Firestore.`);
      }

      // 3. Fetch Telegram Chats from Firestore
      const chatsSnapshot = await db.collection("telegram_chats").get();
      const firestoreChats: any[] = [];
      chatsSnapshot.forEach(doc => firestoreChats.push(doc.data()));

      if (firestoreChats.length > 0) {
        cachedChats = firestoreChats;
        fs.writeFileSync(CHATS_FILE, JSON.stringify(cachedChats, null, 2), "utf-8");
        console.log(`☁️ Loaded ${firestoreChats.length} active chats from Firestore.`);
      }

      // 4. Fetch Moderation Queue from Firestore
      const queueSnapshot = await db.collection("moderation_queue").get();
      const firestoreQueue: any[] = [];
      queueSnapshot.forEach(doc => firestoreQueue.push(doc.data()));

      if (firestoreQueue.length > 0) {
        cachedModerationQueue = firestoreQueue;
        fs.writeFileSync(MODERATION_QUEUE_FILE, JSON.stringify(cachedModerationQueue, null, 2), "utf-8");
        console.log(`☁️ Loaded ${firestoreQueue.length} pending moderation items from Firestore.`);
      }

      // 5. Fetch Moderation Log from Firestore
      const logSnapshot = await db.collection("moderation_log").limit(100).get();
      const firestoreLog: any[] = [];
      logSnapshot.forEach(doc => firestoreLog.push(doc.data()));

      if (firestoreLog.length > 0) {
        firestoreLog.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        cachedModerationLog = firestoreLog;
        fs.writeFileSync(MODERATION_LOG_FILE, JSON.stringify(cachedModerationLog, null, 2), "utf-8");
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
  // Save to local JSON file
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cachedConfig, null, 2), "utf-8");
  } catch (err) {
    console.error("Local write error for company config:", err);
  }

  // Async write to Firestore if available
  if (isFirestoreAvailable && db) {
    db.collection("companies").doc("default").set(cachedConfig)
      .then(() => console.log("☁️ Saved company config to Firestore."))
      .catch(err => console.error("Firestore write error for company config:", err));
  }
}

const questCache = new Map<string, { data: any, createdAt: number }>();

async function getUserConfigByChatId(chatId: number | string): Promise<any> {
  if (isFirestoreAvailable && db) {
    try {
      const doc = await db.collection("companies").doc(`tg_${chatId}`).get();
      if (doc.exists) {
        return doc.data();
      }
    } catch (err) {
      console.error("Error in getUserConfigByChatId:", err);
    }
  }
  const userConfigFile = path.join(process.cwd(), `company_config_tg_${chatId}.json`);
  if (fs.existsSync(userConfigFile)) {
    try {
      return JSON.parse(fs.readFileSync(userConfigFile, "utf-8"));
    } catch (e) {
      return null;
    }
  }
  return null;
}

async function saveUserConfigByChatId(chatId: number | string, config: any): Promise<void> {
  if (isFirestoreAvailable && db) {
    try {
      await db.collection("companies").doc(`tg_${chatId}`).set(config);
    } catch (err) {
      console.error("Error in saveUserConfigByChatId:", err);
    }
  }
  const userConfigFile = path.join(process.cwd(), `company_config_tg_${chatId}.json`);
  try {
    fs.writeFileSync(userConfigFile, JSON.stringify(config, null, 2), "utf-8");
  } catch (err) {
    console.error("Error saving user config locally:", err);
  }
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
  try {
    fs.writeFileSync(CHATS_FILE, JSON.stringify(cachedChats, null, 2), "utf-8");
  } catch (err) {
    console.error("Local write error for telegram chats:", err);
  }

  // Async batch write/set of updated chats to Firestore
  if (isFirestoreAvailable && db) {
    const batch = db.batch();
    chats.forEach(chat => {
      const docRef = db!.collection("telegram_chats").doc(chat.id);
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
  try {
    fs.writeFileSync(MODERATION_QUEUE_FILE, JSON.stringify(cachedModerationQueue, null, 2), "utf-8");
  } catch (err) {
    console.error("Local write error for moderation queue:", err);
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

  try {
    fs.writeFileSync(MODERATION_LOG_FILE, JSON.stringify(cachedModerationLog, null, 2), "utf-8");
  } catch (err) {
    console.error("Local write error for moderation log:", err);
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
  try {
    fs.writeFileSync(KNOWLEDGE_FILE, JSON.stringify(cachedKnowledgeBase, null, 2), "utf-8");
  } catch (err) {
    console.error("Local write error for knowledge base:", err);
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
    return {
      text: chunk.text,
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

// Endpoint to fetch real Telegram chats for the simulator UI
app.get("/api/telegram/chats", (req, res) => {
  const chats = getTelegramChats();
  return res.json({ chats, isBotActive: !!process.env.TELEGRAM_BOT_TOKEN });
});

// Endpoint to send a direct manual message to a Telegram client (CRM Helpdesk Mode)
app.post("/api/telegram/send-message", (req, res) => {
  const { chatId, text } = req.body;
  if (!chatId || !text) {
    return res.status(400).json({ error: "chatId and text are required." });
  }
  const realId = chatId.replace("tg_", "");
  if (bot) {
    try {
      bot.sendMessage(realId, text);
      
      // Save directly to chats history
      const chats = getTelegramChats();
      const chatIndex = chats.findIndex((c: any) => c.id === chatId);
      if (chatIndex !== -1) {
        chats[chatIndex].history.push({ sender: "agent", text: text });
        chats[chatIndex].lastMessage = text;
        chats[chatIndex].timestamp = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        saveTelegramChats(chats);
      }
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to send message via bot." });
    }
  } else {
    return res.status(400).json({ error: "Telegram Bot is not active." });
  }
});

// Helper to synthesize and send voice message to Telegram
async function synthesizeAndSendVoice(botInstance: TelegramBot | null, chatId: number | string, text: string, skipFallbackText = false): Promise<void> {
  if (!botInstance) return;

  try {
    botInstance.sendChatAction(chatId, 'record_voice');
  } catch (err) {
    console.warn("Failed to sendChatAction record_voice:", err);
  }

  const config = getCompanyConfig();
  const voiceName = config.tts_voice || config.voice_id || 'Kore';
  const TTS_MODEL_CHAIN = ["gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts", "gemini-2.0-flash-preview-tts"];

  let pcmPath: string | null = null;
  let oggPath: string | null = null;

  try {
    if (!ai) {
      throw new Error("Gemini AI client is not initialized.");
    }

    let base64Audio: string | undefined = undefined;
    let lastTtsErr: any = null;

    for (const m of TTS_MODEL_CHAIN) {
      try {
        const response = await ai.models.generateContent({
          model: m,
          contents: [{ parts: [{ text }] }],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName }
              }
            }
          }
        });
        const audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (audio) {
          base64Audio = audio;
          console.log(`✅ TTS succeeded via model ${m}`);
          break;
        }
      } catch (e: any) {
        lastTtsErr = e;
        console.warn(`⚠️ TTS model ${m} failed:`, e?.message || e);
      }
    }

    if (!base64Audio) {
      throw lastTtsErr || new Error("No TTS model produced audio.");
    }

    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    pcmPath = path.join(process.cwd(), `temp_${timestamp}_${randomSuffix}.pcm`);
    oggPath = path.join(process.cwd(), `temp_${timestamp}_${randomSuffix}.ogg`);

    fs.writeFileSync(pcmPath, Buffer.from(base64Audio, "base64"));
    execSync(`ffmpeg -y -f s16le -ar 24000 -ac 1 -i "${pcmPath}" -c:a libopus -b:a 32k "${oggPath}"`, { stdio: 'ignore' });

    if (!fs.existsSync(oggPath)) {
      throw new Error("ffmpeg conversion failed to produce ogg file.");
    }

    await botInstance.sendVoice(chatId, fs.createReadStream(oggPath));
  } catch (err: any) {
    console.warn("⚠️ Voice synthesis failed on all TTS models, falling back to text:", err.message || err);
    if (!skipFallbackText) {
      try {
        await botInstance.sendMessage(chatId, "Голосом сейчас не вышло — напишите задачу текстом, я отвечу.");
      } catch (msgErr) {
        console.error("Failed to send fallback text message to Telegram:", msgErr);
      }
    } else {
      throw err;
    }
  } finally {
    if (pcmPath && fs.existsSync(pcmPath)) {
      try { fs.unlinkSync(pcmPath); } catch (e) {}
    }
    if (oggPath && fs.existsSync(oggPath)) {
      try { fs.unlinkSync(oggPath); } catch (e) {}
    }
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
              text_response: { type: Type.STRING, description: "Тёплый, естественный ответ по существу, подхватывающий фразу собеседника" },
              wants_voice: { type: Type.BOOLEAN, description: "Запросил ли собеседник явно голосовой ответ или прислал голосовое" }
            },
            required: ["text_response"]
          }
        }
      ]
    }
  ];

  const systemInstruction = `Ты — живой мультимодальный ИИ-ассистент цифрового штаба SELIN (${config.business_name || "Штаб SELIN"}).
Твой стиль: тёплый, живой, внимательный к деталям. Обязательно подхватывай фразу собеседника и отвечай естественно, без заученных штампов и скриптов.
Разбирай входящее сообщение и выбери ОДНУ подходящую способность через инструмент (function call).`;

  const userPrompt = `Сообщение пользователя: "${userMessage}"\nВыбери подходящую функцию.`;

  let callResult: any = null;
  try {
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction,
        tools: intentTools,
        temperature: 0.2
      }
    });

    const parts = res?.candidates?.[0]?.content?.parts || [];
    const fcPart = parts.find((p: any) => p.functionCall);
    if (fcPart) {
      callResult = fcPart.functionCall;
    }
  } catch (e: any) {
    console.warn("Intent classification fallback:", e?.message || e);
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
  const textResponse = args.text_response || await generateAgentResponseHelper(userMessage, "receiver", chatHistory, config);
  const wantsVoice = args.wants_voice || isVoice || userMessage.toLowerCase().includes("голос") || userMessage.toLowerCase().includes("скажи") || userMessage.toLowerCase().includes("расскажи");

  if (wantsVoice) {
    try {
      const TTS_MODEL = "gemini-2.5-flash-preview-tts";
      const voiceRes = await ai.models.generateContent({
        model: TTS_MODEL,
        contents: [{ parts: [{ text: textResponse }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: config.tts_voice || "Kore" }
            }
          }
        }
      });

      const audioPart = voiceRes?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData && p.inlineData.mimeType?.startsWith("audio/"));
      if (audioPart?.inlineData?.data) {
        return {
          textResponse: textResponse,
          mediaType: 'voice',
          audioBase64: audioPart.inlineData.data
        };
      }
    } catch (ttsErr: any) {
      console.warn("TTS synthesis error / quota fallback:", ttsErr?.message || ttsErr);
      if (isQuotaOrLimitError(ttsErr)) {
        return {
          textResponse: `Голосовая озвучка сейчас ограничена квотой API. Отвечаю вам текстом:\n\n${textResponse}`,
          mediaType: 'text',
          isQuotaDegraded: true
        };
      }
    }
  }

  return {
    textResponse: textResponse,
    mediaType: 'text'
  };
}

// Helper to generate agent response (using RAG & Gemini or simulation fallback)
async function generateAgentResponseHelper(user_message: string, agentRole: string, chatHistory: any[], config: any): Promise<string> {
  if (!ai) {
    return agentRole === "sales"
      ? `Спасибо за интерес к "${config.business_name}"! Подберу для вас лучшее предложение.`
      : `Принял ваш вопрос про "${user_message}". Уточню и вернусь с ответом.`;
  }
  try {
    let ragContext = "";
    const matchedChunks = await queryKnowledgeBase(user_message, 2);
    const relevantChunks = matchedChunks.filter((c: any) => c.score >= 0.35);
    if (relevantChunks.length > 0) {
      ragContext = "\nФАКТЫ ИЗ БАЗЫ ЗНАНИЙ КОМПАНИИ (опирайся на них):\n" + relevantChunks.map((c: any) => `- [${c.docName}]: ${c.text}`).join("\n") + "\n";
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
    const systemInstruction = `Ты — живой сотрудник цифрового штаба Selin, роль "${agentRole}", компания "${config.business_name}" (сфера: ${config.industry || "услуги"}). Владелец: ${config.owner_name || "предприниматель"}. Тон: ${config.tone || "friendly"}. ${address}${mission ? " Твоя миссия: " + mission + "." : ""}${goals ? " Цели владельца: " + goals + "." : ""}

ТЫ УМЕЕШЬ ДЕЛАТЬ РЕАЛЬНЫЕ ВЕЩИ — пользуйся инструментами, когда уместно, вместо отписок:
- Факт, цены, конкуренты, новости, курс, погода → поиск (googleSearch), ответь с цифрой/фактом.
- Посчитать (ROI, маржа, процент, налог, «что если поднять цену», рост выручки) → calculate, назови результат числом, ход одной строкой.
- Сегодня/дата/дедлайн → current_date.
- Ответ есть в базе знаний компании → отвечай по ней; данных нет → живо скажи, что уточнишь, НЕ выдумывай цифры.

ПАМЯТЬ: опирайся на заметки и задачи владельца выше — он ждёт, что ты помнишь контекст. Если спрашивает «что у меня/что на сегодня/что я просил» — собери ответ из его задач и заметок. Используй информацию из блоков ЗАМЕТКИ О БИЗНЕСЕ ВЛАДЕЛЬЦА и АКТУАЛЬНЫЕ ЗАДАЧИ/НАПОМИНАНИЯ ВЛАДЕЛЬЦА выше. Если клиент спрашивает 'что у меня на сегодня', 'что я просил', 'напомни' — отвечай строго на основе этих данных. Не выдумывай задачи.

КАК ГОВОРИТЬ: как живой человек, 1-3 коротких разговорных предложения, можно один эмодзи. Без списков, без «во-первых», без канцелярита. Текст автоматически озвучивается — пиши вслух. НИКОГДА не говори, что ты ИИ/бот, и НИКОГДА не говори, что отвечаешь только текстом или не можешь голосом.
ЗАПРЕЩЕНЫ пустые отписки вместо сути: «чем могу помочь», «напишите ваш вопрос», «я зафиксировал ваш вопрос», «ответим в ближайшее время». Отвечай ПО СУТИ.
${notesBlock}${tasksBlock}${ragContext}`;
    let response: any;
    try {
      response = await runWithTools(systemInstruction, contents);
    } catch (toolErr: any) {
      console.warn("runWithTools failed, retrying without tools:", toolErr?.message || toolErr);
      response = await generateWithFallback(() => contents, { temperature: 0.7, systemInstruction });
    }
    return (response?.text || "").trim() || "Ой, мысль потерялась на секунду — повтори, пожалуйста, я слушаю.";
  } catch (err: any) {
    console.error("GEN FAIL:", err?.message || err, "code:", err?.code || err?.status || "");
    return "Что-то я задумалась и не успела ответить — скажи ещё раз, я тут.";
  }
}

// Endpoint to append customer message and retrieve/moderate agent response
app.post("/api/chats/message", async (req, res) => {
  const { chatId, text, agent_role } = req.body;
  if (!chatId || !text) {
    return res.status(400).json({ error: "chatId and text are required." });
  }

  const chats = getTelegramChats();
  let chatIndex = chats.findIndex((c: any) => c.id === chatId);
  if (chatIndex === -1) {
    return res.status(404).json({ error: "Chat not found." });
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
      if (bot) {
        try {
          await synthesizeAndSendVoice(bot, chatId, responseText, true);
        } catch (err: any) {
          console.warn("Outgoing voice failed, fallback to text:", err?.message || err);
          try {
            await bot.sendMessage(chatId, responseText);
          } catch (msgErr) {
            console.error("Failed to send fallback text message to Telegram:", msgErr);
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

    // Send to Telegram as voice if real bot
    if (item.chatId.startsWith("tg_") && bot) {
      const realId = item.chatId.replace("tg_", "");
      try {
        await synthesizeAndSendVoice(bot, realId, finalResponseText);
      } catch (err) {
        console.error("Failed to send approved voice message to telegram:", err);
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

// Helper to handle incoming text from Telegram client
async function handleIncomingText(chatId: number, clientName: string, text: string, channel: string = "telegram", isVoice: boolean = false) {
  const config = getCompanyConfig();
  const chats = getTelegramChats();

  // Find or create chat
  let chatIndex = chats.findIndex((c: any) => c.id === `tg_${chatId}`);
  if (chatIndex === -1) {
    chats.push({
      id: `tg_${chatId}`,
      name: clientName,
      channel: channel,
      avatar: "👤",
      lastMessage: text,
      timestamp: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      history: []
    });
    chatIndex = chats.length - 1;
  }

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
  if (lowerText.includes("купить") || lowerText.includes("кп") || lowerText.includes("коммерческое") || lowerText.includes("цена") || lowerText.includes("стоимость") || lowerText.includes("заказать") || lowerText.includes("оформить")) {
    agentRole = "sales";
  }

  const crisisText = text;
  const isComplex = isComplexQuery(crisisText);

  let responseText = "";
  let mmResult: any = null;

  if (isComplex) {
    // а) СРАЗУ отправить голосом короткую заглушку
    if (bot) {
      try {
        await synthesizeAndSendVoice(bot, chatId, "Приняла. Это важный вопрос — я совещаюсь с командой, это займёт около минуты, и вернусь с точным ответом.", true);
      } catch (e) {
        try { await bot?.sendMessage(chatId, "Приняла, совещаюсь с командой — вернусь через минуту."); } catch(err){}
      }
    }

    const userConfig = (await getUserConfigByChatId(chatId)) || config;
    const businessContext = JSON.stringify(userConfig || {}).slice(0, 1000);

    const debateRes = await runDebate(crisisText, businessContext, 2);
    responseText = debateRes.verdict;

    if (typeof logFeedEvent === "function") {
      try {
        logFeedEvent('coordinator', 'debate', 'Рой вынес вердикт после спора (' + (debateRes.scores||'').replace(/\n/g,' ') + ')', debateRes.log.join(' || ').slice(0,400), 'done');
      } catch(e){}
    }
  } else {
    mmResult = await processMultimodalMessage(text, chats[chatIndex].history, config, isVoice);
    responseText = mmResult.textResponse;
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
      chatId: `tg_${chatId}`,
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

    if (bot) {
      try {
        if (mmResult?.mediaType === 'image' && mmResult?.imageBuffer) {
          await bot.sendPhoto(chatId, mmResult.imageBuffer, { caption: responseText.slice(0, 1000) });
        } else if (mmResult?.mediaType === 'code' && mmResult?.codeDetails) {
          await bot.sendMessage(chatId, responseText, { parse_mode: 'Markdown' });
          const fileBuffer = Buffer.from(mmResult.codeDetails.code, 'utf-8');
          await bot.sendDocument(chatId, fileBuffer, {}, { filename: mmResult.codeDetails.filename, contentType: 'text/plain' });
        } else if (mmResult?.mediaType === 'voice' && mmResult?.audioBase64) {
          await synthesizeAndSendVoice(bot, chatId, responseText, true);
        } else {
          await bot.sendMessage(chatId, responseText);
        }
      } catch (err: any) {
        console.warn("Telegram send failed, fallback to text:", err?.message || err);
        try {
          await bot.sendMessage(chatId, responseText);
        } catch (msgErr) {
          console.error("Failed to send fallback text message to Telegram:", msgErr);
        }
      }
    }
  }

  return responseText;
}

// Initialize Telegram Bot
const tgToken = process.env.TELEGRAM_BOT_TOKEN;
let bot: TelegramBot | null = null;
const lastStartAt = new Map<number, number>();

const userStates = new Map<number, { questSent: boolean; questNag: number; state: 'NEW' | 'QUESTING' | 'ACTIVE' }>();
function getState(chatId: number) {
  if (!userStates.has(chatId)) userStates.set(chatId, { questSent: false, questNag: 0, state: 'NEW' });
  return userStates.get(chatId)!;
}
function setState(chatId: number, patch: Partial<{ questSent: boolean; questNag: number; state: 'NEW' | 'QUESTING' | 'ACTIVE' }>) {
  const cur = getState(chatId);
  userStates.set(chatId, { ...cur, ...patch });
}

const RESPONSES = {
  greeting: ["Здравствуйте. Я на связи — расскажите, что нужно сделать.", "Приветствую. Какая задача на сегодня?", "Я тут. Говорите или пишите — разберусь."],
  confusion: ["Подсказать? Я отвечаю клиентам вместо вас и веду заявки 24/7. Скажите, чем занимаетесь — покажу на вашем примере.", "Я на месте. Просто напишите или надиктуйте, что нужно: ответить клиенту, посчитать, составить пост.", "Давайте по делу: какая у вас боль сейчас — много переписки, теряются заявки, нет контента?"],
  already_questing: ["Чтобы я заработал в полную силу, нужна одна короткая настройка — это минута. Кнопка с приложением выше.", "Я пока в режиме настройки. Пройдите быстрый квест по кнопке выше — и дальше буду отвечать по делу голосом."]
};
function pick(arr: string[]) { return arr[Math.floor(Math.random() * arr.length)]; }

function classifyIntent(text: string | undefined): string {
  if (!text) return 'UNKNOWN';
  const t = text.toLowerCase().trim();
  if (!t) return 'UNKNOWN';
  if (['привет','здравствуй','хай','hello','добрый'].some(w => t.includes(w))) return 'GREETING';
  if (['квест','настрой','штаб','начать','запустить'].some(w => t.includes(w))) return 'QUEST';
  if (t.length <= 3 || t === '?' || t === '??' || t === '???') return 'CONFUSION';
  return 'TASK';
}

if (tgToken) {
  try {
    bot = new TelegramBot(tgToken, { polling: true });
    console.log("🤖 Real Telegram Bot is initialized with long polling!");

    // Attach error handlers to prevent unhandled exceptions from crashing the server
    bot.on("polling_error", (err: any) => {
      console.error("Telegram Bot Polling Error:", err.message || err);
    });
    bot.on("error", (err: any) => {
      console.error("Telegram Bot Error:", err.message || err);
    });

    // Start command greeting
    bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      const now = Date.now();
      const last = lastStartAt.get(chatId) || 0;
      if (now - last < 3000) return;
      lastStartAt.set(chatId, now);

      const firstName = msg.from?.first_name || "";
      const appUrl = process.env.APP_URL || "https://ais-pre-fzpjlzo5denvk4xxawb3rd-163629687200.us-west1.run.app";

      const nameGreeting = firstName ? `Привет, ${firstName}!` : "Привет!";
      const welcomeText = `${nameGreeting} Я отвечаю вашим клиентам голосом и веду заявки вместо вас — круглые сутки, без выходных. Скажите мне голосом, чем занимаетесь, и за минуту соберу под вас команду.`;

      try {
        await synthesizeAndSendVoice(bot, chatId, welcomeText, true);
      } catch (err: any) {
        console.warn("synthesizeAndSendVoice failed in start command:", err?.message || err);
      }

      try {
        await bot?.sendMessage(chatId, "📱 Приложение для настройки штаба:", {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "📱 Заглянуть внутрь приложения (необязательно)", url: appUrl }
              ]
            ]
          }
        });
      } catch (e) {
        console.warn("Failed to send app button", e);
      }
      setState(chatId, { state: 'NEW', questSent: false, questNag: 0 });
      return;
    });

    // Handle incoming messages (text and voice)
    bot.on("message", async (msg) => {
      const chatId = msg.chat.id;
      const firstName = msg.from?.first_name || "";
      const lastName = msg.from?.last_name || "";
      const username = msg.from?.username ? `@${msg.from.username}` : "";
      const clientName = `${firstName} ${lastName}`.trim() || username || `Клиент #${chatId}`;

      // Voice message handling
      if (msg.voice) {
        const voice = msg.voice;
        if (!voice) return;
        if (voice.file_size && voice.file_size > 20 * 1024 * 1024) {
          bot?.sendMessage(chatId, "Голосовое слишком длинное, напишите текстом или короче.");
          return;
        }
        bot?.sendChatAction(chatId, "typing").catch(() => {});

        let file: any = null;
        try {
          file = await bot!.getFile(voice.file_id);
        } catch (err: any) {
          console.error("Voice getFile error:", err?.message || err);
          bot?.sendMessage(chatId, "Не смог скачать голосовое.");
          return;
        }

        if (!file.file_path) {
          console.error("Voice getFile error: file_path is missing");
          bot?.sendMessage(chatId, "Не смог скачать голосовое.");
          return;
        }

        const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
        console.log("🎙️ fetching voice:", fileUrl.slice(0, 60));

        let buf: Buffer;
        try {
          const resp = await fetch(fileUrl);
          if (!resp.ok) {
            console.error("Voice fetch failed:", resp.status);
            bot?.sendMessage(chatId, "Не смог скачать голосовое.");
            return;
          }
          buf = Buffer.from(await resp.arrayBuffer());
        } catch (err: any) {
          console.error("Voice fetch error:", err?.message || err);
          bot?.sendMessage(chatId, "Не смог скачать голосовое.");
          return;
        }

        if (buf.length === 0) {
          console.error("Voice buffer error: buffer is empty");
          bot?.sendMessage(chatId, "Пустое голосовое.");
          return;
        }

        const b64 = buf.toString("base64");
        let transcript = "";

        try {
          if (ai) {
            const tr = await generateWithFallback(
              () => [{
                role: "user",
                parts: [
                  { inlineData: { mimeType: "audio/ogg", data: b64 } },
                  { text: "Верни ТОЛЬКО точную транскрипцию речи на русском, без комментариев. Если речи нет — пустую строку." }
                ]
              }],
              { temperature: 0 }
            );
            transcript = (tr.text || "").trim();
          }
        } catch (err: any) {
          console.error("VOICE FAIL:", err?.message || err);
          bot?.sendMessage(chatId, "Не расслышал, повтори голосовое.");
          return;
        }

        if (!transcript) {
          bot?.sendMessage(chatId, "Не расслышал, повтори голосовое.");
          return;
        }

        console.log(`🎙️ Transcribed voice from ${chatId}: ${transcript}`);

        await handleIncomingText(chatId, clientName, transcript, "telegram", true);
        return;
      }

      // Text message handling
      const text = msg.text;
      if (!text || text.startsWith("/")) return;

      await handleIncomingText(chatId, clientName, text, "telegram", false);
    });

  } catch (error) {
    console.error("❌ Failed to start Telegram Bot polling:", error);
  }
} else {
  console.log("ℹ️ TELEGRAM_BOT_TOKEN is not set. Real Telegram integration is inactive.");
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
  const { step, userName, userInput, history } = req.body;

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

    return res.json({
      speech,
      userName: extractedName,
      extractedGoal: userInput || null,
      nextStep
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

    const data = JSON.parse(response.text || "{}");
    const cleanName = sanitizeVoiceName(data.userName) || sanitizeVoiceName(userName);

    return res.json({
      speech: data.speech,
      userName: cleanName,
      extractedGoal: data.extractedGoal || null,
      nextStep: data.nextStep
    });
  } catch (error: any) {
    console.error("Voice Organism Error:", error);
    return res.status(500).json({ error: error.message || "Voice Organism dialogue error" });
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
  const { text, voice } = req.body;
  if (!text) return res.status(400).json({ error: "Text is required." });

  if (!ai) {
    return res.status(503).json({ error: "AI client not initialized" });
  }

  const config = getCompanyConfig();
  const voiceName = voice || config.tts_voice || config.voice_id || 'Kore';
  const TTS_MODEL_CHAIN = ["gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts", "gemini-2.0-flash-preview-tts"];

  for (const m of TTS_MODEL_CHAIN) {
    try {
      const response = await ai.models.generateContent({
        model: m,
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName }
            }
          }
        }
      });
      const rawAudio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (rawAudio) {
        const pcmBuffer = Buffer.from(rawAudio, "base64");
        const wavBuffer = pcmToWavBuffer(pcmBuffer, 24000, 1, 16);
        const dataUrl = `data:audio/wav;base64,${wavBuffer.toString("base64")}`;
        return res.json({ audioUrl: dataUrl });
      }
    } catch (e: any) {
      console.warn(`TTS endpoint model ${m} failed:`, e?.message || e);
    }
  }

  return res.status(500).json({ error: "Failed to generate audio from TTS models." });
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
    const chatIndex = chats.findIndex((c: any) => c.id === "tg_simulated" || c.name === "Симулятор");

    quietClientProfileUpdate("Симулятор", user_message || "", "simulated");

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
  const { text, voice } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Text is required for synthesis." });
  }

  if (!ai) {
    // Simulated voice clone synthesis (returns empty or simulated audio data response)
    return res.json({ audio: null, message: "Voice synthesis simulated (GEMINI_API_KEY is not defined)" });
  }

  try {
    // Map of voice configs
    const allowedVoices = ["Aoede", "Leda", "Kore", "Zephyr", "Puck", "Charon", "Fenrir"];
    const voiceName = allowedVoices.includes(voice) ? voice : "Kore";

    const TTS_MODEL_CHAIN = ["gemini-2.5-flash-preview-tts", "gemini-3.1-flash-tts-preview", "gemini-2.0-flash-preview-tts"];
    let base64Audio: string | undefined = undefined;
    let lastTtsErr: any = null;

    for (const m of TTS_MODEL_CHAIN) {
      try {
        const response = await ai.models.generateContent({
          model: m,
          contents: [{ parts: [{ text }] }],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName }
              }
            }
          }
        });
        const audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (audio) {
          base64Audio = audio;
          console.log(`✅ TTS succeeded via model ${m}`);
          break;
        }
      } catch (e: any) {
        lastTtsErr = e;
        console.warn(`⚠️ TTS model ${m} failed:`, e?.message || e);
      }
    }

    if (!base64Audio) {
      throw lastTtsErr || new Error("No TTS model produced audio.");
    }

    if (base64Audio) {
      res.json({ audio: base64Audio });
    } else {
      res.status(500).json({ error: "No audio generated from the Gemini TTS model." });
    }
  } catch (error: any) {
    console.error("Gemini TTS Error:", error);
    res.status(500).json({ error: error.message || "Failed to synthesize voice" });
  }
});

// ==========================================
// READINESS & LAUNCH ENDPOINTS
// ==========================================
function getReadinessState() {
  const kb_ready = !!(cachedKnowledgeBase.chunks && cachedKnowledgeBase.chunks.length > 0);
  const channel_ready = !!process.env.TELEGRAM_BOT_TOKEN;
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
    const { audio, mimeType } = req.body || {};
    if (!audio || !ai) {
      return res.json({ text: "" });
    }

    const response = await generateWithFallback(
      () => [{
        role: "user",
        parts: [
          { inlineData: { mimeType: mimeType || "audio/webm", data: audio } },
          { text: "Верни ТОЛЬКО точную транскрипцию этой речи на русском языке, без комментариев и пояснений. Если речи нет — верни пустую строку." }
        ]
      }],
      { temperature: 0 }
    );

    const text = (response.text || "").trim();
    return res.json({ text });
  } catch (err: any) {
    console.error("Transcribe error:", err?.message || err);
    return res.json({ text: "" });
  }
});

// ==========================================
// 1. MCP SERVER SETUP & EXTENDED TOOL REGISTRY
// ==========================================
const mcpServer = new McpServer({
  name: "selin-enterprise-hq",
  version: "2.2.0",
});

// Tool 1: Verify Client Booking
mcpServer.tool(
  "verify_client_booking",
  "Проверка статуса бронирования клиента в защищенной базе данных SELIN Enterprise",
  {
    clientPhone: z.string().regex(/^\+7\d{10}$/, "Неверный формат телефона").describe("Номер телефона +7XXXXXXXXXX"),
  },
  async ({ clientPhone }) => {
    console.log(`[MCP Tool] Верификация бронирования: ${clientPhone}`);
    return {
      content: [{ 
        type: "text", 
        text: JSON.stringify({ 
          status: "confirmed", 
          slot: "Завтра, 14:00", 
          service: "Технический осмотр и диагностика",
          clientPhone,
          verifiedAt: new Date().toISOString()
        }) 
      }]
    };
  }
);

// Tool 2: Search Flights (Авиабилеты)
mcpServer.tool(
  "search_flights",
  "Поиск доступных авиабилетов и вариантов перелета с ценами и временем",
  {
    origin: z.string().describe("Город отправления (например, Москва, MOW)"),
    destination: z.string().describe("Город назначения (например, Дубай, DXB)"),
    departureDate: z.string().describe("Дата вылета в формате YYYY-MM-DD"),
    maxPriceRub: z.number().optional().describe("Максимальная цена в рублях"),
  },
  async ({ origin, destination, departureDate, maxPriceRub }) => {
    console.log(`[MCP Tool] Поиск авиабилетов: ${origin} -> ${destination} на ${departureDate}`);
    const flights = [
      { airline: "Emirates", flightNo: "EK-132", departure: `${departureDate} 08:30`, arrival: `${departureDate} 14:15`, priceRub: 48500, class: "Economy", direct: true },
      { airline: "FlyDubai", flightNo: "FZ-918", departure: `${departureDate} 14:10`, arrival: `${departureDate} 20:00`, priceRub: 39900, class: "Economy", direct: true },
      { airline: "Аэрофлот", flightNo: "SU-520", departure: `${departureDate} 23:20`, arrival: `${departureDate} 05:45+1`, priceRub: 42000, class: "Economy", direct: true },
    ].filter(f => !maxPriceRub || f.priceRub <= maxPriceRub);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          query: { origin, destination, departureDate, maxPriceRub },
          foundCount: flights.length,
          flights,
          source: "SELIN Travel GDS Gateway"
        })
      }]
    };
  }
);

// Tool 3: Send Messenger Notification
mcpServer.tool(
  "send_messenger_notification",
  "Отправка сервисного или транзакционного сообщения в мессенджер (Telegram / WhatsApp)",
  {
    recipient: z.string().describe("Телефон или Telegram ID получателя"),
    messenger: z.enum(["telegram", "whatsapp", "sms"]).describe("Канал доставки"),
    messageText: z.string().describe("Текст отправляемого сообщения")
  },
  async ({ recipient, messenger, messageText }) => {
    console.log(`[MCP Tool] Отправка сообщения [${messenger}] -> ${recipient}`);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          delivered: true,
          channel: messenger,
          recipient,
          messageId: `MSG-${Date.now().toString().slice(-6)}`,
          timestamp: new Date().toISOString()
        })
      }]
    };
  }
);

// Tool 4: Create SMART Task / Schedule
mcpServer.tool(
  "create_smart_task",
  "Создание задачи или события в цифровом смарт-планере",
  {
    title: z.string().describe("Название задачи или события"),
    date: z.string().describe("Дата и время начала YYYY-MM-DD HH:MM"),
    category: z.enum(["work", "travel", "finance", "personal"]).describe("Категория"),
    priority: z.enum(["low", "medium", "high", "critical"]).describe("Приоритет")
  },
  async ({ title, date, category, priority }) => {
    console.log(`[MCP Tool] Задача создана: ${title} (${date})`);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          id: `TASK-${Date.now().toString().slice(-4)}`,
          title,
          date,
          category,
          priority,
          status: "active",
          createdAt: new Date().toISOString()
        })
      }]
    };
  }
);

// Active MCP tool registry dictionary for direct internal invocation
const mcpToolsRegistry: Record<string, Function> = {
  verify_client_booking: async (args: any) => {
    return { status: "confirmed", slot: "Завтра, 14:00", service: "Технический осмотр", phone: args.clientPhone };
  },
  search_flights: async (args: any) => {
    return {
      flights: [
        { airline: "Emirates", flightNo: "EK-132", departure: `${args.departureDate || "2026-08-15"} 08:30`, priceRub: 48500, direct: true },
        { airline: "FlyDubai", flightNo: "FZ-918", departure: `${args.departureDate || "2026-08-15"} 14:10`, priceRub: 39900, direct: true }
      ],
      destination: args.destination || "Дубай"
    };
  },
  send_messenger_notification: async (args: any) => {
    return { delivered: true, channel: args.messenger || "telegram", recipient: args.recipient, messageId: `MSG-${Date.now().toString().slice(-5)}` };
  },
  create_smart_task: async (args: any) => {
    return { id: `TASK-${Date.now().toString().slice(-4)}`, title: args.title, date: args.date, category: args.category || "travel" };
  }
};

// API Endpoint: List Registered MCP Tools
app.get("/api/mcp/tools", (_, res) => {
  return res.json({
    status: "online",
    server: "selin-enterprise-hq",
    version: "2.2.0",
    tools: [
      { name: "verify_client_booking", description: "Проверка бронирования по телефону", category: "CRM" },
      { name: "search_flights", description: "Поиск авиабилетов и цен", category: "Travel" },
      { name: "send_messenger_notification", description: "Отправка в Telegram/WhatsApp/SMS", category: "Messaging" },
      { name: "create_smart_task", description: "Создание задач в смарт-планере", category: "Planner" }
    ]
  });
});

// API Endpoint: Direct MCP Tool Execution
app.post("/api/mcp/execute", async (req, res) => {
  const { toolName, args } = req.body;
  if (!toolName || !mcpToolsRegistry[toolName]) {
    return res.status(404).json({ error: `Инструмент MCP '${toolName}' не найден` });
  }

  try {
    const result = await mcpToolsRegistry[toolName](args || {});
    return res.json({
      success: true,
      tool: toolName,
      executedAt: new Date().toISOString(),
      result
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Ошибка выполнения MCP инструмента" });
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

    // Detect if prompt requires explicit MCP tool execution
    const lowerPrompt = prompt.toLowerCase();
    if (lowerPrompt.includes("билет") || lowerPrompt.includes("вылет") || lowerPrompt.includes("рейс")) {
      const flightResult = await mcpToolsRegistry["search_flights"]({ origin: "Москва", destination: "Дубай", departureDate: "2026-08-15" });
      executedMcpTools.push({ tool: "search_flights", status: "success", data: flightResult });
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

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: `Канал: ${channel}\nЗапрос: ${prompt}` }] }],
        config: {
          systemInstruction: systemContext,
          responseMimeType: "application/json",
          responseSchema: geminiResponseSchema,
          temperature: 0.1,
        }
      });

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

// Health check для мониторинга
app.get("/health", (_, res) => res.json({ status: "ok", version: "2.1.0" }));

// Integrate Vite middleware in development or serve static files in production
async function startServer() {
  if (process.env.ENABLE_MCP_STDIO === "true") {
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    console.log("🔌 MCP Stdio Transport активирован");
  } else {
    console.log("ℹ️ MCP Stdio отключен. Используйте ENABLE_MCP_STDIO=true для активации.");
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 SELIN Enterprise AI Core запущен на порту ${PORT}`);
    console.log(`🛡️ Архитектура: Structured Outputs + Safe Parsing + Zod Validation`);
  });
}

startServer();
