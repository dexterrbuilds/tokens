import { BadRequestError } from '@tokens/effect';
import { decodeLimit, decodeOffset } from '@tokens/effect';
import { route } from '@/effect/next-route';
import { Effect } from 'effect';

import { scheduleCoingeckoTickersWarm } from '@/lib/cloudrun/cacheWarm';
import { coingeckoGetTickersLatestByCoinId } from '@/lib/cloudrun';

type TickerOrder = 'trust_score_desc' | 'trust_score_asc' | 'volume_desc' | 'volume_asc';

function parseTickerOrder(value: string | null): TickerOrder | null {
    if (value == null || value.trim() === '') return 'volume_desc';
    switch (value) {
        case 'trust_score_desc':
        case 'trust_score_asc':
        case 'volume_desc':
        case 'volume_asc':
            return value;
        default:
            return null;
    }
}

export interface CoinTickerRow {
    base: string;
    target: string;
    market: {
        name: string;
        identifier?: string;
        logo?: string;
        hasTradingIncentive?: boolean;
    };
    priceUsd: number | null;
    volume24hUsd: number | null;
    spreadPercent: number | null;
    tradeUrl: string | null;
    trustScore: string | null;
    isAnomaly: boolean;
    isStale: boolean;
    timestamp: string | null;
}

export interface CoinTickersApiResponse {
    coinId: string;
    name?: string;
    tickers: CoinTickerRow[];
    total: number | undefined;
    offset: number;
    limit: number;
}

function scheduleTickersWarm(coinId: string): Effect.Effect<void, never> {
    return scheduleCoingeckoTickersWarm({ coinId, label: 'coingecko.tickers.scheduleWarm' });
}

export const GET = route(
    (request: Request, ctx: { params: Promise<{ id: string }> }) =>
        Effect.gen(function* () {
            const { id } = yield* Effect.tryPromise(() => ctx.params);
            const coinId = (id ?? '').trim();
            if (!coinId) return yield* Effect.fail(new BadRequestError({ message: 'id is required' }));

            const url = new URL(request.url);
            const searchParams = url.searchParams;

            const offset = yield* decodeOffset(searchParams.get('offset'));
            const limit = yield* decodeLimit(searchParams.get('limit'), { defaultValue: '50', max: 50 });
            const order = parseTickerOrder(searchParams.get('order'));
            if (!order) {
                return yield* Effect.fail(
                    new BadRequestError({
                        message: '`order` must be one of trust_score_desc, trust_score_asc, volume_desc, or volume_asc',
                    }),
                );
            }

            if (order !== 'volume_desc') {
                return yield* Effect.fail(
                    new BadRequestError({
                        message: '`order` currently only supports volume_desc',
                        details: { order },
                    }),
                );
            }

            const doc = yield* coingeckoGetTickersLatestByCoinId({ coinId });
            const isStale = doc ? Date.now() - doc.lastFetchedAt > 6 * 60 * 60_000 : true;
            if (!doc || isStale) {
                yield* scheduleTickersWarm(coinId);
            }

            // ponytail: tickers are JSON-blob upstream from CoinGecko — trust the shape at the boundary.
            const rows = (doc ? doc.tickers.slice(offset, offset + limit) : []) as CoinTickerRow[];

            return {
                coinId,
                ...(doc?.name ? { name: doc.name } : {}),
                tickers: rows,
                total: doc?.total,
                offset,
                limit,
            } satisfies CoinTickersApiResponse;
        }),
    { platform: { requiredScopes: ['internal:read'] } },
);
