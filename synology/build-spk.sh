#!/usr/bin/env bash
# Assemble a Synology SPK. Runs on the CI runner (x86_64 Linux, GNU tar).
# Requires: artifacts/ downloaded from the build jobs, env VERSION, ARCH_NAME,
# ARCH_INFO (Synology platform codes for the INFO file).
set -euo pipefail

: "${VERSION:?}"
: "${ARCH_NAME:?}"
: "${ARCH_INFO:?}"

case "$ARCH_NAME" in
  x86_64) BACKEND_ARTIFACT=backend-x64 ;;
  armv8)  BACKEND_ARTIFACT=backend-arm64 ;;
  *) echo "unsupported ARCH_NAME: $ARCH_NAME" >&2; exit 1 ;;
esac

BACKEND_TGZ="artifacts/${BACKEND_ARTIFACT}/${BACKEND_ARTIFACT}.tar.gz"
FRONTEND_DIR="artifacts/frontend-dist"
test -f "$BACKEND_TGZ" || { echo "missing $BACKEND_TGZ" >&2; exit 1; }
test -f "$FRONTEND_DIR/index.html" || { echo "missing frontend dist" >&2; exit 1; }

SPK_DIR=".spk-${ARCH_NAME}"
rm -rf "$SPK_DIR"
mkdir -p "$SPK_DIR"

# ── SPK 控制文件 ──
cp synology/INFO "$SPK_DIR/INFO"
cp -r synology/scripts synology/conf "$SPK_DIR/"
cp synology/PACKAGE_ICON.PNG synology/PACKAGE_ICON_256.PNG "$SPK_DIR/"
sed -i -e "s/^version=.*/version=\"${VERSION}\"/" \
       -e "s/^arch=.*/arch=\"${ARCH_INFO}\"/" "$SPK_DIR/INFO"

# ── 应用负载（解压到 /var/packages/rustdesk-console/target）──
mkdir -p "$SPK_DIR/package"
tar xzf "$BACKEND_TGZ" -C "$SPK_DIR/package"
cp -r "$FRONTEND_DIR" "$SPK_DIR/package/public"
cp synology/run.sh "$SPK_DIR/package/run.sh"
chmod 755 "$SPK_DIR/package/run.sh"

APP_VERSION="$VERSION" SOURCE_COMMIT="${GITHUB_SHA:-unknown}" node -e '
  require("fs").writeFileSync(
    process.argv[1],
    JSON.stringify({version: process.env.APP_VERSION, sourceCommit: process.env.SOURCE_COMMIT})
  )' "$SPK_DIR/package/release-metadata.json"

chmod 755 "$SPK_DIR/scripts/"*
chmod 644 "$SPK_DIR/INFO" "$SPK_DIR"/conf/* "$SPK_DIR"/PACKAGE_ICON*.PNG

# ── 负载打包 ──
tar czf "$SPK_DIR/package.tgz" -C "$SPK_DIR/package" --owner=0 --group=0 .
rm -rf "$SPK_DIR/package"

# ── SPK 本体（INFO 必须位于最前面）──
OUT="rustdesk-console-synology-${VERSION}-${ARCH_NAME}.spk"
tar cf "$OUT" --format=gnu --owner=0 --group=0 -C "$SPK_DIR" \
  INFO package.tgz scripts conf PACKAGE_ICON.PNG PACKAGE_ICON_256.PNG

# ── 校验 ──
echo "── INFO ──"
grep -E '^(package|version|arch|os_min_ver|adminport)=' "$SPK_DIR/INFO"
echo "── spk 内容 ──"
tar tf "$OUT"
mkdir -p .verify
tar -xOf "$OUT" package.tgz > .verify/package.tgz
tar tzf .verify/package.tgz > .verify/paths.txt
tar tzvf .verify/package.tgz > .verify/list.txt
echo "── package.tgz 关键文件 ──"
grep -E '(dist/main\.js|public/index\.html|\.\/run\.sh|package\.json|release-metadata\.json)$' .verify/list.txt \
  || { echo "payload sanity check failed" >&2; exit 1; }
grep -qx '\./public/index.html' .verify/paths.txt \
  || { echo "frontend index.html missing from payload" >&2; exit 1; }
grep -qx '\./dist/main.js' .verify/paths.txt \
  || { echo "backend dist/main.js missing from payload" >&2; exit 1; }
grep -q '^\./node_modules/typeorm/' .verify/paths.txt \
  || { echo "node_modules missing from payload" >&2; exit 1; }
grep -q '^-rwxr-xr-x .* \./run\.sh$' .verify/list.txt \
  || { echo "run.sh missing or not executable" >&2; exit 1; }
rm -rf .verify
ls -lh "$OUT"
