import { Context } from 'effect';

/**
 * Ambient request id (v4's Reference — the FiberRef replacement). Provided by
 * the API's route() wrapper before each handler runs; readable anywhere in
 * the fiber via `Effect.service(CurrentRequestId)` with zero R-channel cost
 * (References have a default). Lets shared emitters like `external_call`
 * correlate to the request that caused them without threading a parameter
 * through every callsite.
 */
export const CurrentRequestId = Context.Reference<string | null>('tokens/CurrentRequestId', {
    defaultValue: () => null,
});

/** The one JSON-to-stdout log sink (Cloud Run / Loki ingest this format). */
export function emitEvent(entry: Record<string, unknown>): void {
    console.log(JSON.stringify(entry));
}
