import type { ServerResponse } from "node:http";
import { SSE_HEARTBEAT_MS, type SseEventMap, type SseEventName } from "../../shared/contracts.ts";

/** SSE 帧编码 + 心跳 + 断开清理。 */
export class SseStream {
  private readonly res: ServerResponse;
  private heartbeat: NodeJS.Timeout | null = null;
  private closed = false;
  private readonly onClose = (): void => {
    this.closed = true;
    this.stopHeartbeat();
  };

  constructor(res: ServerResponse) {
    this.res = res;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.on("close", this.onClose);
    res.on("error", this.onClose);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  event<T extends SseEventName>(name: T, data: SseEventMap[T]): void {
    if (this.closed) return;
    this.res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  startHeartbeat(intervalMs: number = SSE_HEARTBEAT_MS): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      this.event("ping", { ts: new Date().toISOString() });
    }, intervalMs);
    this.heartbeat.unref?.();
  }

  stopHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  close(): void {
    this.stopHeartbeat();
    if (!this.closed) {
      this.closed = true;
      this.res.end();
    }
  }
}

/** 供测试用：把 SSE 文本切成 [{event, data}]。 */
export function parseSseFrames(text: string): Array<{ event: string; data: string }> {
  const frames: Array<{ event: string; data: string }> = [];
  for (const block of text.split("\n\n")) {
    if (!block.trim()) continue;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
    }
    if (dataLines.length > 0) frames.push({ event, data: dataLines.join("\n") });
  }
  return frames;
}
