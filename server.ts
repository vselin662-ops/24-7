import express from "express";
import path from "path";
import { execSync } from "child_process";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
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

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

const MODEL_CHAIN = ["gemini-2.5-flash-lite", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"];
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
} catch (error) {
  console.warn("⚠️ Firebase Admin initialization bypassed or failed. Using local JSON cache fallback.", error);
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
  agents: []
};

let cachedChats: any[] = [];
let cachedKnowledgeBase: { documents: any[]; chunks: any[] } = { documents: [], chunks: [] };
let cachedModerationQueue: any[] = [];
let cachedModerationLog: any[] = [];

// File Storage paths for local persistence
const CONFIG_FILE = path.join(process.cwd(), "company_config.json");
const CHATS_FILE = path.join(process.cwd(), "telegram_chats.json");
const KNOWLEDGE_FILE = path.join(process.cwd(), "knowledge_base.json");
const MODERATION_QUEUE_FILE = path.join(process.cwd(), "moderation_queue.json");
const MODERATION_LOG_FILE = path.join(process.cwd(), "moderation_log.json");

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
    console.log("📁 Loaded initial data from local JSON cache files.");
  } catch (err) {
    console.error("Error reading local JSON files:", err);
  }

  // Pre-populate default mock customers if empty
  if (!cachedChats || cachedChats.length === 0) {
    cachedChats = [
      {
        id: 'cust_1',
        name: 'Екатерина Смирнова',
        channel: 'telegram',
        avatar: '👩‍💼',
        lastMessage: 'Добрый день! Подскажите стоимость услуг и свободные слоты на завтра?',
        timestamp: '10:45',
        history: [
          { sender: 'customer', text: 'Добрый день! Подскажите стоимость услуг и свободные слоты на завтра?' }
        ]
      },
      {
        id: 'cust_2',
        name: 'Алексей Петров',
        channel: 'whatsapp',
        avatar: '👨‍🔧',
        lastMessage: 'Привет! Мне нужно коммерческое предложение на услуги вашей компании.',
        timestamp: '11:15',
        history: [
          { sender: 'customer', text: 'Привет! Мне нужно коммерческое предложение на услуги вашей компании.' }
        ]
      },
      {
        id: 'cust_3',
        name: 'Мария Иванова',
        channel: 'vk',
        avatar: '👩‍🎨',
        lastMessage: 'Здравствуйте! Вы работаете по выходным? Хотела бы сделать заказ.',
        timestamp: 'Вчера',
        history: [
          { sender: 'customer', text: 'Здравствуйте! Вы работаете по выходным? Хотела бы сделать заказ.' }
        ]
      }
    ];
    try {
      fs.writeFileSync(CHATS_FILE, JSON.stringify(cachedChats, null, 2), "utf-8");
    } catch (err) {
      console.error("Failed to write initial mock chats:", err);
    }
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

    } catch (err) {
      isFirestoreAvailable = false;
      console.warn("⚠️ Firestore test failed. Running in standalone local-JSON cache mode.", err);
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

// Endpoint to fetch company config
app.get("/api/get-config", (req, res) => {
  return res.json({ config: getCompanyConfig() });
});

// Endpoint to save company config from frontend
app.post("/api/save-config", (req, res) => {
  const config = req.body;
  if (!config || typeof config !== "object") {
    return res.status(400).json({ error: "Invalid configuration object." });
  }
  saveCompanyConfig(config);
  console.log("💾 Company config successfully persisted on the server:", config.business_name);
  return res.json({ success: true, config });
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
  const TTS_MODEL_CHAIN = ["gemini-2.5-flash-preview-tts", "gemini-3.1-flash-tts-preview", "gemini-2.0-flash-preview-tts"];

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
        await botInstance.sendMessage(chatId, text);
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

// Helper to generate agent response (using RAG & Gemini or simulation fallback)
async function generateAgentResponseHelper(user_message: string, agentRole: string, chatHistory: any[], config: any): Promise<string> {
  if (!ai) {
    if (agentRole === "sales") {
      return `Благодарим за интерес к "${config.business_name}"! Мы подготовим для вас персональное предложение в ближайшее время.`;
    } else {
      return `Здравствуйте! Спасибо за ваше сообщение. Я зафиксировал ваш вопрос: "${user_message}". Мы ответим вам в ближайшее время.`;
    }
  }

  try {
    // RAG Knowledge Retrieval - limit to 2
    let ragContext = "";
    const matchedChunks = await queryKnowledgeBase(user_message, 2);
    const relevantChunks = matchedChunks.filter((c: any) => c.score >= 0.35);
    
    if (relevantChunks.length > 0) {
      ragContext = "\nПОДТВЕРЖДЕННАЯ ИНФОРМАЦИЯ ИЗ БАЗЫ ЗНАНИЙ:\n" +
        relevantChunks.map((c: any) => `[Источник: ${c.docName}]: ${c.text}`).join("\n\n") + "\n\n" +
        "ИНСТРУКЦИЯ: Опирайся только на эти факты. Если ответа нет, вежливо скажи, что уточнишь у руководителя.\n";
    }

    const recent = chatHistory.slice(-4);
    const conversationHistory = recent.map((h: any) => 
      `${h.sender === "customer" ? "Клиент" : "Агент"}: ${h.text}`
    ).join("\n");

    const mission = (config.agent_missions || {})[agentRole] || "";
    const missionText = mission ? ` Миссия: ${mission}.` : "";
    const notLiveText = config.is_live !== true ? " Режим: штаб еще не запущен. Отвечай вежливо, не обещай конкретику." : "";

    const prompt = `Ты — цифровой агент "${agentRole}" в компании "${config.business_name}". Тон: ${config.tone || "friendly"}.${missionText}${notLiveText}
Отвечай как живой человек: 1-2 коротких предложения, разговорно, без списков.
ВАЖНО: твои ответы автоматически озвучиваются и уходят клиенту голосовым сообщением. НИКОГДА не говори клиенту, что ты работаешь только в текстовом формате, что не можешь ответить голосом, или что ему нужно написать текстом из-за формата. Отвечай так, будто говоришь вслух: 1-2 коротких разговорных предложения, без списков и без упоминаний формата ответа.
История:
${conversationHistory}
${ragContext}
Следующий короткий ответ клиенту:`;

    const response = await generateWithFallback(
      () => prompt,
      { temperature: 0.7 }
    );

    return response.text || "Связь моргнула — повтори голосовое или напиши ещё раз, я на связи.";
  } catch (err: any) {
    console.error("GEN FAIL:", err?.message || err, "code:", err?.code || err?.status || "");
    return "Связь моргнула — повтори голосовое или напиши ещё раз, я на связи.";
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

    return res.json({ moderation_required: true, proposedResponse: responseText });
  } else {
    // Append agent message immediately
    chats[chatIndex].history.push({ sender: "agent", text: responseText });
    chats[chatIndex].lastMessage = responseText;
    chats[chatIndex].timestamp = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    saveTelegramChats(chats);

    return res.json({ response: responseText });
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
  }

  return res.json({ success: true });
});

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

  // Determine agent role
  let agentRole = "receiver";
  const lowerText = text.toLowerCase();
  if (lowerText.includes("купить") || lowerText.includes("кп") || lowerText.includes("коммерческое") || lowerText.includes("цена") || lowerText.includes("стоимость") || lowerText.includes("заказать") || lowerText.includes("оформить")) {
    agentRole = "sales";
  }

  // Generate response text
  const responseText = await generateAgentResponseHelper(text, agentRole, chats[chatIndex].history, config);

  if (config.autonomy_level === "human-supervised") {
    // Enqueue for manual approval (voice will not be sent until approved)
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
    console.log(`📥 Enqueued message from ${clientName} for manual moderation.`);
  } else {
    // Fully autonomous: append reply to chat history and send as voice
    chats[chatIndex].history.push({ sender: "agent", text: responseText });
    chats[chatIndex].lastMessage = responseText;
    chats[chatIndex].timestamp = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    saveTelegramChats(chats);

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
  }
}

// Initialize Telegram Bot
const tgToken = process.env.TELEGRAM_BOT_TOKEN;
let bot: TelegramBot | null = null;
const lastStartAt = new Map<number, number>();

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
      const welcomeText = `${nameGreeting} Ты в правильном месте 👋
Моя задача — упростить тебе жизнь и забрать всю рутину: переписку, заявки, продажи, контент. Я выстрою под тебя автономную команду ИИ-специалистов, которая пашет 24/7 и закрывает твои задачи.
Просто отправь мне голосовое — расскажи, что нужно, и мои ребята возьмут это в работу и выведут продукт на новый уровень.
А если хочешь сначала всё потрогать сам — ниже кнопка, там приложение: покрути настройки, увидь всю структуру изнутри.
Рад, что забежал в гости 🤝`;

      bot?.sendMessage(chatId, welcomeText, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "📱 Открыть приложение и посмотреть самому", url: appUrl }
            ]
          ]
        }
      });

      try {
        await synthesizeAndSendVoice(bot, chatId, welcomeText, true);
      } catch (err: any) {
        console.warn("synthesizeAndSendVoice failed in start command:", err?.message || err);
      }
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
        detected_agents: ["receiver", "content", "sales", "analyst", "operator"],
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

Когда ты получишь достаточно ответов, заверши интервью. В финальном ответе кратко подытожь результаты, а затем на новой строке выведи маркер [COMPLETE] и строго на следующей строке выведи чистый JSON без разметки markdown, содержащий следующие поля:
{
  "business_name": "Название компании",
  "owner_name": "Имя владельца",
  "industry": "Сфера бизнеса",
  "detected_agents": ["receiver", "content", "sales", "analyst", "operator"],
  "channels": ["telegram", "whatsapp", "vk", "email"] (список только из выбранных),
  "tone": "friendly" или "professional" или "energetic" или "elegant" или "strict",
  "autonomy_level": "full" или "human-supervised"
}`;

    if (forceComplete) {
      systemInstruction = `Ты — аналитический модуль системы "Автономный цифровой сотрудник".
Интервью завершено или прервано пользователем. Твоя задача — внимательно проанализировать всю имеющуюся переписку и строго вывести чистый JSON-конфигурацию без разметки markdown, содержащий параметры для настройки бизнеса.
Если какие-то данные не были явно названы, заполни их разумными дефолтами (например, если имя владельца неизвестно, напиши "Предприниматель", если название компании неизвестно - "Мой Бизнес", сфера деятельности - "Продажи и услуги", каналы связи - ["telegram"], тон - "friendly", уровень автономности - "full").

Выведи сначала краткое резюме для пользователя (например: "Отлично! Я проанализировал наши ответы и подготовил конфигурацию для вашего цифрового штаба."), затем на новой строке выведи маркер [COMPLETE] и строго на следующей строке выведи чистый JSON-объект без markdown-блоков, содержащий следующие поля:
{
  "business_name": "Название компании",
  "owner_name": "Имя владельца",
  "industry": "Сфера бизнеса",
  "detected_agents": ["receiver", "content", "sales", "analyst", "operator"],
  "channels": ["telegram", "whatsapp", "vk", "email"] (массив из упомянутых или дефолт ["telegram"]),
  "tone": "friendly" или "professional" или "energetic" или "elegant" или "strict",
  "autonomy_level": "full" или "human-supervised"
}`;
    }

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: formattedContents,
      config: {
        systemInstruction,
        temperature: forceComplete ? 0.2 : 0.7,
      }
    });

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

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
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
    });

    const tasks = JSON.parse(response.text || "[]");
    res.json({ tasks });
  } catch (error: any) {
    console.error("SMART Plan Error:", error);
    res.status(500).json({ error: error.message || "Failed to generate SMART plan" });
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

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
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
    });

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

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
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
    });

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

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: formattedContents,
      config: {
        systemInstruction,
        temperature: 0.7,
      }
    });

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

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
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
    });

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
]`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
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
    });

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
    // Simulated responses
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
    // RAG Knowledge Retrieval
    let ragContext = "";
    const matchedChunks = await queryKnowledgeBase(user_message, 3);
    const relevantChunks = matchedChunks.filter(c => c.score >= 0.35);
    
    if (relevantChunks.length > 0) {
      ragContext = "\nПОДТВЕРЖДЕННАЯ ИНФОРМАЦИЯ ИЗ БАЗЫ ЗНАНИЙ БИЗНЕСА:\n" +
        relevantChunks.map(c => `[Источник: ${c.docName}]: ${c.text}`).join("\n\n") + "\n\n" +
        "ИНСТРУКЦИЯ ПО ИСПОЛЬЗОВАНИЮ БАЗЫ ЗНАНИЙ:\n" +
        "1. Строй свой ответ строго на основе предоставленной информации из базы знаний бизнеса.\n" +
        "2. Если в базе знаний нет точного или однозначного ответа на вопрос клиента, ты должен вежливо ответить: 'Я уточню этот вопрос у руководителя и обязательно вернусь к вам с ответом.' Не придумывай и не выдумывай несуществующие детали.\n";
    }

    const prompt = "Ты — цифровой агент \"" + agent_role + "\" компании \"" + (business_name || "Наш Бизнес") + "\".\n" +
      "Сфера бизнеса: " + (industry || "Услуги и продажи") + ". Владелец: " + (owner_name || "Предприниматель") + ".\n" +
      "Твой стиль общения (тон): " + (tone || "дружелюбный") + ".\n" +
      "Ты должен ответить клиенту или выполнить задачу от лица компании. Никогда не говори, что ты ИИ или языковая модель. Говори строго на русском языке.\n" +
      "Будь естественным, убедительным и профессиональным.\n\n" +
      "Твоя роль и фокус:\n" +
      "- receiver (приемщик): отвечать на входящие вопросы клиентов, давать справку, консультировать по ценам, записывать на встречи, при сложном вопросе вежливо говорить, что перенаправил вопрос человеку.\n" +
      "- sales (продажник): активно продавать, отправлять выгодные коммерческие предложения, отрабатывать сомнения и возражения, стимулировать заключение сделки, договариваться об оплате.\n" +
      "- content (контент-мейкер): писать увлекательные, живые посты для Telegram/VK/Email, придумывать цепляющие заголовки, использовать уместные эмодзи, мотивировать к покупке или подписке.\n" +
      "- analyst (аналитик): готовить сводки по конверсиям, анализировать эффективность переписок, искать просадки и давать рекомендации бизнесу.\n" +
      "- operator (операционист-координатор): координировать задачи штаба, подводить итоги дня, информировать владельца.\n\n" +
      "Входящее сообщение / Задача: \"" + user_message + "\"\n" +
      "Контекст и история компании: \"" + (context || "Работаем стабильно") + "\"\n" +
      ragContext + "\n" +
      "Напиши свой ответ/результат:";

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        temperature: 0.7,
      }
    });

    res.json({ response: response.text || "" });
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
    const allowedVoices = ["Puck", "Charon", "Kore", "Fenrir", "Zephyr"];
    const voiceName = allowedVoices.includes(voice) ? voice : "Kore";

    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
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

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

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

// Integrate Vite middleware in development or serve static files in production
async function startServer() {
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
    console.log(`🚀 Full-stack server running on http://localhost:${PORT}`);
  });
}

startServer();
