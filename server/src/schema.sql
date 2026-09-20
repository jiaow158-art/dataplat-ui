-- UI BFF 记账库（spec §2/§3）——与网关库分工：任务/事件的事实源在网关，
-- 这里只存 UI 域便利数据（账号、登录会话、会话标题、消息历史索引）。
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,          -- bcryptjs（纯 JS，免 Windows 原生编译）
  is_admin INTEGER NOT NULL DEFAULT 0,  -- M4-B1 角色标记位（0=普通 1=管理员；旧库由 initDb 补列）
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
CREATE TABLE IF NOT EXISTS admin_audit ( -- M4-B5 管理操作留痕（CLI 与 B2 程序化入口都写；只增不删）
  id TEXT PRIMARY KEY,                  -- aa-<uuid>
  username TEXT NOT NULL,               -- 操作者（CLI 记 "<cli>"）
  action TEXT NOT NULL,                 -- user_create|user_disable|user_enable|password_reset|grant_admin|revoke_admin
  target TEXT NOT NULL,                 -- 被操作账号
  detail TEXT,                          -- 补充说明（如 is_admin 0→1）；绝不写凭据
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at);
CREATE TABLE IF NOT EXISTS login_log (  -- M4-B6 登录记账（旁路：不动 sessions 语义；logout_at NULL=存活/超时）
  id TEXT PRIMARY KEY,                  -- ll-<uuid>
  username TEXT NOT NULL,
  token_prefix TEXT NOT NULL,           -- token 前 6 位（对齐网关 audit.mjs maskToken——不存全 token）
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  logout_at INTEGER                     -- 登出时刻；未登出（存活或超时）保持 NULL
);
CREATE INDEX IF NOT EXISTS idx_login_log_user ON login_log(username, created_at);
