# Idea Research: 基于 pi 的个人 Agent（NAS 服务端 + Windows 客户端 + 异地可达）

- **Slug**: pi-personal-bot
- **Created**: 2026-11-03
- **Evidence confidence（整体）**: high（NAS 现场实测 + pi 官方仓库文档 + 各服务官方文档；未知项已单列）

## Users & Demand

- 需求来源是单用户（项目所有者本人），属于 **stated want**，没有观察到的使用行为数据。价值假设是「自己的机器上有一个随叫随到、能动手的助理」——[ASSUMPTION]（confidence: low）
- 同类产品的市场信号很强，说明「个人 agent/常驻助手」是被验证的方向：OpenClaw 393,796★、pi 119,696★、happy 24,464★、OpenHands 92,547★ — [来源: gh repo view 各仓库]（confidence: high）
- 但「异地访问自家 agent」是这类产品的共性刚需，成熟产品都把它当一等功能内置，而不是让用户自己解决：OpenClaw 原生支持 Tailscale/SSH 远程与设备配对；happy 走端到端加密 relay；vibe-kanban 自带 relay-tunnel / relay-ws / relay-hosts — [来源: https://github.com/OpenClaw/OpenClaw、https://github.com/slopus/happy、https://github.com/BloopAI/vibe-kanban]（confidence: high）
- 用户已经在实际做「把家内服务暴露到公网」这件事：NAS 上的 Tailscale Funnel 当前已开启，公网 `https://<TAILNET_HOST>:8443` 指向本机 CouchDB — [来源: 现场 `ssh nas` 实测 `tailscale funnel status`]（confidence: high）

## Prior Art

- **OpenClaw（最贴近的先例）**：Gateway 守护进程（WS，默认 `127.0.0.1:18789`）+ Control UI + Tauri v2 桌面（Linux/Windows）+ 20+ IM 通道 + 设备配对 + Tailscale/SSH 远程。关键事实：它**已经把 agent runtime 自研分叉**，只剩 `@earendil-works/pi-tui` 一个三方依赖，文档原文「OpenClaw owns the built-in agent runtime」「No external agent framework packages remain」「The legacy alias `pi` normalizes to `openclaw`」 — [来源: https://github.com/OpenClaw/OpenClaw/blob/main/docs/agent-runtime-architecture.md]（confidence: high）
- **pi-chat**：pi 扩展形态，Discord/Telegram 桥，每个通道一个 Gondolin micro-VM，依赖 QEMU + tmux。形态与「NAS Docker + Windows 客户端」正交，且最后 push 2026-06-05（近 5 个月停更）→ 可读参考，不可直接复用 — [来源: https://github.com/earendil-works/pi-chat]（confidence: high）
- **happy**：CLI + relay server（E2E 加密）+ iOS/Android/web + Electron 桌面。印证「daemon + 中继 + 多端」，且把异地访问交给加密中继而非 VPN — [来源: https://github.com/slopus/happy、https://github.com/slopus/happy-desktop]（confidence: high）
- **vibe-kanban**：Rust 单仓，`server` + `local-web` + `remote-web` + `tauri-app` + `relay-tunnel / relay-webrtc / relay-ws / relay-hosts` + Dockerfile。架构与「一套后端、本地/远程两套入口、自带中继」最接近 — [来源: https://github.com/BloopAI/vibe-kanban]（confidence: high）
- **本项目内部无先例**：仓库初始化前只有 `.gitattributes`，无历史 spec、无既往实现 — [来源: 本仓库 git 历史]（confidence: high）

## Market & Context

- 用户今天替代方案的实际成本很低（手机端订阅 App、Telegram bot、远程桌面、Tailscale、云 VM），所以本项目的差异化只能是「自己的机器、自己的文件、自己的模型额度」——[ASSUMPTION]（confidence: medium）
- 「不买域名、不租服务器」在技术上不是阻碍，主流免费路径共四条，各自代价不同（详见 Data & Constraints）：Tailscale tailnet（要装客户端、但不慢）、Tailscale Funnel（免装客户端、但实测慢）、Cloudflare Workers/DO 自建中继（免装客户端、固定 URL、但要自己写且长连会被周期性掐断）、Cloudflare Quick Tunnel（官方定性为测试用，实际上不可用于产品）— [来源: 见 Data & Constraints 各项]（confidence: high）
- 真实跨境质量是隐性成本：同一台 NAS 上 `curl https://github.com` 8 秒超时，必须走本机 mihomo `127.0.0.1:7890` 才 200；而 Tailscale 控制面 302、Cloudflare `region1.v2.argotunnel.com:7844` TCP 可达 — [来源: 现场实测]（confidence: high）
- 「客户端必须装软件」在这类产品里是常态而非缺陷：OpenClaw 桌面端 + 移动端、happy 多端 App 都是如此 — [来源: 上列仓库]（confidence: high）

## Data & Constraints

### 服务端硬件与环境（现场实测，`ssh nas`，只读）

- <NAS_MODEL>，Linux 6.18.15，x86_64，4 核 / 15GiB 内存 / 5.3TB 可用磁盘，Docker 29.6.2 + Compose v5.1.3 — [来源: 现场 `nproc / free -h / df -h / docker info`]（confidence: high）
- 宿主 `node v18.20.4`，**低于 pi 要求的 Node ≥ 22.19** → 必须用容器镜像自带 Node（官方 Dockerfile 基线 `node:24-bookworm-slim`）— [来源: 现场 `node -v`；https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/containerization.md]（confidence: high）
- 网络条件意外有利：公网 IPv4 `<PUBLIC_IPV4>`、`MappingVariesByDestIP=false`（非对称 CGNAT）、UPnP/NAT-PMP/PCP 全可用、有公网 IPv6 `<PUBLIC_IPV6>` — [来源: 现场 `tailscale netcheck`、`ip -6 addr`]（confidence: high）
- 已装并常驻 `cloudflared`？**没有**（`which cloudflared` 空）— [来源: 现场实测]（confidence: high）

### 连通性候选（官方文档 + 实测）

- **Cloudflare 命名隧道被硬约束排除**：发布应用时的公网主机名必须从账户里已有的 domain 里选（`you must add a website to Cloudflare`）；本机 Cloudflare 账户 `cf zones list` 返回 `[]`（无任何 zone）— [来源: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/；现场 `cf zones list`]（confidence: high）
- **Cloudflare Quick Tunnel 不可用于产品**：无 uptime 保证、hostname 每次重建都变、每隧道最多 200 在途请求（超出 429）、**不支持 SSE**、停止进程即失效 — [来源: https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/#limitations]（confidence: high）
- **Cloudflare 私网路线（Tunnel + Cloudflare One Client/WARP）不需要自有域名**：用 CIDR 路由把内网段接进 Zero Trust，客户端装 WARP 并配 Split Tunnels；代价是多一套组网客户端 — [来源: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/private-net/cloudflared/connect-cidr/]（confidence: high；免费席位上限「50 用户」为社区口径，confidence: medium）
- **Workers + Durable Objects 自建 WS 中继**：`*.workers.dev` 子域免费且无需自有域名，但官方定性为 `intended for personal or hobby projects that aren't business-critical`；Free 计划 100,000 请求/天、每请求 10ms CPU、**同时未响应的出站连接最多 6 个**、WebSocket 支持；DO Free 用 SQLite 后端，100,000 请求/天 + 13,000 GB-s/天，入站消息按 20:1 折算、出站不计费、用 Hibernation 才不按连接时长计费；**Workers runtime 例行更新会终止旧版本上的所有连接（最多 20 分钟 drain）** — [来源: https://developers.cloudflare.com/workers/platform/limits/、https://developers.cloudflare.com/durable-objects/platform/pricing/、https://developers.cloudflare.com/workers/configuration/routing/workers-dev/]（confidence: high）
- **Tailscale Personal $0，6 用户、设备不限**，100.x / MagicDNS 均可用 — [来源: https://tailscale.com/pricing，现场 `tailscale status`]（confidence: high）
- **Tailscale Funnel 免域名（用 `*.ts.net`）也免客户端**：仅 443/8443/10000 三个端口、仅 TLS、**带宽限制不可配置**、官方标注 **beta**；NAS 侧已经启用，公网回环 `http=401`（CouchDB 鉴权页）证明链路真实可达，但**单请求额外 1.3–2.9 秒**（本地基线 2.8ms），`Self.Relay=sfo`、最近 DERP 为 lax 144ms — [来源: https://tailscale.com/docs/features/tailscale-funnel；现场实测]（confidence: high）
- **Vercel 不能做持久中继**：Hobby 函数最大时长 300s、无常驻进程、WS 连接活到函数上限即断、实例不保证复用、body 4.5MB — [来源: https://vercel.com/docs/functions/limitations、https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections]（confidence: high）
- **ngrok 免费版**：1 GB/月出站、20,000 请求/月、1 个固定 dev 域名、HTML 流量带 interstitial — [来源: https://ngrok.com/docs/pricing-limits/free-plan-limits]（confidence: high）

### pi 作为底座的能力边界（官方仓库文档）

- pi v1.5.0（2026-11-02 发布），`engines` 全为 `>=22.19.0`，MIT，提供 linux-x64/arm64 与 windows 二进制 — [来源: https://github.com/earendil-works/pi/releases/tag/v1.5.0、各包 package.json]（confidence: high）
- **没有 `serve` / `--port` / HTTP 模式**：只有 interactive / print / json / rpc 四种模式，其中只有 RPC 是长驻双向，且**传输是 stdin/stdout 的 JSONL**，网络服务层必须自己写 — [来源: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli.md、.../docs/rpc.md]（confidence: high）
- RPC 工程约束：严格 JSONL（不可用 Node `readline`）、stdout 专供协议、必须持续读 stdout 否则反压卡死、命令异步需用 `id` 关联、`prompt` 只表示已排队、要等 `agent_settled`；一个进程同时只有**一个活动会话** — [来源: .../docs/rpc.md、.../docs/rpc-commands.md]（confidence: high/medium）
- TypeScript SDK 是**进程内**集成（`createAgentSession` / `SessionManager` / `AgentSessionRuntime`），**不含任何 HTTP/WS/鉴权**；pi 只是 MCP 客户端，不能把 pi 本身当 MCP server 暴露 — [来源: .../docs/sdk.md、.../docs/mcp.md]（confidence: high）
- 会话持久化是「一会话一 JSONL」，默认 `~/.pi/agent/sessions/`，可用 `--session-dir` 指到 NAS volume — [来源: .../docs/sessions.md]（confidence: high）
- **chord 能提供 HTTP+WS 层、默认拒绝、Cookie 签名、CSP nonce、fetch metadata 校验、device pairing、sessions、分片上传、workers、web surface、热重载**，并自带一个可跑通的聊天样板 `test/examples/59-chat`；代价是接受其 contract/plugin 编程模型，且**反代/隧道场景下必须声明 `relays`/`hosts` 白名单否则 403**；隧道后所有远程客户端共用同一地址，`pairingsPerAddress=10` 会被打满并锁死远端配对 — [来源: .../packages/chord/src/node/http/README.md、.../src/node/app/README.md、.../test/examples/59-chat]（confidence: high）
- `pi-durable` 提供事务性持久化会话、可恢复任务、`watch()` 结构化视图与断线重连语义（`ConversationTranscript.merge()`），存储后端含 SQLite/JSONL/DO；但 README 首行即 `Experimental. The API changes without notice between releases.` — [来源: .../packages/durable/README.md]（confidence: high）
- **pi 有两个引擎且不可二合一**：`pi-coding-agent`（生态最全，只有 stdio）vs `pi-durable`（持久化+同步原语，Experimental、无 coding-agent 的 extensions/skills/MCP 生态）— [来源: 两者 README]（confidence: high）
- **pi 没有内置权限系统**：README「does not include a built-in permission system for restricting filesystem, process, network, or credential access」；security.md「does not ask for approval before every tool call」且「lack of a built-in sandbox ... outside the security boundary`；`project trust` 只管启动时加载哪些项目资源，明确「does not limit what tool calls can access」— [来源: https://github.com/earendil-works/pi、.../docs/security.md]（confidence: high）
- Windows 客户端侧：WebView2 Runtime 已随 Windows 11 内置，Windows 10 绝大多数设备已装，缺失时约 2MB bootstrapper 可补 → Tauri v2 壳的安装成本很低 — [来源: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution]（confidence: high）

## 现场验证（2026-11-03 实现冒烟测试，非纸面推演）

在 NAS 上真实构建并运行了一个最小服务（`spike/`，Node 24 容器 + pi SDK 进程内会话 + SSE + Bearer 令牌），用确定性 mock provider 驱动真实 agent 循环，验证结果如下。**所有数字均为现场实测**。

### 已验证成立

- **SDK 可在容器内常驻并驱动会话**：`createAgentSession()` 成功，日志 `session ready` + `tools: read,bash,edit,write`，无 TUI、无 stdio 桥。→ concept 的 A 方案可行，不必走 RPC 子进程桥。
- **会话落盘并可跨容器重启续接**：`/data/sessions/*.jsonl`（session-format v3）挂 NAS 卷；`docker restart` 后 `continueRecent` 恢复同一 `sessionId`，`messages` 从 7 → 15 连续增长，历史未丢。
- **真实工具执行**：`bash` 工具在容器内执行并返回 `Linux 6.18.15 x86_64`；`write` 工具写出 `/workspace/note.txt`，在 NAS `<NAS_DOCKER_DIR>/mypi/workspace/` 可见。工具副作用真实落到挂载卷。
- **令牌鉴权有效**：LAN 与公网（Funnel）两条路径上，未携带 token 的 `POST /prompt` 均返回 `401`；携带正确 token 正常返回 SSE。
- **Funnel 支持 SSE 且可与既有服务共存**：在同一 Tailscale 实例上新增 `--https=10000` 指向本服务，`8443 → CouchDB` 不受影响；流式事件逐个到达，服务端处理 101ms、客户端总耗时 2853ms。
- **延迟量级**：`GET /health` 五次，LAN（<LAN_IP>）7–53ms；Funnel（`<TAILNET_HOST>:10000`）1.11–2.41s。与 research 阶段测得的 1.3–2.9s 同量级，跨境中继成本被再次证实。
- **资源占用可忽略**：容器常驻 CPU 0.03%、内存 90MiB；镜像 537MB。

### 实测推翻/修正的旧认知

- **pi 内置工具不是「8 个全默认可用」**。`defaultTools` 官方默认只有 `read`、`bash`、`edit`、`write` 四个；`grep`、`find`、`powershell` 属于「可用但需显式启用」。源码里的 `ls.ts` 未出现在官方可用工具列表中。→ 后续规格里「能力等价」必须写成「等价于 pi 的可启用内置工具集」，而不是「默认就是全部」。
- **启用 grep/find 的有效方式是显式传 SDK `tools` 数组**：实测 `tools: ["read","bash","edit","write","grep","find"]` 后 `getActiveToolNames()` 返回 6 项；仅靠 agent 目录 `settings.json` 的 `defaultTools` 在本次实验中未能让运行中的服务生效（同一进程内新建会话可生效，长期常驻进程需重启或显式传参）。

### 新增的部署约束（实现阶段必须面对）

- **镜像构建需要代理**：NAS 直连 Docker Hub 会因 IPv6 链路被重置而失败，需 `docker build --network host` + `HTTP(S)_PROXY=http://127.0.0.1:7890`（或预拉基础镜像）。
- **bind mount 目录属主问题**：Docker 会以 root 创建缺失的挂载点目录，容器以 `--user 1000:10` 运行时会 `EACCES`；需先用 root 容器 `chown -R 1000:10`（或镜像内 entrypoint 做 PUID 初始化）。
- **NAS 端口 9999 已被占用**（mock provider 首跑 `EADDRINUSE`），选端口不能假设默认值可用。
- **NAS 的 sshd 配置 `AllowTcpForwarding no`**：反向 SSH 隧道不可用，这会排除「把本机资源反向借给 NAS」一类实现路径。
- **NAS 上 `scp`/sftp 不可用**（`dest open ... No such file or directory`），文件传输需 `tar` + base64 over `ssh`。

### 仍未验证（明确列为缺口）

- **tailnet 直连延迟**：Windows 本机未安装 Tailscale，无法从「非 tailnet 成员」验证；该项仍是 A 方案主链路的核心未知。
- **真实模型下的行为**：本次用确定性 mock provider，验证的是管道与工具，不是模型质量、工具选择能力或 token 成本。NAS 上的 Magpie 网关没有可用的 gateway key，Windows 本机的 Magpie 只监听 127.0.0.1。
- **多会话 / 多设备并发**：只验证了单活跃会话。

## Evidence Against the Idea

- **安全模型与「公网可达」直接冲突（最强反驳）**：pi 无权限系统、不逐次确认、无内置沙箱，官方把「prompt injection from untrusted content」列为超出安全边界；一旦服务端被公网触达，「谁能让它读到文本」就等于「谁能在 NAS 上执行命令」 — [来源: .../docs/security.md]（confidence: high）
- **「无域名 + 免装客户端 + 低延迟」三者不可兼得（本想法最核心的可行性风险）**：实测 Funnel 免装但每次请求多 1.3–2.9 秒；Workers 中继免装且 URL 固定但长连会被 runtime 更新周期性掐断、还有 6 并发上限；Quick Tunnel 官方直接排除（无 SSE、URL 每次变）；等，见 Market & Context — [来源: 现场实测 + 上列官方文档]（confidence: high）
- **必须做一个架构承诺且选错要重写**：stdio RPC 桥 vs 进程内 SDK vs chord app kit 三条路，各自决定传输层与状态管理形态；不存在官方「二合一」— [来源: 上列 pi 文档]（confidence: high）
- **最成功的先例反而放弃了 pi runtime**：OpenClaw 已自研分叉，只保留 pi-tui，说明把 pi 当长期依赖的适配成本不低 — [来源: OpenClaw `docs/agent-runtime-architecture.md`]（confidence: high）
- **自建中继的维护成本被两个成熟项目主动规避**：OpenClaw 推荐 Tailscale/VPN/SSH 并另写 exposure-runbook；happy 用托管 relay；chord 直接把反代/隧道场景标为一等约束 — [来源: 上列仓库文档]（confidence: high）
- **Funnel 本身是 beta 且带宽不可配**；且当前配置把 CouchDB 直接暴露到公网（401 之外无额外认证层），说明「暴露即安全自负」已经是现实风险 — [来源: https://tailscale.com/docs/features/tailscale-funnel；现场实测]（confidence: high）
- **MVP 极易膨胀成 OpenClaw 复刻**：对标产品已有 20+ 通道、多端、沙箱、插件生态；单用户自用在范围控制得当的前提下可行，但只要开始做「产品」就会出现范围失控 — [来源: OpenClaw 仓库]（confidence: medium）
- **跨境链路质量不稳**：同机 `curl github.com` 8s 超时、需代理才 200；Tailscale 控制面与 argotunnel 数据面当前可达，但不等于长连接长期稳定 — [来源: 现场实测]（confidence: high）

## Gaps & Open Questions

- [NEEDS CLARIFICATION: 主链路选哪条——「Windows 装 Tailscale 走 tailnet 直连」（稳、快、要装客户端）还是「免装客户端的 Funnel」（慢 1.3–2.9s）？这决定客户端的网络前提。]
- [NEEDS CLARIFICATION: 服务端要不要给 bash / 写文件能力？只读问答与可执行助理是两种安全边界与两种容器形态。]
- [NEEDS CLARIFICATION: 引擎路线选 `pi-coding-agent`（RPC 桥或进程内 SDK）还是 chord app kit？前者代码少但功能自己长，后者功能多但系统形状被锁定。]
- [NEEDS CLARIFICATION: 第一期客户端是否可以只是「浏览器壳 / Edge --app 指向服务端页面」？若不接受，需要额外承担 Tauri 壳成本。]
- [NEEDS CLARIFICATION: 是否确认单用户单会话即可？多会话/多设备会引入权限与并发设计。]
- [NEEDS CLARIFICATION: MVP 验收标准的具体形式（例如：在外网环境完成一次多轮对话 + 一次工具调用，端到端首字延迟上限多少秒）。]
- [NEEDS CLARIFICATION: Cloudflare Zero Trust Free 的席位上限、Funnel 的实际带宽上限，官方均无可引用定论，只能按「够个人用」假设推进。]

## Sources

- https://github.com/earendil-works/pi（host: github.com，policy: allowlisted）
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md（host: github.com，policy: allowlisted）
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md（host: github.com，policy: allowlisted）
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md（host: github.com，policy: allowlisted）
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/containerization.md（host: github.com，policy: allowlisted）
- https://github.com/earendil-works/pi/blob/main/packages/chord/src/node/app/README.md（host: github.com，policy: allowlisted）
- https://github.com/earendil-works/pi/blob/main/packages/durable/README.md（host: github.com，policy: allowlisted）
- https://github.com/OpenClaw/OpenClaw/blob/main/docs/agent-runtime-architecture.md（host: github.com，policy: allowlisted）
- https://github.com/slopus/happy、https://github.com/BloopAI/vibe-kanban、https://github.com/earendil-works/pi-chat（host: github.com，policy: allowlisted）
- https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/（host: developers.cloudflare.com，policy: confirmed-by-user）
- https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/（host: developers.cloudflare.com，policy: confirmed-by-user）
- https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/private-net/cloudflared/connect-cidr/（host: developers.cloudflare.com，policy: confirmed-by-user）
- https://developers.cloudflare.com/workers/platform/limits/（host: developers.cloudflare.com，policy: confirmed-by-user）
- https://developers.cloudflare.com/durable-objects/platform/pricing/（host: developers.cloudflare.com，policy: confirmed-by-user）
- https://developers.cloudflare.com/workers/configuration/routing/workers-dev/（host: developers.cloudflare.com，policy: confirmed-by-user）
- https://tailscale.com/pricing、https://tailscale.com/docs/features/tailscale-funnel（host: tailscale.com，policy: confirmed-by-user）
- https://vercel.com/docs/functions/limitations（host: vercel.com，policy: confirmed-by-user）
- https://ngrok.com/docs/pricing-limits/free-plan-limits（host: ngrok.com，policy: confirmed-by-user）
- https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution（host: learn.microsoft.com，policy: confirmed-by-user）
- 现场实测：`ssh nas`（<NAS_MODEL>）只读命令 `docker inspect tailscale`、`tailscale status`、`tailscale funnel status`、`tailscale netcheck`、`ip -6 addr`、`curl` 计时（未改动任何容器与配置）
- 本地实测：`cf auth whoami`、`cf zones list`、`cf tunnels list`、`cf docs search`、`vercel whoami`
