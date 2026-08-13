/**
 * Cache-warm helpers.
 *
 * These call the cloudrun-assets `/mutation/cacheWarm*` endpoints
 * (authenticated by the shared bearer token — no `secret`/`keyHash` args
 * needed).
 *
 * Today's warm-trigger policy is preserved per call site: secret-gated sites
 * only warm when `TOKENS_CACHE_WARM_SECRET` is configured, and request-aware
 * sites (`scheduleCacheWarm` with a `Request`) also warm when the caller
 * presented an `x-api-key`.
 */

import { Effect } from 'effect';
import { runAfterResponse } from '@/effect/after-response';

import { tapErrorAndDefault } from '@tokens/effect';
import type { TimeInterval } from '@/lib/birdeye';
import { cloudRunMutation } from './client';

/**
 * Cache warming is best-effort and must never sit on the response latency
 * path: run the mutation after the response has been sent.
 */
export function deferUntilAfterResponse(effect: Effect.Effect<void, never>): Effect.Effect<void, never> {
    return Effect.sync(() => {
        runAfterResponse(effect);
    });
}

function getCacheWarmSecret(): string | null {
    return (process.env.TOKENS_CACHE_WARM_SECRET ?? '').trim() || null;
}

function getPlatformApiKeyFromRequest(request: Request): string | null {
    const raw = request.headers.get('x-api-key')?.trim() ?? '';
    return raw.length > 0 ? raw : null;
}

function warmViaCloudRun(
    name: string,
    args: Record<string, unknown>,
    label: string,
    meta: Record<string, unknown>,
): Effect.Effect<void, never> {
    return deferUntilAfterResponse(
        cloudRunMutation('assets', name, args).pipe(
            Effect.asVoid,
            tapErrorAndDefault(label, undefined, meta),
        ),
    );
}

export function scheduleCoingeckoOhlcvWarm(params: {
    coinId: string;
    interval: TimeInterval;
    days: number;
    label?: string;
}): Effect.Effect<void, never> {
    const coinId = params.coinId.trim();
    if (!coinId) return Effect.succeed(undefined);
    const label = params.label ?? 'assets.detail.scheduleCoingeckoOhlcvWarm';
    const meta = { coinId, interval: params.interval, days: params.days };

    const secret = getCacheWarmSecret();
    if (!secret) return Effect.succeed(undefined);

    return warmViaCloudRun(
        'cacheWarmRequestCoingeckoOhlcv',
        { coinId, interval: params.interval, days: params.days },
        label,
        meta,
    );
}

export function scheduleCoinPriceWarm(params: { coinId: string; label?: string }): Effect.Effect<void, never> {
    const coinId = params.coinId.trim();
    if (!coinId) return Effect.succeed(undefined);
    const label = params.label ?? 'assets.detail.scheduleCoinPriceWarm';

    const secret = getCacheWarmSecret();
    if (!secret) return Effect.succeed(undefined);

    return warmViaCloudRun('cacheWarmRequestCoinPrice', { coinId, minAgeMs: 0 }, label, { coinId });
}

export function scheduleCoinMetadataWarm(params: { coinId: string; label?: string }): Effect.Effect<void, never> {
    const coinId = params.coinId.trim();
    if (!coinId) return Effect.succeed(undefined);
    const label = params.label ?? 'assets.detail.scheduleCoinMetadataWarm';

    const secret = getCacheWarmSecret();
    if (!secret) return Effect.succeed(undefined);

    return warmViaCloudRun('cacheWarmRequestCoinMetadata', { coinId, minAgeMs: 0 }, label, { coinId });
}

export function scheduleCoingeckoTickersWarm(params: { coinId: string; label?: string }): Effect.Effect<void, never> {
    const coinId = params.coinId.trim();
    if (!coinId) return Effect.succeed(undefined);
    const label = params.label ?? 'assets.detail.scheduleCoingeckoTickersWarm';

    const secret = getCacheWarmSecret();
    if (!secret) return Effect.succeed(undefined);

    return warmViaCloudRun('cacheWarmRequestCoingeckoTickers', { coinId, minAgeMs: 0 }, label, { coinId });
}

export function scheduleStockPriceWarm(params: { assetId: string; label?: string }): Effect.Effect<void, never> {
    const assetId = params.assetId.trim();
    if (!assetId) return Effect.succeed(undefined);
    const label = params.label ?? 'assets.detail.scheduleStockPriceWarm';

    const secret = getCacheWarmSecret();
    if (!secret) return Effect.succeed(undefined);

    return warmViaCloudRun('cacheWarmRequestStockPrice', { assetId, minAgeMs: 0 }, label, { assetId });
}

export function scheduleStockOhlcvWarm(params: {
    assetId: string;
    interval: TimeInterval;
    days: number;
    label?: string;
}): Effect.Effect<void, never> {
    const assetId = params.assetId.trim();
    if (!assetId) return Effect.succeed(undefined);
    const label = params.label ?? 'assets.detail.scheduleStockOhlcvWarm';
    const meta = { assetId, interval: params.interval, days: params.days };

    const secret = getCacheWarmSecret();
    if (!secret) return Effect.succeed(undefined);

    return warmViaCloudRun(
        'cacheWarmRequestStockOhlcv',
        { assetId, interval: params.interval, days: params.days },
        label,
        meta,
    );
}

export function scheduleAssetRiskWarm(params: {
    mint: string;
    minAgeMs?: number;
    label?: string;
}): Effect.Effect<void, never> {
    const mint = params.mint.trim();
    if (!mint) return Effect.succeed(undefined);
    const label = params.label ?? 'assets.detail.scheduleAssetRiskWarm';

    const secret = getCacheWarmSecret();
    if (!secret) return Effect.succeed(undefined);

    const args = {
        mint,
        ...(params.minAgeMs !== undefined ? { minAgeMs: params.minAgeMs } : {}),
    };

    return warmViaCloudRun('cacheWarmRequestAssetRisk', args, label, { mint });
}

/**
 * Mint warm (variant market / token markets / OHLCV).
 *
 * Pass the incoming `Request` from call sites that should fall back to the
 * caller's `x-api-key` when no warm secret is configured (the Convex
 * `requestFromKeyHash` path). Pass `null` from secret-only call sites.
 */
export function scheduleCacheWarm(
    request: Request | null,
    params: {
        mint: string;
        markets?: boolean;
        variantMarket?: boolean;
        ohlcv?: boolean;
        ohlcvInterval?: TimeInterval;
        ohlcvDays?: number;
        minAgeMs?: number;
        label?: string;
    },
): Effect.Effect<void, never> {
    const mint = params.mint.trim();
    if (!mint) return Effect.succeed(undefined);

    const label = params.label ?? 'assets.detail.scheduleVariantWarm';
    const meta = {
        mint,
        markets: params.markets ?? false,
        variantMarket: params.variantMarket ?? false,
        ohlcv: params.ohlcv ?? false,
    };
    const warmArgs = {
        mint,
        markets: params.markets ?? false,
        variantMarket: params.variantMarket ?? false,
        ohlcv: params.ohlcv ?? false,
        ...(params.ohlcvInterval ? { ohlcvInterval: params.ohlcvInterval } : {}),
        ...(params.ohlcvDays !== undefined ? { ohlcvDays: params.ohlcvDays } : {}),
        ...(params.minAgeMs !== undefined ? { minAgeMs: params.minAgeMs } : {}),
    };

    const secret = getCacheWarmSecret();
    const hasApiKey = request !== null && getPlatformApiKeyFromRequest(request) !== null;
    if (!secret && !hasApiKey) return Effect.succeed(undefined);
    return warmViaCloudRun('cacheWarmRequest', warmArgs, label, meta);
}
