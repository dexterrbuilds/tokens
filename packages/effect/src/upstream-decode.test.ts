import { describe, expect, it } from 'bun:test';
import { Effect, Exit, Schema } from 'effect';

import { decodeUpstreamOrFail, decodeUpstreamOrWarn } from './schema';

const Payload = Schema.Struct({
    id: Schema.String,
    value: Schema.Number,
});

describe('decodeUpstreamOrFail', () => {
    it('decodes valid payloads and drops excess keys', async () => {
        const result = await Effect.runPromise(
            decodeUpstreamOrFail(Payload, 'svc')({ id: 'a', value: 1, extra: 'dropped' }),
        );
        expect(result).toEqual({ id: 'a', value: 1 });
    });

    it('fails with UpstreamDataError carrying the issue', async () => {
        const exit = await Effect.runPromiseExit(decodeUpstreamOrFail(Payload, 'svc')({ id: 'a' }));
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
            const reason = exit.cause.reasons[0];
            expect(reason?._tag).toBe('Fail');
            if (reason?._tag === 'Fail') {
                const error = reason.error as { _tag: string; service: string; issue?: string };
                expect(error._tag).toBe('UpstreamDataError');
                expect(error.service).toBe('svc');
                expect(error.issue?.length).toBeGreaterThan(0);
            }
        }
    });
});

describe('decodeUpstreamOrWarn', () => {
    it('passes through raw input on mismatch, logging upstream_decode_failed', async () => {
        const warnings: string[] = [];
        const original = console.warn;
        console.warn = (...args: unknown[]) => {
            warnings.push(String(args[0]));
        };
        try {
            const raw = { id: 'a', wrong: true };
            const result = await Effect.runPromise(decodeUpstreamOrWarn(Payload, 'svc')(raw));
            expect(result).toBe(raw as never);
            const events = warnings.map(line => JSON.parse(line) as Record<string, unknown>);
            expect(events.length).toBe(1);
            expect(events[0]!.event).toBe('upstream_decode_failed');
            expect(events[0]!.service).toBe('svc');
        } finally {
            console.warn = original;
        }
    });

    it('is silent for valid payloads', async () => {
        const warnings: string[] = [];
        const original = console.warn;
        console.warn = (...args: unknown[]) => {
            warnings.push(String(args[0]));
        };
        try {
            const result = await Effect.runPromise(decodeUpstreamOrWarn(Payload, 'svc')({ id: 'a', value: 2 }));
            expect(result).toEqual({ id: 'a', value: 2 });
            expect(warnings.length).toBe(0);
        } finally {
            console.warn = original;
        }
    });
});
