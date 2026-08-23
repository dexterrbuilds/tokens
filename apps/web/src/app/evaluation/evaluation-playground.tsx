'use client';

import * as React from 'react';
import { Search } from 'lucide-react';

import { listAssets } from '@tokens/asset-registry';
import { Input } from '@tokens/ui/input';

import { ExecutionEvaluationCard } from '@/app/[name]/components/execution-evaluation-card';

const QUICK_PICKS = ['bitcoin', 'ethereum', 'solana', 'hyperliquid', 'zcash', 'gold'];

interface AssetOption {
    assetId: string;
    label: string;
}

function buildAssetOptions(): AssetOption[] {
    return listAssets()
        .filter(asset => asset.variants.length > 0)
        .map(asset => ({
            assetId: asset.assetId,
            label: [asset.symbol, asset.name].filter(Boolean).join(' · '),
        }))
        .sort((a, b) => a.assetId.localeCompare(b.assetId));
}

/**
 * Internal playground for GET /v2/execution/evaluate: pick an asset, then the
 * card handles everything else — the graded depth scorecard, on-demand
 * sampling for uncovered assets, and live quotes for a typed amount.
 */
export function EvaluationPlayground() {
    const [query, setQuery] = React.useState('');
    const [assetId, setAssetId] = React.useState('bitcoin');
    const options = React.useMemo(buildAssetOptions, []);

    function submit(raw: string) {
        const next = raw.trim().toLowerCase();
        if (next) setAssetId(next);
    }

    return (
        <main className="flex min-h-screen justify-center bg-[#FAFAFA] px-4 py-16">
            <div className="w-full max-w-2xl space-y-6">
                <header className="text-center">
                    <h1 className="text-title-lg text-text-extra-high">Execution evaluation</h1>
                    <p className="mt-2 text-body-md text-text-medium">
                        How good is a trade of size $X in this asset right now? Pick an asset, then set a size in
                        the card. Internal demo for <code className="text-[12px]">/v2/execution/evaluate</code>.
                    </p>
                </header>

                <section className="rounded-2xl border border-border-light bg-white p-4 shadow-[0_8px_40px_rgba(0,0,0,0.03)]">
                    <label htmlFor="evaluation-asset" className="mb-2 block text-[11px] font-normal text-text-medium">
                        Asset (id, alias, or Solana mint)
                    </label>
                    <div className="relative">
                        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-text-extra-low" />
                        <Input
                            id="evaluation-asset"
                            list="evaluation-asset-options"
                            placeholder="bitcoin"
                            className="pl-9"
                            value={query}
                            onChange={event => {
                                setQuery(event.target.value);
                                // Datalist picks land as a full change event; commit
                                // immediately when the value matches a known asset.
                                if (options.some(option => option.assetId === event.target.value.trim().toLowerCase())) {
                                    submit(event.target.value);
                                }
                            }}
                            onKeyDown={event => {
                                if (event.key === 'Enter') submit(query);
                            }}
                        />
                        <datalist id="evaluation-asset-options">
                            {options.map(option => (
                                <option key={option.assetId} value={option.assetId}>
                                    {option.label}
                                </option>
                            ))}
                        </datalist>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                        {QUICK_PICKS.map(pick => (
                            <button
                                key={pick}
                                type="button"
                                onClick={() => {
                                    setQuery(pick);
                                    setAssetId(pick);
                                }}
                                className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
                                    assetId === pick
                                        ? 'border-text-extra-high bg-text-extra-high text-white'
                                        : 'border-border-light bg-white text-text-medium hover:border-text-low'
                                }`}
                            >
                                {pick}
                            </button>
                        ))}
                    </div>
                </section>

                <ExecutionEvaluationCard key={assetId} assetId={assetId} activeMint={null} verbose />
            </div>
        </main>
    );
}
