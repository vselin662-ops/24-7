import fs from "fs";
import path from "path";
import { sqliteDb } from "../../db";
import { logger } from "../logger";

const CONFIG_FILE = path.join(process.cwd(), "data", "company_config.json");
const CHATS_FILE = path.join(process.cwd(), "data", "telegram_chats.json");
const MODERATION_FILE = path.join(process.cwd(), "data", "moderation_queue.json");
const MOD_LOG_FILE = path.join(process.cwd(), "data", "moderation_log.json");
const KB_FILE = path.join(process.cwd(), "data", "knowledge_base.json");
const FEED_FILE = path.join(process.cwd(), "data", "feed.json");

// Ensure data folder exists
try {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
} catch (e) {}

export let cachedFeed: any[] = [];
try {
  if (fs.existsSync(FEED_FILE)) {
    cachedFeed = JSON.parse(fs.readFileSync(FEED_FILE, "utf-8"));
  }
} catch (e) {
  cachedFeed = [];
}

export function logFeedEvent(
  role: string,
  type: string,
  title: string,
  detail: string,
  status: "success" | "pending" | "info" | "warning" = "info",
  chatId?: string | number
) {
  const event = {
    id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    time: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
    role,
    type,
    title,
    detail,
    status,
    chatId: chatId ? String(chatId) : undefined
  };
  cachedFeed.unshift(event);
  if (cachedFeed.length > 200) cachedFeed.pop();

  try {
    fs.writeFileSync(FEED_FILE, JSON.stringify(cachedFeed, null, 2), "utf-8");
  } catch (e) {}
}

export function getCompanyConfig(): any {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch (e) {}
  return {
    business_name: "Selin AI",
    industry: "IT & Automation",
    is_live: true,
    channels: ["max", "web"],
    autonomy_level: "full"
  };
}

export function saveCompanyConfig(config: any) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
  } catch (e) {
    logger.error("Failed to save company config", { error: e });
  }
}

export function getModerationQueue(): any[] {
  try {
    if (fs.existsSync(MODERATION_FILE)) {
      return JSON.parse(fs.readFileSync(MODERATION_FILE, "utf-8"));
    }
  } catch (e) {}
  return [];
}

export function saveModerationQueue(queue: any[]) {
  try {
    fs.writeFileSync(MODERATION_FILE, JSON.stringify(queue, null, 2), "utf-8");
  } catch (e) {}
}

export function getModerationLog(): any[] {
  try {
    if (fs.existsSync(MOD_LOG_FILE)) {
      return JSON.parse(fs.readFileSync(MOD_LOG_FILE, "utf-8"));
    }
  } catch (e) {}
  return [];
}

export function saveModerationLog(logItem: any) {
  try {
    const list = getModerationLog();
    list.unshift(logItem);
    if (list.length > 100) list.pop();
    fs.writeFileSync(MOD_LOG_FILE, JSON.stringify(list, null, 2), "utf-8");
  } catch (e) {}
}

export function getKnowledgeBase(): { documents: any[]; chunks: any[] } {
  try {
    if (fs.existsSync(KB_FILE)) {
      return JSON.parse(fs.readFileSync(KB_FILE, "utf-8"));
    }
  } catch (e) {}
  return { documents: [], chunks: [] };
}

export function saveKnowledgeBase(kb: { documents: any[]; chunks: any[] }) {
  try {
    fs.writeFileSync(KB_FILE, JSON.stringify(kb, null, 2), "utf-8");
  } catch (e) {}
}

export function getTelegramChats(): any[] {
  try {
    if (fs.existsSync(CHATS_FILE)) {
      return JSON.parse(fs.readFileSync(CHATS_FILE, "utf-8"));
    }
  } catch (e) {}
  return [];
}

export function saveTelegramChats(chats: any[]) {
  try {
    fs.writeFileSync(CHATS_FILE, JSON.stringify(chats, null, 2), "utf-8");
  } catch (e) {}
}
