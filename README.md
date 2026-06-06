# RustDesk Console

<p align="center">
  <strong>Management Console for RustDesk</strong>
</p>

<p align="center">
  <a href="https://github.com/databk/rustdesk-console-web">Frontend Project</a> · <a href="https://discord.gg/vrQSJfqpwD">Discord</a>
</p>

---

RustDesk Console is a management platform for the [RustDesk](https://rustdesk.com/) remote desktop ecosystem. This is the **backend** service (NestJS). The frontend is at [databk/rustdesk-console-web](https://github.com/databk/rustdesk-console-web).

## Features

- **Authentication** — JWT + refresh tokens, 2FA/TOTP, OIDC (Google, GitHub, etc.), email verification
- **User Management** — CRUD, batch operations, role-based access, avatar upload
- **Address Book** — Personal & shared address books, tags, access rules
- **Device Groups** — Group management, role-based permissions, force disconnect
- **Strategy** — Config strategies assigned to devices/users/groups, delivered via heartbeat
- **Dashboard** — Statistics, trend analysis, real-time monitoring
- **Audit** — Connection, file transfer, security alarm, and console operation logging
- **Monitoring** — Heartbeat, active connections, system info collection
- **Email** — SMTP configuration, templates, verification emails

## Tech Stack

NestJS 11 · TypeORM 0.3 · SQLite · JWT/Passport · bcryptjs · otplib · Nodemailer · sharp · openid-client

## Quick Start

### Docker (Recommended)

This project uses a **frontend-backend separated architecture**. Only port **21114** is exposed externally; the backend's port 3000 is internal-only.

**Docker Compose:**

```yaml
version: '3.8'
services:
  rustdesk-console:
    image: databk/rustdesk-console:latest
    container_name: rustdesk-console
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - JWT_SECRET=your-super-secret-key
      - ADMIN_PASSWORD=your-secure-password

  rustdesk-console-web:
    image: databk/rustdesk-console-web:latest
    container_name: rustdesk-console-web
    ports:
      - "21114:80"
    depends_on:
      - rustdesk-console
    restart: unless-stopped
```

The frontend connects to the backend via the internal Docker network (`rustdesk-console:3000`).

**GHCR images** — replace with:
- `ghcr.io/databk/rustdesk-console:latest` (backend)
- `ghcr.io/databk/rustdesk-console-web:latest` (frontend)

**Docker CLI:**

```bash
docker network create rustdesk-net

docker run -d --name rustdesk-console --network rustdesk-net \
  -e JWT_SECRET=your-super-secret-key \
  -e ADMIN_PASSWORD=your-secure-password \
  databk/rustdesk-console:latest

docker run -d --name rustdesk-console-web --network rustdesk-net \
  -p 21114:80 \
  databk/rustdesk-console-web:latest
```

### Build from Source

Requires Node.js >= 18, npm >= 9.

```bash
git clone https://github.com/databk/rustdesk-console.git
cd rustdesk-console
npm install
cp .env.example .env
# Edit .env with your configuration
npm run start:dev
```

The API runs at `http://localhost:3000/api` by default.

## Project Structure

```
src/
├── main.ts
├── app.module.ts
├── modules/
│   ├── auth/            # JWT, 2FA, OIDC, email auth
│   ├── user/            # User CRUD, avatar, password
│   ├── address-book/    # Address books & peers
│   ├── device-group/    # Device groups & permissions
│   ├── strategy/        # Strategy config & assignment
│   ├── audit/           # Connection/file/alarm/console audit
│   ├── heartbeat/       # Device heartbeat & active connections
│   ├── sysinfo/         # System info collection
│   ├── oidc/            # OpenID Connect
│   ├── dashboard/       # Statistics & analytics
│   ├── settings/        # System settings & SMTP
│   └── email/           # Email services
├── common/              # Guards, decorators, entities
└── database/            # DB init & seed data
```

## Configuration

Copy `.env.example` to `.env` and configure. Key variables:

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | JWT signing key (change in production!) |
| `ADMIN_PASSWORD` | Default admin password (change in production!) |
| `PORT` | Backend port (default: 3000) |

The database is **SQLite** (`rustdesk.db`), managed by TypeORM. Supports migration to PostgreSQL/MySQL for higher concurrency.

## Deployment

Production checklist:

- [ ] Set strong `JWT_SECRET` (min 32 chars) and `ADMIN_PASSWORD`
- [ ] Configure SMTP via the Settings API
- [ ] Restrict CORS origins to your frontend domain
- [ ] Set up HTTPS/reverse proxy
- [ ] Back up the SQLite database regularly
- [ ] Configure `WEB_FRONTEND_URLS` for OIDC web login

## Contributing

1. Fork → feature branch → commit → push → PR
2. Follow [Conventional Commits](https://www.conventionalcommits.org/)

## License

[AGPL-3.0](LICENSE)
