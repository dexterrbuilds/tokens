import { useQuery } from '@tanstack/react-query';
import { Effect } from 'effect';
import { apiJson } from '@/effect/api-client';
import { shouldRetryApiQuery } from '@/effect/query-retry';
import type { OHLCVData, TimeInterval } from '@/lib/birdeye';
import { looksLikeSolanaMintAddress } from '@/lib/solana-address';
import { alignEpochSeconds } from '@/lib/time';

interface UseOHLCVOptions {
    enabled?: boolean;
}

export function useOHLCV(address: string, interval: TimeInterval, days: number, options: UseOHLCVOptions = {}) {
    const { enabled = true } = options;
    const normalizedAddress = address.trim();
    const isValidAddress = looksLikeSolanaMintAddress(normalizedAddress);

    return useQuery<OHLCVData[]>({
        queryKey: ['ohlcv', normalizedAddress, interval, days],
        queryFn: async ({ signal }) => {
            // Align timestamps so retries/remounts don't generate new URLs every second.
            const now = alignEpochSeconds(Math.floor(Date.now() / 1000), 60);
            const from = alignEpochSeconds(now - days * 24 * 60 * 60, 60);
            return await Effect.runPromise(
                apiJson<OHLCVData[]>({
                    url: `/api/ohlcv?address=${encodeURIComponent(normalizedAddress)}&interval=${encodeURIComponent(
                        interval,
                    )}&from=${from}&to=${now}`,
                }),
                { signal },
            );
        },
        enabled: enabled && isValidAddress,
        retry: shouldRetryApiQuery,
    });
}
