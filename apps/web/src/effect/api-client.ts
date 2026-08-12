'use client';

import { Data, Effect } from 'effect';
import { FetchFailedError, JsonParseError, type ApiErrorInfo, isApiErrorEnvelope } from '@tokens/effect';

type NextFetchInit = RequestInit & { next?: { revalidate?: number } };

interface MergeSignalsResult {
    signal: AbortSignal;
    cleanup: () => void;
}

export class ApiResponseError extends Data.TaggedError('ApiResponseError')<{
    message: string;
    status: number;
    error: ApiErrorInfo;
}> {}

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

function mergeSignals(primary: AbortSignal, secondary?: AbortSignal): MergeSignalsResult {
    const noop = () => {};
    if (!secondary) return { signal: primary, cleanup: noop };
    const secondarySignal = secondary;

    // Prefer native AbortSignal.any when available.
    const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
    if (typeof anyFn === 'function') return { signal: anyFn([primary, secondarySignal]), cleanup: noop };

    if (primary.aborted) return { signal: primary, cleanup: noop };
    if (secondarySignal.aborted) return { signal: secondarySignal, cleanup: noop };

    const controller = new AbortController();

    function onAbort() {
        cleanup();
        controller.abort();
    }

    primary.addEventListener('abort', onAbort, { once: true });
    secondarySignal.addEventListener('abort', onAbort, { once: true });

    function cleanup() {
        primary.removeEventListener('abort', onAbort);
        secondarySignal.removeEventListener('abort', onAbort);
    }

    return { signal: controller.signal, cleanup };
}

function safeJsonStringify(value: unknown): string | null {
    try {
        return JSON.stringify(value);
    } catch {
        return null;
    }
}

function tryParseJson(text: string): unknown | undefined {
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return undefined;
    }
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
    }).pipe(
        Effect.flatMap(res => {
            const bodyTextEffect = Effect.tryPromise({
                try: () => res.text(),
                catch: error =>
                    new FetchFailedError({
                        service: 'api',
                        message: 'Failed to read API response body',
                        cause: error instanceof Error ? error.message : String(error),
                    }),
            }).pipe(Effect.catch(() => Effect.succeed('')));

            return bodyTextEffect.pipe(
                Effect.flatMap(bodyText => {
                    type ApiJsonBodyError = ApiResponseError | JsonParseError;

                    const contentType = res.headers.get('content-type') ?? '';
                    const isJson = contentType.includes('application/json') && bodyText.length > 0;
                    const parsed = isJson ? tryParseJson(bodyText) : undefined;

                    if (res.ok) {
                        if (parsed !== undefined) {
                            return Effect.succeed(parsed as T) as Effect.Effect<T, ApiJsonBodyError, never>;
                        }

                        return Effect.fail(
                            new JsonParseError({
                                message: 'Expected JSON from API',
                                ...(bodyText.length > 0 ? { body: bodyText } : {}),
                            }),
                        ) as Effect.Effect<T, ApiJsonBodyError, never>;
                    }

                    if (parsed !== undefined && isApiErrorEnvelope(parsed)) {
                        return Effect.fail(
                            new ApiResponseError({
                                status: res.status,
                                error: parsed.error,
                                message: parsed.error.message,
                            }),
                        ) as Effect.Effect<T, ApiJsonBodyError, never>;
                    }

                    const fallbackMessage =
                        (parsed !== undefined ? safeJsonStringify(parsed) : null) ??
                        (bodyText.length > 0 ? bodyText : `${res.status} ${res.statusText}`.trim());

                    return Effect.fail(
                        new ApiResponseError({
                            message: fallbackMessage,
                            status: res.status,
                            error: {
                                _tag: 'HttpError',
                                message: fallbackMessage,
                                ...(bodyText.length > 0 && parsed === undefined ? { details: bodyText } : {}),
                            },
                        }),
                    ) as Effect.Effect<T, ApiJsonBodyError, never>;
                }),
            );
        }),
    );
}
