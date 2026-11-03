# 部署与运维

本文只写流程与占位符。真实地址、容器名之外的拓扑、密钥一律写在本机的 `.git/info/private-patterns.txt` 与环境变量里，不进版本库。

## 前置条件

- 一台常开的家庭服务器（NAS 或小主机），已装 Docker 与 Docker Compose。
- 一个 OpenAI 兼容的模型网关，能从该服务器容器内访问。
- 服务器与手机在同一局域网；跨网访问由 Funnel 承担，不由本项目实现。

## 构建镜像

在源码根目录：

```bash
docker build -t mypi:latest .
```

镜像以 `1000:10` 非 root 运行，构建阶段只安装生产依赖。

## 准备持久化目录

推荐把数据放在 NAS 的 docker 卷目录下，例如 `<NAS_DOCKER_DIR>/mypi`：

```bash
sudo mkdir -p <NAS_DOCKER_DIR>/mypi/data <NAS_DOCKER_DIR>/mypi/workspace
sudo chown -R 1000:10 <NAS_DOCKER_DIR>/mypi
```

`data` 存 SQLite 数据库与会话文件，`workspace` 是 Agent 的工作目录；两者都必须挂载，否则重启即丢。

## 运行容器

```bash
docker run -d --name mypi \
  --restart unless-stopped \
  -p <LAN_IP>:8080:8080 \
  -v <NAS_DOCKER_DIR>/mypi/data:/data \
  -v <NAS_DOCKER_DIR>/mypi/workspace:/workspace \
  -e PI_BASE_URL=http://<DOCKER_BRIDGE_IP>:3425/v1 \
  -e PI_PROVIDER=magpie \
  -e PI_MODEL=<NAS_MODEL> \
  -e PI_API_KEY=<REDACTED_KEY> \
  mypi:latest
```

- `PI_API_KEY` 只以环境变量传入，容器内写出的 `models.json` 里只有 `${PI_API_KEY}` 引用。
- 不要加 `--network host`：默认 bridge 网络下容器仍可通过 `<DOCKER_BRIDGE_IP>` 访问宿主上的网关。
- 端口绑定到内网地址而不是 `0.0.0.0`，除非你确认 Funnel 侧的鉴权已就位。

## 签发第一台设备

```bash
docker exec mypi node scripts/token-add.mjs --label phone
```

输出的令牌只显示一次，立刻存到手机浏览器的登录框里。

## 健康检查与日常操作

```bash
curl -s http://<LAN_IP>:8080/healthz
docker exec mypi node scripts/token-list.mjs
docker exec mypi node scripts/token-revoke.mjs --id dev_xxxxxxxx
docker logs --tail 100 mypi
```

## 升级与回滚

```bash
docker build -t mypi:<new-tag> .
docker stop mypi && docker rename mypi mypi-old
docker run -d --name mypi ... mypi:<new-tag>
```

升级前先备份 `<NAS_DOCKER_DIR>/mypi/data`。回滚就是把 `mypi-old` 重新启起来；数据库迁移只做加法，旧版本可以读新库。

## 跨网访问

Funnel 常开属于产品状态，不是测试动作。暴露之前必须确认：

1. 设备令牌鉴权与频率限制已生效（`/api/state` 无令牌返回 401）。
2. 外网地址只指向本服务，不代理同宿主上的其他容器。
3. CI 的外部检查在工作流里跑通，且日志里看不到任何真实地址。

宿主上已有别的服务占用常见端口时，换一个宿主端口并在 Funnel 侧单独开一个入口，不要去抢既有服务的端口：

```bash
# 容器侧换宿主端口（示例 8088）
docker run -d ... -p 8088:8080 ...

# Tailscale Funnel 增加一个独立入口（443 / 8443 / 10000 是可用端口）
docker exec <TAILSCALE_CONTAINER> tailscale funnel --bg --https=10000 http://127.0.0.1:8088
docker exec <TAILSCALE_CONTAINER> tailscale funnel status
```

公网地址形如 `https://<TAILNET_DOMAIN>:10000`，用下面的命令自检：

```bash
curl -s https://<TAILNET_DOMAIN>:10000/healthz
curl -s -o /dev/null -w '%{http_code}\n' https://<TAILNET_DOMAIN>:10000/api/state   # 期望 401
```

## 已知边界

- 本服务不提供账号体系，一台设备一个令牌；吊销立即生效。
- 同一时刻只允许一个正在执行的回合；并发请求返回 `busy`。
- 移动端真机（iOS Safari 流式、软键盘遮挡）不在自动化验收范围内，见 `specs/001-remote-agent-access/quickstart.md` 的「已知未验证项」。
