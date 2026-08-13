import { describe, expect, it } from 'bun:test';
import { Effect, Exit } from 'effect';
import { boolWithDefault, clampedInt, decodeJobArgs, explicitTargets } from './job-args';

const SPECS = {
    maxMints: clampedInt(250, 1, 250),
    minAgeMs: clampedInt(110_000, 0, 24 * 60 * 60_000),
    enabled: boolWithDefault(true),
    mints: explicitTargets('mints'),
};

async function decode(raw: unknown) {
    return Effect.runPromise(decodeJobArgs(SPECS, raw));
}

async function decodeFailure(raw: unknown): Promise<string> {
    const exit = await Effect.runPromiseExit(decodeJobArgs(SPECS, raw));
    if (!Exit.isFailure(exit)) throw new Error('expected failure');
    const reason = exit.cause.reasons[0];
    if (!reason || reason._tag !== 'Fail') throw new Error('expected Fail');
    const error = reason.error as { _tag: string; message: string };
    expect(error._tag).toBe('BadRequestError');
    return error.message;
}

describe('decodeJobArgs', () => {
    it('applies clamped fallbacks for absent args', async () => {
        const args = await decode({});
        expect(args.maxMints).toBe(250);
        expect(args.minAgeMs).toBe(110_000);
        expect(args.enabled).toBe(true);
        expect(args.mints).toBeNull();
    });

    it('treats null/undefined raw args as empty (parity with asObject)', async () => {
        expect((await decode(undefined)).maxMints).toBe(250);
        expect((await decode(null)).maxMints).toBe(250);
    });

    it('clamps out-of-range numbers instead of failing, and floors', async () => {
        const args = await decode({ maxMints: 9999.7, minAgeMs: -5 });
        expect(args.maxMints).toBe(250);
        expect(args.minAgeMs).toBe(0);
        expect((await decode({ maxMints: 42.9 })).maxMints).toBe(42);
    });

    it('fails with BadRequestError for non-numeric ints', async () => {
        expect(await decodeFailure({ maxMints: 'big' })).toContain('maxMints must be a finite number');
        expect(await decodeFailure({ maxMints: Number.NaN })).toContain('maxMints must be a finite number');
    });

    it('fails with BadRequestError for non-boolean bools', async () => {
        expect(await decodeFailure({ enabled: 'yes' })).toContain('enabled must be a boolean');
    });

    it('fails with BadRequestError for non-object args', async () => {
        expect(await decodeFailure('nope')).toContain('args must be an object');
    });

    it('ignores unknown keys', async () => {
        const args = await decode({ somethingElse: 123 });
        expect(args.maxMints).toBe(250);
        expect('somethingElse' in args).toBe(false);
    });

    it('trims, dedupes, and caps explicit targets', async () => {
        const args = await decode({ mints: [' a ', 'a', '', 'b'] });
        expect(args.mints).toEqual(['a', 'b']);
        const big = await decode({ mints: Array.from({ length: 300 }, (_, i) => `m${i}`) });
        expect(big.mints).toHaveLength(250);
    });

    it('fails with BadRequestError for non-string-array targets', async () => {
        expect(await decodeFailure({ mints: 'a,b' })).toContain('mints must be an array of strings');
        expect(await decodeFailure({ mints: [1, 2] })).toContain('mints must be an array of strings');
    });
});
