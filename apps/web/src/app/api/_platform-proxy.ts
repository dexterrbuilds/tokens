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

    // Don’t forward browser `accept-encoding` (often includes `zstd`).
    // Vercel may respond with `content-encoding: zstd`, which Node fetch won’t decode.
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
    const platformKey = requirePlatformServiceKey();

    const url = new URL(request.url);
    const upstreamUrl = new URL(`${url.pathname}${url.search}`, apiOrigin);

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
                Effect.map(
                    bodyBytes =>
                        new Response(bodyBytes, {
                            status: upstreamRes.status,
                            headers: responseHeaders,
                        }),
                ),
            );
        }),
        // A hung upstream previously hung this route indefinitely.
        Effect.timeout(PROXY_TIMEOUT),
    );

    // GETs are replay-safe: retry once on network failure only — HTTP error
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
