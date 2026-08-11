# Releasing (Maintainers)

This is the internal maintainer workflow for shipping changes to staging and
production and rolling them back. There is no manual version/tag step — `main`
is the release branch, and merging is the release.

## How a change ships

1. Open a maintainer PR from within the organization. CI (`CI`, `Security`,
   `React Doctor`) runs on the PR; a `terraform/**` change also posts a
   `terraform plan` comment.
2. Merge to `main`. On push to `main`:
   - **`deploy.yml`** deploys the Vercel apps (`tokens-api`, `tokens-app`) to staging,
     runs a staging smoke check, then promotes to production and runs a production
     canary. If the canary fails it auto-rolls-back the affected Vercel alias.
   - **`tokens-web` and `tokens-docs`** deploy via Vercel's native Git integration on
     the same push.
   - **`terraform.yml`** applies infra changes (staging, then production) when
     `terraform/**` changed.
   - **`grafana-push.yml`** syncs dashboards, alert rules, and notification policies
     when those paths changed.
3. Watch the `deploy.yml` run and the Slack deploy channel through the canary.

## Deploying a single Cloud Run service

Use the **`cloudrun-deploy.yml`** workflow (`workflow_dispatch`) with `env` (`stg`/`prd`)
and `service` (`assets`/`prices`/`usage`/`admin`) — e.g. to redeploy one backend service
without a full pipeline run.

## Rolling back

- **Vercel (web/api/app):** run **`rollback.yml`** (`workflow_dispatch`). It repoints the
  production alias to the previous READY deployment. `deploy.yml` also auto-rolls-back on a
  failed production canary.
- **Cloud Run:** redeploy the last-good image via `cloudrun-deploy.yml`, or roll traffic
  back to the previous revision in the Cloud Run console.
- **Terraform:** revert the offending change on `main` and let `terraform.yml` re-apply.

## Before you merge

```bash
bun run check:repo-hygiene
bun run verify:api-health-routes
bun run lint
bun run build
bun run audit:deps
```

## Do Not Deploy If

- CI is red on the PR, or the `terraform plan` shows unexpected destroys.
- `gitleaks` (the `Security` workflow) reports an unresolved secret.
- A new bundled asset has unclear redistribution terms (see `THIRD_PARTY_LICENSES.md`).
- The change touches auth, the platform-API proxy, or credentials without review from a
  maintainer familiar with that surface.
