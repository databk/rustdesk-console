#!/bin/sh
# Destructive package lifecycle test: disposable OpenWrt rootfs containers only.
set -e
[ "${OPENWRT_PACKAGE_TEST:-}" = 1 ] || { echo 'Set OPENWRT_PACKAGE_TEST=1 in a disposable rootfs' >&2; exit 1; }
mkdir -p /var/lock
set -- /packages/rustdesk-console-*.apk /packages/luci-app-rustdesk-console-*.apk
[ "$#" = 2 ] && [ -f "$1" ] && [ -f "$2" ] || {
	echo 'Expected exactly one backend APK and one LuCI APK' >&2
	exit 1
}
apk --no-network --allow-untrusted add --simulate "$@"
apk --no-network --allow-untrusted add "$@"
[ "$(uci -q get rustdesk-console.main.enabled)" = 0 ]
[ ! -e /srv/rustdesk-console ]
[ ! -e /etc/rustdesk-console/credentials ]
sh -n /etc/init.d/rustdesk-console
sh -n /usr/libexec/rustdesk-console-run
. /lib/functions.sh
. /etc/init.d/rustdesk-console
start_service
[ ! -e /srv/rustdesk-console ]
uci set rustdesk-console.main.enabled=1
uci set rustdesk-console.main.port=21114
uci set rustdesk-console.main.backend_port=21115
uci commit rustdesk-console
procd_open_instance() { instance="$1"; }
procd_close_instance() { :; }
procd_set_param() {
	if [ "$1" = env ]; then shift; printf '%s\n' "$@" > "/tmp/console-$instance.env"; fi
}
start_service
/usr/lib/rustdesk-console/backend/node /repo/openwrt/test-installed.mjs
apk --no-network del luci-app-rustdesk-console rustdesk-console
[ -f /srv/rustdesk-console/rustdesk-console.db ]
[ -f /etc/rustdesk-console/credentials ]
echo 'Installed package, disabled default, permissions, non-root runtime, login, restart and uninstall retention: OK'
