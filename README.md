# RustDesk Console

<p align="center">
  <strong>Remote Desktop Management Console for RustDesk</strong>
</p>

---

## Overview

**RustDesk Console** is a comprehensive management platform built with [NestJS](https://nestjs.com/) that powers the RustDesk remote desktop ecosystem. It provides robust device management, user authentication, address book management, strategy configuration, security auditing, and real-time monitoring capabilities for enterprise-grade remote desktop deployments.

This console serves as the central hub for managing RustDesk clients, handling everything from user authentication and authorization to device grouping, access control, strategy delivery, and comprehensive audit logging.

## Key Features

### Authentication & Security
- **JWT-based Authentication**: Secure token-based authentication with automatic token refresh and revocation (JTI blacklist)
- **Two-Factor Authentication (2FA/TOTP)**: Enhanced security using TOTP via `otplib`, with admin-enforced 2FA policies
- **Email Verification**: Email-based verification system using Nodemailer with Handlebars templates
- **OIDC Integration**: Support for OpenID Connect providers (e.g., Google, GitHub) with Authorization Code Flow + PKCE, including web frontend login support
- **Password Encryption**: Secure password hashing using `bcryptjs`
- **Rate Limiting**: Built-in request throttling to prevent abuse (100 req/min default, 5 req/min for login)

### User Management
- Complete CRUD operations for user accounts (RESTful conventions)
- User invitation via email
- Enable/disable user accounts with batch operations
- Force logout capabilities (single and batch)
- Admin role-based access control with dedicated admin user queries
- TFA enforcement policies
- User avatar upload and management (auto-converted to WebP, 256x256)
- Change password for current user
- Batch security settings management (TFA enforcement, email verification)

### Address Book Management
- Personal and shared address books
- Device peer management (add, update, delete)
- Tag-based organization with custom colors
- Access rules and permission levels
- Legacy API compatibility support
- Pagination and search functionality

### Device Group Management
- Create and manage device groups
- Assign devices to groups with role-based permissions
- User-to-user permission mapping
- Device enable/disable controls
- Accessible resource queries based on user permissions
- Batch device status updates
- Force disconnect device connections

### Strategy Management
- Create and manage configuration strategies
- Assign strategies to devices, users, or device groups
- Strategy lookup priority: device > user > device group
- Batch assign/unassign operations (up to 200 targets)
- Strategy delivery via heartbeat response

### Dashboard & Analytics
- Overview statistics (users, devices, connections, alarms)
- Trend analysis with configurable time ranges (7d/30d/90d)
- Real-time monitoring data
- Multi-metric support (connection, user, device, alarm)

### Audit & Compliance
- **Connection Auditing**: Track all remote connections (established, closed, authorized) with connection type classification
- **File Transfer Auditing**: Monitor file send/receive operations with file details and advanced filters
- **Security Alarm Auditing**: Log security events (IP whitelist violations, brute force attempts, etc.)
- **Console Auditing**: Track management console operations
- Connection audit note management
- Comprehensive timestamp tracking (requested, established, closed times)

### Real-time Monitoring
- **Heartbeat System**: Monitor device online status and last activity
- **Active Connection Tracking**: Track currently active remote connections
- **System Information Collection**: Gather hardware/OS details from connected devices
- Automatic status updates and device tracking
- Force disconnect via heartbeat response

### Email Services
- Welcome email templates
- Verification code emails
- Customizable Handlebars templates
- SMTP configuration management API with test endpoint
- Dynamic SMTP settings via system settings API

### System Settings
- Generic key-value settings storage
- SMTP configuration management (CRUD with password masking)
- SMTP connection testing

## Tech Stack

| Category | Technology |
|----------|------------|
| **Framework** | NestJS 11 (TypeScript) |
| **Database** | SQLite via TypeORM 0.3 |
| **Authentication** | JWT (passport-jwt), Passport.js |
| **Security** | bcryptjs, otplib (TOTP), @nestjs/throttler |
| **Email** | Nodemailer + Handlebars templates |
| **Image Processing** | sharp (avatar conversion to WebP) |
| **OIDC** | openid-client (Authorization Code Flow + PKCE) |
| **Validation** | class-validator, class-transformer |
| **Utilities** | uuid, dotenv, cookie-parser |
| **Testing** | Jest, supertest |

## Quick Start

### Prerequisites

- **Node.js** >= 18.0.0
- **npm** >= 9.0.0
- **SQLite3** (included as dependency)

### Installation

RustDesk Console provides multiple installation methods to suit different deployment needs:

#### Option 1: Build from Source (Recommended for Development)

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

#### Option 2: Docker Hub

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

**Docker Compose** (recommended for production):

```yaml
version: '3.8'
services:
  rustdesk-console:
    image: databk/rustdesk-console:latest
    container_name: rustdesk-console
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - JWT_SECRET=your-super-secret-key
      - ADMIN_PASSWORD=your-secure-password
    restart: unless-stopped
```

#### Option 3: GitHub Container Registry (ghcr)

For users who prefer GitHub Container Registry or Kubernetes deployments:

```bash
# Pull from GitHub Container Registry
docker pull ghcr.io/databk/rustdesk-console:latest

# Or use in Kubernetes deployment
# image: ghcr.io/databk/rustdesk-console:latest
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

## Project Structure

```
src/
├── main.ts                    # Application entry point
├── app.module.ts              # Root application module
│
├── modules/
│   ├── auth/                  # Authentication & authorization (JWT, TFA, OIDC, email)
│   ├── user/                  # User management (CRUD, avatar, password, admin queries)
│   ├── address-book/          # Address book & device peer management
│   ├── device-group/          # Device grouping & permissions
│   ├── strategy/              # Strategy configuration & assignment
│   ├── audit/                 # Connection/file/alarm/console audit logging
│   ├── heartbeat/             # Device heartbeat monitoring & active connections
│   ├── sysinfo/               # System information collection
│   ├── oidc/                  # OpenID Connect integration (client & web login)
│   ├── dashboard/             # Dashboard statistics & analytics
│   ├── settings/              # System settings (SMTP configuration)
│   └── email/                 # Email services (templates, SMTP)
│
├── common/                    # Shared utilities (guards, decorators, entities)
└── database/                  # Database initialization & seed data
```

## API Endpoints

### Authentication (`/api/`)

| Method | Endpoint | Auth | Rate Limit | Description |
|--------|----------|------|------------|-------------|
| POST | `/api/login` | Public | 5/min | User login (password/email code/TFA) |
| POST | `/api/logout` | Required | - | User logout |
| POST | `/api/currentUser` | Required | - | Get current user info |
| POST | `/api/2fa/setup` | Required | - | Setup 2FA (generate secret & QR) |
| POST | `/api/2fa/verify` | Required | - | Verify and enable 2FA |
| DELETE | `/api/2fa` | Required | - | Disable 2FA |

### Users (`/api/users`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/users` | Required | List accessible users (paginated) |
| POST | `/api/users` | Admin | Create user |
| PATCH | `/api/users/me` | Required | Update current user |
| PATCH | `/api/users/me/password` | Required | Change password |
| POST | `/api/users/me/avatar` | Required | Upload avatar (max 2MB, WebP) |
| DELETE | `/api/users/me/avatar` | Required | Delete avatar |
| POST | `/api/users/invite` | Admin | Invite user via email |
| PATCH | `/api/users/batch/status` | Admin | Batch update user status |
| PATCH | `/api/users/batch/security` | Admin | Batch update security settings |
| DELETE | `/api/users/batch/sessions` | Admin | Batch force logout |
| GET | `/api/users/:guid` | Admin | Get user details |
| PATCH | `/api/users/:guid` | Admin | Update user |
| DELETE | `/api/users/:guid` | Admin | Delete user |
| PATCH | `/api/users/:guid/security` | Admin | Update user security settings |
| DELETE | `/api/users/:guid/sessions` | Admin | Force logout user |

### Admin Users (`/api/admin/users`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/admin/users` | Admin | List admin users (paginated) |

### Avatars (`/api/avatars`)

| Method | Endpoint | Auth | Rate Limit | Description |
|--------|----------|------|------------|-------------|
| GET | `/api/avatars/:filename` | Public | 60/min | Get avatar file |

### Address Book (`/api/ab`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET/POST | `/api/ab` | Required | Get/update legacy address book |
| POST | `/api/ab/settings` | Required | Get address book settings |
| GET/POST | `/api/ab/personal` | Required | Get personal address book GUID |
| GET/POST | `/api/ab/shared/profiles` | Required | List shared address books |
| POST | `/api/ab/shared/add` | Required | Add shared address book |
| PUT | `/api/ab/shared/update/profile` | Required | Update shared address book |
| DELETE | `/api/ab/shared` | Required | Delete shared address book |
| GET/POST | `/api/ab/peers` | Required | List address book peers |
| POST | `/api/ab/peer/add/:guid` | Required | Add peer to address book |
| PUT | `/api/ab/peer/update/:guid` | Required | Update peer |
| DELETE | `/api/ab/peer/:guid` | Required | Delete peer |
| POST | `/api/ab/tag/add/:guid` | Required | Add tag |
| PUT | `/api/ab/tag/rename/:guid` | Required | Rename tag |
| PUT | `/api/ab/tag/update/:guid` | Required | Update tag color |
| DELETE | `/api/ab/tag/:guid` | Required | Delete tag |
| GET | `/api/ab/rules` | Required | List access rules |
| POST | `/api/ab/rule` | Required | Add rule |
| PATCH | `/api/ab/rule` | Required | Update rule |
| DELETE | `/api/ab/rules` | Required | Delete rule |

### Device Groups (`/api/device-groups`, `/api/devices`, `/api/peers`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/device-group/accessible` | Required | List accessible device groups |
| GET | `/api/peers` | Required | List accessible devices |
| GET | `/api/device-groups` | Admin | List all device groups |
| POST | `/api/device-groups` | Admin | Create device group |
| PATCH | `/api/device-groups/:guid` | Admin | Update device group |
| DELETE | `/api/device-groups/:guid` | Admin | Delete device group |
| POST | `/api/device-groups/:guid` | Admin | Add device to group |
| DELETE | `/api/device-groups/:guid/devices` | Admin | Remove device from group |
| GET | `/api/devices` | Required | List devices |
| POST | `/api/devices/:guid/disable` | Admin | Disable device |
| POST | `/api/devices/:guid/enable` | Admin | Enable device |
| PATCH | `/api/devices/status` | Admin | Batch update device status |
| DELETE | `/api/devices/:guid` | Admin | Delete device |
| POST | `/api/devices/:guid/assign` | Admin | Assign device attributes |
| POST | `/api/devices/:uuid/disconnect` | Admin | Force disconnect device |

### Strategies (`/api/strategies`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/strategies` | Admin | List strategies (paginated, searchable) |
| GET | `/api/strategies/:guid` | Admin | Get strategy details |
| POST | `/api/strategies` | Admin | Create strategy |
| PATCH | `/api/strategies/:guid` | Admin | Update strategy |
| DELETE | `/api/strategies/:guid` | Admin | Delete strategy |
| POST | `/api/strategies/:guid/assign` | Admin | Assign strategy to targets |
| POST | `/api/strategies/:guid/unassign` | Admin | Unassign strategy from targets |

### Audit (`/api/audit`, `/api/audits`)

| Method | Endpoint | Auth | Rate Limit | Description |
|--------|----------|------|------------|-------------|
| POST | `/api/audit/conn` | Public | 50/min | Record connection audit |
| POST | `/api/audit/file` | Public | 50/min | Record file audit |
| POST | `/api/audit/alarm` | Public | 50/min | Record alarm audit |
| GET | `/api/audits/conn` | Admin | - | Query connection audits |
| PATCH | `/api/audits/conn/:id` | Admin | - | Update connection audit (note) |
| GET | `/api/audits/file` | Admin | - | Query file audits |
| GET | `/api/audits/alarm` | Admin | - | Query alarm audits |
| GET | `/api/audits/console` | Admin | - | Query console audits |

### Heartbeat (`/api/heartbeat`)

| Method | Endpoint | Auth | Rate Limit | Description |
|--------|----------|------|------------|-------------|
| POST | `/api/heartbeat` | Public | 10/min | Submit device heartbeat |

### System Info (`/api/sysinfo`)

| Method | Endpoint | Auth | Rate Limit | Description |
|--------|----------|------|------------|-------------|
| POST | `/api/sysinfo` | Public | 5/min | Submit device system info |

### OIDC (`/api/oidc`, `/api/oidc-providers`)

| Method | Endpoint | Auth | Rate Limit | Description |
|--------|----------|------|------------|-------------|
| GET | `/api/login-options` | Public | 20/min | Get login options |
| POST | `/api/oidc/auth` | Public | 5/min | Request OIDC authorization |
| GET | `/api/oidc/auth-query` | Public | 120/min | Query OIDC auth status |
| GET | `/api/oidc/callback` | Public | 20/min | OIDC callback (client & web) |
| GET | `/api/oidc-providers` | Admin | - | List OIDC providers |
| GET | `/api/oidc-providers/:guid` | Admin | - | Get OIDC provider |
| POST | `/api/oidc-providers` | Admin | - | Create OIDC provider |
| PATCH | `/api/oidc-providers/:guid` | Admin | - | Update OIDC provider |
| DELETE | `/api/oidc-providers/:guid` | Admin | - | Delete OIDC provider |
| PATCH | `/api/oidc-providers/:guid/toggle` | Admin | - | Toggle OIDC provider |
| POST | `/api/oidc-providers/:guid/test` | Admin | - | Test OIDC connection |

### Dashboard (`/api/dashboard`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/dashboard/overview` | Required | Overview statistics |
| GET | `/api/dashboard/statistics` | Required | Detailed statistics |
| GET | `/api/dashboard/trends` | Required | Trend data (7d/30d/90d) |
| GET | `/api/dashboard/realtime` | Required | Real-time data |

### Settings (`/api/settings`)

| Method | Endpoint | Auth | Rate Limit | Description |
|--------|----------|------|------------|-------------|
| GET | `/api/settings/smtp` | Admin | - | Get SMTP config (password masked) |
| PUT | `/api/settings/smtp` | Admin | - | Create/update SMTP config |
| POST | `/api/settings/smtp/test` | Admin | 5/min | Test SMTP connection |

## Environment Configuration

Copy `.env.example` to `.env` and configure the following variables:

```env
# Server Configuration
PORT=3000                          # API server port

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-in-production  # Secret key for signing JWTs

# Default Admin Account (auto-created on first run)
ADMIN_USERNAME=admin               # Default admin username
ADMIN_EMAIL=admin@example.com      # Default admin email
ADMIN_PASSWORD=admin123            # Default admin password (CHANGE IN PRODUCTION!)

# Database Configuration
# Currently uses SQLite (rustdesk.db file in project root)
# To use PostgreSQL/MySQL, modify TypeORM config in src/app.module.ts

# SMTP Configuration (for email verification & notifications)
SMTP_HOST=smtp.example.com        # SMTP server hostname
SMTP_PORT=587                     # SMTP port (587 for TLS, 465 for SSL)
SMTP_SECURE=false                 # Use true for SSL/TLS
SMTP_USER=your-email@example.com  # SMTP username
SMTP_PASS=your-email-password     # SMTP password
SMTP_FROM="No Reply" <noreply@example.com>  # Sender display name & email

# OIDC Configuration
# OIDC_REDIRECT_URI=http://localhost:3000    # Base URL for OIDC callback

# Web Frontend URLs (comma-separated)
# Allowed URLs for OIDC web login callbackUrl parameter
WEB_FRONTEND_URLS=http://localhost:5173
```

> **Security Note**: Always change default passwords and JWT secrets before deploying to production!

## Database

The application uses **SQLite** as the default database engine (file: `rustdesk.db` in project root), managed by **TypeORM 0.3**.

**Core Data Models Include:**
- User accounts, tokens & avatars
- Address books, peers, tags & access rules
- Device groups & permissions
- Strategies & assignments
- Audit logs (connections, file transfers, alarms, console)
- Active connections
- Device system information & heartbeats
- OIDC provider configurations & auth states
- Email verification sessions
- System settings

> **Configuration**: Database settings can be modified in [`src/app.module.ts`](src/app.module.ts). The application supports migration to PostgreSQL or MySQL for production deployments requiring higher concurrency.

## Security Features

### Authentication Flow
1. User submits credentials to `POST /api/login`
2. Server validates credentials (with optional TFA check)
3. Returns JWT access token + refresh token
4. Client includes Bearer token in Authorization header for subsequent requests
5. Token is validated on each request via `JwtAuthGuard`
6. Token can be revoked via `POST /api/logout` (JTI blacklist)

### 2FA Flow
1. User calls `POST /api/2fa/setup` to generate TOTP secret and QR code URL
2. User verifies with `POST /api/2fa/verify` to bind the 2FA secret
3. On login, if 2FA is enabled, server returns `tfa_check` response
4. Client submits TFA code to complete login
5. Admins can enforce 2FA for users; enforced users cannot disable 2FA themselves

### Rate Limiting Strategy
- **Global**: 100 requests per minute per IP
- **Login endpoint**: 5 attempts per minute (brute force protection)
- **Heartbeat submissions**: 10 per minute per device
- **System info submissions**: 5 per minute per device
- **Audit recording**: 50 per minute
- **Avatar access**: 60 per minute
- **OIDC auth query**: 120 per minute

### Security Layers
- **JwtAuthGuard**: Global JWT authentication (bypassed via `@Public()` decorator)
- **AdminGuard**: Restricts sensitive endpoints to admin users only
- **ThrottlerGuard**: Global rate limiting protection
- **DeviceThrottlerGuard**: Specialized rate limiting for device endpoints
- **ValidationPipe**: Global input validation with auto-whitelisting and transformation
- **CORS**: Configured to allow all origins (restrict in production)

## Development

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
- **Commit Messages**: Follow [Conventional Commits](https://www.conventionalcommits.org/)

## Deployment Considerations

### Production Checklist
- [ ] Change `JWT_SECRET` to a strong random value (min 32 chars)
- [ ] Change default admin password in `.env`
- [ ] Configure production SMTP settings
- [ ] Set `synchronize: false` in TypeORM config and use migrations
- [ ] Configure CORS origins to your frontend domain only
- [ ] Set up HTTPS/reverse proxy (nginx, Apache, etc.)
- [ ] Configure backup strategy for SQLite database
- [ ] Set up process manager (PM2, systemd) for auto-restart
- [ ] Review and adjust rate limiting for your traffic patterns
- [ ] Enable proper logging (currently disabled: `logging: false`)
- [ ] Configure `WEB_FRONTEND_URLS` for OIDC web login

### Scaling Notes
- **SQLite Limitations**: Single-writer, suitable for small-medium deployments (< 100 concurrent users)
- **For High Availability**: Migrate to PostgreSQL with connection pooling
- **Horizontal Scaling**: Consider Redis for session/token storage if running multiple instances
- **Performance**: Enable WAL mode for better SQLite read concurrency

## Contributing

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

## License

This project is licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0) - see [LICENSE](LICENSE) file for details.

## Additional Resources

- [NestJS Documentation](https://docs.nestjs.com/) - Framework documentation
- [TypeORM Documentation](https://typeorm.io/) - ORM documentation
- [RustDesk Official Site](https://rustdesk.com/) - Main product information
- [Passport.js Documentation](http://www.passportjs.org/) - Authentication middleware

---

<p align="center">
  <strong>Built with NestJS | The RustDesk Console Backend</strong>
</p>
