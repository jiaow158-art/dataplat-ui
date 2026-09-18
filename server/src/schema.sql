-- UI BFF 记账库（spec §2/§3）——与网关库分工：任务/事件的事实源在网关，
-- 这里只存 UI 域便利数据（账号、登录会话、会话标题、消息历史索引）。
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,          -- bcryptjs（纯 JS，免 Windows 原生编译）
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (   -- 登录会话（服务端可吊销；cookie 只存 token）
  token TEXT PRIMARY KEY,               -- 128bit 随机 hex
  username TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username);
CREATE TABLE IF NOT EXISTS ui_sessions ( -- UI 侧会话（标题=首问前 30 字，可重命名；网关不管理会话元数据）
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ui_sessions_username ON ui_sessions(username, updated_at);
CREATE TABLE IF NOT EXISTS messages (   -- 每次提问一行：run_id 关联网关任务（BFF 记账非事实源，spec §8）
  id TEXT PRIMARY KEY,
  ui_session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  gateway_session_id TEXT NOT NULL,     -- 网关逻辑会话（D14 历史注入用，追问透传给网关）
  question TEXT NOT NULL,
  answer_md TEXT,                       -- answer 事件途经 SSE 代理时顺带落账
  report_path TEXT,                     -- report 事件途经时落账
  status TEXT NOT NULL,                 -- 镜像网关状态机 queued|running|succeeded|failed|cancelled
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_ui_session ON messages(ui_session_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_run ON messages(run_id);
