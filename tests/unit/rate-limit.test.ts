import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEVICE_LIMIT_PER_MIN,
  FAIL_THRESHOLD,
  LOCK_MS,
  RateLimiter,
} from "../../src/server/middleware/rate-limit.ts";

function makeClock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test("20 次失败后该来源被锁定", () => {
  const clock = makeClock();
  const limiter = new RateLimiter({ now: clock.now });
  for (let i = 0; i < FAIL_THRESHOLD; i += 1) {
    assert.equal(limiter.isLocked("1.2.3.4"), false);
    limiter.recordAuthFailure("1.2.3.4");
  }
  assert.equal(limiter.isLocked("1.2.3.4"), true);
  // 其他来源不受影响
  assert.equal(limiter.isLocked("5.6.7.8"), false);
});

test("锁定 15 分钟后自动解除", () => {
  const clock = makeClock();
  const limiter = new RateLimiter({ now: clock.now });
  for (let i = 0; i < FAIL_THRESHOLD; i += 1) limiter.recordAuthFailure("ip");
  assert.equal(limiter.isLocked("ip"), true);
  clock.advance(LOCK_MS - 1);
  assert.equal(limiter.isLocked("ip"), true);
  clock.advance(1);
  assert.equal(limiter.isLocked("ip"), false);
});

test("成功认证会清空失败计数", () => {
  const clock = makeClock();
  const limiter = new RateLimiter({ now: clock.now });
  for (let i = 0; i < 5; i += 1) limiter.recordAuthFailure("ip");
  assert.equal(limiter.failureCount("ip"), 5);
  limiter.clearFailures("ip");
  assert.equal(limiter.failureCount("ip"), 0);
});

test("失败窗口外的旧失败不再计数", () => {
  const clock = makeClock();
  const limiter = new RateLimiter({ now: clock.now });
  for (let i = 0; i < 10; i += 1) limiter.recordAuthFailure("ip");
  clock.advance(LOCK_MS + 1);
  assert.equal(limiter.failureCount("ip"), 0);
});

test("设备每分钟 60 次上限", () => {
  const clock = makeClock();
  const limiter = new RateLimiter({ now: clock.now });
  for (let i = 0; i < DEVICE_LIMIT_PER_MIN; i += 1) {
    assert.equal(limiter.consumeDevice("dev_1"), true);
  }
  assert.equal(limiter.consumeDevice("dev_1"), false);
  clock.advance(60_000);
  assert.equal(limiter.consumeDevice("dev_1"), true);
});

test("IP 每分钟 120 次上限", () => {
  const clock = makeClock();
  const limiter = new RateLimiter({ now: clock.now });
  for (let i = 0; i < 120; i += 1) limiter.consumeIp("ip");
  assert.equal(limiter.consumeIp("ip"), false);
});
