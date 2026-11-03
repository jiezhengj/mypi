import { ensureDirectories, loadConfig, writeModelsJson } from "./config.ts";
import { openDatabase } from "./store/db.ts";
import { DeviceStore } from "./store/device-store.ts";
import { AuditStore } from "./store/audit-store.ts";
import { AgentService } from "./agent/agent-service.ts";
import { RateLimiter } from "./middleware/rate-limit.ts";
import { createApp } from "./app.ts";

const log = (...args: unknown[]): void => {
  console.log(new Date().toISOString(), ...args);
};

const config = loadConfig();
ensureDirectories(config);
const modelsFile = writeModelsJson(config);
log("models.json 就绪:", modelsFile, "provider:", config.provider, "model:", config.modelId);

const db = openDatabase(config.dbPath);
const deviceStore = new DeviceStore(db);
const audit = new AuditStore(db);

const agent = await AgentService.create(config, audit);
log("会话就绪:", agent.sessionId, "工具:", agent.activeToolNames().join(","));

const limiter = new RateLimiter();
const app = createApp({ config, agent, deviceStore, audit, limiter });

const server = app.listen(config.port, "0.0.0.0", () => {
  log(`监听 0.0.0.0:${config.port}，工作目录 ${config.workDir}`);
});

function shutdown(signal: string): void {
  log("收到信号，正在退出:", signal);
  server.close(() => {
    agent.dispose();
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5_000).unref();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => shutdown(signal));
}
