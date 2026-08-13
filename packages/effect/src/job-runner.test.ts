import { describe, expect, it } from 'bun:test';
import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { isTotalFailure, runJobPool, type JobPoolSummary } from './job-runner';

/** Run a pool under the TestClock, advancing virtual time until it settles. */
async function runWithTestClock(
    pool: Effect.Effect<JobPoolSummary>,
    advances: ReadonlyArray<number>,
): Promise<JobPoolSummary> {
    const program = Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(pool);
        for (const ms of advances) {
            yield* TestClock.adjust(ms);
        }
        return yield* Fiber.join(fiber);
    });
    return Effect.runPromise(Effect.provide(program, TestClock.layer()));
}

describe('runJobPool', () => {
    it('processes every item and reports counters', async () => {
        const seen: number[] = [];
        const summary = await Effect.runPromise(
            runJobPool({
                label: 'test',
                items: [1, 2, 3, 4, 5],
                concurrency: 2,
                process: item => Effect.sync(() => void seen.push(item)),
            }),
        );
        expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
        expect(summary.attempted).toBe(5);
        expect(summary.failed).toBe(0);
        expect(summary.deadlineSkipped).toBe(0);
        expect(summary.partial).toBe(false);
    });

    it('never exceeds the concurrency ceiling', async () => {
        let inFlight = 0;
        let maxInFlight = 0;
        const summary = await Effect.runPromise(
            runJobPool({
                label: 'test',
                items: Array.from({ length: 20 }, (_, i) => i),
                concurrency: 3,
                process: () =>
                    Effect.gen(function* () {
                        inFlight += 1;
                        maxInFlight = Math.max(maxInFlight, inFlight);
                        yield* Effect.yieldNow;
                        inFlight -= 1;
                    }),
            }),
        );
        expect(summary.attempted).toBe(20);
        expect(maxInFlight).toBeLessThanOrEqual(3);
    });

    it('captures per-item failures and keeps going', async () => {
        const summary = await Effect.runPromise(
            runJobPool({
                label: 'test',
                items: [1, 2, 3, 4],
                concurrency: 1,
                process: item => (item % 2 === 0 ? Effect.fail(`boom ${item}`) : Effect.void),
            }),
        );
        expect(summary.attempted).toBe(4);
        expect(summary.failed).toBe(2);
    });

    it('runs onItemError compensation and swallows its failures', async () => {
        const compensated: number[] = [];
        const summary = await Effect.runPromise(
            runJobPool({
                label: 'test',
                items: [1, 2, 3],
                concurrency: 1,
                process: item => (item === 2 ? Effect.fail('boom') : Effect.void),
                onItemError: item =>
                    Effect.suspend(() => {
                        compensated.push(item);
                        return Effect.fail('compensation also failed');
                    }),
            }),
        );
        expect(compensated).toEqual([2]);
        expect(summary.failed).toBe(1);
        expect(summary.attempted).toBe(3);
    });

    it('paces items with delayMs on success and failure alike (TestClock)', async () => {
        const seen: number[] = [];
        const summary = await runWithTestClock(
            runJobPool({
                label: 'test',
                items: [1, 2, 3],
                concurrency: 1,
                delayMs: 1000,
                process: item =>
                    item === 2 ? Effect.fail('boom') : Effect.sync(() => void seen.push(item)),
            }),
            [1000, 1000, 1000],
        );
        expect(seen).toEqual([1, 3]);
        expect(summary.attempted).toBe(3);
        expect(summary.failed).toBe(1);
        expect(summary.durationMs).toBe(3000);
    });

    it('staggers startup for the first lanes only (TestClock)', async () => {
        const started: Array<{ index: number; at: number }> = [];
        let virtualNow = 0;
        const summary = await runWithTestClock(
            Effect.gen(function* () {
                return yield* runJobPool({
                    label: 'test',
                    items: [0, 1, 2, 3],
                    concurrency: 2,
                    staggerMs: 500,
                    process: (_item, index) =>
                        Effect.sync(() => {
                            started.push({ index, at: virtualNow });
                        }),
                });
            }),
            [0, 500, 500, 500].map(ms => ((virtualNow += ms), ms)),
        );
        // Item 0 starts immediately; item 1 (index < concurrency) staggers 500ms;
        // items 2..3 start as lanes free with no stagger.
        expect(summary.attempted).toBe(4);
        const item0 = started.find(s => s.index === 0);
        expect(item0).toBeDefined();
    });

    it('deadline budget skips unstarted items and marks partial (TestClock)', async () => {
        const processed: number[] = [];
        const summary = await runWithTestClock(
            runJobPool({
                label: 'test',
                items: [1, 2, 3, 4, 5],
                concurrency: 1,
                delayMs: 1000,
                budgetMs: 2500,
                process: item => Effect.sync(() => void processed.push(item)),
            }),
            [1000, 1000, 1000, 1000, 1000],
        );
        // t=0: item1 (attempted), sleep to 1000; item2 at 1000 (attempted), sleep to
        // 2000; item3 at 2000 (attempted), sleep to 3000; item4 at 3000 >= 2500 →
        // skipped (no pacing sleep); item5 likewise.
        expect(processed).toEqual([1, 2, 3]);
        expect(summary.attempted).toBe(3);
        expect(summary.deadlineSkipped).toBe(2);
        expect(summary.partial).toBe(true);
    });

    it('shouldStop drains remaining items as skipped', async () => {
        let stop = false;
        const processed: number[] = [];
        const summary = await Effect.runPromise(
            runJobPool({
                label: 'test',
                items: [1, 2, 3, 4],
                concurrency: 1,
                shouldStop: () => stop,
                process: item =>
                    Effect.sync(() => {
                        processed.push(item);
                        if (item === 2) stop = true;
                    }),
            }),
        );
        expect(processed).toEqual([1, 2]);
        expect(summary.attempted).toBe(2);
        expect(summary.deadlineSkipped).toBe(2);
        expect(summary.partial).toBe(true);
    });

    it('counts a per-item timeout as a failure (TestClock)', async () => {
        const summary = await runWithTestClock(
            runJobPool({
                label: 'test',
                items: [1],
                concurrency: 1,
                itemTimeoutMs: 100,
                process: () => Effect.sleep(10_000),
            }),
            [100, 10_000],
        );
        expect(summary.attempted).toBe(1);
        expect(summary.failed).toBe(1);
    });

    it('a defect interrupts sibling lanes (structured concurrency)', async () => {
        let slowInterrupted = false;
        const exit = await Effect.runPromiseExit(
            runJobPool({
                label: 'test',
                items: ['slow', 'die'],
                concurrency: 2,
                process: item =>
                    item === 'die'
                        ? Effect.yieldNow.pipe(Effect.andThen(Effect.die(new Error('defect'))))
                        : Effect.sleep(10_000).pipe(
                              Effect.onInterrupt(() => Effect.sync(() => (slowInterrupted = true))),
                          ),
            }),
        );
        expect(exit._tag).toBe('Failure');
        expect(slowInterrupted).toBe(true);
    });
});

describe('isTotalFailure', () => {
    it('is false when nothing was attempted (all fresh / all skipped)', () => {
        expect(isTotalFailure({ attempted: 0, failed: 0 })).toBe(false);
    });
    it('is false on partial failure', () => {
        expect(isTotalFailure({ attempted: 4, failed: 3 })).toBe(false);
    });
    it('is true when everything attempted failed', () => {
        expect(isTotalFailure({ attempted: 4, failed: 4 })).toBe(true);
    });
});
