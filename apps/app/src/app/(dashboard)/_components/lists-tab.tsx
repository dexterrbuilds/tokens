'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { IconCircleFill, IconCircleGridCrossFill, IconTrashFill } from 'symbols-react';

import { Avatar, AvatarFallback, AvatarImage } from '@tokens/ui/avatar';
import { Badge } from '@tokens/ui/badge';
import { Button } from '@tokens/ui/button';
import { Input } from '@tokens/ui/input';
import { Label } from '@tokens/ui/label';
import { Skeleton } from '@tokens/ui/skeleton';
import { Spinner } from '@tokens/ui/spinner';
import { CopyButton } from '@/components/app-ui/copy-button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/app-ui/dialog';
import { EmptyState } from '@/components/global/empty-state';
import { useProjectApiKeys } from '@/contexts/project-api-keys';

/**
 * Community lists management: a first-party client of the public /api/v2/lists
 * API, authenticated through the playground key-reveal proxy — the same write
 * path partners use programmatically, so there is nothing dashboard-only to
 * drift. Projects without the invite-only `lists:write` scope see a
 * request-access state.
 */

interface V2ListSummary {
    slug: string;
    name: string;
    description: string | null;
    curated: boolean;
    owner: { name?: string; projectId?: string };
    tokenCount: number;
    updatedAt: number | null;
}

interface V2ListToken {
    mint: string;
    symbol: string | null;
    name: string | null;
    logoURI: string | null;
    decimals: number | null;
    verified: boolean;
    rank: number;
    note?: string;
    addedAt?: number;
}

interface SearchResult {
    mint: string;
    claims: {
        symbol: string | null;
        name: string | null;
        attestations: Array<{ code: string; detail: string }>;
    };
    market: {
        price: number | null;
        liquidityUsd: number | null;
        volume24hUsd: number | null;
        marketCapUsd: number | null;
        priceChange24hPercent: number | null;
        holderCount: number | null;
        decimals: number | null;
        logoURI: string | null;
        dataAsOf: number | null;
    };
    score: { total: number; components: Record<string, number> };
    reasons: string[];
    warnings: string[];
    badges: string[];
    verified: boolean;
    inLists: string[];
}

interface SuppressedResult {
    mint: string;
    symbol: string | null;
    name: string | null;
    suppressedBy: string[];
    warnings: string[];
}

type WriteAccess = 'checking' | 'granted' | 'denied';

function shortMint(mint: string): string {
    return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

function formatUsd(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return '—';
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    return `$${value.toFixed(2)}`;
}

/** Admin app's formatValue: '—' for null/non-finite, locale string otherwise. */
function formatValue(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    return value.toLocaleString(undefined, { maximumFractionDigits: value >= 1 ? 2 : 8 });
}

function formatDate(ms: number | undefined | null): string {
    if (!ms) return '—';
    return new Date(ms).toLocaleDateString();
}

function slugify(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 63);
}

function humanize(code: string): string {
    return code.replaceAll('_', ' ');
}

function VerifiedBadge({ verified }: { verified: boolean }) {
    return (
        <Badge variant={verified ? 'success' : 'secondary'} className="flex items-center gap-1.5 px-1.5">
            <IconCircleFill className={`w-1.5 h-1.5 rounded-full ${verified ? 'fill-emerald-500' : 'fill-zinc-400'}`} />
            {verified ? 'Verified' : 'Unverified'}
        </Badge>
    );
}

function WarningChips({ warnings }: { warnings: string[] }) {
    if (warnings.length === 0) return null;
    return (
        <span className="flex flex-wrap gap-1">
            {warnings.map(warning => (
                <Badge key={warning} variant="warning" className="px-1.5 text-[10px]">
                    {humanize(warning)}
                </Badge>
            ))}
        </span>
    );
}

/** Admin curation table's identity cell: logo avatar with initials fallback + symbol/name stack. */
function TokenIdentity({
    mint,
    symbol,
    name,
    logoURI,
    verified,
    size = 'row',
    children,
}: {
    mint: string;
    symbol: string | null;
    name: string | null;
    logoURI: string | null;
    verified?: boolean;
    size?: 'row' | 'dialog';
    children?: React.ReactNode;
}) {
    const avatarSize = size === 'dialog' ? 'h-12 w-12' : 'h-8 w-8';
    return (
        <div className="flex items-center gap-3 min-w-0">
            <Avatar className={`${avatarSize} shrink-0`}>
                {logoURI ? <AvatarImage src={logoURI} alt={symbol ?? mint} /> : null}
                <AvatarFallback className="text-[10px]">{(symbol ?? mint).slice(0, 2)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-inter-medium">{symbol ?? shortMint(mint)}</span>
                    {verified !== undefined && <VerifiedBadge verified={verified} />}
                </div>
                <div className="truncate text-sm text-muted-foreground">{name ?? '—'}</div>
                {children}
            </div>
        </div>
    );
}

/** Admin add-variant-dialog's SummaryField: eyebrow label + value card. */
function SummaryField({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0 rounded-md border border-border-extra-light bg-white dark:bg-zinc-950/30 px-3 py-2">
            <div className="text-[11px] font-inter-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {label}
            </div>
            <div className="mt-1 truncate text-sm font-inter-medium text-foreground">{value}</div>
        </div>
    );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
    return (
        <div className="text-xs font-inter-semibold uppercase tracking-[0.08em] text-muted-foreground">{children}</div>
    );
}

/** Dashboard table chrome (shared with the API-keys tables): gray gutter, uppercase header, white card. */
function TableSection({
    header,
    columns,
    children,
}: {
    header?: React.ReactNode;
    columns: string;
    children: React.ReactNode;
}) {
    return (
        <div className="rounded-[12px] bg-gray-100/60 overflow-hidden p-0.5">
            {header && (
                <div className="px-3 py-2">
                    <div
                        className={`grid ${columns} gap-4 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide`}
                    >
                        {header}
                    </div>
                </div>
            )}
            <div className="bg-white dark:bg-zinc-950/30 border border-black/[0.15] rounded-lg shadow-sm overflow-hidden">
                {children}
            </div>
        </div>
    );
}

const SEARCH_COLUMNS = 'grid-cols-[minmax(0,1.6fr)_minmax(0,0.4fr)_minmax(0,0.55fr)_minmax(0,0.7fr)_72px]';
const MEMBER_COLUMNS = 'grid-cols-[minmax(0,1.5fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_minmax(0,0.55fr)_72px]';

/**
 * Metadata viewer modeled on the admin app's mint preview: identity header,
 * copyable mint, market field grid, and the judgment breakdown (score
 * components, reasons, warnings, attestations).
 */
function TokenMetadataDialog({
    open,
    onOpenChange,
    mint,
    fallback,
    judged,
    loading,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    mint: string | null;
    /** Identity from the row, shown while (or if) judgment data is unavailable. */
    fallback: { symbol: string | null; name: string | null; logoURI: string | null; verified?: boolean } | null;
    judged: SearchResult | null;
    loading: boolean;
}) {
    if (!mint) return null;
    const symbol = judged?.claims.symbol ?? fallback?.symbol ?? null;
    const name = judged?.claims.name ?? fallback?.name ?? null;
    const logoURI = judged?.market.logoURI ?? fallback?.logoURI ?? null;
    const verified = judged?.verified ?? fallback?.verified;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Token metadata</DialogTitle>
                    <DialogDescription>
                        Live market data and the judgment breakdown for this mint.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5 py-2">
                    {/* Identity */}
                    <div className="rounded-md border border-border-medium bg-white dark:bg-zinc-950/30 p-3">
                        <TokenIdentity
                            mint={mint}
                            symbol={symbol}
                            name={name}
                            logoURI={logoURI}
                            {...(verified !== undefined ? { verified } : {})}
                            size="dialog"
                        >
                            {judged && judged.badges.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                    {judged.badges.map(badge => (
                                        <Badge key={badge} variant="outline" className="px-1.5 text-[10px]">
                                            {badge}
                                        </Badge>
                                    ))}
                                </div>
                            )}
                        </TokenIdentity>
                        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span className="min-w-0 truncate font-berkeley-mono">{mint}</span>
                            <CopyButton
                                textToCopy={mint}
                                showText={false}
                                ariaLabel="Copy mint address"
                                className="h-7 w-7 shrink-0 rounded-sm hover:bg-gray-50/60 transition-colors duration-150"
                                iconClassName="h-3.5 w-3.5 text-muted-foreground"
                                iconClassNameCheck="h-3.5 w-3.5"
                                onCopied={() => toast.success('Mint address copied')}
                            />
                        </div>
                    </div>

                    {loading && (
                        <div className="flex items-center justify-center py-10">
                            <Button variant="outline" size="sm" disabled>
                                <span className="inline-flex items-center gap-2">
                                    <Spinner size="sm" />
                                    Loading metadata…
                                </span>
                            </Button>
                        </div>
                    )}

                    {!loading && !judged && (
                        <p className="text-sm text-muted-foreground">
                            No live market or judgment data is available for this mint right now.
                        </p>
                    )}

                    {!loading && judged && (
                        <>
                            {/* Market */}
                            <div className="space-y-2">
                                <SectionHeading>Market</SectionHeading>
                                <div className="grid gap-2 sm:grid-cols-3">
                                    <SummaryField label="Price" value={formatValue(judged.market.price)} />
                                    <SummaryField label="Liquidity" value={formatUsd(judged.market.liquidityUsd)} />
                                    <SummaryField label="Volume 24h" value={formatUsd(judged.market.volume24hUsd)} />
                                    <SummaryField label="Market cap" value={formatUsd(judged.market.marketCapUsd)} />
                                    <SummaryField label="Holders" value={formatValue(judged.market.holderCount)} />
                                    <SummaryField label="Decimals" value={formatValue(judged.market.decimals)} />
                                </div>
                            </div>

                            {/* Judgment */}
                            <div className="space-y-2">
                                <SectionHeading>Judgment · score {judged.score.total}</SectionHeading>
                                <div className="grid gap-2 sm:grid-cols-3">
                                    {Object.entries(judged.score.components).map(([key, value]) => (
                                        <SummaryField key={key} label={humanize(key)} value={String(value)} />
                                    ))}
                                </div>
                                {judged.reasons.length > 0 && (
                                    <div className="flex flex-wrap gap-1 pt-1">
                                        {judged.reasons.map(reason => (
                                            <Badge key={reason} variant="secondary" className="px-1.5 text-[10px]">
                                                {humanize(reason)}
                                            </Badge>
                                        ))}
                                    </div>
                                )}
                                <WarningChips warnings={judged.warnings} />
                            </div>

                            {/* Attestations */}
                            {judged.claims.attestations.length > 0 && (
                                <div className="space-y-2">
                                    <SectionHeading>Attestations</SectionHeading>
                                    <div className="grid gap-2 sm:grid-cols-2">
                                        {judged.claims.attestations.map(attestation => (
                                            <SummaryField
                                                key={`${attestation.code}:${attestation.detail}`}
                                                label={humanize(attestation.code)}
                                                value={attestation.detail}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}

                            {judged.inLists.length > 0 && (
                                <div className="space-y-2">
                                    <SectionHeading>Already in lists</SectionHeading>
                                    <div className="flex flex-wrap gap-1">
                                        {judged.inLists.map(slug => (
                                            <Badge key={slug} variant="outline" className="px-1.5 text-[10px]">
                                                {slug}
                                            </Badge>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

export function ListsTab(): React.JSX.Element {
    const { projectId, currentApiKeyId, hasActiveApiKey } = useProjectApiKeys();

    const playgroundFetch = useCallback(
        (path: string, init?: { method?: string; body?: unknown }) => {
            const headers: Record<string, string> = { accept: 'application/json' };
            if (projectId && currentApiKeyId) {
                headers['x-tokens-playground-project-id'] = projectId;
                headers['x-tokens-playground-api-key-id'] = currentApiKeyId;
            }
            if (init?.body !== undefined) headers['content-type'] = 'application/json';
            return fetch(path, {
                method: init?.method ?? 'GET',
                headers,
                ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
            });
        },
        [projectId, currentApiKeyId],
    );

    const [writeAccess, setWriteAccess] = useState<WriteAccess>('checking');
    const [myLists, setMyLists] = useState<V2ListSummary[] | null>(null);
    const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
    const [tokens, setTokens] = useState<V2ListToken[] | null>(null);

    const ready = Boolean(projectId && currentApiKeyId && hasActiveApiKey);

    // Scope probe: POST with an empty body mutates nothing — a key without
    // lists:write gets 403 at the scope gate; a granted key reaches body
    // validation and gets 400.
    useEffect(() => {
        if (!ready) return;
        let cancelled = false;
        setWriteAccess('checking');
        void playgroundFetch('/api/v2/lists', { method: 'POST', body: {} }).then(
            res => {
                if (!cancelled) setWriteAccess(res.status === 403 ? 'denied' : 'granted');
            },
            () => {
                if (!cancelled) setWriteAccess('denied');
            },
        );
        return () => {
            cancelled = true;
        };
    }, [ready, playgroundFetch]);

    const refreshLists = useCallback(async () => {
        if (!ready) return;
        const res = await playgroundFetch('/api/v2/lists?limit=500');
        if (!res.ok) return;
        const body = (await res.json()) as { lists: V2ListSummary[] };
        setMyLists(body.lists.filter(list => !list.curated && list.owner.projectId === projectId));
    }, [ready, playgroundFetch, projectId]);

    useEffect(() => {
        setMyLists(null);
        setSelectedSlug(null);
        void refreshLists();
    }, [refreshLists]);

    const refreshDetail = useCallback(async () => {
        if (!selectedSlug) {
            setTokens(null);
            return;
        }
        const res = await playgroundFetch(`/api/v2/lists/${selectedSlug}?limit=2000`);
        if (!res.ok) {
            setTokens([]);
            return;
        }
        const body = (await res.json()) as { tokens: V2ListToken[] };
        setTokens(body.tokens);
    }, [selectedSlug, playgroundFetch]);

    useEffect(() => {
        setTokens(null);
        void refreshDetail();
    }, [refreshDetail]);

    // ---- create dialog ----
    const [createOpen, setCreateOpen] = useState(false);
    const [createSlug, setCreateSlug] = useState('');
    const [slugTouched, setSlugTouched] = useState(false);
    const [createName, setCreateName] = useState('');
    const [createDescription, setCreateDescription] = useState('');
    const [createError, setCreateError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);

    const handleCreate = useCallback(async () => {
        setCreateError(null);
        setCreating(true);
        try {
            const res = await playgroundFetch('/api/v2/lists', {
                method: 'POST',
                body: {
                    slug: createSlug.trim(),
                    name: createName.trim(),
                    ...(createDescription.trim() ? { description: createDescription.trim() } : {}),
                },
            });
            const body = (await res.json()) as { list?: { slug: string }; error?: { message?: string } };
            if (!res.ok) throw new Error(body.error?.message ?? `Create failed (HTTP ${res.status})`);
            setCreateOpen(false);
            setCreateSlug('');
            setCreateName('');
            setCreateDescription('');
            setSlugTouched(false);
            toast.success(`List "${createName.trim()}" created`);
            await refreshLists();
            if (body.list) setSelectedSlug(body.list.slug);
        } catch (error) {
            setCreateError(error instanceof Error ? error.message : String(error));
        } finally {
            setCreating(false);
        }
    }, [playgroundFetch, createSlug, createName, createDescription, refreshLists]);

    // ---- archive (two-step confirm) ----
    const [confirmArchive, setConfirmArchive] = useState(false);
    const [archiving, setArchiving] = useState(false);

    useEffect(() => setConfirmArchive(false), [selectedSlug]);

    const handleArchive = useCallback(async () => {
        if (!selectedSlug) return;
        setArchiving(true);
        try {
            const res = await playgroundFetch(`/api/v2/lists/${selectedSlug}`, { method: 'DELETE' });
            if (!res.ok) {
                const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
                throw new Error(body?.error?.message ?? `Archive failed (HTTP ${res.status})`);
            }
            toast.success(`List "${selectedSlug}" archived`);
            setSelectedSlug(null);
            await refreshLists();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        } finally {
            setArchiving(false);
            setConfirmArchive(false);
        }
    }, [selectedSlug, playgroundFetch, refreshLists]);

    // ---- curator search ----
    const [search, setSearch] = useState('');
    const [searching, setSearching] = useState(false);
    const [results, setResults] = useState<SearchResult[] | null>(null);
    const [suppressed, setSuppressed] = useState<SuppressedResult[]>([]);
    const [addingMint, setAddingMint] = useState<string | null>(null);

    useEffect(() => {
        const query = search.trim();
        if (!query || !selectedSlug) {
            setResults(null);
            setSuppressed([]);
            return;
        }
        const handle = setTimeout(() => {
            setSearching(true);
            void playgroundFetch(`/api/v2/lists/search-tokens?q=${encodeURIComponent(query)}&limit=8`)
                .then(async res => {
                    if (!res.ok) throw new Error(`search failed (HTTP ${res.status})`);
                    const body = (await res.json()) as { results: SearchResult[]; suppressed: SuppressedResult[] };
                    setResults(body.results);
                    setSuppressed(body.suppressed);
                })
                .catch(() => {
                    setResults([]);
                    setSuppressed([]);
                })
                .finally(() => setSearching(false));
        }, 350);
        return () => clearTimeout(handle);
    }, [search, selectedSlug, playgroundFetch]);

    const memberMints = useMemo(() => new Set((tokens ?? []).map(t => t.mint)), [tokens]);

    const handleAddMint = useCallback(
        async (result: SearchResult) => {
            if (!selectedSlug) return;
            setAddingMint(result.mint);
            try {
                const res = await playgroundFetch(`/api/v2/lists/${selectedSlug}/members/${result.mint}`, {
                    method: 'PUT',
                });
                if (!res.ok) {
                    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
                    throw new Error(body?.error?.message ?? `Add failed (HTTP ${res.status})`);
                }
                toast.success(`${result.claims.symbol ?? shortMint(result.mint)} added to ${selectedSlug}`);
                await Promise.all([refreshDetail(), refreshLists()]);
            } catch (error) {
                toast.error(error instanceof Error ? error.message : String(error));
            } finally {
                setAddingMint(null);
            }
        },
        [selectedSlug, playgroundFetch, refreshDetail, refreshLists],
    );

    const handleRemoveMint = useCallback(
        async (token: V2ListToken) => {
            if (!selectedSlug) return;
            const res = await playgroundFetch(`/api/v2/lists/${selectedSlug}/members/${token.mint}`, {
                method: 'DELETE',
            });
            if (!res.ok) {
                const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
                toast.error(body?.error?.message ?? `Remove failed (HTTP ${res.status})`);
                return;
            }
            toast.success(`${token.symbol ?? shortMint(token.mint)} removed`);
            await Promise.all([refreshDetail(), refreshLists()]);
        },
        [selectedSlug, playgroundFetch, refreshDetail, refreshLists],
    );

    // ---- metadata dialog ----
    const [metadataOpen, setMetadataOpen] = useState(false);
    const [metadataMint, setMetadataMint] = useState<string | null>(null);
    const [metadataFallback, setMetadataFallback] = useState<{
        symbol: string | null;
        name: string | null;
        logoURI: string | null;
        verified?: boolean;
    } | null>(null);
    const [metadataJudged, setMetadataJudged] = useState<SearchResult | null>(null);
    const [metadataLoading, setMetadataLoading] = useState(false);

    /** Search rows have the full judged result in hand — open directly. */
    const openMetadataForResult = useCallback((result: SearchResult) => {
        setMetadataMint(result.mint);
        setMetadataFallback({
            symbol: result.claims.symbol,
            name: result.claims.name,
            logoURI: result.market.logoURI,
            verified: result.verified,
        });
        setMetadataJudged(result);
        setMetadataLoading(false);
        setMetadataOpen(true);
    }, []);

    /** Member rows fetch the judged result on open (mint query, degen so gates never hide it). */
    const openMetadataForMember = useCallback(
        (token: V2ListToken) => {
            setMetadataMint(token.mint);
            setMetadataFallback({
                symbol: token.symbol,
                name: token.name,
                logoURI: token.logoURI,
                verified: token.verified,
            });
            setMetadataJudged(null);
            setMetadataLoading(true);
            setMetadataOpen(true);
            void playgroundFetch(`/api/v2/lists/search-tokens?q=${encodeURIComponent(token.mint)}&policy=degen&limit=1`)
                .then(async res => {
                    if (!res.ok) return;
                    const body = (await res.json()) as { results: SearchResult[] };
                    const match = body.results.find(result => result.mint === token.mint) ?? null;
                    setMetadataJudged(match);
                })
                .catch(() => {})
                .finally(() => setMetadataLoading(false));
        },
        [playgroundFetch],
    );

    const selectedList = useMemo(
        () => myLists?.find(list => list.slug === selectedSlug) ?? null,
        [myLists, selectedSlug],
    );

    if (!ready || writeAccess === 'checking') {
        return (
            <div className="space-y-6 container max-w-7xl mx-auto py-16 px-6">
                <div className="mb-6 space-y-2">
                    <Skeleton className="h-9 w-48" />
                    <Skeleton className="h-4 w-[520px] max-w-full" />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-8">
                    <Skeleton className="h-[280px] w-full rounded-[12px]" />
                    <Skeleton className="h-[420px] w-full rounded-[12px]" />
                </div>
            </div>
        );
    }

    if (writeAccess === 'denied') {
        return (
            <div className="space-y-6 container max-w-7xl mx-auto py-16 px-6">
                <div className="mb-6">
                    <h1 className="text-3xl font-bold text-foreground">Token Lists</h1>
                    <p className="text-muted-foreground">
                        Publish curated token lists any app can consume via the v2 API.
                    </p>
                </div>
                <div className="relative z-10 bg-background/80 backdrop-blur-sm rounded-2xl border border-dashed border-black/20 py-12">
                    <EmptyState
                        icon={<IconCircleGridCrossFill className="size-[60px] mb-2 fill-muted-foreground" />}
                        title="List publishing is invite-only"
                        subtitle="Your project's API key doesn't have the lists:write scope yet. Reach out to the Tokens team to request access for your community."
                        className="p-12 w-full sm:w-[480px] mx-auto"
                    />
                    <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.22, ease: 'easeOut' }}
                        className="flex justify-center"
                    >
                        <Button asChild variant="ghost" size="sm" className="rounded-lg">
                            <a href="https://docs.tokens.xyz" target="_blank" rel="noreferrer">
                                Read the lists documentation
                            </a>
                        </Button>
                    </motion.div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 container max-w-7xl mx-auto py-16 px-6">
            <div className="mb-6 flex items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-foreground">Token Lists</h1>
                    <p className="text-muted-foreground">
                        Curate lists of tokens for your community — any app can consume them via the v2 API.
                    </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                    New list
                </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-8 items-start">
                {/* My lists */}
                <div className="space-y-4">
                    <div>
                        <h4 className="font-inter-medium">My lists</h4>
                        <p className="text-sm text-muted-foreground">Published under your project</p>
                    </div>
                    <TableSection columns="grid-cols-1">
                        {myLists === null ? (
                            <div className="px-4 py-3 space-y-3">
                                <Skeleton className="h-4 w-40" />
                                <Skeleton className="h-4 w-32" />
                            </div>
                        ) : myLists.length === 0 ? (
                            <div className="px-4 py-6 text-sm text-muted-foreground text-center">
                                No lists yet — create one to get started.
                            </div>
                        ) : (
                            myLists.map(list => (
                                <button
                                    key={list.slug}
                                    type="button"
                                    onClick={() => setSelectedSlug(list.slug)}
                                    className={`w-full px-4 py-3 text-left border-b last:border-b-0 transition-colors ${
                                        list.slug === selectedSlug
                                            ? 'bg-gray-100/80 dark:bg-zinc-900/60'
                                            : 'hover:bg-gray-50/50'
                                    }`}
                                >
                                    <div className="text-sm font-inter-medium">{list.name}</div>
                                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                                        <span className="font-berkeley-mono">{list.slug}</span>
                                        <span>·</span>
                                        <span>
                                            {list.tokenCount} token{list.tokenCount === 1 ? '' : 's'}
                                        </span>
                                    </div>
                                </button>
                            ))
                        )}
                    </TableSection>
                </div>

                {/* Selected list */}
                <div className="space-y-8">
                    {!selectedList ? (
                        <div className="bg-background/80 backdrop-blur-sm rounded-2xl border border-dashed border-black/20 py-12">
                            <EmptyState
                                icon={<IconCircleGridCrossFill className="size-[48px] mb-2 fill-muted-foreground" />}
                                title={myLists && myLists.length > 0 ? 'Select a list' : 'Create your first list'}
                                subtitle={
                                    myLists && myLists.length > 0
                                        ? 'Pick a list on the left to manage its tokens.'
                                        : 'Lists are served publicly at /api/v2/lists/{slug}.'
                                }
                                className="p-8 w-full sm:w-[420px] mx-auto"
                            />
                        </div>
                    ) : (
                        <>
                            {/* List header */}
                            <div className="flex items-start justify-between gap-4">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-3">
                                        <h2 className="text-xl font-inter-semibold">{selectedList.name}</h2>
                                        <code className="rounded-md bg-gray-100 dark:bg-zinc-900 px-1.5 py-0.5 text-xs text-muted-foreground">
                                            /v2/lists/{selectedList.slug}
                                        </code>
                                    </div>
                                    <p className="text-sm text-muted-foreground">
                                        {selectedList.description ?? 'No description'}
                                    </p>
                                </div>
                                {confirmArchive ? (
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            disabled={archiving}
                                            onClick={() => void handleArchive()}
                                        >
                                            {archiving ? <Spinner size="sm" /> : 'Confirm archive'}
                                        </Button>
                                        <Button variant="ghost" size="sm" onClick={() => setConfirmArchive(false)}>
                                            Cancel
                                        </Button>
                                    </div>
                                ) : (
                                    <Button variant="outline" size="sm" onClick={() => setConfirmArchive(true)}>
                                        Archive list
                                    </Button>
                                )}
                            </div>

                            {/* Curator-assist search */}
                            <div className="space-y-4">
                                <div>
                                    <h4 className="font-inter-medium">Add tokens</h4>
                                    <p className="text-sm text-muted-foreground">
                                        Search by symbol, name, or mint address — results are judged for
                                        impersonation, liquidity, and provenance. Click a row for full metadata.
                                    </p>
                                </div>
                                <Input
                                    value={search}
                                    onChange={event => setSearch(event.target.value)}
                                    placeholder="Search a token to add…"
                                    className="max-w-lg"
                                />
                                {searching && (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Spinner size="sm" /> Judging candidates…
                                    </div>
                                )}
                                {results !== null && !searching && results.length === 0 && (
                                    <p className="text-sm text-muted-foreground">No candidates.</p>
                                )}
                                {results !== null && !searching && results.length > 0 && (
                                    <TableSection
                                        columns={SEARCH_COLUMNS}
                                        header={
                                            <>
                                                <div>Token</div>
                                                <div className="text-right">Score</div>
                                                <div className="text-right">Liquidity</div>
                                                <div>Already in</div>
                                                <div className="text-right">Action</div>
                                            </>
                                        }
                                    >
                                        {results.map(result => {
                                            const isMember = memberMints.has(result.mint);
                                            return (
                                                <div
                                                    key={result.mint}
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={() => openMetadataForResult(result)}
                                                    onKeyDown={event => {
                                                        if (event.key === 'Enter') openMetadataForResult(result);
                                                    }}
                                                    className={`grid ${SEARCH_COLUMNS} gap-4 px-4 py-3 border-b last:border-b-0 cursor-pointer hover:bg-gray-50/50 transition-colors`}
                                                >
                                                    <TokenIdentity
                                                        mint={result.mint}
                                                        symbol={result.claims.symbol}
                                                        name={result.claims.name}
                                                        logoURI={result.market.logoURI}
                                                        verified={result.verified}
                                                    >
                                                        {result.warnings.length > 0 && (
                                                            <div className="mt-1">
                                                                <WarningChips warnings={result.warnings} />
                                                            </div>
                                                        )}
                                                    </TokenIdentity>
                                                    <div className="flex items-center justify-end font-mono text-sm tabular-nums">
                                                        {result.score.total}
                                                    </div>
                                                    <div className="flex items-center justify-end text-sm text-muted-foreground tabular-nums">
                                                        {formatUsd(result.market.liquidityUsd)}
                                                    </div>
                                                    <div className="flex items-center truncate text-xs text-muted-foreground">
                                                        {result.inLists.length > 0 ? result.inLists.join(', ') : '—'}
                                                    </div>
                                                    <div className="flex items-center justify-end">
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            disabled={isMember || addingMint === result.mint}
                                                            onClick={event => {
                                                                event.stopPropagation();
                                                                void handleAddMint(result);
                                                            }}
                                                        >
                                                            {addingMint === result.mint ? (
                                                                <Spinner size="sm" />
                                                            ) : isMember ? (
                                                                'Added'
                                                            ) : (
                                                                'Add'
                                                            )}
                                                        </Button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </TableSection>
                                )}
                                {results !== null && !searching && suppressed.length > 0 && (
                                    <details className="group">
                                        <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors">
                                            {suppressed.length} candidate{suppressed.length === 1 ? '' : 's'} filtered
                                            by policy
                                        </summary>
                                        <div className="mt-3">
                                            <TableSection columns="grid-cols-1">
                                            {suppressed.map(item => (
                                                <div
                                                    key={item.mint}
                                                    className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b last:border-b-0"
                                                >
                                                    <span className="text-sm font-inter-medium">
                                                        {item.symbol ?? shortMint(item.mint)}
                                                    </span>
                                                    <span className="text-xs text-muted-foreground">
                                                        suppressed by {item.suppressedBy.map(humanize).join(', ')}
                                                    </span>
                                                    <WarningChips warnings={item.warnings} />
                                                </div>
                                            ))}
                                            </TableSection>
                                        </div>
                                    </details>
                                )}
                            </div>

                            {/* Members */}
                            <div className="space-y-4">
                                <div>
                                    <h4 className="font-inter-medium">
                                        Tokens{' '}
                                        <span className="text-muted-foreground font-inter">
                                            ({tokens?.length ?? selectedList.tokenCount})
                                        </span>
                                    </h4>
                                    <p className="text-sm text-muted-foreground">
                                        What consumers of this list receive, in rank order — click a row for metadata
                                    </p>
                                </div>
                                {tokens === null ? (
                                    <TableSection columns={MEMBER_COLUMNS}>
                                        {Array.from({ length: 3 }).map((_, index) => (
                                            <div
                                                key={index}
                                                className={`grid ${MEMBER_COLUMNS} gap-4 px-4 py-3 border-b last:border-b-0`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <Skeleton className="h-8 w-8 rounded-full" />
                                                    <Skeleton className="h-4 w-28" />
                                                </div>
                                                <div className="flex items-center">
                                                    <Skeleton className="h-4 w-24" />
                                                </div>
                                                <div className="flex items-center">
                                                    <Skeleton className="h-5 w-20 rounded-full" />
                                                </div>
                                                <div className="flex items-center">
                                                    <Skeleton className="h-4 w-16" />
                                                </div>
                                                <div className="flex items-center justify-end">
                                                    <Skeleton className="h-8 w-8" />
                                                </div>
                                            </div>
                                        ))}
                                    </TableSection>
                                ) : tokens.length === 0 ? (
                                    <div className="bg-background/80 rounded-2xl border border-dashed border-black/20 px-6 py-8 text-center text-sm text-muted-foreground">
                                        Empty list — search above to add the first token.
                                    </div>
                                ) : (
                                    <TableSection
                                        columns={MEMBER_COLUMNS}
                                        header={
                                            <>
                                                <div>Token</div>
                                                <div>Mint</div>
                                                <div>Status</div>
                                                <div>Added</div>
                                                <div className="text-right">Actions</div>
                                            </>
                                        }
                                    >
                                        {tokens.map(token => (
                                            <div
                                                key={token.mint}
                                                role="button"
                                                tabIndex={0}
                                                onClick={() => openMetadataForMember(token)}
                                                onKeyDown={event => {
                                                    if (event.key === 'Enter') openMetadataForMember(token);
                                                }}
                                                className={`grid ${MEMBER_COLUMNS} gap-4 px-4 py-3 border-b last:border-b-0 cursor-pointer hover:bg-gray-50/50 transition-colors`}
                                            >
                                                <TokenIdentity
                                                    mint={token.mint}
                                                    symbol={token.symbol}
                                                    name={token.name}
                                                    logoURI={token.logoURI}
                                                />
                                                <div
                                                    className="flex items-center gap-1"
                                                    onClick={event => event.stopPropagation()}
                                                >
                                                    <span className="font-mono text-xs text-muted-foreground">
                                                        {shortMint(token.mint)}
                                                    </span>
                                                    <CopyButton
                                                        textToCopy={token.mint}
                                                        showText={false}
                                                        ariaLabel={`Copy ${token.symbol ?? token.mint} mint address`}
                                                        className="h-7 w-7 rounded-sm hover:bg-gray-50/60 transition-colors duration-150"
                                                        iconClassName="h-3 w-3 text-muted-foreground"
                                                        iconClassNameCheck="h-3 w-3"
                                                        onCopied={() => toast.success('Mint address copied')}
                                                    />
                                                </div>
                                                <div className="flex items-center">
                                                    <VerifiedBadge verified={token.verified} />
                                                </div>
                                                <div className="flex items-center text-sm text-muted-foreground">
                                                    {formatDate(token.addedAt)}
                                                </div>
                                                <div className="flex items-center justify-end">
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        aria-label={`Remove ${token.symbol ?? token.mint}`}
                                                        className="h-8 w-8 rounded-sm p-0"
                                                        onClick={event => {
                                                            event.stopPropagation();
                                                            void handleRemoveMint(token);
                                                        }}
                                                    >
                                                        <IconTrashFill className="h-3.5 w-3.5 fill-muted-foreground" />
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </TableSection>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>

            <TokenMetadataDialog
                open={metadataOpen}
                onOpenChange={setMetadataOpen}
                mint={metadataMint}
                fallback={metadataFallback}
                judged={metadataJudged}
                loading={metadataLoading}
            />

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create a token list</DialogTitle>
                        <DialogDescription>
                            Consumers pull it from <code className="text-xs">/api/v2/lists/&#123;slug&#125;</code>. The
                            slug is permanent and globally unique — prefix it with your community name.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="list-name">Name</Label>
                            <Input
                                id="list-name"
                                value={createName}
                                onChange={event => {
                                    setCreateName(event.target.value);
                                    if (!slugTouched) setCreateSlug(slugify(event.target.value));
                                }}
                                placeholder="Ownership Core"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="list-slug">Slug</Label>
                            <Input
                                id="list-slug"
                                value={createSlug}
                                onChange={event => {
                                    setSlugTouched(true);
                                    setCreateSlug(event.target.value);
                                }}
                                placeholder="ownership-core"
                                className="font-berkeley-mono"
                            />
                            <p className="text-xs text-muted-foreground">Lowercase letters, numbers, and hyphens.</p>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="list-description">Description (optional)</Label>
                            <Input
                                id="list-description"
                                value={createDescription}
                                onChange={event => setCreateDescription(event.target.value)}
                                placeholder="Tokens curated by the Ownership community"
                            />
                        </div>
                        {createError && (
                            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-sm text-destructive">
                                {createError}
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => void handleCreate()}
                            disabled={creating || !createSlug.trim() || !createName.trim()}
                        >
                            {creating ? <Spinner size="sm" /> : 'Create list'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
