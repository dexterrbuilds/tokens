import {
    resolveAlias as resolveRegistryAlias,
    type AssetCategory,
    type CanonicalAsset,
    type VariantKind,
} from '@tokens/asset-registry';

import { looksLikeSolanaMintAddress, mintToSingletonAssetId, singletonAssetIdToMint } from '../_singleton-asset-id';

export interface MemberFallbackArgs {
    /** Collection members + registry-derived member ids, already tombstone-filtered. */
    assetIds: readonly string[];
    /** Assets built from the DB (and registry) so far; mutated in place. */
    canonicalAssetById: Map<string, CanonicalAsset>;
    /** Category/kind to stamp on a fabricated singleton, derived from the list id. */
    category: AssetCategory;
    kind: VariantKind;
    /** Tag suffix for a fabricated singleton (`curated:<listId>`). */
    listId: string;
    resolveRegistryAsset?: (ref: string) => CanonicalAsset | null;
}

/**
 * Ensures every collection member is represented, even before the registry seed
 * knows about it: a member that produced no DB asset becomes a registry asset when
 * one resolves, otherwise a single-mint singleton shell.
 *
 * A member id is only mint-shaped (`<mint>` / `solana-<mint>`) because the caller
 * resolves mint → asset through the *compiled* registry, which lags the DB. When
 * the DB has already attached that mint to a canonical asset in this payload —
 * an admin-added variant, or one of the ~1.5k Sanctum LSTs hanging off `solana` —
 * fabricating a singleton would duplicate the token as a second, nameless row. So
 * mints already claimed by an asset in the payload are skipped.
 */
export function addMemberFallbackAssets(args: MemberFallbackArgs): void {
    const { assetIds, canonicalAssetById, category, kind, listId } = args;
    const resolveRegistryAsset = args.resolveRegistryAsset ?? resolveRegistryAlias;

    const claimedMints = new Set<string>();
    for (const asset of canonicalAssetById.values()) {
        for (const variant of asset.variants) claimedMints.add(variant.mint);
    }

    for (const memberAssetId of assetIds) {
        const normalizedAssetId = looksLikeSolanaMintAddress(memberAssetId)
            ? mintToSingletonAssetId(memberAssetId)
            : memberAssetId;
        if (canonicalAssetById.has(normalizedAssetId)) continue;

        const singletonMint = singletonAssetIdToMint(memberAssetId);
        const mint = singletonMint ?? (looksLikeSolanaMintAddress(memberAssetId) ? memberAssetId.trim() : null);

        // Prefer registry fallbacks when possible.
        const registryAsset = resolveRegistryAsset(memberAssetId);
        if (registryAsset) {
            canonicalAssetById.set(registryAsset.assetId, registryAsset);
            for (const variant of registryAsset.variants) claimedMints.add(variant.mint);
            continue;
        }

        if (!mint) continue;
        if (claimedMints.has(mint)) continue;

        const singletonAssetId = mintToSingletonAssetId(mint);
        canonicalAssetById.set(singletonAssetId, {
            assetId: singletonAssetId,
            category,
            aliases: [singletonAssetId, mint],
            variants: [
                {
                    variantId: `${singletonAssetId}:mint`,
                    mint,
                    kind,
                    trustTier: 'tier3',
                    tags: [`curated:${listId}`],
                },
            ],
        });
        claimedMints.add(mint);
    }
}
