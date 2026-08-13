import { Effect } from 'effect';

import { scheduleCoingeckoOhlcvWarm } from '@/lib/cloudrun/cacheWarm';
import { coingeckoListOhlcv } from '@/lib/cloudrun';
import type { TimeInterval } from '@/lib/birdeye';
import { BadRequestError } from '@tokens/effect';
import { route } from '@/effect/next-route';
import {
    decodeUnknownOrBadRequest,
    NonNegativeIntFromString,
    TimeInterval as TimeIntervalSchema,
} from '@tokens/effect';

function intervalToSeconds(interval: TimeInterval): number {
    switch (interval) {
        case '1m':
            return 60;
        case '5m':
            return 5 * 60;
        case '15m':
            return 15 * 60;
        case '1H':
            return 60 * 60;
        case '4H':
            return 4 * 60 * 60;
        case '1D':
            return 24 * 60 * 60;
        case '1W':
            return 7 * 24 * 60 * 60;
        default:
            return 60 * 60;
    }
}

export const GET = route(
    (request: Request) =>
        Effect.gen(function* () {
            const url = new URL(request.url);
            const searchParams = url.searchParams;

            const coinId = (searchParams.get('id') ?? '').trim();
            if (!coinId) return yield* Effect.fail(new BadRequestError({ message: 'id is required' }));

            const rawInterval = searchParams.get('interval');
            const interval: TimeInterval = rawInterval
                ? yield* decodeUnknownOrBadRequest(TimeIntervalSchema, rawInterval, 'Invalid interval')
                : ('1H' as const);

            const now = Math.floor(Date.now() / 1000);
            const rawFrom = searchParams.get('from');
            const rawTo = searchParams.get('to');

            const requestedFrom = rawFrom
                ? yield* decodeUnknownOrBadRequest(NonNegativeIntFromString, rawFrom, 'Invalid from')
                : now - 7 * 24 * 60 * 60;
            const requestedTo = rawTo
                ? yield* decodeUnknownOrBadRequest(NonNegativeIntFromString, rawTo, 'Invalid to')
                : now;

            if (requestedFrom > requestedTo) {
                return yield* Effect.fail(new BadRequestError({ message: '`from` must be <= `to`' }));
            }

            const candles = yield* coingeckoListOhlcv({
                    coinId,
                    interval,
                    from: requestedFrom,
                    to: requestedTo,
                });

            const warmSecret = (process.env.TOKENS_CACHE_WARM_SECRET ?? '').trim();
            if (warmSecret) {
                const intervalSeconds = intervalToSeconds(interval);
                const latestTime = candles.length > 0 ? (candles[candles.length - 1]?.time ?? null) : null;
                const isStale = latestTime === null || requestedTo - latestTime > intervalSeconds * 2;
                if (isStale) {
                    const requestedDays = Math.max(1, Math.ceil((requestedTo - requestedFrom) / (24 * 60 * 60)));
                    yield* scheduleCoingeckoOhlcvWarm({
                        coinId,
                        interval,
                        days: requestedDays,
                        label: 'coingecko.ohlcv.scheduleWarm',
                    });
                }
            }

            return candles;
        }),
    { platform: { requiredScopes: ['internal:read'] } },
);
