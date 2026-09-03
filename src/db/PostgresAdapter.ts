import { Pool } from "pg";
import { DatabaseAdapter } from "./DatabaseAdapter";
import { logger } from "../logger";

export class PostgresAdapter implements DatabaseAdapter {
  private pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      logger.warn("⚠️ DATABASE_URL is not set. Defaulting Postgres adapter connection.");
    }
    this.pool = new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined
    });
  }

  private convertSql(sql: string): string {
    let index = 1;
    // Replace "?" with "$1", "$2" etc., ignoring inside quotes if needed (standard replace is usually fine for queries in this app)
    return sql.replace(/\?/g, () => `$${index++}`);
  }

  async query<T>(sql: string, params: any[] = []): Promise<T[]> {
    const pgSql = this.convertSql(sql);
    try {
      const res = await this.pool.query(pgSql, params);
      return res.rows as T[];
    } catch (err: any) {
      logger.error(`❌ [PostgresAdapter.query] Error: ${err?.message}`, { sql, pgSql, params });
      throw err;
    }
  }

  async get<T>(sql: string, params: any[] = []): Promise<T | undefined> {
    const pgSql = this.convertSql(sql);
    try {
      const res = await this.pool.query(pgSql, params);
      return res.rows[0] as T | undefined;
    } catch (err: any) {
      logger.error(`❌ [PostgresAdapter.get] Error: ${err?.message}`, { sql, pgSql, params });
      throw err;
    }
  }

  async run(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
    const pgSql = this.convertSql(sql);
    try {
      const res = await this.pool.query(pgSql, params);
      return {
        lastID: 0, // PostgreSQL uses sequences instead of simple lastID, returning 0 for generic compatibility
        changes: res.rowCount || 0
      };
    } catch (err: any) {
      logger.error(`❌ [PostgresAdapter.run] Error: ${err?.message}`, { sql, pgSql, params });
      throw err;
    }
  }

  async exec(sql: string): Promise<void> {
    try {
      await this.pool.query(sql);
    } catch (err: any) {
      logger.error(`❌ [PostgresAdapter.exec] Error: ${err?.message}`, { sql });
      throw err;
    }
  }

  async close(): Promise<void> {
    try {
      await this.pool.end();
    } catch (err: any) {
      logger.error(`❌ [PostgresAdapter.close] Error: ${err?.message}`);
      throw err;
    }
  }
}
