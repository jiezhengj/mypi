# Security & Access Checklist: 远程可达的个人 Agent

**Purpose**: 对「谁能触发、能碰什么、失败时怎么表现」这组需求的写法做质量审查——不是验证实现是否跑通，而是检查需求本身是否完整、清晰、可测。
**Created**: 2026-11-03
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [http-api.md](../contracts/http-api.md)

**Note**: 本清单由 `$speckit-checklist` 按安全与访问控制域生成。
**Review Ownership**: 由审阅者拥有。只有在审阅者确认该项的「需求质量」已达标时才标记 `[x]`。
**Marker Semantics**: `[x]` 表示需求质量达标，**不**表示实现完成。

## Requirement Completeness

- [ ] CHK001 是否为每一个 `/api/*` 接口明确了鉴权要求，并给出「允许匿名」的例外清单（若有）？ [Completeness, Spec §FR-002]
- [ ] CHK002 是否定义了令牌的完整生命周期——签发、使用、最近使用记录、吊销、以及泄漏后的处置？ [Completeness, Spec §FR-018/FR-019]
- [ ] CHK003 是否列出了审计必须覆盖的动作类型，并说明每类记录用于回答什么问题？ [Completeness, Spec §FR-008]
- [ ] CHK004 是否明确了 Agent 可访问的文件范围边界（工作目录、会话目录、以及明确排除的宿主路径）？ [Completeness, Spec §FR-009]

## Requirement Clarity

- [ ] CHK005 锁定规则中的「同一来源」是否被定义清楚——是来源 IP、设备令牌，还是二者组合？ [Ambiguity, Spec §SC-005]
- [ ] CHK006 「吊销后立即生效」中的「立即」是否被量化为可判定的时间点（例如「该设备的下一次请求」）？ [Clarity, Spec §FR-018]
- [ ] CHK007 「未授权响应不得泄露会话存在性」是否有可执行的判定标准（响应体、状态码、时序三个维度）？ [Measurability, Spec §FR-002]
- [ ] CHK008 限流阈值（每设备每分钟 60 次、每来源每分钟 120 次）是否写进了需求文档，而不是只存在于计划里？ [Clarity, Gap]

## Requirement Consistency

- [ ] CHK009 `401`（未认证）与 `403`（已吊销）的语义是否在所有接口与错误信封中保持一致？ [Consistency, Spec §FR-018]
- [ ] CHK010 「必须记录审计」与「不得记录令牌明文与完整正文」这两条约束是否互相覆盖、没有留下两难边界？ [Consistency, Spec §FR-008]
- [ ] CHK011 单活跃会话（FR-013）与跨设备可见同一会话（US3）之间，是否定义了状态竞争的语义（谁的状态为准）？ [Consistency, Spec §FR-013]

## Acceptance Criteria Quality

- [ ] CHK012 SC-002「未授权访问成功率为 0%」是否可以按可重放的方式验证（含负向用例集合）？ [Measurability, Spec §SC-002]
- [ ] CHK013 SC-005 的「20 次失败 / 15 分钟」在不同并发时序下是否仍产生唯一、可断言的期望结果？ [Measurability, Spec §SC-005]
- [ ] CHK014 SC-008 的「其他设备不受影响」是否有可观测指标，而不只是一句主观描述？ [Measurability, Spec §SC-008]

## Scenario Coverage

- [ ] CHK015 是否定义了令牌泄漏后的处置需求（吊销、审计回溯、是否通知其他设备）？ [Coverage, Gap]
- [ ] CHK016 是否定义了锁定期间用户的自救路径——能否解锁、如何解锁、需要等待多久？ [Coverage, Gap]
- [ ] CHK017 是否说明了服务重启对锁定计数与限流窗口的影响（清零是否可接受、为什么）？ [Coverage, Gap]
- [ ] CHK018 是否定义了多设备同时操作同一会话时的并发语义（第二个设备看到的「处理中」代表什么）？ [Coverage, Spec §FR-013]

## Edge Case Coverage

- [ ] CHK019 存储空间不足时「停止写入」的范围是否明确——会话、审计、令牌表三者是否都被覆盖？ [Edge Case, Spec §FR-017]
- [ ] CHK020 不可信内容在界面上的「标注」是否有可判定的标准（标注哪些元素、用什么形式、由谁决定）？ [Edge Case, Spec §FR-015]

## Non-Functional Requirements

- [ ] CHK021 审计数据的「无限期保留」与「可按时间/设备查询」是否同时被明确为需求？ [NFR, Spec §FR-016]
- [ ] CHK022 公网入口不可用时，用户能否明确区分「入口不可达」与「令牌失效」？ [NFR, Spec §Edge Cases]

## Dependencies & Assumptions

- [ ] CHK023 是否记录了「外部模型网关不可用或被滥用」的风险假设，并说明系统在其中的责任边界？ [Assumption, Gap]
- [ ] CHK024 是否说明了公网入口服务本身的可用性假设与降级预期（它并不是本项目能保证的部分）？ [Assumption, Gap]

## Ambiguities & Conflicts

- [ ] CHK025 是否存在与宪法原则 III「默认拒绝」相冲突的表述（例如任何隐含的匿名可用路径）？ [Conflict, Constitution §III]
- [ ] CHK026 是否存在与宪法原则 II「客户端零安装」相冲突的表述（例如任何要求客户端额外配置的默认路径）？ [Conflict, Constitution §II]

## Notes

- 检查方式：逐条对照 spec / plan / contracts，判断「需求写得是否够清楚、够完整、可被验证」。
- `[x]` 由审阅者填写；实现阶段的完成度另见 tasks.md 与 quickstart.md 的验证记录。
- 重点关注的已知薄弱点：CHK005（「同一来源」未定义）、CHK008（限流阈值仅存在于计划）、CHK019（存储满的写入范围）。
