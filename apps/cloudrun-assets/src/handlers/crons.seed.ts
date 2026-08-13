import { Effect } from 'effect';
import { isShuttingDown } from '@tokens/cloudrun-shutdown';
import { runJobPool } from '@tokens/effect/job-runner';
import type { CanonicalAsset, TrustTier } from '@tokens/asset-registry';
import { listAssets } from '@tokens/asset-registry';
import {
    CURATED_LIST_ORDER,
    getCuratedTokenAddresses,
    getCuratedTokenList,
    type CuratedTokenListId,
} from '@tokens/asset-registry/compat';
import { getVariantByMint } from '@tokens/asset-registry';

import type { CronResult } from './crons';

export type AssetAliasKind =
    | 'assetId'
    | 'name'
    | 'symbol'
    | 'ticker'
    | 'coingeckoId'
    | 'alias'
    | 'mint'
    | 'variantId'
    | 'custom';

export interface CanonicalAssetUpsert {
    assetId: string;
    category: string;
    name?: string;
    symbol?: string;
    aliases: string[];
    coingeckoId?: string;
    imageUrl?: string;
    isActive: boolean;
}

export interface CanonicalAssetVariantUpsert {
    assetId: string;
    chain: 'solana';
    mint: string;
    variantId: string;
    kind: string;
    trustTier: TrustTier;
    stockVariantTier?: string;
    tags: readonly string[];
    issuer?: string;
    issuerUrl?: string;
    label?: string;
    isActive: boolean;
}

export interface CanonicalAssetAliasUpsert {
    assetId: string;
    normalized: string;
    alias: string;
    kind: AssetAliasKind;
    priority: number;
}

export interface CanonicalAssetCollectionUpsert {
    slug: string;
    title: string;
    description: string;
}

export interface CanonicalAssetCollectionMemberUpsert {
    collectionSlug: string;
    assetId: string;
    rank: number;
}

export interface IdentityAssetRow {
    assetId: string;
    category: string;
    symbol: string | null;
    name: string | null;
}

export interface IdentityVariantRow {
    assetId: string;
    mint: string;
    variantId: string;
    trustTier: TrustTier;
    label: string | null;
    issuer: string | null;
    tags: string[];
}

export interface IdentityMarketRow {
    mint: string;
    symbol: string | null;
    name: string | null;
}

export interface SetAssetIdentityArgs {
    mint: string;
    symbol?: string;
    name?: string;
    force?: boolean;
}

export interface SeedRepo {
    upsertCanonicalAsset(args: CanonicalAssetUpsert): Promise<void>;
    upsertCanonicalAssetVariant(args: CanonicalAssetVariantUpsert): Promise<void>;
    upsertCanonicalAssetAlias(args: CanonicalAssetAliasUpsert): Promise<void>;
    ensureVariantMarketRow(mint: string): Promise<void>;
    upsertAssetCollection(args: CanonicalAssetCollectionUpsert): Promise<void>;
    replaceAssetCollectionMembers(
        collectionSlug: string,
        members: readonly CanonicalAssetCollectionMemberUpsert[],
    ): Promise<void>;
    refreshSolanaDefaultVariantsView?(): Promise<void>;
    findIdentityAssetsByAssetIds(assetIds: readonly string[]): Promise<IdentityAssetRow[]>;
    findIdentityVariantsByAssetIds(assetIds: readonly string[]): Promise<IdentityVariantRow[]>;
    findIdentityMarketsByMints(mints: readonly string[]): Promise<IdentityMarketRow[]>;
    setAssetIdentityFromMintIfMissing(args: SetAssetIdentityArgs): Promise<void>;
    withTransaction(fn: (txRepo: SeedRepo) => Promise<void>): Promise<void>;
}

export interface BirdeyeIdentityClient {
    fetchIdentityByMint(mint: string): Promise<{ symbol: string | null; name: string | null }>;
}

export interface SeedCronDeps {
    repo: SeedRepo;
    now: () => number;
    listCanonicalAssets?: () => readonly CanonicalAsset[];
    listCuratedListOrder?: () => readonly string[];
    getCuratedListMints?: (listId: string) => string[];
    getCuratedListTitle?: (listId: string) => { title: string; description: string };
    getAllCuratedMintsInOrder?: () => string[];
    resolveAssetIdByMint?: (mint: string) => string | null;
    birdeyeIdentity?: BirdeyeIdentityClient;
}

function normalizeAlias(value: string): string {
    return value.trim().toLowerCase();
}

function addAlias(
    out: CanonicalAssetAliasUpsert[],
    seen: Set<string>,
    assetId: string,
    input: { alias: string; kind: AssetAliasKind; priority: number },
): void {
    const alias = input.alias.trim();
    const normalized = normalizeAlias(alias);
    if (!normalized) return;
    const key = `${input.kind}:${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ assetId, normalized, alias, kind: input.kind, priority: input.priority });
}

export function buildAssetAliases(asset: CanonicalAsset): CanonicalAssetAliasUpsert[] {
    const out: CanonicalAssetAliasUpsert[] = [];
    const seen = new Set<string>();
    addAlias(out, seen, asset.assetId, { alias: asset.assetId, kind: 'assetId', priority: 1000 });
    if (asset.name) addAlias(out, seen, asset.assetId, { alias: asset.name, kind: 'name', priority: 900 });
    if (asset.symbol) addAlias(out, seen, asset.assetId, { alias: asset.symbol, kind: 'symbol', priority: 800 });
    if (asset.coingeckoId) {
        addAlias(out, seen, asset.assetId, { alias: asset.coingeckoId, kind: 'coingeckoId', priority: 700 });
    }
    for (const alias of asset.aliases) {
        addAlias(out, seen, asset.assetId, { alias, kind: 'alias', priority: 600 });
    }
    for (const variant of asset.variants) {
        addAlias(out, seen, asset.assetId, { alias: variant.mint, kind: 'mint', priority: 500 });
        addAlias(out, seen, asset.assetId, { alias: variant.variantId, kind: 'variantId', priority: 475 });
        if (variant.symbol) {
            addAlias(out, seen, asset.assetId, { alias: variant.symbol, kind: 'custom', priority: 300 });
        }
        if (variant.name) {
            addAlias(out, seen, asset.assetId, { alias: variant.name, kind: 'custom', priority: 250 });
        }
        if (variant.label) {
            addAlias(out, seen, asset.assetId, { alias: variant.label, kind: 'custom', priority: 200 });
        }
    }
    return out;
}

export function buildCollectionMembersFromMints(
    mints: readonly string[],
    resolveAssetIdByMint: (mint: string) => string | null,
): Array<{ assetId: string; rank: number }> {
    const rankByAssetId = new Map<string, number>();
    for (let i = 0; i < mints.length; i++) {
        const mint = mints[i]!;
        const assetId = resolveAssetIdByMint(mint);
        if (!assetId) continue;
        if (!rankByAssetId.has(assetId)) rankByAssetId.set(assetId, i);
    }
    return Array.from(rankByAssetId.entries())
        .map(([assetId, rank]) => ({ assetId, rank }))
        .sort((a, b) => a.rank - b.rank);
}

function getAllCuratedMintsInOrderDefault(): string[] {
    const unique = new Set<string>();
    const out: string[] = [];
    for (const listId of CURATED_LIST_ORDER) {
        const list = getCuratedTokenList(listId);
        for (const mint of getCuratedTokenAddresses(list)) {
            if (unique.has(mint)) continue;
            unique.add(mint);
            out.push(mint);
        }
    }
    return out;
}

function defaultResolveAssetIdByMint(mint: string): string | null {
    const match = getVariantByMint(mint);
    return match?.asset.assetId ?? null;
}

export async function seedCanonicalAssetsRegistry(
    deps: SeedCronDeps,
    _rawArgs: unknown,
): Promise<CronResult> {
    void _rawArgs;
    const start = deps.now();
    const assets = (deps.listCanonicalAssets ?? listAssets)();

    let assetCount = 0;
    let variantCount = 0;
    let aliasCount = 0;
    let ensuredMarkets = 0;

    for (const asset of assets) {
        await deps.repo.withTransaction(async txRepo => {
            await txRepo.upsertCanonicalAsset({
                assetId: asset.assetId,
                category: asset.category,
                ...(asset.name ? { name: asset.name } : {}),
                ...(asset.symbol ? { symbol: asset.symbol } : {}),
                aliases: [...asset.aliases],
                ...(asset.coingeckoId ? { coingeckoId: asset.coingeckoId } : {}),
                isActive: true,
            });

            for (const variant of asset.variants) {
                await txRepo.upsertCanonicalAssetVariant({
                    assetId: asset.assetId,
                    chain: 'solana',
                    mint: variant.mint,
                    variantId: variant.variantId,
                    kind: variant.kind,
                    trustTier: variant.trustTier,
                    ...(variant.stockVariantTier ? { stockVariantTier: variant.stockVariantTier } : {}),
                    tags: variant.tags,
                    ...(variant.issuer ? { issuer: variant.issuer } : {}),
                    ...(variant.issuerUrl ? { issuerUrl: variant.issuerUrl } : {}),
                    ...(variant.label ? { label: variant.label } : {}),
                    isActive: true,
                });
                await txRepo.ensureVariantMarketRow(variant.mint);
            }

            for (const alias of buildAssetAliases(asset)) {
                await txRepo.upsertCanonicalAssetAlias(alias);
            }
        });
        assetCount += 1;
        variantCount += asset.variants.length;
        ensuredMarkets += asset.variants.length;
        aliasCount += buildAssetAliases(asset).length;
    }

    const curatedListOrder = (deps.listCuratedListOrder ?? (() => CURATED_LIST_ORDER))();
    const getMints =
        deps.getCuratedListMints ??
        ((listId: string) => getCuratedTokenAddresses(getCuratedTokenList(listId as CuratedTokenListId)));
    const getTitle =
        deps.getCuratedListTitle ??
        ((listId: string) => {
            const list = getCuratedTokenList(listId as CuratedTokenListId);
            return { title: list.name, description: list.description };
        });
    const getAllMints = deps.getAllCuratedMintsInOrder ?? getAllCuratedMintsInOrderDefault;
    const resolveAssetId = deps.resolveAssetIdByMint ?? defaultResolveAssetIdByMint;

    let collectionsWritten = 0;
    let collectionMembersWritten = 0;

    const collections: Array<{ slug: string; title: string; description: string; mints: readonly string[] }> = [];
    for (const listId of curatedListOrder) {
        const { title, description } = getTitle(listId);
        collections.push({ slug: listId, title, description, mints: getMints(listId) });
    }
    collections.push({
        slug: 'all',
        title: 'All',
        description: 'All curated assets on Solana.',
        mints: getAllMints(),
    });

    for (const collection of collections) {
        await deps.repo.upsertAssetCollection({
            slug: collection.slug,
            title: collection.title,
            description: collection.description,
        });
        collectionsWritten += 1;

        const builtMembers = buildCollectionMembersFromMints(collection.mints, resolveAssetId);
        const members: CanonicalAssetCollectionMemberUpsert[] = [];
        for (const member of builtMembers) {
            const assetId = member.assetId.trim();
            if (!assetId) continue;
            members.push({ collectionSlug: collection.slug, assetId, rank: member.rank });
        }
        await deps.repo.replaceAssetCollectionMembers(collection.slug, members);
        collectionMembersWritten += members.length;
    }

    if (deps.repo.refreshSolanaDefaultVariantsView) {
        await deps.repo.refreshSolanaDefaultVariantsView();
    }

    return {
        ok: true,
        processed: assetCount,
        durationMs: deps.now() - start,
        assets: assetCount,
        variants: variantCount,
        aliases: aliasCount,
        ensuredMarkets,
        collections: collectionsWritten,
        collectionMembers: collectionMembersWritten,
    };
}

function asNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function uniqueStrings(values: readonly string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
        const trimmed = value.trim();
        if (!trimmed) continue;
        if (seen.has(trimmed)) continue;
        seen.add(trimmed);
        out.push(trimmed);
    }
    return out;
}

function looksLikeTicker(value: string): boolean {
    return /^[A-Z0-9]{2,16}$/.test(value.trim().toUpperCase());
}

function getPreferredVariantMint(
    variants: ReadonlyArray<{ mint: string; trustTier: TrustTier }>,
): string | null {
    const rank = (tier: TrustTier): number => {
        if (tier === 'tier1') return 0;
        if (tier === 'tier2') return 1;
        return 2;
    };
    const sorted = [...variants].sort((a, b) => rank(a.trustTier) - rank(b.trustTier));
    return sorted[0]?.mint ?? null;
}

export function deriveFallbackSymbol(asset: CanonicalAsset): string | null {
    if (asset.symbol && looksLikeTicker(asset.symbol)) return asset.symbol.trim().toUpperCase();
    for (const variant of asset.variants) {
        if (variant.symbol && looksLikeTicker(variant.symbol)) return variant.symbol.trim().toUpperCase();
        const label = asNonEmptyString(variant.label);
        if (label) {
            const first = label.split(/[\s(]/)[0]?.trim();
            if (first && looksLikeTicker(first)) return first.toUpperCase();
        }
    }
    const segments = asset.assetId.split(/[^a-z0-9]+/i).filter(Boolean);
    const last = segments[segments.length - 1];
    if (last && looksLikeTicker(last)) return last.toUpperCase();
    for (const alias of asset.aliases) {
        const trimmed = alias.trim();
        if (!trimmed) continue;
        if (looksLikeTicker(trimmed)) return trimmed.toUpperCase();
    }
    return null;
}

export function deriveFallbackName(asset: CanonicalAsset, symbol: string | null): string | null {
    if (asset.name && asset.name.trim() && asset.name.trim().toLowerCase() !== 'unknown') return asset.name.trim();
    for (const variant of asset.variants) {
        const label = asNonEmptyString(variant.label);
        if (label && label.trim().toLowerCase() !== 'unknown') return label;
        if (variant.name && variant.name.trim() && variant.name.trim().toLowerCase() !== 'unknown') {
            return variant.name.trim();
        }
    }
    return symbol;
}

function chunkArray<T>(items: readonly T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        out.push(items.slice(i, i + size));
    }
    return out;
}

export interface IdentityBackfillResult extends CronResult {
    requested: number;
    updated: number;
    skipped: number;
    failed: number;
    errors: Array<{ assetId: string; message: string }>;
}

export async function backfillMissingAssetIdentity(
    deps: SeedCronDeps,
    rawArgs: unknown,
): Promise<IdentityBackfillResult> {
    const args = (rawArgs && typeof rawArgs === 'object' ? (rawArgs as Record<string, unknown>) : {});
    const force = args.force === true;
    const requestedConcurrency = typeof args.concurrency === 'number' ? args.concurrency : 2;
    const concurrency = Math.min(Math.max(Math.floor(requestedConcurrency), 1), 5);
    const requestedDelayMs = typeof args.delayMs === 'number' ? args.delayMs : 150;
    const delayMs = Math.max(Math.floor(requestedDelayMs), 0);

    const start = deps.now();
    const registryAssets = (deps.listCanonicalAssets ?? listAssets)();
    const registryById = new Map(registryAssets.map(asset => [asset.assetId, asset] as const));

    const requestedAssetIdsArg = Array.isArray(args.assetIds)
        ? (args.assetIds as unknown[]).filter((s): s is string => typeof s === 'string')
        : [];
    const requestedAssetIds = uniqueStrings(
        requestedAssetIdsArg.length > 0 ? requestedAssetIdsArg : registryAssets.map(a => a.assetId),
    ).slice(0, 500);

    if (requestedAssetIds.length === 0) {
        return {
            ok: true,
            processed: 0,
            durationMs: deps.now() - start,
            requested: 0,
            updated: 0,
            skipped: 0,
            failed: 0,
            errors: [],
        };
    }

    const assetById = new Map<string, IdentityAssetRow>();
    for (const chunk of chunkArray(requestedAssetIds, 250)) {
        const rows = await deps.repo.findIdentityAssetsByAssetIds(chunk);
        for (const row of rows) assetById.set(row.assetId, row);
    }

    const variantsByAssetId = new Map<string, IdentityVariantRow[]>();
    for (const chunk of chunkArray(requestedAssetIds, 250)) {
        const rows = await deps.repo.findIdentityVariantsByAssetIds(chunk);
        for (const row of rows) {
            const list = variantsByAssetId.get(row.assetId) ?? [];
            list.push(row);
            variantsByAssetId.set(row.assetId, list);
        }
    }

    const mints: string[] = [];
    const preferredMintByAssetId = new Map<string, string>();
    for (const assetId of requestedAssetIds) {
        const variants = variantsByAssetId.get(assetId) ?? [];
        const mint = getPreferredVariantMint(variants);
        if (!mint) continue;
        preferredMintByAssetId.set(assetId, mint);
        mints.push(mint);
    }

    const marketIdentityByMint = new Map<string, { symbol: string | null; name: string | null }>();
    for (const chunk of chunkArray(mints, 250)) {
        const rows = await deps.repo.findIdentityMarketsByMints(chunk);
        for (const row of rows) {
            if (!row.symbol && !row.name) continue;
            marketIdentityByMint.set(row.mint, { symbol: row.symbol, name: row.name });
        }
    }

    let updated = 0;
    let skipped = 0;
    const errors: Array<{ assetId: string; message: string }> = [];

    const summary = await Effect.runPromise(
        runJobPool({
            label: 'backfillMissingAssetIdentity',
            items: requestedAssetIds,
            concurrency,
            delayMs,
            shouldStop: isShuttingDown,
            process: assetId =>
                Effect.tryPromise(async () => {
                const asset = assetById.get(assetId);
                const registryAsset = registryById.get(assetId);
                const mint = preferredMintByAssetId.get(assetId);
                if (!asset || !registryAsset || !mint) {
                    skipped += 1;
                    return;
                }
                const hasSymbol = typeof asset.symbol === 'string' && asset.symbol.trim().length > 0;
                const hasName = typeof asset.name === 'string' && asset.name.trim().length > 0;
                if (!force && hasSymbol && hasName) {
                    skipped += 1;
                    return;
                }
                const marketIdentity = marketIdentityByMint.get(mint);
                const marketSymbol = marketIdentity?.symbol ?? null;
                const marketName = marketIdentity?.name ?? null;
                if (marketSymbol || marketName) {
                    await deps.repo.setAssetIdentityFromMintIfMissing({
                        mint,
                        ...(marketSymbol ? { symbol: marketSymbol } : {}),
                        ...(marketName ? { name: marketName } : {}),
                        force,
                    });
                    updated += 1;
                    return;
                }
                if (deps.birdeyeIdentity) {
                    const birdeye = await deps.birdeyeIdentity.fetchIdentityByMint(mint);
                    if (birdeye.symbol || birdeye.name) {
                        await deps.repo.setAssetIdentityFromMintIfMissing({
                            mint,
                            ...(birdeye.symbol ? { symbol: birdeye.symbol } : {}),
                            ...(birdeye.name ? { name: birdeye.name } : {}),
                            force,
                        });
                        updated += 1;
                        return;
                    }
                }
                const fallbackSymbol = deriveFallbackSymbol(registryAsset);
                const fallbackName = deriveFallbackName(registryAsset, fallbackSymbol);
                if (fallbackSymbol || fallbackName) {
                    await deps.repo.setAssetIdentityFromMintIfMissing({
                        mint,
                        ...(fallbackSymbol ? { symbol: fallbackSymbol } : {}),
                        ...(fallbackName ? { name: fallbackName } : {}),
                        force,
                    });
                    updated += 1;
                    return;
                }
                skipped += 1;
                }),
            onItemError: (assetId, error) =>
                Effect.sync(() => {
                    errors.push({
                        assetId,
                        message: error instanceof Error ? error.message : String(error),
                    });
                }),
        }),
    );

    return {
        ok: !(summary.attempted > 0 && updated === 0 && skipped === 0 && summary.failed >= summary.attempted),
        processed: requestedAssetIds.length,
        durationMs: deps.now() - start,
        requested: requestedAssetIds.length,
        updated,
        skipped,
        failed: summary.failed,
        errors: errors.slice(0, 100),
        ...(summary.partial ? { partial: true } : {}),
    };
}

export type SeedJobHandler = (deps: SeedCronDeps, args: unknown) => Promise<CronResult>;

export const seedJobs: Record<string, SeedJobHandler> = {
    'seed-canonical-assets-registry': seedCanonicalAssetsRegistry,
    'backfill-missing-asset-identity': backfillMissingAssetIdentity,
};
