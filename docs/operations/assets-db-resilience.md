# Assets database resilience rollout

The application changes in this repository are intended to tolerate chronic PostgreSQL connection resets. They do not assume that Direct VPC is the sole root cause.

## Release order

1. Deploy the application image to staging. Confirm `/startup` returns 200 and `/health` remains process-only.
2. Load-test `assetsApiCuratedPrefetchForApi` at 150 requests/second for five minutes (45,000 requests) with `scripts/loadtest-assets-resilience.js`.
3. Merge the phase-one PR. Production deploys the new assets revision with zero traffic; Terraform deliberately leaves `enable_assets_db_startup_probe` and `enable_assets_worker` false so its concurrent apply cannot race the application deploy.
4. Copy the candidate revision from the deployment workflow summary. Promote it one stage at a time with `scripts/promote-assets-revision.sh <candidate> 10`, then `50`, then `100`. Record the stable revision printed by the script.
5. Observe at least 15 minutes at each stage. Roll back with `scripts/promote-assets-revision.sh <candidate> rollback <stable>` if assets 5xx exceeds 1%, connection errors or latency regress, memory crosses the current envelope, or stale responses rise unexpectedly.
6. After the candidate has remained healthy at 100%, set `enable_assets_db_startup_probe = true` and `enable_assets_worker = true` in a small phase-two Terraform PR. Do not route jobs yet.
7. Apply phase two, sync and smoke-test the worker, then set `route_assets_jobs_to_worker = true` in a final routing change.

Before each promotion, verify the candidate revision is Ready. During each 15-minute observation window check the Assets DB resilience dashboard, Cloud Run instance/memory metrics, and Cloud SQL connections. Do not continue merely because the deployment workflow is green—the workflow smoke test still exercises the stable production URL while the candidate has zero or partial traffic.

Do not restart the service during a diagnostic recurrence unless user-facing 5xx impact requires emergency mitigation. A restart destroys evidence and is only a mitigation.

## Worker cutover

The isolated worker is deliberately a two-step Terraform rollout because several provider credentials are currently managed outside Terraform.

1. Set `enable_assets_worker = true` and leave `route_assets_jobs_to_worker = false`; apply Terraform.
2. Run `scripts/sync-assets-worker-env.sh` for the target project. The script copies values without printing them, sets the worker's OIDC audience to its own URL, and restores Secret Manager references.
3. Invoke one low-impact worker job with Scheduler identity and verify its logs and `application_name=cloudrun-assets-jobs` database attribution.
4. Set `route_assets_jobs_to_worker = true` and apply Terraform.
5. Confirm the API role returns 404 for `/jobs/*` and the worker returns 404 for `/query/*` and `/mutation/*`.

## Transport canaries

Run the **DB transport canaries** workflow with action `deploy`. It creates three one-instance services:

- Bun/postgres.js over Direct VPC.
- Bun/postgres.js over Serverless VPC Access.
- Node 22/postgres.js over Direct VPC.

Each opens ten fresh connections per minute and records TCP, TLS, first-connect/query, and warm-query timings. Remove the canaries after attribution to stop connector, Cloud Run, Scheduler, and logging costs.

Interpretation:

- Connector succeeds while Bun/Direct fails: migrate the assets service away from Direct VPC.
- Node/Direct succeeds while Bun/Direct fails: move to Node or validate a fixed Bun/postgres.js version.
- Both alternatives fail: escalate to Google Cloud with flow, TLS, revision, and source-IP evidence.
- All succeed while production fails: reproduce composite-query fan-out under controlled load.

Application hardening and last-good caching remain required regardless of the canary result.
