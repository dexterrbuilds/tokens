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
};

export function executionQuotesLive(
    args: ExecutionQuotesLiveArgs,
): Effect.Effect<ExecutionQuotesLiveResult, CloudRunError> {
    return cloudRunQuery<ExecutionQuotesLiveResult>('assets', 'executionQuotesLive', { ...args });
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
