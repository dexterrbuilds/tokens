import { InvalidArgsError } from './assets';
import {
    DEPTH_USDC_QUOTE_MINT,
    sampleMintLadder,
    type DepthCronRepo,
    type DepthQuoteClient,
    type DepthQuoteSourceId,
} from './crons.depth';
import type { DepthCurveReadsRepo } from './depthCurveReads';

const MAX_QUOTE_AMOUNTS = 9;
const MIN_BUY_RAW_AMOUNT = 1_000_000n;
const MAX_BUY_RAW_AMOUNT = 50_000_000n * 1_000_000n;
const MAX_U64 = 18_446_744_073_709_551_615n;
const QUOTE_CONCURRENCY = 2;
const USDC_DECIMALS = 6;

export type ExecutionQuoteSide = 'buy' | 'sell';
export type ExecutionQuoteProvider = 'jupiter' | 'titan';

export interface ExecutionRouteStep {
    ammKey: string | null;
    label: string | null;
    percent: number | null;
    inputMint: string | null;
    outputMint: string | null;
    inAmountRaw: string | null;
    outAmountRaw: string | null;
    feeAmountRaw: string | null;
    feeMint: string | null;
}

export interface ExactQuote {
    inAmountRaw: string;
    outAmountRaw: string;
    priceImpactPct: number | null;
    route: ExecutionRouteStep[];
    contextSlot: number | null;
}

export interface JupiterTokenMetadata {
    mint: string;
    symbol: string;
    name: string;
    decimals: number;
}

export interface ExactQuoteClient {
    id: ExecutionQuoteProvider;
    fetchQuote(args: { inputMint: string; outputMint: string; amountRaw: string }): Promise<ExactQuote | null>;
}

export interface JupiterExactQuoteClient extends ExactQuoteClient {
    id: 'jupiter';
    fetchTokenMetadata(mint: string): Promise<JupiterTokenMetadata | null>;
}

export interface LiveQuoteDeps {
    jupiterQuoteSource: JupiterExactQuoteClient;
    titanQuoteSource?: ExactQuoteClient;
    now: () => number;
}

export interface ExecutionQuoteRequest {
    unit: 'usd' | 'token';
    amount: string;
    rawAmount: string;
}

export type ExecutionQuoteCandidate =
    | {
          provider: ExecutionQuoteProvider;
          status: 'available';
          inAmountRaw: string;
          outAmountRaw: string;
          priceImpactPct: number | null;
          route: ExecutionRouteStep[];
          contextSlot: number | null;
          quotedAt: string;
      }
    | {
          provider: ExecutionQuoteProvider;
          status: 'unavailable';
          reason: 'quote_unavailable';
          inAmountRaw: null;
          outAmountRaw: null;
          priceImpactPct: null;
          route: [];
          contextSlot: null;
          quotedAt: string;
      };

export type ExecutionQuoteEntry =
    | {
          request: ExecutionQuoteRequest;
          status: 'available';
          provider: ExecutionQuoteProvider;
          inAmountRaw: string;
          outAmountRaw: string;
          priceImpactPct: number | null;
          route: ExecutionRouteStep[];
          contextSlot: number | null;
          quotedAt: string;
          candidates: ExecutionQuoteCandidate[];
      }
    | {
          request: ExecutionQuoteRequest;
          status: 'unavailable';
          reason: 'quote_unavailable';
          provider: null;
          inAmountRaw: null;
          outAmountRaw: null;
          priceImpactPct: null;
          route: [];
          contextSlot: null;
          quotedAt: string;
          candidates: ExecutionQuoteCandidate[];
      };

export interface ExecutionQuotesLiveResult {
    providers: ['jupiter', 'titan'];
    mint: string;
    side: ExecutionQuoteSide;
    quoteMint: string;
    entries: ExecutionQuoteEntry[];
}

export async function executionQuoteTokenMetadata(deps: LiveQuoteDeps, args: unknown): Promise<JupiterTokenMetadata | null> {
    if (typeof args !== 'object' || args === null) throw new InvalidArgsError('args must be an object');
    const mint = (args as { mint?: unknown }).mint;
    if (typeof mint !== 'string' || !mint.trim()) throw new InvalidArgsError('mint must be a string');
    return deps.jupiterQuoteSource.fetchTokenMetadata(mint.trim());
}

function parseSide(raw: unknown): ExecutionQuoteSide {
    if (raw !== 'buy' && raw !== 'sell') throw new InvalidArgsError('side must be buy or sell');
    return raw;
}

export function formatRawAmount(rawAmount: string, decimals: number): string {
    const raw = BigInt(rawAmount);
    if (decimals === 0) return raw.toString();
    const padded = raw.toString().padStart(decimals + 1, '0');
    const whole = padded.slice(0, -decimals);
    const fraction = padded.slice(-decimals).replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole;
}

export function parseDecimalAmount(raw: string, decimals: number): ExecutionQuoteRequest {
    const value = raw.trim();
    const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
    if (!match) throw new InvalidArgsError('amounts must be positive decimal strings');
    const fraction = match[2] ?? '';
    if (fraction.length > decimals) {
        throw new InvalidArgsError(`amount has more than ${decimals} decimal places`);
    }
    const amountRaw = BigInt(`${match[1]}${fraction.padEnd(decimals, '0')}`);
    if (amountRaw <= 0n || amountRaw > MAX_U64) throw new InvalidArgsError('amount is outside the supported range');
    return { unit: decimals === USDC_DECIMALS ? 'usd' : 'token', amount: formatRawAmount(amountRaw.toString(), decimals), rawAmount: amountRaw.toString() };
}

function unavailableCandidate(
    provider: ExecutionQuoteProvider,
    quotedAt: string,
): Extract<ExecutionQuoteCandidate, { status: 'unavailable' }> {
    return {
        provider,
        status: 'unavailable',
        reason: 'quote_unavailable',
        inAmountRaw: null,
        outAmountRaw: null,
        priceImpactPct: null,
        route: [],
        contextSlot: null,
        quotedAt,
    };
}

async function fetchCandidate(
    deps: LiveQuoteDeps,
    client: ExactQuoteClient | undefined,
    provider: ExecutionQuoteProvider,
    args: { inputMint: string; outputMint: string; amountRaw: string },
): Promise<ExecutionQuoteCandidate> {
    if (!client) return unavailableCandidate(provider, new Date(deps.now()).toISOString());
    try {
        const quote = await client.fetchQuote(args);
        const quotedAt = new Date(deps.now()).toISOString();
        if (!quote) return unavailableCandidate(provider, quotedAt);
        return {
            provider,
            status: 'available',
            inAmountRaw: quote.inAmountRaw,
            outAmountRaw: quote.outAmountRaw,
            priceImpactPct: quote.priceImpactPct,
            route: quote.route,
            contextSlot: quote.contextSlot,
            quotedAt,
        };
    } catch {
        return unavailableCandidate(provider, new Date(deps.now()).toISOString());
    }
}

/** Compare fresh Jupiter and Titan quotes for one mint and up to nine sizes. */
export async function executionQuotesLive(deps: LiveQuoteDeps, args: unknown): Promise<ExecutionQuotesLiveResult> {
    if (typeof args !== 'object' || args === null) {
        throw new InvalidArgsError('args must be an object');
    }
    const a = args as { mint?: unknown; side?: unknown; amounts?: unknown; tokenDecimals?: unknown };
    if (typeof a.mint !== 'string' || !a.mint.trim()) throw new InvalidArgsError('mint must be a string');
    const side = parseSide(a.side);
    if (!Array.isArray(a.amounts) || a.amounts.some(item => typeof item !== 'string')) {
        throw new InvalidArgsError('amounts must be an array of strings');
    }
    if (!Number.isInteger(a.tokenDecimals) || (a.tokenDecimals as number) < 0 || (a.tokenDecimals as number) > 18) {
        throw new InvalidArgsError('tokenDecimals must be an integer between 0 and 18');
    }

    const decimals = side === 'buy' ? USDC_DECIMALS : (a.tokenDecimals as number);
    const unit = side === 'buy' ? 'usd' : 'token';
    const requests: ExecutionQuoteRequest[] = [];
    const seenRaw = new Set<string>();
    for (const amount of a.amounts as string[]) {
        const request: ExecutionQuoteRequest = { ...parseDecimalAmount(amount, decimals), unit };
        if (
            side === 'buy' &&
            (BigInt(request.rawAmount) < MIN_BUY_RAW_AMOUNT || BigInt(request.rawAmount) > MAX_BUY_RAW_AMOUNT)
        ) {
            throw new InvalidArgsError('amountUsd must be between 1 and 50000000');
        }
        if (seenRaw.has(request.rawAmount)) continue;
        seenRaw.add(request.rawAmount);
        requests.push(request);
    }
    if (requests.length === 0) throw new InvalidArgsError('at least one amount is required');
    if (requests.length > MAX_QUOTE_AMOUNTS) throw new InvalidArgsError('at most 9 unique amounts are allowed');

    const mint = a.mint.trim();
    const inputMint = side === 'buy' ? DEPTH_USDC_QUOTE_MINT : mint;
    const outputMint = side === 'buy' ? mint : DEPTH_USDC_QUOTE_MINT;
    const entries: ExecutionQuoteEntry[] = [];
    for (let i = 0; i < requests.length; i += QUOTE_CONCURRENCY) {
        const batch = requests.slice(i, i + QUOTE_CONCURRENCY);
        entries.push(
            ...(await Promise.all(
                batch.map(async request => {
                    const quoteArgs = {
                        inputMint,
                        outputMint,
                        amountRaw: request.rawAmount,
                    };
                    const candidates = await Promise.all([
                        fetchCandidate(deps, deps.jupiterQuoteSource, 'jupiter', quoteArgs),
                        fetchCandidate(deps, deps.titanQuoteSource, 'titan', quoteArgs),
                    ]);
                    const available = candidates.filter(
                        (candidate): candidate is Extract<ExecutionQuoteCandidate, { status: 'available' }> =>
                            candidate.status === 'available',
                    );
                    const winner = available.reduce<(typeof available)[number] | null>((best, candidate) => {
                        if (!best) return candidate;
                        // Candidate order is Jupiter then Titan, so equal output
                        // deterministically keeps Jupiter.
                        return BigInt(candidate.outAmountRaw) > BigInt(best.outAmountRaw) ? candidate : best;
                    }, null);
                    if (!winner) {
                        return {
                            request,
                            status: 'unavailable' as const,
                            reason: 'quote_unavailable' as const,
                            provider: null,
                            inAmountRaw: null,
                            outAmountRaw: null,
                            priceImpactPct: null,
                            route: [] as [],
                            contextSlot: null,
                            quotedAt: candidates[0]!.quotedAt,
                            candidates,
                        };
                    }
                    return {
                        request,
                        status: 'available' as const,
                        provider: winner.provider,
                        inAmountRaw: winner.inAmountRaw,
                        outAmountRaw: winner.outAmountRaw,
                        priceImpactPct: winner.priceImpactPct,
                        route: winner.route,
                        contextSlot: winner.contextSlot,
                        quotedAt: winner.quotedAt,
                        candidates,
                    };
                }),
            )),
        );
    }

    return {
        providers: ['jupiter', 'titan'],
        mint,
        side,
        quoteMint: DEPTH_USDC_QUOTE_MINT,
        entries,
    };
}

const SAMPLE_MAX_MINTS = 4;
const SAMPLE_MIN_AGE_MS = 30 * 60 * 1000;
const SAMPLE_RUNG_DELAY_MS = 250;
const SAMPLE_MINT_CONCURRENCY = 2;

export interface DepthSampleDeps {
    quoteSource: DepthQuoteClient;
    curvesRepo: DepthCronRepo;
    readsRepo: DepthCurveReadsRepo;
    now: () => number;
}

export interface DepthSampleResult {
    source: DepthQuoteSourceId;
    sampled: string[];
    skippedFresh: string[];
    failed: string[];
}

/**
 * On-demand depth sampling for mints the cron hasn't covered yet — the
 * read-through path behind `sample=missing` on /v2/execution/evaluate. The
 * first visitor to an unsampled asset pays a few seconds once; the result is
 * persisted, so every later view reads the stored curve. Bounded hard:
 * ≤ SAMPLE_MAX_MINTS per call, and mints sampled within SAMPLE_MIN_AGE_MS are
 * skipped so page reloads can't drain upstream quota.
 */
export async function depthSampleMints(deps: DepthSampleDeps, args: unknown): Promise<DepthSampleResult> {
    if (typeof args !== 'object' || args === null) {
        throw new InvalidArgsError('args must be an object');
    }
    const a = args as { mints?: unknown };
    if (!Array.isArray(a.mints) || a.mints.some(item => typeof item !== 'string')) {
        throw new InvalidArgsError('mints must be an array of strings');
    }
    const requested = [...new Set((a.mints as string[]).map(m => m.trim()).filter(Boolean))].slice(0, SAMPLE_MAX_MINTS);

    const existing = await deps.readsRepo.findLatestByMints({
        mints: requested,
        quoteMint: DEPTH_USDC_QUOTE_MINT,
        side: 'buy',
        source: deps.quoteSource.id as DepthQuoteSourceId,
    });
    const freshEnough = new Set(
        existing
            .filter(row => deps.now() - Number(row.last_computed_at) < SAMPLE_MIN_AGE_MS)
            .map(row => row.mint),
    );
    const toSample = requested.filter(mint => !freshEnough.has(mint));

    const sampled: string[] = [];
    const failed: string[] = [];
    for (let i = 0; i < toSample.length; i += SAMPLE_MINT_CONCURRENCY) {
        const batch = toSample.slice(i, i + SAMPLE_MINT_CONCURRENCY);
        await Promise.all(
            batch.map(async mint => {
                try {
                    const { ladder, failedPoints } = await sampleMintLadder({
                        quoteSource: deps.quoteSource,
                        mint,
                        delayMs: SAMPLE_RUNG_DELAY_MS,
                    });
                    await deps.curvesRepo.upsertVariantDepthCurve({
                        mint,
                        quoteMint: DEPTH_USDC_QUOTE_MINT,
                        side: 'buy',
                        source: deps.quoteSource.id as DepthQuoteSourceId,
                        ladder,
                        points: ladder.length,
                        failedPoints,
                        asOf: Math.floor(deps.now() / 1000),
                        lastComputedAt: deps.now(),
                    });
                    sampled.push(mint);
                } catch {
                    failed.push(mint);
                }
            }),
        );
    }

    return {
        source: deps.quoteSource.id as DepthQuoteSourceId,
        sampled,
        skippedFresh: [...freshEnough],
        failed,
    };
}
