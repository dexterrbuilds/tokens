import { Effect } from 'effect';

import { fetchJsonWithRetry } from '@tokens/effect';
import { route } from '@/effect/next-route';
import { getRedisClient, type RedisClient } from '@/lib/redis';
import { tapErrorAndDefault } from '@tokens/effect';

interface CoinGeckoNewsArticle {
    title: string;
    url: string;
    image: string;
    author: string;
    posted_at: string;
    type: 'news' | 'guide';
    source_name: string;
    related_coin_ids: string[];
}

type CoinGeckoNewsResponse = CoinGeckoNewsArticle[];
const DEFAULT_NEWS_PER_PAGE = 20;
const MAX_NEWS_PER_PAGE = 20;

const logDedupeMemory = new Map<string, number>();
const logDedupeInFlight = new Map<string, Promise<boolean>>();

/**
 * Resolve the active Redis client. Routes through `getRedisClient()` so the
 * `TOKENS_REDIS_TARGET=memorystore` flag (PR #189) flips us between Upstash
 * and Memorystore without touching this callsite. Returns `null` if Redis
 * is not configured (e.g. Upstash creds absent and Memorystore not enabled)
 * — this is a best-effort dedupe cache, so a missing Redis is non-fatal.
 */
function getRedis(): RedisClient | null {
    try {
        return getRedisClient();
    } catch {
        return null;
    }
}

async function shouldLogOnce(key: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    const memExp = logDedupeMemory.get(key);
    if (memExp !== undefined && memExp > now) return false;

    const existing = logDedupeInFlight.get(key);
    if (existing) return await existing;

    const work = (async () => {
        const redis = getRedis();
        if (redis) {
            try {
                const res = await redis.set(`logonce:${key}`, 1, { ex: ttlSeconds, nx: true });
                const shouldLog = res === 'OK';
                const localSeconds = shouldLog ? ttlSeconds : Math.min(ttlSeconds, 300);
                logDedupeMemory.set(key, now + localSeconds * 1000);
                return shouldLog;
            } catch {
                // Best-effort; fall back to per-instance suppression.
            }
        }

        logDedupeMemory.set(key, now + ttlSeconds * 1000);
        return true;
    })();

    logDedupeInFlight.set(key, work);
    try {
        return await work;
    } finally {
        logDedupeInFlight.delete(key);
    }
}

function parsePostedAtMs(value: string): number {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : 0;
}

function parseNewsPerPage(value: string | null): number {
    const parsed = Number.parseInt(value ?? '', 10);
    if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_NEWS_PER_PAGE;
    return Math.min(parsed, MAX_NEWS_PER_PAGE);
}

export const GET = route(
    (request: Request) =>
        Effect.gen(function* () {
            const url = new URL(request.url);
            const coinId = (url.searchParams.get('coin_id') ?? '').trim();
            const perPage = parseNewsPerPage(url.searchParams.get('per_page'));

            const apiKey = process.env.COINGECKO_API_KEY?.trim();
            if (!apiKey) {
                const shouldLog = yield* Effect.tryPromise(() =>
                    shouldLogOnce('coingecko:news:missing-api-key', 60 * 60),
                ).pipe(tapErrorAndDefault('coingecko.news.shouldLogMissingApiKey', true, { coinId }));

                if (shouldLog) {
                    console.error('CoinGecko news: COINGECKO_API_KEY is not set');
                }
                return [];
            }

            const upstreamUrl = new URL('https://pro-api.coingecko.com/api/v3/news');
            upstreamUrl.searchParams.set('page', '1');
            upstreamUrl.searchParams.set('per_page', String(perPage));
            upstreamUrl.searchParams.set('language', 'en');
            upstreamUrl.searchParams.set('type', 'news');
            if (coinId) upstreamUrl.searchParams.set('coin_id', coinId);

            const articles = yield* fetchJsonWithRetry<CoinGeckoNewsResponse>({
                url: upstreamUrl.toString(),
                service: 'coingecko',
                init: {
                    headers: {
                        Accept: 'application/json',
                        'x-cg-pro-api-key': apiKey,
                    },
                    next: { revalidate: 60 },
                },
                maxRetries: 2,
            }).pipe(
                Effect.catch(error =>
                    Effect.gen(function* () {
                        const shouldLog = yield* Effect.tryPromise(() =>
                            shouldLogOnce('coingecko:news:upstream-error', 5 * 60),
                        ).pipe(tapErrorAndDefault('coingecko.news.shouldLogUpstreamError', true, { coinId }));

                        if (shouldLog) {
                            console.error('CoinGecko news: upstream request failed', error);
                        }

                        return [] satisfies CoinGeckoNewsResponse;
                    }),
                ),
            );

            return articles
                .filter(item => item && item.type === 'news')
                .slice()
                .sort((a, b) => parsePostedAtMs(b.posted_at) - parsePostedAtMs(a.posted_at))
                .slice(0, perPage);
        }),
    { platform: { requiredScopes: ['assets:read'] } },
);
