# Token Radar

Token Radar turns the Solana Foundation Tokens repository into a live market
intelligence system for tokenized assets.

The original Tokens experience answers, “What assets exist and where can I find
them?” This fork answers, “What is happening across those assets right now?”

It is an analytics and discovery product. It does not recommend buying,
selling, or trading.

## What changed

- A live radar field that spatializes the most active canonical assets.
- Deterministic sections for moving assets, volume spikes, current liquidity
  depth, positive momentum, cooling activity, and representation tier.
- A snapshot-signal feed derived from real thresholds, never generated events.
- Asset investigation pages with current price, activity, volume, liquidity,
  trust context, and a plain-language metric summary.
- An asset-family map connecting a canonical asset to every Solana
  representation, including per-variant market data and cached trading
  destinations.
- A transparent 0–100 Radar Score with every component visible.
- A price-and-volume Signal Tape with a draggable cursor.
- Downloadable 1200×630 per-asset Radar cards rendered with the repository's
  existing `html-to-image` dependency.
- Purposeful loading, empty, error, keyboard, reduced-motion, and mobile states.

The rest of the monorepo remains intact: the API, services, shared packages,
database schema, infrastructure, admin app, API manager, and docs can continue
to evolve independently.

## Why this is Live Radar, not full Market Replay

The repository stores OHLCV candles, so price and candle volume can be rewound.
It stores liquidity only in latest-snapshot tables. A historical cursor cannot
truthfully update past liquidity, representation trust, or liquidity-change
events.

Token Radar therefore uses:

- live snapshots for liquidity, trust, trades, wallets, and current activity;
- historical OHLCV only for the asset page's price-and-volume Signal Tape; and
- explicit labeling whenever a value remains a live snapshot.

It never fabricates liquidity expansion, liquidity contraction, or an exact
event time that the data does not support. See
[the reconnaissance note](docs/token-radar-reconnaissance.md) for the complete
source-level findings.

## Architecture

The smallest production deployment is the existing public web application:

```text
Browser
  └─ apps/web (Next.js on Vercel)
       ├─ /api/v1/* same-origin, server-side proxy
       ├─ @tokens/asset-registry (canonical assets + representations)
       └─ https://api.tokens.xyz/v1 (hosted Tokens API)
```

This deployment does **not** require the fork to run Cloud Run, Postgres,
ClickHouse, Redis, Clerk, or provider ingestion jobs. The Vercel server keeps
the Tokens API key out of the browser and preserves the existing cache policy.

### Reused repository systems

| Need | Existing system used |
| --- | --- |
| Canonical assets and variants | `@tokens/asset-registry` |
| Current activity | `/v1/assets/trending` |
| Asset and variant snapshots | `/v1/assets/:assetId` |
| Trading destinations | `/v1/assets/:assetId/variant-top-markets` |
| Historical price and volume | `/v1/assets/:assetId/price-chart` |
| Browser data fetching | Effect API client + TanStack Query |
| Logos and remote images | existing normalization and image proxy |
| Share images | existing `html-to-image` dependency |
| UI foundations | shared Tokens/Solana design-system styles |

### Data freshness

- The Radar client refreshes the trending snapshot every 30 seconds while the
  page is active.
- The upstream trending API is dynamic with a 30-second cache policy.
- Asset and OHLCV proxy responses generally use a 60-second cache window;
  OHLCV can serve stale data while revalidating.
- The UI displays provider timestamps when they exist.

## Radar Score methodology

Radar Score means “notable current activity,” not “good investment.” Missing
metrics contribute zero rather than being estimated.

| Component | Weight | Deterministic input |
| --- | ---: | --- |
| Activity | 30% | Log-scaled 1h volume (45%), trades (30%), and unique wallets (25%) |
| Volume acceleration | 25% | `volume1h / (volume24h / 24)`, mapped from 0.5× to 4× |
| Liquidity | 20% | Log-scaled current on-chain liquidity from $10k to $20m |
| Price movement | 15% | Absolute reported 1h change, capped at 5% |
| Representation tier | 10% | Current liquidity-derived tier: 100 / 68 / 36, or 20 if unrated |

The executable formula and comments live in
`apps/web/src/lib/radar.ts`, with tests in `radar.test.ts`.

### Signal thresholds

- **Volume spike:** 1h volume pace is at least 2× the asset's own 24h hourly
  baseline.
- **Positive momentum:** reported 1h price change is at least +1%.
- **Cooling:** reported 1h price change is at most −1%.
- **Unusual activity:** Radar Score is at least 78 and no more specific signal
  already applies.

Signals are snapshot classifications. The displayed time is the latest usable
trade/snapshot timestamp, not a claim about the exact millisecond a threshold
was crossed.

## Local development

Requirements: Bun 1.3.6+ and Node.js 20+.

```bash
bun install
cp apps/web/.env.example apps/web/.env.local
bun run --cwd apps/web dev
```

Open [http://localhost:3000](http://localhost:3000).

Set these values in `apps/web/.env.local`:

```dotenv
NEXT_PUBLIC_SITE_URL=http://localhost:3000
API_BASE_URL=https://api.tokens.xyz
TOKENS_PLATFORM_API_KEY=your_server_side_tokens_api_key
```

Create/manage the key through the Tokens API Manager. It needs the
`assets:read` scope. Never prefix it with `NEXT_PUBLIC_` and never commit
`.env.local`.

Without data configuration, the shell, methodology, and deliberate error
states still render; live values remain unavailable instead of falling back to
sample or random data.

### Relevant checks

```bash
bun run --cwd apps/web typecheck
bun run --cwd apps/web lint
bun run --cwd apps/web test
bun run --cwd apps/web build
```

Run the whole monorepo when changing shared or backend code:

```bash
bun run typecheck
bun run lint
bun run test
bun run build
```

## Deploying the frontend to Vercel

1. Import the repository into Vercel.
2. Select `apps/web` as the Root Directory and enable access to source files
   outside the Root Directory so workspace packages resolve.
3. Keep Bun as the package manager and use the workspace `build` script (`next build --webpack`).
4. Add `NEXT_PUBLIC_SITE_URL`, `API_BASE_URL=https://api.tokens.xyz`, and
   `TOKENS_PLATFORM_API_KEY` to the Production environment.
5. Deploy, then set `NEXT_PUBLIC_SITE_URL` to the final HTTPS origin and
   redeploy so canonical and social metadata use the correct host.

No secrets belong in `vercel.json`, source files, client-side variables, or
Git history.

## Environment variables

| Variable | Required for Radar | Exposure | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Yes in production | Public | canonical URLs and social metadata |
| `API_BASE_URL` | Yes | Server only | hosted Tokens API origin |
| `TOKENS_API_ORIGIN` | Alternative | Server only | fallback alias for the API origin |
| `TOKENS_PLATFORM_API_KEY` | Yes | Server only | authenticated `assets:read` requests |
| `NEXT_PUBLIC_POSTHOG_*` | No | Public | optional analytics |
| `BIRDEYE_API_KEY`, `COINGECKO_API_KEY`, `DD_API_KEY` | No | Server only | only needed for legacy/direct helper routes, not the minimal Radar path |

The documented external contract is `https://api.tokens.xyz/v1` and requires
an API key. Internal `/api/v1/*` paths on a Tokens web deployment are proxy
implementation details and should not be treated as a stable anonymous API.

## Data limitations

- Trending is a cached top-50 representation sample, not every Solana asset.
- The homepage keeps the highest-scoring representation per canonical asset.
- Liquidity is a current snapshot; there is no liquidity time series.
- OHLCV coverage varies by asset and can be empty while background warming runs.
- Provider timestamps and refresh cadence vary; the UI shows what is available.
- Registry tiers are curation/market-ranking context, not smart-contract or
  issuer audits.
- Risk-helper inputs such as holder concentration are not guaranteed on the
  lightweight Radar path, so Radar does not synthesize them.
- Volume pace uses the current rolling 1h window against the rolling 24h hourly
  average. It is a useful acceleration signal, not a seasonality model.

## Original repository and attribution

Token Radar is a fork of the
[Solana Foundation Tokens repository](https://github.com/solana-foundation/tokens).
The UI includes “Data provided by Tokens” attribution and preserves the
original monorepo structure where practical.

The original repository is MIT licensed. The existing [LICENSE](LICENSE),
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md), and attribution files remain
intact. Tokens, Solana, provider names, and third-party assets remain subject to
their respective rights and terms.
