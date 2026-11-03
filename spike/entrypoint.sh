#!/bin/sh
set -e

if [ "${MOCK_PROVIDER:-0}" = "1" ]; then
  node /app/mock.mjs &
  sleep 0.5
fi

exec node /app/server.mjs
