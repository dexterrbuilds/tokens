import { Effect } from 'effect';

import { cleanTokenName, getTokenLogoURL } from '@/lib/logo-overrides';
import { route } from '@/effect/next-route';
import { scheduleCacheWarm } from '@/lib/cloudrun/cacheWarm';
import { variantMarketsGetLatestByMints } from '@/lib/cloudrun';

export interface TokenByAddressResult {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    logoURI: string | undefined;
    liquidity: number;
}

function parseAddresses(raw: string): string[] {
    const parts = raw
        .split(',')
        .map(part => part.trim())
        .filter(Boolean);

    const unique: string[] = [];
    const seen = new Set<string>();

    for (const address of parts) {
        if (seen.has(address)) continue;
        seen.add(address);
        unique.push(address);
    }

    return unique;
}


function scheduleVariantMarketWarm(mint: string): Effect.Effect<void, never> {
    return scheduleCacheWarm(null, {
        mint,
        variantMarket: true,
        markets: false,
        ohlcv: false,
        minAgeMs: 0,
        label: 'tokens.byAddresses.scheduleVariantMarketWarm',
    });
}

export const GET = route(
    (request: Request) =>
        Effect.gen(function* () {
            const url = new URL(request.url);
            const rawAddresses = url.searchParams.get('addresses') ?? '';
            const addresses = parseAddresses(rawAddresses).slice(0, 20);

            if (addresses.length === 0) return { tokens: [] satisfies TokenByAddressResult[] };

            const rows = yield* variantMarketsGetLatestByMints({ mints: addresses });
            const marketByMint = new Map<string, (typeof rows)[number]['market']>();
            for (const row of rows) marketByMint.set(row.mint, row.market);

            const missingOrStale = addresses.filter(mint => {
                const market = marketByMint.get(mint) ?? null;
                if (!market) return true;
                return Date.now() - market.lastFetchedAt > 60 * 60_000;
            });

            // Avoid spamming scheduler calls; warm only the first few.
            if (missingOrStale.length > 0) {
                yield* Effect.all(
                    missingOrStale.slice(0, 5).map(mint => scheduleVariantMarketWarm(mint)),
                    { concurrency: 2 },
                );
            }

            const tokens = addresses
                .map(mint => {
                    const market = marketByMint.get(mint) ?? null;
                    if (!market) return null;
                    const symbol = market.symbol ?? '???';
                    return {
                        address: mint,
                        name: cleanTokenName(market.name),
                        symbol,
                        decimals: market.decimals ?? 9,
                        logoURI: getTokenLogoURL(symbol, market.logoURI),
                        liquidity: market.liquidity ?? 0,
                    } satisfies TokenByAddressResult;
                })
                .filter((token): token is TokenByAddressResult => token !== null);

            return { tokens };
        }),
    { platform: { requiredScopes: ['internal:read'] } },
);
