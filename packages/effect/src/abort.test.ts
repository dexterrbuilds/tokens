import { describe, expect, it } from 'bun:test';
import { mergeSignals } from './abort';

const SignalCtor = AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal };

function withoutAbortSignalAny<T>(fn: () => T): T {
    const original = SignalCtor.any;
    // Force the manual-listener fallback path.
    SignalCtor.any = undefined;
    try {
        return fn();
    } finally {
        SignalCtor.any = original;
    }
}

describe('mergeSignals', () => {
    it('returns the primary signal untouched when no secondary is given', () => {
        const controller = new AbortController();
        const merged = mergeSignals(controller.signal);
        expect(merged.signal).toBe(controller.signal);
    });

    it('aborts when the primary aborts (AbortSignal.any path)', () => {
        const primary = new AbortController();
        const secondary = new AbortController();
        const merged = mergeSignals(primary.signal, secondary.signal);
        expect(merged.signal.aborted).toBe(false);
        primary.abort();
        expect(merged.signal.aborted).toBe(true);
    });

    it('aborts when the secondary aborts (AbortSignal.any path)', () => {
        const primary = new AbortController();
        const secondary = new AbortController();
        const merged = mergeSignals(primary.signal, secondary.signal);
        secondary.abort();
        expect(merged.signal.aborted).toBe(true);
    });

    it('returns an already-aborted signal when the primary is pre-aborted (fallback path)', () => {
        withoutAbortSignalAny(() => {
            const primary = new AbortController();
            primary.abort();
            const secondary = new AbortController();
            const merged = mergeSignals(primary.signal, secondary.signal);
            expect(merged.signal.aborted).toBe(true);
        });
    });

    it('returns an already-aborted signal when the secondary is pre-aborted (fallback path)', () => {
        withoutAbortSignalAny(() => {
            const primary = new AbortController();
            const secondary = new AbortController();
            secondary.abort();
            const merged = mergeSignals(primary.signal, secondary.signal);
            expect(merged.signal.aborted).toBe(true);
        });
    });

    it('propagates aborts from either side on the fallback path', () => {
        withoutAbortSignalAny(() => {
            const primary = new AbortController();
            const secondary = new AbortController();
            const merged = mergeSignals(primary.signal, secondary.signal);
            expect(merged.signal.aborted).toBe(false);
            secondary.abort();
            expect(merged.signal.aborted).toBe(true);
        });
    });

    it('cleanup removes listeners so later aborts do not fire the merged signal (fallback path)', () => {
        withoutAbortSignalAny(() => {
            const primary = new AbortController();
            const secondary = new AbortController();
            const merged = mergeSignals(primary.signal, secondary.signal);
            merged.cleanup();
            primary.abort();
            expect(merged.signal.aborted).toBe(false);
        });
    });
});
