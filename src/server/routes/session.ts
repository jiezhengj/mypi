import { Router, type Request, type Response } from "express";
import {
  MAX_MESSAGE_CHARS,
  type ActionEventData,
  type MessagesResponse,
  type StateResponse,
} from "../../shared/contracts.ts";
import type { AgentFacade } from "../agent/agent-service.ts";
import type { AuditStore } from "../store/audit-store.ts";
import { getDevice } from "../middleware/auth.ts";
import { HttpError } from "../middleware/errors.ts";
import { SseStream } from "../util/sse.ts";

export interface SessionRouterDeps {
  agent: AgentFacade;
  audit: AuditStore;
}

export function createSessionRouter(deps: SessionRouterDeps): Router {
  const router = Router();

  router.get("/state", (_req: Request, res: Response) => {
    const device = getDevice(res);
    const state = deps.agent.state();
    const payload: StateResponse = {
      status: state.status,
      startedAt: state.startedAt,
      activeSessionId: state.activeSessionId,
      recovered: state.recovered,
      messageCount: state.messageCount,
      lastError: state.lastError,
      device: { id: device.id, label: device.label },
    };
    res.json(payload);
  });

  router.get("/messages", (req: Request, res: Response) => {
    const raw = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 200) : 50;
    const payload: MessagesResponse = {
      sessionId: deps.agent.sessionId,
      messages: deps.agent.messages(limit),
    };
    res.json(payload);
  });

  router.post("/messages", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { text?: unknown };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) {
      throw new HttpError("bad_request", "消息不能为空");
    }
    if (text.length > MAX_MESSAGE_CHARS) {
      throw new HttpError("bad_request", "消息过长");
    }
    // 必须在写 SSE 头之前判断，否则客户端会拿到一个 200 的错误流。
    if (deps.agent.isRunning) {
      throw new HttpError("busy");
    }

    const device = getDevice(res);
    const sse = new SseStream(res);
    sse.startHeartbeat();
    const startedAt = new Date().toISOString();
    sse.event("status", { status: "running", startedAt });

    const pending = new Map<string, ActionEventData>();

    try {
      const result = await deps.agent.prompt(text, {
        onEvent: (event) => {
          if (event.kind === "delta") {
            sse.event("delta", { text: event.text });
            return;
          }
          if (event.kind === "action-start") {
            pending.set(event.id, {
              id: event.id,
              tool: event.tool,
              inputSummary: event.inputSummary,
              outputSummary: "",
              ok: true,
              startedAt: event.at,
              finishedAt: null,
            });
            return;
          }
          const entry = pending.get(event.id);
          pending.delete(event.id);
          const payload: ActionEventData = {
            id: event.id,
            tool: entry?.tool ?? "tool",
            inputSummary: entry?.inputSummary ?? "",
            outputSummary: event.outputSummary,
            ok: event.ok,
            startedAt: entry?.startedAt ?? event.at,
            finishedAt: event.at,
          };
          sse.event("action", payload);
          deps.audit.record({
            deviceId: device.id,
            tokenPrefix: device.token_prefix,
            kind: "action",
            detail: `${payload.tool}: ${payload.inputSummary} → ${event.outputSummary}`,
            result: event.ok ? "ok" : "error",
          });
        },
      });

      deps.audit.record({
        deviceId: device.id,
        tokenPrefix: device.token_prefix,
        kind: "message",
        detail: `text(${text.length} chars) ok in ${result.totalMs}ms`,
        result: "ok",
      });
      const finalStatus = deps.agent.state().status;
      sse.event("done", {
        messageId: deps.agent.sessionId,
        totalMs: result.totalMs,
        status: finalStatus === "interrupted" ? "interrupted" : "idle",
      });
    } catch (error) {
      const httpError = error instanceof HttpError ? error : new HttpError("internal");
      deps.audit.record({
        deviceId: device.id,
        tokenPrefix: device.token_prefix,
        kind: "message",
        detail: `text(${text.length} chars) failed: ${httpError.code}`,
        result: "error",
      });
      sse.event("error", {
        code: httpError.code,
        message: httpError.message,
        retryable: httpError.code !== "bad_request",
      });
    } finally {
      sse.close();
    }
  });

  router.post("/abort", async (_req: Request, res: Response) => {
    const aborted = await deps.agent.abort();
    res.status(202).json({ aborted, status: aborted ? "interrupted" : deps.agent.state().status });
  });

  router.delete("/sessions/:id", async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    await deps.agent.deleteSession(id);
    res.json({ deleted: true, sessionId: id });
  });

  return router;
}
