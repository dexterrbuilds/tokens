import { ApiResponseError } from '@tokens/effect';

/**
 * Shared TanStack Query retry predicate for queries backed by `apiJson`.
 * 4xx statuses are not transient for the client — retrying just increases
 * load and makes rate limits worse.
 */
export function shouldRetryApiQuery(failureCount: number, error: unknown, maxRetries = 2): boolean {
    if (error instanceof ApiResponseError) {
        if ([400, 401, 403, 404, 429].includes(error.status)) return false;
    }

    return failureCount < maxRetries;
}
