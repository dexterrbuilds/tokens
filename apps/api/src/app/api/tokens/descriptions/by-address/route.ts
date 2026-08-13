import { Effect } from 'effect';

import { route } from '@/effect/next-route';
import { tokenDescriptionSummariesGetByAddress } from '@/lib/cloudrun';
import { decodeUnknownOrBadRequest, SolanaAddress } from '@tokens/effect';

export const GET = route(
    (request: Request) =>
        Effect.gen(function* () {
            const url = new URL(request.url);
            const rawAddress = (url.searchParams.get('address') ?? '').trim();
            const address = yield* decodeUnknownOrBadRequest(SolanaAddress, rawAddress, 'Invalid address');

            return yield* tokenDescriptionSummariesGetByAddress({ address });
        }),
    { platform: { requiredScopes: ['internal:read'] } },
);
