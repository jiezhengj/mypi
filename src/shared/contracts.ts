// 服务端与客户端共用的契约：SSE 事件、错误码、DTO。
// 这里是唯一真相，两侧都从这里取类型。

export const SSE_EVENT = {
  status: "status",
  action: "action",
  delta: "delta",
  done: "done",
  error: "error",
  ping: "ping",
} as const;

export type SseEventName = (typeof SSE_EVENT)[keyof typeof SSE_EVENT];

export interface StatusEventData {
  status: "running" | "interrupted" | "idle";
  startedAt: string | null;
}

export interface ActionEventData {
  id: string;
  tool: string;
  inputSummary: string;
  outputSummary: string;
  ok: boolean;
  startedAt: string;
  finishedAt: string | null;
}

export interface DeltaEventData {
  text: string;
}

export interface DoneEventData {
  messageId: string;
  totalMs: number;
  /** 正常结束是 idle；被中断后是 interrupted，客户端据此提示。 */
  status: "idle" | "interrupted";
}

export interface ErrorEventData {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export interface PingEventData {
  ts: string;
}

export interface SseEventMap {
  status: StatusEventData;
  action: ActionEventData;
  delta: DeltaEventData;
  done: DoneEventData;
  error: ErrorEventData;
  ping: PingEventData;
}

export const ERROR_CODES = {
  unauthorized: { http: 401, retryable: false },
  revoked: { http: 403, retryable: false },
  locked: { http: 429, retryable: true },
  rate_limited: { http: 429, retryable: true },
  busy: { http: 409, retryable: true },
  bad_request: { http: 400, retryable: false },
  not_found: { http: 404, retryable: false },
  storage_full: { http: 507, retryable: true },
  model_unavailable: { http: 503, retryable: true },
  model_timeout: { http: 504, retryable: true },
  internal: { http: 500, retryable: true },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
  };
}

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  unauthorized: "未通过身份校验",
  revoked: "该设备令牌已被吊销",
  locked: "失败次数过多，暂时锁定，请稍后再试",
  rate_limited: "请求过于频繁，请稍后再试",
  busy: "上一轮还在执行中",
  bad_request: "请求参数不合法",
  not_found: "目标不存在",
  storage_full: "存储空间不足，写入已停止",
  model_unavailable: "模型服务暂不可用",
  model_timeout: "模型响应超时",
  internal: "服务内部错误",
};

export interface DeviceDto {
  id: string;
  label: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface StateResponse {
  status: "idle" | "running" | "interrupted";
  startedAt: string | null;
  activeSessionId: string;
  recovered: boolean;
  messageCount: number;
  lastError: { code: ErrorCode; message: string } | null;
  device: { id: string; label: string };
}

export interface MessageDto {
  role: string;
  content: string;
  timestamp: string | null;
}

export interface MessagesResponse {
  sessionId: string;
  messages: MessageDto[];
}

export interface AuditEventDto {
  ts: string;
  deviceId: string | null;
  tokenPrefix: string | null;
  kind: "auth" | "message" | "action" | "abort" | "device" | "probe";
  detail: string;
  result: "ok" | "denied" | "error";
}

export interface ProbeRequest {
  supportsStream?: boolean;
  fallbackTriggered?: boolean;
  firstDeltaMs?: number;
  totalMs?: number;
  viewport?: { width: number; height: number };
  dpr?: number;
  ua?: string;
  notes?: string;
}

export interface ProbeResponse {
  recorded: true;
}

export const MAX_MESSAGE_CHARS = 8000;
export const MAX_AUDIT_DETAIL = 200;
export const SSE_HEARTBEAT_MS = 15_000;
