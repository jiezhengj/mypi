# Tasks: 远程可达的个人 Agent

**Input**: Design documents from `/specs/001-remote-agent-access/`

**Prerequisites**: [plan.md](./plan.md)、[spec.md](./spec.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/http-api.md](./contracts/http-api.md)

**Tests**: 包含。本 Feature 的验收依赖实测证据（宪法原则 IV），因此单元 / 契约 / 集成测试都列为任务；每个用户故事的集成测试对应 quickstart 里的验证场景编号。

**Organization**: 按用户故事分组，便于独立实现与独立验证。顺序为 P1 → P2 → P3，之后是横切的凭证管理与收尾。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无前置依赖）
- **[Story]**: 所属用户故事（US1/US2/US3）；横切任务不带该标签
- 每条任务都写明目标文件路径

## Path Conventions

单项目结构（plan.md 的 Structure Decision）：`src/`、`tests/`、`scripts/` 位于仓库根。

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 项目骨架、依赖、运行环境能力验证

- [ ] T001 初始化 `package.json`：`"type": "module"`、`engines.node >= 24`、scripts（`dev`/`start`/`test`/`check`），锁定 `express@5`、`@earendil-works/pi-coding-agent@1.5.0`（不用 `^`），文件：`package.json`
- [ ] T002 [P] 建立目录骨架与 `tsconfig.json`（`noEmit` 仅做类型检查）：`src/server/{routes,middleware,agent,store,util}`、`src/client`、`src/shared`、`tests/{unit,contract,integration}`、`scripts`
- [ ] T003 验证运行时能力（research D9/D13）：Node 24 能否直接运行 `.ts`、`node:sqlite` 的 `DatabaseSync` 是否可用；把结论写回 `research.md` 的「未决与验证清单」，不通则切 `tsx` / `better-sqlite3`
- [ ] T004 [P] 编写 `Dockerfile`（`node:24-bookworm-slim`、非 root `uid 1000`、`HEALTHCHECK` 打 `/healthz`）与 `.dockerignore`
- [ ] T005 [P] `src/server/config.ts`：解析并校验环境变量，缺 `PI_API_KEY`/`PI_BASE_URL` 等关键项时启动即失败；日志不得打印敏感值
- [ ] T006 [P] 测试基座：`tests/unit/smoke.test.ts` 跑通 `node --test`，确认 `npm test` 不依赖网络

**Checkpoint**: `npm test` 能跑、容器能构建、`node:sqlite` 与 TS 运行方式有明确结论

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 任何用户故事都依赖的基础设施：存储、鉴权、限流、审计、SSE、Agent 封装

**⚠️ CRITICAL**: 本阶段完成前，用户故事不能开始

- [ ] T007 `src/server/store/db.ts`：SQLite 连接、`WAL`、`user_version` 迁移、事务封装；测试 `tests/unit/db.test.ts`（临时文件）
- [ ] T008 `src/server/store/device-store.ts`：`create`/`findByHash`/`list`/`revoke`/`touch`；测试 `tests/unit/device-store.test.ts`
- [ ] T009 [P] `src/server/util/tokens.ts`：32 字节随机 + base64url、sha256、定长比较、前 8 位前缀；测试 `tests/unit/tokens.test.ts`
- [ ] T010 [P] 运维脚本 `scripts/token-add.mjs`、`scripts/token-list.mjs`、`scripts/token-revoke.mjs`（首台设备引导用，直接操作 SQLite，不经过 HTTP）
- [ ] T011 [P] `src/shared/contracts.ts`：SSE 事件类型、错误码常量、请求/响应 DTO——服务端与客户端的唯一真相
- [ ] T012 `src/server/middleware/errors.ts`：统一错误信封、404/500 映射，响应不得含内部路径或上游原文；测试 `tests/unit/errors.test.ts`
- [ ] T013 `src/server/middleware/auth.ts`：解析 `Bearer`、按哈希查库、区分 `401 unauthorized` 与 `403 revoked`、更新 `last_used_at`、写审计；集成测试 `tests/integration/auth.test.ts`（对应 V1、SC-002）
- [ ] T014 `src/server/middleware/rate-limit.ts`：滑动窗口（来源 IP 15 分钟 20 次失败 → 锁定 15 分钟；设备 60 次/分钟；IP 120 次/分钟），时间源可注入；测试 `tests/unit/rate-limit.test.ts`（对应 V7、SC-005）
- [ ] T015 `src/server/store/audit-store.ts` + `src/server/middleware/audit.ts`：事件写入（`detail` ≤ 200 字符、无明文无正文）、查询；测试 `tests/unit/audit-store.test.ts`
- [ ] T016 `src/server/util/sse.ts`：SSE 帧编码、15 秒心跳、客户端断开清理；测试 `tests/unit/sse.test.ts`
- [ ] T017 `src/server/agent/resource-loader.ts`：`DefaultResourceLoader` + `appendSystemPromptOverride` 注入「工具内容=资料非指令」规则（FR-015）；测试 `tests/unit/resource-loader.test.ts` 断言规则出现在 `session.systemPrompt`
- [ ] T018 `src/server/agent/agent-service.ts`：pi 会话创建、单活跃状态机（idle/running/interrupted）、`409 busy`、`abort`、状态查询；测试 `tests/unit/agent-service.test.ts`
- [ ] T019 `src/server/agent/events.ts`：SDK 事件 → SSE 事件（`status`/`action`/`delta`/`done`/`error`），动作摘要截断 200 字符；测试 `tests/unit/events.test.ts`
- [ ] T020 `src/server/app.ts` + `src/server/index.ts`：中间件顺序（鉴权 → 限流 → 审计 → 业务）、静态资源、`GET /healthz`、优雅退出；集成测试 `tests/integration/app-boot.test.ts`

**Checkpoint**: 服务能起、未授权一律 401、锁定生效、SSE 能发帧——用户故事可以开始

## Phase 3: User Story 1 - 异地用浏览器接着用我的 Agent (Priority: P1) 🎯 MVP

**Goal**: 在任意设备的浏览器里完成多轮对话、看到真实工具动作与流式输出、能中断。

**Independent Test**: 按 quickstart V2/V3/V5 跑通：≥3 轮对话 + 1 次可验证副作用 + 一次中断。

### Tests for User Story 1

- [ ] T021 [P] [US1] `tests/contract/sse-events.test.ts`：事件顺序与字段（`status` → `action`* → `delta`+ → `done`）、错误事件形状（对应 V2）
- [ ] T022 [P] [US1] `tests/integration/us1-chat.test.ts`：真实工具副作用——让 agent 在工作目录写文件，断言磁盘内容与回复一致（对应 V3、SC-004）
- [ ] T023 [P] [US1] `tests/integration/us1-abort.test.ts`：中断后状态回 `idle` 且可继续下一轮（对应 V5、FR-006）

### Implementation for User Story 1

- [ ] T024 [US1] `src/server/routes/session.ts`：`GET /api/state`、`GET /api/messages?limit=`
- [ ] T025 [US1] `src/server/routes/session.ts`：`POST /api/messages` SSE 主流程（`409 busy` 立即拒绝、模型失败映射 `503`/`504`）
- [ ] T026 [US1] `src/server/routes/session.ts`：`POST /api/abort`（幂等 `202`）
- [ ] T027 [US1] `src/client/index.html` + `src/client/styles.css`：响应式布局、令牌录入、消息列表、输入框、中断按钮（FR-011）
- [ ] T028 [US1] `src/client/app.js`：`fetch` + `ReadableStream` 解析 SSE、增量渲染、动作条目、错误提示、`localStorage` 存令牌
- [ ] T029 [US1] 串联校验：手动跑 V2，确认首字 < 5 秒（SC-001）并把实测值记入 quickstart 验证记录

**Checkpoint**: MVP 成立——家外浏览器能对话、能改文件、能中断

## Phase 4: User Story 2 - 会话不因服务重启而丢失 (Priority: P2)

**Goal**: 重启后历史完整、可基于上文继续。

**Independent Test**: quickstart V4：重启前后 `activeSessionId` 一致、`messageCount` 不减。

### Tests for User Story 2

- [ ] T030 [P] [US2] `tests/integration/us2-restart.test.ts`：重启后会话恢复、`recovered: true`（对应 V4、SC-003）

### Implementation for User Story 2

- [ ] T031 [US2] `src/server/agent/agent-service.ts`：启动时 `SessionManager.continueRecent(cwd, sessionDir)` 恢复最近会话，并在 `/api/state` 暴露 `recovered`
- [ ] T032 [US2] `src/server/agent/agent-service.ts`：会话文件不可读时的降级——新建会话、`recovered: false`、写审计，不得静默从零开始

**Checkpoint**: 重启不再丢上下文

## Phase 5: User Story 3 - 单个活跃会话，跨设备一致 (Priority: P3)

**Goal**: 设备 B 能看到设备 A 的对话与「处理中」状态。

**Independent Test**: 两个设备令牌先后读同一会话，状态与历史一致。

### Tests for User Story 3

- [ ] T033 [P] [US3] `tests/integration/us3-multi-device.test.ts`：两个令牌并发读 `/api/state` 与 `/api/messages`，断言 `sessionId` 与 `messageCount` 一致

### Implementation for User Story 3

- [ ] T034 [US3] `src/server/routes/session.ts`：`/api/state` 暴露 `status`/`startedAt`/`lastError`，供其他设备判断「正在处理」（FR-013、US3 场景 2）
- [ ] T035 [US3] `src/client/app.js`：页面加载时先拉 `state`，`running` 时显示「正在处理中」而非空状态

**Checkpoint**: 三个故事各自可独立验证

## Phase 6: 凭证管理（横切：FR-018、FR-019）

**Purpose**: 让「设备丢了」从全局重置降级为单点吊销

- [ ] T036 `src/server/routes/devices.ts`：`GET/POST/DELETE /api/devices`，`POST` 仅本次返回明文令牌
- [ ] T037 [P] `tests/integration/devices.test.ts`：吊销后下一次请求 `403`、其他设备不受影响（对应 V8、SC-008）
- [ ] T038 `src/client/app.js` + `src/client/index.html`：设备面板——列表（标签/创建/最近使用）、签发、吊销二次确认

**Checkpoint**: V8 通过

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T039 `src/server/routes/audit.ts`：`GET /api/audit?limit`（倒序、`limit` 上限 200）
- [ ] T040 [P] 移动端实测：iOS Safari 的 `ReadableStream` 行为（V10、SC-006）；不可用则降级为「SSE + 断线重连轮询」，并把结论写回 `research.md`
- [ ] T041 [P] 性能测量（V11、SC-001）：重复 5 次记录「请求 → 首个 `delta`」，把 P50/P95 填入 quickstart 验证记录
- [ ] T042 安全加固复查：响应头（`nosniff`、`frame-ancestors`、`referrer-policy`）、CSP、`/healthz` 不含会话信息、日志不打印令牌
- [ ] T043 [P] 运维文档占位：`docs/deploy.md`（卷、入口、回滚、备份=复制 `mypi.db`），全部使用占位符
- [ ] T044 [P] 依赖审计：`npm audit`（或等价）结果记录；无高危项才继续
- [ ] T045 全量验证：按 quickstart V1–V11 演练并填完验证记录表
- [ ] T046 收尾：清理临时文件、补 `.env.example`（占位值）、确认 `node scripts/secret-scan.mjs --all` 通过

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖，可立即开始；T003 的结论决定 T001 的启动脚本形态
- **Foundational (Phase 2)**: 依赖 Setup，**阻塞所有用户故事**
- **User Stories (Phase 3–5)**: 都依赖 Foundational；US1 → US2 → US3 按优先级顺序推进
- **凭证管理 (Phase 6)**: 依赖 T013（鉴权已可用）；可与 US2/US3 并行
- **Polish (Phase 7)**: 依赖全部用户故事完成

### User Story Dependencies

- **US1 (P1)**: 只依赖 Foundational，独立可交付（MVP）
- **US2 (P2)**: 依赖 Foundational；复用 US1 的 `/api/state` 字段，但不改其契约
- **US3 (P3)**: 依赖 Foundational 与 US1 的 `/api/messages`；只扩展状态字段

### Within Each User Story

- 测试先写并确认失败，再实现
- 存储 → 服务 → 路由 → 客户端 → 联调
- 每个故事结束停一次，按 quickstart 对应场景验证后再进下一个

### Parallel Opportunities

- Phase 1：T002、T004、T005、T006 可并行（T003 先跑定结论）
- Phase 2：T009、T010、T011 可并行；T007 是 T008/T012 的前置
- Phase 3：T021/T022/T023 三个测试文件可并行
- Phase 6：T037 可与 T036 并行（不同文件）
- Phase 7：T040、T041、T043、T044 可并行

## Parallel Example: User Story 1

```bash
# 三个测试文件互不冲突，可同时写
Task: "tests/contract/sse-events.test.ts — 事件顺序与字段"
Task: "tests/integration/us1-chat.test.ts — 真实工具副作用"
Task: "tests/integration/us1-abort.test.ts — 中断后恢复"
```

## Implementation Strategy

### MVP First（只做 US1）

1. Phase 1 + Phase 2 完成（基础设施，不可省）
2. Phase 3 完成
3. **停下来验证**：quickstart V2/V3/V5
4. 此时已经能「家外用浏览器干活」，可以先部署给自己用

### Incremental Delivery

1. 基础就绪 → 2. US1（可异地对话）→ 3. US2（重启不丢）→ 4. US3（多设备一致）→ 5. 凭证管理 → 6. 收尾

每个增量都独立可验证，且不破坏前一个增量。

## Notes

- `[P]` 任务之间不同文件、无前置；带依赖的任务已在描述里点明
- 服务器侧的所有写操作都要经 `src/shared/contracts.ts` 的类型约束，避免契约漂移
- 每完成一个 Phase 提交一次，提交前由 pre-commit 扫描拦截敏感信息
- 验证记录写在 quickstart.md 的表格里，不另建台账（宪法：最小可运维）
