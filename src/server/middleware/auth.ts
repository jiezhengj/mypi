import type { NextFunction, Request, Response } from "express";
import type { DeviceRecord } from "../store/device-store.ts";
import type { DeviceStore } from "../store/device-store.ts";
import type { AuditStore } from "../store/audit-store.ts";
import { HttpError } from "./errors.ts";
import { hashToken, parseBearer, tokenPrefix } from "../util/tokens.ts";

export interface AuthDeps {
  deviceStore: DeviceStore;
  audit: AuditStore;
  limiter: {
    recordAuthFailure: (source: string) => void;
    clearFailures: (source: string) => void;
  };
}

/** 从请求里取来源标识：优先 X-Forwarded-For 的第一跳，否则 socket 地址。 */
export function sourceOf(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (raw) {
    const first = raw.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? "unknown";
}

export function getDevice(res: Response): DeviceRecord {
  const device = res.locals.device as DeviceRecord | undefined;
  if (!device) throw new HttpError("unauthorized");
  return device;
}

/**
 * 每个请求都查库：吊销后该设备的下一次请求即被拒（SC-008），无需缓存失效通知。
 * 拒绝响应与「不存在」不可区分，不泄露会话信息（FR-002）。
 */
export function createAuthMiddleware(deps: AuthDeps) {
  return function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    const source = sourceOf(req);
    const token = parseBearer(req.headers.authorization);

    if (!token) {
      deps.audit.record({ kind: "auth", detail: "missing bearer token", result: "denied" });
      deps.limiter.recordAuthFailure(source);
      next(new HttpError("unauthorized"));
      return;
    }

    const prefix = tokenPrefix(token);
    const record = deps.deviceStore.findByHash(hashToken(token));

    if (!record) {
      deps.audit.record({ kind: "auth", tokenPrefix: prefix, detail: "unknown token", result: "denied" });
      deps.limiter.recordAuthFailure(source);
      next(new HttpError("unauthorized"));
      return;
    }

    if (record.revoked_at) {
      deps.audit.record({
        deviceId: record.id,
        tokenPrefix: record.token_prefix,
        kind: "auth",
        detail: "revoked token used",
        result: "denied",
      });
      deps.limiter.recordAuthFailure(source);
      next(new HttpError("revoked"));
      return;
    }

    deps.deviceStore.touch(record.id);
    deps.limiter.clearFailures(source);
    res.locals.device = record;
    next();
  };
}
