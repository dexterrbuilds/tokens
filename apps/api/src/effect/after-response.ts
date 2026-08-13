import { after } from 'next/server';
import { Effect } from 'effect';

/**
 * The single sanctioned Effect -> Promise boundary for post-response work.
 * Runs the effect after the response is sent (Next's `after()`); failures are
 * swallowed — post-response work must never surface into the request.
 */
export function runAfterResponse(effect: Effect.Effect<void, never>): void {
    try {
        after(() => Effect.runPromise(effect).catch(() => undefined));
    } catch {
        // `after()` throws outside a Next request scope (e.g. bare bun tests);
        // post-response work is best-effort by definition.
    }
}
