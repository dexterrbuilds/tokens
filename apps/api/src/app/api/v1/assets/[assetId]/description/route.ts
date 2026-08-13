import { Effect } from 'effect';

import { route } from '@/effect/next-route';
import { tokenDescriptionSummariesGetByAddress } from '@/lib/cloudrun';
import { loadAssetWithSelectedVariant } from '../../_asset-route-loader';

export const GET = route(
    (request: Request, ctx: { params: Promise<{ assetId: string }> }) =>
        Effect.gen(function* () {
            const { assetId: rawAssetId } = yield* Effect.tryPromise(() => ctx.params);
            const loaded = yield* loadAssetWithSelectedVariant({ request, rawAssetId });

            const summary = yield* tokenDescriptionSummariesGetByAddress({ address: loaded.selectedMint });

            return {
                assetId: loaded.assetDoc.assetId,
                mint: loaded.selectedMint,
                description: summary ? { summary: summary.summary, generatedAt: summary.generatedAt } : null,
            };
        }),
    { platform: { requiredScopes: ['assets:read'] }, cache: { maxAge: 300, staleWhileRevalidate: 600 } },
);
