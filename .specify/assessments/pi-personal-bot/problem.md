# Problem Definition: 让 pi 的完整本地能力不再被「坐在 NAS 前」绑住

- **Slug**: pi-personal-bot
- **Created**: 2026-11-03
- **Inputs used**: intake.md + research.md + 用户本轮口述（能力边界＝pi 内置能力，不含第三方插件）

## Problem Statement

用户已经有一台常年在线、带 5.3TB 存储和 15GB 内存的 NAS，也已经在用它跑各类常驻服务，但「一个能读写文件、能搜索、能执行命令、能分叉和压缩会话的 pi agent」目前只能在 NAS 本机的终端里、或局域网内的机器上使用；一旦人离开家，这份动手能力就断了。用户要在**不买域名、不租服务器**的前提下，从外网 Windows 设备上驱动同一个 agent，并且**远程可用的能力集合要与 pi 自带的能力集合等价**——但不需要把 pi 的插件/扩展生态一并搬上网。

## Affected Users & Stakeholders

- **Users**: 项目所有者本人（单用户）——在家里用 Windows 电脑工作，出门、通勤或出差时需要让 NAS 上的 agent 继续替他读文件、查代码、跑命令、接着之前的会话往下做。
- **Stakeholders**: 项目所有者本人（同时是决策者、运维者、唯一受益人）——他承担 NAS 的电力与硬盘成本、承担「把服务暴露到公网」的后果，也是唯一能接受或否决安全取舍的人。

## Goals

- **G1 异地可达**：在任何非家庭网络环境下，用 Windows 设备能连上 NAS 上的 agent 并正常对话。
- **G2 能力等价**：远程可达的能力集合等于 pi 的**可启用内置工具集**（默认激活 `read` / `bash` / `edit` / `write`，可按需启用 `grep` / `find`；`powershell` 仅 Windows 运行时有意义）、会话能力（续接、分叉、回退、压缩）、模型与思考等级切换；不依赖安装任何第三方插件或扩展。
- **G3 安全可控**：服务被公网触达时，未授权者不能驱动 agent；能触发破坏性操作的入口有明确边界，且安全取舍是显式记录的决定，而不是默认放行。
- **G4 运维最小**：单个容器即可部署；NAS 重启后服务自恢复；会话落在持久化卷上，不因容器重建丢失。
- **G5 延迟可接受**：在快入口（tailnet 直连）下交互接近本地终端体验；慢入口（Funnel）可用但明确标注为降级。

## Non-Goals

- 不做插件 / 扩展 / skills / MCP 的安装、分发与市场（用户本轮明确：不要求像完整 pi CLI 那样装插件）。
- 不做多用户、多租户、团队协作与账号体系——单用户单会话即满足。
- 不做 IM 通道接入（Telegram / Discord / Slack 等）。
- 不复刻 TUI 的交互细节（主题、快捷键、状态栏、鼠标操作）。
- 不做手机原生客户端（本轮验收只要求 Windows）。
- 不提供匿名或公开访问——任何入口都必须鉴权。
- 不做 Windows 客户端的安装器工程、自动更新、代码签名。
- 不在本期追求 7×24 生产级 SLA、监控告警体系与高可用。

## Success Metrics

- 在**非家庭局域网**的 Windows 设备上完成一次端到端验收：≥3 轮对话且 ≥1 次真实内置工具调用产生可验证的副作用（例如写入/修改一个文件、执行一条命令并拿到输出）。（baseline: 2026-11-03 已在容器侧用 mock 模型跑通 bash 与 write 的真实副作用；**真实模型**与**真正的非局域网 Windows 客户端**尚未验收）
- 鉴权穿透：未授权请求成功率 0%（所有未携带有效凭证的请求返回 401/403）。（baseline: 已实测 LAN 与 Funnel 两条路径均返回 401；实现后仍需回归）
- 快入口首字延迟 P50 < 2 秒；慢入口（Funnel）P50 < 5 秒。（baseline: 实测 LAN `/health` 7–53ms、Funnel `/health` 1.11–2.41s、Funnel 上 SSE 端到端 2.85s，模型首 token 时间未测）
- 服务端容器重建 / NAS 重启后，原会话可继续（消息历史不丢失）。（baseline: 已实测容器 restart 后同一 `sessionId` 恢复，`messages` 7 → 15）
- 安全边界：容器内可写范围限定在挂载的工作目录内；宿主 `~/.pi/agent` 与个人凭据不在 agent 可读路径内。（baseline: 已实测工具副作用只落在 `/workspace` 挂载卷；宿主配置通过独立 `/data/pi` 卷隔离，未见越界写入）

## Cost of Inaction

- 继续依赖「在家才能用」：出门后要么远程桌面/SSH 回 NAS（体验割裂、手机端几乎不可用），要么干脆不用。
- 已有的 Tailscale 组网与 Funnel 入口能力闲置，NAS 的算力与存储只在家庭局域网内兑现价值。
- 用户在 OpenClaw 等现成产品与自建之间持续摇摆，而现成产品的定位是通用产品，无法按自己的安全边界与工作目录裁剪。

## Open Questions

- [NEEDS CLARIFICATION: 内置工具全部放开（含 `bash`）是默认值，还是把 `bash` 与 `write` 设为需要显式开启的能力？这决定「能力等价」与「公网暴露」的张力如何落地。]
- [NEEDS CLARIFICATION: 模型 provider 凭据如何进入容器（NAS 侧配置 provider key / 云端 key / 其他）——这是当前唯一**阻塞真实模型验收**的问题：实测 NAS 上的 Magpie 网关没有可用 gateway key，Windows 本机的 Magpie 只监听 `127.0.0.1`，且 NAS 的 sshd 处于 `AllowTcpForwarding no`，反向借用本机网关也不成立。]
- [NEEDS CLARIFICATION: Windows 是否安装 Tailscale 客户端以启用「快入口」？本机未装，因此 tailnet 直连的延迟与稳定性尚未验证；若不装，则只剩 Funnel 这一条 1–2.4 秒的路径。]
- [NEEDS CLARIFICATION: 会话并发边界——同一时间只服务一个活动会话即可，还是需要客户端切换多个项目目录/会话？本次只验证了单活跃会话。]
- [NEEDS CLARIFICATION: Funnel 这个「应急入口」是否需要前置第二道认证。实测表明服务端 Bearer 令牌已能在公网入口拦住未授权请求（401），但 Funnel 只提供 HTTPS 端口，无法按来源 IP 限流或封禁。]
