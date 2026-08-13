import type {
    SanctumLstResult,
    SanctumResolveRefResult,
} from '../../../../cloudrun-assets/src/handlers/sanctumLsts';

import type { Effect } from 'effect';

import { cloudRunQuery } from './client';
import type { CloudRunError } from './errors';

export type ListActiveArgs = { limit?: number };
export type ListActiveResult = SanctumLstResult[];

export function listActive(args: ListActiveArgs = {}): Effect.Effect<ListActiveResult, CloudRunError> {
    return cloudRunQuery<ListActiveResult>('assets', 'sanctumListActive', { ...args });
}

export type ResolveRefArgs = { ref: string };
export type ResolveRefResult = SanctumResolveRefResult | null;

export function resolveRef(args: ResolveRefArgs): Effect.Effect<ResolveRefResult, CloudRunError> {
    return cloudRunQuery<ResolveRefResult>('assets', 'sanctumResolveRef', { ...args });
}
