#!/bin/bash
set -euo pipefail

SEA_DIR="${1:-dist-sea}"
VERSION="${2:?usage: build-openwrt-apk.sh <sea_dir> <version> <arch> [out_dir]}"
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

if ! command -v apk >/dev/null 2>&1; then
  echo "ERROR: 'apk' command not found. This script must run inside Alpine (apk-tools 3.x)." >&2
  exit 1
fi

APK_VERSION="${VERSION//-nightly./_p}"
APK_VERSION="${APK_VERSION}-r1"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PKGROOT="$WORK/pkgroot"
mkdir -p "$PKGROOT/usr/lib/rustdesk-console" "$PKGROOT/usr/bin" \
         "$PKGROOT/etc/init.d" "$PKGROOT/etc/rustdesk-console"

cp "$SEA_DIR/rustdesk-console" "$PKGROOT/usr/lib/rustdesk-console/rustdesk-console"
chmod 0755 "$PKGROOT/usr/lib/rustdesk-console/rustdesk-console"

if [ -d "$SEA_DIR/templates" ]; then
  cp -a "$SEA_DIR/templates" "$PKGROOT/usr/lib/rustdesk-console/templates"
fi
if [ -d "$SEA_DIR/node_modules" ]; then
  cp -a "$SEA_DIR/node_modules" "$PKGROOT/usr/lib/rustdesk-console/node_modules"
fi

cat > "$PKGROOT/usr/bin/rustdesk-console" <<'WRAPPER'
#!/bin/sh
exec /usr/lib/rustdesk-console/rustdesk-console "$@"
WRAPPER
chmod 0755 "$PKGROOT/usr/bin/rustdesk-console"

cp "$FILES_DIR/rustdesk-console.init" "$PKGROOT/etc/init.d/rustdesk-console"
chmod 0755 "$PKGROOT/etc/init.d/rustdesk-console"

cp "$FILES_DIR/rustdesk-console.env" "$PKGROOT/etc/rustdesk-console/rustdesk-console.env"
chmod 0644 "$PKGROOT/etc/rustdesk-console/rustdesk-console.env"

cat > "$WORK/post-install.sh" <<'EOF'
#!/bin/sh
mkdir -p /var/lib/rustdesk-console
exit 0
EOF
chmod 0755 "$WORK/post-install.sh"

cat > "$WORK/pre-deinstall.sh" <<'EOF'
#!/bin/sh
/etc/init.d/rustdesk-console stop 2>/dev/null || true
exit 0
EOF
chmod 0755 "$WORK/pre-deinstall.sh"

OUT="$OUT_DIR/rustdesk-console_${VERSION}_${ARCH}.apk"

apk mkpkg \
  -I name:rustdesk-console \
  -I "version:$APK_VERSION" \
  -I "description:Enterprise-grade management platform for the RustDesk ecosystem. (musl $ARCH binary)" \
  -I arch:noarch \
  -I origin:rustdesk-console \
  -I "maintainer:databk <databk@users.noreply.github.com>" \
  -I url:https://github.com/databk/rustdesk-console \
  -I "depends:libc" \
  -I "depends:libstdcpp" \
  -I "depends:libgcc" \
  -s "post-install:$WORK/post-install.sh" \
  -s "pre-deinstall:$WORK/pre-deinstall.sh" \
  -F "$PKGROOT" \
  -o "$OUT"

echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
