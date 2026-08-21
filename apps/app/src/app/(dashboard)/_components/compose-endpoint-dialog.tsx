'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@tokens/ui/badge';
import { Button } from '@tokens/ui/button';
import { Checkbox } from '@tokens/ui/checkbox';
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

import { SectionHeading, type PlaygroundFetcher } from './token-bits';

/** The compose API unions at most this many lists per call. */
const MAX_COMPOSED_LISTS = 10;

const PUBLIC_API_ORIGIN = 'https://api.tokens.xyz';

export interface ComposableList {
    slug: string;
    name: string;
    curated: boolean;
    ownedByMe: boolean;
    tokenCount: number;
}

/**
 * Endpoint builder over GET /v2/lists/tokens: check up to ten lists — yours,
 * curated, anyone's — and walk away with the composed URL. Nothing is
 * persisted; the URL is the product.
 */
export function ComposeEndpointDialog({
    open,
    onOpenChange,
    lists,
    playgroundFetch,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    lists: ComposableList[];
    playgroundFetch: PlaygroundFetcher;
}) {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [unionTotal, setUnionTotal] = useState<number | null>(null);
    const [previewing, setPreviewing] = useState(false);

    useEffect(() => {
        if (!open) {
            setSelected(new Set());
            setUnionTotal(null);
        }
    }, [open]);

    const slugs = useMemo(
        // Catalog order keeps the query readable (curated first).
        () => lists.filter(list => selected.has(list.slug)).map(list => list.slug),
        [lists, selected],
    );
    const atCap = slugs.length >= MAX_COMPOSED_LISTS;

    const composePath = slugs.length > 0 ? `/api/v2/lists/tokens?lists=${slugs.join(',')}` : null;
    const composeUrl = composePath ? `${PUBLIC_API_ORIGIN}${composePath}` : null;

    // Live union size: the compose response's `total` is the deduped union
    // across the checked lists. Best-effort — the URL works regardless.
    useEffect(() => {
        if (!open || slugs.length === 0) {
            setUnionTotal(null);
            return;
        }
        let cancelled = false;
        setPreviewing(true);
        const handle = setTimeout(() => {
            void playgroundFetch(`/api/v2/lists/tokens?lists=${encodeURIComponent(slugs.join(','))}&limit=1`)
                .then(async res => {
                    if (!res.ok) return;
                    const body = (await res.json()) as { total?: number };
                    if (!cancelled && typeof body.total === 'number') setUnionTotal(body.total);
                })
                .catch(() => {})
                .finally(() => {
                    if (!cancelled) setPreviewing(false);
                });
        }, 300);
        return () => {
            cancelled = true;
            clearTimeout(handle);
            setPreviewing(false);
        };
    }, [open, slugs, playgroundFetch]);

    const toggle = (slug: string, checked: boolean) => {
        setSelected(previous => {
            const next = new Set(previous);
            if (checked) next.add(slug);
            else next.delete(slug);
            return next;
        });
    };

    const groups: Array<{ heading: string; items: ComposableList[] }> = [
        { heading: 'My lists', items: lists.filter(list => list.ownedByMe) },
        { heading: 'Curated', items: lists.filter(list => list.curated) },
        { heading: 'Community', items: lists.filter(list => !list.ownedByMe && !list.curated) },
    ];

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Compose an endpoint</DialogTitle>
                    <DialogDescription>
                        Pick up to {MAX_COMPOSED_LISTS} lists — the composed URL returns their union, deduped by
                        mint, with each token tagged by the lists that contain it.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {groups.map(group =>
                        group.items.length === 0 ? null : (
                            <div key={group.heading} className="space-y-1.5">
                                <SectionHeading>{group.heading}</SectionHeading>
                                {group.items.map(list => {
                                    const checked = selected.has(list.slug);
                                    return (
                                        <label
                                            key={list.slug}
                                            className={`flex cursor-pointer items-center gap-3 rounded-lg border border-black/[0.12] bg-white px-3 py-2 shadow-sm transition-colors hover:bg-gray-50/60 dark:border-white/10 dark:bg-zinc-950/30 dark:hover:bg-zinc-900/40 ${
                                                !checked && atCap ? 'cursor-not-allowed opacity-50' : ''
                                            }`}
                                        >
                                            <Checkbox
                                                checked={checked}
                                                disabled={!checked && atCap}
                                                onCheckedChange={value => toggle(list.slug, value === true)}
                                                aria-label={`Include ${list.name}`}
                                            />
                                            <span className="min-w-0 flex-1 truncate text-sm font-inter-medium">
                                                {list.name}
                                            </span>
                                            <code className="shrink-0 font-berkeley-mono text-xs text-muted-foreground">
                                                {list.slug}
                                            </code>
                                            <Badge
                                                variant="secondary"
                                                className="shrink-0 px-1.5 font-berkeley-mono text-[10px]"
                                            >
                                                {list.tokenCount}
                                            </Badge>
                                        </label>
                                    );
                                })}
                            </div>
                        ),
                    )}

                    {atCap && (
                        <p className="text-xs text-muted-foreground">
                            {MAX_COMPOSED_LISTS} lists max — the compose API caps each call.
                        </p>
                    )}

                    {/* The product: a copyable endpoint */}
                    <div className="rounded-lg border border-border-medium bg-gray-50/80 dark:bg-zinc-900/40 p-3">
                        <SectionHeading>Your endpoint</SectionHeading>
                        {composeUrl && composePath ? (
                            <>
                                <div className="mt-2 flex items-center justify-between gap-2">
                                    <code className="min-w-0 flex-1 break-all font-berkeley-mono text-xs text-foreground">
                                        {composePath}
                                    </code>
                                    <CopyButton
                                        textToCopy={composeUrl}
                                        showText={false}
                                        ariaLabel="Copy composed endpoint URL"
                                        className="h-7 w-7 shrink-0 rounded-sm hover:bg-black/[0.06] transition-colors duration-150"
                                        iconClassName="h-3.5 w-3.5 text-muted-foreground"
                                        iconClassNameCheck="h-3.5 w-3.5"
                                        onCopied={() => toast.success('Endpoint URL copied')}
                                    />
                                </div>
                                <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                                    {previewing ? (
                                        <>
                                            <Spinner size="sm" /> Sizing the union…
                                        </>
                                    ) : unionTotal !== null ? (
                                        <>
                                            {unionTotal.toLocaleString()} token{unionTotal === 1 ? '' : 's'} across{' '}
                                            {slugs.length} list{slugs.length === 1 ? '' : 's'} (deduped)
                                        </>
                                    ) : null}
                                </div>
                            </>
                        ) : (
                            <p className="mt-2 text-sm text-muted-foreground">
                                Check at least one list to build the URL.
                            </p>
                        )}
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Done
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
