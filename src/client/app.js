// 客户端：无构建、无框架。只做三件事——把消息发出去、把 SSE 增量画出来、把失败说清楚。
// 依赖：/api/* 契约见 specs/001-remote-agent-access/contracts/http-api.md

const TOKEN_KEY = "mypi_token";

const el = {
  messages: document.getElementById("messages"),
  composer: document.getElementById("composer"),
  input: document.getElementById("input"),
  send: document.getElementById("btn-send"),
  abort: document.getElementById("btn-abort"),
  status: document.getElementById("status"),
  dialogAuth: document.getElementById("dialog-auth"),
  formAuth: document.getElementById("form-auth"),
  token: document.getElementById("token"),
  authError: document.getElementById("auth-error"),
  btnDevices: document.getElementById("btn-devices"),
  dialogDevices: document.getElementById("dialog-devices"),
  deviceList: document.getElementById("device-list"),
  formDevice: document.getElementById("form-device"),
  deviceLabel: document.getElementById("device-label"),
  deviceToken: document.getElementById("device-token"),
};

let token = localStorage.getItem(TOKEN_KEY) || "";
let running = false;
let degraded = false;
let currentBubble = null;

class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code || `HTTP ${status}`);
    this.status = status;
    this.code = code;
  }
}

function setStatus(state, text) {
  el.status.dataset.state = state;
  el.status.textContent = text;
}

function showAuth() {
  el.token.value = token;
  el.authError.hidden = true;
  if (!el.dialogAuth.open) el.dialogAuth.showModal();
}

async function api(path, options = {}) {
  const headers = Object.assign({}, options.headers);
  if (token) headers.authorization = `Bearer ${token}`;
  if (options.body) headers["content-type"] = "application/json";
  const res = await fetch(path, Object.assign({}, options, { headers }));
  if (res.status === 401 || res.status === 403) {
    showAuth();
    throw new ApiError(res.status, res.status === 403 ? "revoked" : "unauthorized");
  }
  return res;
}

async function readError(res) {
  try {
    const body = await res.json();
    return new ApiError(res.status, body?.error?.code, body?.error?.message);
  } catch {
    return new ApiError(res.status);
  }
}

/* ---------- 渲染 ---------- */

function bubble(role) {
  const node = document.createElement("div");
  node.className = `msg ${role}`;
  const body = document.createElement("div");
  body.className = "body";
  node.append(body);
  el.messages.append(node);
  el.messages.scrollTop = el.messages.scrollHeight;
  return { node, body };
}

function appendText(target, text) {
  target.textContent += text;
  el.messages.scrollTop = el.messages.scrollHeight;
}

function addAction(target, data) {
  let actions = target.querySelector(".actions");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "actions";
    target.append(actions);
  }
  const line = document.createElement("div");
  line.className = "action";
  line.dataset.ok = String(data.ok);
  const head = document.createElement("div");
  head.textContent = `${data.tool} · ${data.inputSummary || "(无参数摘要)"}`;
  line.append(head);
  if (data.outputSummary) {
    // FR-015：工具读到的东西是资料，不是指令——界面上必须标出来。
    const box = document.createElement("div");
    box.className = "tool-result";
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = "工具结果 · 不可信资料";
    box.append(tag, document.createTextNode(data.outputSummary));
    line.append(box);
  }
  actions.append(line);
  el.messages.scrollTop = el.messages.scrollHeight;
}

function renderHistory(messages) {
  el.messages.textContent = "";
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const { body } = bubble(message.role);
    body.textContent = message.content || "";
  }
}

/* ---------- 状态 ---------- */

async function refreshState() {
  const res = await api("/api/state");
  if (!res.ok) throw await readError(res);
  const state = await res.json();
  running = state.status === "running";
  el.abort.hidden = !running;
  el.send.disabled = running;
  if (state.status === "running") {
    setStatus("running", "处理中…");
  } else if (state.status === "interrupted") {
    setStatus("idle", "已中断");
  } else {
    setStatus(degraded ? "degraded" : "idle", degraded ? "降级模式" : "空闲");
  }
  return state;
}

/* ---------- SSE ---------- */

function parseFrames(buffer, flush) {
  const frames = [];
  let rest = buffer;
  let index = rest.indexOf("\n\n");
  while (index >= 0) {
    const block = rest.slice(0, index);
    rest = rest.slice(index + 2);
    if (block.trim()) frames.push(block);
    index = rest.indexOf("\n\n");
  }
  if (flush && rest.trim()) {
    frames.push(rest);
    rest = "";
  }
  return { frames, rest };
}

function decodeFrame(block) {
  let event = "message";
  const dataLines = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice(7);
    else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
  }
  if (!dataLines.length) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

function handleEvent(event, data, startedAt) {
  if (event === "status") {
    setStatus("running", "处理中…");
    if (!currentBubble) currentBubble = bubble("assistant");
    return;
  }
  if (event === "delta") {
    if (!currentBubble) currentBubble = bubble("assistant");
    appendText(currentBubble.body, data.text || "");
    return;
  }
  if (event === "action") {
    if (!currentBubble) currentBubble = bubble("assistant");
    addAction(currentBubble.body, data);
    return;
  }
  if (event === "done") {
    const ms = data.totalMs ?? Date.now() - startedAt;
    setStatus("idle", "空闲");
    void reportProbe({ supportsStream: true, fallbackTriggered: degraded, totalMs: ms });
    return;
  }
  if (event === "error") {
    if (!currentBubble) currentBubble = bubble("assistant");
    const box = document.createElement("div");
    box.className = "action";
    box.dataset.ok = "false";
    box.textContent = `错误：${data.message || data.code}${data.retryable ? "（可重试）" : ""}`;
    currentBubble.body.append(box);
  }
}

async function reportProbe(extra) {
  try {
    await api("/api/probe", {
      method: "POST",
      body: JSON.stringify(
        Object.assign(
          {
            supportsStream: typeof ReadableStream !== "undefined",
            fallbackTriggered: degraded,
            viewport: { width: window.innerWidth, height: window.innerHeight },
            dpr: window.devicePixelRatio,
            ua: navigator.userAgent,
          },
          extra,
        ),
      ),
    });
  } catch {
    /* probe 是证据通道，失败不打扰用户 */
  }
}

async function streamTurn(text) {
  const startedAt = Date.now();
  let firstDeltaAt = 0;
  const res = await api("/api/messages", { method: "POST", body: JSON.stringify({ text }) });
  if (!res.ok) throw await readError(res);

  const canStream = typeof res.body?.getReader === "function";
  if (!canStream) {
    // 降级 1：浏览器不能读流，整段读完再解析（FR-020）。
    degraded = true;
    setStatus("degraded", "降级模式");
    const textBody = await res.text();
    const { frames } = parseFrames(textBody, true);
    for (const block of frames) {
      const parsed = decodeFrame(block);
      if (parsed) handleEvent(parsed.event, parsed.data, startedAt);
    }
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseFrames(buffer, false);
    buffer = parsed.rest;
    for (const block of parsed.frames) {
      const frame = decodeFrame(block);
      if (!frame) continue;
      if (frame.event === "delta" && !firstDeltaAt) {
        firstDeltaAt = Date.now() - startedAt;
        void reportProbe({ supportsStream: true, firstDeltaMs: firstDeltaAt, fallbackTriggered: degraded });
      }
      handleEvent(frame.event, frame.data, startedAt);
    }
  }
}

/* 降级 2：流中途断掉 → 轮询补历史（FR-020）。 */
async function pollUntilSettled(baselineCount) {
  degraded = true;
  setStatus("degraded", "降级模式 · 正在补齐");
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const res = await api("/api/messages?limit=200");
    if (!res.ok) continue;
    const body = await res.json();
    if (body.messages.length > baselineCount) {
      renderHistory(body.messages);
      setStatus("degraded", "降级模式");
      return;
    }
  }
  setStatus("degraded", "降级模式 · 未取到结果");
}

/* ---------- 发送 ---------- */

async function send() {
  const text = el.input.value.trim();
  if (!text || running) return;
  const state = await refreshState();
  const baseline = state.messageCount ?? 0;

  el.input.value = "";
  running = true;
  el.send.disabled = true;
  el.abort.hidden = false;
  currentBubble = null;

  const userBubble = bubble("user");
  userBubble.body.textContent = text;

  try {
    await streamTurn(text);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      setStatus("idle", "未认证");
    } else if (error instanceof ApiError && error.status >= 400) {
      const box = bubble("assistant");
      box.body.textContent = `发送失败：${error.message}`;
      setStatus("idle", "空闲");
    } else {
      await pollUntilSettled(baseline);
    }
  } finally {
    running = false;
    el.send.disabled = false;
    el.abort.hidden = true;
    currentBubble = null;
    void refreshState().catch(() => {});
  }
}

/* ---------- 设备 ---------- */

function fmtTime(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

async function openDevices() {
  el.deviceToken.hidden = true;
  const res = await api("/api/devices");
  if (!res.ok) return;
  const body = await res.json();
  el.deviceList.textContent = "";
  for (const device of body.devices) {
    const item = document.createElement("li");
    const info = document.createElement("div");
    info.innerHTML = "";
    const title = document.createElement("div");
    title.textContent = `${device.label}${device.revokedAt ? "（已吊销）" : ""}`;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${device.tokenPrefix} · 创建 ${fmtTime(device.createdAt)} · 最近 ${fmtTime(device.lastUsedAt)}`;
    info.append(title, meta);
    const spacer = document.createElement("div");
    spacer.className = "spacer";
    item.append(info, spacer);
    if (!device.revokedAt) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "danger";
      btn.textContent = "吊销";
      btn.addEventListener("click", async () => {
        if (!window.confirm(`吊销 ${device.label}？该设备下一次请求就会失效。`)) return;
        await api(`/api/devices/${device.id}`, { method: "DELETE" });
        void openDevices();
      });
      item.append(btn);
    }
    el.deviceList.append(item);
  }
  if (!el.dialogDevices.open) el.dialogDevices.showModal();
}

/* ---------- 事件绑定 ---------- */

el.formAuth.addEventListener("submit", async (event) => {
  event.preventDefault();
  token = el.token.value.trim();
  localStorage.setItem(TOKEN_KEY, token);
  el.dialogAuth.close();
  try {
    await refreshState();
    const res = await api("/api/messages?limit=200");
    if (res.ok) renderHistory((await res.json()).messages);
  } catch {
    el.authError.hidden = false;
    el.authError.textContent = "令牌无效或已吊销";
    showAuth();
  }
});

el.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  void send();
});

el.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void send();
  }
});

el.abort.addEventListener("click", async () => {
  try {
    await api("/api/abort", { method: "POST" });
    setStatus("idle", "已中断");
  } catch {
    /* 中断失败不打断界面 */
  }
});

el.btnDevices.addEventListener("click", () => void openDevices());
document.getElementById("btn-devices-close").addEventListener("click", () => el.dialogDevices.close());
document.getElementById("btn-auth-cancel").addEventListener("click", () => el.dialogAuth.close());

el.formDevice.addEventListener("submit", async (event) => {
  event.preventDefault();
  const label = el.deviceLabel.value.trim();
  if (!label) return;
  const res = await api("/api/devices", { method: "POST", body: JSON.stringify({ label }) });
  if (!res.ok) return;
  const created = await res.json();
  el.deviceLabel.value = "";
  el.deviceToken.hidden = false;
  el.deviceToken.textContent = `新设备令牌（只显示这一次）：${created.token}`;
  void openDevices();
});

/* ---------- 启动 ---------- */

(async function boot() {
  if (!token) {
    showAuth();
    return;
  }
  try {
    await refreshState();
    const res = await api("/api/messages?limit=200");
    if (res.ok) renderHistory((await res.json()).messages);
  } catch {
    showAuth();
  }
})();
