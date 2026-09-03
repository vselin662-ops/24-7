export interface DatabaseAdapter {
  query<T>(sql: string, params?: any[]): Promise<T[]>;
  get<T>(sql: string, params?: any[]): Promise<T | undefined>;
  run(sql: string, params?: any[]): Promise<{ lastID: number; changes: number }>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}
