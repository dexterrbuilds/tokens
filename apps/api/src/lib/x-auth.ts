import { Effect } from 'effect';
import { UpstreamHttpError, fetchJson } from '@tokens/effect';
import { makeOAuth2TokenCache } from '@/effect/oauth-token-cache';

/**
 * Shared X (Twitter) API auth: OAuth2 client-credentials exchange with a
 * TTL'd token cache. Previously duplicated (with a forever-cache) in the
 * news/feed and x/tokens-feed routes.
 */

interface XOAuthTokenResponse {
    token_type?: string;
    access_token?: string;
}

const fetchXBearerToken: Effect.Effect<string, unknown> = Effect.suspend(() => {
    const apiKey = process.env.X_API_KEY?.trim();
    const apiSecret = process.env.X_API_SECRET?.trim();
    if (!apiKey || !apiSecret) {
        return Effect.fail(new Error('X_API_KEY / X_API_SECRET are not set'));
    }

    const credentials = `${encodeURIComponent(apiKey)}:${encodeURIComponent(apiSecret)}`;
    const authorization = Buffer.from(credentials).toString('base64');

    return fetchJson<XOAuthTokenResponse>({
        url: 'https://api.x.com/oauth2/token',
        service: 'x-oauth',
        init: {
            method: 'POST',
            headers: {
                Authorization: `Basic ${authorization}`,
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            },
            body: 'grant_type=client_credentials',
        },
    }).pipe(
        Effect.flatMap(data => {
            if (data.token_type?.toLowerCase() !== 'bearer' || !data.access_token) {
                return Effect.fail(new Error('X bearer token response was invalid'));
            }
            return Effect.succeed(data.access_token);
        }),
    );
});

const tokenCache = makeOAuth2TokenCache(fetchXBearerToken);

/**
 * Resolve a bearer token for the X API: a static X_BEARER_TOKEN env wins;
 * otherwise the cached client-credentials token. `null` means X integration
 * is not configured (feature disabled), matching the historical contract.
 */
export function resolveXBearerToken(): Effect.Effect<string | null, unknown> {
    return Effect.suspend(() => {
        const existingBearerToken = process.env.X_BEARER_TOKEN?.trim();
        if (existingBearerToken) return Effect.succeed(existingBearerToken);

        const apiKey = process.env.X_API_KEY?.trim();
        const apiSecret = process.env.X_API_SECRET?.trim();
        if (!apiKey || !apiSecret) return Effect.succeed<string | null>(null);

        return tokenCache.get;
    });
}

function isAuthFailure(error: unknown): boolean {
    return error instanceof UpstreamHttpError && (error.status === 401 || error.status === 403);
}

/**
 * Run an X API request; on an auth failure (401/403) the cached token is
 * invalidated so the next call re-fetches. (Tightened from the historical
 * behavior of invalidating on ANY error.)
 */
export function runXRequest<T>(request: Effect.Effect<T, unknown>): Effect.Effect<T, unknown> {
    return request.pipe(
        Effect.tapError(error => (isAuthFailure(error) ? tokenCache.invalidate : Effect.void)),
    );
}

/** Test seam. */
export const __xAuthInternals = { tokenCache };
