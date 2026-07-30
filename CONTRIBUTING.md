# Contributing to RustDesk Console

Thank you for your interest in contributing! This guide covers the essentials for getting started.

## Development Setup

**Prerequisites**: Node.js ≥ 20.0.0, npm ≥ 9.0.0

```bash
git clone https://github.com/databk/rustdesk-console.git
cd rustdesk-console
npm install
cp .env.example .env   # edit .env as needed
npm run start:dev
```

| Command | Description |
|---------|-------------|
| `npm run start:dev` | Start with watch mode |
| `npm run lint` | Run ESLint (with auto-fix) |
| `npm run format` | Run Prettier |
| `npm test` | Run unit tests |
| `npm run test:cov` | Run tests with coverage |
| `npm run test:e2e` | Run e2e tests |
| `npm run build` | Production build |

## Code Style

This project uses [ESLint](https://eslint.org/) and [Prettier](https://prettier.io/) for code quality and formatting. Project-specific Prettier rules:

- Single quotes
- Trailing commas (`all`)

Run `npm run lint` before committing to catch issues early.

## Commit Convention

This project follows [Conventional Commits](https://www.conventionalcommits.org/). Commit messages must use the format:

```
<type>(<scope>): <description>
```

Common types used in this project:

| Type | Usage |
|------|-------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation changes |
| `refactor` | Code refactoring (no behavior change) |
| `chore` | Build, dependencies, CI, etc. |
| `test` | Adding or updating tests |

The `scope` is optional but recommended — use the module name (e.g., `auth`, `oidc`, `device`).

## Pull Requests

1. Fork the repository and create a branch from `main`
2. Make your changes with clear, conventional commits
3. Ensure all CI checks pass (lint, typecheck, build)
4. Open a PR against `main` with a clear description of the change

PRs are squash-merged. Your PR title should follow the same Conventional Commits format.

## Reporting Issues

- **Bugs / Feature requests**: Open a [GitHub Issue](https://github.com/databk/rustdesk-console/issues/new)
- **Security vulnerabilities**: Use [GitHub Security Advisory](https://github.com/databk/rustdesk-console/security/advisories/new) — do not report security issues in public issues
