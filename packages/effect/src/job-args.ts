/**
 * Job-argument decoding for Cloud Run cron handlers.
 *
 * Server-only: exposed as the `@tokens/effect/job-args` subpath and NOT
 * re-exported from the browser-safe root barrel.
 *
 * Behavior parity with the per-file `asObject`/`clampInt`/`clampBool`
 * helpers duplicated across the cron modules: out-of-range numbers are
 * clamped (not rejected), unknown keys are ignored, and genuinely invalid
 * values (non-numeric where a number is required, non-string-array targets)
 * fail with `BadRequestError` so dispatchers can map them to HTTP 400.
 */

import { Effect } from 'effect';
import { BadRequestError } from './api-errors';

export type JobArgSpec =
    | { readonly kind: 'int'; readonly fallback: number; readonly min: number; readonly max: number }
    | { readonly kind: 'bool'; readonly fallback: boolean }
    | { readonly kind: 'targets'; readonly label: string };

export function clampedInt(fallback: number, min: number, max: number): JobArgSpec {
    return { kind: 'int', fallback, min, max };
}

export function boolWithDefault(fallback: boolean): JobArgSpec {
    return { kind: 'bool', fallback };
}

/** Optional explicit-target list (e.g. `mints`, `coinIds`): trimmed, deduped, capped at 250; `null` when absent. */
export function explicitTargets(label: string): JobArgSpec {
    return { kind: 'targets', label };
}

export type JobArgSpecs = Record<string, JobArgSpec>;

type DecodedArg<S extends JobArgSpec> = S extends { kind: 'int' }
    ? number
    : S extends { kind: 'bool' }
      ? boolean
      : string[] | null;

export type DecodedJobArgs<S extends JobArgSpecs> = { [K in keyof S]: DecodedArg<S[K]> };

const EXPLICIT_TARGETS_MAX = 250;

function uniqueStrings(values: readonly string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
        const trimmed = value.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        out.push(trimmed);
    }
    return out;
}

function decodeInt(
    value: unknown,
    key: string,
    spec: Extract<JobArgSpec, { kind: 'int' }>,
): number | BadRequestError {
    if (value === undefined) return Math.min(spec.max, Math.max(spec.min, spec.fallback));
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return new BadRequestError({ message: `${key} must be a finite number` });
    }
    return Math.min(spec.max, Math.max(spec.min, Math.floor(value)));
}

function decodeBool(
    value: unknown,
    key: string,
    spec: Extract<JobArgSpec, { kind: 'bool' }>,
): boolean | BadRequestError {
    if (value === undefined) return spec.fallback;
    if (typeof value !== 'boolean') return new BadRequestError({ message: `${key} must be a boolean` });
    return value;
}

function decodeTargets(value: unknown, spec: Extract<JobArgSpec, { kind: 'targets' }>): string[] | null | BadRequestError {
    if (value === undefined) return null;
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        return new BadRequestError({ message: `${spec.label} must be an array of strings` });
    }
    return uniqueStrings(value as string[]).slice(0, EXPLICIT_TARGETS_MAX);
}

export function decodeJobArgs<S extends JobArgSpecs>(
    specs: S,
    raw: unknown,
): Effect.Effect<DecodedJobArgs<S>, BadRequestError> {
    return Effect.suspend(() => {
        if (raw !== undefined && raw !== null && typeof raw !== 'object') {
            return Effect.fail(new BadRequestError({ message: 'args must be an object' }));
        }
        const input = (raw ?? {}) as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const [key, spec] of Object.entries(specs)) {
            const decoded =
                spec.kind === 'int'
                    ? decodeInt(input[key], key, spec)
                    : spec.kind === 'bool'
                      ? decodeBool(input[key], key, spec)
                      : decodeTargets(input[key], spec);
            if (decoded instanceof BadRequestError) return Effect.fail(decoded);
            out[key] = decoded;
        }
        return Effect.succeed(out as DecodedJobArgs<S>);
    });
}
