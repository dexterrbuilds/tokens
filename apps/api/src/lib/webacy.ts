import { loadEnv } from './env';
import { Effect } from 'effect';

import { fetchJsonWithRetry } from '@tokens/effect';

const WEBACY_API_URL = 'https://api.webacy.com';

type NextFetchInit = RequestInit & { next?: { revalidate?: number } };

// ---------------------------------------------------------------------------
// Generic result types
// ---------------------------------------------------------------------------

export interface WebacyApiOk<T> {
    ok: true;
    data: T;
}

export interface WebacyApiError {
    ok: false;
    status: number;
    message: string;
}

export type WebacyApiResult<T> = WebacyApiOk<T> | WebacyApiError;

function extractMessageFromJsonBody(body: string): string | null {
    try {
        const json: unknown = JSON.parse(body);
        if (!json || typeof json !== 'object') return null;
        if (!('message' in json)) return null;
        const message = (json as { message?: unknown }).message;
        return typeof message === 'string' && message.length > 0 ? message : null;
    } catch {
        return null;
    }
}

function toWebacyApiError(error: unknown): WebacyApiError {
    if (error && typeof error === 'object' && '_tag' in error) {
        const tagged = error as { _tag?: unknown; message?: unknown; status?: unknown; body?: unknown };
        const message =
            typeof tagged.message === 'string' && tagged.message.length > 0 ? tagged.message : 'Unknown error';

        switch (tagged._tag) {
            case 'RateLimitedError':
                return { ok: false, status: 429, message };
            case 'UpstreamHttpError': {
                const status = typeof tagged.status === 'number' ? tagged.status : 0;
                const body = typeof tagged.body === 'string' ? tagged.body : undefined;
                const bodyMessage = body ? (extractMessageFromJsonBody(body) ?? body) : null;
                return { ok: false, status, message: bodyMessage ?? message };
            }
            case 'FetchFailedError':
            case 'JsonParseError':
                return { ok: false, status: 0, message };
        }
    }

    if (error instanceof Error) return { ok: false, status: 0, message: error.message };
    return { ok: false, status: 0, message: String(error) };
}

async function webacyGetJson<T>(url: string, apiKey: string): Promise<WebacyApiResult<T>> {
    return await Effect.runPromise(
        fetchJsonWithRetry<T>({
            url,
            service: 'webacy',
            init: {
                headers: {
                    'x-api-key': apiKey,
                    Accept: 'application/json',
                },
                next: { revalidate: 300 },
            } satisfies NextFetchInit,
            maxRetries: 2,
        }).pipe(
            Effect.map(data => ({ ok: true, data }) as const),
            Effect.catch(error => Effect.succeed(toWebacyApiError(error))),
        ),
    );
}

// ---------------------------------------------------------------------------
// /tokens/{tokenAddress} - Token Risk Analysis
// ---------------------------------------------------------------------------

export interface WebacyTokenRiskTag {
    key: string;
    name: string;
    type: string;
    severity: number;
    description: string;
}

export interface WebacyTokenRiskIssue {
    tags?: WebacyTokenRiskTag[];
    score?: number;
    riskScore?: string;
    categories?: Record<
        string,
        {
            key: string;
            name: string;
            description?: string;
            tags?: Record<string, boolean>;
            gradedDescription?: Record<string, string>;
        }
    >;
}

export interface WebacyLiquidityPool {
    lpMint: string;
    address: string;
    dexName: string;
    pairAddress: string;
    totalLiquidity: number;
    lockedLiquidityPercent: number;
}

export interface WebacyMarketData {
    id?: string;
    name?: string;
    symbol?: string;
    image?: string;
    current_price?: number;
    market_cap?: number;
    market_cap_rank?: number;
    total_volume?: number;
    price_change_24h?: number;
    price_change_percentage_24h?: number;
    circulating_supply?: number;
    total_supply?: number;
    ath?: number;
    atl?: number;
    liquidityData?: WebacyLiquidityPool[];
}

export interface WebacyTokenInfo {
    name?: string;
    symbol?: string;
    logo?: string;
    isPumpFun?: boolean;
    holderCount?: number;
    is_metadata_immutable?: boolean;
}

export interface WebacyTokenRiskDetails {
    is_trusted?: boolean;
    freezeable?: boolean;
    is_mintable?: boolean;
    is_pump_fun?: boolean;
    renounced?: boolean | null;
    token_standard?: string;
    illegal_unicode?: boolean;
    'mutable-metadata'?: boolean;
}

export interface WebacyBuySellTaxes {
    has_buy_tax?: boolean;
    has_sell_tax?: boolean;
}

export interface WebacyTokenResponse {
    risk?: {
        high?: number;
        medium?: number;
        count?: number;
        issues?: WebacyTokenRiskIssue[];
        details?: {
            marketData?: WebacyMarketData;
            token_info?: WebacyTokenInfo;
            token_risk?: WebacyTokenRiskDetails;
            buy_sell_taxes?: WebacyBuySellTaxes;
            address_info?: Record<string, unknown>;
        };
    };
}

export async function getWebacyToken(
    tokenAddress: string,
    chain: string = 'sol',
): Promise<WebacyApiResult<WebacyTokenResponse>> {
    const apiKey = loadEnv().ddApiKey;

    if (!apiKey) {
        return {
            ok: false,
            status: 0,
            message: 'DD_API_KEY environment variable is not set',
        };
    }

    const url = `${WEBACY_API_URL}/tokens/${encodeURIComponent(tokenAddress)}?chain=${chain}`;

    return await webacyGetJson<WebacyTokenResponse>(url, apiKey);
}

// ---------------------------------------------------------------------------
// /holder-analysis/{address} - Holder Analysis
// ---------------------------------------------------------------------------

export interface WebacySniperAnalysis {
    sniper_count?: number;
    sniper_addresses?: string[];
    sniper_total_percentage?: number;
    sniper_confidence_score?: number | null;
    potential_frontrunning_detected?: boolean;
    time_since_mint_analysis?: Array<{
        time_range_seconds: number;
        buy_count: number;
        supply_percentage: number;
        addresses: string[];
    }>;
}

export interface WebacyFirstBuyersAnalysis {
    timestamp?: string;
    buyers_analyzed_count?: number;
    dev_holdings_percentage?: number;
    buys_in_same_block_count?: number;
    buyers_still_holding_count?: number;
    current_holding_percentage?: number;
    snipers_still_holding_count?: number;
    snipers_still_holding_percentage?: number;
    top_5_buyers_bought_percentage?: number;
    top_10_buyers_bought_percentage?: number;
    top_20_buyers_bought_percentage?: number;
    bundled_percentage_supply_bought?: number;
    bundled_buyers_still_holding_count?: number;
    bundled_current_holding_percentage?: number;
    biggest_funder_sol_address?: string;
    biggest_funder_sol_amount?: number;
    biggest_funder_token_address?: string;
    biggest_funder_supply_percentage_token?: number;
    distinct_funders_sol_count?: number;
    distinct_funders_token_count?: number;
}

export interface WebacyHolderMetadata {
    name?: string;
    symbol?: string;
    logo?: string;
    isPumpFun?: boolean;
    holderCount?: number;
    is_metadata_immutable?: boolean;
}

export interface WebacyHolderAnalysisResponse {
    token_address?: string;
    minter?: string;
    token_mint_tx?: string;
    token_mint_time?: string;
    total_holders_count?: number;
    dev_launched_tokens_in_24_hours?: number;
    sniper_analysis?: WebacySniperAnalysis;
    first_buyers_analysis?: WebacyFirstBuyersAnalysis;
    metadata?: WebacyHolderMetadata;
}

export async function getWebacyHolderAnalysis(
    tokenAddress: string,
    chain: string = 'sol',
): Promise<WebacyApiResult<WebacyHolderAnalysisResponse>> {
    const apiKey = loadEnv().ddApiKey;

    if (!apiKey) {
        return {
            ok: false,
            status: 0,
            message: 'DD_API_KEY environment variable is not set',
        };
    }

    const url = `${WEBACY_API_URL}/holder-analysis/${encodeURIComponent(tokenAddress)}?chain=${chain}`;

    return await webacyGetJson<WebacyHolderAnalysisResponse>(url, apiKey);
}

// ---------------------------------------------------------------------------
// /trading-lite/{address} - Quick Trading DD
// ---------------------------------------------------------------------------

export interface WebacyBundlerAddress {
    address: string;
    initiallyAcquiredPercentage: number;
    initiallyAcquiredAmount: number;
    currentHoldingPercentage: number;
    currentHoldingAmount: number;
}

export interface WebacyTradingLiteResponse {
    CA?: string;
    DA?: string;
    Top10Holders?: number;
    SniperPercentageOnLaunch?: number;
    SniperAddresses?: string[];
    SniperPercentageHolding?: number;
    SniperConfidence?: number | null;
    BundlerAddresses?: WebacyBundlerAddress[];
    BundlerPercentageOnLaunch?: number;
    BundlerPercentageHolding?: number;
    TotalHolders?: number;
    DexScreenerPaid?: boolean;
    DevHoldingPercentage?: number;
    DevLaunched24Hours?: number;
    mintable?: boolean;
    freezable?: boolean;
    analysisTimestamp?: number;
}

export async function getWebacyTradingLite(
    tokenAddress: string,
    chain: string = 'sol',
): Promise<WebacyApiResult<WebacyTradingLiteResponse>> {
    const apiKey = loadEnv().ddApiKey;

    if (!apiKey) {
        return {
            ok: false,
            status: 0,
            message: 'DD_API_KEY environment variable is not set',
        };
    }

    const url = `${WEBACY_API_URL}/trading-lite/${encodeURIComponent(tokenAddress)}?chain=${chain}`;

    return await webacyGetJson<WebacyTradingLiteResponse>(url, apiKey);
}
