import { getCloudRunClient } from './client';

export type AssetCollectionsGetSummariesArgs = { slugs: string[] };
export type AssetCollectionSummary = {
    slug: string;
    count: number;
    lastAddedAssetId: string | null;
    lastAddedAt: number | null;
};

export async function assetCollectionsGetSummaries(
    args: AssetCollectionsGetSummariesArgs,
): Promise<AssetCollectionSummary[]> {
    return getCloudRunClient().query<AssetCollectionSummary[]>('assets', 'assetCollectionsGetSummaries', {
        ...args,
    });
}

export type AssetCollectionsGetMemberMintsArgs = { slug: string; limit?: number };

export async function assetCollectionsGetMemberMints(args: AssetCollectionsGetMemberMintsArgs): Promise<string[]> {
    return getCloudRunClient().query<string[]>('assets', 'assetCollectionsGetMemberMints', { ...args });
}
