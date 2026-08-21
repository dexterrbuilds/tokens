'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconCircleGridCrossFill } from 'symbols-react';

import { Button } from '@tokens/ui/button';
import { Input } from '@tokens/ui/input';
import { Skeleton } from '@tokens/ui/skeleton';
import { Spinner } from '@tokens/ui/spinner';
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
    verified: boolean;
    rank: number;
    note?: string;
}

interface SearchResult {
    mint: string;
    claims: { symbol: string | null; name: string | null };
    market: { liquidityUsd: number | null; volume24hUsd: number | null; price: number | null };
    score: { total: number };
    reasons: string[];
    warnings: string[];
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

function WarningChips({ warnings }: { warnings: string[] }) {
    if (warnings.length === 0) return null;
    return (
        <span className="flex flex-wrap gap-1">
            {warnings.map(warning => (
                <span
                    key={warning}
                    className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800"
                >
                    {warning.replaceAll('_', ' ')}
                </span>
            ))}
        </span>
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
    const [actionError, setActionError] = useState<string | null>(null);

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
            await refreshLists();
            if (body.list) setSelectedSlug(body.list.slug);
        } catch (error) {
            setCreateError(error instanceof Error ? error.message : String(error));
        } finally {
            setCreating(false);
        }
    }, [playgroundFetch, createSlug, createName, createDescription, refreshLists]);

    const handleArchive = useCallback(async () => {
        if (!selectedSlug) return;
        setActionError(null);
        const res = await playgroundFetch(`/api/v2/lists/${selectedSlug}`, { method: 'DELETE' });
        if (!res.ok) {
            const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
            setActionError(body?.error?.message ?? `Archive failed (HTTP ${res.status})`);
            return;
        }
        setSelectedSlug(null);
        await refreshLists();
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

    const handleAddMint = useCallback(
        async (mint: string) => {
            if (!selectedSlug) return;
            setActionError(null);
            setAddingMint(mint);
            try {
                const res = await playgroundFetch(`/api/v2/lists/${selectedSlug}/members/${mint}`, { method: 'PUT' });
                if (!res.ok) {
                    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
                    throw new Error(body?.error?.message ?? `Add failed (HTTP ${res.status})`);
                }
                await Promise.all([refreshDetail(), refreshLists()]);
            } catch (error) {
                setActionError(error instanceof Error ? error.message : String(error));
            } finally {
                setAddingMint(null);
            }
        },
        [selectedSlug, playgroundFetch, refreshDetail, refreshLists],
    );

    const handleRemoveMint = useCallback(
        async (mint: string) => {
            if (!selectedSlug) return;
            setActionError(null);
            const res = await playgroundFetch(`/api/v2/lists/${selectedSlug}/members/${mint}`, { method: 'DELETE' });
            if (!res.ok) {
                const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
                setActionError(body?.error?.message ?? `Remove failed (HTTP ${res.status})`);
                return;
            }
            await Promise.all([refreshDetail(), refreshLists()]);
        },
        [selectedSlug, playgroundFetch, refreshDetail, refreshLists],
    );

    const selectedList = useMemo(
        () => myLists?.find(list => list.slug === selectedSlug) ?? null,
        [myLists, selectedSlug],
    );

    if (!ready || writeAccess === 'checking') {
        return (
            <div className="space-y-6 container max-w-7xl mx-auto py-16 px-6">
                <Skeleton className="h-9 w-48" />
                <Skeleton className="h-4 w-[520px] max-w-full" />
                <Skeleton className="h-[320px] w-full" />
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
                        Curate lists of tokens for your community — any app can consume them via{' '}
                        <code className="text-xs">GET /v2/lists/&#123;slug&#125;</code>.
                    </p>
                </div>
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                    New list
                </Button>
            </div>

            {actionError && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    {actionError}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-8">
                {/* My lists */}
                <div className="space-y-2">
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">My lists</h2>
                    {myLists === null ? (
                        <Skeleton className="h-24 w-full" />
                    ) : myLists.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            No lists yet — create one to get started.
                        </p>
                    ) : (
                        myLists.map(list => (
                            <button
                                key={list.slug}
                                type="button"
                                onClick={() => setSelectedSlug(list.slug)}
                                className={`w-full rounded-lg border p-3 text-left text-sm transition-colors ${
                                    list.slug === selectedSlug
                                        ? 'border-foreground/40 bg-gray-100/80'
                                        : 'border-black/15 bg-white hover:bg-gray-50'
                                }`}
                            >
                                <div className="font-medium">{list.name}</div>
                                <div className="text-xs text-muted-foreground">
                                    {list.slug} · {list.tokenCount} tokens
                                </div>
                            </button>
                        ))
                    )}
                </div>

                {/* Selected list */}
                <div className="space-y-6">
                    {!selectedList ? (
                        <div className="rounded-2xl border border-dashed border-black/20 p-12 text-center text-sm text-muted-foreground">
                            Select a list to manage its tokens.
                        </div>
                    ) : (
                        <>
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h2 className="text-xl font-semibold">{selectedList.name}</h2>
                                    <p className="text-sm text-muted-foreground">
                                        {selectedList.description ?? 'No description'}
                                    </p>
                                </div>
                                <Button variant="outline" size="sm" onClick={() => void handleArchive()}>
                                    Archive list
                                </Button>
                            </div>

                            {/* Curator-assist search */}
                            <div className="space-y-3">
                                <Input
                                    value={search}
                                    onChange={event => setSearch(event.target.value)}
                                    placeholder="Search a token to add (symbol, name, or mint address)…"
                                />
                                {searching && (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Spinner size="sm" /> Judging candidates…
                                    </div>
                                )}
                                {results !== null && !searching && (
                                    <div className="space-y-2">
                                        {results.length === 0 && (
                                            <p className="text-sm text-muted-foreground">No candidates.</p>
                                        )}
                                        {results.map(result => (
                                            <div
                                                key={result.mint}
                                                className="flex items-center justify-between gap-3 rounded-lg border border-black/15 bg-white p-3"
                                            >
                                                <div className="min-w-0 space-y-1">
                                                    <div className="flex items-center gap-2 text-sm">
                                                        <span className="font-semibold">
                                                            {result.claims.symbol ?? shortMint(result.mint)}
                                                        </span>
                                                        <span className="truncate text-muted-foreground">
                                                            {result.claims.name}
                                                        </span>
                                                        {result.verified ? (
                                                            <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800">
                                                                verified
                                                            </span>
                                                        ) : (
                                                            <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">
                                                                unverified
                                                            </span>
                                                        )}
                                                        <span className="text-[11px] text-muted-foreground">
                                                            score {result.score.total}
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                                        <span>{shortMint(result.mint)}</span>
                                                        <span>liq {formatUsd(result.market.liquidityUsd)}</span>
                                                        <span>vol {formatUsd(result.market.volume24hUsd)}</span>
                                                        {result.inLists.length > 0 && (
                                                            <span>in: {result.inLists.join(', ')}</span>
                                                        )}
                                                    </div>
                                                    <WarningChips warnings={result.warnings} />
                                                </div>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    disabled={addingMint === result.mint}
                                                    onClick={() => void handleAddMint(result.mint)}
                                                >
                                                    {addingMint === result.mint ? <Spinner size="sm" /> : 'Add'}
                                                </Button>
                                            </div>
                                        ))}
                                        {suppressed.length > 0 && (
                                            <details className="rounded-lg border border-black/10 bg-gray-50 p-3 text-sm">
                                                <summary className="cursor-pointer text-muted-foreground">
                                                    {suppressed.length} suppressed candidate
                                                    {suppressed.length === 1 ? '' : 's'} (filtered by policy)
                                                </summary>
                                                <div className="mt-2 space-y-2">
                                                    {suppressed.map(item => (
                                                        <div key={item.mint} className="flex flex-wrap items-center gap-2">
                                                            <span className="font-medium">
                                                                {item.symbol ?? shortMint(item.mint)}
                                                            </span>
                                                            <span className="text-xs text-muted-foreground">
                                                                suppressed by: {item.suppressedBy.join(', ')}
                                                            </span>
                                                            <WarningChips warnings={item.warnings} />
                                                        </div>
                                                    ))}
                                                </div>
                                            </details>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Members */}
                            <div className="space-y-2">
                                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                                    Tokens ({tokens?.length ?? selectedList.tokenCount})
                                </h3>
                                {tokens === null ? (
                                    <Skeleton className="h-32 w-full" />
                                ) : tokens.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">
                                        Empty list — search above to add the first token.
                                    </p>
                                ) : (
                                    <div className="divide-y divide-black/10 rounded-lg border border-black/15 bg-white">
                                        {tokens.map(token => (
                                            <div
                                                key={token.mint}
                                                className="flex items-center justify-between gap-3 p-3 text-sm"
                                            >
                                                <div className="flex min-w-0 items-center gap-2">
                                                    <span className="font-semibold">
                                                        {token.symbol ?? shortMint(token.mint)}
                                                    </span>
                                                    <span className="truncate text-muted-foreground">{token.name}</span>
                                                    {!token.verified && (
                                                        <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">
                                                            unverified
                                                        </span>
                                                    )}
                                                    <span className="text-[11px] text-muted-foreground">
                                                        {shortMint(token.mint)}
                                                    </span>
                                                </div>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => void handleRemoveMint(token.mint)}
                                                >
                                                    Remove
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create a token list</DialogTitle>
                        <DialogDescription>
                            The slug is permanent and globally unique — prefix it with your community name (e.g.
                            ownership-core).
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <Input
                            value={createSlug}
                            onChange={event => setCreateSlug(event.target.value)}
                            placeholder="slug (lowercase, hyphens)"
                        />
                        <Input
                            value={createName}
                            onChange={event => setCreateName(event.target.value)}
                            placeholder="Display name"
                        />
                        <Input
                            value={createDescription}
                            onChange={event => setCreateDescription(event.target.value)}
                            placeholder="Description (optional)"
                        />
                        {createError && <p className="text-sm text-destructive">{createError}</p>}
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={() => void handleCreate()}
                            disabled={creating || !createSlug.trim() || !createName.trim()}
                        >
                            {creating ? <Spinner size="sm" /> : 'Create'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
