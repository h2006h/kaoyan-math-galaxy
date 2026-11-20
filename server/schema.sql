-- ─────────────────────────────────────────────────────────────
-- 考研数学知识宇宙 · 用户与账号数据库结构
-- 与前端演示实现 src/data/userStore.js 的 localStorage 表一一对应；
-- 接入真实后端时按本文件建表，userStore 的读写替换为 /api/auth/* 即可。
-- 方言：SQLite（MySQL / PostgreSQL 仅需把 TEXT 改 VARCHAR、INTEGER 主键改对应自增）。
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,                 -- 'demo-001' / 'u-<ts>-<rand>'
  username       TEXT NOT NULL,                    -- 展示用用户名（保留大小写）
  username_lower TEXT NOT NULL UNIQUE,             -- 唯一键：不区分大小写
  display_name   TEXT NOT NULL,                    -- 右上角昵称
  role           TEXT NOT NULL DEFAULT 'user'
                 CHECK (role IN ('demo', 'user', 'admin')),
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'disabled')),
  password_hash  TEXT,                             -- PBKDF2-SHA256(120k) Base64；演示账号为 NULL
  salt           TEXT,                             -- 16 字节随机盐 Base64
  iterations     INTEGER NOT NULL DEFAULT 120000,  -- 哈希迭代次数（便于将来升级）
  created_at     TEXT NOT NULL,
  last_login_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
CREATE INDEX IF NOT EXISTS idx_users_status   ON users (status);

-- 会话表：接后端后由服务端签发 token（前端演示版存 localStorage: kmu:session:v1）
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

-- 学习记录：演示版按 user_id 分键存 localStorage（kmu:records:<user_id>），
-- 接后端后迁移到本表；字段与 recordStore.appendRecord 的记录结构一致。
CREATE TABLE IF NOT EXISTS learning_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  question_id   TEXT NOT NULL,
  chapter_id    TEXT NOT NULL,
  point_ids     TEXT NOT NULL,     -- JSON 数组
  correct       INTEGER NOT NULL,  -- 0 / 1
  difficulty    INTEGER NOT NULL,
  chapter_delta REAL NOT NULL,
  point_deltas  TEXT NOT NULL,     -- JSON 对象：pointId -> delta
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_records_user ON learning_records (user_id, created_at);

-- 演示账号种子（密码为空，仅通过登录页「直接进入演示账号」进入）
-- INSERT OR IGNORE INTO users (id, username, username_lower, display_name, role, status, created_at)
-- VALUES ('demo-001', 'demo', 'demo', '演示账号', 'demo', 'active', '2026-11-01T00:00:00.000Z');
