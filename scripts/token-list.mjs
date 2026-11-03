#!/usr/bin/env node
// 运维脚本：列出设备（只有前缀，没有明文）。
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const dbPath = process.env.DB_PATH || path.join(process.env.DATA_DIR || "/data", "mypi.db");
const db = new DatabaseSync(dbPath);
const rows = db
  .prepare("SELECT id, label, token_prefix, created_at, last_used_at, revoked_at FROM device_tokens ORDER BY created_at DESC")
  .all();

if (rows.length === 0) {
  console.log("（还没有设备）");
} else {
  for (const row of rows) {
    const state = row.revoked_at ? `已吊销 ${row.revoked_at}` : "有效";
    console.log(`${row.id}  ${row.label}  ${row.token_prefix}  创建 ${row.created_at}  最近 ${row.last_used_at ?? "—"}  ${state}`);
  }
}
db.close();
