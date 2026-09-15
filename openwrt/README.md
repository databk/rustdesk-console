# RustDesk Console — OpenWrt Package

This directory contains the OpenWrt/ImmortalWrt package definition for RustDesk
Console. It ships **prebuilt musl binaries** (Node.js SEA single executable +
`sqlite3` + `sharp` native modules) and wraps them in `.ipk` and `.apk`
packages managed by `procd`.

## Supported targets

| Architecture | OpenWrt ARCH | SEA tarball |
|--------------|--------------|-------------|
| x86_64 (soft router) | `x86_64` | `rustdesk-console-<ver>-linux-x64-musl.tar.gz` |
| aarch64 (ARMv8) | `aarch64` | `rustdesk-console-<ver>-linux-arm64-musl.tar.gz` |

Only **musl** libc builds of OpenWrt/ImmortalWrt are supported (the default).
glibc-based OpenWrt builds are not supported.

## Install a prebuilt package

Download the package for your architecture from the
[GitHub Releases](https://github.com/databk/rustdesk-console/releases) page.

### OpenWrt < 24.10 (opkg / `.ipk`)

```sh
opkg install rustdesk-console_<version>_x86_64.ipk
```

### OpenWrt >= 24.10 (apk / `.apk`)

```sh
apk add --allow-untrusted rustdesk-console_<version>_x86_64.apk
```

> The `--allow-untrusted` flag is needed because the `.apk` is not signed with
> a build key. For production feeds, sign the package with your own key and
> configure `apk` trust accordingly.

> **Note:** The `.apk` uses `arch: noarch` so it installs on any OpenWrt apk
> target (e.g. `aarch64_generic`, `aarch64_cortex-a72`, `x86_64`). Make sure
> to download the file matching your CPU architecture (`x86_64` or `aarch64`)
> — the package itself does not enforce the CPU architecture.

Then enable and start the service:

```sh
/etc/init.d/rustdesk-console enable
/etc/init.d/rustdesk-console start
```

The backend API is now available at `http://<router-ip>:3000/api`.

## Configuration

Edit `/etc/rustdesk-console/rustdesk-console.env` (a conffile, preserved across
upgrades) and restart the service. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP listen port |
| `JWT_SECRET` | must be changed | JWT signing secret |
| `DATA_DIR` | `/var/lib/rustdesk-console` | SQLite DB, avatars, nexus builds |

## Build the package from the OpenWrt feed

This `Makefile` is a **binary package**: it downloads a prebuilt musl SEA
tarball from GitHub Releases and packages it — it does **not** compile Node.js
inside the OpenWrt buildroot.

1. Add this directory to your OpenWrt feed (e.g. `feeds.conf`):
   ```
   src-link rustdesk_console /path/to/this/openwrt
   ```
2. Update and install the feed:
   ```sh
   ./scripts/feeds update rustdesk_console
   ./scripts/feeds install rustdesk-console
   ```
3. Select your target (`x86_64` or `aarch64`, musl) in `make menuconfig`, then
   enable `Network -> RustDesk -> rustdesk-console`.
4. Update `PKG_HASH` in `Makefile` to the sha256 of the downloaded tarball
   (required by recent buildroot versions):
   ```sh
   sha256sum dl/rustdesk-console-<ver>-linux-<arch>-musl.tar.gz
   ```
5. Build:
   ```sh
   make package/rustdesk-console/compile V=s
   ```
   The `.ipk` appears in `bin/packages/<arch>/rustdesk_console/`.

## Frontend

This package only installs the **backend API**. Deploy the
[frontend](https://github.com/databk/rustdesk-console-web) separately and point
it at `http://<router-ip>:3000`, e.g. with an external nginx reverse proxy.

## How the prebuilt tarballs are produced

The musl SEA tarballs, `.ipk` and `.apk` files are built in CI (see
`.github/workflows/release.yml` and `nightly.yml`):

1. `node:24-alpine` container runs `npm ci && npm run build:sea` → musl SEA
   binary + musl native modules (`sqlite3`, `sharp` use their `linuxmusl`
   prebuilds).
2. `scripts/build-openwrt-ipk.sh` assembles the `.ipk` (data + control archive)
   with the procd init script and default config.
3. `scripts/build-openwrt-apk.sh` assembles the `.apk` using `apk mkpkg`
   (apk-tools 3.x ADB format) for OpenWrt 24.10+ snapshots and newer.

## File layout (installed)

```
/usr/lib/rustdesk-console/rustdesk-console       # SEA executable (musl)
/usr/lib/rustdesk-console/templates/{email,oidc} # email/OIDC templates
/usr/lib/rustdesk-console/node_modules/{sqlite3,sharp}
/usr/bin/rustdesk-console                        # wrapper -> SEA executable
/etc/init.d/rustdesk-console                     # procd init script
/etc/rustdesk-console/rustdesk-console.env       # config (conffile)
/var/lib/rustdesk-console/                       # data dir (created on install)
```