# spike: pi 远程服务可行性验证

这是评估阶段的**一次性验证实现**，不是产品代码。它的作用是证明「NAS 上的容器里跑 pi agent、通过 HTTP/SSE 被远程驱动、工具真实执行、会话可持久化、鉴权有效」这条链路成立。

验证结论与实测数据记录在 [`../.specify/assessments/pi-personal-bot/research.md`](../.specify/assessments/pi-personal-bot/research.md) 的「现场验证」一节。

## 结构与职责

| 文件 | 作用 |
| --- | --- |
| `server.mjs` | 进程内创建 pi agent 会话，暴露 `POST /prompt`（SSE）、`GET /state`、`POST /abort`、`GET /health`，Bearer 令牌鉴权，并提供一个极简浏览器页面 |
| `mock.mjs` | 确定性「模型」：实现 OpenAI Chat Completions 流式协议，第一轮发起工具调用、第二轮汇总工具结果。用于在没有模型凭据时驱动真实的 agent 循环与真实工具执行 |
| `entrypoint.sh` | 可选启动 mock provider，再启动服务 |
| `Dockerfile` | Node 24 基线 + pi SDK 本地安装 |

## 在 NAS 上构建与运行

```bash
# 1. 构建（NAS 直连 Docker Hub 会因 IPv6 被重置，需走本机代理）
docker build --network host \
  --build-arg HTTP_PROXY=http://127.0.0.1:7890 \
  --build-arg HTTPS_PROXY=http://127.0.0.1:7890 \
  -t mypi-spike:0.1 .

# 2. 准备数据卷（Docker 会以 root 创建缺失的挂载点，必须先修正属主）
docker run --rm --user 0 -v <NAS_DOCKER_DIR>/mypi:/m alpine:3.20 \
  sh -c 'mkdir -p /m/pi /m/sessions /m/workspace && chown -R 1000:10 /m/pi /m/sessions /m/workspace'

# 3. 运行（host 网络，便于 Funnel 直接代理 127.0.0.1）
docker run -d --name mypi-spike --restart unless-stopped --network host --user 1000:10 \
  -e MYPY_TOKEN=<改成你自己的令牌> \
  -e MOCK_PROVIDER=1 -e MOCK_PORT=19999 \
  -e PI_BASE_URL=http://127.0.0.1:19999/v1 -e PI_PROVIDER=mock -e PI_MODEL=mock-agent \
  -v <NAS_DOCKER_DIR>/mypi/workspace:/workspace \
  -v <NAS_DOCKER_DIR>/mypi/sessions:/data/sessions \
  -v <NAS_DOCKER_DIR>/mypi/pi:/data/pi \
  mypi-spike:0.1
```

换成真实模型时：去掉 `MOCK_PROVIDER`，把 `PI_BASE_URL` / `PI_PROVIDER` / `PI_MODEL` 指向可用的 OpenAI 兼容端点，并通过 `PI_API_KEY` 传入凭据（`models.json` 会以 `${PI_API_KEY}` 引用，不会把密钥写进文件）。

## 临时开放公网入口（验证完请关闭）

```bash
docker exec tailscale tailscale funnel --bg --https=10000 http://127.0.0.1:8787
docker exec tailscale tailscale funnel --https=10000 off   # 关闭
```

## 已知边界

- 只验证了单活跃会话；`GET /state` 与 `/prompt` 是单会话串行语义。
- 浏览器页面是验证用的最小壳，没有登录流程、没有错误态、没有多会话。
