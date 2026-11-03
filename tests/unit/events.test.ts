import assert from "node:assert/strict";
import { test } from "node:test";
import { mapSessionEvent, summarizeToolInput, summarizeToolOutput } from "../../src/server/agent/events.ts";
import { parseSseFrames } from "../../src/server/util/sse.ts";
import { envelope, HttpError, isStorageFullError, toHttpError } from "../../src/server/middleware/errors.ts";

test("text_delta 映射为 delta", () => {
  const mapped = mapSessionEvent({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "你好" },
  });
  assert.deepEqual(mapped, { kind: "delta", text: "你好" });
});

test("未知事件返回 null，不猜测", () => {
  assert.equal(mapSessionEvent({ type: "something_else" }), null);
  assert.equal(mapSessionEvent(null), null);
  assert.equal(mapSessionEvent({ type: "message_update", assistantMessageEvent: { type: "thinking" } }), null);
});

test("工具开始与结束事件成对映射", () => {
  const start = mapSessionEvent({
    type: "tool_execution_start",
    toolCallId: "t1",
    toolName: "bash",
    args: { command: "ls -la /workspace" },
  });
  assert.equal(start?.kind, "action-start");
  if (start?.kind === "action-start") {
    assert.equal(start.tool, "bash");
    assert.match(start.inputSummary, /ls -la/);
  }

  const end = mapSessionEvent({
    type: "tool_execution_end",
    toolCallId: "t1",
    toolName: "bash",
    result: { exitCode: 0, stdout: "a\nb\n" },
  });
  assert.equal(end?.kind, "action-end");
  if (end?.kind === "action-end") {
    assert.equal(end.ok, true);
    assert.match(end.outputSummary, /exit=0/);
  }
});

test("工具错误结果标记为不 ok", () => {
  const end = mapSessionEvent({ type: "tool_execution_end", toolCallId: "t2", isError: true, error: "boom" });
  assert.equal(end?.kind === "action-end" && end.ok, false);
});

test("参数摘要被截断且压成单行", () => {
  const summary = summarizeToolInput("bash", { command: `echo ${"x".repeat(400)}` });
  assert.ok(summary.length <= 201);
  assert.equal(summary.includes("\n"), false);
});

test("结果摘要包含退出码与行数", () => {
  const summary = summarizeToolOutput({ exitCode: 2, stdout: "l1\nl2\nl3" });
  assert.match(summary, /exit=2/);
  assert.match(summary, /lines=3/);
});

test("结果摘要在 pi 的 content/details 形状下也能取到内容", () => {
  const summary = summarizeToolOutput({
    content: [{ type: "text", text: "hello\nworld" }],
    details: { exitCode: 0 },
  });
  assert.match(summary, /exit=0/);
  assert.match(summary, /hello/);
});

test("SSE 帧解析还原事件名与数据", () => {
  const text = 'event: delta\ndata: {"text":"hi"}\n\nevent: done\ndata: {"totalMs":5}\n\n';
  const frames = parseSseFrames(text);
  assert.equal(frames.length, 2);
  assert.equal(frames[0]?.event, "delta");
  assert.deepEqual(JSON.parse(frames[0]?.data ?? "{}"), { text: "hi" });
  assert.equal(frames[1]?.event, "done");
});

test("错误信封带 retryable 且不泄露内部细节", () => {
  const payload = envelope("unauthorized");
  assert.equal(payload.error.code, "unauthorized");
  assert.equal(payload.error.retryable, false);
  const internal = envelope("internal", "原始堆栈");
  assert.equal(internal.error.code, "internal");
});

test("磁盘满被识别为 storage_full", () => {
  assert.equal(isStorageFullError(new Error("database or disk is full")), true);
  assert.equal(isStorageFullError(new Error("SQLITE_FULL: no space")), true);
  assert.equal(isStorageFullError(new Error("syntax error")), false);
  assert.equal(toHttpError(new Error("database or disk is full")).code, "storage_full");
  assert.equal(toHttpError(new HttpError("busy")).code, "busy");
  assert.equal(toHttpError(new Error("whatever")).code, "internal");
});
