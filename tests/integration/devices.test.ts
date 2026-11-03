import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { authHeaders, startHarness, type Harness } from "../helpers/harness.ts";

let harness: Harness;

before(async () => {
  harness = await startHarness();
});

after(async () => {
  await harness.close();
});

test("设备清单返回标签、前缀与时间，不含明文令牌", async () => {
  const res = await fetch(`${harness.baseUrl}/api/devices`, { headers: authHeaders(harness.token) });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { devices: Array<Record<string, unknown>> };
  assert.ok(body.devices.length >= 1);
  const first = body.devices[0] as Record<string, unknown>;
  assert.equal(typeof first.tokenPrefix, "string");
  assert.equal("token" in first, false);
  assert.equal(JSON.stringify(body).includes(harness.token), false);
});

test("签发新设备只在这一次返回明文令牌，且该令牌立即可用", async () => {
  const res = await fetch(`${harness.baseUrl}/api/devices`, {
    method: "POST",
    headers: authHeaders(harness.token),
    body: JSON.stringify({ label: "phone" }),
  });
  assert.equal(res.status, 201);
  const created = (await res.json()) as { id: string; token: string };
  assert.equal(created.token.length, 43);

  const state = await fetch(`${harness.baseUrl}/api/state`, {
    headers: { authorization: `Bearer ${created.token}` },
  });
  assert.equal(state.status, 200);

  const list = (await (
    await fetch(`${harness.baseUrl}/api/devices`, { headers: authHeaders(harness.token) })
  ).json()) as { devices: Array<Record<string, unknown>> };
  assert.equal(JSON.stringify(list).includes(created.token), false);
});

test("吊销后该设备下一次请求即被拒，其他设备不受影响", async () => {
  const created = harness.deviceStore.create("tablet");
  const okBefore = await fetch(`${harness.baseUrl}/api/state`, {
    headers: { authorization: `Bearer ${created.token}` },
  });
  assert.equal(okBefore.status, 200);

  const revoke = await fetch(`${harness.baseUrl}/api/devices/${created.record.id}`, {
    method: "DELETE",
    headers: authHeaders(harness.token),
  });
  assert.equal(revoke.status, 200);

  const afterRevoke = await fetch(`${harness.baseUrl}/api/state`, {
    headers: { authorization: `Bearer ${created.token}` },
  });
  assert.equal(afterRevoke.status, 403);

  const other = await fetch(`${harness.baseUrl}/api/state`, { headers: authHeaders(harness.token) });
  assert.equal(other.status, 200);
});

test("吊销不存在的设备返回 404", async () => {
  const res = await fetch(`${harness.baseUrl}/api/devices/dev_missing`, {
    method: "DELETE",
    headers: authHeaders(harness.token),
  });
  assert.equal(res.status, 404);
});

test("标签为空或过长时拒绝签发", async () => {
  for (const label of ["", "x".repeat(41)]) {
    const res = await fetch(`${harness.baseUrl}/api/devices`, {
      method: "POST",
      headers: authHeaders(harness.token),
      body: JSON.stringify({ label }),
    });
    assert.equal(res.status, 400);
  }
});

test("probe 返回 204 并记为审计事件", async () => {
  const res = await fetch(`${harness.baseUrl}/api/probe`, {
    method: "POST",
    headers: authHeaders(harness.token),
    body: JSON.stringify({
      supportsStream: true,
      fallbackTriggered: false,
      firstDeltaMs: 1200,
      totalMs: 3400,
      viewport: { width: 390, height: 844 },
      dpr: 3,
      ua: "test-agent",
    }),
  });
  assert.equal(res.status, 204);
  const events = harness.audit.list(20);
  const probe = events.find((event) => event.kind === "probe");
  assert.ok(probe);
  assert.match(probe?.detail ?? "", /vp=390x844/);
  assert.match(probe?.detail ?? "", /firstDelta=1200ms/);
});

test("审计查询接口返回事件且不含令牌明文", async () => {
  const res = await fetch(`${harness.baseUrl}/api/audit?limit=20`, { headers: authHeaders(harness.token) });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.equal(text.includes(harness.token), false);
  const body = JSON.parse(text) as { events: Array<{ kind: string }> };
  assert.ok(body.events.length > 0);
});

test("删除当前会话成功；未知会话 404；执行中 409", async () => {
  const okRes = await fetch(`${harness.baseUrl}/api/sessions/session-test-1`, {
    method: "DELETE",
    headers: authHeaders(harness.token),
  });
  assert.equal(okRes.status, 200);

  const missing = await fetch(`${harness.baseUrl}/api/sessions/does-not-exist`, {
    method: "DELETE",
    headers: authHeaders(harness.token),
  });
  assert.equal(missing.status, 404);

  harness.agent.script = [{ delayMs: 300 }];
  const running = fetch(`${harness.baseUrl}/api/messages`, {
    method: "POST",
    headers: authHeaders(harness.token),
    body: JSON.stringify({ text: "占住" }),
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const busy = await fetch(`${harness.baseUrl}/api/sessions/session-test-new`, {
    method: "DELETE",
    headers: authHeaders(harness.token),
  });
  assert.equal(busy.status, 409);
  await (await running).text();
});
