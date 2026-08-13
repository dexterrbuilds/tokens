import type { Effect } from 'effect';

import { cloudRunQuery } from './client';
import type { CloudRunError } from './errors';

export type AssetCollectionsGetMembersArgs = { slug: string; limit?: number };
export type AssetCollectionsGetMembersResult = string[];

export function assetCollectionsGetMembers(
    args: AssetCollectionsGetMembersArgs,
): Effect.Effect<AssetCollectionsGetMembersResult, CloudRunError> {
    return cloudRunQuery<AssetCollectionsGetMembersResult>(
        'assets',
        'assetCollectionsGetMembers',
        { ...args },
    );
}
