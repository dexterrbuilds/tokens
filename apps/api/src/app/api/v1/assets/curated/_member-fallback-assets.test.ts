import { describe, expect, it } from 'bun:test';

import type { CanonicalAsset } from '@tokens/asset-registry';

import { addMemberFallbackAssets } from './_member-fallback-assets';

const SILVER_MINT = 'SiLVFMgD3eD2rgK628NbTBq9MnuJF5FW2CRaVyTB35L';
const ONDO_SILVER_MINT = 'iy11ytbSGcUnrjE6Lfv78TFqxKyUESfku1FugS9ondo';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const JITOSOL_MINT = 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn';
const UNSEEDED_MINT = '9DRPPWYud8i6CaSsDsFESs1xyVr8dBCMtjPZji2xiZEa';

function asset(assetId: string, mints: readonly string[]): CanonicalAsset {
    return {
        assetId,
        category: 'commodity',
        aliases: [],
        variants: mints.map(mint => ({
            variantId: `${assetId}:${mint.slice(0, 6)}`,
            mint,
            kind: 'wrapped',
            trustTier: 'tier3',
            tags: [],
        })),
    };
}

function run(args: {
    assetIds: readonly string[];
    canonicalAssetById: Map<string, CanonicalAsset>;
    registry?: Record<string, CanonicalAsset>;
}): Map<string, CanonicalAsset> {
    const registry = args.registry ?? {};
    addMemberFallbackAssets({
        assetIds: args.assetIds,
        canonicalAssetById: args.canonicalAssetById,
        category: 'commodity',
        kind: 'wrapped',
        listId: 'metals',
        resolveRegistryAsset: ref => registry[ref] ?? null,
    });
    return args.canonicalAssetById;
}

describe('addMemberFallbackAssets', () => {
    it('does not duplicate a DB-attached mint the compiled registry does not know', () => {
        // The admin attached SILVER_MINT to the `silver` canonical, so the caller's
        // registry-only mint→asset pass surfaced it as `solana-<mint>`.
        const canonicalAssetById = new Map([['silver', asset('silver', [ONDO_SILVER_MINT, SILVER_MINT])]]);

        const result = run({
            assetIds: ['silver', `solana-${SILVER_MINT}`],
            canonicalAssetById,
        });

        expect([...result.keys()]).toEqual(['silver']);
    });

    it('collapses every DB variant mint of a member instead of one row per mint', () => {
        // `solana` carries ~1.5k Sanctum LST variants in the DB; none of them may
        // become a standalone row in a curated list.
        const canonicalAssetById = new Map([['solana', asset('solana', [WSOL_MINT, JITOSOL_MINT])]]);

        const result = run({
            assetIds: ['solana', `solana-${JITOSOL_MINT}`, `solana-${WSOL_MINT}`],
            canonicalAssetById,
        });

        expect([...result.keys()]).toEqual(['solana']);
    });

    it('still fabricates a singleton for a member no asset claims', () => {
        const result = run({
            assetIds: [`solana-${UNSEEDED_MINT}`],
            canonicalAssetById: new Map(),
        });

        const fallback = result.get(`solana-${UNSEEDED_MINT}`);
        expect(fallback?.assetId).toBe(`solana-${UNSEEDED_MINT}`);
        expect(fallback?.variants.map(v => v.mint)).toEqual([UNSEEDED_MINT]);
        expect(fallback?.variants[0]?.tags).toEqual(['curated:metals']);
        expect(fallback?.category).toBe('commodity');
    });

    it('accepts a bare mint as the member id', () => {
        const result = run({
            assetIds: [UNSEEDED_MINT],
            canonicalAssetById: new Map(),
        });

        expect(result.get(`solana-${UNSEEDED_MINT}`)?.variants[0]?.mint).toBe(UNSEEDED_MINT);
    });

    it('prefers a registry asset over a fabricated singleton, and claims its mints', () => {
        const registryAsset = asset('gold', [UNSEEDED_MINT]);

        const result = run({
            assetIds: ['gold', `solana-${UNSEEDED_MINT}`],
            canonicalAssetById: new Map(),
            registry: { gold: registryAsset },
        });

        expect([...result.keys()]).toEqual(['gold']);
    });

    it('leaves assets already present untouched', () => {
        const existing = asset('gold', [UNSEEDED_MINT]);
        const canonicalAssetById = new Map([['gold', existing]]);

        const result = run({ assetIds: ['gold'], canonicalAssetById });

        expect(result.get('gold')).toBe(existing);
    });
});
