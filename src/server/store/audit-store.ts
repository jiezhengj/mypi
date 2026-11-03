import type { DatabaseSync } from "node:sqlite";
import { MAX_AUDIT_DETAIL, type AuditEventDto } from "../../shared/contracts.ts";
import { nowIso } from "./db.ts";

export type AuditKind = AuditEventDto["kind"];
export type AuditResult = AuditEventDto["result"];

export interface AuditInput {
  deviceId?: string | null;
  tokenPrefix?: string | null;
  kind: AuditKind;
  detail: string;
  result: AuditResult;
}

/** 审计只追加。detail 截断到 200 字符，且调用方不得放入令牌明文或完整正文。 */
export class AuditStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  record(input: AuditInput): void {
    const detail = input.detail.slice(0, MAX_AUDIT_DETAIL);
    this.db
      .prepare(
        `INSERT INTO audit_events (ts, device_id, token_prefix, kind, detail, result)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(nowIso(), input.deviceId ?? null, input.tokenPrefix ?? null, input.kind, detail, input.result);
  }

  list(limit: number): AuditEventDto[] {
    const rows = this.db
      .prepare(
        `SELECT ts, device_id AS deviceId, token_prefix AS tokenPrefix, kind, detail, result
         FROM audit_events ORDER BY id DESC LIMIT ?`,
      )
      .all(limit);
    return rows as unknown as AuditEventDto[];
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM audit_events").get() as { n: number } | undefined;
    return Number(row?.n ?? 0);
  }
}
