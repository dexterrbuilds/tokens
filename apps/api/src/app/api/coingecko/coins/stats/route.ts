import { route } from '@/effect/next-route';
import { Effect } from 'effect';

import { coingeckoGetCoinById } from '@/lib/cloudrun';

export interface CoinGeckoCoinMarketStats {
    price: number;
    volume24h: number;
    priceChange24h: number;
}

function parseIds(raw: string): string[] {
    const parts = raw
        .split(',')
        .map(part => part.trim())
        .filter(Boolean);

    const unique: string[] = [];
    const seen = new Set<string>();

    for (const id of parts) {
        if (seen.has(id)) continue;
        seen.add(id);
        unique.push(id);
    }

    return unique;
}

export const GET = route(
    (request: Request) =>
        Effect.gen(function* () {
            const url = new URL(request.url);
            const searchParams = url.searchParams;

            const rawIds = searchParams.get('ids') ?? '';
            const ids = parseIds(rawIds).slice(0, 30);

            if (ids.length === 0) {
                return { stats: {} satisfies Record<string, CoinGeckoCoinMarketStats | null> };
            }

            const out: Record<string, CoinGeckoCoinMarketStats | null> = {};
            for (const id of ids) out[id] = null;

            const results = yield* Effect.tryPromise(() =>
                Promise.all(
                    ids.map(async id => {
                        const doc = await Effect.runPromise(coingeckoGetCoinById({ id }));
                        const md = doc?.coin?.market_data;

                        const price = md?.current_price?.usd;
                        if (typeof price !== 'number' || !Number.isFinite(price)) {
                            return [id, null] as const;
                        }

                        const volume24h = md?.total_volume?.usd;
                        const priceChange24h = md?.price_change_percentage_24h;

                        return [
                            id,
                            {
                                price,
                                volume24h: typeof volume24h === 'number' && Number.isFinite(volume24h) ? volume24h : 0,
                                priceChange24h:
                                    typeof priceChange24h === 'number' && Number.isFinite(priceChange24h)
                                        ? priceChange24h
                                        : 0,
                            } satisfies CoinGeckoCoinMarketStats,
                        ] as const;
                    }),
                ),
            );

            for (const [id, stats] of results) out[id] = stats;

            return { stats: out };
        }),
    { platform: { requiredScopes: ['internal:read'] } },
);
