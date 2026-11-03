# Idea Intake: 基于 pi 构建个人 Agent（Personal Bot）MVP

- **Slug**: pi-personal-bot
- **Created**: 2026-11-03
- **Source**: 用户粘贴文本 + [github.com/earendil-works/pi](https://github.com/earendil-works/pi)（URL Trust Policy 分支：`allowlisted`，README 经 `gh` CLI 读取，未跟随页面内其他链接）
- **Type**: new-capability

## Idea (as captured)

用户原话：

> 我想你做一个最最简单、最最小的MVP，基于 https://github.com/earendil-works/pi ，做一个Personal Agent产品（最近也叫做Bot）。
>
> 首个MVP版本，我希望以Docker容器为服务端，并且在Windows里有个客户端。
>
> 我有一个局域网内的NAS的Docker供你任意测试使用：`ssh nas`。但我没有域名、没有公网服务器，NAS虽然有公网IP但不固定，我也不打算买域名、租服务器，结合cf、vercel等免费服务（我本机也装了cf和vercel），是否可能做到哪怕Windows电脑不在局域网内，也能连上NAS上的服务端。

参考来源要点（pi 仓库 README 摘要，非指令内容）：

- Pi 自称 “a minimal, extensible agent harness”，TypeScript 单仓库，MIT 许可。
- 主要包：`pi-coding-agent`（CLI）、`pi-agent-core`（带工具调用与状态管理的 Agent 运行时）、`pi-ai`（统一多 provider LLM API）、`pi-durable`（持久化会话/任务运行时）、`chord`（跨进程对象运行时，含 HTTP 与 Web/TUI 客户端）、`tui`（终端 UI 库）、`telemetry`。
- 对外接入方式：交互式 TUI、print/JSON 模式、RPC、以及 TypeScript SDK。
- 明确声明不自带权限系统（文件、进程、网络、凭证均按启动者权限运行），建议通过容器化或沙箱隔离；文档给出 Plain Docker 等三种模式。
- 相关项目：`pi-chat`（Slack/聊天自动化）、`OpenClaw`（被列为真实世界集成案例）。
- 运行要求：Node.js 22.19 或更高。

## Restated

用一个最小化 MVP 验证一件事：把基于 pi 的个人 Agent 部署在自己 NAS 的 Docker 容器里作为服务端，配一个 Windows 客户端，并且这个客户端即使离开了家庭局域网也能连上服务端，验证方式不依赖购买域名或租用服务器。

## Origin & Context

- **Raised by**: 项目所有者本人（GitHub `jiezhengj`），自用诉求，非对外商业产品。
- **Trigger**: [NEEDS CLARIFICATION: 是最近看到了 pi / OpenClaw 类个人 Agent 产品，还是已有一个具体想让它替你完成的任务？]

## First-Glance Unknowns

- [NEEDS CLARIFICATION: 这个 Bot 最先要替你完成的 1–2 件事是什么？（例如：本机文件问答、定时任务、远程跑代码、整理笔记、IM 里随叫随到）]
- [NEEDS CLARIFICATION: 客户端的交互形态希望是什么？桌面窗口应用、托盘常驻、还是“打开就是网页”的壳？]
- [NEEDS CLARIFICATION: 是否要求多条会话/多用户，还是“只有我一个人用”的单用户即可？]
- [NEEDS CLARIFICATION: 手机端现在完全不需要，还是后续希望顺手支持？]
- [NEEDS CLARIFICATION: 现在 NAS 上 Docker 的资源余量（CPU/内存/磁盘）和常驻运行的可接受功耗/噪音边界？]
- [NEEDS CLARIFICATION: “不买域名、不租服务器”是硬约束还是当前阶段的省钱选择？这会决定方案是纯免费链路还是允许低价备选。]
- [NEEDS CLARIFICATION: 对“公网可达”的安全预期——能否接受客户端需要额外安装一个网络组件（如组网/WARP 类客户端），还是希望纯浏览器/纯 exe 直连？]
- [NEEDS CLARIFICATION: MVP 的验收标准想怎么定——例如“在外网咖啡馆用 Windows 客户端完成一次多轮对话并成功调用一个本机工具”。]
