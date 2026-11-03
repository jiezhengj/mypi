import type { Request, Response } from "express";
import type { AgentFacade } from "../agent/agent-service.ts";

export const SERVICE_VERSION = "0.1.0";

/** 健康检查：不需要鉴权，也绝不返回会话内容。 */
export function healthHandler(agent: AgentFacade) {
  return (_req: Request, res: Response): void => {
    res.json({
      ok: true,
      status: agent.state().status,
      version: SERVICE_VERSION,
    });
  };
}
