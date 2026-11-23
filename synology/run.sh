#!/bin/sh
# Launcher used by scripts/start-stop-status. Execs node so the recorded PID
# belongs to the server process itself.
set -eu

PKG_DIR=$(cd "$(dirname "$0")" && pwd)
VAR_DIR="${SYNOPKG_PKGVAR:-/var/packages/rustdesk-console/var}"

find_node() {
    for candidate in \
        /var/packages/Node.js_v20/target/usr/local/bin/node \
        /var/packages/Node.js_v20/target/bin/node \
        /var/packages/Node.js_v18/target/usr/local/bin/node \
        /var/packages/Node.js_v18/target/bin/node \
        /usr/local/bin/node \
        /usr/bin/node; do
        if [ -x "$candidate" ]; then
            echo "$candidate"
            return 0
        fi
    done
    return 1
}

if [ -f "$VAR_DIR/.env" ]; then
    set -a
    . "$VAR_DIR/.env"
    set +a
fi

NODE_BIN=$(find_node) || {
    echo "[run] Node.js runtime not found; install Node.js v20 from Package Center" >&2
    exit 1
}

export NODE_ENV="${NODE_ENV:-production}"
export DATA_DIR="${DATA_DIR:-$VAR_DIR}"
export PORT="${PORT:-3000}"

cd "$PKG_DIR"
exec "$NODE_BIN" dist/main.js
