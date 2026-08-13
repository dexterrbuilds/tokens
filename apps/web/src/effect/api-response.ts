import { Effect } from 'effect';
import {
    ApiResponseError,
    FetchFailedError,
    JsonParseError,
    isApiErrorEnvelope,
} from '@tokens/effect';

/**
 * Shared decoder for tokens-API responses, used by both the client-side
 * `apiJson` and the server-side `apiAppJson`. Discriminates the API's tagged
 * error envelope (`{error:{_tag,message,details?}}`) into `ApiResponseError`
 * and synthesizes an `HttpError`-shaped one when the body isn't an envelope.
 *
 * Intentionally does NOT Schema-validate success payloads: the API is
 * first-party, payload evolution is additive, and turning additive changes
 * into hard failures would be a net loss. The error envelope — the one
 * contract that matters — is structurally validated by `isApiErrorEnvelope`.
 */
export function decodeApiResponse<T = unknown>(
    res: Response,
): Effect.Effect<T, ApiResponseError | FetchFailedError | JsonParseError> {
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
            type BodyError = ApiResponseError | JsonParseError;

            const contentType = res.headers.get('content-type') ?? '';
            const isJson = contentType.includes('application/json') && bodyText.length > 0;
            const parsed = isJson ? tryParseJson(bodyText) : undefined;

            if (res.ok) {
                if (parsed !== undefined) {
                    return Effect.succeed(parsed as T) as Effect.Effect<T, BodyError, never>;
                }

                return Effect.fail(
                    new JsonParseError({
                        message: 'Expected JSON from API',
                        ...(bodyText.length > 0 ? { body: bodyText } : {}),
                    }),
                ) as Effect.Effect<T, BodyError, never>;
            }

            if (parsed !== undefined && isApiErrorEnvelope(parsed)) {
                return Effect.fail(
                    new ApiResponseError({
                        status: res.status,
                        error: parsed.error,
                        message: parsed.error.message,
                    }),
                ) as Effect.Effect<T, BodyError, never>;
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
            ) as Effect.Effect<T, BodyError, never>;
        }),
    );
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
