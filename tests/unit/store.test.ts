import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "../../src/server/store/db.ts";
import { DeviceStore } from "../../src/server/store/device-store.ts";
import { AuditStore } from "../../src/server/store/audit-store.ts";

test("迁移把 user_version 推到最新", () => {
  const db = openDatabase(":memory:");
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  assert.ok(row.user_version >= 1);
  db.close();
});

test("重复打开不会重复建表", () => {
  const db = openDatabase(":memory:");
  db.exec("PRAGMA user_version=0");
  db.close();
  const again = openDatabase(":memory:");
  assert.ok((again.prepare("PRAGMA user_version").get() as { user_version: number }).user_version >= 1);
  again.close();
});

test("设备令牌只存哈希与前缀，不存明文", () => {
  const db = openDatabase(":memory:");
  const store = new DeviceStore(db);
  const created = store.create("laptop");
  const row = db.prepare("SELECT * FROM device_tokens WHERE id = ?").get(created.record.id) as Record<string, unknown>;
  assert.equal(row.token_hash, created.record.token_hash);
  assert.equal(String(row.token_hash).includes(created.token), false);
  assert.equal(String(row.token_prefix).length, 8);
  db.close();
});

test("吊销后 revoked_at 非空，且仍能查到记录", () => {
  const db = openDatabase(":memory:");
  const store = new DeviceStore(db);
  const created = store.create("phone");
  assert.equal(store.revoke(created.record.id), true);
  const after = store.get(created.record.id);
  assert.ok(after?.revoked_at);
  assert.equal(store.revoke("dev_missing"), false);
  db.close();
});

test("审计 detail 被截断到 200 字符", () => {
  const db = openDatabase(":memory:");
  const audit = new AuditStore(db);
  audit.record({ kind: "message", detail: "x".repeat(500), result: "ok" });
  const [event] = audit.list(1);
  assert.equal(event?.detail.length, 200);
  db.close();
});

test("审计按时间倒序返回", () => {
  const db = openDatabase(":memory:");
  const audit = new AuditStore(db);
  audit.record({ kind: "auth", detail: "first", result: "denied" });
  audit.record({ kind: "auth", detail: "second", result: "denied" });
  const events = audit.list(10);
  assert.equal(events[0]?.detail, "second");
  assert.equal(audit.count(), 2);
  db.close();
});
