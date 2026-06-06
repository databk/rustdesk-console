# RustDesk Console

<p align="center">
  <strong>Remote Desktop Management Console for RustDesk</strong>
</p>

---

## 📖 Overview

**RustDesk Console** is a comprehensive management platform built with [NestJS](https://nestjs.com/) that powers the RustDesk remote desktop ecosystem. It provides robust device management, user authentication, address book management, security auditing, strategy-based configuration, and real-time monitoring capabilities for enterprise-grade remote desktop deployments.

This console serves as the central hub for managing RustDesk clients, handling everything from user authentication and authorization to device grouping, access control, strategy management, and comprehensive audit logging.

## ✨ Key Features

### 🔐 Authentication & Security
- **JWT-based Authentication**: Secure token-based authentication with automatic token refresh and revocation
- **Two-Factor Authentication (TFA/OTP)**: Enhanced security using TOTP (Time-based One-Time Password) via `otplib`
- **Email Verification**: Email-based verification system using Nodemailer with Handlebars templates
- **OIDC Integration**: Support for OpenID Connect providers (e.g., Google, Azure AD, Okta) with Authorization Code Flow + PKCE
- **Cookie-based Authentication**: Web frontend login support with cookie-based session management
- **Password Encryption**: Secure password hashing using `bcryptjs`
- **Rate Limiting**: Built-in request throttling to prevent abuse

### 👥 User Management
- Complete CRUD operations for user accounts
- User invitation via email
- Enable/disable user accounts
- Admin role-based access control
- TFA enforcement policies
- Avatar upload and management

### 📖 Address Book Management
- Personal and shared address books
- Device peer management (add, update, delete, pagination)
- Tag-based organization with custom colors
- Access rules and permission levels
- Legacy API compatibility support
- Multi-field filtering and search

### 🖥️ Device Group Management
- Create and manage device groups
- Assign devices to groups with role-based permissions
- User-to-user permission mapping
- Device enable/disable controls
- Batch device status update
- Force disconnect via heartbeat

### 🎯 Strategy Management
- Create and manage configuration strategies
- Assign strategies to devices, users, or device groups
- Priority-based strategy resolution (device > user > device group)
- Strategy-based configuration options delivery

### 📊 Dashboard & Analytics
- **Overview**: Real-time totals for users, devices, connections, audits, and file transfers
- **Statistics**: User distribution, device distribution, connection analysis, file transfer stats
- **Trends**: Historical trends for connections, user activity, and alarms (7d/30d/90d)
- **Realtime**: Active connections, recent events, and system status (CPU, memory, disk, uptime)

### 📊 Audit & Compliance
- **Connection Auditing**: Track all remote connections (established, closed, authorized)
- **File Transfer Auditing**: Monitor file send/receive operations with file details
- **Security Alarm Auditing**: Log security events (IP whitelist violations, brute force attempts, etc.)
- Comprehensive timestamp tracking (requested, established, closed times)

### 💓 Real-time Monitoring
- **Heartbeat System**: Monitor device online status and last activity
- **Active Connection Tracking**: Track currently active connections
- **System Information Collection**: Gather hardware/OS details from connected devices
- Automatic status updates and device tracking

### ⚙️ System Settings
- **SMTP Configuration**: Manage SMTP settings via API (Upsert, test connection)
- Generic key-value settings store with category grouping
- Sensitive value masking in API responses

### 📧 Email Services
- Welcome email templates
- Verification code emails
- Customizable Handlebars templates
- SMTP configuration via API

## 🛠️ Tech Stack

| Category | Technology |
|----------|------------|
| **Framework** | NestJS 11 (TypeScript) |
| **Database** | SQLite via TypeORM 0.3 |
| **Authentication** | JWT (passport-jwt), Passport.js, cookie-parser |
| **Security** | bcryptjs, otplib (TOTP), @nestjs/throttler |
| **Email** | Nodemailer + Handlebars templates, @nestjs-modules/mailer |
| **OIDC** | openid-client (OIDC + OAuth2 dual protocol) |
| **Validation** | class-validator, class-transformer |
| **Scheduling** | @nestjs/schedule (cron jobs) |
| **Monitoring** | systeminformation (CPU, memory, disk) |
| **Image Processing** | sharp (avatar resizing) |
| **Utilities** | uuid, dotenv, @nestjs/config |
| **Testing** | Jest, supertest |

## 🚀 Quick Start

### Prerequisites

- **Node.js** >= 18.0.0
- **npm** >= 9.0.0
- **SQLite3** (included as dependency)

### Installation

RustDesk Console provides multiple installation methods to suit different deployment needs:

#### 🔧 Option 1: Build from Source (Recommended for Development)

Clone the repository and build from source:

```bash
# Clone the repository
git clone https://github.com/databk/rustdesk-console.git
cd rustdesk-console

# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Edit .env with your configuration (see Environment Variables section)
nano .env
```

#### 🐳 Option 2: Docker Hub

Pull and run the official Docker image from Docker Hub:

```bash
# Pull the latest image
docker pull databk/rustdesk-console:latest

# Run with default configuration
docker run -d \
  --name rustdesk-console \
  -p 3000:3000 \
  databk/rustdesk-console:latest

# Run with custom environment variables
docker run -d \
  --name rustdesk-console \
  -p 3000:3000 \
  -e JWT_SECRET=your-super-secret-key \
  -e ADMIN_PASSWORD=your-secure-password \
  -e SMTP_HOST=smtp.example.com \
  databk/rustdesk-console:latest
```

#### 📦 Option 3: GitHub Container Registry (ghcr)

For users who prefer GitHub Container Registry:

```bash
# Pull from GitHub Container Registry
docker pull ghcr.io/databk/rustdesk-console:latest
```

Available tags for both Docker Hub and GHCR:
- `latest` - Latest stable release
- `X.Y.Z` - Specific version (e.g., `1.3.0`)
- `dev` - Latest development build

### Running the Application

```bash
# Development mode (with hot reload)
npm run start:dev

# Standard development mode
npm run start

# Production mode
npm run build
npm run start:prod

# Debug mode
npm run start:debug
```

The API will be available at `http://localhost:3000/api` (configurable via `PORT` env var).

## 📁 Project Structure

```
src/
├── main.ts                    # Application entry point
├── app.module.ts              # Root application module
│
├── modules/
│   ├── auth/                  # Authentication & authorization (JWT, TFA, OIDC, email, tokens)
│   ├── user/                  # User management (admin CRUD, avatars)
│   ├── address-book/          # Address book & device peer management (peers, tags, rules, permissions)
│   ├── device-group/          # Device grouping & permissions
│   ├── strategy/              # Strategy management (create, assign, unassign, config resolution)
│   ├── audit/                 # Connection/file/alarm audit logging
│   ├── heartbeat/             # Device heartbeat & active connection monitoring
│   ├── sysinfo/               # System information collection
│   ├── oidc/                  # OpenID Connect integration (providers, auth flow, callback)
│   ├── dashboard/             # Dashboard statistics & analytics (overview, trends, realtime)
│   ├── settings/              # System settings management (SMTP config, key-value store)
│   └── email/                 # Email services (templates, SMTP)
│
├── common/                    # Shared utilities (guards, decorators, entities)
└── database/                  # Database initialization & seed data
```

## ⚙️ Environment Configuration

Copy `.env.example` to `.env` and configure the following variables:

```env
# Server Configuration
PORT=3000                              # API server port

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-in-production  # Secret key for signing JWTs

# Default Admin Account (auto-created on first run)
ADMIN_USERNAME=admin                   # Default admin username
ADMIN_EMAIL=admin@example.com          # Default admin email
ADMIN_PASSWORD=admin123                # Default admin password (CHANGE IN PRODUCTION!)

# Database Configuration
# Uses SQLite by default (rustdesk.db file in project root)
# TypeORM config is in src/app.module.ts

# SMTP Configuration (for email verification & notifications)
SMTP_HOST=smtp.example.com             # SMTP server hostname
SMTP_PORT=587                          # SMTP port (587 for TLS, 465 for SSL)
SMTP_SECURE=false                      # Use true for SSL/TLS
SMTP_USER=your-email@example.com       # SMTP username
SMTP_PASS=your-email-password          # SMTP password
SMTP_FROM="No Reply" <noreply@example.com>  # Sender display name & email

# OIDC Configuration
# The base URL for OIDC callback, defaults to http://localhost:3000
# OIDC_REDIRECT_URI=http://localhost:3000

# Web Frontend URLs (comma-separated)
# Allowed URLs for OIDC web login callbackUrl parameter
# Example: WEB_FRONTEND_URLS=http://localhost:5173,https://admin.example.com
WEB_FRONTEND_URLS=http://localhost:5173
```

> **Note**: SMTP settings can also be configured dynamically via the Settings API (`GET/PUT /api/settings/smtp`, `POST /api/settings/smtp/test`), which takes precedence over environment variables for email sending.

> ⚠️ **Security Note**: Always change default passwords and JWT secrets before deploying to production!

## 🗄️ Database

The application uses **SQLite** as the default database engine (file: `rustdesk.db` in project root), managed by **TypeORM 0.3**.

**Core Data Models Include:**
- User accounts & tokens
- Address books, peers, tags & access rules
- Device groups & permissions
- Strategies (configurations assigned to devices, users, groups)
- Audit logs (connections, file transfers, alarms)
- Device system information & heartbeats
- Active connections tracking
- OIDC provider configurations & auth states
- Email verification sessions
- System settings (key-value store)

> **Configuration**: Database settings can be modified in [`src/app.module.ts`](src/app.module.ts). The application can be migrated to MySQL for production deployments requiring higher concurrency.

## 🛡️ Security Features

### Authentication Flow
1. User submits credentials to `POST /api/login`
2. Server validates credentials (with optional TFA check)
3. Returns JWT access token + refresh token
4. Client includes Bearer token in Authorization header for subsequent requests
5. Token is validated on each request via `JwtAuthGuard` (global)
6. Token can be revoked via `POST /api/logout`

### Rate Limiting Strategy
- **Global**: 100 requests per minute per IP
- **Login endpoint**: 5 attempts per minute (brute force protection)
- **SMTP test**: 5 per minute
- **Heartbeat submissions**: 10 per minute per device
- **System info submissions**: 5 per minute per device

### Security Layers
- **JwtAuthGuard**: Global JWT authentication (bypassed via `@Public()` decorator)
- **AdminGuard**: Restricts sensitive endpoints to admin users only
- **ThrottlerGuard**: Global rate limiting protection
- **DeviceThrottlerGuard**: Specialized rate limiting for device endpoints
- **ValidationPipe**: Global input validation with auto-whitelisting and transformation
- **CORS**: Configured with credentials support for web frontend

## 🧪 Development

### Available Scripts

```bash
# Development
npm run start:dev      # Start with hot-reload (watch mode)
npm run start:debug    # Start with debug mode

# Building
npm run build          # Compile TypeScript to JavaScript

# Code Quality
npm run lint           # Lint code with ESLint
npm run format         # Format code with Prettier

# Testing
npm run test           # Run unit tests
npm run test:watch     # Run tests in watch mode
npm run test:cov       # Run tests with coverage report
npm run test:e2e       # Run end-to-end tests
npm run test:debug     # Run tests in debug mode
```

### Code Style
- **Language**: TypeScript with strict typing
- **Linting**: ESLint with Prettier integration
- **Naming Conventions**:
  - Files: kebab-case (`auth.service.ts`)
  - Classes: PascalCase (`AuthService`)
  - Methods/Variables: camelCase (`getUserById`)
- **Documentation**: JSDoc comments on public methods

## 🐳 Deployment Considerations

### Production Checklist
- [ ] Change `JWT_SECRET` to a strong random value (min 32 chars)
- [ ] Change default admin password in `.env`
- [ ] Configure production SMTP settings (via env vars or Settings API)
- [ ] Set `synchronize: false` in TypeORM config and use migrations
- [ ] Configure CORS origins to your frontend domain only
- [ ] Set up HTTPS/reverse proxy (nginx, Apache, etc.)
- [ ] Configure backup strategy for SQLite database
- [ ] Set up process manager (PM2, systemd) for auto-restart
- [ ] Review and adjust rate limiting for your traffic patterns
- [ ] Enable proper logging (currently disabled: `logging: false`)

### Scaling Notes
- **SQLite Limitations**: Single-writer, suitable for small-medium deployments (< 100 concurrent users)
- **For High Availability**: Migrate to MySQL with connection pooling
- **Horizontal Scaling**: Consider Redis for session/token storage if running multiple instances
- **Performance**: Enable WAL mode for better SQLite read concurrency

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

**Commit Message Format**: Follow [Conventional Commits](https://www.conventionalcommits.org/)
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc.)
- `refactor:` Code refactoring
- `test:` Adding/updating tests
- `chore:` Maintenance tasks

## 📄 License

This project is licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0) - see [LICENSE](LICENSE) file for details.

## 📚 Additional Resources

- [NestJS Documentation](https://docs.nestjs.com/) - Framework documentation
- [TypeORM Documentation](https://typeorm.io/) - ORM documentation
- [RustDesk Official Site](https://rustdesk.com/) - Main product information
- [Passport.js Documentation](http://www.passportjs.org/) - Authentication middleware

---

<p align="center">
  <strong>Built with NestJS | The RustDesk Console Backend</strong>
</p>