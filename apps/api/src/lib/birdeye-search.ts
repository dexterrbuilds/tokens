import { Effect } from 'effect';

import { MissingEnvError } from '@tokens/effect';
import { fetchJsonWithRetry } from '@tokens/effect';

const BIRDEYE_API_URL = 'https://public-api.birdeye.so';

/** Provider-agnostic candidate shape (Birdeye specifics stay in this module). */
export interface ProviderSearchToken {
    address: string;
    symbol: string | null;
    name: string | null;
    decimals: number | null;
    logoURI: string | null;
    price: number | null;
    liquidityUsd: number | null;
    volume24hUsd: number | null;
    marketCapUsd: number | null;
    priceChange24hPercent: number | null;
    /** ISO timestamp of token creation, when the provider knows it. */
    createdAt: string | null;
    holderCount: number | null;
}

interface BirdeyeSearchTokenItem {
    address?: string;
    symbol?: string;
    name?: string;
    decimals?: number;
    logo_uri?: string;
    logoURI?: string;
    price?: number;
    liquidity?: number;
    volume_24h_usd?: number;
    v24hUSD?: number;
    market_cap?: number;
    fdv?: number;
    price_change_24h_percent?: number;
    creation_time?: string;
    created_time?: number;
    holder?: number;
}

interface BirdeyeSearchResponse {
    success: boolean;
    data?: {
        items?: Array<{
            type?: string;
            result?: BirdeyeSearchTokenItem[];
        }>;
    };
}

function toFinite(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return null;
}

function toText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function toCreatedAtIso(item: BirdeyeSearchTokenItem): string | null {
    const text = toText(item.creation_time);
    if (text) {
        const parsed = Date.parse(text);
        if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
    }
    const numeric = toFinite(item.created_time);
    if (numeric !== null && numeric > 0) {
        const ms = numeric > 1e12 ? numeric : numeric * 1000;
        return new Date(ms).toISOString();
    }
    return null;
}

function normalizeItem(item: BirdeyeSearchTokenItem): ProviderSearchToken | null {
    const address = toText(item.address);
    if (!address) return null;

    return {
        address,
        symbol: toText(item.symbol),
        name: toText(item.name),
        decimals: toFinite(item.decimals),
        logoURI: toText(item.logo_uri) ?? toText(item.logoURI),
        price: toFinite(item.price),
        liquidityUsd: toFinite(item.liquidity),
        volume24hUsd: toFinite(item.volume_24h_usd) ?? toFinite(item.v24hUSD),
        marketCapUsd: toFinite(item.market_cap) ?? toFinite(item.fdv),
        priceChange24hPercent: toFinite(item.price_change_24h_percent),
        createdAt: toCreatedAtIso(item),
        holderCount: toFinite(item.holder),
    };
}

export interface SearchProviderTokensOptions {
    limit?: number;
}

/**
 * Live token search via Birdeye `/defi/v3/search` (Solana, tokens only).
 * Fails with tagged errors — callers are expected to degrade gracefully
 * (`tapErrorAndDefault`) so a provider outage never breaks v2 search.
 */
export function searchProviderTokens(
    keyword: string,
    options: SearchProviderTokensOptions = {},
): Effect.Effect<ProviderSearchToken[], unknown> {
    const apiKey = (process.env.BIRDEYE_API_KEY ?? '').trim();
    if (!apiKey) {
        return Effect.fail(new MissingEnvError({ message: 'BIRDEYE_API_KEY is not set', name: 'BIRDEYE_API_KEY' }));
    }

    const limit = Math.max(1, Math.min(options.limit ?? 20, 20));
    const params = new URLSearchParams({
        chain: 'solana',
        keyword,
        target: 'token',
        search_mode: 'fuzzy',
        search_by: 'combination',
        sort_by: 'liquidity',
        sort_type: 'desc',
        offset: '0',
        limit: String(limit),
    });

    return fetchJsonWithRetry<BirdeyeSearchResponse>({
        url: `${BIRDEYE_API_URL}/defi/v3/search?${params}`,
        service: 'birdeye',
        init: {
            headers: {
                'X-API-KEY': apiKey,
                'x-chain': 'solana',
                Accept: 'application/json',
            },
            next: { revalidate: 30 },
        },
        // Keep the provider on a short leash: v2 search degrades to DB-only
        // candidates rather than blocking on a slow upstream.
        signal: AbortSignal.timeout(4_000),
        maxRetries: 2,
    }).pipe(
        Effect.map(response => {
            if (!response.success) return [];
            const items = response.data?.items ?? [];
            const tokens: ProviderSearchToken[] = [];
            for (const group of items) {
                if (group.type && group.type !== 'token') continue;
                for (const item of group.result ?? []) {
                    const normalized = normalizeItem(item);
                    if (normalized) tokens.push(normalized);
                }
            }
            return tokens;
        }),
    );
}
