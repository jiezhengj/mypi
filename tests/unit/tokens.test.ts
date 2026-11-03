import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateToken,
  hashToken,
  parseBearer,
  safeEqual,
  tokenPrefix,
} from "../../src/server/util/tokens.ts";

test("生成的令牌是 URL 安全的 43 字符 base64url", () => {
  const token = generateToken();
  assert.equal(token.length, 43);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
});

test("每次生成都不同", () => {
  assert.notEqual(generateToken(), generateToken());
});

test("哈希是稳定的 64 位十六进制", () => {
  const token = "fixed-token-value";
  const first = hashToken(token);
  assert.equal(first, hashToken(token));
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, hashToken(`${token}x`));
});

test("前缀取前 8 位", () => {
  assert.equal(tokenPrefix("abcdefghijklmnop"), "abcdefgh");
});

test("safeEqual 只在完全一致时为真", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
});

test("parseBearer 只接受合法格式", () => {
  assert.equal(parseBearer("Bearer abc"), "abc");
  assert.equal(parseBearer("bearer  abc "), "abc");
  assert.equal(parseBearer("Basic abc"), null);
  assert.equal(parseBearer("Bearer "), null);
  assert.equal(parseBearer(undefined), null);
});
