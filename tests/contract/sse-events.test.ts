import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { parseSseFrames } from "../../src/server/util/sse.ts";
import { authHeaders, startHarness, type Harness } from "../helpers/harness.ts";

let harness: Harness;

before(async () => {
  harness = await startHarness();
});

after(async () => {
  await harness.close();
});

test("一轮对话的事件顺序是 status → action → delta+ → done", async () => {
  harness.agent.script = [
    { kind: "action-start", id: "a1", tool: "bash", inputSummary: "ls -la /workspace", at: new Date().toISOString() },
    {
      kind: "action-end",
      id: "a1",
      ok: true,
      outputSummary: "exit=0 lines=3 a b c",
      at: new Date().toISOString(),
    },
    { kind: "delta", text: "目录里" },
    { kind: "delta", text: "有三个文件。" },
  ];

  const res = await fetch(`${harness.baseUrl}/api/messages`, {
    method: "POST",
    headers: authHeaders(harness.token),
    body: JSON.stringify({ text: "看看目录" }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);

  const frames = parseSseFrames(await res.text()).filter((frame) => frame.event !== "ping");
  const names = frames.map((frame) => frame.event);
  assert.deepEqual(names, ["status", "action", "delta", "delta", "done"]);

  const action = JSON.parse(frames[1]?.data ?? "{}") as Record<string, unknown>;
  assert.equal(action.tool, "bash");
  assert.equal(action.inputSummary, "ls -la /workspace");
  assert.equal(action.outputSummary, "exit=0 lines=3 a b c");
  assert.equal(action.ok, true);

  const done = JSON.parse(frames[4]?.data ?? "{}") as Record<string, unknown>;
  assert.equal(done.status, "idle");
  assert.equal(typeof done.totalMs, "number");
});

test("空消息被拒绝为 bad_request", async () => {
  const res = await fetch(`${harness.baseUrl}/api/messages`, {
    method: "POST",
    headers: authHeaders(harness.token),
    body: JSON.stringify({ text: "   " }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "bad_request");
});

test("超长消息被拒绝", async () => {
  const res = await fetch(`${harness.baseUrl}/api/messages`, {
    method: "POST",
    headers: authHeaders(harness.token),
    body: JSON.stringify({ text: "x".repeat(8001) }),
  });
  assert.equal(res.status, 400);
});

test("执行中再来一条消息返回 409 busy", async () => {
  harness.agent.script = [{ delayMs: 300 }, { kind: "delta", text: "慢" }];
  const first = fetch(`${harness.baseUrl}/api/messages`, {
    method: "POST",
    headers: authHeaders(harness.token),
    body: JSON.stringify({ text: "第一条" }),
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const second = await fetch(`${harness.baseUrl}/api/messages`, {
    method: "POST",
    headers: authHeaders(harness.token),
    body: JSON.stringify({ text: "第二条" }),
  });
  assert.equal(second.status, 409);
  const body = (await second.json()) as { error: { code: string } };
  assert.equal(body.error.code, "busy");
  await (await first).text();
});

test("中断返回 202，状态变为 interrupted", async () => {
  harness.agent.script = [{ delayMs: 500 }];
  const running = fetch(`${harness.baseUrl}/api/messages`, {
    method: "POST",
    headers: authHeaders(harness.token),
    body: JSON.stringify({ text: "长任务" }),
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
  const abortRes = await fetch(`${harness.baseUrl}/api/abort`, {
    method: "POST",
    headers: authHeaders(harness.token),
  });
  assert.equal(abortRes.status, 202);
  const abortBody = (await abortRes.json()) as { aborted: boolean; status: string };
  assert.equal(abortBody.aborted, true);
  assert.equal(abortBody.status, "interrupted");
  await (await running).text();
});

test("历史消息接口返回已记录的消息", async () => {
  const res = await fetch(`${harness.baseUrl}/api/messages?limit=10`, { headers: authHeaders(harness.token) });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { sessionId: string; messages: Array<{ role: string }> };
  assert.equal(body.sessionId, "session-test-1");
  assert.ok(body.messages.length > 0);
});
