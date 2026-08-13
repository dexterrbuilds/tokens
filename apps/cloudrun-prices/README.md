# @tokens/cloudrun-prices

Cloud Run service that handles the `prices` slice of the Convex → GCP migration. Implements the wire format that `apps/api/src/lib/cloudrun/CloudRunClient` calls into.

## Wire format

`POST /query/{name}` and `POST /mutation/{name}`, JSON body, `Authorization: Bearer <TOKENS_CLOUDRUN_AUTH_TOKEN>`. `GET /healthz` for the Cloud Run startup/liveness probe.

The query names match the corresponding Convex export names (e.g. `getLatestByCoinId`) so callers in `apps/api` can swap `fetchQuery(api.coingeckoPrices.getLatestByCoinId, args)` for `client.query('prices', 'getLatestByCoinId', args)`.

## Implemented

| Name | Kind | Status |
| --- | --- | --- |
| `getLatestByCoinId` | query | template, parity with `convex/coingeckoPrices.ts:getLatestByCoinId` |

The remaining `coingeckoPrices.*`, `coingeckoCoins.*`, `coingeckoTickers.*`,
`coingeckoOhlcv.*`, and related functionality will be implemented incrementally
by the maintainers.

## Env

| Var | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Cloud SQL Postgres connection string |
| `TOKENS_CLOUDRUN_AUTH_TOKEN` | yes | Shared bearer token with the `CloudRunClient` caller |
| `PORT` | no | Defaults to 8080 (Cloud Run's default) |
| `PG_POOL_MAX` | no | postgres-js connection pool size, default 10 |
| `PG_IDLE_TIMEOUT` | no | seconds, default 30 |

## Local dev

```bash
DATABASE_URL=postgres://... TOKENS_CLOUDRUN_AUTH_TOKEN=dev \
    bun run apps/cloudrun-prices/src/index.ts
```

## Tests

```bash
bun test apps/cloudrun-prices/src
```

Handlers take a stub `PricesRepo` so tests don't need a live Postgres.
