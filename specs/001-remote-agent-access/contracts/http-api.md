# Contract: HTTP / SSE API

所有 `/api/*` 接口都要求 `Authorization: Bearer <device-token>`。缺失或无效 → `401`；令牌已吊销 → `403`。响应体统一为错误信封，且**不得**包含会话内容、令牌、内部路径或上游错误原文。

## 通用错误信封

```json
{
  "error": {
    "code": "unauthorized | revoked | locked | rate_limited | busy | bad_request | storage_full | model_unavailable | model_timeout | internal",
    "message": "人类可读的中文说明",
    "retryable": false
  }
}
```

| code | HTTP | 触发条件 | retryable |
| --- | --- | --- | --- |
| `unauthorized` | 401 | 未携带令牌 / 令牌不匹配 | false |
| `revoked` | 403 | 令牌存在但已吊销 | false |
| `locked` | 429 | 连续失败达到阈值，进入锁定窗口 | true（窗口后） |
| `rate_limited` | 429 | 超出滑动窗口频率 | true |
| `busy` | 409 | 已有执行流在跑 | true |
| `bad_request` | 400 | 参数缺失或超长 | false |
| `storage_full` | 507 | 写入失败（磁盘满） | true |
| `model_unavailable` | 503 | 上游模型不可用 | true |
| `model_timeout` | 504 | 上游超时 | true |
| `internal` | 500 | 未预期错误 | true |

## GET /healthz

无鉴权。用于容器健康检查与入口连通性判断，**不返回**任何会话信息。

```json
{ "ok": true, "status": "idle", "version": "0.1.0" }
```

## GET /api/state

返回当前运行时状态与活动会话摘要（跨设备一致性依据，P3）。

```json
{
  "status": "idle",
  "startedAt": null,
  "activeSessionId": "01a1...",
  "recovered": true,
  "messageCount": 15,
  "lastError": null,
  "device": { "id": "dev_1", "label": "work-laptop" }
}
```

## GET /api/messages?limit=50

返回当前会话最近的消息，用于页面加载时渲染历史。`limit` 默认 50，上限 200。

```json
{
  "sessionId": "01a1...",
  "messages": [
    { "role": "user", "content": "把草稿整理一下", "timestamp": "2026-11-03T10:00:00Z" },
    { "role": "assistant", "content": "好的，我先看看…", "timestamp": "2026-11-03T10:00:03Z" }
  ]
}
```

## POST /api/messages

请求体：

```json
{ "text": "把 /workspace/draft.md 整理一下" }
```

约束：`text` 非空、≤ 8000 字符；超长 → `400 bad_request`；已有执行流 → `409 busy`（立即拒绝，不排队）。

响应：`200` + `text/event-stream`。事件按下列顺序与语义发出。

### SSE 帧格式

每帧 `event: <type>` + 一行 `data: <json>`，以空行结束。服务端每 15 秒发一次 `ping` 保活。

| event | data 结构 | 语义 |
| --- | --- | --- |
| `status` | `{ "status": "running", "startedAt": "..." }` | 开始执行 |
| `action` | `{ "id": "a1", "tool": "bash", "inputSummary": "ls -la /workspace", "ok": true, "startedAt": "...", "finishedAt": "..." }` | 一次工具动作完成（FR-014） |
| `delta` | `{ "text": "好的，" }` | 增量文本（FR-003） |
| `done` | `{ "messageId": "...", "totalMs": 6153, "status": "idle" }` | 本轮结束 |
| `error` | `{ "code": "model_timeout", "message": "...", "retryable": true }` | 本轮失败，连接随后关闭 |
| `ping` | `{ "ts": "..." }` | 保活 |

示例：

```text
event: status
data: {"status":"running","startedAt":"2026-11-03T10:00:00Z"}

event: action
data: {"id":"a1","tool":"bash","inputSummary":"uname -srm","ok":true,"startedAt":"2026-11-03T10:00:00Z","finishedAt":"2026-11-03T10:00:00Z"}

event: delta
data: {"text":"环境是 Linux"}

event: done
data: {"messageId":"m12","totalMs":1808,"status":"idle"}
```

### 断连语义

- 客户端断开：服务端**不**中断执行，任务继续跑完并落盘；重连后通过 `GET /api/messages` 补历史。
- 上游超时：发 `error` 事件（`model_timeout`）后关闭；用户消息已持久化，可重试。

## POST /api/abort

无请求体。若当前无执行 → 仍返回 `202`（幂等）。

```json
{ "aborted": true, "status": "interrupted" }
```

行为：中止当前执行流，界面状态转为 `interrupted`；下一次 `POST /api/messages` 可继续。

## GET /api/devices

```json
{
  "devices": [
    { "id": "dev_1", "label": "work-laptop", "tokenPrefix": "Xk3f9aQ2", "createdAt": "...", "lastUsedAt": "...", "revokedAt": null }
  ]
}
```

## POST /api/devices

请求体 `{ "label": "phone" }`。仅当请求来自已认证设备时可调用。

响应 `201`，**仅在这一次**返回明文令牌：

```json
{ "id": "dev_2", "label": "phone", "token": "<仅此一次展示>", "createdAt": "..." }
```

## DELETE /api/devices/:id

吊销指定设备。响应 `200 { "revoked": true }`；对不存在的 id → `404`（复用 `bad_request` 信封的 `code` 为 `bad_request`）。

**契约要求**：吊销后，该设备的**下一次**请求必须被拒绝（SC-008），其他设备不受影响。

## GET /api/audit?limit=100

```json
{
  "events": [
    { "ts": "...", "deviceId": "dev_1", "tokenPrefix": "Xk3f9aQ2", "kind": "message", "detail": "text(28 chars)", "result": "ok" }
  ]
}
```

不得返回令牌明文或完整消息正文。

## 静态资源

| 路径 | 内容 |
| --- | --- |
| `GET /` | `client/index.html` |
| `GET /app.js` | 客户端脚本 |
| `GET /styles.css` | 样式 |
| `GET /manifest.webmanifest` | 可选：加入主屏 |

静态资源无需鉴权，但内容中不得包含任何会话数据或个人配置。

## 安全契约

1. 所有 `/api/*` 均先鉴权，鉴权失败不进入业务逻辑。
2. 鉴权失败响应必须与「会话不存在」无法区分（FR-002）。
3. 连续失败达到阈值后返回 `locked`，锁定期间即使令牌正确也拒绝。
4. 审计记录每次 `auth` 失败与每次 `message`/`action`，不记录令牌明文。
