# 单容器镜像：Node 26 + 应用代码，非 root 运行。
FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    WORK_DIR=/workspace \
    PI_HOME=/data/pi

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY src ./src
COPY scripts ./scripts

RUN mkdir -p /data /workspace && chown -R 1000:10 /app /data /workspace

USER 1000:10
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server/index.ts"]
