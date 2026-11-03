import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** 迁移按顺序应用，索引 + 1 即目标 user_version。 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS device_tokens (
    id            TEXT PRIMARY KEY,
    label         TEXT NOT NULL,
    token_hash    TEXT NOT NULL UNIQUE,
    token_prefix  TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    last_used_at  TEXT,
    revoked_at    TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_device_tokens_hash ON device_tokens(token_hash);

  CREATE TABLE IF NOT EXISTS audit_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ts            TEXT NOT NULL,
    device_id     TEXT,
    token_prefix  TEXT,
    kind          TEXT NOT NULL,
    detail        TEXT NOT NULL,
    result        TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_events(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_device ON audit_events(device_id, ts DESC);
  `,
];

export function openDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=NORMAL");
  db.exec("PRAGMA foreign_keys=ON");
  migrate(db);
  return db;
}

export function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number } | undefined;
  const current = Number(row?.user_version ?? 0);
  for (let version = current; version < MIGRATIONS.length; version += 1) {
    const sql = MIGRATIONS[version];
    if (!sql) continue;
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.exec(`PRAGMA user_version=${version + 1}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
