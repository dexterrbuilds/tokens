import { Effect } from 'effect';

import { route } from '@/effect/next-route';
import { decodeLimit, decodeOffset } from '@tokens/effect';
import { scheduleCacheWarm } from '@/lib/cloudrun/cacheWarm';
import { tokenMarketsGetLatestByMint, variantMarketsGetLatestByMints } from '@/lib/cloudrun';
import { cleanTokenName, getTokenLogoURL } from '@/lib/logo-overrides';
import { loadAssetWithSelectedVariant } from '../../_asset-route-loader';
import { POOL_PROTOCOL_TOKENS, getProtocolTokenFallback } from '../../_protocol-tokens';
import { DEFAULT_MARKETS_STALE_MS, EQUITY_MARKETS_STALE_MS } from '../../_market-cache';

interface TokenMarketToken {
    address: string;
    decimals?: number;
    symbol?: string;
    icon?: string;
    name?: string;
}

interface TokenMarketRow {
    address: string;
    name?: string;
    base?: TokenMarketToken;
    quote?: TokenMarketToken;
    source?: string;
    createdAt?: string;
    liquidity?: number;
    volume24h?: number;
    trade24h?: number;
    trade24hChangePercent?: number;
    uniqueWallet24h?: number;
    uniqueWallet24hChangePercent?: number;
    price?: number;
}

async function getProtocolTokensByMarketAddress(
    markets: Array<{ address: string; source?: string }>,
): Promise<Record<string, TokenMarketToken | undefined>> {
    const marketToMint: Array<{ marketAddress: string; mint: string }> = [];
    const mintToFallback = new Map<string, (typeof POOL_PROTOCOL_TOKENS)[number]>();

    for (const market of markets) {
        const config = market.source ? getProtocolTokenFallback(market.source) : null;
        if (!config) continue;

        marketToMint.push({ marketAddress: market.address, mint: config.address });
        mintToFallback.set(config.address, config);
    }

    const uniqueMints = Array.from(mintToFallback.keys());
    if (uniqueMints.length === 0) return {};

    const rows = await Effect.runPromise(variantMarketsGetLatestByMints({ mints: uniqueMints }));
    const marketByMint = new Map<string, (typeof rows)[number]['market']>();
    for (const row of rows) marketByMint.set(row.mint, row.market);

    const tokensByMint = new Map<string, TokenMarketToken | undefined>();
    for (const mint of uniqueMints) {
        const fallback = mintToFallback.get(mint);
        const market = marketByMint.get(mint) ?? null;
        if (!market) {
            tokensByMint.set(mint, {
                address: mint,
                symbol: fallback?.symbol,
                name: fallback?.name,
                icon: undefined,
            });
            continue;
        }

        const symbol = market.symbol ?? fallback?.symbol ?? '???';
        const cleanedName = cleanTokenName(market.name);
        tokensByMint.set(mint, {
            address: mint,
            symbol,
            name: cleanedName === 'Unknown' ? fallback?.name : cleanedName,
            icon: getTokenLogoURL(symbol, market.logoURI),
        });
    }

    const tokensByMarket: Record<string, TokenMarketToken | undefined> = {};
    for (const { marketAddress, mint } of marketToMint) {
        tokensByMarket[marketAddress] = tokensByMint.get(mint);
    }

    return tokensByMarket;
}

function scheduleMarketsWarm(mint: string): Effect.Effect<void, never> {
    return scheduleCacheWarm(null, {
        mint,
        markets: true,
        variantMarket: false,
        ohlcv: false,
        minAgeMs: 0,
        label: 'assets.markets.scheduleWarm',
    });
}

export const GET = route(
    (request: Request, ctx: { params: Promise<{ assetId: string }> }) =>
        Effect.gen(function* () {
            const { assetId: rawAssetId } = yield* Effect.tryPromise(() => ctx.params);
            const loaded = yield* loadAssetWithSelectedVariant({ request, rawAssetId });
            const url = new URL(request.url);
            const mint = loaded.selectedMint;
            const offset = yield* decodeOffset(url.searchParams.get('offset'));
            const limit = yield* decodeLimit(url.searchParams.get('limit'), { defaultValue: '10', max: 50 });

            const doc = yield* tokenMarketsGetLatestByMint({ mint });
            const staleMs =
                loaded.canonical.category === 'equity' ? EQUITY_MARKETS_STALE_MS : DEFAULT_MARKETS_STALE_MS;
            const isStale = doc ? Date.now() - doc.lastFetchedAt > staleMs : true;
            if (!doc || doc.total <= 0 || isStale) {
                yield* scheduleMarketsWarm(mint);
            }

            const slicedWithSource = doc ? doc.markets.slice(offset, offset + limit) : [];
            const protocolTokensByMarket = yield* Effect.tryPromise(() =>
                getProtocolTokensByMarketAddress(slicedWithSource),
            );

            const markets: Array<Omit<TokenMarketRow, 'source'>> = doc
                ? (doc.markets as TokenMarketRow[])
                      .slice(offset, offset + limit)
                      .map(({ source: _source, ...row }) => row)
                : [];

            return {
                assetId: loaded.assetId,
                mint,
                markets,
                protocolTokensByMarket,
                total: doc ? doc.total : undefined,
                offset,
                limit,
                lastUpdatedAt: doc?.lastFetchedAt ?? null,
            };
        }),
    { platform: { requiredScopes: ['assets:read'] }, cache: { maxAge: 60 } },
);
