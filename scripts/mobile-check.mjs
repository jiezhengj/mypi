#!/usr/bin/env node
// 移动端模拟验收：用 Playwright 的设备描述符模拟 iPhone / Android，
// 覆盖「单入口、无横向滚动、点击目标够大、流式增量可见、样式生效」这些能自动断言的部分。
// 真机不在自动化范围（见 quickstart.md 的已知未验证项）。
//
// 用法：
//   node scripts/mobile-check.mjs --base http://<LAN_IP>:8088 --token <device token> [--out .tmp/mobile]

import fs from "node:fs";
import path from "node:path";
import { chromium, webkit, devices } from "playwright";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

const base = (arg("base", process.env.MYPI_BASE_URL) || "").replace(/\/$/, "");
const token = arg("token", process.env.MYPI_TOKEN) || "";
const outDir = path.resolve(arg("out", ".tmp/mobile"));
const debug = process.env.MYPI_MOBILE_DEBUG === "1";

if (!base || !token) {
  console.error("用法: node scripts/mobile-check.mjs --base <url> --token <device token> [--out <dir>]");
  process.exit(2);
}

fs.mkdirSync(outDir, { recursive: true });

const MIN_TAP_PX = 44;
const REPLY_TIMEOUT_MS = 180_000;

/** Playwright 在 WebKit 里截图时会注入内联样式，被 CSP 拦下并打日志；这不是页面自身的问题。 */
const TOOL_ARTIFACT = /Refused to apply a stylesheet because its hash/i;

async function runCase(browserType, deviceName, label) {
  const device = devices[deviceName];
  if (!device) throw new Error(`没有这个设备描述符：${deviceName}`);
  const browser = await browserType.launch();
  const context = await browser.newContext({ ...device, locale: "zh-CN" });
  await context.addInitScript((value) => {
    try {
      localStorage.setItem("mypi_token", value);
    } catch {
      /* 首次导航时可能还没有 origin，忽略 */
    }
  }, token);

  const page = await context.newPage();
  /** @type {Array<{name: string, ok: boolean, detail: string}>} */
  const checks = [];
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (TOOL_ARTIFACT.test(text)) return;
    consoleErrors.push(text);
    if (debug) console.log("  CONSOLE", text.slice(0, 160));
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  if (debug) {
    page.on("requestfailed", (request) =>
      console.log("  REQFAIL", request.method(), request.url().slice(0, 100), request.failure()?.errorText),
    );
    page.on("response", (response) => {
      if (!/\.(css|js)$/.test(response.url())) {
        console.log("  RESP", response.status(), response.request().method(), response.url().replace(base, ""));
      }
    });
  }

  const startedAt = Date.now();
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.readyState !== "loading");
  // 等 boot() 拉完历史再取基线，否则会把「历史消息」误当成「这一轮的新回复」。
  await page.waitForFunction(
    () => document.getElementById("status")?.textContent?.startsWith("空闲") || document.getElementById("dialog-auth")?.open,
    undefined,
    { timeout: 30_000 },
  );
  let stable = -1;
  for (let i = 0; i < 40; i += 1) {
    const count = await page.evaluate(() => document.querySelectorAll(".msg").length);
    if (count === stable) break;
    stable = count;
    await page.waitForTimeout(300);
  }
  const loadMs = Date.now() - startedAt;

  const meta = await page.evaluate(() => {
    const viewport = document.querySelector('meta[name="viewport"]')?.getAttribute("content") || "";
    const sheets = [...document.styleSheets].map((sheet) => {
      try {
        return { href: sheet.href, rules: sheet.cssRules.length };
      } catch {
        return { href: sheet.href, rules: -1 };
      }
    });
    return {
      viewport,
      ua: navigator.userAgent,
      background: getComputedStyle(document.body).backgroundColor,
      sheets,
    };
  });

  checks.push({
    name: "viewport 元信息",
    ok: /width=device-width/.test(meta.viewport),
    detail: meta.viewport || "(缺失)",
  });
  checks.push({
    name: "样式表生效",
    ok: meta.sheets.some((sheet) => (sheet.rules ?? 0) > 0) && meta.background !== "rgba(0, 0, 0, 0)",
    detail: `body 背景 ${meta.background}，样式表 ${meta.sheets.map((s) => `${s.rules} 条规则`).join(" / ") || "无"}`,
  });

  const authOpen = await page.evaluate(() => document.getElementById("dialog-auth")?.open ?? false);
  checks.push({
    name: "已登录时无需再输入令牌",
    ok: !authOpen,
    detail: authOpen ? "令牌对话框仍打开" : "直接进入会话",
  });

  const width = await page.evaluate(() => ({
    inner: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  checks.push({
    name: "无横向滚动",
    ok: width.scroll <= width.inner + 1,
    detail: `innerWidth=${width.inner} scrollWidth=${width.scroll}`,
  });

  const targets = await page.evaluate((min) => {
    const nodes = [...document.querySelectorAll("button, textarea, input, a")];
    return nodes
      .filter((node) => {
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      })
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          tag: node.tagName.toLowerCase(),
          id: node.id || node.className || "",
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          ok: rect.width >= min && rect.height >= min,
        };
      });
  }, MIN_TAP_PX);
  const small = targets.filter((item) => !item.ok);
  checks.push({
    name: "点击目标不小于 44px",
    ok: small.length === 0,
    detail: small.length ? JSON.stringify(small) : `${targets.length} 个可见控件全部达标`,
  });

  // 用一条带时间戳的唯一消息；只比较「发送前后的最后一条助手气泡」，避免历史重渲染干扰。
  // 等上一轮彻底结束：同一时刻只允许一个回合。
  await page.waitForFunction(() => !document.getElementById("btn-send")?.disabled, undefined, { timeout: 120_000 });
  const beforeSet = await page.evaluate(() =>
    [...document.querySelectorAll(".msg.assistant .body")].map((node) => node.textContent.trim()).filter(Boolean),
  );
  const prompt = `模拟端验收 ${label} ${Date.now()}：用一句话回答收到即可`;
  await page.fill("#input", prompt);
  const sendStartedAt = Date.now();
  await page.click("#btn-send");

  let firstDeltaMs = 0;
  let assistantText = "";
  try {
    // 先等出现新的助手文本（首字），再等回合结束。
    await page.waitForFunction(
      (known) => {
        const texts = [...document.querySelectorAll(".msg.assistant .body")].map((node) => node.textContent.trim());
        return texts.some((text) => text.length > 0 && !known.includes(text));
      },
      beforeSet,
      { timeout: REPLY_TIMEOUT_MS },
    );
    firstDeltaMs = Date.now() - sendStartedAt;
    await page.waitForFunction(
      () => {
        const text = document.getElementById("status")?.textContent || "";
        return text.includes("空闲") || text.includes("降级");
      },
      undefined,
      { timeout: REPLY_TIMEOUT_MS },
    );
    assistantText = await page.evaluate((known) => {
      const texts = [...document.querySelectorAll(".msg.assistant .body")]
        .map((node) => node.textContent.trim())
        .filter((text) => text.length > 0 && !known.includes(text));
      return texts.length ? texts[texts.length - 1] : "";
    }, beforeSet);
  } catch (error) {
    const snapshot = await page.evaluate(() => ({
      status: document.getElementById("status")?.textContent,
      nodes: document.querySelectorAll(".msg").length,
      tail: document.body.innerText.slice(-160),
    }));
    checks.push({
      name: "流式回复可见",
      ok: false,
      detail: `${String(error).slice(0, 160)} | 快照=${JSON.stringify(snapshot)}`,
    });
  }
  if (assistantText) {
    checks.push({
      name: "流式回复可见",
      ok: true,
      detail: `首字 ${firstDeltaMs}ms，共 ${assistantText.length} 字：${assistantText.slice(0, 40)}`,
    });
  }

  const screenshot = path.join(outDir, `${label}.png`);
  await page.screenshot({ path: screenshot });

  const inputBox = await page.evaluate(() => {
    const rect = document.getElementById("input")?.getBoundingClientRect();
    return rect ? { top: rect.top, bottom: rect.bottom, viewport: window.innerHeight } : null;
  });
  checks.push({
    name: "输入框在视口内",
    ok: Boolean(inputBox && inputBox.bottom <= inputBox.viewport + 1 && inputBox.top >= 0),
    detail: inputBox
      ? `top=${Math.round(inputBox.top)} bottom=${Math.round(inputBox.bottom)} vh=${inputBox.viewport}`
      : "(未找到)",
  });

  checks.push({
    name: "无前端报错",
    ok: consoleErrors.length === 0,
    detail: consoleErrors.length ? consoleErrors.slice(0, 3).join(" | ") : "无",
  });

  await context.close();
  await browser.close();

  return {
    label,
    device: deviceName,
    ua: meta.ua,
    viewport: device.viewport,
    dpr: device.deviceScaleFactor,
    loadMs,
    firstDeltaMs,
    screenshots: [path.basename(screenshot)],
    checks,
    ok: checks.every((check) => check.ok),
  };
}

const cases = [
  [webkit, "iPhone 13", "ios-webKit"],
  [chromium, "Pixel 7", "android-chromium"],
];

const results = [];
for (const [browserType, deviceName, label] of cases) {
  try {
    results.push(await runCase(browserType, deviceName, label));
  } catch (error) {
    results.push({
      label,
      device: deviceName,
      ok: false,
      checks: [{ name: "启动浏览器", ok: false, detail: String(error).slice(0, 300) }],
    });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  // 不记录真实主机地址
  entry: base.replace(/^https?:\/\/[^/]+/, "<entry>"),
  results,
  ok: results.every((item) => item.ok),
};
fs.writeFileSync(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

for (const item of results) {
  console.log(`\n[${item.label}] ${item.device} → ${item.ok ? "PASS" : "FAIL"}`);
  for (const check of item.checks) {
    console.log(`  ${check.ok ? "✔" : "✘"} ${check.name}: ${check.detail}`);
  }
}
console.log(`\n报告: ${path.join(outDir, "report.json")}`);
process.exit(report.ok ? 0 : 1);
