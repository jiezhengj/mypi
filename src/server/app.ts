import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { Config } from "./config.ts";
import type { AgentFacade } from "./agent/agent-service.ts";
import type { AuditStore } from "./store/audit-store.ts";
import type { DeviceStore } from "./store/device-store.ts";
import { createAuthMiddleware } from "./middleware/auth.ts";
import { createLockGuard, createRateLimitMiddleware, RateLimiter } from "./middleware/rate-limit.ts";
import { errorHandler, notFoundHandler } from "./middleware/errors.ts";
import { createSessionRouter } from "./routes/session.ts";
import { createDeviceRouter } from "./routes/devices.ts";
import { healthHandler } from "./routes/health.ts";

export interface AppDeps {
  config: Config;
  agent: AgentFacade;
  deviceStore: DeviceStore;
  audit: AuditStore;
  limiter: RateLimiter;
}

function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader(
    "content-security-policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  next();
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(express.json({ limit: "64kb" }));

  // 健康检查在鉴权之外，且只暴露状态与版本。
  app.get("/healthz", healthHandler(deps.agent));

  app.use(express.static(deps.config.staticDir, { index: "index.html", extensions: ["html"] }));

  const api = express.Router();
  api.use(createLockGuard(deps.limiter));
  api.use(
    createAuthMiddleware({
      deviceStore: deps.deviceStore,
      audit: deps.audit,
      limiter: {
        recordAuthFailure: (source) => deps.limiter.recordAuthFailure(source),
        clearFailures: (source) => deps.limiter.clearFailures(source),
      },
    }),
  );
  api.use(createRateLimitMiddleware(deps.limiter));
  api.use(createSessionRouter({ agent: deps.agent, audit: deps.audit }));
  api.use(createDeviceRouter(deps.deviceStore, deps.audit));

  app.use("/api", api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
