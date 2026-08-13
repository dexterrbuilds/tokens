'use client';

import { Effect } from 'effect';
import { ApiResponseError, FetchFailedError, JsonParseError, mergeSignals } from '@tokens/effect';
import { decodeApiResponse } from './api-response';

// Re-export so existing importers (hooks) keep working; the class itself
// lives in @tokens/effect so server modules can use it too.
export { ApiResponseError };

type NextFetchInit = RequestInit & { next?: { revalidate?: number } };

export interface ApiJsonArgs {
    url: string;
    /**
     * Optional fetch init. If you pass `json`, this will be merged and will
     * receive `content-type: application/json` automatically.
     */
    init?: NextFetchInit;
    /**
     * Optional JSON body. If provided, defaults method to POST and stringifies.
     */
    json?: unknown;
    /**
     * Optional extra AbortSignal to merge with Effect's runtime signal.
     */
    signal?: AbortSignal;
}

function buildInitWithJson(init: NextFetchInit | undefined, json: unknown): NextFetchInit {
    const method = init?.method ?? 'POST';
    const headers = new Headers(init?.headers);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    if (!headers.has('accept')) headers.set('accept', 'application/json');

    return {
        ...init,
        method,
        headers,
        body: JSON.stringify(json),
    };
}

export function apiJson<T = unknown>(
    args: ApiJsonArgs,
): Effect.Effect<T, ApiResponseError | FetchFailedError | JsonParseError> {
    const init = args.json === undefined ? args.init : buildInitWithJson(args.init, args.json);

    return Effect.tryPromise({
        try: (signal: AbortSignal) => {
            const merged = mergeSignals(signal, args.signal);
            return fetch(args.url, { ...init, signal: merged.signal }).finally(merged.cleanup);
        },
        catch: error =>
            new FetchFailedError({
                service: 'api',
                message: 'Failed to fetch API',
                cause: error instanceof Error ? error.message : String(error),
            }),
    }).pipe(Effect.flatMap(res => decodeApiResponse<T>(res)));
}
