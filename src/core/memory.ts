import crypto from 'crypto';
import { sqliteDb } from '../../db';
import type { ConversationContext } from './intent-engine';
import { logger } from '../logger';

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface MemoryFragment {
  id?: string;
  type: string;
  content: string;
  importance?: number;
  createdAt?: number;
  lastAccessedAt?: number;
}

export interface LongTermMemory {
  fragments: MemoryFragment[];
}

export interface Memory {
  shortTerm: Message[];
  longTerm: MemoryFragment[];
  context: ConversationContext;
}

class MemorySystem {
  private shortTermBuffers: Map<string, Message[]> = new Map();

  /**
   * Получает контекст беседы для указанного tenantId.
   */
  async getContext(tenantId: string): Promise<ConversationContext> {
    if (!sqliteDb) {
      return { tenantId, activeMode: 'general', lastMessages: [] };
    }

    const stmt = sqliteDb.prepare(`SELECT * FROM conversation_context WHERE tenant_id = ?`);
    const row = stmt.get(tenantId);

    const shortTerm = this.shortTermBuffers.get(tenantId) || [];

    if (!row) {
      return {
        tenantId,
        activeMode: 'general',
        modeData: {},
        lastMessages: shortTerm.map((m) => ({ role: m.role, content: m.content })),
        emotionState: 'neutral',
      };
    }

    let modeData = {};
    try {
      modeData = row.mode_data ? JSON.parse(row.mode_data) : {};
    } catch {
      modeData = {};
    }

    return {
      tenantId,
      activeMode: row.active_mode || 'general',
      modeData,
      lastMessages: shortTerm.map((m) => ({ role: m.role, content: m.content })),
      emotionState: row.emotion_state || 'neutral',
    };
  }

  /**
   * Обновляет активный контекст беседы.
   */
  async updateContext(tenantId: string, activeMode: string, modeData: Record<string, unknown> = {}, emotionState: string = 'neutral'): Promise<void> {
    if (!sqliteDb) return;
    const stmt = sqliteDb.prepare(`
      INSERT INTO conversation_context (tenant_id, active_mode, mode_data, emotion_state, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET
        active_mode = excluded.active_mode,
        mode_data = excluded.mode_data,
        emotion_state = excluded.emotion_state,
        updated_at = excluded.updated_at
    `);
    stmt.run(tenantId, activeMode, JSON.stringify(modeData), emotionState, Date.now());
  }

  /**
   * Добавляет сообщение в краткосрочную память.
   */
  addMessage(tenantId: string, role: 'user' | 'assistant' | 'system', content: string): void {
    const buffer = this.shortTermBuffers.get(tenantId) || [];
    buffer.push({ role, content, timestamp: Date.now() });
    if (buffer.length > 20) {
      buffer.shift();
    }
    this.shortTermBuffers.set(tenantId, buffer);
  }

  /**
   * Воспроизводит (ищет) важные фрагменты долгосрочной памяти.
   */
  async recall(query: string, tenantId: string): Promise<MemoryFragment[]> {
    if (!sqliteDb) return [];
    try {
      const stmt = sqliteDb.prepare(`
        SELECT * FROM memory_long_term
        WHERE tenant_id = ?
        ORDER BY importance DESC, created_at DESC
        LIMIT 10
      `);
      const rows = stmt.all(tenantId);
      return rows.map((r: any) => ({
        id: r.id,
        type: r.type,
        content: r.content,
        importance: Number(r.importance) || 0.5,
        createdAt: Number(r.created_at),
        lastAccessedAt: r.last_accessed_at ? Number(r.last_accessed_at) : undefined,
      }));
    } catch (err) {
      logger.error('Failed to recall memories', { error: err, tenantId });
      return [];
    }
  }

  /**
   * Сохраняет новую запись в долгосрочную память.
   */
  async remember(tenantId: string, fragment: MemoryFragment): Promise<void> {
    if (!sqliteDb) return;
    try {
      const id = fragment.id || crypto.randomUUID();
      const stmt = sqliteDb.prepare(`
        INSERT INTO memory_long_term (id, tenant_id, type, content, importance, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        id,
        tenantId,
        fragment.type || 'interaction',
        fragment.content,
        fragment.importance || 0.5,
        fragment.createdAt || Date.now()
      );
    } catch (err) {
      logger.error('Failed to save memory fragment', { error: err, tenantId });
    }
  }
}

export const memorySystem = new MemorySystem();
