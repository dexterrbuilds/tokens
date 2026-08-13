import { Effect } from 'effect';

import { route } from '@/effect/next-route';
import { NotFoundError } from '@tokens/effect';
import { decodeUnknownOrBadRequest, SolanaAddress } from '@tokens/effect';
import { tapErrorAndDefault } from '@tokens/effect';
import { scheduleCacheWarm } from '@/lib/cloudrun/cacheWarm';
import { tokenMarketsGetLatestByMint, variantMarketsGetLatestByMints } from '@/lib/cloudrun';
import type { TokenOverview } from '@/lib/birdeye';
import { getVariantByMint } from '@tokens/asset-registry';


function scheduleVariantMarketWarm(request: Request, mint: string): Effect.Effect<void, never> {
    return scheduleCacheWarm(request, {
        mint,
        variantMarket: true,
        markets: false,
        ohlcv: false,
        minAgeMs: 0,
        label: 'token.variantMarket.scheduleWarm',
    });
}

function asNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function asUsableName(value: unknown): string | null {
    const trimmed = asNonEmptyString(value);
    if (!trimmed) return null;
    if (trimmed.toLowerCase() === 'unknown') return null;
    if (trimmed === '???') return null;
    return trimmed;
}

function asFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return null;
}

type TokenMarketTokenLite = {
    address?: string;
    decimals?: number;
    symbol?: string;
    icon?: string;
    name?: string;
};

type TokenMarketLite = {
    liquidity?: number;
    volume24h?: number;
    price?: number;
    base?: TokenMarketTokenLite;
    quote?: TokenMarketTokenLite;
};

function pickBestTokenMarket(markets: TokenMarketLite[]): TokenMarketLite | null {
    if (!Array.isArray(markets) || markets.length === 0) return null;
    const sorted = markets
        .slice()
        .sort((a, b) => (asFiniteNumber(b?.liquidity) ?? 0) - (asFiniteNumber(a?.liquidity) ?? 0));
    return sorted[0] ?? null;
}

export const GET = route(
    (_request, ctx: { params: Promise<{ address: string }> }) =>
        Effect.gen(function* () {
            const { address: rawAddress } = yield* Effect.tryPromise(() => ctx.params);
            const address = yield* decodeUnknownOrBadRequest(SolanaAddress, rawAddress, 'Invalid address');

            const rows = yield* variantMarketsGetLatestByMints({ mints: [address] });
            const market = rows[0]?.market ?? null;

            const isStale = market ? Date.now() - market.lastFetchedAt > 60 * 60_000 : true;
            if (!market || isStale) {
                yield* scheduleVariantMarketWarm(_request, address);
            }

            const registryMatch = getVariantByMint(address);
            const registrySymbol =
                asNonEmptyString(registryMatch?.variant.symbol ?? registryMatch?.asset.symbol) ?? null;
            const registryName =
                asUsableName(
                    registryMatch?.variant.name ?? registryMatch?.variant.label ?? registryMatch?.asset.name,
                ) ?? null;

            const marketSymbol = asNonEmptyString(market?.symbol) ?? null;
            const marketName = asUsableName(market?.name) ?? null;
            const marketDecimals = asFiniteNumber(market?.decimals);
            const marketLogoURI = asNonEmptyString(market?.logoURI) ?? null;

            // If Birdeye snapshot is missing identity/logo, fall back to cached DEX markets + registry labels.
            const shouldDeriveFromMarkets =
                !market ||
                !marketSymbol ||
                !marketName ||
                marketDecimals === null ||
                (!marketLogoURI && registryMatch !== null);

            const derived = shouldDeriveFromMarkets
                ? yield* tokenMarketsGetLatestByMint({ mint: address }).pipe(
                      tapErrorAndDefault('token.tokenMarkets.getLatestByMint', null, { mint: address }),
                  )
                : null;

            const bestMarket = derived ? pickBestTokenMarket(derived.markets) : null;
            const tokenMeta =
                bestMarket?.base?.address === address
                    ? bestMarket.base
                    : bestMarket?.quote?.address === address
                      ? bestMarket.quote
                      : (bestMarket?.base ?? bestMarket?.quote ?? null);

            const derivedSymbol = asNonEmptyString(tokenMeta?.symbol) ?? null;
            const derivedName = asUsableName(tokenMeta?.name) ?? null;
            const derivedDecimals = asFiniteNumber(tokenMeta?.decimals);
            const derivedLogoURI = asNonEmptyString(tokenMeta?.icon) ?? null;

            const symbol = marketSymbol ?? derivedSymbol ?? registrySymbol ?? null;
            const name = marketName ?? derivedName ?? registryName ?? null;
            const decimals = marketDecimals ?? derivedDecimals ?? 9;

            if (!symbol || !name) {
                return yield* Effect.fail(new NotFoundError({ message: 'Token not found', resource: 'token' }));
            }

            const liquidity = (asFiniteNumber(market?.liquidity) ?? asFiniteNumber(bestMarket?.liquidity) ?? 0) || 0;
            const volume24h = (asFiniteNumber(market?.volume24hUSD) ?? asFiniteNumber(bestMarket?.volume24h) ?? 0) || 0;
            const price = (asFiniteNumber(market?.price) ?? asFiniteNumber(bestMarket?.price) ?? 0) || 0;

            return {
                address,
                name,
                symbol,
                decimals,
                ...((marketLogoURI ?? derivedLogoURI) ? { logoURI: (marketLogoURI ?? derivedLogoURI)! } : {}),
                ...(market?.extensions ? { extensions: market.extensions } : {}),
                price,
                priceChange24hPercent: market?.priceChange24hPercent ?? 0,
                marketCap: market?.marketCap ?? 0,
                fdv: market?.fdv ?? 0,
                liquidity,
                volume24h,
                holder: market?.holder ?? 0,
                totalSupply: market?.totalSupply ?? 0,
                circulatingSupply: market?.circulatingSupply ?? 0,
                lastTradeHumanTime: market?.lastTradeHumanTime ?? '',
            } satisfies TokenOverview;
        }),
    { platform: { requiredScopes: ['internal:read'] } },
);
