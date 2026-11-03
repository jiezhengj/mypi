import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { openDatabase } from "../../src/server/store/db.ts";
import { DeviceStore } from "../../src/server/store/device-store.ts";
import { AuditStore } from "../../src/server/store/audit-store.ts";
import { RateLimiter } from "../../src/server/middleware/rate-limit.ts";
import { createApp } from "../../src/server/app.ts";
import type { Config } from "../../src/server/config.ts";
import type { AgentFacade, AgentState, PromptHandlers } from "../../src/server/agent/agent-service.ts";
import type { MappedEvent } from "../../src/server/agent/events.ts";
import { HttpError } from "../../src/server/middleware/errors.ts";

type Step = MappedEvent | { delayMs: number };

/** 假 Agent：按脚本发事件，不碰模型、不碰网络。 */
export class FakeAgent implements AgentFacade {
  status: AgentState["status"] = "idle";
  startedAt: string | null = null;
  lastError: { code: "model_timeout"; message: string } | null = null;
  script: Step[] = [];
  messageCount = 0;
  promptCalls: string[] = [];
  aborted = false;
  private session = "session-test-1";
  private lastMessages: Array<{ role: string; content: string; timestamp: string | null }> = [];

  get isRunning(): boolean {
    return this.status === "running";
  }

  get sessionId(): string {
    return this.session;
  }

  state(): AgentState {
    return {
      status: this.status,
      startedAt: this.startedAt,
      activeSessionId: this.session,
      recovered: this.messageCount > 0,
      messageCount: this.messageCount,
      lastError: this.lastError,
    };
  }

  messages(limit: number) {
    return this.lastMessages.slice(-limit);
  }

  activeToolNames(): string[] {
    return ["read", "bash", "edit", "write", "grep", "find"];
  }

  async prompt(text: string, handlers: PromptHandlers): Promise<{ totalMs: number; text: string }> {
    if (this.status === "running") throw new HttpError("busy");
    this.promptCalls.push(text);
    this.status = "running";
    this.startedAt = new Date().toISOString();
    try {
      for (const step of this.script) {
        if ("delayMs" in step) {
          await new Promise((resolve) => setTimeout(resolve, step.delayMs));
          continue;
        }
        handlers.onEvent(step);
      }
      this.messageCount += 2;
      this.lastMessages.push({ role: "user", content: text, timestamp: new Date().toISOString() });
      this.lastMessages.push({ role: "assistant", content: "完成", timestamp: new Date().toISOString() });
      if (this.status === "running") this.status = "idle";
      return { totalMs: 7, text: "完成" };
    } finally {
      this.startedAt = null;
    }
  }

  async abort(): Promise<boolean> {
    if (this.status !== "running") return false;
    this.status = "interrupted";
    this.aborted = true;
    return true;
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (this.status === "running") throw new HttpError("busy");
    if (sessionId !== this.session && sessionId !== "session-test-2") throw new HttpError("not_found");
    this.session = "session-test-new";
    this.messageCount = 0;
    this.lastMessages = [];
  }

  dispose(): void {
    /* noop */
  }
}

export interface Harness {
  baseUrl: string;
  token: string;
  agent: FakeAgent;
  deviceStore: DeviceStore;
  audit: AuditStore;
  limiter: RateLimiter;
  dataDir: string;
  close: () => Promise<void>;
}

export async function startHarness(options: { failThreshold?: number } = {}): Promise<Harness> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mypi-test-"));
  const config: Config = {
    port: 0,
    dataDir,
    workDir: path.join(dataDir, "workspace"),
    piHome: path.join(dataDir, "pi"),
    sessionDir: path.join(dataDir, "sessions"),
    dbPath: path.join(dataDir, "mypi.db"),
    staticDir: path.resolve(import.meta.dirname, "../../src/client"),
    provider: "test",
    modelId: "test-model",
    baseUrl: "http://127.0.0.1:1/v1",
    apiKey: "test-key",
  };
  fs.mkdirSync(config.workDir, { recursive: true });
  fs.mkdirSync(config.sessionDir, { recursive: true });

  const db = openDatabase(config.dbPath);
  const deviceStore = new DeviceStore(db);
  const audit = new AuditStore(db);
  const limiter = new RateLimiter();
  const agent = new FakeAgent();
  const created = deviceStore.create("test-device");

  const app = createApp({ config, agent, deviceStore, audit, limiter });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    token: created.token,
    agent,
    deviceStore,
    audit,
    limiter,
    dataDir,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}
