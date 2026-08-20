// src/core/CacheService.ts
import { logger } from '../logger';
import { PureDatabase as Database } from '../lib/pure-sqlite';
import path from 'path';

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
  async getCachedResponse(chatId: string, message: string): Promise<string | null> {
    if (!this.isConnected || !this.db) return null;
    const key = `llm:${chatId}:${message.slice(0, 50).replace(/[^a-zA-Z0-9]/g, '_')}`;
    const now = Date.now();
    const row = this.db.prepare('SELECT value FROM cache WHERE key = ? AND expires > ?').get(key, now);
    return row ? row.value : null;
  }

  async setCachedResponse(chatId: string, message: string, response: string): Promise<void> {
    if (!this.isConnected || !this.db) return;
    const key = `llm:${chatId}:${message.slice(0, 50).replace(/[^a-zA-Z0-9]/g, '_')}`;
    const expires = Date.now() + 3600000; // 1 час
    this.db.prepare('INSERT OR REPLACE INTO cache (key, value, expires) VALUES (?, ?, ?)')
      .run(key, response, expires);
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
    if (!this.isConnected || !this.db) return;
    this.db.prepare('INSERT INTO history (chatId, message, timestamp) VALUES (?, ?, ?)')
      .run(chatId, JSON.stringify(message), Date.now());
  }

  async getHistory(chatId: string, limit: number = 10): Promise<any[]> {
    if (!this.isConnected || !this.db) return [];
    const rows = this.db.prepare('SELECT message FROM history WHERE chatId = ? ORDER BY timestamp DESC LIMIT ?')
      .all(chatId, limit);
    return rows.map((row: any) => JSON.parse(row.message)).reverse();
  }

  // Очистка
  async clearChat(chatId: string): Promise<void> {
    if (!this.isConnected || !this.db) return;
    this.db.prepare('DELETE FROM sessions WHERE chatId = ?').run(chatId);
    this.db.prepare('DELETE FROM history WHERE chatId = ?').run(chatId);
  }

  get status(): boolean {
    return this.isConnected;
  }
}

export const cacheService = new CacheService();
