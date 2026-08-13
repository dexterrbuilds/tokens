import { Effect } from 'effect';

import { coingeckoSearchCoins } from '@/lib/cloudrun';
import { route } from '@/effect/next-route';
import { decodeLimit } from '@tokens/effect';

export const GET = route(
    (request: Request) =>
        Effect.gen(function* () {
            const url = new URL(request.url);
            const searchParams = url.searchParams;

            const query = (searchParams.get('q') ?? '').trim();
            const limit = yield* decodeLimit(searchParams.get('limit'), { defaultValue: '20', max: 50 });

            if (query.length < 2) return { coins: [] };

            const coins = yield* coingeckoSearchCoins({ query, limit });
            return { coins };
        }),
    { platform: { requiredScopes: ['internal:read'] } },
);
