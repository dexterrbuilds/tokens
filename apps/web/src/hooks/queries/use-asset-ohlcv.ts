import { useQuery } from '@tanstack/react-query';
import { Effect } from 'effect';
import { apiJson } from '@/effect/api-client';
import { shouldRetryApiQuery } from '@/effect/query-retry';
import type { OHLCVData, TimeInterval } from '@/lib/birdeye';
import { looksLikeSolanaMintAddress } from '@/lib/solana-address';
import { alignEpochSeconds } from '@/lib/time';

interface UseAssetOHLCVOptions {
    enabled?: boolean;
    mint?: string;
}

interface AssetIncludeOk<T> {
    ok: true;
    data: T;
}

interface AssetIncludeError {
    ok: false;
    reason: string;
    message: string;
}

type AssetIncludeResult<T> = AssetIncludeOk<T> | AssetIncludeError;

interface AssetOhlcvResponse {
    includes?: {
        ohlcv?: AssetIncludeResult<OHLCVData[]>;
    };
}

export function useAssetOHLCV(
    assetId: string,
    interval: TimeInterval,
    days: number,
    options: UseAssetOHLCVOptions = {},
) {
    const { enabled = true, mint } = options;

    return useQuery<OHLCVData[]>({
        queryKey: ['assets', 'ohlcv', assetId, mint ?? null, interval, days],
        queryFn: async ({ signal }) => {
            // Align timestamps so caching works across users (avoid a unique URL per second).
            const now = alignEpochSeconds(Math.floor(Date.now() / 1000), 60);
            const from = alignEpochSeconds(now - days * 24 * 60 * 60, 60);

            const params = new URLSearchParams({
                include: 'ohlcv',
                ohlcvInterval: interval,
                ohlcvFrom: String(from),
                ohlcvTo: String(now),
            });
            const trimmedMint = (mint ?? '').trim();
            if (looksLikeSolanaMintAddress(trimmedMint)) params.set('mint', trimmedMint);

            const data = await Effect.runPromise(
                apiJson<AssetOhlcvResponse>({
                    url: `/api/v1/assets/${encodeURIComponent(assetId)}?${params.toString()}`,
                }),
                { signal },
            );

            const include = data.includes?.ohlcv;
            if (!include) return [];
            if (!include.ok) throw new Error(include.message);
            return include.data;
        },
        enabled: enabled && assetId.trim().length > 0,
        retry: shouldRetryApiQuery,
    });
}
