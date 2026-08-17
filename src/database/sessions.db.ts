import { PureDatabase } from '../lib/pure-sqlite';
import path from 'path';
import fs from 'fs';

const dbDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const sessionsDbPath = path.join(dbDir, 'sessions.sqlite');

class Sqlite3Simulation {
  private dbInstance: PureDatabase;

  constructor(filePath: string) {
    this.dbInstance = new PureDatabase(filePath);
  }

  exec(sql: string, callback?: (err: Error | null) => void) {
    try {
      this.dbInstance.exec(sql);
      if (callback) callback(null);
    } catch (err: any) {
      if (callback) callback(err);
    }
  }

  run(sql: string, params: any[], callback?: (err: Error | null) => void) {
    try {
      this.dbInstance.prepare(sql).run(...params);
      if (callback) callback(null);
    } catch (err: any) {
      if (callback) callback(err);
    }
  }

  get(sql: string, params: any[], callback?: (err: Error | null, row?: any) => void) {
    try {
      const row = this.dbInstance.prepare(sql).get(...params);
      if (callback) callback(null, row);
    } catch (err: any) {
      if (callback) callback(err);
    }
  }

  close(callback?: (err: Error | null) => void) {
    try {
      this.dbInstance.close();
      if (callback) callback(null);
    } catch (err: any) {
      if (callback) callback(err);
    }
  }
}

export const db = new Sqlite3Simulation(sessionsDbPath);

export function queryGet<T>(sql: string, params: any[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row as T);
    });
  });
}

export function queryRun(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err) reject(err);
      else resolve({ lastID: 0, changes: 1 });
    });
  });
}

export function queryExec(sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function initSessionsDb(): Promise<void> {
  await queryExec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      chat_id TEXT PRIMARY KEY,
      first_visit_done INTEGER DEFAULT 0,
      last_active DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export async function hasUserInteractedBefore(chatId: string): Promise<boolean> {
  try {
    const cleanId = String(chatId).replace(/^[a-z_]+/, '');
    const row = await queryGet<{ first_visit_done: number }>(
      'SELECT first_visit_done FROM user_sessions WHERE chat_id = ?',
      [cleanId]
    );
    return row ? row.first_visit_done === 1 : false;
  } catch (err) {
    console.error("❌ Error in hasUserInteractedBefore:", err);
    return true; // safe fallback
  }
}

export async function markUserAsVisited(chatId: string): Promise<void> {
  try {
    const cleanId = String(chatId).replace(/^[a-z_]+/, '');
    await queryRun(`
      INSERT OR REPLACE INTO user_sessions (chat_id, first_visit_done, last_active) 
      VALUES (?, 1, CURRENT_TIMESTAMP)
    `, [cleanId]);
  } catch (err) {
    console.error("❌ Error in markUserAsVisited:", err);
  }
}

export function closeDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
