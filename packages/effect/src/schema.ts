import { Effect, Schema } from 'effect';
import { BadRequestError } from './api-errors';

// -----------------------------------------------------------------------------
// Common schemas
// -----------------------------------------------------------------------------

// Base58 (no 0,O,I,l) and common Solana mint length range.
export const SolanaAddress = Schema.String.check(Schema.isPattern(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/));

export const TimeInterval = Schema.Literals(['1m', '5m', '15m', '1H', '4H', '1D', '1W']);

export const NonEmptyString = Schema.NonEmptyString;

export const NonNegativeIntFromString = Schema.NumberFromString.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
);

export const PositiveIntFromString = Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0));

// -----------------------------------------------------------------------------
// Decode helpers (Schema -> BadRequestError)
// -----------------------------------------------------------------------------

function parseErrorToMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'message' in error) {
        const message = (error as { message?: unknown }).message;
        if (typeof message === 'string') return message;
    }
    return String(error);
}

export function decodeUnknownOrBadRequest<S extends Schema.ConstraintDecoder<unknown>>(
    schema: S,
    input: unknown,
    message: string,
): Effect.Effect<S['Type'], BadRequestError, S['DecodingServices']> {
    return Schema.decodeUnknownEffect(schema)(input).pipe(
        Effect.mapError(parseError => new BadRequestError({ message, details: parseErrorToMessage(parseError) })),
    );
}

export function decodeRequiredSearchParam<S extends Schema.ConstraintDecoder<unknown>>(
    schema: S,
    params: URLSearchParams,
    key: string,
): Effect.Effect<S['Type'], BadRequestError, S['DecodingServices']> {
    const raw = params.get(key);
    if (raw == null) return Effect.fail(new BadRequestError({ message: `${key} is required` }));
    return decodeUnknownOrBadRequest(schema, raw, `Invalid ${key}`);
}

export function decodeOptionalSearchParam<S extends Schema.ConstraintDecoder<unknown>>(
    schema: S,
    params: URLSearchParams,
    key: string,
): Effect.Effect<S['Type'] | null, BadRequestError, S['DecodingServices']> {
    const raw = params.get(key);
    if (raw == null) return Effect.succeed(null);
    return decodeUnknownOrBadRequest(schema, raw, `Invalid ${key}`);
}
