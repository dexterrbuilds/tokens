/**
 * Client wrapper for the composite curated prefetch endpoint on
 * cloudrun-assets. Collapses the ~8 sequential Vercel→Cloud Run round-trips
 * the curated route was doing (assets, variants, markets, fillQuality,
 * aggregates, stocks, sanctum, tombstones) into a single call.
 *
 * The response shape is deliberately raw: it mirrors what each per-handler
 * call would have returned, so the route's assembly logic can consume the
 * fields as if it had made the individual calls itself. This preserves the
 * `/api/v1/assets/curated` response shape by construction.
 */

import type { Effect } from 'effect';

import { cloudRunQuery } from './client';
import type { CloudRunError } from './errors';

// Re-export the authoritative shape from the Cloud Run handler so the wrapper
// and the server agree by construction.
export type {
    CuratedPrefetchArgs,
    CuratedPrefetchResult,
} from '../../../../cloudrun-assets/src/handlers/assetsApiCuratedPrefetch';
import type { CuratedPrefetchArgs, CuratedPrefetchResult } from '../../../../cloudrun-assets/src/handlers/assetsApiCuratedPrefetch';

/**
 * Fetch every raw row the curated route needs in a single Cloud Run RTT.
 *
 * Timeout: the query itself answers in <0.6s server-side, but during a
 * scale-out (request concurrency 80 since #272) requests queue at the Cloud
 * Run router while new Bun instances boot — 5s tripped 25 spurious timeouts
 * in the 2026-07-19 08:19Z window while every backend completion was fast.
 * 10s covers cold-start queueing; worst case ~20.5s across both attempts of
 * the caller's route-level retry. Retry policy deliberately lives at the
 * call site, not here — stacking a client-level retry on top would multiply
 * attempts against an already saturated backend.
 */
const CURATED_PREFETCH_TIMEOUT_MS = 10_000;

export function curatedPrefetchForApi(args: CuratedPrefetchArgs): Effect.Effect<CuratedPrefetchResult, CloudRunError> {
    return cloudRunQuery<CuratedPrefetchResult>(
        'assets',
        'assetsApiCuratedPrefetchForApi',
        { ...args },
        { timeoutMs: CURATED_PREFETCH_TIMEOUT_MS },
    );
}
