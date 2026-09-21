// M4-B1/B5/B6 + 反馈闭环 生产库一键迁移：对 DATA_DIR 下 bff.db 幂等补齐（users.is_admin 列 +
// admin_audit/login_log/incidents 表）。幂等可重跑；不动运行中服务（WAL 允许旁路短暂加锁）。
// 用法：DATA_DIR=./data-prod node src/migrate.ts   （或 npm run migrate）
import { join } from "node:path";
import Database from "better-sqlite3";
import { initDb } from "./db.ts";

const dataDir = process.env.DATA_DIR || "./data";
const dbFile = join(dataDir, "bff.db");

// 迁移只针对已有库（新库首启 initDb 自动建全 schema）
const probe = new Database(dbFile, { fileMustExist: true });
const hadIsAdmin = (probe.prepare("PRAGMA table_info(users)").all() as { name: string }[]).some((c) => c.name === "is_admin");
probe.close();

const db = initDb(dataDir); // 内含补列 ALTER（pragma 检测，已含则跳过）+ CREATE TABLE IF NOT EXISTS
const cols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name);
db.close();

console.log(`[migrate] ${dbFile}`);
console.log(`[migrate] users.is_admin ${cols.includes("is_admin") ? "已就绪" : "缺失(异常)"}`);
console.log(`[migrate] ${hadIsAdmin ? "本就含 is_admin——本次无列变更" : "已补列 is_admin INTEGER NOT NULL DEFAULT 0（存量行默认 0）"}`);
console.log("[migrate] admin_audit / login_log / incidents 表已确保存在（CREATE TABLE IF NOT EXISTS）");
