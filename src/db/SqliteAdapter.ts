import { DatabaseAdapter } from "./DatabaseAdapter";

export class SqliteAdapter implements DatabaseAdapter {
  private db: any;

  constructor(dbInstance: any) {
    this.db = dbInstance;
  }

  async query<T>(sql: string, params: any[] = []): Promise<T[]> {
    try {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params);
      return rows as T[];
    } catch (err) {
      throw err;
    }
  }

  async get<T>(sql: string, params: any[] = []): Promise<T | undefined> {
    try {
      const stmt = this.db.prepare(sql);
      const row = stmt.get(...params);
      return row as T | undefined;
    } catch (err) {
      throw err;
    }
  }

  async run(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
    try {
      const stmt = this.db.prepare(sql);
      const result = stmt.run(...params);
      return {
        lastID: (result as any).lastID || 0,
        changes: (result as any).changes || 0
      };
    } catch (err) {
      throw err;
    }
  }

  async exec(sql: string): Promise<void> {
    try {
      this.db.exec(sql);
    } catch (err) {
      throw err;
    }
  }

  async close(): Promise<void> {
    try {
      this.db.close();
    } catch (err) {
      throw err;
    }
  }
}
