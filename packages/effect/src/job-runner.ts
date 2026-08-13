/**
 * Shared worker-pool runner for Cloud Run cron jobs.
 *
 * Server-only: exposed as the `@tokens/effect/job-runner` subpath and
 * intentionally NOT re-exported from the browser-safe root barrel.
 *
 * Replaces the hand-rolled `let nextIndex = 0; async function worker() {...}`
 * pools with `Effect.forEach` structured concurrency: N lanes pull items in
 * order, per-item failures are captured (the pool only dies on defects, and
 * when it does, sibling lanes are interrupted instead of leaking).
 */

import { Clock, Duration, Effect, Result } from 'effect';

/**
 * Result payload returned by cron job handlers and serialized to the Cloud
 * Scheduler HTTP response. `ok: false` means total failure (work was
 * attempted and none of it succeeded) and maps to HTTP 500 so the scheduler
 * can retry; partial failures stay `ok: true` with counters.
 */
export interface CronResult {
    ok: boolean;
    processed: number;
    durationMs: number;
    /** Present (true) when a deadline budget or shutdown stopped the run early. */
    partial?: boolean;
    [extra: string]: unknown;
}

export interface JobPoolSummary {
    /** Items whose `process` was started. */
    attempted: number;
    /** `process` failures, including per-item timeouts. */
    failed: number;
    /** Items never started because the budget tripped or `shouldStop` returned true. */
    deadlineSkipped: number;
    /** True when any item was deadline-skipped. */
    partial: boolean;
    durationMs: number;
}

export interface JobPoolOptions<T> {
    /** Job name, used in log lines. */
    label: string;
    items: readonly T[];
    /** Number of concurrent lanes; clamped to >= 1. */
    concurrency: number;
    /**
     * Pacing sleep (ms) after every item — success, failure, and
     * handler-level skips alike (parity with the old `finally { await sleep }`).
     * Deadline-skipped items drain without pacing.
     */
    delayMs?: number;
    /** Extra startup delay: item index i (0 < i < concurrency) sleeps i * staggerMs first. */
    staggerMs?: number;
    /**
     * Deadline budget in ms from pool start. Once elapsed, remaining items are
     * counted as `deadlineSkipped` and the summary is `partial` — the job
     * returns a partial result instead of being killed at the Cloud Run
     * request timeout with all progress lost.
     */
    budgetMs?: number;
    /** Optional per-item timeout; a timed-out item counts as a failure. */
    itemTimeoutMs?: number;
    /** Checked before each item; e.g. `isShuttingDown` from @tokens/cloudrun-shutdown. */
    shouldStop?: () => boolean;
    process: (item: T, index: number) => Effect.Effect<void, unknown>;
    /**
     * Compensation run after a `process` failure (e.g. touch a row so the
     * batch rotation moves on). Its own failures are logged and swallowed.
     */
    onItemError?: (item: T, error: unknown) => Effect.Effect<void, unknown>;
}

/** `ok: false` semantics: something was attempted and nothing succeeded. */
export function isTotalFailure(summary: { attempted: number; failed: number }): boolean {
    return summary.attempted > 0 && summary.failed >= summary.attempted;
}

export function runJobPool<T>(options: JobPoolOptions<T>): Effect.Effect<JobPoolSummary> {
    return Effect.gen(function* () {
        const concurrency = Math.max(1, Math.floor(options.concurrency));
        const delayMs = Math.max(0, options.delayMs ?? 0);
        const staggerMs = Math.max(0, options.staggerMs ?? 0);
        const startMs = yield* Clock.currentTimeMillis;

        let attempted = 0;
        let failed = 0;
        let deadlineSkipped = 0;

        yield* Effect.forEach(
            options.items,
            (item, index) =>
                Effect.gen(function* () {
                    if (staggerMs > 0 && index > 0 && index < concurrency) {
                        yield* Effect.sleep(Duration.millis(index * staggerMs));
                    }

                    const nowMs = yield* Clock.currentTimeMillis;
                    const budgetExceeded = options.budgetMs !== undefined && nowMs - startMs >= options.budgetMs;
                    if (budgetExceeded || options.shouldStop?.() === true) {
                        deadlineSkipped += 1;
                        return;
                    }

                    attempted += 1;
                    const base = options.process(item, index);
                    const withTimeout =
                        options.itemTimeoutMs !== undefined
                            ? Effect.timeout(base, Duration.millis(options.itemTimeoutMs))
                            : base;
                    const result = yield* Effect.result(withTimeout);
                    if (Result.isFailure(result)) {
                        failed += 1;
                        console.error(`[${options.label}] item ${index} failed`, result.failure);
                        if (options.onItemError) {
                            const compensation = yield* Effect.result(options.onItemError(item, result.failure));
                            if (Result.isFailure(compensation)) {
                                console.error(`[${options.label}] onItemError failed`, compensation.failure);
                            }
                        }
                    }

                    if (delayMs > 0) yield* Effect.sleep(Duration.millis(delayMs));
                }),
            { concurrency, discard: true },
        );

        const endMs = yield* Clock.currentTimeMillis;
        const summary: JobPoolSummary = {
            attempted,
            failed,
            deadlineSkipped,
            partial: deadlineSkipped > 0,
            durationMs: endMs - startMs,
        };
        console.log(
            JSON.stringify({
                event: 'job_pool',
                job: options.label,
                attempted,
                failed,
                deadline_skipped: deadlineSkipped,
                duration_ms: summary.durationMs,
                partial: summary.partial,
            }),
        );
        return summary;
    });
}
