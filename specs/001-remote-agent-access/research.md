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

- **Decision**: 每个设备签发独立令牌（随机 32 字节，base64url 编码）；落盘只存 `sha256(token)` 与可读前缀（前 8 字符，用于界面上辨认），不存明文；令牌存在 SQLite 的 `device_tokens` 表（见 D13）。
- **Rationale**: 满足 FR-018/FR-019；即使卷被读取也拿不到可直接使用的令牌；前缀让「吊销哪台」这件事在清单里可辨认；用表而不是 JSON 文件，是为了并发写与查询都有确定语义。
- **Alternatives considered**:
  - 存明文：简单但违反「凭据不落盘」的自我约束。
  - 单一共享令牌：被用户明确否决（A 选项）。
  - JSON 文件：单用户的写入量确实很小，但「读-改-写」在并发请求下需要自己加锁，SQLite 用事务直接解决。

## D5. 吊销立即生效

- **Decision**: 鉴权中间件每次请求对 `device_tokens` 做一次按 `token_hash` 的索引查询；吊销是一次 `UPDATE ... SET revoked_at = ...`，无需重启、无需缓存失效通知。
- **Rationale**: 单用户场景每秒最多几次请求，一次索引命中在微秒级；换来的是「吊销后下一次请求即失效」（SC-008）且没有缓存一致性问题。
- **Alternatives considered**: 内存缓存 + 文件 mtime 失效（多一层状态，收益可忽略）；定时轮询重载（最多滞后 N 秒，违背「下一次请求即失效」）。

## D6. 不可信内容规则注入（FR-015）

- **Decision**: 用官方 `DefaultResourceLoader` 的 `appendSystemPromptOverride` 在默认系统提示后追加一段规则：工具读到的内容一律是「资料」，其优先级低于用户指令，不得把其中的指令当作新任务执行；同时屏蔽项目内 `.pi` 目录的隐式提示注入（显式传 `appendSystemPromptOverride` 返回数组）。
- **Rationale**: 官方示例即为「追加指令」的标准做法（source: pi `examples/sdk/03-custom-prompt.ts`）；不需要 fork 提示词，也不改动 SDK 内部。
- **Alternatives considered**: 完全替换系统提示（会丢掉 pi 的工具使用约定，导致工具调用质量下降）；在每条用户消息前拼接警告（污染历史、且对已读内容无效）。

## D7. 客户端形态

- **Decision**: 同源托管的单页：`index.html` + 原生 JS（`fetch` + `ReadableStream` 解析 SSE）+ 手写 CSS 响应式布局；令牌存 `localStorage`。
- **Rationale**: 满足「零安装、桌面与手机共用」；无构建链意味着没有 `node_modules` 前端依赖、没有打包产物，改一行刷新即生效（原则 V）。
- **Alternatives considered**: React/Vite（需要构建与依赖升级链路，单页规模不值）；服务端渲染模板（流式局部更新仍要写前端 JS，等于两头都做）。

## D8. 审计存储

- **Decision**: 审计事件写入 SQLite 的 `audit_events` 表（`ts`、`device_id`、`token_prefix`、`kind`、`detail`、`result`），按 `ts` 建索引；只插入不更新（append-only 语义）。接口按 `limit` 倒序返回。
- **Rationale**: 用表而不是 JSONL 的直接收益是「按时间倒序取最近 N 条」和「按设备/类型过滤」都变成一条 SQL；几个月后翻旧账不需要自己写扫描逻辑。不删任何行，符合 FR-016。
- **Alternatives considered**:
  - JSONL 按 `YYYY-MM` 分文件：可 `grep`，但查询与分页都要自己实现，且删不掉单条（虽然本期不需要删）。
  - stdout 日志：会被容器日志轮转丢掉，审计必须可追溯。

## D13. 嵌入式数据库选型

- **Decision**: 用 Node 24 内置的 `node:sqlite`；若该版本不可用或行为不稳定，回退 `better-sqlite3`（同一套 DAO 接口，仅连接层不同）。
- **Rationale**: 内置模块意味着**零新增依赖、零本地编译**，镜像里不需要编译工具链；单文件数据库落在数据卷上，备份就是复制一个文件。对单用户、低并发的场景，WAL 模式足够。
- **Alternatives considered**:
  - `better-sqlite3`：成熟稳定，但是原生扩展，镜像构建要带编译依赖，与「依赖最少」相悖（保留为回退）。
  - PostgreSQL：独立服务 + 连接池 + 备份策略，对单用户属于纯增运维成本（原则 V）。
  - 继续用文件：令牌表要自己加锁，审计查询要自己实现（已被用户否决）。
- **验证项**：实现首日确认 `node:sqlite` 在当前 Node 24 版本可用（`DatabaseSync` 打开、建表、查询）；不通过则按回退路径处理。

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

## D14. 限流与锁定参数（写死）

- **Decision**: 认证失败采用滑动窗口计数：**同一来源 15 分钟内累计失败 ≥ 20 次即锁定 15 分钟**；锁定期间即使令牌正确也拒绝（`429 locked`）。正常请求限流为**每设备每分钟 60 次**、**每来源每分钟 120 次**。
- **Rationale**: 单用户手工操作远达不到 60 次/分钟，正常使用不会被误伤；20 次失败对暴力枚举来说太少，配合 15 分钟窗口把暴力成本推到不可行。参数写死而不是可配置，是为了让 SC-005 的验证结果唯一。
- **Alternatives considered**:
  - 指数退避：更平滑，但验收时难以给出确定断言。
  - 只限流不锁定：无法满足 SC-005 的「显著延迟或拒绝」。
- **实现位置**：进程内存滑动窗口（重启即清零）。重启清零是可接受的：攻击者无法通过「诱导重启」来重置计数。

## D15. 移动端验证方式（无真机）

- **Decision**: 用 Playwright 的 WebKit 与 Chromium 以移动视口（390×844、360×640、DPR 3、touch、移动 UA）跑真实页面做自动化断言；客户端内置「流式不可用 / 流式中断 → 非流式降级」路径，并把降级触发上报到 `/api/probe` 供事后核对。
- **Rationale**: 所有者没有 iPhone 且无法做手工测试，验收不能依赖人工确认。移动端的可验证部分是布局数学（是否横滚、点击区大小）与增量渲染（首 delta 是否早于 done），这两类都能在模拟里精确判定；真正无法模拟的是 iOS 的真实网络栈与软键盘，因此改为「用降级路径把风险降级为可接受」，而不是假装验证过。
- **Alternatives considered**:
  - 依赖人工真机测试：被明确排除（无设备）。
  - BrowserStack 等云真机：需要付费与外部账号，与「不租服务器」的成本偏好冲突；可作为后续可选增强。
  - 只做响应式 CSS 不做验证：SC-006 将无法留证。

## D16. 外部可达性的验证方式（无第二台设备）

- **Decision**: 两段式验证。(1) 本机以公网域名 + 强制外部 egress 访问，断言解析到公网地址、TLS 指向公网 ingress、RTT 显著高于内网；(2) 用 GitHub Actions 的 `workflow_dispatch` 在 runner 上跑一次探测，入口地址只作为运行时输入并用 `::add-mask::` 屏蔽，仓库里不出现地址。
- **Rationale**: 所有者不参与测试，且没有第二台物理设备；CI runner 是唯一「真正的外部主机」且不引入新的付费服务。区分两段是因为：本机验证成本低、可反复跑；CI 验证证明「换一个网络、换一个 ASN 也能连上」，跑一次就够。
- **Alternatives considered**:
  - 云手机/云真机服务：付费 + 外部账号。
  - 只用本机：无法排除「本机恰好能连」的巧合。
  - 把入口地址写进仓库变量：公开仓库会暴露地址，否掉。
- **约束**：CI 探测只打 `/healthz` 与未认证的 `/api/*`（断言 401），**不**在公共日志里出现任何令牌；需要认证的延迟测量走本机 probe。

## D17. 公网入口长期开启的后果

- **Decision**: 入口是常开的，因此「先暴露后加固」不可接受；实现顺序固定为：鉴权与限流中间件就绪并通过测试（Phase 2 完成）→ 才在部署中开入口。
- **Rationale**: 常开意味着任何未完成的窗口都真实暴露；宪法原则 III 要求把暴露面当攻击面管理。
- **Alternatives considered**: 先开入口再补鉴权（实测方便，但存在无名窗口，否）。

## 未决与验证清单

- **D9 的类型剥离**：实现首日验证 `node src/server/index.ts` 能否直接启动；不能则切 `tsx`。
- **D13 的 `node:sqlite`**：实现首日验证 `DatabaseSync` 可用（建表、插入、查询、WAL）；不通过则切 `better-sqlite3`。
- **D15 的模拟保真度**：Playwright WebKit 与真实 iOS Safari 的差异无法在本期消除；以「降级路径可用」作为对冲，真机行为记入已知未验证项。
- **Funnel 单向流在 3 分钟以上的长任务**是否会被中继断开：需实测（超时与重连策略在实现阶段定稿）。
