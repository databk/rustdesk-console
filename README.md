<h1 align="center">
  <br>
  <a href="https://github.com/databk/rustdesk-console"><img src="https://raw.githubusercontent.com/rustdesk/rustdesk/master/res/logo.svg" alt="RustDesk Console" width="128" /></a>
  <br>
  RustDesk Console
  <br>
</h1>
<div align="center">

**Enterprise-grade management platform for the RustDesk ecosystem**

[![License](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com/)
[![Docker Pulls](https://img.shields.io/docker/pulls/databk/rustdesk-console.svg?logo=docker&logoColor=white)](https://hub.docker.com/r/databk/rustdesk-console)

[Discord](https://discord.gg/vrQSJfqpwD) · [Frontend Project](https://github.com/databk/rustdesk-console-web)

</div>

---

## ✨ Highlights

<table>
<tr>
<td width="50%">

### 🔐 Authentication & Security
JWT tokens · TOTP 2FA · OIDC SSO · Passkey · Email verification · Rate limiting

</td>
<td width="50%">

### 📱 Device Management
Grouping · Status tracking · Strategy assignment · Batch operations · Force disconnect

</td>
</tr>
<tr>
<td width="50%">

### 📋 Address Book
Personal & shared books · Tag organization · Peer management · Access rules

</td>
<td width="50%">

### 🎯 Strategy Configuration
Device / user / group assignment · Priority resolution · Heartbeat delivery

</td>
</tr>
<tr>
<td width="50%">

### 📊 Dashboard & Analytics
Overview statistics · Trend analysis · Real-time monitoring · Multi-metric support

</td>
<td width="50%">

### 🔍 Audit & Compliance
Connection · File transfer · Security alarm · Console operation logging

</td>
</tr>
</table>

## 🖼️ Screenshots

<table>
<tr>
<td><img src="docs/images/Dashboard.png" alt="Dashboard" /></td>
<td><img src="docs/images/Devices.png" alt="Device Management" /></td>
</tr>
<tr>
<td><img src="docs/images/Personal Adress Book.png" alt="Address Book" /></td>
<td><img src="docs/images/File Transfer Logs.png" alt="File Transfer Audit" /></td>
</tr>
</table>

## 🚀 Quick Start

> **Administrator account**: username `databk`. Standard Docker installations use the `ADMIN_PASSWORD` you configure; the Linux installer generates or accepts an initial password. Existing installations retain their current credentials. Manual installations without `ADMIN_PASSWORD` retain the legacy default `databk`, which must be changed before production.

### Docker (Recommended)

Download [`docker-compose.yml`](docker-compose.yml), [`docker-compose.override.yml`](docker-compose.override.yml) and [`.env.example`](.env.example) into a dedicated directory on the Linux Docker host. Create a protected configuration file:

```bash
cp .env.example .env
chmod 600 .env
```

In `.env`, set a unique `JWT_SECRET`, your initial `ADMIN_PASSWORD`, and `CONSOLE_INSTALL_DIR` to this directory's actual absolute host path. Then start the standard deployment:

```bash
docker compose up -d
```

The frontend is accessible at `http://localhost:21114`. The updater is included and starts by default. Administrators initiate coordinated backend/frontend updates from **Update system**; only compatible official stable releases with complete manifests are eligible. Startup does not initiate an upgrade.

See [Managed system updates](docs/system-update.md) for SQLite/MySQL prerequisites, data protection, supported installations and recovery. Existing deployments must follow that guide before adopting the managed layout. The override file is reserved for the updater's pinned image digests.

Legacy Docker deployments retain their configured user and data permissions. The managed layout uses UID/GID 1000; its adoption guide includes an explicit offline data migration and write check.

Images are published to both Docker Hub (`databk/rustdesk-console`) and GitHub Container Registry (`ghcr.io/databk/rustdesk-console`) for `linux/amd64` and `linux/arm64`. To use the GitHub Container Registry mirror, replace `databk/rustdesk-console` with `ghcr.io/databk/rustdesk-console`.

<details>
<summary>📋 Docker CLI (without Compose)</summary>

This manual layout uses the original version check and manual update process. Use the standard Compose deployment above for managed system updates.

```bash
docker network create rustdesk-net

docker run -d \
  --name rustdesk-console \
  --network rustdesk-net \
  -e JWT_SECRET=your-super-secret-key \
  -v ./data:/data \
  databk/rustdesk-console:latest

docker run -d \
  --name rustdesk-console-web \
  --network rustdesk-net \
  -p 21114:80 \
  -e BACKEND_URL=http://rustdesk-console:3000 \
  databk/rustdesk-console-web:latest
```

</details>

### Pre-built Binaries

Each release ships complete Single Executable Application (SEA) archives for Linux (x64/arm64), Windows (x64), and macOS (x64/arm64). Download the archive matching your CPU and, on Linux, libc from the [Releases page](https://github.com/databk/rustdesk-console/releases), and verify its published SHA-256. Preserve the full extracted directory, including native modules and templates; no separate Node.js runtime is required.

For a fresh standard Linux installation booted with systemd, run `sudo ./deployment/install-linux.sh` from the extracted backend bundle. It installs the backend, frontend, required tools and updater service together. Initial credentials are kept in the protected `/etc/rustdesk-console/backend.env` file. See [the installation and recovery guide](docs/system-update.md#standard-linux-installation) for configuration and existing-data migration.

Direct executable launches, source deployments and Windows/macOS installations retain manual updates.

<details>
<summary>🔧 Build from Source</summary>

```bash
git clone https://github.com/databk/rustdesk-console.git
cd rustdesk-console
npm install
cp .env.example .env
# Edit .env with your configuration
npm run build
npm run start:prod
```

**Requirements**: Node.js ≥ 20.0.0, npm ≥ 9.0.0

</details>

## 🛠️ Tech Stack

`NestJS 11` · `TypeScript` · `TypeORM 0.3` · `SQLite` · `JWT` · `Passport.js` · `bcryptjs` · `otplib` · `Nodemailer` · `sharp` · `openid-client`

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding conventions, and contribution guidelines.

---

<p align="center">
  <strong>Built with ❤️ using NestJS | Data Block</strong>
</p>
