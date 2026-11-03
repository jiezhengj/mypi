import fs from "node:fs";
import path from "node:path";
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { ErrorCode, MessageDto } from "../../shared/contracts.ts";
import type { Config } from "../config.ts";
import type { AuditStore } from "../store/audit-store.ts";
import { HttpError } from "../middleware/errors.ts";
import { mapSessionEvent, type MappedEvent } from "./events.ts";
import { createResourceLoader } from "./resource-loader.ts";

/** 显式声明工具集：默认集只有 read/bash/edit/write，grep/find 需要显式开启。 */
export const ENABLED_TOOLS = ["read", "bash", "edit", "write", "grep", "find"] as const;

export type AgentStatus = "idle" | "running" | "interrupted";

export interface AgentState {
  status: AgentStatus;
  startedAt: string | null;
  activeSessionId: string;
  recovered: boolean;
  messageCount: number;
  lastError: { code: ErrorCode; message: string } | null;
}

export interface PromptHandlers {
  onEvent: (event: MappedEvent) => void;
}

/** 路由只依赖这个接口，测试可以注入假实现，无需真实模型。 */
export interface AgentFacade {
  readonly isRunning: boolean;
  readonly sessionId: string;
  state(): AgentState;
  messages(limit: number): MessageDto[];
  activeToolNames(): string[];
  prompt(text: string, handlers: PromptHandlers): Promise<{ totalMs: number; text: string }>;
  abort(): Promise<boolean>;
  deleteSession(sessionId: string): Promise<void>;
  dispose(): void;
}

function classifyModelError(error: unknown): HttpError {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out|ETIMEDOUT/i.test(message)) return new HttpError("model_timeout");
  return new HttpError("model_unavailable");
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object") {
          const record = block as Record<string, unknown>;
          if (typeof record.text === "string") return record.text;
        }
        return "";
      })
      .join("");
  }
  return "";
}

export class AgentService implements AgentFacade {
  private session: AgentSession;
  private readonly config: Config;
  private readonly audit: AuditStore;
  private readonly modelRuntime: ModelRuntime;
  private readonly model: unknown;
  private status: AgentStatus = "idle";
  private startedAt: string | null = null;
  private lastError: { code: ErrorCode; message: string } | null = null;
  private recovered = false;

  constructor(
    session: AgentSession,
    config: Config,
    audit: AuditStore,
    modelRuntime: ModelRuntime,
    model: unknown,
  ) {
    this.session = session;
    this.config = config;
    this.audit = audit;
    this.modelRuntime = modelRuntime;
    this.model = model;
  }

  static async create(config: Config, audit: AuditStore): Promise<AgentService> {
    const modelRuntime = await ModelRuntime.create({
      modelsPath: path.join(config.piHome, "models.json"),
      refreshOnCreate: false,
    });
    const model = modelRuntime.getModel(config.provider, config.modelId);
    if (!model) {
      const available = (await modelRuntime.getAvailable())
        .map((entry) => `${entry.provider}/${entry.id}`)
        .join(", ");
      throw new Error(`模型不可用：${config.provider}/${config.modelId}（可用：${available}）`);
    }
    const session = await AgentService.openSession(config, modelRuntime, model);
    const service = new AgentService(session, config, audit, modelRuntime, model);
    service.recovered = session.messages.length > 0;
    if (!service.recovered) {
      audit.record({ kind: "message", detail: "new session created", result: "ok" });
    }
    return service;
  }

  private static async openSession(
    config: Config,
    modelRuntime: ModelRuntime,
    model: unknown,
  ): Promise<AgentSession> {
    const loader = await createResourceLoader({ cwd: config.workDir, agentDir: config.piHome });
    const sessionManager = SessionManager.continueRecent(config.workDir, config.sessionDir);
    const { session } = await createAgentSession({
      model: model as never,
      modelRuntime,
      sessionManager,
      cwd: config.workDir,
      tools: [...ENABLED_TOOLS],
      resourceLoader: loader,
    });
    return session;
  }

  get sessionId(): string {
    return this.session.sessionId;
  }

  get isRunning(): boolean {
    return this.status === "running";
  }

  state(): AgentState {
    return {
      status: this.status,
      startedAt: this.startedAt,
      activeSessionId: this.session.sessionId,
      recovered: this.recovered || this.session.messages.length > 0,
      messageCount: this.session.messages.length,
      lastError: this.lastError,
    };
  }

  activeToolNames(): string[] {
    return this.session.getActiveToolNames();
  }

  messages(limit: number): MessageDto[] {
    const all = this.session.messages as unknown[];
    return all.slice(-limit).map((raw) => {
      const message = (raw ?? {}) as Record<string, unknown>;
      return {
        role: typeof message.role === "string" ? message.role : "unknown",
        content: contentToText(message.content),
        timestamp: typeof message.timestamp === "string" ? message.timestamp : null,
      };
    });
  }

  async prompt(text: string, handlers: PromptHandlers): Promise<{ totalMs: number; text: string }> {
    if (this.status === "running") {
      throw new HttpError("busy");
    }
    this.status = "running";
    this.startedAt = new Date().toISOString();
    this.lastError = null;
    const startedAtMs = Date.now();

    const unsubscribe = this.session.subscribe((event: unknown) => {
      const mapped = mapSessionEvent(event);
      if (mapped) handlers.onEvent(mapped);
    });

    try {
      await this.session.prompt(text);
      const totalMs = Date.now() - startedAtMs;
      if (this.status === "running") this.status = "idle";
      this.audit.record({ kind: "message", detail: `prompt ok (${totalMs}ms)`, result: "ok" });
      return { totalMs, text: this.session.getLastAssistantText?.() ?? "" };
    } catch (error) {
      const httpError = classifyModelError(error);
      this.lastError = { code: httpError.code, message: httpError.message };
      this.status = "idle";
      this.audit.record({ kind: "message", detail: `prompt failed: ${httpError.code}`, result: "error" });
      throw httpError;
    } finally {
      unsubscribe();
      this.startedAt = null;
    }
  }

  async abort(): Promise<boolean> {
    if (this.status !== "running") {
      return false;
    }
    await this.session.abort();
    this.status = "interrupted";
    this.audit.record({ kind: "abort", detail: "user aborted run", result: "ok" });
    return true;
  }

  /** 删除指定会话；当前会话空闲时允许删除并自动新建。 */
  async deleteSession(sessionId: string): Promise<void> {
    if (this.status === "running") {
      throw new HttpError("busy");
    }
    const isCurrent = sessionId === this.session.sessionId;
    if (isCurrent) {
      const file = this.session.sessionFile;
      this.session.dispose?.();
      if (file && fs.existsSync(file)) fs.rmSync(file, { force: true });
      this.session = await AgentService.openSession(this.config, this.modelRuntime, this.model);
      this.recovered = false;
      this.audit.record({ kind: "device", detail: `session deleted: ${sessionId}`, result: "ok" });
      return;
    }
    const target = fs
      .readdirSync(this.config.sessionDir)
      .filter((name) => name.includes(sessionId))
      .map((name) => `${this.config.sessionDir}/${name}`)[0];
    if (!target || !fs.existsSync(target)) {
      throw new HttpError("not_found");
    }
    fs.rmSync(target, { force: true });
    this.audit.record({ kind: "device", detail: `session deleted: ${sessionId}`, result: "ok" });
  }

  dispose(): void {
    this.session.dispose?.();
  }
}
