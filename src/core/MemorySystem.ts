import path from 'path';
import fs from 'fs';
import { PureDatabase } from '../lib/pure-sqlite';
import {
  ChatMemory,
  ChatMessage,
  UserProfile,
  UserPreferences,
  GeoLocation
} from './types';
import { logger } from '../logger';

export interface MemoryConfig {
  dbPath?: string;
  maxShortTermHistory?: number;
  decayHalfLifeDays?: number;
  similarityThreshold?: number;
  enableRag?: boolean;
}

export interface MemoryContext {
  shortTerm: ChatMemory;
  profile: UserProfile;
  relevantContext: string[];
  recalledFacts: string[];
}

export interface RAGDocument {
  id: string;
  chatId: string;
  text: string;
  vector: number[];
  keywords: string[];
  metadata?: Record<string, any>;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  repetitionInterval: number; // Дней до следующего повторения (SM-2 алгоритм)
  easeFactor: number;        // Фактор легкости запоминания (2.5 по умолчанию)
  priority: number;          // 0.0 - 1.0 (важность факта)
}

/**
 * Подсистема RAG (Retrieval-Augmented Generation) с векторным поиском,
 * локальными эмбеддингами и кэшированием в памяти и SQLite.
 */
export class RAGSystem {
  private documents: Map<string, RAGDocument> = new Map();
  private readonly vectorDim = 128;

  constructor(initialDocs?: RAGDocument[]) {
    if (initialDocs && Array.isArray(initialDocs)) {
      for (const doc of initialDocs) {
        this.documents.set(doc.id, doc);
      }
    }
  }

  /**
   * Добавление документа с генерацией локального нормализованного вектора
   */
  public async addDocument(
    chatId: string,
    text: string,
    priority: number = 0.5,
    metadata?: Record<string, any>
  ): Promise<RAGDocument> {
    const id = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const vector = this.embedText(text);
    const keywords = this.extractKeywords(text);

    const doc: RAGDocument = {
      id,
      chatId,
      text,
      vector,
      keywords,
      metadata,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 1,
      repetitionInterval: 1,
      easeFactor: 2.5,
      priority
    };

    this.documents.set(id, doc);
    return doc;
  }

  /**
   * Векторный и гибридный поиск по базе знаний (Cosine similarity + keyword overlap)
   */
  public async search(query: string, limit: number = 5, minScore: number = 0.25): Promise<Array<{ document: RAGDocument; score: number }>> {
    const queryVec = this.embedText(query);
    const queryKeywords = new Set(this.extractKeywords(query));
    const results: Array<{ document: RAGDocument; score: number }> = [];

    for (const doc of this.documents.values()) {
      const cosSim = this.cosineSimilarity(queryVec, doc.vector);
      
      // Keyword overlap boost
      let overlapCount = 0;
      for (const kw of doc.keywords) {
        if (queryKeywords.has(kw)) overlapCount++;
      }
      const keywordBoost = doc.keywords.length > 0 ? (overlapCount / Math.max(queryKeywords.size, 1)) * 0.3 : 0;

      // Pensyve decay factor (постепенное угасание неиспользуемых воспоминаний)
      const daysSinceAccess = (Date.now() - doc.lastAccessedAt) / (1000 * 60 * 60 * 24);
      const retentionFactor = Math.pow(0.5, daysSinceAccess / Math.max(doc.repetitionInterval, 1));
      
      const finalScore = (cosSim * 0.7 + keywordBoost) * (0.5 + 0.5 * retentionFactor) * (0.8 + 0.2 * doc.priority);

      if (finalScore >= minScore) {
        results.push({ document: doc, score: finalScore });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  public getDocuments(): RAGDocument[] {
    return Array.from(this.documents.values());
  }

  public deleteDocument(id: string): boolean {
    return this.documents.delete(id);
  }

  public clearChat(chatId: string): void {
    for (const [id, doc] of this.documents.entries()) {
      if (doc.chatId === chatId) {
        this.documents.delete(id);
      }
    }
  }

  /**
   * Генерация семантического плотного вектора для текста
   */
  private embedText(text: string): number[] {
    const vector = new Array<number>(this.vectorDim).fill(0);
    const clean = text.toLowerCase().replace(/[^\w\sа-яё]/gi, ' ');
    const tokens = clean.split(/\s+/).filter(t => t.length > 1);

    if (tokens.length === 0) return vector;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      let hash = 0;
      for (let j = 0; j < token.length; j++) {
        hash = (hash << 5) - hash + token.charCodeAt(j);
        hash |= 0;
      }

      const bucket = Math.abs(hash) % this.vectorDim;
      const weight = 1.0 / Math.sqrt(i + 1);
      vector[bucket] += weight;

      // Биграммы для учета порядка слов
      if (i < tokens.length - 1) {
        const bigram = token + '_' + tokens[i + 1];
        let biHash = 0;
        for (let j = 0; j < bigram.length; j++) {
          biHash = (biHash << 5) - biHash + bigram.charCodeAt(j);
          biHash |= 0;
        }
        const biBucket = Math.abs(biHash) % this.vectorDim;
        vector[biBucket] += weight * 0.6;
      }
    }

    // L2-нормализация вектора
    let norm = 0;
    for (let i = 0; i < this.vectorDim; i++) {
      norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < this.vectorDim; i++) {
        vector[i] /= norm;
      }
    }

    return vector;
  }

  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      'и', 'в', 'на', 'с', 'по', 'к', 'у', 'о', 'за', 'из', 'от', 'до', 'для', 'не', 'что', 'как', 'это', 'он', 'она', 'они', 'мы', 'вы', 'я',
      'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'in', 'to', 'for', 'with', 'by'
    ]);
    const clean = text.toLowerCase().replace(/[^\w\sа-яё]/gi, ' ');
    return clean
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return Math.max(0, Math.min(1, dot));
  }
}

/**
 * Главная система управления памятью Selin AI 2.0 (MemorySystem).
 * Интегрирует:
 * 1. Краткосрочную память (история диалога и контекст)
 * 2. Долгосрочную память (профиль пользователя и персональные настройки)
 * 3. RAG (векторный семантический поиск по ключевым фактам)
 * 4. Забывание и приоритизацию памяти (Spaced Repetition / Decay по аналогии с Pensyve)
 * 5. SQLite персистентность
 */
export class MemorySystem {
  private shortTerm: Map<string, ChatMemory> = new Map();
  private longTerm: Map<string, UserProfile> = new Map();
  private rag: RAGSystem | null = null;
  private db: PureDatabase;
  private config: Required<MemoryConfig>;

  constructor(config?: MemoryConfig) {
    this.config = {
      dbPath: config?.dbPath || path.join(process.cwd(), 'data', 'memory_system.sqlite'),
      maxShortTermHistory: config?.maxShortTermHistory || 30,
      decayHalfLifeDays: config?.decayHalfLifeDays || 14,
      similarityThreshold: config?.similarityThreshold || 0.3,
      enableRag: config?.enableRag ?? true
    };

    const dir = path.dirname(this.config.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new PureDatabase(this.config.dbPath);
    this.initDatabase();
    this.loadFromDatabase();

    if (this.config.enableRag) {
      this.rag = new RAGSystem();
      this.loadRagDocuments();
    }
  }

  /**
   * Инициализация таблиц SQLite
   */
  private initDatabase(): void {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS short_term_memory (
          chat_id TEXT PRIMARY KEY,
          history_json TEXT,
          last_topic TEXT,
          user_intent TEXT,
          summary TEXT,
          entities_json TEXT,
          sentiment TEXT,
          updated_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS user_profiles (
          id TEXT PRIMARY KEY,
          name TEXT,
          email TEXT,
          phone TEXT,
          preferences_json TEXT,
          config_json TEXT,
          location_json TEXT,
          tenant_id TEXT,
          role TEXT,
          created_at INTEGER,
          updated_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS rag_documents (
          id TEXT PRIMARY KEY,
          chat_id TEXT,
          text TEXT,
          vector_json TEXT,
          keywords_json TEXT,
          priority REAL,
          repetition_interval REAL,
          ease_factor REAL,
          access_count INTEGER,
          last_accessed_at INTEGER,
          created_at INTEGER
        );
      `);
    } catch (err: any) {
      logger.error('Failed to initialize MemorySystem database:', err);
    }
  }

  /**
   * Загрузка начальных данных в оперативную память
   */
  private loadFromDatabase(): void {
    try {
      // Загрузка профилей
      const profiles = this.db.prepare('SELECT * FROM user_profiles').all() as any[];
      for (const row of profiles) {
        const profile: UserProfile = {
          id: row.id,
          name: row.name || 'Пользователь',
          email: row.email || undefined,
          phone: row.phone || undefined,
          preferences: row.preferences_json ? JSON.parse(row.preferences_json) : {},
          config: row.config_json ? JSON.parse(row.config_json) : {},
          location: row.location_json ? JSON.parse(row.location_json) : undefined,
          tenantId: row.tenant_id || undefined,
          role: row.role || 'user',
          createdAt: row.created_at || Date.now(),
          updatedAt: row.updated_at || Date.now()
        };
        this.longTerm.set(row.id, profile);
      }

      // Загрузка краткосрочной памяти
      const shortMemories = this.db.prepare('SELECT * FROM short_term_memory').all() as any[];
      for (const row of shortMemories) {
        const memory: ChatMemory = {
          history: row.history_json ? JSON.parse(row.history_json) : [],
          lastTopic: row.last_topic || undefined,
          userIntent: row.user_intent || undefined,
          summary: row.summary || undefined,
          entities: row.entities_json ? JSON.parse(row.entities_json) : {},
          sentiment: row.sentiment || undefined,
          lastUpdated: row.updated_at || Date.now()
        };
        this.shortTerm.set(row.chat_id, memory);
      }
    } catch (err: any) {
      logger.warn('Warning loading memories from SQLite:', err?.message || err);
    }
  }

  /**
   * Загрузка RAG документов из SQLite
   */
  private loadRagDocuments(): void {
    if (!this.rag) return;
    try {
      const rows = this.db.prepare('SELECT * FROM rag_documents').all() as any[];
      for (const row of rows) {
        const doc: RAGDocument = {
          id: row.id,
          chatId: row.chat_id,
          text: row.text,
          vector: row.vector_json ? JSON.parse(row.vector_json) : [],
          keywords: row.keywords_json ? JSON.parse(row.keywords_json) : [],
          priority: row.priority ?? 0.5,
          repetitionInterval: row.repetition_interval ?? 1,
          easeFactor: row.ease_factor ?? 2.5,
          accessCount: row.access_count ?? 1,
          lastAccessedAt: row.last_accessed_at ?? Date.now(),
          createdAt: row.created_at ?? Date.now()
        };
        (this.rag as any).documents.set(doc.id, doc);
      }
    } catch (err: any) {
      logger.warn('Warning loading RAG documents:', err?.message || err);
    }
  }

  // ==========================================
  // Основные методы MemorySystem
  // ==========================================

  /**
   * Получение полного контекста памяти для чата (краткосрочная + долгосрочная + релевантные факты RAG)
   */
  public async get(chatId: string): Promise<MemoryContext> {
    this.decayMemory(chatId);

    let short = this.shortTerm.get(chatId);
    if (!short) {
      short = {
        history: [],
        entities: {},
        lastUpdated: Date.now()
      };
      this.shortTerm.set(chatId, short);
    }

    const profile = await this.getProfile(chatId);

    // Извлечение фактов из RAG на основе последних сообщений
    const lastUserMessage = [...short.history].reverse().find(m => m.role === 'user')?.content || '';
    let relevantContext: string[] = [];
    if (this.rag && lastUserMessage) {
      const searchResults = await this.rag.search(lastUserMessage, 3, this.config.similarityThreshold);
      relevantContext = searchResults.map(r => r.document.text);
    }

    return {
      shortTerm: short,
      profile,
      relevantContext,
      recalledFacts: relevantContext
    };
  }

  /**
   * Сохранение новых сообщений или данных в память
   */
  public async save(chatId: string, data: {
    message?: ChatMessage;
    topic?: string;
    intent?: string;
    summary?: string;
    entities?: Record<string, any>;
    location?: GeoLocation;
  }): Promise<void> {
    let memory = this.shortTerm.get(chatId);
    if (!memory) {
      memory = {
        history: [],
        entities: {},
        lastUpdated: Date.now()
      };
      this.shortTerm.set(chatId, memory);
    }

    if (data.message) {
      memory.history.push({
        role: data.message.role,
        content: data.message.content,
        timestamp: data.message.timestamp || Date.now(),
        mediaType: data.message.mediaType,
        mediaUrl: data.message.mediaUrl,
        location: data.message.location,
        camera: data.message.camera,
        voice: data.message.voice,
        metadata: data.message.metadata
      });

      // Авто-индексация важных фактов в RAG
      if (this.rag && data.message.role === 'user' && data.message.content.length > 15) {
        const priority = this.calculatePriority(data.message);
        if (priority >= 0.5) {
          await this.index(chatId, data.message.content, priority);
        }
      }
    }

    if (data.topic) memory.lastTopic = data.topic;
    if (data.intent) memory.userIntent = data.intent;
    if (data.summary) memory.summary = data.summary;
    if (data.entities) memory.entities = { ...memory.entities, ...data.entities };
    if (data.location) memory.lastLocation = data.location;
    memory.lastUpdated = Date.now();

    // Ограничение размера истории
    if (memory.history.length > this.config.maxShortTermHistory) {
      memory.history = memory.history.slice(-this.config.maxShortTermHistory);
    }

    // Сохранение в SQLite
    this.persistShortTerm(chatId, memory);
  }

  /**
   * Извлечение релевантных фактов и воспоминаний по текстовому запросу
   */
  public async recall(chatId: string, query: string): Promise<string> {
    if (!this.rag) return '';

    const results = await this.rag.search(query, 4, this.config.similarityThreshold);
    if (results.length === 0) return '';

    // Обновляем метрики повторения (Spaced Repetition) для найденных документов
    for (const res of results) {
      const doc = res.document;
      doc.lastAccessedAt = Date.now();
      doc.accessCount++;
      doc.repetitionInterval = Math.min(60, doc.repetitionInterval * doc.easeFactor);
      this.persistRagDoc(doc);
    }

    return results.map(r => `• ${r.document.text}`).join('\n');
  }

  /**
   * Полная очистка контекста и истории диалога
   */
  public async clearContext(chatId: string): Promise<void> {
    this.shortTerm.delete(chatId);
    try {
      this.db.prepare('DELETE FROM short_term_memory WHERE chat_id = ?').run(chatId);
    } catch (err: any) {
      logger.warn(`Failed to delete short term memory for ${chatId}:`, err?.message || err);
    }
  }

  /**
   * "Забывание" устаревшей или низкоприоритетной информации (Spaced repetition decay)
   */
  public async forget(chatId: string, olderThanMs?: number): Promise<void> {
    const threshold = olderThanMs || this.config.decayHalfLifeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();

    // 1. Очистка краткосрочной памяти
    const memory = this.shortTerm.get(chatId);
    if (memory) {
      memory.history = memory.history.filter(m => (now - (m.timestamp || 0)) < threshold);
      this.persistShortTerm(chatId, memory);
    }

    // 2. Очистка или угасание RAG документов
    if (this.rag) {
      for (const doc of this.rag.getDocuments()) {
        if (doc.chatId === chatId) {
          const age = now - doc.lastAccessedAt;
          if (age > threshold && doc.priority < 0.7) {
            this.rag.deleteDocument(doc.id);
            try {
              this.db.prepare('DELETE FROM rag_documents WHERE id = ?').run(doc.id);
            } catch (e) {}
          }
        }
      }
    }
  }

  // ==========================================
  // RAG Методы
  // ==========================================

  /**
   * Индексация нового текста/факта в RAG
   */
  public async index(chatId: string, text: string, priority: number = 0.5): Promise<void> {
    if (!this.rag || !text.trim()) return;

    const doc = await this.rag.addDocument(chatId, text.trim(), priority);
    this.persistRagDoc(doc);
  }

  /**
   * Поиск по RAG базе знаний
   */
  public async search(query: string, limit: number = 5): Promise<any[]> {
    if (!this.rag) return [];
    return await this.rag.search(query, limit, this.config.similarityThreshold);
  }

  // ==========================================
  // Профиль пользователя (Долгосрочная память)
  // ==========================================

  /**
   * Получение профиля пользователя
   */
  public async getProfile(chatId: string): Promise<UserProfile> {
    let profile = this.longTerm.get(chatId);
    if (!profile) {
      profile = {
        id: chatId,
        name: 'Пользователь',
        preferences: {
          language: 'ru',
          voiceSpeed: 1.0,
          communicationStyle: 'casual',
          theme: 'dark'
        },
        config: {},
        tenantId: chatId,
        role: 'user',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      this.longTerm.set(chatId, profile);
      this.persistProfile(profile);
    }
    return profile;
  }

  /**
   * Обновление профиля пользователя
   */
  public async updateProfile(chatId: string, data: Partial<UserProfile>): Promise<void> {
    const current = await this.getProfile(chatId);
    const updated: UserProfile = {
      ...current,
      ...data,
      preferences: {
        ...current.preferences,
        ...(data.preferences || {})
      },
      config: {
        ...current.config,
        ...(data.config || {})
      },
      updatedAt: Date.now()
    };

    this.longTerm.set(chatId, updated);
    this.persistProfile(updated);
  }

  // ==========================================
  // Приоритизация и угасание памяти (Decay & Priority)
  // ==========================================

  /**
   * Расчет важности сообщения для запоминания
   */
  private calculatePriority(message: ChatMessage): number {
    const text = message.content.toLowerCase();
    let score = 0.3;

    // Ключевые маркеры персональной информации
    const importantMarkers = [
      'меня зовут', 'мой телефон', 'мой адрес', 'я живу', 'моя цель', 'я хочу',
      'мой бизнес', 'моя компания', 'купить', 'заказать', 'запомни', 'важно',
      'аллергия', 'пароль', 'день рождения', 'бюджет'
    ];

    for (const marker of importantMarkers) {
      if (text.includes(marker)) {
        score += 0.35;
        break;
      }
    }

    if (message.mediaType === 'image' || message.location) {
      score += 0.2;
    }

    return Math.min(1.0, score);
  }

  /**
   * Угасание краткосрочной и неиспользуемой памяти (Decay)
   */
  private decayMemory(chatId: string): void {
    const memory = this.shortTerm.get(chatId);
    if (!memory || memory.history.length === 0) return;

    const now = Date.now();
    const halfLifeMs = this.config.decayHalfLifeDays * 24 * 60 * 60 * 1000;

    // Если память не обновлялась дольше полураспада, сжимаем историю
    if (memory.lastUpdated && (now - memory.lastUpdated) > halfLifeMs) {
      memory.history = memory.history.slice(-Math.floor(this.config.maxShortTermHistory / 2));
      memory.lastUpdated = now;
      this.persistShortTerm(chatId, memory);
    }
  }

  // ==========================================
  // Персистентность SQLite
  // ==========================================

  private persistShortTerm(chatId: string, memory: ChatMemory): void {
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO short_term_memory (
          chat_id, history_json, last_topic, user_intent, summary, entities_json, sentiment, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        chatId,
        JSON.stringify(memory.history),
        memory.lastTopic || null,
        memory.userIntent || null,
        memory.summary || null,
        JSON.stringify(memory.entities || {}),
        memory.sentiment || null,
        memory.lastUpdated || Date.now()
      );
    } catch (err: any) {
      logger.error(`Error saving short-term memory for ${chatId}:`, err);
    }
  }

  private persistProfile(profile: UserProfile): void {
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO user_profiles (
          id, name, email, phone, preferences_json, config_json, location_json, tenant_id, role, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        profile.id,
        profile.name,
        profile.email || null,
        profile.phone || null,
        JSON.stringify(profile.preferences),
        JSON.stringify(profile.config),
        profile.location ? JSON.stringify(profile.location) : null,
        profile.tenantId || null,
        profile.role || 'user',
        profile.createdAt || Date.now(),
        profile.updatedAt || Date.now()
      );
    } catch (err: any) {
      logger.error(`Error saving user profile for ${profile.id}:`, err);
    }
  }

  private persistRagDoc(doc: RAGDocument): void {
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO rag_documents (
          id, chat_id, text, vector_json, keywords_json, priority, repetition_interval, ease_factor, access_count, last_accessed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        doc.id,
        doc.chatId,
        doc.text,
        JSON.stringify(doc.vector),
        JSON.stringify(doc.keywords),
        doc.priority,
        doc.repetitionInterval,
        doc.easeFactor,
        doc.accessCount,
        doc.lastAccessedAt,
        doc.createdAt
      );
    } catch (err: any) {
      logger.error(`Error saving RAG document ${doc.id}:`, err);
    }
  }
}

export const memorySystem = new MemorySystem();
