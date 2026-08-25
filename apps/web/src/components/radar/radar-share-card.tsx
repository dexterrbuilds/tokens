'use client';

import Image from 'next/image';
import { Download, Share2 } from 'lucide-react';
import { toPng } from 'html-to-image';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { normalizeLogoSrc } from '@/lib/normalize-logo-src';
import type { RadarAsset } from '@/lib/radar';

function compactUsd(value: number | null | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: 'compact',
        maximumFractionDigits: 2,
    }).format(value);
}

function price(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return 'N/A';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: value < 1 ? 5 : 2,
    }).format(value);
}

function timestamp(value: number | undefined): string {
    if (!value) return 'Latest available snapshot';
    const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value;
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
    }).format(milliseconds);
}

export function RadarShareButton({ asset }: { asset: RadarAsset }) {
    const cardRef = useRef<HTMLDivElement>(null);
    const [busy, setBusy] = useState(false);

    async function downloadCard() {
        const card = cardRef.current;
        if (!card || busy) return;
        setBusy(true);
        try {
            const dataUrl = await toPng(card, {
                width: 1200,
                height: 630,
                pixelRatio: 1,
                cacheBust: true,
                backgroundColor: '#f4f2ea',
            });
            const anchor = document.createElement('a');
            anchor.download = `${asset.symbol.toLowerCase()}-token-radar.png`;
            anchor.href = dataUrl;
            anchor.click();
            toast.success('Radar card downloaded');
        } catch {
            toast.error('Could not generate the radar card');
        } finally {
            setBusy(false);
        }
    }

    const logo = normalizeLogoSrc(asset.logoURI);

    return (
        <>
            <button className="radar-share-button" type="button" onClick={() => void downloadCard()} disabled={busy}>
                {busy ? <Download size={15} /> : <Share2 size={15} />}
                {busy ? 'Rendering…' : 'Share Radar'}
            </button>
            <div className="radar-share-stage" aria-hidden="true">
                <div ref={cardRef} className="radar-share-card">
                    <div className="radar-share-grid" />
                    <header>
                        <span className="radar-share-brand">
                            <i>
                                <Share2 size={20} />
                            </i>{' '}
                            TOKEN <b>RADAR</b>
                        </span>
                        <span>LIVE SOLANA ASSET INTELLIGENCE</span>
                    </header>
                    <div className="radar-share-main">
                        <div className="radar-share-identity">
                            {logo ? (
                                <Image src={logo} alt="" width={86} height={86} unoptimized />
                            ) : (
                                <i>{asset.symbol.slice(0, 2)}</i>
                            )}
                            <div>
                                <h2>{asset.symbol}</h2>
                                <p>{asset.name}</p>
                            </div>
                        </div>
                        <div className="radar-share-score">
                            <span>RADAR SCORE</span>
                            <strong>{asset.radarScore}</strong>
                            <small>/ 100</small>
                        </div>
                    </div>
                    <section>
                        <div>
                            <span>Current price</span>
                            <strong>{price(asset.price)}</strong>
                        </div>
                        <div>
                            <span>24h volume</span>
                            <strong>{compactUsd(asset.volume24hUSD)}</strong>
                        </div>
                        <div>
                            <span>Liquidity</span>
                            <strong>{compactUsd(asset.liquidity)}</strong>
                        </div>
                        <div>
                            <span>Representation tier</span>
                            <strong>{asset.trustLabel}</strong>
                        </div>
                    </section>
                    <footer>
                        <p>{asset.explanation}</p>
                        <span>{timestamp(asset.lastFetchedAt ?? asset.asOf)} · Powered by Tokens</span>
                    </footer>
                </div>
            </div>
        </>
    );
}
