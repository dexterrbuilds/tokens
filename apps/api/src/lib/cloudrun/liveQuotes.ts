import type { ExecutionQuotesLiveResult } from '../../../../cloudrun-assets/src/handlers/liveQuotes';

import type { Effect } from 'effect';

import { cloudRunQuery } from './client';
import type { CloudRunError } from './errors';

export type ExecutionQuotesLiveArgs = { mints: string[]; amountUsd: number };

export function executionQuotesLive(
    args: ExecutionQuotesLiveArgs,
): Effect.Effect<ExecutionQuotesLiveResult, CloudRunError> {
    return cloudRunQuery<ExecutionQuotesLiveResult>('assets', 'executionQuotesLive', { ...args });
}
