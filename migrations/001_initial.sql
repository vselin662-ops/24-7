-- Initial PostgreSQL Schema Migration for Selin AI

-- 1. Configuration & Core Logs
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

-- 2. Core Autonomous Intelligence & Memory
CREATE TABLE IF NOT EXISTS memory_long_term (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding BYTEA,
  importance REAL DEFAULT 0.5,
  created_at BIGINT NOT NULL,
  last_accessed_at BIGINT
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  goal TEXT NOT NULL,
  steps_json TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  progress_percent INTEGER DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT
);

-- 3. User profiles and state engine
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
  updated_at BIGINT NOT NULL
);

-- 4. Education & Languages Module
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

-- 5. Subscriptions & Payments
CREATE TABLE IF NOT EXISTS bible_subs (
  chat_id TEXT PRIMARY KEY,
  start_date TEXT,
  active INTEGER,
  period_days INTEGER DEFAULT 365
);

CREATE TABLE IF NOT EXISTS subscriptions (
  chat_id TEXT PRIMARY KEY,
  plan TEXT,
  paid_until TEXT,
  active INTEGER
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  chat_id TEXT,
  plan TEXT,
  amount INTEGER,
  status TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS payment_requests (
  id SERIAL PRIMARY KEY,
  chat_id TEXT NOT NULL,
  tariff TEXT NOT NULL,
  screenshot_seen INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  status TEXT DEFAULT 'pending'
);

-- 6. Business Mentor Core
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

-- 7. OWASP Shield, Security & Sessions
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
  last_attempt_at BIGINT DEFAULT 0,
  blocked_until BIGINT DEFAULT 0
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

CREATE TABLE IF NOT EXISTS user_sessions (
  chat_id TEXT PRIMARY KEY,
  first_visit_done INTEGER DEFAULT 0,
  last_active TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS voice_prefs (
  chat_id TEXT PRIMARY KEY,
  gender TEXT DEFAULT 'male'
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_chats_tenant ON chats(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kb_tenant ON knowledge_base(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kb_docs_tenant ON kb_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_tenant ON kb_chunks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mod_queue_tenant ON moderation_queue(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mod_log_tenant ON moderation_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_feed_tenant ON feed(tenant_id);
CREATE INDEX IF NOT EXISTS idx_memory_tenant ON memory_long_term(tenant_id, type);
CREATE INDEX IF NOT EXISTS idx_lang_prog_tenant ON language_progress(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lang_less_tenant ON language_lessons(tenant_id);
CREATE INDEX IF NOT EXISTS idx_biz_tasks_tenant ON business_tasks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_chat ON subscriptions(chat_id);
CREATE INDEX IF NOT EXISTS idx_payments_chat ON payments(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pay_req_chat ON payment_requests(chat_id, status);
