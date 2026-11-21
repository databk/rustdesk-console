#!/bin/sh
# fnOS Docker 合并版入口：同容器内拉起 hbbs + hbbr + console（NestJS）
# 数据统一挂在 /opt/rustdesk-console -> /data，目录结构：
#   /data             console 数据（SQLite 等，DATA_DIR）
#   /data/hbbs        hbbs 工作目录（id_ed25519 密钥 + 数据库）
#   /data/hbbr        hbbr 工作目录（无状态）
#   /data/credentials 持久化的 JWT_SECRET（console 与 hbbs 管理 API 共用）

ROOT="/data"
HBBS_DIR="${ROOT}/hbbs"
HBBR_DIR="${ROOT}/hbbr"
CREDENTIALS_FILE="${ROOT}/credentials"

mkdir -p "${HBBS_DIR}" "${HBBR_DIR}"

# JWT_SECRET：优先取环境变量，其次读持久化文件，最后生成并持久化
if [ -z "${JWT_SECRET:-}" ]; then
  if [ -f "$CREDENTIALS_FILE" ]; then
    . "$CREDENTIALS_FILE"
  else
    JWT_SECRET="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
    printf 'JWT_SECRET=%s\n' "$JWT_SECRET" > "$CREDENTIALS_FILE"
    chmod 600 "$CREDENTIALS_FILE"
  fi
fi
export JWT_SECRET

# hbbs/hbbr 管理 API：console 与 hbbs 共用 JWT_SECRET 作为管理 token
export RD_MANAGEMENT_TOKEN="$JWT_SECRET"
export RD_MANAGEMENT_BIND="0.0.0.0:21120"
export RD_MANAGEMENT_DIR="$ROOT"
export RD_HBBS_API_URL="http://127.0.0.1:21120"

# hbbs/hbbr 需要往 $HOME/.config/rustdesk 写配置（id 等）；显式指到数据目录
export HOME="$ROOT"

export NODE_ENV=production
export HOST=0.0.0.0
export PORT="${PORT:-3000}"
export DB_TYPE=sqlite
export DATA_DIR="${ROOT}"

HBBS_ARGS=""
[ -n "${RELAY_ADDRESS:-}" ] && HBBS_ARGS="-r ${RELAY_ADDRESS}"

# ── 启动 hbbs（ID/发现服务器，管理 API 21120）──
cd "$HBBS_DIR"
/usr/local/bin/hbbs -p 21116 $HBBS_ARGS &
HBBS_PID=$!

# ── 启动 hbbr（中继服务器）──
cd "$HBBR_DIR"
/usr/local/bin/hbbr -p 21117 &
HBBR_PID=$!

# ── console 数据库迁移（可选）──
cd /app
if [ "${DB_MIGRATE_ON_START:-1}" = "1" ]; then
  node dist/main.js migrate || echo "[entrypoint] migrate failed (continuing)"
fi

# ── 前台运行 console，信号转发给子进程 ──
node dist/main.js &
CONSOLE_PID=$!

trap 'kill -TERM $HBBS_PID $HBBR_PID $CONSOLE_PID 2>/dev/null; exit 0' TERM INT
trap 'kill -TERM $HBBS_PID $HBBR_PID $CONSOLE_PID 2>/dev/null' EXIT

wait "$CONSOLE_PID"
