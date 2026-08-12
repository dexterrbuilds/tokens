import { cache } from 'react';
import { Effect } from 'effect';

import { BadRequestError } from '@tokens/effect';
import { fetchJsonWithRetry } from '@tokens/effect';
import type { MarketStats, Token } from '@/lib/types';
import { cleanTokenName, getTokenLogoURL } from '@/lib/logo-overrides';

const BIRDEYE_API_URL = 'https://public-api.birdeye.so';

interface TokenExtensions {
    coingeckoId?: string;
    website?: string;
    twitter?: string;
    discord?: string;
    telegram?: string;
    description?: string;
    github?: string;
}

export interface TokenOverview {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    logoURI?: string;
    extensions?: TokenExtensions;
    price: number;
    priceChange24hPercent: number;
    marketCap: number;
    fdv: number;
    liquidity: number;
    volume24h: number;
    holder: number;
    totalSupply: number;
    circulatingSupply: number;
    lastTradeHumanTime: string;
}

interface BirdeyeOverviewResponse {
    success: boolean;
    data: {
        address: string;
        name: string;
        symbol: string;
        decimals: number;
        logoURI?: string;
        extensions?: TokenExtensions;
        price: number;
        priceChange24hPercent: number;
        marketCap: number;
        fdv: number;
        liquidity: number;
        v24h: number;
        v24hUSD: number;
        holder: number;
        totalSupply: number;
        circulatingSupply: number;
        lastTradeHumanTime: string;
    };
}

function fetchTokenOverview(apiKey: string, address: string) {
    return fetchJsonWithRetry<BirdeyeOverviewResponse>({
        url: `${BIRDEYE_API_URL}/defi/token_overview?address=${address}`,
        service: 'birdeye',
        init: {
            headers: {
                'X-API-KEY': apiKey,
                'x-chain': 'solana',
            },
            next: { revalidate: 60 }, // Cache for 1 minute (data changes frequently)
        },
        maxRetries: 3,
    }).pipe(
        Effect.flatMap(result => {
            if (!result.success) {
                return Effect.fail(
                    new BadRequestError({
                        message: 'Birdeye API returned unsuccessful response',
                        details: { address },
                    }),
                );
            }

            const { data } = result;

            return Effect.succeed({
                address: data.address,
                name: data.name,
                symbol: data.symbol,
                decimals: data.decimals,
                logoURI: data.logoURI,
                extensions: data.extensions,
                price: data.price,
                priceChange24hPercent: data.priceChange24hPercent,
                marketCap: data.marketCap,
                fdv: data.fdv,
                liquidity: data.liquidity,
                volume24h: data.v24hUSD,
                holder: data.holder,
                totalSupply: data.totalSupply,
                circulatingSupply: data.circulatingSupply,
                lastTradeHumanTime: data.lastTradeHumanTime,
            } satisfies TokenOverview);
        }),
    );
}

async function getTokenOverviewImpl(address: string): Promise<TokenOverview | null> {
    const apiKey = process.env.BIRDEYE_API_KEY;

    if (!apiKey) {
        throw new Error('BIRDEYE_API_KEY environment variable is not set');
    }

    return await Effect.runPromise(fetchTokenOverview(apiKey, address));
}

/**
 * Per-request deduplication for server rendering.
 * Useful when `getTokenOverview()` is called multiple times within a single request
 * (e.g. `generateMetadata()` + page render).
 */
export const getTokenOverview = cache(getTokenOverviewImpl);

export interface OHLCVData {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    /** Candle volume in USD. Prefer Birdeye OHLCV v3 `v_usd`. */
    volume: number;
}

interface BirdeyeOHLCVResponse {
    success: boolean;
    data: {
        items: Array<{
            unixTime?: number;
            unix_time?: number;
            time?: number;
            o?: number;
            open?: number;
            h?: number;
            high?: number;
            l?: number;
            low?: number;
            c?: number;
            close?: number;
            v?: number;
            volume?: number;
            v_usd?: number;
            volumeUsd?: number;
            volume_usd?: number;
            volumeUSD?: number;
        }>;
    };
}

export type TimeInterval = '1m' | '5m' | '15m' | '1H' | '4H' | '1D' | '1W';

function toFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

function normalizeOhlcvItem(item: BirdeyeOHLCVResponse['data']['items'][number]): OHLCVData | null {
    const rawTime = toFiniteNumber(item.unixTime ?? item.unix_time ?? item.time);
    if (rawTime === null) return null;

    // Birdeye uses seconds; normalize if milliseconds are returned.
    const time = rawTime > 1e12 ? Math.floor(rawTime / 1000) : Math.floor(rawTime);

    const open = toFiniteNumber(item.o ?? item.open);
    const high = toFiniteNumber(item.h ?? item.high);
    const low = toFiniteNumber(item.l ?? item.low);
    const close = toFiniteNumber(item.c ?? item.close);

    if (open === null || high === null || low === null || close === null) return null;

    const volumeUsd = toFiniteNumber(item.v_usd ?? item.volumeUsd ?? item.volume_usd ?? item.volumeUSD);
    const tokenVolume = toFiniteNumber(item.v ?? item.volume);
    const volume = volumeUsd ?? (tokenVolume !== null ? tokenVolume * close : 0);

    return { time, open, high, low, close, volume };
}

export interface TokenMarketToken {
    address: string;
    decimals?: number;
    symbol?: string;
    icon?: string;
    name?: string;
}

export interface TokenMarket {
    /** Market/pool address */
    address: string;
    /** Human-readable name like "JitoSOL-SOL" */
    name?: string;
    base?: TokenMarketToken;
    quote?: TokenMarketToken;
    source?: string;
    createdAt?: string;
    liquidity?: number;
    volume24h?: number;
    trade24h?: number;
    trade24hChangePercent?: number;
    uniqueWallet24h?: number;
    uniqueWallet24hChangePercent?: number;
    price?: number | null;
}

export interface TokenMarketsResult {
    items: TokenMarket[];
    total?: number;
}

interface BirdeyeTokenMarketsResponse {
    success: boolean;
    data?: {
        items?: TokenMarket[];
        markets?: TokenMarket[];
        total?: number;
    };
}

export interface GetTokenMarketsOptions {
    timeFrame?: string;
    sortBy?: 'liquidity' | 'volume24h';
    sortType?: 'asc' | 'desc';
    offset?: number;
    limit?: number;
}

export async function getTokenMarkets(
    address: string,
    options: GetTokenMarketsOptions = {},
): Promise<TokenMarketsResult | null> {
    const apiKey = process.env.BIRDEYE_API_KEY;

    if (!apiKey) {
        throw new Error('BIRDEYE_API_KEY environment variable is not set');
    }

    const limit = Math.max(1, options.limit ?? 10);
    const offset = Math.max(0, options.offset ?? 0);

    const params = new URLSearchParams({
        address,
        time_frame: options.timeFrame ?? '24h',
        sort_type: options.sortType ?? 'desc',
        sort_by: options.sortBy ?? 'liquidity',
        offset: String(offset),
        limit: String(limit),
    });

    const result = await Effect.runPromise(
        fetchJsonWithRetry<BirdeyeTokenMarketsResponse>({
            url: `${BIRDEYE_API_URL}/defi/v2/markets?${params}`,
            service: 'birdeye',
            init: {
                headers: {
                    'X-API-KEY': apiKey,
                    'x-chain': 'solana',
                    Accept: 'application/json',
                },
                next: { revalidate: 60 }, // Cache for 1 minute
            },
            maxRetries: 3,
        }),
    );

    if (!result.success) {
        throw new Error('Birdeye API returned unsuccessful response');
    }

    const items = result.data?.items ?? result.data?.markets ?? [];

    return {
        items,
        total: result.data?.total,
    };
}

interface BirdeyeTokenListResponse {
    success: boolean;
    data: {
        tokens: Array<{
            address: string;
            name: string;
            symbol: string;
            decimals: number;
            logoURI?: string;
            liquidity: number;
            v24hUSD: number;
            price: number;
            v24hChangePercent: number;
            v1hChangePercent?: number;
            mc: number;
        }>;
        total?: number;
    };
}

interface BirdeyeTokenListV3Item {
    address: string;
    name?: string;
    symbol?: string;
    decimals?: number;
    logo_uri?: string;
    logoURI?: string;
    liquidity?: number;
    volume_24h_usd?: number;
    v24hUSD?: number;
    price?: number;
    price_change_24h_percent?: number;
    v24hChangePercent?: number;
    price_change_1h_percent?: number;
    market_cap?: number;
    mc?: number;
}

interface BirdeyeTokenListV3Response {
    success: boolean;
    data?: {
        items?: BirdeyeTokenListV3Item[];
    };
}

export async function getTopTokens(limit: number = 50): Promise<Token[]> {
    const apiKey = process.env.BIRDEYE_API_KEY;

    if (!apiKey) {
        console.error('BIRDEYE_API_KEY environment variable is not set');
        return [];
    }

    try {
        // Use the v3 token list endpoint which is more reliable
        const params = new URLSearchParams({
            sort_by: 'volume_24h_usd',
            sort_type: 'desc',
            offset: '0',
            limit: limit.toString(),
            min_liquidity: '10000',
        });

        const result = await Effect.runPromise(
            fetchJsonWithRetry<BirdeyeTokenListV3Response>({
                url: `${BIRDEYE_API_URL}/defi/v3/token/list?${params}`,
                service: 'birdeye',
                init: {
                    headers: {
                        'X-API-KEY': apiKey,
                        'x-chain': 'solana',
                    },
                    next: { revalidate: 60 }, // Cache for 1 minute
                },
                maxRetries: 3,
            }),
        );

        if (!result.success || !result.data?.items) {
            return getTopTokensLegacy(apiKey, limit);
        }

        return result.data.items.map((item: BirdeyeTokenListV3Item) => {
            const symbol = item.symbol || '???';
            return {
                address: item.address,
                name: cleanTokenName(item.name),
                symbol,
                decimals: item.decimals || 9,
                logoURI: getTokenLogoURL(symbol, item.logo_uri || item.logoURI),
                liquidity: item.liquidity || 0,
                volume24hUSD: item.volume_24h_usd || item.v24hUSD || 0,
                price: item.price || 0,
                priceChange24hPercent: item.price_change_24h_percent || item.v24hChangePercent || 0,
                priceChange1hPercent: item.price_change_1h_percent,
                marketCap: item.market_cap || item.mc || 0,
            };
        });
    } catch (error) {
        console.error('Failed to fetch top tokens:', error);
        return getTopTokensLegacy(apiKey, limit);
    }
}

function tokenOverviewToToken(overview: TokenOverview): Token | null {
    // If Birdeye doesn't return a symbol, treat the token as unavailable.
    // This avoids showing confusing placeholders (e.g. "???") in curated lists.
    const symbol = typeof overview.symbol === 'string' ? overview.symbol.trim() : '';
    if (!symbol) return null;

    return {
        address: overview.address,
        name: cleanTokenName(overview.name),
        symbol,
        decimals: overview.decimals ?? 9,
        logoURI: getTokenLogoURL(symbol, overview.logoURI),
        liquidity: overview.liquidity ?? 0,
        volume24hUSD: overview.volume24h ?? 0,
        price: overview.price ?? 0,
        priceChange24hPercent: overview.priceChange24hPercent ?? 0,
        marketCap: overview.marketCap ?? 0,
    };
}

function getUniqueAddresses(addresses: readonly string[]): string[] {
    const uniqueAddresses: string[] = [];
    const seen = new Set<string>();

    for (const address of addresses) {
        const trimmed = address.trim();
        if (!trimmed) continue;
        if (seen.has(trimmed)) continue;

        seen.add(trimmed);
        uniqueAddresses.push(trimmed);
    }

    return uniqueAddresses;
}

export async function getTokensByAddresses(addresses: readonly string[]): Promise<Token[]> {
    const apiKey = process.env.BIRDEYE_API_KEY;

    if (!apiKey) {
        console.error('BIRDEYE_API_KEY environment variable is not set');
        return [];
    }

    const uniqueAddresses = getUniqueAddresses(addresses);
    if (uniqueAddresses.length === 0) return [];

    // Use low concurrency + delay to avoid Birdeye rate limits (10 req/sec on free tier).
    const results = await Effect.runPromise(
        Effect.all(
            uniqueAddresses.map(address =>
                fetchTokenOverview(apiKey, address).pipe(
                    Effect.ensuring(Effect.sleep('200 millis')),
                    Effect.catch(() => Effect.succeed(null)),
                    Effect.map(overview => (overview ? tokenOverviewToToken(overview) : null)),
                ),
            ),
            { concurrency: 2 },
        ),
    );

    return results.filter((token): token is Token => token !== null);
}

async function getTopTokensLegacy(apiKey: string, limit: number): Promise<Token[]> {
    try {
        const params = new URLSearchParams({
            sort_by: 'v24hUSD',
            sort_type: 'desc',
            offset: '0',
            limit: limit.toString(),
        });

        const result = await Effect.runPromise(
            fetchJsonWithRetry<BirdeyeTokenListResponse>({
                url: `${BIRDEYE_API_URL}/defi/tokenlist?${params}`,
                service: 'birdeye',
                init: {
                    headers: {
                        'X-API-KEY': apiKey,
                        'x-chain': 'solana',
                    },
                    next: { revalidate: 60 },
                },
                maxRetries: 3,
            }),
        );

        if (!result.success || !result.data?.tokens) {
            return [];
        }

        return result.data.tokens.map(item => {
            const symbol = item.symbol || '???';
            return {
                address: item.address,
                name: cleanTokenName(item.name),
                symbol,
                decimals: item.decimals || 9,
                logoURI: getTokenLogoURL(symbol, item.logoURI),
                liquidity: item.liquidity || 0,
                volume24hUSD: item.v24hUSD || 0,
                price: item.price || 0,
                priceChange24hPercent: item.v24hChangePercent || 0,
                priceChange1hPercent: item.v1hChangePercent,
                marketCap: item.mc || 0,
            };
        });
    } catch {
        return [];
    }
}

export function calculateMarketStats(tokens: Token[]): MarketStats {
    const totalVolume24h = tokens.reduce((sum, t) => sum + t.volume24hUSD, 0);
    const totalTvl = tokens.reduce((sum, t) => sum + t.liquidity, 0);
    const totalMarketCap = tokens.reduce((sum, t) => sum + t.marketCap, 0);

    return {
        volume24h: totalVolume24h,
        totalTvl,
        totalMarketCap,
        allTimeVolume: totalVolume24h * 365, // Rough estimate
    };
}

export async function getTokenOHLCV(
    address: string,
    interval: TimeInterval = '1H',
    timeFrom?: number,
    timeTo?: number,
): Promise<OHLCVData[]> {
    const apiKey = process.env.BIRDEYE_API_KEY;

    if (!apiKey) {
        throw new Error('BIRDEYE_API_KEY environment variable is not set');
    }

    // Default to last 7 days if no time range specified
    const now = Math.floor(Date.now() / 1000);
    const from = timeFrom ?? now - 7 * 24 * 60 * 60;
    const to = timeTo ?? now;

    const params = new URLSearchParams({
        address,
        type: interval,
        time_from: from.toString(),
        time_to: to.toString(),
    });

    const result = await Effect.runPromise(
        fetchJsonWithRetry<BirdeyeOHLCVResponse>({
            url: `${BIRDEYE_API_URL}/defi/v3/ohlcv?${params}`,
            service: 'birdeye',
            init: {
                headers: {
                    'X-API-KEY': apiKey,
                    'x-chain': 'solana',
                },
                next: { revalidate: 300 }, // Cache for 5 minutes
            },
            maxRetries: 3,
        }),
    );

    if (!result.success || !result.data?.items) {
        return [];
    }

    return result.data.items.map(normalizeOhlcvItem).filter((v): v is OHLCVData => v !== null);
}
