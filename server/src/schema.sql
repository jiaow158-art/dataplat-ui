-- UI BFF 记账库（spec §2/§3）——与网关库分工：任务/事件的事实源在网关，
-- 这里只存 UI 域便利数据（账号、登录会话、会话标题、消息历史索引）。
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,          -- bcryptjs（纯 JS，免 Windows 原生编译）
  is_admin INTEGER NOT NULL DEFAULT 0,  -- M4-B1 角色标记位（0=普通 1=管理员；旧库由 initDb 补列）
  disabled INTEGER NOT NULL DEFAULT 0,  -- M4-B2 停用位（1=停用：登录 401 同密码错形态；旧库由 initDb 补列）
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
  action TEXT NOT NULL,                 -- user_create|user_disable|user_enable|password_reset|grant_admin|revoke_admin|incident_update
  target TEXT NOT NULL,                 -- 被操作账号 / incident id
  detail TEXT,                          -- 补充说明（如 is_admin 0→1、状态 旧→新）；绝不写凭据
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
CREATE TABLE IF NOT EXISTS incidents (  -- 用户反馈闭环（知识健康治理 §三B）：对话流「有问题」→ 管理队列
  id TEXT PRIMARY KEY,                  -- fb-<uuid>
  username TEXT NOT NULL,               -- 反馈人（会话身份，不信自报）
  run_id TEXT NOT NULL,                 -- 关联网关任务（messages.run_id 同域，队列联查问题文本）
  ui_session_id TEXT,                   -- UI 会话（可选，定位对话上下文）
  category TEXT NOT NULL,               -- 封闭集：数值不对|口径不对|看不懂|其他
  description TEXT,                     -- 补充说明（≤500 字，选填）
  status TEXT NOT NULL,                 -- 封闭集与流转：待归因→修复中/驳回；修复中→已发布/驳回；驳回→待归因
  resolution_note TEXT,                 -- 处置说明（管理员可编辑）
  fix_commit TEXT,                      -- 知识修复过发布门后的 commit sha（8-40 hex；已发布必填）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status, created_at);
CREATE INDEX IF NOT EXISTS idx_incidents_dedup ON incidents(username, run_id, category, created_at);
CREATE TABLE IF NOT EXISTS domain_requests ( -- 域申请队列（知识健康治理 §四C 扩域入口）：用户申请新域 → 管理受理
  id TEXT PRIMARY KEY,                  -- dr-<uuid>
  domain_name TEXT NOT NULL,            -- 申请的域（2-40 字）
  example_questions TEXT,               -- 典型问题（≤1000 字，选填——受理后排场景实录）
  urgency TEXT NOT NULL,                -- 封闭集：高|中|低
  username TEXT NOT NULL,               -- 申请人（会话身份，不信自报）
  status TEXT NOT NULL,                 -- 封闭集与流转：待受理→受理/搁置/驳回；受理→搁置/驳回；搁置→受理/驳回；驳回→待受理
  note TEXT,                            -- 处置备注（管理员可编辑）
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_domain_requests_status ON domain_requests(status, created_at);
CREATE TABLE IF NOT EXISTS user_flags (  -- M-i3 insight 灰度（spec §13）：flag 只控入口，不做数据权限
  username TEXT NOT NULL,
  flag TEXT NOT NULL,                    -- 'insight_cockpit'
  enabled INTEGER NOT NULL DEFAULT 0,
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (username, flag)
);
CREATE TABLE IF NOT EXISTS followup_log ( -- 事件追问审计（v1.2.4：落 BFF 记账库，不进 insight.db）
  id TEXT PRIMARY KEY,                   -- fu-<uuid>
  username TEXT NOT NULL,                -- 追问人（会话身份）
  event_id TEXT NOT NULL,                -- insight 事件
  ui_session_id TEXT NOT NULL,           -- 种子会话
  prompt TEXT,                           -- 用户自定义意图（可空=默认分析）
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_followup_event ON followup_log(event_id, created_at);
