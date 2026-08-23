import type {
    DepthSampleResult,
    ExecutionQuotesLiveResult,
    JupiterTokenMetadata,
} from '../../../../cloudrun-assets/src/handlers/liveQuotes';

import type { Effect } from 'effect';

import { cloudRunMutation, cloudRunQuery } from './client';
import type { CloudRunError } from './errors';

export type ExecutionQuotesLiveArgs = {
    mint: string;
    side: 'buy' | 'sell';
    amounts: string[];
    tokenDecimals: number;
    /** Fan-out wall-clock budget; the handler returns partial results past it. */
    timeoutMs?: number;
};

/**
 * The transport timeout sits above the handler's own budget so the handler is
 * the layer that gives up first and can answer with partial results.
 */
const QUOTE_FANOUT_BUDGET_MS = 12_000;
const QUOTE_TRANSPORT_TIMEOUT_MS = 14_000;

export function executionQuotesLive(
    args: ExecutionQuotesLiveArgs,
): Effect.Effect<ExecutionQuotesLiveResult, CloudRunError> {
    return cloudRunQuery<ExecutionQuotesLiveResult>(
        'assets',
        'executionQuotesLive',
        { timeoutMs: QUOTE_FANOUT_BUDGET_MS, ...args },
        { timeoutMs: QUOTE_TRANSPORT_TIMEOUT_MS },
    );
}

export type ExecutionQuoteTokenMetadataArgs = { mint: string };

export function executionQuoteTokenMetadata(
    args: ExecutionQuoteTokenMetadataArgs,
): Effect.Effect<JupiterTokenMetadata | null, CloudRunError> {
    return cloudRunQuery<JupiterTokenMetadata | null>('assets', 'executionQuoteTokenMetadata', { ...args });
}

export type DepthSampleMintsArgs = { mints: string[] };

export function depthSampleMints(args: DepthSampleMintsArgs): Effect.Effect<DepthSampleResult, CloudRunError> {
    return cloudRunMutation<DepthSampleResult>('assets', 'depthSampleMints', { ...args });
}
