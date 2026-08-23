import type {
    DepthSampleResult,
    ExecutionQuotesLiveResult,
} from '../../../../cloudrun-assets/src/handlers/liveQuotes';

import type { Effect } from 'effect';

import { cloudRunMutation, cloudRunQuery } from './client';
import type { CloudRunError } from './errors';

export type ExecutionQuotesLiveArgs = { mints: string[]; amountUsd: number };

export function executionQuotesLive(
    args: ExecutionQuotesLiveArgs,
): Effect.Effect<ExecutionQuotesLiveResult, CloudRunError> {
    return cloudRunQuery<ExecutionQuotesLiveResult>('assets', 'executionQuotesLive', { ...args });
}

export type DepthSampleMintsArgs = { mints: string[] };

export function depthSampleMints(args: DepthSampleMintsArgs): Effect.Effect<DepthSampleResult, CloudRunError> {
    return cloudRunMutation<DepthSampleResult>('assets', 'depthSampleMints', { ...args });
}
