import Redis from 'ioredis';
import crypto from 'crypto';
import { logger } from '../logger';

export class RedisService {
  private client: Redis | null = null;
  private isConnected: boolean = false;
  private hasLoggedError: boolean = false;

  constructor() {
    const redisUrl = process.env.REDIS_URL;

    if (!redisUrl) {
      console.log('❌ [Redis] нет REDIS_URL — работаю без кэша');
      logger.warn('❌ [Redis] нет REDIS_URL — работаю без кэша');
      return;
    }

    try {
      // Инициализируем ioredis с возможностью переподключения и без падения приложения
      this.client = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        retryStrategy(times) {
          // Попытка переподключения каждые 5 секунд
          return 5000;
        },
        connectTimeout: 5000
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        this.hasLoggedError = false;
        console.log('🔴 [Redis] подключено');
        logger.info('🔴 [Redis] подключено к серверу');
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        if (!this.hasLoggedError) {
          console.log('⚠️ [Redis] недоступен, работаю без кэша');
          logger.warn(`⚠️ [Redis] недоступен, работаю без кэша. Ошибка: ${err.message}`);
          this.hasLoggedError = true;
        }
      });
    } catch (err: any) {
      this.isConnected = false;
      console.log('⚠️ [Redis] недоступен, работаю без кэша');
      logger.error('Error starting Redis Client:', err);
    }
  }

  public isAvailable(): boolean {
    return this.isConnected && this.client !== null;
  }

  // Хэширование для ключей
  public hashKey(str: string): string {
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  // Чтение ключа
  async get(key: string): Promise<string | null> {
    if (!this.isAvailable() || !this.client) return null;
    try {
      return await this.client.get(key);
    } catch (err) {
      if (!this.hasLoggedError) {
        console.log('⚠️ [Redis] недоступен, работаю без кэша');
        this.hasLoggedError = true;
      }
      return null;
    }
  }

  // Запись ключа с TTL в секундах
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.isAvailable() || !this.client) return;
    try {
      if (ttlSeconds) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    } catch (err) {
      if (!this.hasLoggedError) {
        console.log('⚠️ [Redis] недоступен, работаю без кэша');
        this.hasLoggedError = true;
      }
    }
  }

  // Удаление ключа
  async del(key: string): Promise<void> {
    if (!this.isAvailable() || !this.client) return;
    try {
      await this.client.del(key);
    } catch (err) {
      if (!this.hasLoggedError) {
        console.log('⚠️ [Redis] недоступен, работаю без кэша');
        this.hasLoggedError = true;
      }
    }
  }

  // Получить список (LANGE/LRANGE)
  async getList(key: string): Promise<string[]> {
    if (!this.isAvailable() || !this.client) return [];
    try {
      return await this.client.lrange(key, 0, -1);
    } catch (err) {
      if (!this.hasLoggedError) {
        console.log('⚠️ [Redis] недоступен, работаю без кэша');
        this.hasLoggedError = true;
      }
      return [];
    }
  }

  // Добавить в список (RPUSH/LPUSH) и обрезать до нужного размера
  async pushToList(key: string, value: string, limit: number, ttlSeconds?: number): Promise<void> {
    if (!this.isAvailable() || !this.client) return;
    try {
      const pipeline = this.client.pipeline();
      pipeline.rpush(key, value);
      pipeline.ltrim(key, -limit, -1);
      if (ttlSeconds) {
        pipeline.expire(key, ttlSeconds);
      }
      await pipeline.exec();
    } catch (err) {
      if (!this.hasLoggedError) {
        console.log('⚠️ [Redis] недоступен, работаю без кэша');
        this.hasLoggedError = true;
      }
    }
  }

  // Инкремент для Rate Limit
  async incr(key: string): Promise<number | null> {
    if (!this.isAvailable() || !this.client) return null;
    try {
      return await this.client.incr(key);
    } catch (err) {
      if (!this.hasLoggedError) {
        console.log('⚠️ [Redis] недоступен, работаю без кэша');
        this.hasLoggedError = true;
      }
      return null;
    }
  }

  // Установка TTL
  async expire(key: string, seconds: number): Promise<void> {
    if (!this.isAvailable() || !this.client) return;
    try {
      await this.client.expire(key, seconds);
    } catch (err) {
      if (!this.hasLoggedError) {
        console.log('⚠️ [Redis] недоступен, работаю без кэша');
        this.hasLoggedError = true;
      }
    }
  }

  // Gracefully close the connection
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
        this.isConnected = false;
        logger.info('🔴 [Redis] connection gracefully closed via quit');
      } catch (err) {
        this.client.disconnect();
        this.isConnected = false;
        logger.warn('⚠️ [Redis] forced disconnect on shutdown');
      }
    }
  }
}

export const redisService = new RedisService();
