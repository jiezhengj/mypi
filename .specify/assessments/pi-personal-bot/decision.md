# Decision: 基于 pi 的远程个人助理，值得进入规格阶段

- **Slug**: pi-personal-bot
- **Decided**: 2026-11-03
- **Verdict**: go
- **Artifacts reviewed**: intake.md ✅ | research.md ✅ | problem.md ✅ | concept.md ✅

## Scorecard

| Criterion | Rating | Justification |
| --- | --- | --- |
| Problem validity | strong | 「人不在家 = 失去 NAS 上 agent 的动手能力」是用户每天都能感知的切口，替代方案（远程桌面 / SSH 回 NAS）体验割裂且手机端几乎不可用；用户已经在用 Tailscale Funnel 把 CouchDB 暴露到公网，说明这不是空想需求而是他已有的实践习惯。 |
| Evidence strength | strong | 关键事实全部有一手来源或实测：pi 无 HTTP 服务模式（源码 `src/modes/` 只有四种 + cli.md）、内置工具集（`src/core/tools/` 实测目录）、无内置权限系统（官方三处声明）；连通性侧有 NAS 现场实测（Funnel 已启用、单请求额外 1.3–2.9 秒、仅 443/8443/10000）、Cloudflare 账户 `zones=[]`、官方文档对 Quick Tunnel/Vercel/ngrok 的硬限制。仍有少量未验证假设（SDK 进程内实测、镜像构建路径），已在 concept 的 Assumptions 中列明。 |
| Value vs. inaction | strong | 不作为的代价是明确的：出门即失去能力，已购置的 NAS 算力与 5.3TB 存储只在局域网内兑现。而作为的边际成本是「一个容器 + 一个访问入口」，没有新增订阅费。反向看，价值集中在单用户，因此衡量的是「自用是否值回几天工程投入」，答案偏向值。 |
| Feasibility / appetite | strong | Option A 的体量与用户「不设上限但要能持续迭代」的诉求匹配：第一期是数天量级可验收的闭环（远程对话 + 一次真实工具调用），而不是一次性产品。最大不确定性集中在镜像构建与鉴权实现，属可控工程量。 |
| Strategic fit | adequate | 项目尚未建立 Constitution，因此只能对齐 intake/research 阶段确立的自定目标：基于 pi、不买域名不租服务器、NAS 自持。三项均被 Option A 满足。Constitution 缺失是本次评分的扣分项，需在 Feature SDD 前补建。 |
| Risk posture | adequate | 主要风险已被识别且缓解手段具体：公网暴露 × 无权限系统 → 单令牌鉴权 + 容器隔离 + 挂载范围收敛 + 不给宿主 `~/.pi/agent`；客户端零安装导致入口面向公网全体 → 应用层门禁（限流、失败锁定、会话隔离）必须在规格里落成条款；跨境链路抖动 → 只保留单入口，延迟靠产品手段稀释；NAS 出网受限 → 镜像需代理构建或离线导入。扣分点在于这些缓解目前只是设计，尚未验证，且 `bash` 全开是显著残余风险。 |

## Verdict & Rationale

**go。** 证据强度达标（不是靠假设支撑），问题真实，且存在一个体量与诉求匹配的推荐选项（Option A：进程内跑 pi 内置能力 + 极薄服务 + 浏览器壳 + 双入口）。这个结论的关键不在于「技术上能不能做」——research 已经证明能做——而在于**边界是否可控**：能力等价（含 `bash`）与公网可达这两件事放在一起，安全边界必须由我们显式设计，而不是依赖 pi 或框架的默认值。

因此本次 go 附带一条硬性约束：**规格阶段必须把「谁能触发 agent」与「agent 能碰什么」写成可验证的验收条件**，而不是留到实现阶段靠自觉。若规格阶段发现这一层无法用简单手段收敛（例如容器逃逸面或鉴权实现成本超预期），退回 Option C（改用成熟产品）比硬扛更理性。

## Validation Record (2026-11-03，go 之后追加)

决策作出后，按要求在 NAS 上做了真实实施冒烟测试（代码在 `spike/`，镜像 `mypi-spike:0.1`，数据卷 `<NAS_DOCKER_DIR>/mypi/{workspace,sessions,pi}`）。结论**维持 go**，且证据从「文档推断」升级为「可复现实测」：

- 已证实：SDK 进程内常驻、真实工具执行（`bash` / `write` 副作用落盘）、SSE 流式、Bearer 鉴权在 LAN 与公网入口都生效、容器重启后会话续接、Funnel 与既有 CouchDB 共存且支持 SSE。
- 已证实（真实模型补测）：接入真实 OpenAI 兼容网关后，模型自主连续调用 `bash` / `read`，多轮上下文可凭历史回答；公网入口 + 真实模型同时成立。凭据以环境变量注入、由 `models.json` 的 `${PI_API_KEY}` 引用，不写入镜像与仓库。
- 已量化：LAN 请求 7–53ms；Funnel 请求 1.11–2.41s；Funnel 上 SSE 端到端 2.85s（服务端处理仅 101ms）；真实模型纯文本轮 TTFT 1.28–1.40s、两轮工具调用任务 TTFT 6.01s、公网入口 TTFT 3.04s；容器常驻 90MiB / 0.03% CPU；镜像 537MB。
- 已修正：pi 默认只激活 `read`/`bash`/`edit`/`write`，`grep`/`find` 需显式启用——「能力等价」的表述已同步收紧。
- 仍阻塞：从真正的异地客户端发起验收；以及单入口（Funnel）是 beta、带宽不可配、无来源 IP 限流能力带来的可用性与滥用风险。这两项不改变 go 的判断，但必须在规格阶段的验收条件里标成「待打通」。

## If go — Handoff to `$speckit-specify`

- **Problem**: 让跑在 NAS 上的 pi agent 的完整内置能力（读写、搜索、执行、会话分支与压缩、模型切换）不再被「必须在家、必须在终端前」绑定；在不买域名、不租服务器的前提下，从外网 Windows 设备驱动同一个 agent。
- **Chosen approach**: Option A —— 单 Node 容器内嵌 pi agent SDK，对外只暴露「发消息 / 流式回复 / 状态 / 中断」这一小组能力，工作目录挂载 NAS 卷，客户端为浏览器壳；**客户端零安装**，唯一入口是服务端侧的 Tailscale Funnel（公网 HTTPS），不采用需要客户端组网的 tailnet 直连——为后续 iOS/Android 客户端复用留出前提。
- **In scope**:
  - 单用户、单活跃会话的远程对话与流式输出。
  - pi 可启用内置工具（默认 `read` / `bash` / `edit` / `write`，按需启用 `grep` / `find`；`powershell` 不适用于 Linux 服务端）。
  - 会话续接、分叉、压缩、模型与思考等级切换。
  - 单一公网入口（服务端 Tailscale Funnel）；客户端只要求浏览器，不要求安装任何 VPN/组网客户端。
  - 应用层门禁：令牌鉴权、限流与失败锁定、会话隔离——单入口面向公网全体后，这层是唯一门禁。
  - 单令牌鉴权；容器工作目录限定在挂载卷内；凭据不进 agent 可读路径。
  - 会话持久化在 NAS 卷上，容器重建后可继续。
- **Out of scope**: 插件/扩展/skills/MCP 生态、多用户、IM 通道、手机原生客户端、Windows 本地文件执行、TUI 复刻、公网匿名访问、生产级监控告警与高可用、安装器与自动更新。
- **Success metrics**:
  - 非局域网的 Windows 设备上完成 ≥3 轮对话且 ≥1 次真实内置工具调用产生可验证副作用。
  - 未授权请求成功率 0%（一律 401/403）。
  - 首字延迟 P50 < 5 秒、P95 < 8 秒（单一公网入口、客户端零安装）。
  - 容器重建 / NAS 重启后原会话可继续。
- **Carried-forward open questions**:
  - [NEEDS CLARIFICATION: `bash` 与 `write` 的默认授权策略——「默认全开 + 容器边界」还是「默认只读、显式开启写与执行」？这是规格阶段第一条必须落定的验收条件。]
  - [已解决: 模型 provider 凭据路径——用真实网关补测通过；跨容器访问宿主机网关需走 `<DOCKER_BRIDGE_IP>`，凭据以环境变量注入并由 `models.json` 的 `${PI_API_KEY}` 引用，不进镜像与仓库。]
  - [已解决: 客户端不安装 Tailscale；唯一入口是服务端侧 Funnel，tailnet 直连不作为入口也不作为验收项。放弃「快入口 P50 < 2 秒」，接受 1–3 秒量级。]
  - [NEEDS CLARIFICATION: Funnel 是否再加一道前置认证；实测服务端 Bearer 令牌已能拦住公网未授权请求（401），但 Funnel 无法按来源 IP 限流。]
  - [NEEDS CLARIFICATION: 多会话边界——本期单活跃会话是否够用，还是规格阶段就要为「切换项目目录 / 多会话」留接口。]
  - [已解决: 镜像如何在 NAS 落地——`docker build --network host` + `HTTP(S)_PROXY=http://127.0.0.1:7890` 实测可行；bind mount 目录需先 `chown -R 1000:10`。]
