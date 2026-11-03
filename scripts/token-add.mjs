#!/usr/bin/env node
// 运维脚本：签发一台设备的令牌。只在标准输出打印一次明文。
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.DB_PATH || path.join(process.env.DATA_DIR || "/data", "mypi.db");

const args = process.argv.slice(2);
const labelIndex = args.indexOf("--label");
const label = labelIndex >= 0 ? (args[labelIndex + 1] || "").trim() : "";

if (!label) {
  console.error("用法: node scripts/token-add.mjs --label <设备名>");
  process.exit(2);
}

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode=WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS device_tokens (
    id TEXT PRIMARY KEY, label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
    token_prefix TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_device_tokens_hash ON device_tokens(token_hash);
  CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, device_id TEXT, token_prefix TEXT,
    kind TEXT NOT NULL, detail TEXT NOT NULL, result TEXT NOT NULL
  );
`);

const token = randomBytes(32).toString("base64url");
const id = `dev_${randomBytes(6).toString("hex")}`;
db.prepare(
  `INSERT INTO device_tokens (id, label, token_hash, token_prefix, created_at, last_used_at, revoked_at)
   VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
).run(id, label, createHash("sha256").update(token, "utf8").digest("hex"), token.slice(0, 8), new Date().toISOString());

console.log(`已签发设备 ${id}（${label}）`);
console.log(`令牌（只显示这一次，请立刻保存）：\n${token}`);
db.close();
