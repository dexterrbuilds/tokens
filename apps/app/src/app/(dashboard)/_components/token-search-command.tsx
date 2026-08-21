'use client';

import { useEffect, useState } from 'react';
import { IconCheckmark, IconChevronDown, IconExclamationmarkTriangleFill, IconEyeSlashFill } from 'symbols-react';

import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@tokens/ui/command';
import { Skeleton } from '@tokens/ui/skeleton';
import { Spinner } from '@tokens/ui/spinner';

import {
    TokenIdentity,
    formatUsd,
    humanize,
    shortMint,
    type PlaygroundFetcher,
    type SearchResponse,
    type SearchResult,
    type SearchSources,
    type SuppressedResult,
} from './token-bits';

/**
 * ⌘K curator search palette, modeled on the archive PR's v2 search dialog:
 * judged results with score pills and warnings, an expandable per-result
 * inspector (score bars, reasons, attestations), the suppressed set, and a
 * policy switcher in the footer. Selecting a result adds it to the active
 * list — the palette stays open so several tokens can be added in one pass.
 */

const POLICY_IDS = ['strict', 'default', 'degen'] as const;
type PolicyId = (typeof POLICY_IDS)[number];

function scoreTone(total: number): string {
    if (total >= 70) return 'bg-emerald-100 text-emerald-700';
    if (total >= 40) return 'bg-amber-100 text-amber-700';
    return 'bg-red-100 text-red-700';
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timeout = setTimeout(() => setDebounced(value), delayMs);
        return () => clearTimeout(timeout);
    }, [value, delayMs]);
    return debounced;
}

function CodeChip({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'warn' | 'good' | 'bad' }) {
    const tones = {
        neutral: 'bg-gray-100 text-muted-foreground',
        warn: 'bg-amber-100 text-amber-700',
        good: 'bg-emerald-100 text-emerald-700',
        bad: 'bg-red-100 text-red-700',
    } as const;
    return (
        <span
            className={`inline-flex items-center rounded-md px-1.5 py-0.5 font-berkeley-mono text-[10px] leading-4 ${tones[tone]}`}
        >
            {children}
        </span>
    );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
    return (
        <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 font-berkeley-mono text-[10px] text-muted-foreground">{label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                <div
                    className={`h-full rounded-full ${value >= 70 ? 'bg-emerald-500' : value >= 40 ? 'bg-amber-500' : 'bg-red-400'}`}
                    style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
                />
            </div>
            <span className="w-7 shrink-0 text-right font-berkeley-mono text-[10px] text-muted-foreground">
                {Math.round(value)}
            </span>
        </div>
    );
}

/** Per-result judgment breakdown, toggled by the chevron on a result row. */
function ResultInspector({ token }: { token: SearchResult }) {
    return (
        <div className="mt-2 w-full rounded-xl border border-border-extra-light bg-gray-50/70 dark:bg-zinc-900/40 p-3 text-left">
            <div className="grid gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-inter-semibold uppercase tracking-wide text-muted-foreground">
                        Score components
                    </span>
                    {Object.entries(token.score.components).map(([key, value]) => (
                        <ScoreBar key={key} label={humanize(key)} value={value} />
                    ))}
                </div>
                <div className="flex flex-col gap-2">
                    <div>
                        <span className="text-[10px] font-inter-semibold uppercase tracking-wide text-muted-foreground">
                            Reasons
                        </span>
                        <div className="mt-1 flex flex-wrap gap-1">
                            {token.reasons.length > 0 ? (
                                token.reasons.map(reason => (
                                    <CodeChip key={reason} tone="good">
                                        {humanize(reason)}
                                    </CodeChip>
                                ))
                            ) : (
                                <span className="text-xs text-muted-foreground">none</span>
                            )}
                        </div>
                    </div>
                    <div>
                        <span className="text-[10px] font-inter-semibold uppercase tracking-wide text-muted-foreground">
                            Warnings
                        </span>
                        <div className="mt-1 flex flex-wrap gap-1">
                            {token.warnings.length > 0 ? (
                                token.warnings.map(warning => (
                                    <CodeChip key={warning} tone="warn">
                                        {humanize(warning)}
                                    </CodeChip>
                                ))
                            ) : (
                                <span className="text-xs text-muted-foreground">none</span>
                            )}
                        </div>
                    </div>
                    <div>
                        <span className="text-[10px] font-inter-semibold uppercase tracking-wide text-muted-foreground">
                            Attestations
                        </span>
                        <div className="mt-1 flex flex-wrap gap-1">
                            {token.claims.attestations.length > 0 ? (
                                token.claims.attestations.map(attestation => (
                                    <CodeChip key={`${attestation.code}:${attestation.detail}`} tone="neutral">
                                        {attestation.detail}
                                    </CodeChip>
                                ))
                            ) : (
                                <span className="text-xs text-muted-foreground">
                                    unattested — symbol/name are unverified claims
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border-extra-light pt-2 text-[11px] text-muted-foreground">
                <span className="font-berkeley-mono">{token.mint}</span>
                <span>liq {formatUsd(token.market.liquidityUsd)}</span>
                <span>24h vol {formatUsd(token.market.volume24hUsd)}</span>
                <span>mcap {formatUsd(token.market.marketCapUsd)}</span>
                {token.inLists.length > 0 && <span>in: {token.inLists.join(', ')}</span>}
            </div>
        </div>
    );
}

export function TokenSearchCommand({
    open,
    onOpenChange,
    listSlug,
    memberMints,
    playgroundFetch,
    addingMint,
    onAdd,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    listSlug: string;
    memberMints: Set<string>;
    playgroundFetch: PlaygroundFetcher;
    addingMint: string | null;
    /** Adds to the active list; the palette stays open for multi-add. */
    onAdd: (result: SearchResult) => void;
}) {
    const [query, setQuery] = useState('');
    const [policy, setPolicy] = useState<PolicyId>('strict');
    const [results, setResults] = useState<SearchResult[] | null>(null);
    const [suppressed, setSuppressed] = useState<SuppressedResult[]>([]);
    const [sources, setSources] = useState<SearchSources | null>(null);
    const [latencyMs, setLatencyMs] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const [expandedMint, setExpandedMint] = useState<string | null>(null);

    const debouncedQuery = useDebouncedValue(query.trim(), 300);
    const hasQuery = debouncedQuery.length >= 2;

    useEffect(() => {
        if (!open || !hasQuery) {
            setResults(null);
            setSuppressed([]);
            setSources(null);
            setLatencyMs(null);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(false);
        void playgroundFetch(
            `/api/v2/lists/search-tokens?q=${encodeURIComponent(debouncedQuery)}&policy=${policy}&limit=8`,
        )
            .then(async res => {
                if (!res.ok) throw new Error(`search failed (HTTP ${res.status})`);
                const body = (await res.json()) as SearchResponse;
                if (cancelled) return;
                setResults(body.results);
                setSuppressed(body.suppressed);
                setSources(body.sources);
                setLatencyMs(body.latencyMs);
            })
            .catch(() => {
                if (!cancelled) setError(true);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open, hasQuery, debouncedQuery, policy, playgroundFetch]);

    function handleOpenChange(nextOpen: boolean) {
        onOpenChange(nextOpen);
        if (!nextOpen) {
            setQuery('');
            setExpandedMint(null);
        }
    }

    const sourceTone = (status: string): 'good' | 'neutral' | 'warn' =>
        status === 'ok' ? 'good' : status === 'disabled' ? 'neutral' : 'warn';

    return (
        <CommandDialog open={open} onOpenChange={handleOpenChange}>
            <CommandInput
                placeholder={`Search tokens to add to ${listSlug}…`}
                value={query}
                onValueChange={setQuery}
            />

            <CommandList className="h-[380px] max-h-[380px]">
                {!hasQuery ? (
                    <CommandEmpty>Type at least 2 characters — symbol, name, or a mint address.</CommandEmpty>
                ) : error ? (
                    <CommandEmpty>Search failed — check the API and your key’s lists:write scope.</CommandEmpty>
                ) : loading && results === null ? (
                    <CommandGroup heading="Judging candidates…">
                        {Array.from({ length: 4 }, (_, index) => (
                            <CommandItem key={index} disabled value={`__loading__${index}`} className="flex items-center gap-3 px-3 py-2">
                                <Skeleton className="h-8 w-8 rounded-full" />
                                <div className="flex flex-1 flex-col gap-1">
                                    <Skeleton className="h-4 w-40 rounded" />
                                    <Skeleton className="h-3 w-24 rounded" />
                                </div>
                                <Skeleton className="h-5 w-9 rounded-full" />
                            </CommandItem>
                        ))}
                    </CommandGroup>
                ) : results !== null ? (
                    <>
                        <CommandGroup heading="Ranked results">
                            {results.length === 0 && (
                                <CommandItem disabled value="__no_results__" className="px-3 py-2 text-muted-foreground">
                                    No results survived the {policy} policy.
                                </CommandItem>
                            )}
                            {results.map(result => {
                                const isMember = memberMints.has(result.mint);
                                const isAdding = addingMint === result.mint;
                                const expanded = expandedMint === result.mint;
                                return (
                                    <CommandItem
                                        key={result.mint}
                                        value={result.mint}
                                        disabled={isMember || isAdding}
                                        onSelect={() => {
                                            if (!isMember && !isAdding) onAdd(result);
                                        }}
                                        className="flex flex-col items-stretch gap-0 rounded-xl px-3 py-2"
                                    >
                                        <div className="flex w-full items-center gap-3">
                                            <div className="min-w-0 flex-1">
                                                <TokenIdentity
                                                    mint={result.mint}
                                                    symbol={result.claims.symbol}
                                                    name={result.claims.name}
                                                    logoURI={result.market.logoURI}
                                                    verified={result.verified}
                                                >
                                                    <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                                                        <span>{formatUsd(result.market.price)}</span>
                                                        <span>liq {formatUsd(result.market.liquidityUsd)}</span>
                                                        {result.warnings.length > 0 && (
                                                            <span className="inline-flex items-center gap-1 text-amber-600">
                                                                <IconExclamationmarkTriangleFill className="size-3 fill-amber-500" />
                                                                {result.warnings.length}
                                                            </span>
                                                        )}
                                                    </div>
                                                </TokenIdentity>
                                            </div>
                                            <span
                                                className={`inline-flex items-center rounded-full px-2 py-0.5 font-berkeley-mono text-xs font-semibold ${scoreTone(result.score.total)}`}
                                            >
                                                {result.score.total}
                                            </span>
                                            {isAdding ? (
                                                <Spinner size="sm" />
                                            ) : isMember ? (
                                                <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                                                    <IconCheckmark className="size-3 fill-emerald-600" />
                                                    Added
                                                </span>
                                            ) : (
                                                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                                    ↵ add
                                                </span>
                                            )}
                                            <button
                                                type="button"
                                                aria-label={expanded ? 'Hide judgment details' : 'Show judgment details'}
                                                onClick={event => {
                                                    event.stopPropagation();
                                                    event.preventDefault();
                                                    setExpandedMint(previous =>
                                                        previous === result.mint ? null : result.mint,
                                                    );
                                                }}
                                                className="flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-black/[0.06] dark:hover:bg-white/10"
                                            >
                                                <IconChevronDown
                                                    className={`size-3 fill-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
                                                />
                                            </button>
                                        </div>
                                        {expanded && <ResultInspector token={result} />}
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                        {suppressed.length > 0 && (
                            <CommandGroup heading={`Suppressed by policy (${suppressed.length})`}>
                                {suppressed.map(token => (
                                    <CommandItem
                                        key={token.mint}
                                        disabled
                                        value={`__suppressed__${token.mint}`}
                                        className="flex items-center gap-3 rounded-xl px-3 py-2 opacity-60"
                                    >
                                        <IconEyeSlashFill className="size-4 shrink-0 fill-muted-foreground" />
                                        <div className="flex min-w-0 flex-1 flex-col">
                                            <div className="flex items-center gap-2">
                                                <span className="font-inter-medium">
                                                    {token.symbol ?? shortMint(token.mint)}
                                                </span>
                                                <span className="truncate text-xs text-muted-foreground">
                                                    {token.name ?? ''}
                                                </span>
                                            </div>
                                            <div className="mt-0.5 flex flex-wrap gap-1">
                                                {token.suppressedBy.map(code => (
                                                    <CodeChip key={code} tone="bad">
                                                        {humanize(code)}
                                                    </CodeChip>
                                                ))}
                                            </div>
                                        </div>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        )}
                    </>
                ) : null}
            </CommandList>

            {/* Policy + sources footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-extra-light px-4 py-2.5">
                <div className="flex items-center gap-1">
                    <span className="mr-1 text-[10px] font-inter-semibold uppercase tracking-wide text-muted-foreground">
                        policy
                    </span>
                    {POLICY_IDS.map(id => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setPolicy(id)}
                            className={`rounded-full px-2.5 py-1 font-berkeley-mono text-xs transition-colors ${
                                policy === id
                                    ? id === 'strict'
                                        ? 'bg-emerald-600 text-white'
                                        : id === 'degen'
                                          ? 'bg-red-500 text-white'
                                          : 'bg-gray-800 text-white'
                                    : 'bg-gray-100 text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            {id}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    {sources && (
                        <>
                            <CodeChip tone={sourceTone(sources.provider)}>provider:{sources.provider}</CodeChip>
                            <CodeChip tone={sourceTone(sources.db)}>db:{sources.db}</CodeChip>
                            <CodeChip tone="good">registry:ok</CodeChip>
                        </>
                    )}
                    {latencyMs !== null && <span className="font-berkeley-mono">{latencyMs}ms</span>}
                </div>
            </div>
        </CommandDialog>
    );
}
