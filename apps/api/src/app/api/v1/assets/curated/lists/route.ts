import { Effect } from 'effect';

import { tapErrorAndDefault } from '@tokens/effect';

import { route } from '@/effect/next-route';
import { assetCollectionsGetSummaries, type AssetCollectionSummary } from '@/lib/cloudrun';
import { getVariantByMint } from '@tokens/asset-registry';
import { getCuratedTokenAddresses, getCuratedTokenList, getLatestAddedToken } from '@tokens/asset-registry/compat';

const HOME_CATEGORY_IDS = ['majors', 'currencies', 'rwas', 'etfs', 'metals', 'stocks'] as const;
type HomeCategoryId = (typeof HOME_CATEGORY_IDS)[number];

function looksLikeSolanaMintAddress(value: string): boolean {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

function mintToSingletonAssetId(mint: string): string {
    return `solana-${mint.trim()}`;
}

function fallbackNameForId(id: HomeCategoryId): string {
    switch (id) {
        case 'majors':
            return 'Majors';
        case 'currencies':
            return 'Currencies';
        case 'rwas':
            return 'RWAs';
        case 'etfs':
            return 'ETFs';
        case 'metals':
            return 'Metals';
        case 'stocks':
            return 'Stocks';
        default:
            return id;
    }
}

interface CuratedListSummary {
    id: HomeCategoryId;
    name: string;
    count: number;
    lastAddedAssetId: string | null;
    lastAddedAt: number | null;
}

/** Compiled-registry computation — the fail-open fallback when the DB read is unavailable. */
function buildStaticSummary(id: HomeCategoryId): CuratedListSummary {
    const list = getCuratedTokenList(id);
    const mints = getCuratedTokenAddresses(list);
    const assetIds = Array.from(
        new Set(
            mints.map(mint => {
                const match = getVariantByMint(mint);
                if (match) return match.asset.assetId;
                return looksLikeSolanaMintAddress(mint) ? mintToSingletonAssetId(mint) : mint;
            }),
        ),
    );
    // Derived from git-history added-at timestamps (not array position), so the
    // "Latest Added" highlight is literally the most recently added token.
    const latestAdded = getLatestAddedToken(list);
    const rawLastMint = latestAdded?.address ?? null;
    const rawLastAssetId = rawLastMint
        ? (getVariantByMint(rawLastMint)?.asset.assetId ??
          (looksLikeSolanaMintAddress(rawLastMint) ? mintToSingletonAssetId(rawLastMint) : rawLastMint))
        : null;
    const lastAddedAssetId = rawLastAssetId && rawLastAssetId.trim() ? rawLastAssetId : null;
    const name = list.name.trim() || fallbackNameForId(id);
    return {
        id,
        name,
        count: assetIds.length,
        lastAddedAssetId,
        lastAddedAt: latestAdded?.addedAt ?? null,
    };
}

/**
 * Primary source is the DB (via cloudrun-assets), so admin-added tokens show
 * up in counts and "Latest Added" without a registry PR. Fail-open per-slug:
 * a missing/empty DB summary falls back to the static computation, and an RPC
 * failure falls back for every slug.
 */
export const GET = route(() =>
    Effect.gen(function* () {
        const dbSummaries = yield* assetCollectionsGetSummaries({ slugs: [...HOME_CATEGORY_IDS] }).pipe(
            tapErrorAndDefault('v1.assetsCuratedLists.summaries', null as AssetCollectionSummary[] | null),
        );

        const dbBySlug = new Map((dbSummaries ?? []).map(summary => [summary.slug, summary] as const));
        return HOME_CATEGORY_IDS.map(id => {
            const fallback = buildStaticSummary(id);
            const db = dbBySlug.get(id);
            if (!db || db.count <= 0) return fallback;
            return {
                id,
                name: fallback.name,
                count: db.count,
                lastAddedAssetId: db.lastAddedAssetId ?? fallback.lastAddedAssetId,
                lastAddedAt: db.lastAddedAt ?? fallback.lastAddedAt,
            };
        });
    }),
);
