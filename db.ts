import { PureDatabase as Database } from "./src/lib/pure-sqlite";
import path from "path";
import { logger } from "./src/logger";

const dbPath = path.join(process.cwd(), "selin_data.db");


let sqliteDb: any = null;

try {
  sqliteDb = new Database(dbPath);
  sqliteDb.pragma("journal_mode = WAL");
  sqliteDb.pragma("synchronous = NORMAL");

  // Инициализация схем таблиц для config, chats, kb, moderation, feed
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS config (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_base (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kb_documents (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kb_chunks (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS moderation_queue (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS moderation_log (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feed (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      role TEXT,
      type TEXT,
      title TEXT,
      detail TEXT,
      status TEXT,
      ts TEXT NOT NULL
    );

    -- Core Autonomous Intelligence Tables
    CREATE TABLE IF NOT EXISTS memory_long_term (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding BLOB,
      importance REAL DEFAULT 0.5,
      created_at INTEGER NOT NULL,
      last_accessed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_memory_tenant ON memory_long_term(tenant_id, type);

    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      goal TEXT NOT NULL,
      steps_json TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      progress_percent INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      tenant_id TEXT PRIMARY KEY,
      preferences_json TEXT,
      personality_json TEXT,
      emotional_baseline TEXT DEFAULT 'neutral',
      total_interactions INTEGER DEFAULT 0,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_context (
      tenant_id TEXT PRIMARY KEY,
      active_mode TEXT DEFAULT 'general',
      mode_data TEXT,
      last_messages_json TEXT,
      emotion_state TEXT DEFAULT 'neutral',
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS language_settings (
      tenant_id TEXT PRIMARY KEY,
      target_language TEXT NOT NULL DEFAULT 'en',
      native_language TEXT NOT NULL DEFAULT 'ru',
      level TEXT NOT NULL DEFAULT 'A1',
      daily_goal INTEGER NOT NULL DEFAULT 10,
      streak INTEGER NOT NULL DEFAULT 0,
      total_words_learned INTEGER NOT NULL DEFAULT 0,
      current_lesson INTEGER NOT NULL DEFAULT 1,
      started_at TEXT
    );

    CREATE TABLE IF NOT EXISTS language_progress (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      word TEXT NOT NULL,
      translation TEXT,
      example TEXT,
      transcription TEXT,
      next_review_at TEXT,
      review_count INTEGER DEFAULT 0,
      ease_factor REAL DEFAULT 2.5,
      interval_days REAL DEFAULT 1,
      last_reviewed_at TEXT,
      mastery INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS language_lessons (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      lesson_num INTEGER DEFAULT 1,
      topic TEXT,
      words_json TEXT,
      dialogue_json TEXT,
      homework TEXT,
      homework_done INTEGER DEFAULT 0,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS user_mode (
      tenant_id TEXT PRIMARY KEY,
      mode TEXT DEFAULT 'general',
      mode_data TEXT,
      updated_at TEXT
    );

    -- Business Mentor Tables
    CREATE TABLE IF NOT EXISTS business_profile (
      tenant_id TEXT PRIMARY KEY,
      niche TEXT,
      stage TEXT DEFAULT 'idea',
      revenue REAL DEFAULT 0,
      team_size INTEGER DEFAULT 1,
      main_problem TEXT,
      goals_json TEXT,
      started_at TEXT
    );

    CREATE TABLE IF NOT EXISTS business_tasks (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      due_date TEXT,
      status TEXT DEFAULT 'pending',
      result TEXT,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS business_streaks (
      tenant_id TEXT PRIMARY KEY,
      current_streak INTEGER DEFAULT 0,
      max_streak INTEGER DEFAULT 0,
      last_active_date TEXT
    );

    -- AI Security Shield Tables (OWASP Top 10 for LLM 2026)
    CREATE TABLE IF NOT EXISTS security_audit (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      event_type TEXT NOT NULL,
      details TEXT,
      risk_score REAL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jailbreak_log (
      tenant_id TEXT PRIMARY KEY,
      count INTEGER DEFAULT 0,
      last_attempt_at INTEGER DEFAULT 0,
      blocked_until INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS mcp_hashes (
      tool_name TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      approved_by TEXT DEFAULT 'system',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS canary_tokens (
      token TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chats_tenant ON chats(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_kb_tenant ON knowledge_base(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_kb_docs_tenant ON kb_documents(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_kb_chunks_tenant ON kb_chunks(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_mod_queue_tenant ON moderation_queue(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_mod_log_tenant ON moderation_log(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_feed_tenant ON feed(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_lang_prog_tenant ON language_progress(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_lang_less_tenant ON language_lessons(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_biz_tasks_tenant ON business_tasks(tenant_id);
  `);

  // Safe migration for adding tenant_id to pre-existing tables if created without it
  const tablesToMigrate = ["chats", "knowledge_base", "kb_documents", "kb_chunks", "moderation_queue", "moderation_log", "feed"];
  for (const table of tablesToMigrate) {
    try {
      const columns = sqliteDb.pragma(`table_info(${table})`);
      const hasTenant = columns.some((col: any) => col.name === "tenant_id");
      if (!hasTenant) {
        sqliteDb.exec(`ALTER TABLE ${table} ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'`);
      }
    } catch (e) {
      // Ignore migration errors if table doesn't exist or already modified
    }
  }
  logger.info("SQLite DB (WAL mode) initialized successfully", { dbPath });
} catch (err) {
  logger.error("Error opening SQLite DB", { error: err });
}

export function initDataStore() {
  if (!sqliteDb) return;
  // db is already initialized upon require/import, but this ensures schema readiness
  return true;
}

export { sqliteDb };
