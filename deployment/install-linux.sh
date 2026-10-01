#!/bin/sh
set -eu
umask 077
if [ "$(id -u)" != 0 ]; then
  echo 'Run the standard installer as root.' >&2
  exit 1
fi
if [ "$(uname -s)" != Linux ] || ! command -v systemctl >/dev/null 2>&1 || [ ! -d /run/systemd/system ]; then
  echo 'Standard installation requires a Linux host booted with systemd.' >&2
  exit 1
fi
if command -v apt-get >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3 ca-certificates sqlite3 default-mysql-client libstdc++6 libatomic1 util-linux
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y python3 ca-certificates sqlite mariadb libstdc++ libatomic util-linux
elif command -v apk >/dev/null 2>&1; then
  apk add --no-cache python3 ca-certificates sqlite mariadb-client mariadb-connector-c libstdc++ libatomic util-linux
else
  echo 'Supported package managers: apt-get, dnf, apk. No services were changed.' >&2
  exit 1
fi
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec python3 "$script_dir/install_linux.py" "$@"
