import { Duration, Effect, Schedule } from 'effect';
import { mergeSignals } from './abort';
import { FetchFailedError, JsonParseError, RateLimitedError, UpstreamHttpError } from './api-errors';

type NextFetchInit = RequestInit & { next?: { revalidate?: number } };

export interface FetchJsonArgs {
    url: string;
    service: string;
    init?: NextFetchInit;
    signal?: AbortSignal;
}

function parseRetryAfterMs(value: string | null): number | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    // `retry-after` can be seconds (recommended) or an HTTP date.
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);

    const dateMs = Date.parse(trimmed);
    if (Number.isFinite(dateMs)) {
        const delta = dateMs - Date.now();
        return delta > 0 ? delta : 0;
    }

    return undefined;
}

function isRetryableFetchError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    if (!('_tag' in error)) return false;

    const tag = (error as { _tag?: unknown })._tag;
    if (tag === 'RateLimitedError') return true;
    if (tag === 'FetchFailedError') return true;

    if (tag === 'UpstreamHttpError') {
        const status = (error as { status?: unknown }).status;
        return typeof status === 'number' && status >= 500;
    }

    return false;
}

export function fetchJson<T = unknown>(
    args: FetchJsonArgs,
): Effect.Effect<T, RateLimitedError | UpstreamHttpError | FetchFailedError | JsonParseError> {
    return Effect.tryPromise({
        try: (signal: AbortSignal) => {
            const merged = mergeSignals(signal, args.signal);
            return Promise.resolve()
                .then(() => fetch(args.url, { ...args.init, signal: merged.signal }))
                .finally(merged.cleanup);
        },
        catch: error =>
            new FetchFailedError({
                service: args.service,
                message: `Failed to fetch ${args.service}`,
                cause: error instanceof Error ? error.message : String(error),
            }),
    }).pipe(
        Effect.flatMap(res => {
            type FetchJsonError = RateLimitedError | UpstreamHttpError | JsonParseError;

            if (res.status === 429) {
                return Effect.fail(
                    new RateLimitedError({
                        service: args.service,
                        message: `${args.service} rate limited`,
                        retryAfterMs: parseRetryAfterMs(res.headers.get('retry-after')),
                    }),
                ) as Effect.Effect<T, FetchJsonError, never>;
            }

            if (!res.ok) {
                const bodyEffect = Effect.tryPromise({
                    try: () => res.text(),
                    catch: error =>
                        new FetchFailedError({
                            service: args.service,
                            message: `Failed to read ${args.service} response body`,
                            cause: error instanceof Error ? error.message : String(error),
                        }),
                }).pipe(Effect.catch(() => Effect.succeed('')));

                return bodyEffect.pipe(
                    Effect.flatMap(body =>
                        Effect.fail(
                            new UpstreamHttpError({
                                service: args.service,
                                status: res.status,
                                statusText: res.statusText,
                                body: body.length > 0 ? body : undefined,
                                message: `${args.service} request failed`,
                            }),
                        ),
                    ),
                ) as Effect.Effect<T, FetchJsonError, never>;
            }

            return Effect.tryPromise({
                try: () => res.json() as Promise<T>,
                catch: error =>
                    new JsonParseError({
                        message: `Failed to parse JSON from ${args.service}`,
                        cause: error instanceof Error ? error.message : String(error),
                    }),
            });
        }),
    );
}

export function fetchJsonWithRetry<T = unknown>(
    args: FetchJsonArgs & { maxRetries?: number; baseDelay?: Duration.Input },
): Effect.Effect<T, RateLimitedError | UpstreamHttpError | FetchFailedError | JsonParseError> {
    const maxRetries = Math.max(0, args.maxRetries ?? 3);
    const baseDelay = args.baseDelay ?? '200 millis';

    const started = Date.now();
    const endpoint = extractEndpoint(args.url);

    return Effect.retry(fetchJson<T>(args), {
        while: isRetryableFetchError,
        times: maxRetries,
        schedule: Schedule.exponential(baseDelay),
    }).pipe(
        Effect.tap(() =>
            Effect.sync(() => emitExternalCall({
                provider: args.service,
                endpoint,
                status: null,
                duration_ms: Date.now() - started,
                ok: true,
            })),
        ),
        Effect.tapError(err =>
            Effect.sync(() => emitExternalCall({
                provider: args.service,
                endpoint,
                status: extractStatus(err),
                duration_ms: Date.now() - started,
                ok: false,
                error_tag: extractErrorTag(err),
            })),
        ),
    );
}

function extractEndpoint(url: string): string {
    try {
        return new URL(url).pathname.replace(/\/+$/, '') || '/';
    } catch {
        return url.slice(0, 100);
    }
}

function extractStatus(err: unknown): number | null {
    if (!err || typeof err !== 'object') return null;
    const status = (err as { status?: unknown }).status;
    return typeof status === 'number' ? status : null;
}

function extractErrorTag(err: unknown): string {
    if (!err || typeof err !== 'object') return 'unknown';
    const tag = (err as { _tag?: unknown })._tag;
    return typeof tag === 'string' ? tag : 'unknown';
}

interface ExternalCallEvent {
    provider: string;
    endpoint: string;
    status: number | null;
    duration_ms: number;
    ok: boolean;
    error_tag?: string;
}

function emitExternalCall(fields: ExternalCallEvent): void {
    console.log(JSON.stringify({ event: 'external_call', ...fields }));
}
