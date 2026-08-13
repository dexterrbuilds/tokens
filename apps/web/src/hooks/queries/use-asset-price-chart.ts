import { useQuery } from '@tanstack/react-query';
import { Effect } from 'effect';
import { apiJson } from '@/effect/api-client';
import { shouldRetryApiQuery } from '@/effect/query-retry';
import type { OHLCVData, TimeInterval } from '@/lib/birdeye';
import { alignEpochSeconds } from '@/lib/time';

interface UseAssetPriceChartOptions {
    enabled?: boolean;
}

interface AssetPriceChartResponse {
    candles: OHLCVData[];
}

export function useAssetPriceChart(
    assetId: string,
    interval: TimeInterval,
    days: number,
    options: UseAssetPriceChartOptions = {},
) {
    const { enabled = true } = options;

    return useQuery<OHLCVData[]>({
        queryKey: ['assets', 'price-chart', assetId, interval, days],
        queryFn: async ({ signal }) => {
            const now = alignEpochSeconds(Math.floor(Date.now() / 1000), 60);
            const from = alignEpochSeconds(now - days * 24 * 60 * 60, 60);

            const params = new URLSearchParams({
                interval,
                from: String(from),
                to: String(now),
            });

            const data = await Effect.runPromise(
                apiJson<AssetPriceChartResponse>({
                    url: `/api/v1/assets/${encodeURIComponent(assetId)}/price-chart?${params.toString()}`,
                }),
                { signal },
            );

            return data.candles ?? [];
        },
        enabled: enabled && assetId.trim().length > 0,
        retry: shouldRetryApiQuery,
    });
}
