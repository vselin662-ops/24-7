import { DatabaseAdapter } from "./DatabaseAdapter";
import { SqliteAdapter } from "./SqliteAdapter";
import { PostgresAdapter } from "./PostgresAdapter";
import { sqliteDb } from "../../db";
import { logger } from "../logger";

let activeAdapter: DatabaseAdapter | null = null;

export function getDatabaseAdapter(): DatabaseAdapter {
  if (activeAdapter) {
    return activeAdapter;
  }

  const dbType = (process.env.DB_TYPE || "sqlite").toLowerCase();

  if (dbType === "postgres") {
    logger.info("🔌 [dbFactory] Initializing PostgreSQL Database Adapter...");
    activeAdapter = new PostgresAdapter();
  } else {
    logger.info("🔌 [dbFactory] Initializing SQLite Database Adapter...");
    activeAdapter = new SqliteAdapter(sqliteDb);
  }

  return activeAdapter;
}
