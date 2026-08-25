import 'server-only';

import { Effect, Schedule } from 'effect';
import { NextResponse } from 'next/server';
import { FetchFailedError, mergeSignals, toApiErrorInfo } from '@tokens/effect';

type NextFetchInit = RequestInit & { next?: { revalidate?: number } };
const LOCAL_API_ORIGIN = 'http://localhost:3002';
const PROXY_TIMEOUT = '20 seconds';

function normalizeOrigin(origin: string): string {
    return origin.trim().replace(/\/$/, '');
}

function buildUpstreamUrl(requestUrl: string, apiOrigin: string): URL {
    const incoming = new URL(requestUrl);
    const upstream = new URL(apiOrigin);
    const isHostedPublicApi = upstream.hostname.toLowerCase() === 'api.tokens.xyz';

    if (isHostedPublicApi && incoming.pathname.startsWith('/api/v1/')) {
        // The browser-facing Next.js proxy is namespaced under `/api/v1`, but
        // the hosted Tokens Platform API contract is `/v1` at api.tokens.xyz.
        upstream.pathname = incoming.pathname.slice('/api'.length);
    } else {
        // Internal/local API deployments expose their Next route handlers under
        // `/api/v1`, so preserve the incoming pathname for those origins.
        upstream.pathname = incoming.pathname;
    }

    upstream.search = incoming.search;
    upstream.hash = '';
    return upstream;
}

function safeApiOrigin(value: string): string {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname === '/' ? '' : url.pathname}`;
}

function safeUpstreamError(bodyBytes: ArrayBuffer, contentType: string, statusText: string): string {
    if (contentType.includes('application/json') && bodyBytes.byteLength > 0) {
        try {
            const parsed = JSON.parse(new TextDecoder().decode(bodyBytes)) as {
                error?: { message?: unknown };
            };
            const message = parsed.error?.message;
            if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 300);
        } catch {
            // Fall through to the non-sensitive status text.
        }
    }
    return statusText.trim() || 'Upstream request failed';
}

function getApiOrigin(requestUrl: string): string {
    const raw = process.env.API_BASE_URL?.trim() ?? process.env.TOKENS_API_ORIGIN?.trim() ?? '';
    if (raw) return normalizeOrigin(raw);

    if (process.env.NODE_ENV !== 'production') return LOCAL_API_ORIGIN;

    console.error('Platform proxy is not configured', {
        pathname: new URL(requestUrl).pathname,
        expectedEnv: ['API_BASE_URL', 'TOKENS_API_ORIGIN'],
    });
    throw new Error('Missing API origin for platform proxy');
}

function requirePlatformServiceKey(): string {
    const key = process.env.TOKENS_PLATFORM_API_KEY?.trim();
    if (!key) {
        throw new Error('TOKENS_PLATFORM_API_KEY is not set (required to proxy platform API requests)');
    }
    return key;
}

function stripHopByHopAndSensitiveHeaders(headers: Headers): void {
    headers.delete('host');
    headers.delete('connection');
    headers.delete('content-length');
    headers.delete('cookie');
    headers.delete('authorization');

    // Do not forward browser `accept-encoding` (often includes `zstd`).
    // Vercel may respond with `content-encoding: zstd`, which Node fetch cannot decode.
    // That leads to proxying compressed bytes as JSON and callers seeing null/parse failures.
    headers.delete('accept-encoding');
}

function stripUnsupportedUpstreamHeaders(headers: Headers): void {
    // Next.js uses `x-middleware-*` headers internally; forwarding them through an app route
    // can cause runtime errors (e.g. "NextResponse.rewrite() was used in a app route handler").
    for (const [key] of headers) {
        if (key.toLowerCase().startsWith('x-middleware-')) headers.delete(key);
    }
}

function stripProxyUnsafeResponseHeaders(headers: Headers): void {
    // When proxying, the runtime may re-encode or re-chunk the body. These headers can
    // become invalid and cause clients to see empty/garbled responses.
    headers.delete('content-encoding');
    headers.delete('content-length');
    headers.delete('transfer-encoding');
    headers.delete('connection');
}

/**
 * CDN cache policy for the proxied response. A number N becomes
 * `public, s-maxage=N, stale-while-revalidate=4N`; 'no-store' disables caching.
 * Defaults to the fetch-level cache settings in `init` (revalidate / no-store).
 * Only applied to successful (2xx) GET responses; non-2xx GETs get `no-store`.
 */
type ProxyCacheSeconds = number | 'no-store';

function applyProxyCacheControl(
    headers: Headers,
    method: string,
    status: number,
    cacheSeconds: ProxyCacheSeconds | undefined,
): void {
    if (method !== 'GET' || cacheSeconds === undefined) return;
    if (status >= 200 && status < 300 && typeof cacheSeconds === 'number') {
        headers.set('cache-control', `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 4}`);
    } else {
        headers.set('cache-control', 'no-store');
    }
}

export async function proxyPlatformRequest(
    request: Request,
    init?: NextFetchInit,
    cacheSeconds?: ProxyCacheSeconds,
): Promise<Response> {
    // Env misconfiguration keeps throwing synchronously — the route-level
    // try/catch maps it to the same 500 envelope it always did.
    const apiOrigin = getApiOrigin(request.url);
    const url = new URL(request.url);
    const keyConfigured = Boolean(process.env.TOKENS_PLATFORM_API_KEY?.trim());
    console.info(`[TOKEN_RADAR] API key configured: ${keyConfigured}`);
    console.info(`[TOKEN_RADAR] API base URL: ${safeApiOrigin(apiOrigin)}`);

    const platformKey = requirePlatformServiceKey();
    const upstreamUrl = buildUpstreamUrl(request.url, apiOrigin);
    console.info(`[TOKEN_RADAR] Requesting endpoint: ${upstreamUrl.pathname}${upstreamUrl.search}`);

    const headers = new Headers(request.headers);
    stripHopByHopAndSensitiveHeaders(headers);
    headers.set('accept', 'application/json');
    headers.set('x-api-key', platformKey);

    const method = request.method.toUpperCase();
    const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();

    const attempt = Effect.tryPromise({
        try: (signal: AbortSignal) => {
            const merged = mergeSignals(signal, request.signal);
            return fetch(upstreamUrl, {
                method,
                headers,
                body,
                redirect: 'manual',
                ...init,
                signal: merged.signal,
            }).finally(merged.cleanup);
        },
        catch: error =>
            new FetchFailedError({
                service: 'platform-proxy',
                message: `Failed to proxy ${method} ${url.pathname}`,
                cause: error instanceof Error ? error.message : String(error),
            }),
    }).pipe(
        Effect.flatMap(upstreamRes => {
            console.info(`[TOKEN_RADAR] Upstream status: ${upstreamRes.status}`);
            const responseHeaders = new Headers(upstreamRes.headers);
            stripUnsupportedUpstreamHeaders(responseHeaders);
            stripProxyUnsafeResponseHeaders(responseHeaders);
            applyProxyCacheControl(
                responseHeaders,
                method,
                upstreamRes.status,
                cacheSeconds ?? (init?.cache === 'no-store' ? 'no-store' : init?.next?.revalidate),
            );

            return Effect.tryPromise({
                try: () => upstreamRes.arrayBuffer(),
                catch: error =>
                    new FetchFailedError({
                        service: 'platform-proxy',
                        message: `Failed to read upstream body for ${method} ${url.pathname}`,
                        cause: error instanceof Error ? error.message : String(error),
                    }),
            }).pipe(
                Effect.map(bodyBytes => {
                    console.info('[TOKEN_RADAR] Response received: true');
                    if (!upstreamRes.ok) {
                        console.error(
                            `[TOKEN_RADAR] Upstream response error: ${safeUpstreamError(
                                bodyBytes,
                                responseHeaders.get('content-type') ?? '',
                                upstreamRes.statusText,
                            )}`,
                        );
                    }
                    return new Response(bodyBytes, {
                        status: upstreamRes.status,
                        headers: responseHeaders,
                    });
                }),
            );
        }),
        // A hung upstream previously hung this route indefinitely.
        Effect.timeout(PROXY_TIMEOUT),
    );

    // GETs are replay-safe: retry once on network failure only. HTTP error
    // statuses must pass through verbatim, and mutations are never replayed.
    const withRetry =
        method === 'GET'
            ? Effect.retry(attempt, {
                  while: error => error._tag === 'FetchFailedError',
                  times: 1,
                  schedule: Schedule.exponential('100 millis').pipe(Schedule.jittered),
              })
            : attempt;

    return Effect.runPromise(withRetry);
}

export function proxyPlatformGet(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    if (pathname === '/api/v1/assets/trending') {
        return proxyPlatformRequest(request, { cache: 'no-store' });
    }
    const assetDetailMatch = pathname.match(/^\/api\/v1\/assets\/([^/]+)$/);
    const collectionRoutes = new Set([
        'curated',
        'market-snapshots',
        'resolve',
        'risk-summary',
        'search',
        'trending',
        'variant-markets',
    ]);
    if (assetDetailMatch?.[1] && !collectionRoutes.has(assetDetailMatch[1])) {
        // Asset detail contains the current price and liquidity snapshot. Let the
        // upstream API own its 30-second freshness policy instead of adding a
        // second Vercel/Next cache on top of it.
        return proxyPlatformRequest(request, { cache: 'no-store' });
    }
    if (
        pathname.endsWith('/markets') ||
        pathname.endsWith('/variant-top-markets') ||
        url.searchParams
            .get('include')
            ?.split(',')
            .map(part => part.trim())
            .includes('markets')
    ) {
        return proxyPlatformRequest(request, { cache: 'no-store' });
    }
    if (pathname === '/api/v1/assets/search') {
        // Query strings are user-specific but still shareable; keep the CDN window short.
        return proxyPlatformRequest(request, { next: { revalidate: 60 } }, 30);
    }

    return proxyPlatformRequest(request, { next: { revalidate: 60 } });
}

export function proxyPlatformError(error: unknown): Response {
    const info = toApiErrorInfo(error);
    console.error('Platform proxy failed', JSON.stringify({ tag: info._tag, message: info.message }));
    return NextResponse.json(
        {
            error: {
                _tag: 'InternalServerError',
                message: 'Request proxy failed',
            },
        },
        { status: 500 },
    );
}
