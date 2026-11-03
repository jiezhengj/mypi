# Phase 1 Data Model: 远程可达的个人 Agent

所有实体落在挂载卷上。令牌与审计存在 SQLite 数据库 `/data/mypi.db`（WAL 模式）；会话仍由 pi 以 JSONL 管理。字段命名与 `src/shared/contracts.ts` 保持一致。

## 实体总览

| 实体 | 存储位置 | 生命周期 | 归属 |
| --- | --- | --- | --- |
| DeviceToken | SQLite `device_tokens` | 手工签发 → 吊销 | 本服务 |
| Session | `/data/sessions/<timestamp>_<uuid>.jsonl` | 无限期 | pi `SessionManager` |
| Message | 会话 JSONL 内的一行 | 随会话 | pi |
| ActionRecord | SSE 事件 + 审计摘要 | 随会话 / 审计 | 本服务（从 pi 事件派生） |
| AuditEvent | SQLite `audit_events` | 无限期（只插入） | 本服务 |
| RuntimeState | 进程内存 | 进程级 | 本服务 |

## SQLite 模式

```sql
CREATE TABLE IF NOT EXISTS device_tokens (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,   -- sha256(明文)，64 位十六进制
  token_prefix  TEXT NOT NULL,          -- 明文前 8 位，仅用于辨认
  created_at    TEXT NOT NULL,
  last_used_at  TEXT,
  revoked_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_hash ON device_tokens(token_hash);

CREATE TABLE IF NOT EXISTS audit_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT NOT NULL,
  device_id     TEXT,
  token_prefix  TEXT,
  kind          TEXT NOT NULL,          -- auth | message | action | abort | device
  detail        TEXT NOT NULL,          -- ≤200 字符摘要，不含明文与正文
  result        TEXT NOT NULL           -- ok | denied | error
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_events(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_device ON audit_events(device_id, ts DESC);
```

**库级设置**：`PRAGMA journal_mode=WAL`、`PRAGMA synchronous=NORMAL`、`PRAGMA foreign_keys=ON`。迁移用 `user_version` 递增，启动时执行未应用的迁移。

## DeviceToken

一个设备一份凭据，可单独吊销。

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 唯一、生成时确定 | 内部标识，用于审计与吊销 |
| `label` | string | 1–40 字符，去首尾空格 | 设备名（如 `work-laptop`），用户可读 |
| `tokenHash` | string | 64 位十六进制 | `sha256(明文令牌)`，**不存明文** |
| `tokenPrefix` | string | 8 字符 | 明文前 8 位，仅用于界面辨认 |
| `createdAt` | ISO8601 | 必填 | 签发时间 |
| `lastUsedAt` | ISO8601 \| null | 可空 | 最近一次成功认证时间 |
| `revokedAt` | ISO8601 \| null | 可空 | 非空即视为已吊销 |

**校验规则**

- 令牌明文形态：32 字节随机数的 base64url 编码，仅签发时展示一次。
- 认证：对请求携带的令牌取 `sha256` 后与 `tokenHash` 比较；比较使用定长比较，避免时序差异。
- 已吊销（`revokedAt != null`）的令牌即使哈希匹配也必须拒绝，返回 `403 revoked`。
- `label` 不要求唯一；重复时由用户自行区分。

**状态转换**

```text
签发(active) ──吊销──> revoked
      │
      └存续期内可无限次使用（更新 lastUsedAt）
```

## Session

由 pi 的 `SessionManager` 管理，本服务不自定义格式，只读取与引用。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `sessionId` | string | pi 生成的 UUID |
| `file` | 路径 | 会话 JSONL 的绝对路径 |
| `createdAt` | ISO8601 | 文件创建时间（取自文件名或首行） |
| `messageCount` | number | 消息条数（由 `session.messages.length` 得到） |
| `cwd` | string | 固定为工作目录（`/workspace`） |

**约束**

- 同一时刻只有一个会话处于「活动」地位（FR-013）。
- 服务启动时恢复最近会话；恢复失败则新建，并通过 `recovered: false` 告知。
- 会话文件只追加，不由本服务改写或删除；「删除会话」= 用户显式操作删除文件，需先停止服务或确认无写入。

## Message

会话 JSONL 中的一条记录，字段由 pi 定义；本服务只读取用于渲染与统计。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `role` | `user` \| `assistant` \| `tool` | 发言方 |
| `content` | string / 结构化块 | 文本或工具结果块 |
| `timestamp` | ISO8601 | 产生时间 |

## ActionRecord

从 pi 的工具执行事件派生，用于界面展示「它到底做了什么」（FR-014）。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 事件内唯一，供界面按序渲染 |
| `tool` | string | `bash` / `read` / `write` / `edit` / `grep` / `find` |
| `inputSummary` | string | 参数摘要（命令前 200 字符 / 文件路径），**不含完整内容** |
| `outputSummary` | string | 结果摘要（退出码、行数、前 200 字符） |
| `ok` | boolean | 是否成功 |
| `startedAt` / `finishedAt` | ISO8601 | 起止时间 |

**约束**：`inputSummary` 必须截断，避免把整段文件内容塞进审计与界面。

## AuditEvent

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `ts` | ISO8601 | 必填 | 事件时间 |
| `deviceId` | string \| null | 可空 | 认证失败时为 null，但保留 `tokenPrefix` 便于排查 |
| `tokenPrefix` | string \| null | 可空 | 失败尝试携带的前缀（若有） |
| `kind` | `auth` \| `message` \| `action` \| `abort` \| `device` \| `probe` | 必填 | 事件类别 |
| `detail` | string | ≤ 200 字符 | 摘要，**不得包含令牌明文与完整消息正文** |
| `result` | `ok` \| `denied` \| `error` | 必填 | 结果 |

**分区规则**：不删除任何行（FR-016）；增长靠索引与 `limit` 分页控制查询成本。

## RuntimeState（进程内存）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | `idle` \| `running` \| `interrupted` | 当前执行状态 |
| `activeSessionId` | string | 当前会话 |
| `startedAt` | ISO8601 \| null | 当前任务开始时间 |
| `lastError` | `{ code, message }` \| null | 最近一次失败，供界面提示 |

**状态转换**

```text
idle ──POST /api/messages──> running ──完成──> idle
                                │
                                ├──POST /api/abort──> interrupted ──下一次消息──> running
                                └──出错──> idle（lastError 置位）
```

**并发规则**：`running` 期间到达的新消息立即返回 `409 busy`，不入队（见 research D3）。

## 关系

```text
DeviceToken 1 ──< AuditEvent（一次请求/一次动作产生多条）
Session     1 ──< Message
Session     1 ──< ActionRecord（内嵌在 SSE 与审计摘要中）
RuntimeState 1 ──1 Session（活动会话）
```

## 不变量

1. 任何时刻磁盘上不存在令牌明文（签发时的一次性展示除外）；`device_tokens` 中只有哈希与前缀。
2. 任何审计行都不包含令牌明文与完整消息正文。
3. 会话文件只增不改；删除是显式动作，且不自动发生。
4. `running` 状态最多对应一个执行流。
