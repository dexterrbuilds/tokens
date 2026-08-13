import { Effect } from 'effect';

import { route } from '@/effect/next-route';
import { coingeckoGetCoinById } from '@/lib/cloudrun';
import { BadRequestError } from '@tokens/effect';

export const GET = route(
    (_request: Request, ctx: { params: Promise<{ id: string }> }) =>
        Effect.gen(function* () {
            const { id } = yield* Effect.tryPromise(() => ctx.params);
            const coinId = (id ?? '').trim();
            if (!coinId) return yield* Effect.fail(new BadRequestError({ message: 'id is required' }));

            return yield* coingeckoGetCoinById({ id: coinId });
        }),
    { platform: { requiredScopes: ['internal:read'] } },
);
