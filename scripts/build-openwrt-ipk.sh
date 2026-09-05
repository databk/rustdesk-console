#!/bin/bash
set -euo pipefail

SEA_DIR="${1:-dist-sea}"
VERSION="${2:?usage: build-openwrt-ipk.sh <sea_dir> <version> <arch> [out_dir]}"
ARCH="${3:?arch required (x86_64|aarch64)}"
OUT_DIR="${4:-.}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FILES_DIR="$SCRIPT_DIR/../openwrt/files"

if [ ! -d "$SEA_DIR" ]; then
  echo "ERROR: SEA dist directory '$SEA_DIR' not found" >&2
  exit 1
fi
if [ ! -x "$SEA_DIR/rustdesk-console" ]; then
  echo "ERROR: SEA executable '$SEA_DIR/rustdesk-console' not found" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

DATA="$WORK/data"
mkdir -p "$DATA/usr/lib/rustdesk-console" "$DATA/usr/bin" \
         "$DATA/etc/init.d" "$DATA/etc/rustdesk-console"

cp "$SEA_DIR/rustdesk-console" "$DATA/usr/lib/rustdesk-console/rustdesk-console"
chmod 0755 "$DATA/usr/lib/rustdesk-console/rustdesk-console"

if [ -d "$SEA_DIR/templates" ]; then
  cp -a "$SEA_DIR/templates" "$DATA/usr/lib/rustdesk-console/templates"
fi
if [ -d "$SEA_DIR/node_modules" ]; then
  cp -a "$SEA_DIR/node_modules" "$DATA/usr/lib/rustdesk-console/node_modules"
fi

cat > "$DATA/usr/bin/rustdesk-console" <<'WRAPPER'
#!/bin/sh
exec /usr/lib/rustdesk-console/rustdesk-console "$@"
WRAPPER
chmod 0755 "$DATA/usr/bin/rustdesk-console"

cp "$FILES_DIR/rustdesk-console.init" "$DATA/etc/init.d/rustdesk-console"
chmod 0755 "$DATA/etc/init.d/rustdesk-console"

cp "$FILES_DIR/rustdesk-console.env" "$DATA/etc/rustdesk-console/rustdesk-console.env"
chmod 0644 "$DATA/etc/rustdesk-console/rustdesk-console.env"

CTRL="$WORK/control"
mkdir -p "$CTRL"

cat > "$CTRL/control" <<EOF
Package: rustdesk-console
Version: $VERSION
Architecture: $ARCH
Maintainer: databk <databk@users.noreply.github.com>
Section: net
Priority: optional
Depends: libc, libstdcpp, libgcc
Description: Enterprise-grade management platform for the RustDesk ecosystem.
 Self-hosted console as an alternative to RustDesk Server Pro.
 Ships prebuilt musl binaries (Node.js SEA + sqlite3 + sharp).
EOF

cat > "$CTRL/postinst" <<'EOF'
#!/bin/sh
mkdir -p /var/lib/rustdesk-console
exit 0
EOF
chmod 0755 "$CTRL/postinst"

cat > "$CTRL/prerm" <<'EOF'
#!/bin/sh
/etc/init.d/rustdesk-console stop 2>/dev/null || true
exit 0
EOF
chmod 0755 "$CTRL/prerm"

cat > "$CTRL/conffiles" <<'EOF'
/etc/rustdesk-console/rustdesk-console.env
EOF

printf '2.0\n' > "$WORK/debian-binary"

( cd "$DATA" && tar czf "$WORK/data.tar.gz" --owner=0 --group=0 --mtime=@0 . )
( cd "$CTRL" && tar czf "$WORK/control.tar.gz" --owner=0 --group=0 --mtime=@0 . )

OUT="$OUT_DIR/rustdesk-console_${VERSION}_${ARCH}.ipk"
( cd "$WORK" && tar czf "$OUT" --owner=0 --group=0 --mtime=@0 debian-binary control.tar.gz data.tar.gz )

echo "Built $OUT ($(du -h "$OUT" | cut -f1))"