import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./errors.ts";
import { sourceOf } from "./auth.ts";

export const FAIL_WINDOW_MS = 15 * 60 * 1000;
export const FAIL_THRESHOLD = 20;
export const LOCK_MS = 15 * 60 * 1000;
export const DEVICE_LIMIT_PER_MIN = 60;
export const IP_LIMIT_PER_MIN = 120;
const MINUTE_MS = 60 * 1000;

export interface RateLimiterOptions {
  now?: () => number;
}

/**
 * 进程内滑动窗口。重启即清零——攻击者无法通过「诱导重启」重置计数，
 * 因此这个取舍可接受（见 research D14）。
 */
export class RateLimiter {
  private readonly now: () => number;
  private readonly failures = new Map<string, number[]>();
  private readonly locks = new Map<string, number>();
  private readonly requests = new Map<string, number[]>();

  constructor(options: RateLimiterOptions = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  isLocked(source: string): boolean {
    const until = this.locks.get(source);
    if (until === undefined) return false;
    if (until <= this.now()) {
      this.locks.delete(source);
      return false;
    }
    return true;
  }

  /** 记录一次认证失败；达到阈值即锁定。 */
  recordAuthFailure(source: string): void {
    const at = this.now();
    const list = (this.failures.get(source) ?? []).filter((ts) => at - ts < FAIL_WINDOW_MS);
    list.push(at);
    this.failures.set(source, list);
    if (list.length >= FAIL_THRESHOLD) {
      this.locks.set(source, at + LOCK_MS);
      this.failures.delete(source);
    }
  }

  /** 成功认证后清空该来源的失败计数。 */
  clearFailures(source: string): void {
    this.failures.delete(source);
  }

  failureCount(source: string): number {
    const at = this.now();
    return (this.failures.get(source) ?? []).filter((ts) => at - ts < FAIL_WINDOW_MS).length;
  }

  private consume(key: string, limit: number): boolean {
    const at = this.now();
    const list = (this.requests.get(key) ?? []).filter((ts) => at - ts < MINUTE_MS);
    if (list.length >= limit) {
      this.requests.set(key, list);
      return false;
    }
    list.push(at);
    this.requests.set(key, list);
    return true;
  }

  consumeIp(source: string): boolean {
    return this.consume(`ip:${source}`, IP_LIMIT_PER_MIN);
  }

  consumeDevice(deviceId: string): boolean {
    return this.consume(`dev:${deviceId}`, DEVICE_LIMIT_PER_MIN);
  }
}

/** 锁定检查放在鉴权之前：锁定期间即使令牌正确也拒绝（SC-005）。 */
export function createLockGuard(limiter: RateLimiter) {
  return function lockGuard(req: Request, _res: Response, next: NextFunction): void {
    if (limiter.isLocked(sourceOf(req))) {
      next(new HttpError("locked"));
      return;
    }
    next();
  };
}

/** 认证成功后的频率限制：按 IP 与设备两个维度。 */
export function createRateLimitMiddleware(limiter: RateLimiter) {
  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const device = res.locals.device as { id: string } | undefined;
    if (!limiter.consumeIp(sourceOf(req))) {
      next(new HttpError("rate_limited"));
      return;
    }
    if (device && !limiter.consumeDevice(device.id)) {
      next(new HttpError("rate_limited"));
      return;
    }
    next();
  };
}
