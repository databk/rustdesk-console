# RustDesk Console — OpenWrt Package

This directory contains the OpenWrt/ImmortalWrt package definition for RustDesk
Console. It ships **prebuilt musl binaries** (Node.js SEA single executable +
`sqlite3` + `sharp` native modules) and wraps them in an `.ipk` package managed
by `procd`.

## Supported targets

| Architecture | OpenWrt ARCH | SEA tarball |
|--------------|--------------|-------------|
| x86_64 (soft router) | `x86_64` | `rustdesk-console-<ver>-linux-x64-musl.tar.gz` |
| aarch64 (ARMv8) | `aarch64` | `rustdesk-console-<ver>-linux-arm64-musl.tar.gz` |

Only **musl** libc builds of OpenWrt/ImmortalWrt are supported (the default).
glibc-based OpenWrt builds are not supported.

## Install a prebuilt .ipk

Download the `.ipk` for your architecture from the
[GitHub Releases](https://github.com/databk/rustdesk-console/releases) page and:

```sh
opkg install rustdesk-console_<version>_x86_64.ipk
```

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

The musl SEA tarballs and `.ipk` files are built in CI (see
`.github/workflows/release.yml` and `nightly.yml`):

1. `node:24-alpine` container runs `npm ci && npm run build:sea` → musl SEA
   binary + musl native modules (`sqlite3`, `sharp` use their `linuxmusl`
   prebuilds).
2. `scripts/build-openwrt-ipk.sh` assembles the `.ipk` (data + control archive)
   with the procd init script and default config.

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