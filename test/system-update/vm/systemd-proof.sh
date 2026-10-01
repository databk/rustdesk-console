#!/bin/sh
set -eu
test "$(cat /proc/1/comm)" = systemd
install -d -m 700 /var/lib/console-system-update-test-proof
cat > /etc/systemd/system/console-system-update-test-proof.service <<'EOF'
[Unit]
Description=Disposable updater test VM boot persistence proof
After=local-fs.target
[Service]
Type=simple
ExecStartPre=/bin/sh -c 'cat /proc/sys/kernel/random/boot_id >> /var/lib/console-system-update-test-proof/boots'
ExecStart=/usr/bin/sleep infinity
Restart=on-failure
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now console-system-update-test-proof.service
systemctl is-active console-system-update-test-proof.service
cat /var/lib/console-system-update-test-proof/boots
