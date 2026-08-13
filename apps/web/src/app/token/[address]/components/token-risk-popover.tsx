'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Effect } from 'effect';
import { apiJson } from '@/effect/api-client';
import { shouldRetryApiQuery } from '@/effect/query-retry';

import { cn } from '@tokens/ui/cn';
import { HoverCard, HoverCardArrow, HoverCardContent, HoverCardTrigger } from '@tokens/ui/hover-card';
import { IconCheckmarkShieldFill, IconExclamationmarkTriangleFill, IconInfoCircleFill } from 'symbols-react';
import { trackEvent } from '@/lib/posthog-client';
import { clamp } from './token-risk-helpers';

interface TokenRiskPopoverProps {
    address: string;
    riskSummaryUrl?: string;
    riskQueryKey?: readonly unknown[];
}

function RiskScoreTriggerIcon() {
    return (
        <svg
            width={19}
            height={19}
            viewBox="0 0 19 19"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="shrink-0"
            aria-hidden
        >
            <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M8 0.4C8.34 0.13 8.75 0 9.17 0C9.58 0 9.99 0.13 10.34 0.4L11.31 1.15L12.54 0.99C13.4 0.87 14.23 1.35 14.57 2.16L15.04 3.3L16.18 3.77L16.18 3.77C16.98 4.1 17.46 4.93 17.35 5.79L17.18 7.02L17.94 8C18.13 8.26 18.26 8.55 18.31 8.86C18.34 9.08 18.34 9.31 18.3 9.53C18.24 9.82 18.12 10.09 17.94 10.34L17.18 11.32L17.35 12.54C17.46 13.4 16.98 14.23 16.18 14.57L16.18 14.57L15.04 15.04L14.57 16.18C14.23 16.98 13.4 17.46 12.54 17.35L11.31 17.18L10.34 17.94C9.99 18.2 9.58 18.33 9.17 18.33C8.75 18.33 8.34 18.2 8 17.94L7.02 17.18L5.79 17.35C4.93 17.46 4.1 16.98 3.77 16.18L3.3 15.04L2.16 14.57L2.16 14.57C1.35 14.23 0.87 13.4 0.99 12.54L1.15 11.32L0.4 10.34C0.18 10.06 0.05 9.73 0.01 9.39C-0.04 8.91 0.08 8.4 0.4 8L1.15 7.02L0.99 5.79C0.87 4.93 1.35 4.1 2.16 3.77L2.16 3.77L3.3 3.3L3.77 2.16C4.1 1.35 4.93 0.87 5.79 0.99L7.02 1.15L8 0.4ZM12.67 7.67C13 7.35 13 6.82 12.67 6.49C12.35 6.17 11.82 6.17 11.49 6.49L8.33 9.65L7.26 8.58C6.93 8.25 6.4 8.25 6.08 8.58C5.75 8.9 5.75 9.43 6.08 9.76L7.74 11.42C8.07 11.75 8.6 11.75 8.92 11.42L12.67 7.67Z"
                className="fill-current opacity-[0.72]"
            />
        </svg>
    );
}

interface RiskData {
    score: number;
    grade: string;
    label: string;
    tone: 'risk' | 'warning' | 'safe' | 'info';
    isTrustedLaunch: boolean;
    caps: string[];
    hasInsufficientData: boolean;
    insufficientDataReason: string | null;
}

function MarketScoreGauge({
    score,
    grade,
    tone,
}: {
    score: number;
    grade: string;
    tone: 'risk' | 'warning' | 'safe' | 'info';
}) {
    const safeScore = score == null ? 0 : clamp(score, 0, 100);
    const ratio = safeScore / 100;

    const r = 60;
    const cx = 100;
    const cy = 100;
    const arcLength = Math.PI * r;
    const dashOffset = arcLength * (1 - ratio);
    const d = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;

    const strokeBase =
        tone === 'safe'
            ? 'stroke-emerald-200/30'
            : tone === 'warning'
              ? 'stroke-amber-200/30'
              : tone === 'risk'
                ? 'stroke-rose-200/30'
                : 'stroke-white/20';
    const strokeActive =
        tone === 'safe'
            ? 'stroke-emerald-400'
            : tone === 'warning'
              ? 'stroke-amber-400'
              : tone === 'risk'
                ? 'stroke-rose-400'
                : 'stroke-white/60';

    return (
        <div className="relative w-full">
            <svg viewBox="0 0 200 120" className="w-full h-auto mt-[-32px]" aria-hidden="true">
                <path d={d} fill="none" className={cn(strokeBase)} strokeWidth={10} strokeLinecap="round" />
                <path
                    d={d}
                    fill="none"
                    className={cn(strokeActive)}
                    strokeWidth={10}
                    strokeLinecap="round"
                    strokeDasharray={`${arcLength} ${arcLength}`}
                    strokeDashoffset={dashOffset}
                />
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center pt-16">
                <div className="flex items-baseline gap-1 mt-8">
                    <span className="text-[32px] leading-none font-medium text-white tabular-nums">{safeScore}</span>
                    <span className="text-sm text-white/60 font-medium">/100</span>
                </div>
                <div className="mt-1 text-xs text-white/50 font-sans">Grade {grade}</div>
            </div>
        </div>
    );
}

export function TokenRiskPopover({ address, riskSummaryUrl, riskQueryKey }: TokenRiskPopoverProps) {
    const [open, setOpen] = React.useState(false);

    const riskSummaryHref = riskSummaryUrl ?? `/api/v1/assets/risk-summary?mint=${encodeURIComponent(address)}`;
    const queryKey = riskQueryKey ?? ['assets', 'risk-summary', address];

    const {
        data: riskData,
        isLoading,
        error,
    } = useQuery<RiskData>({
        queryKey,
        queryFn: async ({ signal }) =>
            Effect.runPromise(apiJson<RiskData>({ url: riskSummaryHref }), { signal }),
        enabled: open,
        retry: shouldRetryApiQuery,
        staleTime: 60 * 1000,
    });

    return (
        <HoverCard
            open={open}
            onOpenChange={nextOpen => {
                setOpen(nextOpen);
                if (nextOpen) {
                    trackEvent('risk_popover_opened', {
                        ...(address ? { token_address: address } : {}),
                        ...(riskData?.score != null ? { risk_score: riskData.score } : {}),
                    });
                }
            }}
            openDelay={200}
            closeDelay={120}
        >
            <HoverCardTrigger asChild>
                <button
                    type="button"
                    aria-label="View risk score"
                    className="inline-flex items-center justify-center text-text-medium hover:text-text-high transition-colors"
                >
                    <RiskScoreTriggerIcon />
                </button>
            </HoverCardTrigger>
            <HoverCardContent
                side="right"
                align="start"
                sideOffset={10}
                className="w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl border border-border-strong bg-[var(--tooltip-bg)] p-2 text-[var(--tooltip-text)] shadow-[0_16px_48px_rgba(0,0,0,0.12)] translate-y-[-20px]"
            >
                <HoverCardArrow className="fill-[var(--tooltip-bg)] translate-x-[20px]" width={12} height={6} />

                <div className="px-2 pt-1.5 pb-2">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-white/80">Risk Score</span>
                        <div className="flex items-center gap-2">
                            {riskData && !riskData.hasInsufficientData && (
                                <>
                                    {(() => {
                                        const LabelIcon =
                                            riskData.tone === 'safe'
                                                ? IconCheckmarkShieldFill
                                                : riskData.tone === 'warning' || riskData.tone === 'risk'
                                                  ? IconExclamationmarkTriangleFill
                                                  : IconInfoCircleFill;
                                        const iconFill =
                                            riskData.tone === 'risk'
                                                ? 'fill-rose-400'
                                                : riskData.tone === 'warning'
                                                  ? 'fill-amber-400'
                                                  : riskData.tone === 'safe'
                                                    ? 'fill-emerald-400'
                                                    : 'fill-white/60';
                                        const labelColor =
                                            riskData.tone === 'safe'
                                                ? 'text-emerald-400'
                                                : riskData.tone === 'warning'
                                                  ? 'text-amber-400'
                                                  : riskData.tone === 'risk'
                                                    ? 'text-rose-400'
                                                    : 'text-white/60';
                                        return (
                                            <>
                                                <LabelIcon className={cn('h-3.5 w-3.5', iconFill)} />
                                                <span className={cn('text-xs font-medium', labelColor)}>
                                                    {riskData.label}
                                                </span>
                                            </>
                                        );
                                    })()}
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {error ? (
                    <div className="px-2 pb-2 text-sm text-white/80">Failed to load risk score.</div>
                ) : isLoading ? (
                    <div className="px-2 pb-2">
                        <div className="h-32 w-full rounded-xl bg-white/10 animate-pulse" />
                    </div>
                ) : riskData?.hasInsufficientData ? (
                    <div className="px-2 pb-2">
                        <div className="flex items-center gap-2 mb-2">
                            <IconInfoCircleFill className="h-4 w-4 fill-white/60" />
                            <span className="text-sm text-white/80">Insufficient Data</span>
                        </div>
                        <p className="text-sm text-white/60 text-pretty">
                            {riskData.insufficientDataReason ?? 'Not enough market data available to compute a score.'}
                        </p>
                    </div>
                ) : riskData ? (
                    <div className="px-2 pb-2">
                        <div className="rounded-xl bg-white/5 p-4 relative overflow-hidden border border-white/10">
                            {/* Dot pattern background */}
                            <div
                                className="absolute inset-0 z-0 size-full opacity-20"
                                style={{
                                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='4' height='4' viewBox='0 0 4 4' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='3' cy='3' r='0.5' fill='rgba(168,162,158,1)'/%3E%3C/svg%3E")`,
                                    backgroundRepeat: 'repeat',
                                }}
                            />
                            <MarketScoreGauge score={riskData.score} grade={riskData.grade} tone={riskData.tone} />
                        </div>
                    </div>
                ) : (
                    <div className="px-2 pb-2 text-sm text-white/80">Unable to load risk data.</div>
                )}
            </HoverCardContent>
        </HoverCard>
    );
}
