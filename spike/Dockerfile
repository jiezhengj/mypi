FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git ripgrep bash procps curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json /app/package.json
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund

COPY server.mjs /app/server.mjs
COPY mock.mjs /app/mock.mjs
COPY entrypoint.sh /app/entrypoint.sh
RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh

ENV PI_CODING_AGENT_DIR=/data/pi
ENV HOME=/data/pi
ENV MYPY_WORKDIR=/workspace
ENV MYPY_SESSION_DIR=/data/sessions

EXPOSE 8787
ENTRYPOINT ["/app/entrypoint.sh"]
