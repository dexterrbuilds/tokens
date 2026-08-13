import { Effect } from 'effect';

import {
    assetCollectionsGetMemberMints,
    getSolanaDefaultVariantsViewForApi,
    listSolanaVariantsForApi,
} from '@/lib/cloudrun';
import {
    CURATED_LIST_ORDER,
    getCuratedTokenAddresses,
    getCuratedTokenList,
    type CuratedTokenListId,
} from '@tokens/asset-registry/compat';

export type CuratedTokenCategoryId = 'all' | CuratedTokenListId;

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

function getStaticListAddresses(listId: CuratedTokenListId): string[] {
    return getCuratedTokenAddresses(getCuratedTokenList(listId));
}

async function getDynamicCappedLstMints(): Promise<string[]> {
    const staticFallback = getStaticListAddresses('lsts');

    try {
        const cachedView = await Effect.runPromise(getSolanaDefaultVariantsViewForApi());
        const cachedMints = uniqueStrings(
            (cachedView?.variants ?? [])
                .filter((variant: { kind: string; mint: string }) => variant.kind === 'yield')
                .map((variant: { mint: string }) => variant.mint),
        );
        if (cachedMints.length > 0) return cachedMints;
    } catch {
        // fall through to live query / static fallback
    }

    try {
        const liveView = await Effect.runPromise(listSolanaVariantsForApi({ kind: 'yield' }));
        const liveMints = uniqueStrings((liveView?.variants ?? []).map((variant: { mint: string }) => variant.mint));
        return liveMints.length > 0 ? liveMints : staticFallback;
    } catch {
        return staticFallback;
    }
}

// DB membership union (fail-open): admin-added tokens surface in the legacy
// curated lists without a registry PR; any RPC failure degrades to static-only.
async function getDbMemberMints(listId: string): Promise<string[]> {
    try {
        return await Effect.runPromise(assetCollectionsGetMemberMints({ slug: listId, limit: 2000 }));
    } catch {
        return [];
    }
}

export async function getEffectiveCuratedAddresses(
    listId: CuratedTokenCategoryId,
): Promise<{ addresses: string[]; sanctumLstMints: Set<string> }> {
    const sanctumLstAddresses = listId === 'all' || listId === 'lsts' ? await getDynamicCappedLstMints() : [];
    const sanctumLstMints = new Set(sanctumLstAddresses);

    if (listId === 'lsts') {
        return { addresses: sanctumLstAddresses, sanctumLstMints };
    }

    if (listId === 'all') {
        const out: string[] = [];
        for (const id of CURATED_LIST_ORDER) {
            if (id === 'lsts') {
                out.push(...sanctumLstAddresses);
                continue;
            }
            out.push(...getStaticListAddresses(id));
        }
        out.push(...(await getDbMemberMints('all')));
        return { addresses: uniqueStrings(out), sanctumLstMints };
    }

    const dbMints = await getDbMemberMints(listId);
    return { addresses: uniqueStrings([...getStaticListAddresses(listId), ...dbMints]), sanctumLstMints };
}
