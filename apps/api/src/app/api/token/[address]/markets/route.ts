import { Effect } from 'effect';

import type { TokenMarket, TokenMarketToken } from '@/lib/birdeye';
import { cleanTokenName, getTokenLogoURL } from '@/lib/logo-overrides';
import { route } from '@/effect/next-route';
import { decodeLimit, decodeOffset } from '@tokens/effect';
import { decodeUnknownOrBadRequest, SolanaAddress } from '@tokens/effect';
import { scheduleCacheWarm as scheduleCacheWarmShared } from '@/lib/cloudrun/cacheWarm';
import {
    tokenMarketsGetLatestByMint,
    variantMarketsGetLatestByMints,
    type VariantMarketsGetLatestByMintsResult,
} from '@/lib/cloudrun';
import { POOL_PROTOCOL_TOKENS, getProtocolTokenFallback } from '@/app/api/v1/assets/_protocol-tokens';


function scheduleCacheWarm(
    request: Request,
    params: {
        mint: string;
        markets?: boolean;
        variantMarket?: boolean;
    },
): Effect.Effect<void, never> {
    return scheduleCacheWarmShared(request, {
        mint: params.mint,
        markets: params.markets ?? false,
        variantMarket: params.variantMarket ?? false,
        ohlcv: false,
        minAgeMs: 0,
        label: 'token.markets.scheduleWarm',
    });
}

async function getProtocolTokensByMarketAddress(markets: Array<{ address: string; source?: string }>) {
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

    const rows: VariantMarketsGetLatestByMintsResult =
        await Effect.runPromise(variantMarketsGetLatestByMints({ mints: uniqueMints }));
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

export interface MarketsApiResponse {
    markets: TokenMarket[];
    protocolTokensByMarket: Record<string, TokenMarketToken | undefined>;
    total: number | undefined;
    offset: number;
    limit: number;
}

export const GET = route(
    (_request: Request, ctx: { params: Promise<{ address: string }> }) =>
        Effect.gen(function* () {
            const { address: rawAddress } = yield* Effect.tryPromise(() => ctx.params);
            const address = yield* decodeUnknownOrBadRequest(SolanaAddress, rawAddress, 'Invalid address');

            const url = new URL(_request.url);
            const searchParams = url.searchParams;

            const offset = yield* decodeOffset(searchParams.get('offset'));
            const limit = yield* decodeLimit(searchParams.get('limit'), { defaultValue: '10', max: 50 });

            const doc = yield* tokenMarketsGetLatestByMint({ mint: address });
            const isStale = doc ? Date.now() - doc.lastFetchedAt > 60 * 60_000 : true;
            if (!doc || doc.total <= 0 || isStale) {
                yield* scheduleCacheWarm(_request, { mint: address, markets: true });
            }

            const markets = doc ? doc.markets : [];
            const sliced = markets.slice(offset, offset + limit);

            const protocolTokensByMarket = yield* Effect.tryPromise(() => getProtocolTokensByMarketAddress(sliced));

            return {
                markets: sliced,
                protocolTokensByMarket,
                total: doc ? doc.total : undefined,
                offset,
                limit,
            } satisfies MarketsApiResponse;
        }),
    { platform: { requiredScopes: ['internal:read'] } },
);
