# Contributing to Tokens

This repository is the live, multi-app monorepo behind Tokens, and contributions are welcome. Changes should preserve the separation between public product surfaces, the platform API, and authenticated operational tooling.

We triage issues and review pull requests on a regular cadence. We can't promise a fixed response time, but issues and PRs are read — please be patient and feel free to bump a stale thread. For anything security-sensitive, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Getting Started

1. Fork and clone the repository.

```bash
git clone https://github.com/<your-username>/tokens.git
cd tokens
```

2. Install dependencies.

```bash
bun install
```

3. Create local env files from the checked-in templates.

```bash
cp .env.example .env.local
cp apps/api/.env.example apps/api/.env.local
cp apps/app/.env.example apps/app/.env.local
cp apps/admin/.env.example apps/admin/.env.local
cp apps/web/.env.example apps/web/.env.local
```

4. Fill in only the env vars required for the apps you are running.
5. Start development.

```bash
bun dev
```

6. Create a branch for your work.

```bash
git checkout -b feature/your-feature-name
```

## Project Structure

- `apps/web/`: public website
- `apps/docs/`: documentation site
- `apps/api/`: platform API and internal helper routes
- `apps/app/`: authenticated dashboard for projects, API keys, and usage
- `apps/admin/`: authenticated admin tooling for curated assets
- `apps/cloudrun-*/`: backend services (assets, prices, usage, admin) behind the API
- `packages/`: shared packages used by multiple apps
- `db/`: SQL schema and ordered migrations (Postgres)
- `terraform/`: infrastructure-as-code for staging/production
- `scripts/`: verification, seeding, and maintenance scripts

## Development Expectations

- Use TypeScript for new code.
- Follow the existing formatting and linting rules.
- Keep public API contracts stable unless a breaking change is intentional and documented.
- Treat admin and operational code as security-sensitive. Enforce authorization server-side, not only in UI state.
- Never commit credentials, `.env.local` files, or assistant/tooling artifacts.
- This is a public repository: never include real endpoints, tokens, Terraform plan/state files, or `.env` values in code, fixtures, commit messages, or PR descriptions. Use placeholders following the existing `*.example.run.app` / `.env.example` convention. A tracked pre-commit hook (`.githooks/pre-commit`, wired up by `bun install`) runs `gitleaks protect --staged` when gitleaks is installed locally; CI re-scans the tree and full history either way.
- Do not treat `apps/admin` as a public anonymous surface. It is an authenticated maintainer tool.
- Avoid adding vendored third-party assets unless redistribution terms are documented in `THIRD_PARTY_LICENSES.md`.

## Before Submitting

```bash
bun run check:repo-hygiene
bun run verify:api-health-routes
bun run lint
bun run build
```

If you touched dependency versions or security-sensitive paths, also run:

```bash
bun run audit:deps
```

## Pull Requests

- Explain what changed and why.
- Link related issues when applicable.
- Keep PRs focused and reviewable.
- Update docs when behavior, setup, or public contracts change.
- Call out security, auth, proxy, or dependency-risk changes explicitly.
- Note whether tests or smoke checks were added or updated.

## Bug Reports

Include:

- A clear description of the issue
- Steps to reproduce
- Expected vs actual behavior
- Environment details
- Relevant logs or errors, with secrets redacted

For security reports, do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
