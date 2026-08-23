import { InvalidArgsError } from './assets';
import {
    DEPTH_USDC_QUOTE_MINT,
    sampleMintLadder,
    type DepthCronRepo,
    type DepthQuoteClient,
    type DepthQuoteSourceId,
} from './crons.depth';
import type { DepthCurveReadsRepo } from './depthCurveReads';

const MAX_MINTS = 8;
const MIN_AMOUNT_USD = 1;
const MAX_AMOUNT_USD = 50_000_000;
const BASELINE_SIZE_USD = 10_000;
const USDC_DECIMALS_FACTOR = 1_000_000;
/** Mints quoted concurrently; each mint issues two upstream quotes. */
const MINT_CONCURRENCY = 2;

export interface LiveQuoteDeps {
    quoteSource: DepthQuoteClient;
    now: () => number;
}

export interface LiveQuoteEntry {
    mint: string;
    /** Impact of the sized quote vs a baseline-size quote taken in the same pass; null when either quote failed. */
    impactBps: number | null;
}

export interface ExecutionQuotesLiveResult {
    source: string;
    quoteMint: string;
    amountUsd: number;
    baselineSizeUsd: number;
    asOf: number;
    entries: LiveQuoteEntry[];
}

async function effectivePriceAt(
    quoteSource: DepthQuoteClient,
    mint: string,
    sizeUsd: number,
): Promise<number | null> {
    const quote = await quoteSource.fetchQuote({
        inputMint: DEPTH_USDC_QUOTE_MINT,
        outputMint: mint,
        amount: Math.round(sizeUsd * USDC_DECIMALS_FACTOR),
    });
    if (!quote || !(quote.inAmount > 0) || !(quote.outAmount > 0)) return null;
    return quote.outAmount / quote.inAmount;
}

async function quoteMint(
    quoteSource: DepthQuoteClient,
    mint: string,
    amountUsd: number,
    baselineSizeUsd: number,
): Promise<LiveQuoteEntry> {
    try {
        if (amountUsd <= baselineSizeUsd) {
            // At or below the baseline there is no meaningful impact spread to
            // measure; a single successful quote reads as ~zero impact.
            const price = await effectivePriceAt(quoteSource, mint, amountUsd);
            return { mint, impactBps: price === null ? null : 0 };
        }
        const [baseline, sized] = await Promise.all([
            effectivePriceAt(quoteSource, mint, baselineSizeUsd),
            effectivePriceAt(quoteSource, mint, amountUsd),
        ]);
        if (baseline === null || sized === null || baseline <= 0) return { mint, impactBps: null };
        return { mint, impactBps: Math.max(0, Math.round((1 - sized / baseline) * 10_000)) };
    } catch {
        // Transport failures degrade per mint; the caller falls back to sampled curves.
        return { mint, impactBps: null };
    }
}

/**
 * Fetch live quotes for up to MAX_MINTS mints at a specific USD size. Each
 * mint costs two upstream quotes (baseline + sized) so impact is measured
 * against the same instant, not a stored curve.
 */
export async function executionQuotesLive(deps: LiveQuoteDeps, args: unknown): Promise<ExecutionQuotesLiveResult> {
    if (typeof args !== 'object' || args === null) {
        throw new InvalidArgsError('args must be an object');
    }
    const a = args as { mints?: unknown; amountUsd?: unknown };
    if (!Array.isArray(a.mints) || a.mints.some(item => typeof item !== 'string')) {
        throw new InvalidArgsError('mints must be an array of strings');
    }
    if (typeof a.amountUsd !== 'number' || !Number.isFinite(a.amountUsd)) {
        throw new InvalidArgsError('amountUsd must be a finite number');
    }

    const amountUsd = Math.min(MAX_AMOUNT_USD, Math.max(MIN_AMOUNT_USD, a.amountUsd));
    const mints = [...new Set((a.mints as string[]).map(m => m.trim()).filter(Boolean))].slice(0, MAX_MINTS);

    const entries: LiveQuoteEntry[] = [];
    for (let i = 0; i < mints.length; i += MINT_CONCURRENCY) {
        const batch = mints.slice(i, i + MINT_CONCURRENCY);
        entries.push(
            ...(await Promise.all(
                batch.map(mint => quoteMint(deps.quoteSource, mint, amountUsd, BASELINE_SIZE_USD)),
            )),
        );
    }

    return {
        source: deps.quoteSource.id,
        quoteMint: DEPTH_USDC_QUOTE_MINT,
        amountUsd,
        baselineSizeUsd: BASELINE_SIZE_USD,
        asOf: Math.floor(deps.now() / 1000),
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
