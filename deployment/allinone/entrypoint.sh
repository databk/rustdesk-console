#!/bin/sh
# Entrypoint for the all-in-one image (API + web console + nginx).
#
# supervisord stays root so it can attach child output to /dev/stdout; the
# supervised programs drop to unprivileged users themselves. Only /data is
# chowned, which keeps bind mounts usable from any host.
set -eu

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

data_dir="${DATA_DIR:-/data}"
if [ "$(id -u)" = 0 ]; then
  mkdir -p "$data_dir"
  find "$data_dir" -xdev \( \! -user 1000 -o \! -group 1000 \) \
    -exec chown -h 1000:1000 {} +
fi

exec /usr/bin/supervisord -c /etc/supervisord.conf
