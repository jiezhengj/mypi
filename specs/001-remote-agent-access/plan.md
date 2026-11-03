# Implementation Plan: 远程可达的个人 Agent

**Branch**: `001-remote-agent-access` | **Date**: 2026-11-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-remote-agent-access/spec.md`

## Summary

在 NAS 的单容器内常驻一个 Node 24 服务：进程内创建 pi agent 会话（官方 SDK，不经过 TUI 与 stdio 桥），对外只暴露「发消息 / 流式收回复 / 查询状态 / 中断 / 设备管理」一组 HTTP 能力；客户端是同源托管的无构建单页（浏览器即可，桌面与手机共用）。公网入口由服务端侧 Tailscale Funnel 提供，客户端零安装。安全门禁全部在应用层：每设备独立令牌（哈希存储、可单独吊销）、限流与失败锁定、动作审计、容器挂载范围收敛；不可信内容通过系统提示注入「资料非指令」规则并在界面标注。

## Technical Context

**Language/Version**: TypeScript 5.x，运行在 Node.js 24（利用原生类型剥离，无构建步骤；若剥离不可用则回退 `tsx`）

**Primary Dependencies**: `@earendil-works/pi-coding-agent`（锁定 `1.5.0`）、`express` 5.x（路由、SSE、静态资源）、`node:sqlite`（Node 24 内置，用于令牌与审计；不可用时回退 `better-sqlite3`）；无前端框架、无打包器

**Storage**: SQLite 数据库 `/data/mypi.db`（设备令牌表、审计事件表，WAL 模式）+ pi 会话 JSONL（`/data/sessions`）+ 工作目录（`/workspace`）

**Testing**: `node:test`（内置）做单元与契约测试；集成测试用真实 HTTP 起临时实例；SSE 事件解析用共享的契约解析器

**Target Platform**: Linux 容器（x86_64，NAS），Node 24 slim 基线镜像

**Project Type**: 单体 Web 服务（后端 + 同源静态客户端），单一可部署单元

**Performance Goals**: 服务端处理单次请求 < 1 秒（不含模型推理与公网往返）；端到端首字 P50 < 5 秒、P95 < 8 秒（SC-001）；常驻内存 < 256 MB；冷启动 < 3 秒

**Constraints**: 客户端不得依赖任何安装（含 VPN/组网客户端）；单一公网入口；单活跃会话；容器内只挂载专用卷；凭据不落盘明文；所有历史无限期保留、不自动清理

**Scale/Scope**: 单用户，≤ 10 台设备凭证，单活跃会话，9 条边界情况，19 条功能需求

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 方案如何满足 | 判定 |
| --- | --- | --- |
| **I. 能力来自 pi，不自研运行时** | 直接 `import` 官方 SDK 并锁定 `1.5.0`；工具集用 SDK 的 `tools` 参数显式声明，不实现任何工具执行器；会话持久化直接复用 `SessionManager`，不自定义会话格式 | PASS |
| **II. 零安装客户端，单一服务端入口** | 客户端是同源托管的 HTML+JS，只用浏览器原生 `fetch`/`ReadableStream`；不需要任何客户端软件；入口只有服务端 Funnel 一条 | PASS |
| **III. 暴露即攻击面（不可协商）** | 每设备令牌 + 每请求校验 + 限流 + 失败锁定 + 动作审计 + 挂载范围收敛；未授权一律 401 且响应不泄露会话信息；吊销即时生效 | PASS |
| **IV. 实证优先于推断** | 本计划中所有数字标来源：延迟/内存来自 2026-11-03 现场实测（见评估产物）；`quickstart.md` 的每条验证场景对应一个 SC，可重放 | PASS |
| **V. 最小可运维** | 单容器 + 3 个卷；SQLite 是嵌入在进程内的库（不是独立服务），没有额外常驻进程、没有网络端口；无消息队列、无外部缓存；回滚 = 换回上一个镜像 tag | PASS |

**Gate 结论**：无违反项，Phase 0 可以开始；无需 Complexity Tracking。

**Post-Design 复检**（Phase 1 完成后）：SQLite 以库的形式嵌入同一进程，未引入第二个常驻服务或网络依赖；认证链路是每请求一次本地索引查询（微秒级），未破坏原则 V；数据模型与契约未扩大攻击面。

## Project Structure

### Documentation (this feature)

```text
specs/001-remote-agent-access/
├── plan.md              # 本文件
├── spec.md              # 功能规格
├── research.md          # Phase 0：技术决策与备选
├── data-model.md        # Phase 1：实体、字段、状态转换
├── quickstart.md        # Phase 1：可重放的端到端验证手册
├── contracts/
│   └── http-api.md      # Phase 1：HTTP/SSE 契约
├── checklists/
│   └── requirements.md  # 规格质量清单
└── tasks.md             # Phase 2 输出（由 $speckit-tasks 生成）
```

### Source Code (repository root)

```text
src/
├── server/
│   ├── index.ts             # 进程入口：装配依赖、启动监听、优雅退出
│   ├── app.ts               # Express 应用：中间件顺序、路由挂载、静态资源
│   ├── config.ts            # 环境变量解析与启动期校验（缺关键配置即失败）
│   ├── routes/
│   │   ├── health.ts        # GET /healthz
│   │   ├── session.ts       # POST /api/messages（SSE）、POST /api/abort、GET /api/state
│   │   ├── devices.ts       # GET/POST/DELETE /api/devices
│   │   └── audit.ts         # GET /api/audit
│   ├── middleware/
│   │   ├── auth.ts          # 设备令牌校验与吊销判定
│   │   ├── rate-limit.ts    # 滑动窗口限流 + 连续失败锁定
│   │   ├── audit.ts         # 动作审计落盘
│   │   └── errors.ts        # 统一错误信封与状态码映射
│   ├── agent/
│   │   ├── agent-service.ts # 单活跃会话封装：创建、串行队列、中断、状态
│   │   ├── resource-loader.ts # DefaultResourceLoader + 不可信内容规则注入
│   │   └── events.ts        # SDK 事件 → SSE 事件的映射与动作摘要提取
│   ├── store/
│   │   ├── db.ts            # SQLite 连接、WAL、建表迁移、事务封装
│   │   ├── device-store.ts  # 令牌表：哈希、标签、最近使用、吊销
│   │   └── audit-store.ts   # 审计事件写入与查询
│   └── util/
│       ├── sse.ts           # SSE 帧编码、心跳、客户端断开处理
│       └── tokens.ts        # 令牌生成与哈希
├── client/
│   ├── index.html           # 单页壳
│   ├── app.js               # 无构建：SSE 解析、状态渲染、设备管理
│   └── styles.css           # 响应式（桌面 + 手机）
└── shared/
    └── contracts.ts         # 服务端与客户端共用的 SSE 事件类型与错误码

tests/
├── contract/                # SSE 事件与错误码契约
├── integration/             # 起真实实例：鉴权、限流、会话恢复、中断
└── unit/                    # 令牌哈希、限流窗口、事件映射

scripts/
├── token-add.mjs            # 运维：签发某设备的令牌（容器内执行）
├── token-list.mjs           # 运维：列出设备与最近使用
└── token-revoke.mjs         # 运维：吊销某设备
```

**Structure Decision**: 单项目结构（后端 + 同源静态客户端同仓同镜像），因为产品是单用户单容器；不拆前后端工程、不引入打包器，避免为「网页」引入构建链。`scripts/` 放运维小工具，不进运行时镜像的启动路径。

## Complexity Tracking

无违反宪法项，无需登记。
