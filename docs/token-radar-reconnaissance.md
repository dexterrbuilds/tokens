# Token Radar repository reconnaissance

This note records the source-level decisions behind the Token Radar fork. It is
intentionally specific about what the repository supports and what the product
does not claim.

## Findings

1. **Assets:** `@tokens/asset-registry` models a canonical `CanonicalAsset`
   with a stable `assetId`, category, aliases, optional CoinGecko ID, and
   `AssetVariant[]`.
2. **Representations:** each `AssetVariant` has a stable `variantId`, Solana
   mint, kind, issuer metadata, tags, and a registry tier. Mint-to-canonical
   matching is deterministic and duplicate mints require an explicit home-hub
   override.
3. **Current prices:** cached variant market snapshots expose `price` from
   Birdeye, RWA.xyz, or materialized ClickHouse trades. Canonical crypto prices
   can come from CoinGecko; public equities can use ClickHouse stock data.
4. **Historical prices:** `/v1/assets/:assetId/price-chart` returns canonical
   OHLCV and can fall through from stock or CoinGecko history to the selected
   on-chain variant. `/ohlcv` is the mint-scoped equivalent.
5. **Volume:** current snapshots expose 5m, 15m, 1h, 6h, and 24h volume when
   ClickHouse-derived metrics are present. OHLCV candles also include USD
   volume.
6. **Liquidity:** `variant_markets_latest` and `asset_markets_latest` store the
   latest liquidity snapshot. There is no historical liquidity table or public
   liquidity time series.
7. **Trust and risk:** registry `trustTier` remains available but currently
   mirrors market-derived liquidity tiers and is deprecated as a general trust
   concept. The separate risk helpers can compute a market grade from
   liquidity, market cap, holders, concentration, volume, and token age when
   those inputs are cached. Token Radar labels representation tier explicitly and
   never presents it as an audit.
8. **Public APIs:** the documented stable contract is
   `https://api.tokens.xyz/v1`. Asset endpoints require a server-side
   `x-api-key` with `assets:read`. The web app's `/api/v1/*` routes are an
   internal same-origin proxy, not the external contract.
9. **Reusable components:** the fork retains the query provider, image proxy,
   token logo normalization, metadata/OG infrastructure, share-image
   dependency, error envelopes, and the original chart/data primitives.
10. **Reusable hooks:** `useTrendingTokens`, `useAssetPriceChart`,
    `useAssetOHLCV`, `useOHLCV`, and the Effect-based API client already match
    the needed surfaces.
11. **Existing visualizations:** `liveline` price charts, inline charts,
    timeframe controls, animated prices, and HTML-to-image share cards already
    exist. Token Radar adds an instrument-like radar field and a bounded
    price/volume cursor rather than duplicating the chart backend.
12. **Freshness and caching:** trending is force-dynamic at the API and cached
    for up to 30 seconds; asset and chart proxies generally use 60-second CDN
    windows, with OHLCV allowing stale-while-revalidate. Provider snapshots
    include `lastFetchedAt`, `lastTradeAt`, and/or `asOf`.
13. **Replay feasibility:** OHLCV is sufficient for price and candle-volume
    rewind. It is not sufficient for full market replay because historical
    liquidity, trust, representation membership, and exact signal-crossing
    timestamps are not stored.
14. **Vercel boundary:** `apps/web` is already a Vercel-targeted Next.js app.
    It can call the hosted Tokens API through its server-side proxy and does not
    need Postgres, ClickHouse, Redis, Cloud Run, Clerk, or provider credentials.
15. **Required environment:** the minimal deployment needs
    `NEXT_PUBLIC_SITE_URL`, `API_BASE_URL` (or `TOKENS_API_ORIGIN`), and
    `TOKENS_PLATFORM_API_KEY`. Analytics and direct provider keys are optional
    for Token Radar.
16. **Hosted API safety:** use the documented `api.tokens.xyz/v1` contract,
    keep the key server-side, respect scopes, rate limits, and quotas, and proxy
    only the read paths used by the product. Do not depend on the hosted
    `tokens.xyz/api/*` implementation as a stable third-party contract.
17. **Simplest architecture:** one `apps/web` Vercel deployment, the existing
    same-origin proxy, the hosted Tokens API, and the static asset registry.

## Implementation decision

Build Live Radar as the primary experience. Add a clearly labeled price and
volume Signal Tape to asset pages, keep liquidity as a separately timestamped
live snapshot, derive only threshold-backed snapshot signals, and never emit a
liquidity-expansion/contraction event without historical liquidity data.
