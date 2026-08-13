import { Effect } from 'effect';

import { route } from '@/effect/next-route';
import { BadRequestError, NotFoundError } from '@tokens/effect';
import { decodeLimit, decodeOffset } from '@tokens/effect';
import { scheduleCoingeckoTickersWarm } from '@/lib/cloudrun/cacheWarm';
import { coingeckoGetTickersLatestByCoinId } from '@/lib/cloudrun';
import { getByAssetId as cloudRunGetByAssetId } from '@/lib/cloudrun/assets';
import { resolveAssetIdFromRef } from '../../_resolve-asset-ref';

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

function scheduleTickersWarm(coinId: string): Effect.Effect<void, never> {
    return scheduleCoingeckoTickersWarm({ coinId, label: 'assets.tickers.scheduleWarm' });
}

export const GET = route(
    (request: Request, ctx: { params: Promise<{ assetId: string }> }) =>
        Effect.gen(function* () {
            const { assetId: rawAssetId } = yield* Effect.tryPromise(() => ctx.params);
            const assetRef = (rawAssetId ?? '').trim();
            if (!assetRef) return yield* Effect.fail(new BadRequestError({ message: 'assetId is required' }));

            const assetId = yield* resolveAssetIdFromRef(assetRef);

            const assetDoc = yield* cloudRunGetByAssetId({ assetId });
            if (!assetDoc)
                return yield* Effect.fail(new NotFoundError({ message: 'Asset not found', resource: 'asset' }));

            const coinId = (assetDoc.coingeckoId ?? '').trim();
            if (!coinId) {
                return { assetId, tickers: { rows: [], total: undefined, offset: 0, limit: 0 } };
            }

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

            const doc = yield* Effect.tryPromise(() => coingeckoGetTickersLatestByCoinId({ coinId }));
            const isStale = doc ? Date.now() - doc.lastFetchedAt > 6 * 60 * 60_000 : true;
            if (!doc || isStale) {
                yield* scheduleTickersWarm(coinId);
            }

            const rows = doc ? doc.tickers.slice(offset, offset + limit) : [];

            return {
                assetId,
                tickers: {
                    rows,
                    total: doc?.total,
                    offset,
                    limit,
                    lastUpdatedAt: doc?.lastFetchedAt ?? null,
                },
            };
        }),
    { platform: { requiredScopes: ['assets:read'] }, cache: { maxAge: 300, staleWhileRevalidate: 600 } },
);
