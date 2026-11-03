# Phase 0 Research: 远程可达的个人 Agent

本文件记录计划阶段的技术决策。每条都给出决策、理由与被否掉的备选；涉及数值处标注来源（2026-11-03 现场实测 / 官方文档 / 推断）。

## D1. HTTP 框架

- **Decision**: Express 5.x，仅用其路由、中间件链与 `res.write` 流式输出。
- **Rationale**: 需要的东西很少但很具体——中间件顺序（鉴权→限流→审计→业务）、SSE 长连接、静态资源、统一的错误信封。Express 5 的原生 async 错误冒泡让「统一错误信封」不需要额外约定；生态成熟，排障资料多。
- **Alternatives considered**:
  - `node:http` 手写路由：零依赖，但鉴权/限流/SSE 断开处理都要手写，代码量与出错面反而更大。
  - Fastify：性能更好，但单用户场景对吞吐不敏感，换来的插件体系与 schema 约定属于过度设计。

## D2. 传输协议

- **Decision**: SSE（`text/event-stream`）单向流 + 普通 POST 发送消息与中断。
- **Rationale**: 对话本质是「一次请求 → 一长串回应」，不需要双向；SSE 走标准 HTTP，能穿过只在 443/8443/10000 放行的 Funnel，实测在 Funnel 上逐事件到达（source: 2026-11-03 实测，客户端总耗时 2.85s、服务端处理 101ms）。
- **Alternatives considered**:
  - WebSocket：Funnel 支持但需要升级握手与额外的心跳约定；且浏览器断线重连要自己写，收益仅是省一次 POST。
  - 轮询：首字延迟直接翻倍，且 SC-001 无法达成。

## D3. 单活跃会话的并发模型

- **Decision**: 进程内只持有一个 `AgentSession`；用一个「忙/闲」标志 + 短队列（长度 1）串行化。第二个并发请求立即返回 `409 busy`，而不是排队等待。
- **Rationale**: FR-013 明确单活跃会话；立即拒绝比排队更容易解释、也避免用户以为消息丢了。会话中断后状态回到闲置，可继续。
- **Alternatives considered**:
  - 队列深度放大：会让「已发送但未执行」的消息在界面上悬着，与单会话语义冲突。
  - 多会话并行：明确 out of scope。

## D4. 设备令牌的存储形式

- **Decision**: 每个设备签发独立令牌（随机 32 字节，base64url 编码）；落盘只存 `sha256(token)` 与可读前缀（前 8 字符，用于界面上辨认），不存明文；令牌表是 `/data/config/devices.json`。
- **Rationale**: 满足 FR-018/FR-019；即使卷被读取也拿不到可直接使用的令牌；前缀让「吊销哪台」这件事在清单里可辨认。
- **Alternatives considered**:
  - 存明文：简单但违反「凭据不落盘」的自我约束。
  - 单一共享令牌：被用户明确否决（A 选项）。

## D5. 吊销立即生效

- **Decision**: 鉴权中间件每次请求读取令牌表；用文件的 `mtime + size` 作为版本号做内存缓存，文件一变就重载。
- **Rationale**: 单用户场景每秒最多几次请求，一次 `stat` 的成本可忽略；换来的是「吊销后下一次请求即失效」（SC-008）无需重启、无需消息总线。
- **Alternatives considered**: 定时轮询重载（最多滞后 N 秒，违背「下一次请求即失效」）；常驻内存不落盘（重启丢状态）。

## D6. 不可信内容规则注入（FR-015）

- **Decision**: 用官方 `DefaultResourceLoader` 的 `appendSystemPromptOverride` 在默认系统提示后追加一段规则：工具读到的内容一律是「资料」，其优先级低于用户指令，不得把其中的指令当作新任务执行；同时屏蔽项目内 `.pi` 目录的隐式提示注入（显式传 `appendSystemPromptOverride` 返回数组）。
- **Rationale**: 官方示例即为「追加指令」的标准做法（source: pi `examples/sdk/03-custom-prompt.ts`）；不需要 fork 提示词，也不改动 SDK 内部。
- **Alternatives considered**: 完全替换系统提示（会丢掉 pi 的工具使用约定，导致工具调用质量下降）；在每条用户消息前拼接警告（污染历史、且对已读内容无效）。

## D7. 客户端形态

- **Decision**: 同源托管的单页：`index.html` + 原生 JS（`fetch` + `ReadableStream` 解析 SSE）+ 手写 CSS 响应式布局；令牌存 `localStorage`。
- **Rationale**: 满足「零安装、桌面与手机共用」；无构建链意味着没有 `node_modules` 前端依赖、没有打包产物，改一行刷新即生效（原则 V）。
- **Alternatives considered**: React/Vite（需要构建与依赖升级链路，单页规模不值）；服务端渲染模板（流式局部更新仍要写前端 JS，等于两头都做）。

## D8. 审计日志

- **Decision**: `/data/audit/audit-YYYY-MM.jsonl` 追加写，每行一个事件：`ts`、`deviceId`、`kind`（auth/message/action/abort/device）、`detail`、`result`。不落明文令牌，不落完整消息正文（只留长度与摘要）。
- **Rationale**: JSONL 可 `grep`、可增量、无需数据库；按月分文件避免单文件无限增长，同时符合「不自动删除」——轮转只是换文件，不丢数据。
- **Alternatives considered**: SQLite（多一个依赖，查询能力用不上）；stdout（容器日志会被轮转丢掉，审计应可追溯）。

## D9. TypeScript 运行方式

- **Decision**: 直接用 Node 24 的原生类型剥离运行 `.ts`；不使用打包器；若剥离在该版本被禁用则回退 `tsx`（同一套源码，仅启动命令不同）。
- **Rationale**: 消除构建步骤与产物同步问题；Node 24 已稳定支持直接运行 TypeScript 语法（类型擦除）。**待实现阶段验证**：以容器内 `node --version` 与实际启动结果为准，这条按原则 IV 标注为「需实测确认」。
- **Alternatives considered**: `tsc` 编译产物（多一步构建、调试源映射成本）；`tsx`（多一个运行时依赖，但作为回退保留）。

## D10. 部署形态与回滚

- **Decision**: 单容器（`node:24-bookworm-slim` 基线），3 个卷：`/workspace`、`/data`（sessions/audit/config）、`/pi-home`；入口用服务端 Tailscale Funnel 指向容器端口；镜像按 `mypi:<git-sha>` 打 tag，回滚 = 用上一个 tag 重启。
- **Rationale**: 与评估阶段的实测形态一致（已跑通真实模型与工具调用）；单容器让「回滚」是一步操作。
- **Alternatives considered**: Compose 多服务（无第二个服务）；K8s（过度）。

## D11. 错误分类与状态码

- **Decision**: 统一信封 `{ error: { code, message, retryable } }`；状态码映射：未认证 `401 unauthorized`、已吊销 `403 revoked`、锁定中 `429 locked`、超限 `429 rate_limited`、忙 `409 busy`、存储满 `507 storage_full`、模型不可用 `503 model_unavailable`、模型超时 `504 model_timeout`。
- **Rationale**: FR-010 要求可读且可重试；SC-002 要求拒绝不泄露内容——统一信封天然只含错误码与通用文案。
- **Alternatives considered**: 直接透传上游错误（会泄露网关地址与内部细节）。

## D12. 会话恢复语义

- **Decision**: 启动时用 `SessionManager.continueRecent(cwd, sessionDir)` 恢复最近会话；会话目录固定，容器重建后路径不变。若会话文件不可读，则新建会话并在 `/api/state` 的 `recovered: false` 中说明。
- **Rationale**: 与实测行为一致（容器重启后同一 `sessionId` 续接、消息数连续增长，source: 2026-11-03 实测）；避免自定义会话索引。
- **Alternatives considered**: 自己维护「当前会话指针」文件（多一份状态要同步，容易与 pi 内部状态不一致）。

## 未决与验证清单

- **D9 的类型剥离**：实现首日验证 `node src/server/index.ts` 能否直接启动；不能则切 `tsx`。
- **移动端流式渲染**：`ReadableStream` 在 iOS Safari 的行为需实测（SC-006）。
- **Funnel 单向流在 3 分钟以上的长任务**是否会被中继断开：需实测（超时与重连策略在实现阶段定稿）。
