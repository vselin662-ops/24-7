// src/core/CacheService.ts
import { logger } from '../logger';
import { PureDatabase as Database } from '../lib/pure-sqlite';
import path from 'path';
import crypto from 'crypto';

export class CacheService {
  private db: Database | any;
  private isConnected: boolean = false;

  constructor() {
    try {
      const dbPath = path.join(process.cwd(), 'cache.db');
      this.db = new Database(dbPath);
      
      // Создаём таблицы
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS cache (
          key TEXT PRIMARY KEY,
          value TEXT,
          expires INTEGER
        );
        CREATE TABLE IF NOT EXISTS sessions (
          chatId TEXT PRIMARY KEY,
          data TEXT,
          updated INTEGER
        );
        CREATE TABLE IF NOT EXISTS history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chatId TEXT,
          message TEXT,
          timestamp INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_history_chatId ON history(chatId);
        CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires);
      `);
      
      this.isConnected = true;
      logger.info('✅ SQLite cache initialized');
    } catch (err) {
      logger.error('❌ SQLite cache error:', err);
      this.isConnected = false;
    }
  }

  // Кэширование ответов LLM
  async getCachedResponse(chatId: string, message: string, systemPrompt?: string): Promise<string | null> {
    if (process.env.DISABLE_LLM_CACHE === 'true') return null;
    const userText = message || '';
    const promptStr = systemPrompt || '';
    const hash = crypto
      .createHash("md5")
      .update(String(chatId) + userText + promptStr)
      .digest("hex");
    const redisKey = `cache:${hash}`;

    try {
      const { redisService } = await import('../services/RedisService');
      if (redisService.isAvailable()) {
        const val = await redisService.get(redisKey);
        if (val) {
          logger.info(`✨ [Cache] Redis HIT for key: ${redisKey}`);
          return val;
        }
      }
    } catch (e) {
      logger.warn(`⚠️ [Cache] Redis read error: ${e}`);
    }

    if (!this.isConnected || !this.db) return null;
    const now = Date.now();
    const row = this.db.prepare('SELECT value FROM cache WHERE key = ? AND expires > ?').get(hash, now);
    return row ? row.value : null;
  }

  async setCachedResponse(chatId: string, message: string, response: string, systemPrompt?: string): Promise<void> {
    if (process.env.DISABLE_LLM_CACHE === 'true') return;
    const userText = message || '';
    const promptStr = systemPrompt || '';
    const hash = crypto
      .createHash("md5")
      .update(String(chatId) + userText + promptStr)
      .digest("hex");
    const redisKey = `cache:${hash}`;
    
    // Определим TTL: 30 минут (1800с) для погоды/новостей/пробок, иначе 120 секунд по умолчанию
    const lowerText = userText.toLowerCase();
    const isWeatherOrNews = lowerText.includes('погод') || lowerText.includes('новост') || lowerText.includes('пробк') || lowerText.includes('weather') || lowerText.includes('news');
    const ttlSeconds = isWeatherOrNews ? 1800 : 120;

    try {
      const { redisService } = await import('../services/RedisService');
      if (redisService.isAvailable()) {
        await redisService.set(redisKey, response, ttlSeconds);
        logger.info(`✨ [Cache] Redis SET for key: ${redisKey} with TTL: ${ttlSeconds}s`);
        return;
      }
    } catch (e) {
      logger.warn(`⚠️ [Cache] Redis write error: ${e}`);
    }

    if (!this.isConnected || !this.db) return;
    const expires = Date.now() + (ttlSeconds * 1000);
    this.db.prepare('INSERT OR REPLACE INTO cache (key, value, expires) VALUES (?, ?, ?)')
      .run(hash, response, expires);
  }

  // Сессии пользователей
  async getSession(chatId: string): Promise<any> {
    if (!this.isConnected || !this.db) return null;
    const row = this.db.prepare('SELECT data FROM sessions WHERE chatId = ?').get(chatId);
    return row ? JSON.parse(row.data) : null;
  }

  async setSession(chatId: string, data: any): Promise<void> {
    if (!this.isConnected || !this.db) return;
    this.db.prepare('INSERT OR REPLACE INTO sessions (chatId, data, updated) VALUES (?, ?, ?)')
      .run(chatId, JSON.stringify(data), Date.now());
  }

  // История диалога
  async pushMessage(chatId: string, message: any): Promise<void> {
    const key = `history:${chatId}`;

    try {
      const { redisService } = await import('../services/RedisService');
      if (redisService.isAvailable()) {
        await redisService.pushToList(key, JSON.stringify(message), 10, 1800);
        logger.info(`✨ [History] Redis PUSH for chat: ${chatId}`);
        return;
      }
    } catch (e) {
      logger.warn(`⚠️ [History] Redis push error: ${e}`);
    }

    if (!this.isConnected || !this.db) return;
    this.db.prepare('INSERT INTO history (chatId, message, timestamp) VALUES (?, ?, ?)')
      .run(chatId, JSON.stringify(message), Date.now());
  }

  async getHistory(chatId: string, limit: number = 10): Promise<any[]> {
    const key = `history:${chatId}`;

    try {
      const { redisService } = await import('../services/RedisService');
      if (redisService.isAvailable()) {
        const list = await redisService.getList(key);
        if (list && list.length > 0) {
          logger.info(`✨ [History] Redis GET for chat: ${chatId}`);
          return list.map((msgStr: string) => JSON.parse(msgStr));
        }
      }
    } catch (e) {
      logger.warn(`⚠️ [History] Redis get error: ${e}`);
    }

    if (!this.isConnected || !this.db) return [];
    const rows = this.db.prepare('SELECT message FROM history WHERE chatId = ? ORDER BY timestamp DESC LIMIT ?')
      .all(chatId, limit);
    return rows.map((row: any) => JSON.parse(row.message)).reverse();
  }

  // Очистка
  async clearChat(chatId: string): Promise<void> {
    const key = `history:${chatId}`;
    try {
      const { redisService } = await import('../services/RedisService');
      if (redisService.isAvailable()) {
        await redisService.del(key);
      }
    } catch (e) {}

    if (!this.isConnected || !this.db) return;
    this.db.prepare('DELETE FROM sessions WHERE chatId = ?').run(chatId);
    this.db.prepare('DELETE FROM history WHERE chatId = ?').run(chatId);
  }

  get status(): boolean {
    return this.isConnected;
  }
}

export const cacheService = new CacheService();
