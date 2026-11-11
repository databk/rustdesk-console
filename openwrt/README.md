# Native OpenWrt package

These SDK package definitions include the Console API, its private Node runtime
and the native web frontend. `luci-app-rustdesk-console` adds a configuration page under
**Services → RustDesk Console**. It does not install hbbs/hbbr or change network,
DHCP, DNS, firewall or uhttpd configuration.

Tested targets are OpenWrt **25.12.6 / x86_64 / APK** (actual VM installation,
procd, browser login and service restart) and **25.12.6 / aarch64_generic / APK**
(full QEMU guest, procd, HTTP login, service restart, reboot and persistence).
ARM64 hardware, other ARM64 package architectures and 24.10/IPK remain untested.
This partially addresses [issue #287](https://github.com/databk/rustdesk-console/issues/287);
automatic release publishing and additional package targets remain future work.

Both environments had 1 GiB RAM. The installed application occupies about
184 MiB, and the backend used approximately 170 MiB RSS in idle samples.
These samples do not establish a minimum memory requirement or a load limit.

## Why a private runtime

The tested 1.11.0 ARM64 musl SEA release failed to load sqlite3 and sharp, while
both worked with the unmodified Node runtime. `npm run build:openwrt` distributes the original Node
binary with a bundled JavaScript entry point and native modules. It uses no
system Node package and installs everything beneath `/usr/lib/rustdesk-console`.

The SDK normalizes Alpine's `libc.musl-*.so.1` dependencies to OpenWrt's `libc.so`
**in package files only**. Target libc files are never replaced. Validate the
final APK after this transformation, not just its input bundle.

## Build

1. In a Linux musl environment for the target architecture (Node 24), run
   `npm ci && npm run build:openwrt`. The result is `dist-sea/`; this name is shared
   with the existing build tooling. This command also runs native-module,
   database migration and HTTP health checks against the resulting launcher.
2. Download and verify the matching musl release bundle from
   [rustdesk-console-web](https://github.com/databk/rustdesk-console-web/releases).
   The tested frontend is **1.7.0**. Extract it separately.
3. Use the official SDK for the intended OpenWrt release and architecture. Copy
   `rustdesk-console/` and `luci-app-rustdesk-console/` into its `package/`
   directory. Install the SDK's LuCI feed if building from a clean SDK.
4. Select both packages as modules, run `make defconfig`, then:

   ```sh
   make package/rustdesk-console/compile V=s \
     CONSOLE_BUNDLE=/absolute/path/dist-sea WEB_BUNDLE=/absolute/path/web
   make package/luci-app-rustdesk-console/compile V=s \
     CONSOLE_BUNDLE=/absolute/path/dist-sea WEB_BUNDLE=/absolute/path/web
   ```

SDK paths must not contain spaces. `Dockerfile.sdk` supplies a Debian build
environment; use a Docker volume for the SDK and mount Windows sources as input.
The SDK supplies package architecture, libc/libgcc/libstdcpp dependency names,
conffiles and service lifecycle scripts. Bundle metadata and ELF architecture
are checked before packaging. Backend version must match `PKG_VERSION`.

## Install and configure

Inspect the package transaction before applying it. For a locally built unsigned
APK, verify its SHA-256 against the build output before using `--allow-untrusted`.
Do not perform a blanket package upgrade as part of Console installation.

Check `/etc/apk/arch` and use a package from that target's SDK. An
`aarch64_generic` APK is not a package for `aarch64_cortex-a53`; do not override
the package manager's architecture checks. On OpenWrt 25.12, with matching
packages in the current directory and official dependency repositories available:

```sh
apk update
apk --allow-untrusted add --simulate ./rustdesk-console-*.apk ./luci-app-rustdesk-console-*.apk
apk --allow-untrusted add ./rustdesk-console-*.apk ./luci-app-rustdesk-console-*.apk
```

Installation creates a dedicated `rustdesk-console` account. The UCI default
`enabled=0` prevents the standard OpenWrt post-install hook from starting it.
To enable on a LAN address (replace the example address with the router's LAN IP):

```sh
uci set rustdesk-console.main.bind_addr='192.168.1.1'
uci set rustdesk-console.main.enabled='1'
uci commit rustdesk-console
/etc/init.d/rustdesk-console start
```

The web frontend uses port **21114**. The API uses **127.0.0.1:21115**. Both are
configurable; neither should overlap another service. The backend supports `HOST`
explicitly. The default web bind is loopback until configured.

The initial username is `databk`. First start creates a random initial password
and JWT secret in `/etc/rustdesk-console/credentials` (root-only, mode 0600).
Changing this file later does not reset an existing user's password. Use the
Console account settings to change it after login.

Data defaults to `/srv/rustdesk-console`, owned by the dedicated service account.
Unlike OpenWrt's usual `/var -> /tmp`, this is persistent on the root filesystem.
An external persistent directory under `/mnt` or `/opt` can be configured.
Confirm the mount before enabling the service. Do not use temporary storage.

The procd service limits the JavaScript heap to 128 MiB by default (this is not
a total RSS limit), lowers process priority and bounds crash retries. It runs
migrations before serving requests. Each restart first retains the stopped
SQLite database and journals under `pre-migration/`. This is one local recovery
copy, not a backup history. Stop the service and take a separate data backup
before package upgrades or moving the data directory.

```sh
/etc/init.d/rustdesk-console stop
# Back up /srv/rustdesk-console and /etc/rustdesk-console before upgrading.
```

Uninstalling the packages stops Console and leaves its database and generated
credentials. Cleanup of those files is a separate, explicit action. The built-in
systemd/Docker updater is not enabled for this installation; use OpenWrt packages.

## Validation

`scripts/test-runtime.mjs` exercises the final runtime's sqlite3 write/read, sharp
resize/PNG decode, migrations and bound HTTP health endpoint. Run it with the
bundle path in the corresponding target userland.

`test-package.sh` and `test-installed.mjs` run in a disposable rootfs: they verify
the installed launcher and permissions, run both processes as the package account,
check the web proxy and login, restart them, and check owner/data retention.
The test requires `OPENWRT_PACKAGE_TEST=1` and environment snapshots prepared by
the test shell. Container tests do not exercise procd supervision or reboot; those
results must be recorded separately on an OpenWrt system.

The package directory must contain exactly one version of each Console package.
Do not run this destructive install/uninstall test on an existing router:

```sh
docker build -f openwrt/Dockerfile.test -t console-openwrt-test openwrt
docker run --rm --network none --cpus 2 --memory 768m \
  -e OPENWRT_PACKAGE_TEST=1 \
  -v "$PWD:/repo:ro" -v "$PWD/build/openwrt-25.12.6-x86_64:/packages:ro" \
  console-openwrt-test sh /repo/openwrt/test-package.sh
```

On 2026-11-11, the x86_64 APK was also tested on a running OpenWrt 25.12.6 VM:
procd startup, browser login, service restart with account retention, and LuCI
save/apply to disable and re-enable Console. Network, DHCP, firewall and uhttpd
configuration hashes were unchanged. That router was not rebooted. ARM64 testing
uses the isolated VM below; no physical ARM64 device was available, and its LuCI
page has not been separately exercised in a browser.

### Full ARM64 VM

`test-qemu.py` boots the official OpenWrt ARM system-ready image with QEMU's
`virt` machine and Cortex-A53 CPU. It tests the final `aarch64_generic` APK in
a real guest kernel: disabled installation, procd startup as the service user,
SQLite/sharp, frontend HTTP and login, service restart, guest reboot, persistence
and uninstall. It creates disposable disks and supplies no network interface.
It does not emulate a particular Rockchip or Qualcomm router board.

Prepare an artifact directory with these verified files from the
[OpenWrt 25.12.6 armsr/armv8 release](https://downloads.openwrt.org/releases/25.12.6/targets/armsr/armv8/):

| Local filename | Release filename | SHA-256 |
| --- | --- | --- |
| `kernel.bin` | `openwrt-25.12.6-armsr-armv8-generic-kernel.bin` | `2b9ce48df5536e993ee691339057828488e4a31be9c2bb5d3f6120f1135fcbb0` |
| `rootfs.img.gz` | `openwrt-25.12.6-armsr-armv8-generic-ext4-rootfs.img.gz` | `3f25a4ee0537f0a4336833047d7933e884c29450eefb7ac758155cbd0f5278d3` |

Fetch `libstdcpp6`, `luci-base` and their dependencies into `deps/` under that
directory. For example, with Docker's ARM emulation enabled:

```sh
mkdir -p "$ARM_ARTIFACTS/deps"
docker run --rm -v "$ARM_ARTIFACTS/deps:/deps" \
  openwrt/rootfs@sha256:22f13387da208c0fb4150c41f3ec12e34cc5994a0717a49e50aa9f9ae6cb5e7b \
  sh -ec 'apk update; apk fetch --recursive --output /deps libstdcpp6 luci-base'
docker build -f openwrt/Dockerfile.qemu -t console-openwrt-qemu openwrt
docker volume create console-openwrt-arm-test
docker run --rm --network none --cpus 2 --memory 2g \
  -v console-openwrt-arm-test:/work -v "$PWD:/repo:ro" \
  -v "$ARM_ARTIFACTS:/artifacts:ro" \
  -v "$PWD/build/openwrt-25.12.6-aarch64_generic:/packages:ro" \
  console-openwrt-qemu python3 -u /repo/openwrt/test-qemu.py \
    --artifacts /artifacts --packages /packages --work /work/run-1
```

Set `ARM_ARTIFACTS` to an absolute directory first. The rootfs container uses
OpenWrt's `aarch64_generic` image architecture label; do not override it with
Docker's `--platform linux/arm64`. The runner refuses to overwrite a nonempty
work directory. Use a new run directory for each attempt. Success ends with
`ARM64_VM_PACKAGE_TEST_OK`; complete serial output stays in the work volume.
This validates the tested package ABI, not all ARM64 boards or the separate
`aarch64_cortex-a53` package architecture.
