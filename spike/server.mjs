// 验证用最小服务：在容器内跑 pi agent，对外提供 SSE 对话接口。
// 不是产品代码，只用于验证 SDK 常驻、工具执行、会话持久化、鉴权与网络链路。

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";

const PORT = Number(process.env.PORT || 8787);
const TOKEN = process.env.MYPY_TOKEN || "";
const WORKDIR = process.env.MYPY_WORKDIR || "/workspace";
const SESSION_DIR = process.env.MYPY_SESSION_DIR || "/data/sessions";
const PI_HOME = process.env.PI_CODING_AGENT_DIR || "/data/pi";
const PROVIDER = process.env.PI_PROVIDER || "magpie";
const MODEL_ID = process.env.PI_MODEL || "auto/deepseek-v4.1-flash";

const log = (...args) => console.log(new Date().toISOString(), ...args);

function writeModelsJson() {
  const baseUrl = process.env.PI_BASE_URL;
  if (!baseUrl) return false;
  const config = {
    providers: {
      [PROVIDER]: {
        baseUrl,
        api: "openai-completions",
        apiKey: process.env.PI_API_KEY ? "${PI_API_KEY}" : "dummy",
        models: [{ id: MODEL_ID }],
      },
    },
  };
  fs.mkdirSync(PI_HOME, { recursive: true });
  const file = path.join(PI_HOME, "models.json");
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  log("models.json written", file, "provider=", PROVIDER, "model=", MODEL_ID);
  return true;
}

writeModelsJson();
fs.mkdirSync(SESSION_DIR, { recursive: true });
fs.mkdirSync(WORKDIR, { recursive: true });

const modelRuntime = await ModelRuntime.create();
const model = modelRuntime.getModel(PROVIDER, MODEL_ID);
if (!model) {
  log("model not found, available:", (await modelRuntime.getAvailable()).map((m) => `${m.provider}/${m.id}`).join(","));
  process.exit(2);
}
log("model resolved:", `${model.provider}/${model.id}`);

const sessionManager = SessionManager.continueRecent(WORKDIR, SESSION_DIR);
const { session } = await createAgentSession({ model, modelRuntime, sessionManager, cwd: WORKDIR });
log("session ready:", session.sessionId, "file:", session.sessionFile ?? "(none)");
log("tools:", session.getActiveToolNames().join(","));

let inFlight = false;

const PAGE = `<!doctype html><meta charset="utf-8"><title>mypi spike</title>
<style>body{font-family:ui-sans-serif,system-ui;margin:0;padding:16px;background:#111;color:#eee}
#out{white-space:pre-wrap;border:1px solid #333;padding:12px;min-height:200px;border-radius:8px}
input,button{font-size:14px;padding:8px;border-radius:6px;border:1px solid #444;background:#1c1c1c;color:#eee}
#q{width:60%}</style>
<h3>mypi spike</h3>
<div><input id="tok" placeholder="token" size="28"> <input id="q" placeholder="说点什么"> <button id="send">发送</button></div>
<p></p><div id="out"></div>
<script>
const out=document.getElementById('out');
document.getElementById('tok').value=localStorage.getItem('mypi_token')||'';
async function send(){
  const tok=document.getElementById('tok').value.trim();
  const q=document.getElementById('q').value.trim();
  if(!q) return;
  localStorage.setItem('mypi_token',tok);
  out.textContent='';
  const r=await fetch('/prompt',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+tok},body:JSON.stringify({text:q})});
  if(!r.ok){out.textContent='HTTP '+r.status+' '+await r.text();return;}
  const rd=r.body.getReader();const dec=new TextDecoder();let buf='';
  for(;;){const {value,done}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});
    let i;while((i=buf.indexOf('\\n\\n'))>=0){const chunk=buf.slice(0,i);buf=buf.slice(i+2);
      const line=chunk.split('\\n').find(l=>l.startsWith('data: '));if(!line)continue;
      const ev=JSON.parse(line.slice(6));
      if(ev.type==='delta')out.textContent+=ev.text;
      else if(ev.type==='tool')out.textContent+='\\n[工具] '+ev.name+'\\n';
      else if(ev.type==='error')out.textContent+='\\n[错误] '+ev.text;
    }}
}
document.getElementById('send').onclick=send;
document.getElementById('q').addEventListener('keydown',e=>{if(e.key==='Enter')send();});
</script>`;

function authorized(req) {
  if (!TOKEN) return false;
  const header = req.headers.authorization || "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return supplied.length === TOKEN.length && supplied === TOKEN;
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
    return;
  }

  if (url.pathname === "/health") {
    sendJson(res, 200, { ok: true, model: `${model.provider}/${model.id}`, session: session.sessionId });
    return;
  }

  if (!authorized(req)) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/state") {
    sendJson(res, 200, {
      sessionId: session.sessionId,
      sessionFile: session.sessionFile ?? null,
      model: `${model.provider}/${model.id}`,
      messages: session.messages.length,
      tools: session.getActiveToolNames(),
      busy: inFlight,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/abort") {
    if (inFlight) await session.abort();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/prompt") {
    if (inFlight) {
      sendJson(res, 409, { error: "busy" });
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let text = "";
    try {
      text = JSON.parse(raw || "{}").text || "";
    } catch {
      sendJson(res, 400, { error: "bad json" });
      return;
    }
    if (!text.trim()) {
      sendJson(res, 400, { error: "empty text" });
      return;
    }

    inFlight = true;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    const emit = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    const started = Date.now();
    let firstDeltaAt = 0;

    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_update") {
        const inner = event.assistantMessageEvent;
        if (inner?.type === "text_delta" && inner.delta) {
          if (!firstDeltaAt) {
            firstDeltaAt = Date.now();
            emit({ type: "ttft_ms", ms: firstDeltaAt - started });
          }
          emit({ type: "delta", text: inner.delta });
        } else if (inner?.type === "tool_call_start" || inner?.type === "tool_call_end") {
          emit({ type: "tool", name: inner.toolName || inner.name || inner.type });
        }
      } else if (event.type.startsWith("tool_execution")) {
        emit({ type: "tool", name: event.toolName || event.type });
      }
    });

    try {
      await session.prompt(text);
      emit({ type: "done", text: session.getLastAssistantText?.() ?? "", total_ms: Date.now() - started });
    } catch (error) {
      log("prompt failed:", error?.message);
      emit({ type: "error", text: String(error?.message || error) });
    } finally {
      unsubscribe();
      inFlight = false;
      res.end();
    }
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, "0.0.0.0", () => log(`listening on ${PORT}, workdir=${WORKDIR}, sessions=${SESSION_DIR}`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    log("shutting down on", signal);
    session.dispose?.();
    process.exit(0);
  });
}
