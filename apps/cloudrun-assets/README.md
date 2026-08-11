# @tokens/cloudrun-assets

Cloud Run service that handles the `assets` slice of the Convex → GCP migration. Implements the wire format that `apps/api/src/lib/cloudrun/CloudRunClient` calls into.

## Wire format

`POST /query/{name}` and `POST /mutation/{name}`, JSON body, `Authorization: Bearer <TOKENS_CLOUDRUN_AUTH_TOKEN>`. `GET /healthz` for the Cloud Run startup/liveness probe.

The query names match the corresponding Convex export names (e.g. `getByAssetId`) so callers in `apps/api` can swap `fetchQuery(api.assets.getByAssetId, args)` for `client.query('assets', 'getByAssetId', args)`.

## Implemented

| Name | Kind | Status |
| --- | --- | --- |
| `getByAssetId` | query | template, parity with `convex/assets.ts:getByAssetId` minus the `imageStorageId` lookup (dropped during migration) |

The remaining `assets.*`, `assetVariants.*`, `assetMarkets.*` functionality will
be implemented incrementally by the maintainers.

## Env

| Var | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Cloud SQL Postgres connection string |
| `TOKENS_CLOUDRUN_AUTH_TOKEN` | yes | Shared bearer token with the `CloudRunClient` caller |
| `PORT` | no | Defaults to 8080 (Cloud Run's default) |
| `PG_POOL_MAX` | no | postgres-js connection pool size, default 10 |
| `PG_IDLE_TIMEOUT` | no | seconds, default 30 |
| `TOKENS_ADMIN_CLERK_USER_IDS` | no | Comma-separated Clerk user id allowlist for the `/mutation/admin*` endpoints; when empty every admin call is rejected (403) |

## Local dev

```bash
DATABASE_URL=postgres://... TOKENS_CLOUDRUN_AUTH_TOKEN=dev \
    bun run apps/cloudrun-assets/src/index.ts
```

## Tests

```bash
bun test apps/cloudrun-assets/src
```

Handlers take a stub `AssetsRepo` so tests don't need a live Postgres.
