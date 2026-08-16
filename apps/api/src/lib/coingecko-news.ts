import { Effect } from 'effect';

import { emitEvent, type FetchHttpRecovery, type UpstreamHttpError } from '@tokens/effect';
import { coingeckoGetCoinById } from '@/lib/cloudrun';

export const COINGECKO_NEWS_CATALOG_FRESHNESS_MS = 15 * 24 * 60 * 60 * 1000;

export type CoinGeckoNewsSkipReason = 'missing' | 'stale' | 'validation_unavailable';

export type CoinGeckoNewsValidation = { shouldFetch: true } | { shouldFetch: false; reason: CoinGeckoNewsSkipReason };

interface CoinGeckoCatalogEntry {
    lastSyncedAt: number;
}

interface CoinGeckoNewsValidationOptions {
    lookup?: (coinId: string) => Effect.Effect<CoinGeckoCatalogEntry | null, unknown>;
    now?: () => number;
    emit?: (entry: Record<string, unknown>) => void;
}

export function classifyCoinGeckoNewsCoinId(
    entry: CoinGeckoCatalogEntry | null,
    nowMs: number,
): CoinGeckoNewsValidation {
    if (!entry) return { shouldFetch: false, reason: 'missing' };
    if (!Number.isFinite(entry.lastSyncedAt) || entry.lastSyncedAt < nowMs - COINGECKO_NEWS_CATALOG_FRESHNESS_MS) {
        return { shouldFetch: false, reason: 'stale' };
    }
    return { shouldFetch: true };
}

/**
 * Gate coin-specific news against the synchronized CoinGecko catalog. Global
 * news has no coin id and deliberately bypasses catalog validation.
 */
export function validateCoinGeckoNewsCoinId(
    rawCoinId: string,
    options: CoinGeckoNewsValidationOptions = {},
): Effect.Effect<CoinGeckoNewsValidation, never> {
    const coinId = rawCoinId.trim();
    if (!coinId) return Effect.succeed({ shouldFetch: true });

    const lookup = options.lookup ?? (id => coingeckoGetCoinById({ id }));
    const now = options.now ?? Date.now;
    const emit = options.emit ?? emitEvent;

    return lookup(coinId).pipe(
        Effect.map(entry => classifyCoinGeckoNewsCoinId(entry, now())),
        Effect.catch(() =>
            Effect.succeed({
                shouldFetch: false as const,
                reason: 'validation_unavailable' as const,
            }),
        ),
        Effect.tap(result =>
            result.shouldFetch
                ? Effect.void
                : Effect.sync(() =>
                      emit({
                          event: 'coingecko_news_skipped',
                          coin_id: coinId,
                          reason: result.reason,
                      }),
                  ),
        ),
    );
}

function isExactCoinNotFoundBody(body: string | undefined): boolean {
    if (!body) return false;

    try {
        const parsed = JSON.parse(body) as unknown;
        if (!parsed || typeof parsed !== 'object') return false;
        const value = parsed as Record<string, unknown>;
        return value.error_code === 404 && value.error_message === 'Coin not found.';
    } catch {
        return false;
    }
}

/** Recover only CoinGecko's exact coin lookup miss, not an absent endpoint. */
export function createCoinGeckoNewsNotFoundRecovery<T>(
    emptyValue: T,
): (error: UpstreamHttpError) => FetchHttpRecovery<T> | null {
    return error => {
        if (error._tag !== 'UpstreamHttpError' || error.status !== 404 || !isExactCoinNotFoundBody(error.body)) {
            return null;
        }
        return { value: emptyValue, outcome: 'coin_not_found' };
    };
}
