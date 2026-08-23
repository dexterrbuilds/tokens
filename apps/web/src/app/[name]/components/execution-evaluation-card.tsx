'use client';

import * as React from 'react';
import { Info } from 'lucide-react';

import { Input } from '@tokens/ui/input';
import { Tooltip } from '@solana/design-system/tooltip';

import { trackEvent } from '@/lib/posthog-client';
import {
    bucketAmountUsd,
    clampAmountUsd,
    useExecutionEvaluation,
    type ExecutionEvaluationVariant,
    type ImpactGrade,
} from '@/hooks/queries/use-execution-evaluation';

const GRADE_LETTER: Record<ImpactGrade, string> = {
    excellent: 'A',
    good: 'B',
    fair: 'C',
    poor: 'D',
    avoid: 'F',
};

// Mirrors the token page's badge tones (asset-stats-section BADGE_TONE_CLASSES).
const GRADE_CLASSES: Record<ImpactGrade, string> = {
    excellent: 'bg-green-50 text-green-800',
    good: 'bg-green-50 text-green-800',
    fair: 'bg-[#F2F3F5] text-text-medium',
    poor: 'bg-red-50 text-red-800',
    avoid: 'bg-red-50 text-red-800',
};

const STALE_AFTER_SECONDS = 30 * 60;
const AMOUNT_DEBOUNCE_MS = 400;

function formatSizeLabel(sizeUsd: number): string {
    if (sizeUsd >= 1_000_000) {
        const millions = sizeUsd / 1_000_000;
        return `$${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
    }
    return `$${Math.round(sizeUsd / 1_000)}K`;
}

function formatImpact(bps: number): string {
    const percent = bps / 100;
    if (percent >= 10) return `${Math.round(percent)}%`;
    if (percent >= 1) return `${percent.toFixed(1)}%`;
    return `${percent.toFixed(2)}%`;
}

/** Impact expressed as what it costs in dollars at a given trade size. */
function formatImpactCost(sizeUsd: number, impactBps: number): string {
    const cost = (sizeUsd * impactBps) / 10_000;
    if (cost < 1) return '<$1';
    if (cost < 1_000) return `−$${Math.round(cost)}`;
    if (cost < 1_000_000) return `−$${(cost / 1_000).toFixed(cost < 10_000 ? 1 : 0)}K`;
    return `−$${(cost / 1_000_000).toFixed(2)}M`;
}

function formatUsdCompact(value: number): string {
    return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function parseAmountInput(raw: string): number | null {
    const digits = raw.replace(/[^0-9.]/g, '');
    if (!digits) return null;
    const parsed = Number(digits);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function GradeChip({ grade, label }: { grade: ImpactGrade; label?: string }) {
    return (
        <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none tabular-nums ${GRADE_CLASSES[grade]}`}
        >
            <span>{GRADE_LETTER[grade]}</span>
            {label ? <span className="font-normal opacity-70">{label}</span> : null}
        </span>
    );
}

function variantLabel(variant: ExecutionEvaluationVariant): string {
    return variant.symbol ?? variant.name ?? `${variant.mint.slice(0, 4)}…`;
}

/**
 * Pre-trade depth evaluation for the active asset, backed by
 * `GET /v2/execution/evaluate`.
 *
 * Two modes, both visible at once: a scorecard grading every sampled size
 * rung on page load, and an amount input that evaluates an arbitrary size.
 * The card renders nothing until a response with real depth coverage arrives,
 * so pages for unsampled assets are unchanged (progressive enhancement).
 */
export function ExecutionEvaluationCard({
    assetId,
    activeMint,
    verbose = false,
}: {
    assetId: string;
    activeMint?: string | null;
    /** Standalone use (e.g. /evaluation): show loading and error states instead of rendering nothing. */
    verbose?: boolean;
}) {
    const [amountInput, setAmountInput] = React.useState('');
    const [debouncedAmount, setDebouncedAmount] = React.useState<number | null>(null);

    React.useEffect(() => {
        const parsed = parseAmountInput(amountInput);
        const timer = setTimeout(() => {
            setDebouncedAmount(parsed === null ? null : bucketAmountUsd(clampAmountUsd(parsed)));
        }, AMOUNT_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [amountInput]);

    const scorecard = useExecutionEvaluation(assetId);
    // First visit to an unsampled asset: ask the API to sample it on demand
    // (persisted server-side, so only the first visitor waits).
    const needsSample = scorecard.data
        ? scorecard.data.meta.depthCoverage.withCurves === 0 && scorecard.data.variants.length > 0
        : false;
    const sampledScorecard = useExecutionEvaluation(assetId, { sample: true, enabled: needsSample });
    const sized = useExecutionEvaluation(assetId, {
        amountUsd: debouncedAmount,
        live: true,
        enabled: debouncedAmount !== null,
    });

    const data = needsSample && sampledScorecard.data ? sampledScorecard.data : scorecard.data;
    const hasDepth = (data?.meta.depthCoverage.withCurves ?? 0) > 0;
    const isSampling = needsSample && sampledScorecard.isPending;

    const trackedRef = React.useRef(false);
    React.useEffect(() => {
        if (!data || !hasDepth || trackedRef.current) return;
        trackedRef.current = true;
        trackEvent('execution_eval_viewed', {
            asset_id: data.asset.assetId,
            depth_coverage: data.meta.depthCoverage.withCurves,
            variant_count: data.meta.depthCoverage.total,
            depth_source: data.meta.depthSource,
        });
    }, [data, hasDepth]);

    const lastTrackedAmount = React.useRef<number | null>(null);
    const sizedVariants = sized.data?.variants;
    React.useEffect(() => {
        if (debouncedAmount === null || !sizedVariants) return;
        if (lastTrackedAmount.current === debouncedAmount) return;
        lastTrackedAmount.current = debouncedAmount;
        const graded = sizedVariants.find(variant => variant.executionGrade !== null);
        trackEvent('execution_eval_amount_submitted', {
            asset_id: assetId,
            amount_bucket: debouncedAmount,
            grade: graded?.executionGrade ?? null,
        });
    }, [assetId, debouncedAmount, sizedVariants]);

    if (!data) {
        if (!verbose) return null;
        return (
            <section className="rounded-2xl border border-border-light bg-white p-4 shadow-[0_8px_40px_rgba(0,0,0,0.03)]">
                <h2 className="text-title-sm text-text-extra-high">Execution quality</h2>
                <p className="mt-2 text-body-md text-text-medium">
                    {scorecard.isError
                        ? `Couldn't evaluate “${assetId}” — unknown asset, or the API is unreachable.`
                        : `Loading ${assetId}…`}
                </p>
            </section>
        );
    }
    // Nothing evaluable at all (no on-chain variants).
    if (data.variants.length === 0) {
        if (!verbose) return null;
        return (
            <section className="rounded-2xl border border-border-light bg-white p-4 shadow-[0_8px_40px_rgba(0,0,0,0.03)]">
                <h2 className="text-title-sm text-text-extra-high">Execution quality</h2>
                <p className="mt-2 text-body-md text-text-medium">
                    “{assetId}” has no on-chain variants to evaluate.
                </p>
            </section>
        );
    }

    if (isSampling) {
        return (
            <section className="rounded-2xl border border-border-light bg-white p-4 shadow-[0_8px_40px_rgba(0,0,0,0.03)]">
                <h2 className="text-title-sm text-text-extra-high">Execution quality</h2>
                <p className="mt-2 text-body-md text-text-medium">
                    Sampling market depth… first visit to this asset takes a few seconds.
                </p>
            </section>
        );
    }

    if (!hasDepth) {
        return (
            <section className="rounded-2xl border border-border-light bg-white p-4 shadow-[0_8px_40px_rgba(0,0,0,0.03)]">
                <h2 className="text-title-sm text-text-extra-high">Execution quality</h2>
                <p className="mt-2 text-body-md text-text-medium">
                    No routable on-chain depth found for this asset right now.
                </p>
            </section>
        );
    }

    const ladderSizes = data.meta.sizeLadderUsd ?? [];
    const withCurves = data.variants.filter(variant => variant.ladder && variant.ladder.length > 0);
    const noRouteVariants = data.variants.filter(variant => variant.reasons.includes('no_route'));
    const unsampledCount = data.variants.length - withCurves.length - noRouteVariants.length;

    // In a variant view, lead with the mint the user is looking at.
    const orderedVariants = activeMint
        ? [...withCurves].sort((a, b) => Number(b.mint === activeMint) - Number(a.mint === activeMint))
        : withCurves;

    const freshestAsOf = Math.max(...withCurves.map(variant => variant.depthAsOf ?? 0));
    const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000) - freshestAsOf);
    const isStale = ageSeconds > STALE_AFTER_SECONDS;

    const sizedRows = sized.data?.variants.filter(variant => variant.executionGrade !== null) ?? [];
    const sizedIsLive = sized.data?.meta.quoteMode === 'live';

    return (
        <section className="rounded-2xl border border-border-light bg-white p-4 shadow-[0_8px_40px_rgba(0,0,0,0.03)]">
            <div className="mb-3 flex items-center gap-1.5">
                <h2 className="text-title-sm text-text-extra-high">Execution quality</h2>
                <Tooltip
                    content="What price impact would cost you at each trade size, from recent aggregator quotes. A means near-zero cost; F means most of the trade is lost to slippage."
                    side="top"
                    align="center"
                >
                    <button
                        type="button"
                        aria-label="More info about execution quality"
                        className="text-text-extra-low transition-colors hover:text-text-low"
                    >
                        <Info className="h-3 w-3" />
                    </button>
                </Tooltip>
                {isStale ? (
                    <span className="ml-auto text-[11px] text-text-extra-low tabular-nums">
                        sampled {Math.round(ageSeconds / 60)}m ago
                    </span>
                ) : null}
            </div>

            {/* Scorecard: grade per sampled size rung. */}
            <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                    <thead>
                        <tr>
                            <th className="pb-2 text-[11px] font-normal text-text-medium">Size</th>
                            {orderedVariants.map(variant => (
                                <th
                                    key={variant.mint}
                                    className="pb-2 text-right text-[11px] font-normal text-text-medium"
                                >
                                    {variantLabel(variant)}
                                    {data.primary?.mint === variant.mint ? (
                                        <span className="ml-1 text-text-extra-low" title="Our recommendation">
                                            ★
                                        </span>
                                    ) : null}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {ladderSizes.map(sizeUsd => (
                            <tr key={sizeUsd} className="border-t border-border-light">
                                <td className="py-2 text-body-md text-text-high tabular-nums">
                                    {formatSizeLabel(sizeUsd)}
                                </td>
                                {orderedVariants.map(variant => {
                                    const rung = variant.ladder?.find(entry => entry.sizeUsd === sizeUsd);
                                    return (
                                        <td key={variant.mint} className="py-2 text-right">
                                            {rung ? (
                                                <span title={`${formatImpact(rung.impactBps)} price impact`}>
                                                    <GradeChip
                                                        grade={rung.grade}
                                                        label={formatImpactCost(sizeUsd, rung.impactBps)}
                                                    />
                                                </span>
                                            ) : (
                                                <span className="text-[11px] text-text-extra-low">—</span>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {noRouteVariants.length > 0 ? (
                <p className="mt-2 text-[11px] text-text-extra-low">
                    No route found right now: {noRouteVariants.map(variantLabel).join(', ')}.
                </p>
            ) : null}
            {unsampledCount > 0 ? (
                <p className="mt-2 text-[11px] text-text-extra-low">
                    {unsampledCount} other {unsampledCount === 1 ? 'variant' : 'variants'} not sampled yet.
                </p>
            ) : null}

            {/* Evaluate an arbitrary size. */}
            <div className="mt-4 border-t border-border-light pt-4">
                <label
                    htmlFor="execution-eval-amount"
                    className="mb-2 flex items-center gap-2 text-[11px] font-normal text-text-medium"
                >
                    Evaluate your size
                    {debouncedAmount !== null && sizedRows.length > 0 ? (
                        <span
                            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                                sizedIsLive ? 'bg-green-50 text-green-800' : 'bg-[#F2F3F5] text-text-medium'
                            }`}
                        >
                            {sizedIsLive ? 'live quotes' : 'sampled'}
                        </span>
                    ) : null}
                </label>
                <div className="relative">
                    <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-body-md text-text-medium">
                        $
                    </span>
                    <Input
                        id="execution-eval-amount"
                        inputMode="numeric"
                        placeholder="1,000,000"
                        className="pl-7 tabular-nums"
                        value={amountInput}
                        onChange={event => setAmountInput(event.target.value)}
                    />
                </div>

                {debouncedAmount !== null ? (
                    <div
                        className={`mt-3 space-y-2 transition-opacity ${sized.isPlaceholderData ? 'opacity-50' : 'opacity-100'}`}
                    >
                        {sizedRows.length > 0 ? (
                            sizedRows.map(variant => {
                                const extrapolated = variant.reasons.includes('beyond_sampled_depth');
                                return (
                                    <div key={variant.mint} className="flex items-center justify-between gap-2">
                                        <span className="flex items-center gap-1 text-body-md text-text-high">
                                            {variantLabel(variant)}
                                            {extrapolated ? (
                                                <Tooltip
                                                    content="This size is beyond what we sampled for this variant — the estimate is clamped to its largest sampled size and is likely optimistic."
                                                    side="top"
                                                    align="center"
                                                >
                                                    <span className="cursor-help text-[11px] text-amber-700">
                                                        beyond sample
                                                    </span>
                                                </Tooltip>
                                            ) : null}
                                        </span>
                                        <span className="flex flex-col items-end gap-0.5">
                                            <span title={`${formatImpact(variant.estimatedImpactBps ?? 0)} price impact`}>
                                                <GradeChip
                                                    grade={variant.executionGrade as ImpactGrade}
                                                    label={`${formatImpactCost(debouncedAmount ?? 0, variant.estimatedImpactBps ?? 0)} to impact`}
                                                />
                                            </span>
                                            <span className="text-[11px] text-text-extra-low tabular-nums">
                                                ≈ {formatUsdCompact(variant.estimatedOutUsd ?? 0)} out
                                            </span>
                                        </span>
                                    </div>
                                );
                            })
                        ) : (
                            <p className="text-[11px] text-text-extra-low">
                                {sized.isFetching ? 'Evaluating…' : 'No depth samples for this size.'}
                            </p>
                        )}
                    </div>
                ) : null}
            </div>

            <p className="mt-3 text-[11px] text-text-extra-low">
                Scorecard from sampled {data.meta.depthSource ?? 'aggregator'} quotes; typed amounts fetch live quotes
                when available. Not an execution guarantee.
            </p>
        </section>
    );
}
