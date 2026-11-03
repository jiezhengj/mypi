mypi 是一个跑在家里服务器上的个人 Agent：能力全部来自 [pi](https://github.com/earendil-works/pi) SDK，你只需要一个浏览器——手机、平板、另一台电脑都行——就能继续同一个会话。

# 它解决什么问题

把 Agent 装在常开的机器上，用任何一台设备通过浏览器接着聊。没有客户端要装，没有账号体系要维护；一台设备一个令牌，吊销即刻生效。

# 组成

- **服务端**：Node 24+、Express 5、`node:sqlite`。单进程，SQLite 存设备令牌与审计，会话文件由 pi SDK 管理。
- **客户端**：`src/client` 里的三个静态文件，无构建步骤。SSE 增量渲染，流断了会退回到轮询补齐。
- **Agent**：`@earendil-works/pi-coding-agent`，显式开启 `read` `bash` `edit` `write` `grep` `find` 六个工具。

```
浏览器 ──HTTPS/SSE──> 入口 ──> mypi 容器 ──> pi SDK ──> 模型网关
                                    │
                                    └── /data（SQLite + 会话）、/workspace（工作目录）
```

# 快速开始

```bash
docker build -t mypi:latest .
docker run -d --name mypi --restart unless-stopped \
  -p <LAN_IP>:8080:8080 \
  -v <NAS_DOCKER_DIR>/mypi/data:/data \
  -v <NAS_DOCKER_DIR>/mypi/workspace:/workspace \
  -e PI_BASE_URL=http://<DOCKER_BRIDGE_IP>:3425/v1 \
  -e PI_PROVIDER=magpie -e PI_MODEL=<NAS_MODEL> -e PI_API_KEY=<REDACTED_KEY> \
  mypi:latest
docker exec mypi node scripts/token-add.mjs --label phone
```

把打印出来的令牌粘进浏览器登录框即可。完整步骤见 [docs/deploy.md](docs/deploy.md)。

# 安全边界

- 除 `GET /healthz` 与静态资源外，所有接口都要 `Authorization: Bearer <device token>`；服务端只存 SHA-256 哈希与前缀。
- 同一来源 15 分钟内 20 次认证失败即锁定 15 分钟；按设备 60 次/分钟、按 IP 120 次/分钟限流。
- 审计只追加，记录认证、消息、工具动作、设备变更与移动端探测；不记录令牌与完整正文。
- 工具读到的内容在界面上标注为「不可信资料」，系统提示里也明确资料不是指令。

# 开发

```bash
npm install
npm test          # 单元 + 契约 + 集成，共 56 个用例
npm run check     # tsc --noEmit
npm run dev       # 需要 DATA_DIR / WORK_DIR / PI_* 环境变量
```

移动端模拟验收（需要 Playwright 浏览器）：

```bash
MYPI_BASE_URL=http://<LAN_IP>:8080 MYPI_TOKEN=<token> npm run test:mobile
```

# 文档

- 规格、计划与任务：[specs/001-remote-agent-access](specs/001-remote-agent-access)
- 设计取舍与研究记录：[research.md](specs/001-remote-agent-access/research.md)
- 验收步骤与已知未验证项：[quickstart.md](specs/001-remote-agent-access/quickstart.md)
- 外网可达性检查：`.github/workflows/external-check.yml`（手动触发）

# 已知边界

- 同一时刻只跑一个回合，并发请求返回 `busy`；中断后可以继续下一轮。
- 真机 iOS Safari 的流式渲染与软键盘遮挡不在自动化验收范围内。
- 本项目只提供入口，不负责域名、证书与跨网隧道本身的配置。
