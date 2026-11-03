// 验证用的确定性“模型”：实现 OpenAI Chat Completions 流式协议。
// 目的是在不依赖任何外部模型凭据的前提下，驱动真实的 pi agent 循环与真实工具执行。

import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 9999);
// 测试用：在给出工具调用前等待若干毫秒，制造「正在执行」窗口以验证中断。
const DELAY_MS = Number(process.env.MOCK_DELAY_MS || 0);

function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === "string" ? p : p?.text ?? "")).join("");
  return "";
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || !req.url.startsWith("/v1/chat/completions")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"error":"not found"}');
    return;
  }

  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw || "{}");
  const messages = body.messages || [];
  const toolMessages = messages.filter((m) => m.role === "tool");
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const userText = textOf(lastUser?.content);

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });

  const base = {
    id: `chatcmpl-mock-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: body.model || "mock-agent",
  };
  const choice = (delta, finish = null) => ({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] });

  if (DELAY_MS) await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  sse(res, choice({ role: "assistant" }));

  const lastMessage = messages[messages.length - 1];
  if (lastMessage?.role === "tool") {
    const lastTool = toolMessages[toolMessages.length - 1];
    const output = textOf(lastTool.content).slice(0, 500) || "(empty)";
    sse(res, choice({ content: `工具已执行。输出如下：\n${output}` }));
    sse(res, choice({}, "stop"));
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  let name;
  let args;
  if (/写|write|note/i.test(userText)) {
    name = "write";
    args = { path: "/workspace/note.txt", content: `written by mock at ${new Date().toISOString()}\n` };
  } else if (/sleep|慢/.test(userText)) {
    name = "bash";
    args = { command: "sleep 6; echo slow-done" };
  } else {
    name = "bash";
    args = { command: "uname -srm; echo spike-proof > /workspace/spike-proof.txt; date -u" };
  }

  sse(
    res,
    choice({
      tool_calls: [
        {
          index: 0,
          id: `call_${Date.now()}`,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    }),
  );
  sse(res, choice({}, "tool_calls"));
  res.write("data: [DONE]\n\n");
  res.end();
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock provider listening on ${PORT}`));
