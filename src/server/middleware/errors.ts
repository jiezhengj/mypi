import type { NextFunction, Request, Response } from "express";
import {
  ERROR_CODES,
  ERROR_MESSAGES,
  type ErrorCode,
  type ErrorEnvelope,
} from "../../shared/contracts.ts";

export class HttpError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string) {
    super(message ?? ERROR_MESSAGES[code]);
    this.name = "HttpError";
    this.code = code;
  }
}

export function envelope(code: ErrorCode, message?: string): ErrorEnvelope {
  return {
    error: {
      code,
      message: message ?? ERROR_MESSAGES[code],
      retryable: ERROR_CODES[code].retryable,
    },
  };
}

/** SQLite 磁盘满：映射为 storage_full，而不是笼统的 500。 */
export function isStorageFullError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /disk is full|SQLITE_FULL|database or disk is full/i.test(message);
}

export function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  // express.json 的解析失败带 type=entity.parse.failed / status=400
  const record = (error ?? {}) as Record<string, unknown>;
  if (record.type === "entity.parse.failed" || record.status === 400 || record.statusCode === 400) {
    return new HttpError("bad_request", "请求体不是合法 JSON");
  }
  if (isStorageFullError(error)) return new HttpError("storage_full");
  return new HttpError("internal");
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json(envelope("not_found"));
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const httpError = toHttpError(error);
  const status = ERROR_CODES[httpError.code].http;
  // 内部错误不把原始 message 回给客户端，避免泄露路径与上游细节。
  const message = httpError.code === "internal" ? undefined : httpError.message;
  if (status >= 500) {
    console.error(new Date().toISOString(), "request failed:", httpError.code, (error as Error)?.message);
  }
  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(status).json(envelope(httpError.code, message));
}
