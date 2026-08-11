import { describe, expect, it } from 'bun:test';

import type { CanonicalAsset } from '@tokens/asset-registry';

import {
    backfillMissingAssetIdentity,
    seedCanonicalAssetsRegistry,
    buildAssetAliases,
    buildCollectionMembersFromMints,
    deriveFallbackName,
    deriveFallbackSymbol,
    type BirdeyeIdentityClient,
    type CanonicalAssetAliasUpsert,
    type CanonicalAssetCollectionMemberUpsert,
    type CanonicalAssetCollectionUpsert,
    type CanonicalAssetUpsert,
    type CanonicalAssetVariantUpsert,
    type IdentityAssetRow,
    type IdentityMarketRow,
    type IdentityVariantRow,
    type SeedRepo,
    type SetAssetIdentityArgs,
} from './crons.seed';

const FIXED_NOW = 1_780_000_000_000;

interface RecorderState {
    upsertedAssets: CanonicalAssetUpsert[];
    upsertedVariants: CanonicalAssetVariantUpsert[];
    upsertedAliases: CanonicalAssetAliasUpsert[];
    ensuredMarkets: string[];
    upsertedCollections: CanonicalAssetCollectionUpsert[];
    mergedCollectionSlugs: string[];
    upsertedCollectionMembers: CanonicalAssetCollectionMemberUpsert[];
    /** Simulated DB rows per slug (post-merge), backing listCollectionMemberUnion. */
    membersBySlug: Map<string, CanonicalAssetCollectionMemberUpsert[]>;
    tombstonedRefs: Set<string>;
    loweredAddedAtCalls: Array<{ mint: string; addedAtMs: number }>;
    refreshedViewCount: number;
    identityAssetsByAssetId: Record<string, IdentityAssetRow>;
    identityVariantsByAssetId: Record<string, IdentityVariantRow[]>;
    identityMarketsByMint: Record<string, IdentityMarketRow>;
    identitySetCalls: SetAssetIdentityArgs[];
}

function makeRepo(): { repo: SeedRepo; state: RecorderState } {
    const state: RecorderState = {
        upsertedAssets: [],
        upsertedVariants: [],
        upsertedAliases: [],
        ensuredMarkets: [],
        upsertedCollections: [],
        mergedCollectionSlugs: [],
        upsertedCollectionMembers: [],
        membersBySlug: new Map(),
        tombstonedRefs: new Set(),
        loweredAddedAtCalls: [],
        refreshedViewCount: 0,
        identityAssetsByAssetId: {},
        identityVariantsByAssetId: {},
        identityMarketsByMint: {},
        identitySetCalls: [],
    };
    const repo: SeedRepo = {
        async withTransaction(fn) { await fn(repo); },
        async upsertCanonicalAsset(args) { state.upsertedAssets.push(args); },
        async upsertCanonicalAssetVariant(args) { state.upsertedVariants.push(args); },
        async upsertCanonicalAssetAlias(args) { state.upsertedAliases.push(args); },
        async ensureVariantMarketRow(mint) { state.ensuredMarkets.push(mint); },
        async upsertAssetCollection(args) { state.upsertedCollections.push(args); },
        async mergeAssetCollectionMembers(slug, members) {
            state.mergedCollectionSlugs.push(slug);
            for (const m of members) state.upsertedCollectionMembers.push(m);
            // Registry merge replaces registry rows wholesale; admin rows are
            // simulated by pre-seeding membersBySlug before the run.
            const existing = state.membersBySlug.get(slug) ?? [];
            const preserved = existing.filter(row => !members.some(m => m.assetId === row.assetId));
            state.membersBySlug.set(slug, [...preserved, ...members]);
        },
        async listTombstonedRefs(normalizedRefs) {
            return normalizedRefs.filter(ref => state.tombstonedRefs.has(ref));
        },
        async listCollectionMemberUnion(excludeSlug) {
            const out: Array<{ collectionSlug: string; assetId: string; rank: number; addedAt: number }> = [];
            for (const [slug, members] of state.membersBySlug) {
                if (slug === excludeSlug) continue;
                for (const m of members) {
                    out.push({ collectionSlug: slug, assetId: m.assetId, rank: m.rank, addedAt: m.addedAt });
                }
            }
            return out;
        },
        async lowerCollectionMemberAddedAtByMint(mint, addedAtMs) {
            state.loweredAddedAtCalls.push({ mint, addedAtMs });
            return 1;
        },
        async refreshSolanaDefaultVariantsView() { state.refreshedViewCount += 1; },
        async findIdentityAssetsByAssetIds(assetIds) {
            const out: IdentityAssetRow[] = [];
            for (const id of assetIds) {
                const row = state.identityAssetsByAssetId[id];
                if (row) out.push(row);
            }
            return out;
        },
        async findIdentityVariantsByAssetIds(assetIds) {
            const out: IdentityVariantRow[] = [];
            for (const id of assetIds) {
                const list = state.identityVariantsByAssetId[id];
                if (list) out.push(...list);
            }
            return out;
        },
        async findIdentityMarketsByMints(mints) {
            const out: IdentityMarketRow[] = [];
            for (const mint of mints) {
                const row = state.identityMarketsByMint[mint];
                if (row) out.push(row);
            }
            return out;
        },
        async setAssetIdentityFromMintIfMissing(args) { state.identitySetCalls.push(args); },
    };
    return { repo, state };
}

const sampleAsset: CanonicalAsset = {
    assetId: 'jup',
    category: 'token',
    name: 'Jupiter',
    symbol: 'JUP',
    aliases: ['jupiter-aggregator'],
    coingeckoId: 'jupiter-exchange-solana',
    variants: [
        {
            variantId: 'jup:solana:default',
            mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
            kind: 'default',
            trustTier: 'tier1',
            tags: [],
            symbol: 'JUP',
            name: 'Jupiter',
        },
    ],
} as unknown as CanonicalAsset;

describe('buildAssetAliases', () => {
    it('emits aliases for assetId, name, symbol, coingeckoId, free aliases, and variant fields', () => {
        const aliases = buildAssetAliases(sampleAsset);
        const kinds = aliases.map(a => a.kind);
        expect(kinds).toContain('assetId');
        expect(kinds).toContain('name');
        expect(kinds).toContain('symbol');
        expect(kinds).toContain('coingeckoId');
        expect(kinds).toContain('alias');
        expect(kinds).toContain('mint');
        expect(kinds).toContain('variantId');
        const assetIdAlias = aliases.find(a => a.kind === 'assetId');
        expect(assetIdAlias!.normalized).toBe('jup');
        expect(assetIdAlias!.priority).toBe(1000);
    });

    it('dedupes aliases by (kind, normalized)', () => {
        const dupAsset: CanonicalAsset = { ...sampleAsset, aliases: ['JUP', 'jup'] } as unknown as CanonicalAsset;
        const aliases = buildAssetAliases(dupAsset);
        const seen = new Set<string>();
        for (const a of aliases) {
            const key = `${a.kind}:${a.normalized}`;
            expect(seen.has(key)).toBe(false);
            seen.add(key);
        }
    });
});

describe('buildCollectionMembersFromMints', () => {
    const resolve = (mint: string) => {
        if (mint === 'mintA') return 'jup';
        if (mint === 'mintB') return 'sol';
        if (mint === 'mintA-dup') return 'jup';
        return null;
    };

    it('preserves rank by first-occurrence and dedupes asset ids', () => {
        const members = buildCollectionMembersFromMints(['mintA', 'mintB', 'mintA-dup'], resolve, () => null, FIXED_NOW);
        expect(members).toEqual([
            { assetId: 'jup', rank: 0, addedAt: FIXED_NOW },
            { assetId: 'sol', rank: 1, addedAt: FIXED_NOW },
        ]);
    });

    it('uses git added-at when known and keeps the min across an asset\'s mints', () => {
        const addedAt = (mint: string) => (mint === 'mintA-dup' ? 1_000 : mint === 'mintB' ? 2_000 : null);
        const members = buildCollectionMembersFromMints(['mintA', 'mintB', 'mintA-dup'], resolve, addedAt, FIXED_NOW);
        expect(members).toEqual([
            { assetId: 'jup', rank: 0, addedAt: 1_000 },
            { assetId: 'sol', rank: 1, addedAt: 2_000 },
        ]);
    });
});

describe('seedCanonicalAssetsRegistry', () => {
    const GIT_ADDED_AT = 1_700_000_000_000;

    function makeDeps(repo: SeedRepo) {
        return {
            repo,
            now: () => FIXED_NOW,
            listCanonicalAssets: () => [sampleAsset],
            listCuratedListOrder: () => ['majors'],
            getCuratedListMints: () => [sampleAsset.variants[0]!.mint],
            getCuratedListTitle: () => ({ title: 'Majors', description: 'Major tokens' }),
            resolveAssetIdByMint: (mint: string) => (mint === sampleAsset.variants[0]!.mint ? 'jup' : null),
            getCuratedAddedAtMsByMint: (mint: string) => (mint === sampleAsset.variants[0]!.mint ? GIT_ADDED_AT : null),
        };
    }

    it('upserts assets, variants, aliases, ensures markets, merges collections', async () => {
        const { repo, state } = makeRepo();
        const res = await seedCanonicalAssetsRegistry(makeDeps(repo), {});
        expect(res.ok).toBe(true);
        expect(res.assets).toBe(1);
        expect(res.variants).toBe(1);
        expect(state.upsertedAssets.length).toBe(1);
        expect(state.upsertedAssets[0]!.assetId).toBe('jup');
        expect(state.upsertedVariants.length).toBe(1);
        expect(state.ensuredMarkets).toEqual([sampleAsset.variants[0]!.mint]);
        expect(state.upsertedAliases.length).toBeGreaterThan(0);
        const collectionSlugs = state.upsertedCollections.map(c => c.slug);
        expect(collectionSlugs).toEqual(['majors', 'all']);
        expect(state.mergedCollectionSlugs).toEqual(['majors', 'all']);
        const majorsMembers = state.upsertedCollectionMembers.filter(m => m.collectionSlug === 'majors');
        expect(majorsMembers).toEqual([{ collectionSlug: 'majors', assetId: 'jup', rank: 0, addedAt: GIT_ADDED_AT }]);
        const allMembers = state.upsertedCollectionMembers.filter(m => m.collectionSlug === 'all');
        expect(allMembers).toEqual([{ collectionSlug: 'all', assetId: 'jup', rank: 0, addedAt: GIT_ADDED_AT }]);
        expect(state.refreshedViewCount).toBe(1);
    });

    it('skips tombstoned assets entirely (no upsert, no membership)', async () => {
        const { repo, state } = makeRepo();
        state.tombstonedRefs.add(sampleAsset.variants[0]!.mint.toLowerCase());
        const res = await seedCanonicalAssetsRegistry(makeDeps(repo), {});
        expect(res.ok).toBe(true);
        expect(res.tombstonedSkipped).toBe(1);
        expect(state.upsertedAssets.length).toBe(0);
        expect(state.upsertedVariants.length).toBe(0);
        expect(state.upsertedCollectionMembers.length).toBe(0);
    });

    it("derives the 'all' collection from the DB union, including admin-added members", async () => {
        const { repo, state } = makeRepo();
        // Simulate a pre-existing admin-added membership in another slug.
        state.membersBySlug.set('rwas', [
            { collectionSlug: 'rwas', assetId: 'admin-token', rank: 5, addedAt: 42 },
        ]);
        await seedCanonicalAssetsRegistry(makeDeps(repo), {});
        const allMembers = state.upsertedCollectionMembers.filter(m => m.collectionSlug === 'all');
        expect(allMembers).toEqual([
            { collectionSlug: 'all', assetId: 'jup', rank: 0, addedAt: GIT_ADDED_AT },
            { collectionSlug: 'all', assetId: 'admin-token', rank: 1, addedAt: 42 },
        ]);
    });

    it('skips view refresh when not provided', async () => {
        const { repo, state } = makeRepo();
        const repoNoView: SeedRepo = { ...repo };
        delete repoNoView.refreshSolanaDefaultVariantsView;
        await seedCanonicalAssetsRegistry(
            {
                repo: repoNoView,
                now: () => FIXED_NOW,
                listCanonicalAssets: () => [],
                listCuratedListOrder: () => [],
                resolveAssetIdByMint: () => null,
            },
            {},
        );
        expect(state.refreshedViewCount).toBe(0);
    });
});

describe('deriveFallbackSymbol/Name', () => {
    it('uppercases asset symbol when ticker-like', () => {
        const asset: CanonicalAsset = { ...sampleAsset, symbol: 'jup', variants: [] } as unknown as CanonicalAsset;
        expect(deriveFallbackSymbol(asset)).toBe('JUP');
    });

    it('falls back to last assetId segment when symbol is non-ticker and no variant gives a ticker', () => {
        const asset: CanonicalAsset = {
            assetId: 'equity-us-tsla',
            category: 'equity',
            symbol: 'Some Name',
            aliases: [],
            variants: [],
        } as unknown as CanonicalAsset;
        expect(deriveFallbackSymbol(asset)).toBe('TSLA');
    });

    it('uses asset name when set, otherwise falls back to symbol when no variant carries a name', () => {
        const asset: CanonicalAsset = {
            assetId: 'jup',
            category: 'token',
            name: 'Jupiter',
            aliases: [],
            variants: [],
        } as unknown as CanonicalAsset;
        expect(deriveFallbackName(asset, 'JUP')).toBe('Jupiter');
        const nameless: CanonicalAsset = {
            assetId: 'jup',
            category: 'token',
            aliases: [],
            variants: [],
        } as unknown as CanonicalAsset;
        expect(deriveFallbackName(nameless, 'JUP')).toBe('JUP');
    });
});

describe('backfillMissingAssetIdentity', () => {
    it('uses variant_markets symbol/name first when available', async () => {
        const { repo, state } = makeRepo();
        state.identityAssetsByAssetId['jup'] = { assetId: 'jup', category: 'token', symbol: null, name: null };
        state.identityVariantsByAssetId['jup'] = [{
            assetId: 'jup', mint: 'm1', variantId: 'jup:solana:default', trustTier: 'tier1',
            label: null, issuer: null, tags: [],
        }];
        state.identityMarketsByMint['m1'] = { mint: 'm1', symbol: 'JUP', name: 'Jupiter' };
        const res = await backfillMissingAssetIdentity(
            {
                repo,
                now: () => FIXED_NOW,
                listCanonicalAssets: () => [sampleAsset],
            },
            { delayMs: 0 },
        );
        expect(res.updated).toBe(1);
        expect(state.identitySetCalls.length).toBe(1);
        expect(state.identitySetCalls[0]!).toEqual({ mint: 'm1', symbol: 'JUP', name: 'Jupiter', force: false });
    });

    it('falls back to birdeye when market identity is missing', async () => {
        const { repo, state } = makeRepo();
        state.identityAssetsByAssetId['jup'] = { assetId: 'jup', category: 'token', symbol: null, name: null };
        state.identityVariantsByAssetId['jup'] = [{
            assetId: 'jup', mint: 'm1', variantId: 'jup:solana:default', trustTier: 'tier1',
            label: null, issuer: null, tags: [],
        }];
        const birdeye: BirdeyeIdentityClient = {
            async fetchIdentityByMint() { return { symbol: 'BIRD', name: 'Birdeye Jupiter' }; },
        };
        const res = await backfillMissingAssetIdentity(
            {
                repo,
                now: () => FIXED_NOW,
                listCanonicalAssets: () => [sampleAsset],
                birdeyeIdentity: birdeye,
            },
            { delayMs: 0 },
        );
        expect(res.updated).toBe(1);
        expect(state.identitySetCalls[0]!.symbol).toBe('BIRD');
        expect(state.identitySetCalls[0]!.name).toBe('Birdeye Jupiter');
    });

    it('falls back to registry-derived symbol/name when no external data', async () => {
        const { repo, state } = makeRepo();
        state.identityAssetsByAssetId['jup'] = { assetId: 'jup', category: 'token', symbol: null, name: null };
        state.identityVariantsByAssetId['jup'] = [{
            assetId: 'jup', mint: 'm1', variantId: 'jup:solana:default', trustTier: 'tier1',
            label: null, issuer: null, tags: [],
        }];
        const res = await backfillMissingAssetIdentity(
            {
                repo,
                now: () => FIXED_NOW,
                listCanonicalAssets: () => [sampleAsset],
            },
            { delayMs: 0 },
        );
        expect(res.updated).toBe(1);
        expect(state.identitySetCalls[0]!.symbol).toBe('JUP');
        expect(state.identitySetCalls[0]!.name).toBe('Jupiter');
    });

    it('skips assets that already have symbol AND name unless force=true', async () => {
        const { repo, state } = makeRepo();
        state.identityAssetsByAssetId['jup'] = { assetId: 'jup', category: 'token', symbol: 'JUP', name: 'Jupiter' };
        state.identityVariantsByAssetId['jup'] = [{
            assetId: 'jup', mint: 'm1', variantId: 'jup:solana:default', trustTier: 'tier1',
            label: null, issuer: null, tags: [],
        }];
        state.identityMarketsByMint['m1'] = { mint: 'm1', symbol: 'NEW', name: 'New Name' };
        const res = await backfillMissingAssetIdentity(
            {
                repo,
                now: () => FIXED_NOW,
                listCanonicalAssets: () => [sampleAsset],
            },
            { delayMs: 0 },
        );
        expect(res.skipped).toBe(1);
        expect(res.updated).toBe(0);
        expect(state.identitySetCalls.length).toBe(0);
        const forced = await backfillMissingAssetIdentity(
            {
                repo,
                now: () => FIXED_NOW,
                listCanonicalAssets: () => [sampleAsset],
            },
            { delayMs: 0, force: true },
        );
        expect(forced.updated).toBe(1);
    });

    it('skips when asset has no variants', async () => {
        const { repo, state } = makeRepo();
        state.identityAssetsByAssetId['jup'] = { assetId: 'jup', category: 'token', symbol: null, name: null };
        const res = await backfillMissingAssetIdentity(
            {
                repo,
                now: () => FIXED_NOW,
                listCanonicalAssets: () => [sampleAsset],
            },
            { delayMs: 0 },
        );
        expect(res.skipped).toBe(1);
        expect(state.identitySetCalls.length).toBe(0);
    });
});
