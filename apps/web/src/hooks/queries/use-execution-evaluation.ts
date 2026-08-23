import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Effect } from 'effect';

import { apiJson } from '@/effect/api-client';
import { shouldRetryApiQuery } from '@/effect/query-retry';

export const EXECUTION_AMOUNT_MIN_USD = 1;
export const EXECUTION_AMOUNT_MAX_USD = 50_000_000;

export type ImpactGrade = 'excellent' | 'good' | 'fair' | 'poor' | 'avoid';

export interface ExecutionLadderRung {
    sizeUsd: number;
    impactBps: number;
    grade: ImpactGrade;
}

export interface ExecutionEvaluationVariant {
    rank: number;
    mint: string;
    variantId: string;
    kind: string;
    issuer: string | null;
    trustTier: string;
    symbol: string | null;
    name: string | null;
    liquidityUsd: number | null;
    volume24hUSD: number | null;
    executionScore: number | null;
    feeBps: number | null;
    isFillQualityEligible: boolean;
    ladder: ExecutionLadderRung[] | null;
    estimatedImpactBps: number | null;
    estimatedOutUsd: number | null;
    sizeAwareScore: number | null;
    executionGrade: ImpactGrade | null;
    depthAsOf: number | null;
    reasons: string[];
}

export interface ExecutionEvaluationResponse {
    asset: { assetId: string; name: string | null; symbol: string | null; category: string | null };
    side: 'buy' | 'sell';
    amountUsd: number | null;
    primary: { mint: string; variantId: string; reason: string } | null;
    variants: ExecutionEvaluationVariant[];
    meta: {
        asOf: number;
        scoringVersion: string;
        sizeAwareScoringVersion: string | null;
        gradingVersion: string;
        quoteMode: 'sampled' | 'live';
        strategy: string;
        sizeLadderUsd: number[] | null;
        depthSource: string | null;
        depthCoverage: { withCurves: number; total: number };
    };
}

/**
 * Round to 2 significant figures so query keys line up with the API's
 * stale-cache amount bucketing instead of fanning out per keystroke.
 */
export function bucketAmountUsd(amountUsd: number): number {
    return Number(amountUsd.toPrecision(2));
}

export function clampAmountUsd(amountUsd: number): number {
    return Math.min(EXECUTION_AMOUNT_MAX_USD, Math.max(EXECUTION_AMOUNT_MIN_USD, amountUsd));
}

interface UseExecutionEvaluationOptions {
    /** Omit for the scorecard call (graded ladder per variant). */
    amountUsd?: number | null;
    /** Fetch live quotes at the requested amount instead of interpolating stored curves. */
    live?: boolean;
    /** Ask the API to sample uncovered mints on demand (slow first call, then persisted). */
    sample?: boolean;
    enabled?: boolean;
}

export function useExecutionEvaluation(assetId: string, options: UseExecutionEvaluationOptions = {}) {
    const { amountUsd = null, live = false, sample = false, enabled = true } = options;

    return useQuery<ExecutionEvaluationResponse>({
        queryKey: ['execution', 'evaluate', assetId, amountUsd, live, sample],
        queryFn: async ({ signal }) => {
            const params = new URLSearchParams({ asset: assetId });
            if (amountUsd !== null) params.set('amountUsd', String(amountUsd));
            if (live && amountUsd !== null) params.set('quotes', 'live');
            if (sample) params.set('sample', 'missing');

            return Effect.runPromise(
                apiJson<ExecutionEvaluationResponse>({ url: `/api/v2/execution/evaluate?${params.toString()}` }),
                { signal },
            );
        },
        enabled: enabled && assetId.trim().length > 0,
        retry: shouldRetryApiQuery,
        // Live quotes go stale fast; sampled data follows the provider default.
        ...(live ? { staleTime: 15_000 } : {}),
        // Keeps the previous evaluation on screen while a new amount loads.
        placeholderData: keepPreviousData,
    });
}
