import { describe, expect, it } from 'bun:test';

import {
    databaseErrorCode,
    isTransientDatabaseError,
    runAtomicReadWithRetry,
    structuredDatabaseFailure,
} from './transientDb';

function codedError(code: string): Error & { code: string } {
    return Object.assign(new Error(`write ${code} 172.20.2.3:5432`), { code });
}

describe('transient database errors', () => {
    it('recognizes driver codes and message-only Bun socket errors', () => {
        for (const code of [
            'CONNECT_TIMEOUT',
            'CONNECTION_CLOSED',
            'CONNECTION_ENDED',
            'CONNECTION_DESTROYED',
            'ECONNRESET',
            'ETIMEDOUT',
        ]) {
            expect(isTransientDatabaseError(codedError(code))).toBe(true);
            expect(databaseErrorCode(new Error(`write ${code} 172.20.2.3:5432`))).toBe(code);
        }
        expect(isTransientDatabaseError(Object.assign(new Error('bad query'), { code: '42601' }))).toBe(false);
    });

    it('retries an atomic read exactly once with bounded jitter', async () => {
        let calls = 0;
        const sleeps: number[] = [];
        const retries: unknown[] = [];
        const result = await runAtomicReadWithRetry(
            'getByAssetId',
            async () => {
                calls += 1;
                if (calls === 1) throw codedError('CONNECT_TIMEOUT');
                return 'ok';
            },
            {
                random: () => 0.5,
                sleep: async milliseconds => {
                    sleeps.push(milliseconds);
                },
                onRetry: details => {
                    retries.push(details);
                },
            },
        );

        expect(result).toBe('ok');
        expect(calls).toBe(2);
        expect(sleeps).toEqual([200]);
        expect(retries).toHaveLength(1);
    });

    it('does not retry non-transient failures or retry a second transient failure', async () => {
        let nonTransientCalls = 0;
        await expect(
            runAtomicReadWithRetry('query', async () => {
                nonTransientCalls += 1;
                throw Object.assign(new Error('syntax'), { code: '42601' });
            }),
        ).rejects.toThrow('syntax');
        expect(nonTransientCalls).toBe(1);

        let transientCalls = 0;
        await expect(
            runAtomicReadWithRetry(
                'query',
                async () => {
                    transientCalls += 1;
                    throw codedError('ECONNRESET');
                },
                { sleep: async () => {} },
            ),
        ).rejects.toThrow('ECONNRESET');
        expect(transientCalls).toBe(2);
    });

    it('builds one normalized final-failure event', () => {
        const event = structuredDatabaseFailure('variantMarketsGetLatestByMints', codedError('CONNECT_TIMEOUT'), {
            attempts: 2,
            elapsedMs: 6_123,
        });
        expect(event.event).toBe('cloudrun_assets_db_operation_failure');
        expect(event.errorCode).toBe('CONNECT_TIMEOUT');
        expect(event.attempts).toBe(2);
    });
});
