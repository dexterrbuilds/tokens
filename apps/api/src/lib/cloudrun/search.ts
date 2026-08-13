/**
 * Client wrapper for the composite search prefetch endpoint on
 * cloudrun-assets. Collapses the query-fanout Vercel→Cloud Run round-trips
 * the search route was doing (sanctumResolveRef + cloudRunSearch +
 * tokensSearchTokens + assetVariantsListByMints) into a single call.
 *
 * The response shape is deliberately raw: it mirrors what each per-handler
 * call would have returned, so the route's assembly logic can consume the
 * fields as if it had made the individual calls itself. This preserves the
 * `/api/v1/assets/search` response shape by construction.
 */

import type { Effect } from 'effect';

import { cloudRunQuery } from './client';
import type { CloudRunError } from './errors';

// Re-export the authoritative shape from the Cloud Run handler so the wrapper
// and the server agree by construction.
export type {
    SearchPrefetchArgs,
    SearchPrefetchResult,
} from '../../../../cloudrun-assets/src/handlers/assetsApiSearchPrefetch';
import type { SearchPrefetchArgs, SearchPrefetchResult } from '../../../../cloudrun-assets/src/handlers/assetsApiSearchPrefetch';

/**
 * Fetch every raw row the search route needs in a single Cloud Run RTT.
 */
export function searchPrefetchForApi(args: SearchPrefetchArgs): Effect.Effect<SearchPrefetchResult, CloudRunError> {
    return cloudRunQuery<SearchPrefetchResult>(
        'assets',
        'assetsApiSearchPrefetchForApi',
        { ...args },
    );
}
