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
          const match = cleanSql.match(/INSERT\s+(?:OR\s+REPLACE\s+)?INTO\s+([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
          if (match) {
            const tableName = match[1];
            const cols = match[2].split(",").map(c => c.trim().toLowerCase());
            const valTokens = match[3].split(",").map(v => v.trim());
            let table = this.tables.get(tableName);
            if (!table) {
              table = new Map();
              this.tables.set(tableName, table);
            }

            const row: Record<string, any> = {};
            let paramIdx = 0;
            cols.forEach((col, idx) => {
              const valToken = valTokens[idx] || '?';
              if (valToken === '?') {
                row[col] = params[paramIdx] !== undefined ? params[paramIdx] : null;
                paramIdx++;
              } else if (/^'.*'$/.test(valToken) || /^".*"$/.test(valToken)) {
                row[col] = valToken.slice(1, -1);
              } else if (/^\d+$/.test(valToken)) {
                row[col] = parseInt(valToken, 10);
              } else {
                row[col] = valToken;
              }
            });
            if (!row.tenant_id && tableName !== "user_sessions") row.tenant_id = "default";

            const firstCol = cols[0];
            const rowId = String(row.id || row.chatid || row.chat_id || row.key || (firstCol ? row[firstCol] : Math.random()));
            const existing = table.get(rowId);
            if (existing) {
              table.set(rowId, { ...existing, ...row });
            } else {
              table.set(rowId, row);
            }
            this.saveToDisk();
            return { changes: 1 };
          }
        } else if (upper.startsWith("UPDATE")) {
          const match = cleanSql.match(/UPDATE\s+([a-zA-Z0-9_]+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+?))?$/i);
          if (match) {
            const tableName = match[1];
            const setClause = match[2];
            const whereClause = match[3];
            const table = this.tables.get(tableName);
            if (table) {
              let changes = 0;
              // Parse SET assignments
              const setPairs = setClause.split(",").map(p => p.trim());
              for (const [k, row] of Array.from(table.entries())) {
                if (this.matchesWhere(row, whereClause, params)) {
                  let paramIdx = 0;
                  for (const pair of setPairs) {
                    const [c, valRaw] = pair.split("=").map(x => x.trim());
                    const colName = c.toLowerCase();
                    if (valRaw === '?') {
                      row[colName] = params[paramIdx++];
                    } else if (/^'.*'$/.test(valRaw) || /^".*"$/.test(valRaw)) {
                      row[colName] = valRaw.slice(1, -1);
                    } else if (/^\d+$/.test(valRaw)) {
                      row[colName] = parseInt(valRaw, 10);
                    } else {
                      row[colName] = valRaw;
                    }
                  }
                  table.set(k, { ...row });
                  changes++;
                }
              }
              this.saveToDisk();
              return { changes };
            }
          }
        } else if (upper.startsWith("DELETE FROM")) {
          const match = cleanSql.match(/DELETE\s+FROM\s+([a-zA-Z0-9_]+)(?:\s+WHERE\s+(.+?))?$/i);
          if (match) {
            const tableName = match[1];
            const whereClause = match[2];
            const table = this.tables.get(tableName);
            if (table) {
              if (!whereClause) {
                table.clear();
              } else {
                for (const [k, row] of Array.from(table.entries())) {
                  if (this.matchesWhere(row, whereClause, params)) {
                    table.delete(k);
                  }
                }
              }
            }
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

    // Check status condition if present
    if (cleanWhere.includes("status = 'pending'")) {
      if (row.status !== 'pending') return false;
    }
    if (cleanWhere.includes("status = 'done'")) {
      if (row.status !== 'done') return false;
    }
    
    // key = ? AND expires > ?
    if (cleanWhere.includes("key = ?") && cleanWhere.includes("expires > ?")) {
      const keyMatch = String(row.key) === String(params[0]);
      const expiresMatch = Number(row.expires || 0) > Number(params[1] || 0);
      return keyMatch && expiresMatch;
    }

    if (cleanWhere.includes("key = ?")) {
      return String(row.key) === String(params[0]);
    }
    if (cleanWhere.includes("chatid = ?") || cleanWhere.includes("chat_id = ?")) {
      const rId = row.chatId !== undefined ? row.chatId : (row.chat_id !== undefined ? row.chat_id : row.id);
      return String(rId) === String(params[0]);
    }
    if (cleanWhere.includes("active = ?")) {
      return Number(row.active) === Number(params[0]);
    }
    if (cleanWhere.includes("active = 1")) {
      return Number(row.active) === 1;
    }
    if (cleanWhere.includes("tenant_id = ?")) {
      return String(row.tenant_id) === String(params[0]);
    }
    if (cleanWhere.includes("id = ?")) {
      return String(row.id) === String(params[0]);
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
