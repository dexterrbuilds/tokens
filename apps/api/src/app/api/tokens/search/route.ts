import { Effect } from 'effect';

import { route } from '@/effect/next-route';
import { tokensSearchTokens } from '@/lib/cloudrun';

export const GET = route(
    (request: Request) =>
        Effect.gen(function* () {
            const url = new URL(request.url);
            const query = url.searchParams.get('q') ?? '';

            const q = query.trim();
            if (q.length < 2) return { tokens: [] };

            const tokens = yield* tokensSearchTokens({ query: q, limit: 20 });
            return { tokens };
        }),
    { platform: { requiredScopes: ['internal:read'] } },
);
