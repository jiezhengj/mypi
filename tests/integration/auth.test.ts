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

test("健康检查不需要令牌，且不泄露会话信息", async () => {
  const res = await fetch(`${harness.baseUrl}/healthz`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.ok, true);
  assert.equal("activeSessionId" in body, false);
  assert.equal("sessionId" in body, false);
});

test("没有令牌时 401，且响应里没有会话内容", async () => {
  const res = await fetch(`${harness.baseUrl}/api/state`);
  assert.equal(res.status, 401);
  const text = await res.text();
  const body = JSON.parse(text) as { error: { code: string; retryable: boolean } };
  assert.equal(body.error.code, "unauthorized");
  assert.equal(body.error.retryable, false);
  assert.equal(text.includes("session-test"), false);
});

test("错误令牌同样是 401（不区分「不存在」与「错误」）", async () => {
  const res = await fetch(`${harness.baseUrl}/api/state`, {
    headers: { authorization: "Bearer definitely-not-a-real-token" },
  });
  assert.equal(res.status, 401);
});

test("有效令牌可访问 /api/state", async () => {
  const res = await fetch(`${harness.baseUrl}/api/state`, { headers: authHeaders(harness.token) });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { activeSessionId: string; device: { label: string } };
  assert.equal(body.activeSessionId, "session-test-1");
  assert.equal(body.device.label, "test-device");
});

test("认证失败会被记入审计", async () => {
  const events = harness.audit.list(50);
  assert.ok(events.some((event) => event.kind === "auth" && event.result === "denied"));
});

test("吊销后的令牌返回 403 revoked", async () => {
  const second = harness.deviceStore.create("second-device");
  assert.equal(harness.deviceStore.revoke(second.record.id), true);
  const res = await fetch(`${harness.baseUrl}/api/state`, {
    headers: { authorization: `Bearer ${second.token}` },
  });
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "revoked");
});

test("20 次失败后锁定，锁定期间正确令牌也被拒", async () => {
  const fresh = await startHarness();
  try {
    for (let i = 0; i < 20; i += 1) {
      const res = await fetch(`${fresh.baseUrl}/api/state`, {
        headers: { authorization: "Bearer wrong" },
      });
      assert.equal(res.status, 401);
    }
    const locked = await fetch(`${fresh.baseUrl}/api/state`, {
      headers: { authorization: "Bearer wrong" },
    });
    assert.equal(locked.status, 429);
    const body = (await locked.json()) as { error: { code: string } };
    assert.equal(body.error.code, "locked");

    const withGoodToken = await fetch(`${fresh.baseUrl}/api/state`, {
      headers: authHeaders(fresh.token),
    });
    assert.equal(withGoodToken.status, 429);
  } finally {
    await fresh.close();
  }
});
