import type { Effect } from 'effect';

import { cloudRunQuery } from './client';
import type { CloudRunError } from './errors';

export type ListDeletedRefsArgs = { refs: string[] };
export type ListDeletedRefsResult = string[];

export function listDeletedRefs(args: ListDeletedRefsArgs): Effect.Effect<ListDeletedRefsResult, CloudRunError> {
    return cloudRunQuery<ListDeletedRefsResult>('assets', 'listDeletedRefs', { ...args });
}
