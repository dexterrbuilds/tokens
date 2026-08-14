import { describe, expect, it } from 'bun:test';

import { createConcurrencyLimiter } from './concurrencyLimiter';

describe('createConcurrencyLimiter', () => {
    it('never runs more than the configured number of tasks', async () => {
        const limit = createConcurrencyLimiter(4);
        let active = 0;
        let maximum = 0;

        const results = await Promise.all(
            Array.from({ length: 24 }, (_, index) =>
                limit(async () => {
                    active += 1;
                    maximum = Math.max(maximum, active);
                    await Bun.sleep(2);
                    active -= 1;
                    return index;
                }),
            ),
        );

        expect(maximum).toBe(4);
        expect(results).toEqual(Array.from({ length: 24 }, (_, index) => index));
    });

    it('releases a slot when a task rejects', async () => {
        const limit = createConcurrencyLimiter(1);
        const first = limit(async () => {
            throw new Error('boom');
        });
        const second = limit(async () => 'ok');
        await expect(first).rejects.toThrow('boom');
        await expect(second).resolves.toBe('ok');
    });
});
