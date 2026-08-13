import { Effect } from 'effect';

import { scheduleCacheWarm, scheduleCoingeckoOhlcvWarm } from '@/lib/cloudrun/cacheWarm';
import { getByAssetId as cloudRunGetByAssetId } from '@/lib/cloudrun/assets';
import { assetVariantsGetByMint, coingeckoListOhlcv, ohlcvList } from '@/lib/cloudrun';
import type { TimeInterval } from '@/lib/birdeye';
import { intervalToSeconds, validateOhlcvRange } from '@/lib/ohlcv-bounds';
import { BadRequestError } from '@tokens/effect';
import { route } from '@/effect/next-route';
import {
    decodeUnknownOrBadRequest,
    NonNegativeIntFromString,
    SolanaAddress,
    TimeInterval as TimeIntervalSchema,
} from '@tokens/effect';


export const GET = route(
    (request: Request) =>
        Effect.gen(function* () {
            const url = new URL(request.url);
            const searchParams = url.searchParams;

            const rawAddress = searchParams.get('address');
            if (!rawAddress) return yield* Effect.fail(new BadRequestError({ message: 'address is required' }));
            const address = yield* decodeUnknownOrBadRequest(SolanaAddress, rawAddress, 'Invalid address');

            const rawInterval = searchParams.get('interval');
            const interval: TimeInterval = rawInterval
                ? yield* decodeUnknownOrBadRequest(TimeIntervalSchema, rawInterval, 'Invalid interval')
                : ('1H' as const);

            const now = Math.floor(Date.now() / 1000);
            const rawFrom = searchParams.get('from');
            const rawTo = searchParams.get('to');

            const parsedFrom = rawFrom
                ? yield* decodeUnknownOrBadRequest(NonNegativeIntFromString, rawFrom, 'Invalid from')
                : now - 7 * 24 * 60 * 60;
            const parsedTo = rawTo
                ? yield* decodeUnknownOrBadRequest(NonNegativeIntFromString, rawTo, 'Invalid to')
                : now;

            const { from: requestedFrom, to: requestedTo } = yield* validateOhlcvRange({
                from: parsedFrom,
                to: parsedTo,
                interval,
            });

            const intervalSeconds = intervalToSeconds(interval);
            const expectedCount = Math.max(
                1,
                Math.floor((requestedTo - requestedFrom) / Math.max(intervalSeconds, 1)) + 1,
            );

            const warmSecret = (process.env.TOKENS_CACHE_WARM_SECRET ?? '').trim();

            const candles = yield* ohlcvList({
                    address,
                    interval,
                    from: requestedFrom,
                    to: requestedTo,
                });

            const firstTime = candles.length > 0 ? (candles[0]?.time ?? null) : null;
            const lastTime = candles.length > 0 ? (candles[candles.length - 1]?.time ?? null) : null;
            const missingStart = firstTime === null || firstTime > requestedFrom + intervalSeconds * 2;
            const sparse = candles.length < Math.max(3, Math.floor(expectedCount * 0.25));
            const shouldPreferCoingecko = candles.length === 0 || (missingStart && sparse);

            // Fallback: if on-chain OHLCV is missing or extremely sparse for this mint, use CoinGecko OHLCV
            // for the canonical asset (when resolvable). This is common for some wrappers.
            if (shouldPreferCoingecko) {
                const variant = yield* assetVariantsGetByMint({ mint: address });
                const assetDoc = variant
                    ? yield* cloudRunGetByAssetId({ assetId: variant.assetId })
                    : null;
                const coinId = (assetDoc?.coingeckoId ?? '').trim();

                if (coinId) {
                    const cgCandles = yield* coingeckoListOhlcv({
                            coinId,
                            interval,
                            from: requestedFrom,
                            to: requestedTo,
                        });
                    if (warmSecret) {
                        const requestedDays = Math.max(1, Math.ceil((requestedTo - requestedFrom) / (24 * 60 * 60)));
                        yield* scheduleCoingeckoOhlcvWarm({
                            coinId,
                            interval,
                            days: requestedDays,
                            label: 'ohlcv.scheduleCoingeckoWarm',
                        });
                    }

                    // Only switch to CoinGecko if it has better coverage than the on-chain cache.
                    if (cgCandles.length > candles.length) return cgCandles;
                }
            }

            if (warmSecret) {
                const isStale = lastTime === null || requestedTo - lastTime > intervalSeconds * 2;
                const shouldBackfill = missingStart && sparse;
                if (isStale || shouldBackfill) {
                    const requestedDays = Math.max(1, Math.ceil((requestedTo - requestedFrom) / (24 * 60 * 60)));
                    yield* scheduleCacheWarm(null, {
                        mint: address,
                        ohlcv: true,
                        markets: false,
                        variantMarket: false,
                        ohlcvInterval: interval,
                        ohlcvDays: requestedDays,
                        label: 'ohlcv.scheduleWarm',
                    });
                }
            }

            return candles;
        }),
    { platform: { requiredScopes: ['internal:read'] } },
);
