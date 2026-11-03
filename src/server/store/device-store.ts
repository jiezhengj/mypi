import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { generateToken, hashToken, tokenPrefix } from "../util/tokens.ts";
import { nowIso } from "./db.ts";

export interface DeviceRecord {
  id: string;
  label: string;
  token_hash: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface CreatedDevice {
  record: DeviceRecord;
  /** 明文令牌，只在签发时返回一次。 */
  token: string;
}

export class DeviceStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  create(label: string): CreatedDevice {
    const token = generateToken();
    const record: DeviceRecord = {
      id: `dev_${randomBytes(6).toString("hex")}`,
      label: label.trim(),
      token_hash: hashToken(token),
      token_prefix: tokenPrefix(token),
      created_at: nowIso(),
      last_used_at: null,
      revoked_at: null,
    };
    this.db
      .prepare(
        `INSERT INTO device_tokens (id, label, token_hash, token_prefix, created_at, last_used_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.label,
        record.token_hash,
        record.token_prefix,
        record.created_at,
        record.last_used_at,
        record.revoked_at,
      );
    return { record, token };
  }

  findByHash(tokenHash: string): DeviceRecord | undefined {
    const row = this.db.prepare("SELECT * FROM device_tokens WHERE token_hash = ?").get(tokenHash);
    return (row as DeviceRecord | undefined) ?? undefined;
  }

  get(id: string): DeviceRecord | undefined {
    const row = this.db.prepare("SELECT * FROM device_tokens WHERE id = ?").get(id);
    return (row as DeviceRecord | undefined) ?? undefined;
  }

  list(): DeviceRecord[] {
    return this.db
      .prepare("SELECT * FROM device_tokens ORDER BY created_at DESC")
      .all() as unknown as DeviceRecord[];
  }

  revoke(id: string): boolean {
    const existing = this.get(id);
    if (!existing) return false;
    this.db.prepare("UPDATE device_tokens SET revoked_at = ? WHERE id = ?").run(nowIso(), id);
    return true;
  }

  touch(id: string): void {
    this.db.prepare("UPDATE device_tokens SET last_used_at = ? WHERE id = ?").run(nowIso(), id);
  }
}
