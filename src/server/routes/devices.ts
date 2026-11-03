import { Router, type Request, type Response } from "express";
import type { AuditEventDto, DeviceDto, ProbeRequest } from "../../shared/contracts.ts";
import type { AuditStore } from "../store/audit-store.ts";
import type { DeviceStore } from "../store/device-store.ts";
import { getDevice } from "../middleware/auth.ts";
import { HttpError } from "../middleware/errors.ts";

function toDto(record: {
  id: string;
  label: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}): DeviceDto {
  return {
    id: record.id,
    label: record.label,
    tokenPrefix: record.token_prefix,
    createdAt: record.created_at,
    lastUsedAt: record.last_used_at,
    revokedAt: record.revoked_at,
  };
}

export function createDeviceRouter(deviceStore: DeviceStore, audit: AuditStore): Router {
  const router = Router();

  router.get("/devices", (_req: Request, res: Response) => {
    res.json({ devices: deviceStore.list().map(toDto) });
  });

  router.post("/devices", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { label?: unknown };
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label || label.length > 40) {
      throw new HttpError("bad_request", "设备标签需为 1–40 个字符");
    }
    const created = deviceStore.create(label);
    const device = getDevice(res);
    audit.record({
      deviceId: device.id,
      tokenPrefix: device.token_prefix,
      kind: "device",
      detail: `issued token for ${created.record.id} (${label})`,
      result: "ok",
    });
    res.status(201).json({
      id: created.record.id,
      label: created.record.label,
      token: created.token,
      createdAt: created.record.created_at,
    });
  });

  router.delete("/devices/:id", (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    const ok = deviceStore.revoke(id);
    if (!ok) {
      throw new HttpError("not_found", "设备不存在");
    }
    const device = getDevice(res);
    audit.record({
      deviceId: device.id,
      tokenPrefix: device.token_prefix,
      kind: "device",
      detail: `revoked ${id}`,
      result: "ok",
    });
    res.json({ revoked: true });
  });

  router.get("/audit", (req: Request, res: Response) => {
    const raw = Number(req.query.limit ?? 100);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 200) : 100;
    const events: AuditEventDto[] = audit.list(limit);
    res.json({ events });
  });

  router.post("/probe", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as ProbeRequest;
    const device = getDevice(res);
    const parts = [
      `stream=${body.supportsStream === true ? "yes" : "no"}`,
      `fallback=${body.fallbackTriggered === true ? "yes" : "no"}`,
      typeof body.firstDeltaMs === "number" ? `firstDelta=${body.firstDeltaMs}ms` : "",
      typeof body.totalMs === "number" ? `total=${body.totalMs}ms` : "",
      body.viewport ? `vp=${body.viewport.width}x${body.viewport.height}` : "",
      typeof body.dpr === "number" ? `dpr=${body.dpr}` : "",
      typeof body.ua === "string" ? `ua=${body.ua.slice(0, 120)}` : "",
      typeof body.notes === "string" ? `notes=${body.notes}` : "",
    ].filter(Boolean);
    audit.record({
      deviceId: device.id,
      tokenPrefix: device.token_prefix,
      kind: "probe",
      detail: parts.join(" "),
      result: "ok",
    });
    res.status(204).end();
  });

  return router;
}
