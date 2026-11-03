import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { authHeaders, startHarness, type Harness } from "../helpers/harness.ts";

let harness: Harness;

before(async () => {
  harness = await startHarness();
});

after(async () => {
  await harness.close();
});

test("静态资源只来自客户端目录，不能穿越到数据目录", async () => {
  const ok = await fetch(`${harness.baseUrl}/`);
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /mypi/);

  for (const probe of ["/../package.json", "/..%2fpackage.json", "/%2e%2e/package.json"]) {
    const res = await fetch(`${harness.baseUrl}${probe}`);
    assert.ok([400, 404].includes(res.status), `${probe} 返回了 ${res.status}`);
  }
});

test("客户端目录里没有任何敏感文件", () => {
  const staticDir = path.resolve(import.meta.dirname, "../../src/client");
  const files = fs.readdirSync(staticDir);
  for (const file of files) {
    assert.match(file, /^(index\.html|app\.js|styles\.css)$/);
  }
});

test("数据目录与工作目录分开，且都在受控位置", () => {
  assert.notEqual(harness.dataDir, path.parse(harness.dataDir).root);
  assert.ok(harness.dataDir.includes("mypi-test-"));
  const dbPath = path.join(harness.dataDir, "mypi.db");
  assert.equal(fs.existsSync(dbPath), true);
});

test("响应带安全头", async () => {
  const res = await fetch(`${harness.baseUrl}/healthz`);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'self'/);
});

test("健康检查不返回模型名、会话或工具信息", async () => {
  const body = (await (await fetch(`${harness.baseUrl}/healthz`)).json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["ok", "status", "version"]);
});

test("未知 API 路径返回统一错误信封", async () => {
  const res = await fetch(`${harness.baseUrl}/api/nope`, { headers: authHeaders(harness.token) });
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "not_found");
});

test("请求体不是合法 JSON 时返回 bad_request", async () => {
  const res = await fetch(`${harness.baseUrl}/api/messages`, {
    method: "POST",
    headers: authHeaders(harness.token),
    body: "{not json",
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "bad_request");
});
