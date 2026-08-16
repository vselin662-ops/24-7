import fs from "fs";
import path from "path";

export class PureDatabase {
  private memoryMode: boolean;
  private filePath: string;
  private tables: Map<string, Map<string, any>> = new Map();

  constructor(filename: string) {
    this.memoryMode = filename === ":memory:";
    this.filePath = this.memoryMode ? "" : (path.isAbsolute(filename) ? filename : path.join(process.cwd(), filename));
    if (!this.memoryMode) {
      this.loadFromDisk();
    }
  }

  private loadFromDisk() {
    try {
      if (this.filePath && fs.existsSync(this.filePath)) {
        const content = fs.readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === "object") {
          for (const [tbl, rowsObj] of Object.entries(parsed)) {
            const map = new Map<string, any>();
            if (rowsObj && typeof rowsObj === "object") {
              for (const [k, v] of Object.entries(rowsObj as Record<string, any>)) {
                map.set(k, v);
              }
            }
            this.tables.set(tbl, map);
          }
        }
      }
    } catch (e) {
      // Ignore load errors
    }
  }

  private saveToDisk() {
    if (this.memoryMode || !this.filePath) return;
    try {
      const obj: Record<string, Record<string, any>> = {};
      for (const [tbl, map] of this.tables.entries()) {
        obj[tbl] = {};
        for (const [k, v] of map.entries()) {
          obj[tbl][k] = v;
        }
      }
      fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2), "utf-8");
    } catch (e) {
      // Ignore save errors
    }
  }

  pragma(str: string) {
    if (str.includes("table_info")) {
      const match = str.match(/table_info\(([^)]+)\)/);
      const tableName = match ? match[1].trim() : "";
      const table = this.tables.get(tableName);
      if (!table) return [];
      return [
        { name: "id" },
        { name: "tenant_id" },
        { name: "data" },
        { name: "updated_at" },
        { name: "created_at" },
        { name: "role" },
        { name: "type" },
        { name: "title" },
        { name: "detail" },
        { name: "status" },
        { name: "ts" }
      ];
    }
    return [];
  }

  exec(sql: string) {
    const stmts = sql.split(";").map(s => s.trim()).filter(Boolean);
    for (const stmt of stmts) {
      const upper = stmt.toUpperCase();
      if (upper.startsWith("CREATE TABLE")) {
        const match = stmt.match(/CREATE TABLE (?:IF NOT EXISTS )?([a-zA-Z0-9_]+)/i);
        if (match) {
          const tableName = match[1];
          if (!this.tables.has(tableName)) {
            this.tables.set(tableName, new Map());
          }
        }
      } else if (upper.startsWith("DELETE FROM")) {
        const match = stmt.match(/DELETE FROM ([a-zA-Z0-9_]+)/i);
        if (match) {
          const tableName = match[1];
          const table = this.tables.get(tableName);
          if (table) table.clear();
        }
      }
    }
    this.saveToDisk();
  }

  prepare(sql: string) {
    const cleanSql = sql.replace(/\s+/g, " ").trim();
    const upper = cleanSql.toUpperCase();

    return {
      run: (...params: any[]) => {
        if (upper.includes("INSERT INTO") || upper.includes("INSERT OR REPLACE INTO")) {
          const match = cleanSql.match(/INSERT\s+(?:OR\s+REPLACE\s+)?INTO\s+([a-zA-Z0-9_]+)\s*\(([^)]+)\)/i);
          if (match) {
            const tableName = match[1];
            const cols = match[2].split(",").map(c => c.trim().toLowerCase());
            let table = this.tables.get(tableName);
            if (!table) {
              table = new Map();
              this.tables.set(tableName, table);
            }

            const row: Record<string, any> = {};
            cols.forEach((col, idx) => {
              row[col] = params[idx] !== undefined ? params[idx] : null;
            });
            if (!row.tenant_id && tableName !== "user_sessions") row.tenant_id = "default";

            const rowId = String(row.id || row.chat_id || Object.keys(row)[0] || Math.random());
            const existing = table.get(rowId);
            if (existing) {
              table.set(rowId, { ...existing, ...row });
            } else {
              table.set(rowId, row);
            }
            this.saveToDisk();
            return { changes: 1 };
          }
        } else if (upper.startsWith("DELETE FROM")) {
          const match = cleanSql.match(/DELETE FROM ([a-zA-Z0-9_]+)/i);
          if (match) {
            const tableName = match[1];
            const table = this.tables.get(tableName);
            if (table) table.clear();
            this.saveToDisk();
            return { changes: 1 };
          }
        }
        return { changes: 0 };
      },

      get: (...params: any[]) => {
        if (upper === "SELECT 1") return { 1: 1 };

        const match = cleanSql.match(/SELECT\s+(.+?)\s+FROM\s+([a-zA-Z0-9_]+)(?:\s+WHERE\s+(.+?))?$/i);
        if (match) {
          const tableName = match[2];
          const whereClause = match[3];
          const table = this.tables.get(tableName);
          if (!table) return undefined;

          for (const row of table.values()) {
            if (this.matchesWhere(row, whereClause, params)) {
              return row;
            }
          }
        }
        return undefined;
      },

      all: (...params: any[]) => {
        const match = cleanSql.match(/SELECT\s+(.+?)\s+FROM\s+([a-zA-Z0-9_]+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER BY\s+(.+?))?(?:\s+LIMIT\s+(\d+))?$/i);
        if (match) {
          const tableName = match[2];
          const whereClause = match[3];
          const orderClause = match[4];
          const limitClause = match[5];

          const table = this.tables.get(tableName);
          if (!table) return [];

          let results: any[] = [];
          for (const row of table.values()) {
            if (this.matchesWhere(row, whereClause, params)) {
              results.push(row);
            }
          }

          if (orderClause) {
            const orderParts = orderClause.trim().split(/\s+/);
            const col = orderParts[0].toLowerCase();
            const isDesc = orderParts[1] && orderParts[1].toUpperCase() === "DESC";
            results.sort((a, b) => {
              const valA = a[col] || "";
              const valB = b[col] || "";
              if (valA < valB) return isDesc ? 1 : -1;
              if (valA > valB) return isDesc ? -1 : 1;
              return 0;
            });
          }

          if (limitClause) {
            const lim = parseInt(limitClause, 10);
            if (!isNaN(lim)) results = results.slice(0, lim);
          }

          return results;
        }
        return [];
      }
    };
  }

  private matchesWhere(row: any, whereClause?: string, params: any[] = []): boolean {
    if (!whereClause) return true;
    const cleanWhere = whereClause.toLowerCase();
    if (cleanWhere.includes("tenant_id = ?")) {
      return String(row.tenant_id) === String(params[0]);
    }
    if (cleanWhere.includes("id = ?")) {
      return String(row.id) === String(params[0]);
    }
    if (cleanWhere.includes("chat_id = ?")) {
      return String(row.chat_id) === String(params[0]);
    }
    return true;
  }

  transaction(fn: Function) {
    return (...args: any[]) => fn(...args);
  }

  close() {
    this.saveToDisk();
  }
}
