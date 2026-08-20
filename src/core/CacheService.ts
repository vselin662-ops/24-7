// src/core/CacheService.ts
import Redis from 'ioredis';
import { logger } from '../logger';

export class CacheService {
  private redis: Redis | null = null;
  private isConnected: boolean = false;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    
    // Lazy initialization & fail-safe if Redis URL is not provided or fails to connect
    try {
      this.redis = new Redis(redisUrl || 'redis://localhost:6379', {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        enableOfflineQueue: false,
        retryStrategy: (times) => {
          if (times > 5) {
            return null; // Stop retrying after 5 attempts to avoid flooding logs
          }
          return Math.min(times * 100, 2000);
        }
      });

      this.redis.on('connect', () => {
        this.isConnected = true;
        logger.info('✅ Redis connected');
      });

      this.redis.on('ready', () => {
        this.isConnected = true;
        logger.info('✅ Redis ready');
      });

      this.redis.on('close', () => {
        this.isConnected = false;
      });

      this.redis.on('error', (err) => {
        this.isConnected = false;
        logger.warn(`⚠️ Redis error: ${err instanceof Error ? err.message : String(err)}`);
      });

      // Attempt non-blocking connection
      this.redis.connect().catch((err) => {
        this.isConnected = false;
        logger.warn(`⚠️ Redis connection could not be established: ${err instanceof Error ? err.message : String(err)}`);
      });
    } catch (err) {
      this.isConnected = false;
      logger.warn(`⚠️ Redis initialization failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Кэширование ответов LLM
  async getCachedResponse(chatId: string, message: string): Promise<string | null> {
    if (!this.isConnected || !this.redis) return null;
    try {
      const key = `llm:${chatId}:${message.slice(0, 50).replace(/[^a-zA-Z0-9]/g, '_')}`;
      return await this.redis.get(key);
    } catch (err) {
      logger.warn(`⚠️ Cache getCachedResponse error: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  async setCachedResponse(chatId: string, message: string, response: string): Promise<void> {
    if (!this.isConnected || !this.redis) return;
    try {
      const key = `llm:${chatId}:${message.slice(0, 50).replace(/[^a-zA-Z0-9]/g, '_')}`;
      await this.redis.setex(key, 3600, response);
    } catch (err) {
      logger.warn(`⚠️ Cache setCachedResponse error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Сессии пользователей
  async getSession(chatId: string): Promise<any> {
    if (!this.isConnected || !this.redis) return null;
    try {
      const data = await this.redis.get(`session:${chatId}`);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      logger.warn(`⚠️ Cache getSession error: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  async setSession(chatId: string, data: any): Promise<void> {
    if (!this.isConnected || !this.redis) return;
    try {
      await this.redis.setex(`session:${chatId}`, 86400, JSON.stringify(data));
    } catch (err) {
      logger.warn(`⚠️ Cache setSession error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // История диалога
  async pushMessage(chatId: string, message: any): Promise<void> {
    if (!this.isConnected || !this.redis) return;
    try {
      const key = `history:${chatId}`;
      await this.redis.rpush(key, JSON.stringify(message));
      await this.redis.ltrim(key, -20, -1);
    } catch (err) {
      logger.warn(`⚠️ Cache pushMessage error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getHistory(chatId: string, limit: number = 10): Promise<any[]> {
    if (!this.isConnected || !this.redis) return [];
    try {
      const items = await this.redis.lrange(`history:${chatId}`, -limit, -1);
      return items.map(item => JSON.parse(item));
    } catch (err) {
      logger.warn(`⚠️ Cache getHistory error: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  // Голосовые очереди
  async pushVoice(chatId: string, audio: string): Promise<void> {
    if (!this.isConnected || !this.redis) return;
    try {
      await this.redis.rpush(`voice:${chatId}`, audio);
    } catch (err) {
      logger.warn(`⚠️ Cache pushVoice error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async popVoice(chatId: string): Promise<string | null> {
    if (!this.isConnected || !this.redis) return null;
    try {
      return await this.redis.lpop(`voice:${chatId}`);
    } catch (err) {
      logger.warn(`⚠️ Cache popVoice error: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  // Очистка
  async clearChat(chatId: string): Promise<void> {
    if (!this.isConnected || !this.redis) return;
    try {
      await this.redis.del(`session:${chatId}`, `history:${chatId}`);
    } catch (err) {
      logger.warn(`⚠️ Cache clearChat error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  get status(): boolean {
    return this.isConnected;
  }
}

export const cacheService = new CacheService();
