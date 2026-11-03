#!/usr/bin/env node
// 运维脚本：吊销某台设备的令牌。下一次请求即失效。
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const dbPath = process.env.DB_PATH || path.join(process.env.DATA_DIR || "/data", "mypi.db");
const args = process.argv.slice(2);
const idIndex = args.indexOf("--id");
const id = idIndex >= 0 ? (args[idIndex + 1] || "").trim() : "";

if (!id) {
  console.error("用法: node scripts/token-revoke.mjs --id <设备 id>");
  process.exit(2);
}

const db = new DatabaseSync(dbPath);
const row = db.prepare("SELECT id, label, revoked_at FROM device_tokens WHERE id = ?").get(id);
if (!row) {
  console.error(`没有这个设备：${id}`);
  process.exit(1);
}
db.prepare("UPDATE device_tokens SET revoked_at = ? WHERE id = ?").run(new Date().toISOString(), id);
console.log(`已吊销 ${row.id}（${row.label}）`);
db.close();
