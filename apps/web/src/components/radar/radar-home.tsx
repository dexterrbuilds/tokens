'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowUpRight, Command, Radio, RefreshCw, Search, ShieldCheck, Waves } from 'lucide-react';

import { FloatingMarketFeedPageContext } from '@/components/floating-market-feed-context';
import { useTrendingTokens } from '@/hooks/queries/use-token-search';
import { normalizeLogoSrc } from '@/lib/normalize-logo-src';
import { createRadarSnapshot, type RadarAsset, type RadarSignal } from '@/lib/radar';

type RadarDotStyle = CSSProperties & { '--radar-x': string; '--radar-y': string; '--radar-size': string };

function compactUsd(value: number | null | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: 'compact',
        maximumFractionDigits: 1,
    }).format(value);
}

function price(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return 'N/A';
    if (value < 0.01) return `$${value.toPrecision(3)}`;
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: value >= 100 ? 0 : 2,
    }).format(value);
}

function percent(value: number | null | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A';
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function assetHref(asset: RadarAsset): string {
    return `/${encodeURIComponent(asset.assetId?.trim() || asset.address)}`;
}

function hash(value: string): number {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        result ^= value.charCodeAt(index);
        result = Math.imul(result, 16777619);
    }
    return result >>> 0;
}

function dotStyle(asset: RadarAsset, index: number): RadarDotStyle {
    const identity = asset.assetId?.trim() || asset.address;
    const seed = hash(identity);
    const angle = ((seed % 360) * Math.PI) / 180;
    const ring = 18 + ((seed >>> 9) % 27) + index * 1.1;
    const radius = Math.min(ring, 45);
    const x = 50 + Math.cos(angle) * radius;
    const y = 50 + Math.sin(angle) * radius;
    const size = 7 + Math.min(13, Math.max(0, Math.log10(Math.max(asset.volume1hUSD ?? 1, 1)) * 1.6));
    return { '--radar-x': `${x}%`, '--radar-y': `${y}%`, '--radar-size': `${size}px` };
}

function AssetLogo({ asset, size = 32 }: { asset: RadarAsset; size?: number }) {
    const [failed, setFailed] = useState(false);
    const source = normalizeLogoSrc(asset.logoURI);
    if (!source || failed) {
        return (
            <span className="radar-logo-fallback" style={{ width: size, height: size }} aria-hidden="true">
                {asset.symbol.slice(0, 2)}
            </span>
        );
    }
    return (
        <Image
            src={source}
            alt=""
            width={size}
            height={size}
            className="radar-token-logo"
            onError={() => setFailed(true)}
            unoptimized
        />
    );
}

function RadarField({ assets }: { assets: RadarAsset[] }) {
    const [activeId, setActiveId] = useState<string | null>(null);
    const active = assets.find(asset => (asset.assetId?.trim() || asset.address) === activeId) ?? assets[0] ?? null;

    return (
        <div className="radar-field-shell" aria-label="Live market activity radar">
            <div className="radar-field">
                <div className="radar-sweep" aria-hidden="true" />
                <div className="radar-crosshair" aria-hidden="true" />
                {assets.slice(0, 14).map((asset, index) => {
                    const id = asset.assetId?.trim() || asset.address;
                    return (
                        <Link
                            key={id}
                            href={assetHref(asset)}
                            className={`radar-dot ${activeId === id ? 'is-active' : ''}`}
                            style={dotStyle(asset, index)}
                            onMouseEnter={() => setActiveId(id)}
                            onFocus={() => setActiveId(id)}
                            aria-label={`${asset.symbol}, radar score ${asset.radarScore}`}
                        >
                            <span />
                        </Link>
                    );
                })}
                <div className="radar-origin" aria-hidden="true">
                    <Radio size={18} />
                </div>
            </div>
            {active ? (
                <Link href={assetHref(active)} className="radar-lock-card">
                    <span className="radar-eyebrow">Target locked</span>
                    <span className="radar-lock-line">
                        <AssetLogo asset={active} size={30} />
                        <strong>{active.symbol}</strong>
                        <span>{active.radarScore}</span>
                    </span>
                    <span className="radar-lock-meta">
                        {percent(active.priceChange1hPercent)} · {compactUsd(active.volume1hUSD)} / 1h
                    </span>
                </Link>
            ) : null}
        </div>
    );
}

function MetricBar({ value }: { value: number }) {
    return (
        <span className="radar-mini-bar" aria-label={`${value} out of 100`}>
            <span style={{ width: `${value}%` }} />
        </span>
    );
}

type LaneMetric = 'score' | 'volume' | 'liquidity' | 'momentum' | 'trust';

function AssetRow({ asset, metric }: { asset: RadarAsset; metric: LaneMetric }) {
    const metricValue =
        metric === 'score'
            ? `${asset.radarScore}`
            : metric === 'volume'
              ? asset.volumeAccelerationRatio
                  ? `${asset.volumeAccelerationRatio.toFixed(1)}×`
                  : 'N/A'
              : metric === 'liquidity'
                ? compactUsd(asset.liquidity)
                : metric === 'momentum'
                  ? percent(asset.priceChange1hPercent)
                  : asset.trustLabel;
    const barValue =
        metric === 'score'
            ? asset.radarScore
            : metric === 'volume'
              ? asset.scoreComponents.volumeAcceleration
              : metric === 'liquidity'
                ? asset.scoreComponents.liquidity
                : metric === 'momentum'
                  ? asset.scoreComponents.priceMovement
                  : asset.scoreComponents.trust;

    return (
        <Link href={assetHref(asset)} className="radar-asset-row">
            <AssetLogo asset={asset} size={30} />
            <span className="radar-asset-identity">
                <strong>{asset.symbol}</strong>
                <small>{asset.name}</small>
            </span>
            <span className="radar-row-meter">
                <b>{metricValue}</b>
                <MetricBar value={barValue} />
            </span>
            <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
    );
}

function Lane({
    title,
    note,
    assets,
    metric,
}: {
    title: string;
    note: string;
    assets: RadarAsset[];
    metric: LaneMetric;
}) {
    return (
        <section className="radar-lane">
            <header>
                <div>
                    <span>{title}</span>
                    <p>{note}</p>
                </div>
                <b>{String(assets.length).padStart(2, '0')}</b>
            </header>
            <div>
                {assets.length > 0 ? (
                    assets
                        .slice(0, 5)
                        .map(asset => <AssetRow key={asset.assetId ?? asset.address} asset={asset} metric={metric} />)
                ) : (
                    <div className="radar-lane-empty">No asset crosses this signal threshold right now.</div>
                )}
            </div>
        </section>
    );
}

function formatSignalTime(timestamp: number | null): string {
    if (!timestamp) return 'N/A';
    return new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).format(timestamp);
}

function SignalFeed({ signals }: { signals: RadarSignal[] }) {
    return (
        <section className="radar-signal-feed" id="signals">
            <header>
                <div>
                    <span className="radar-eyebrow">Snapshot signals</span>
                    <h2>What just happened?</h2>
                </div>
                <p>Derived from reported short-window metrics. No generated narratives, no inferred trades.</p>
            </header>
            <div className="radar-signal-list">
                {signals.length > 0 ? (
                    signals.map(signal => (
                        <Link href={`/${encodeURIComponent(signal.assetId)}`} key={signal.id} className="radar-signal">
                            <time>{formatSignalTime(signal.timestamp)}</time>
                            <span className={`radar-signal-pip is-${signal.tone}`} />
                            <strong>{signal.symbol}</strong>
                            <span>{signal.label}</span>
                            <small>{signal.detail}</small>
                        </Link>
                    ))
                ) : (
                    <div className="radar-signal-empty">
                        The feed is quiet. Thresholds remain fixed until real metrics cross them.
                    </div>
                )}
            </div>
        </section>
    );
}

function LoadingRadar() {
    return (
        <main className="radar-page radar-loading" aria-busy="true">
            <div className="radar-loading-orbit">
                <Radio />
            </div>
            <p>Calibrating market signals…</p>
            <span>Pulling live activity, volume, liquidity, and price movement.</span>
        </main>
    );
}

export function RadarHome() {
    const { data = [], isLoading, error, refetch, isFetching } = useTrendingTokens({ mode: 'fresh' });
    const [query, setQuery] = useState('');
    const searchRef = useRef<HTMLInputElement>(null);
    const snapshot = useMemo(() => createRadarSnapshot(data), [data]);
    const filtered = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return snapshot.movingNow;
        return snapshot.assets
            .filter(asset => `${asset.symbol} ${asset.name} ${asset.assetId ?? ''}`.toLowerCase().includes(normalized))
            .slice(0, 8);
    }, [query, snapshot]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === '/' && document.activeElement !== searchRef.current) {
                event.preventDefault();
                searchRef.current?.focus();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    if (isLoading && data.length === 0) return <LoadingRadar />;

    const latestTimestamp = snapshot.assets.reduce((latest, asset) => Math.max(latest, asset.lastFetchedAt ?? 0), 0);
    const totalVolume = snapshot.assets.reduce((sum, asset) => sum + (asset.volume24hUSD || 0), 0);
    const totalLiquidity = snapshot.assets.reduce((sum, asset) => sum + (asset.liquidity || 0), 0);
    const positive = snapshot.assets.filter(asset => (asset.priceChange1hPercent ?? 0) > 0).length;
    const positiveShare = snapshot.assets.length > 0 ? Math.round((positive / snapshot.assets.length) * 100) : 0;

    return (
        <main className="radar-page">
            <FloatingMarketFeedPageContext displayName="Token Radar" suppressFeed />
            <nav className="radar-nav" aria-label="Token Radar navigation">
                <Link href="/" className="radar-wordmark" aria-label="Token Radar home">
                    <span className="radar-wordmark-mark">
                        <Radio size={18} />
                    </span>
                    <span>TOKEN</span>
                    <b>RADAR</b>
                </Link>
                <div className="radar-nav-links">
                    <a href="#movement">Movement</a>
                    <a href="#signals">Signals</a>
                    <a href="#method">Method</a>
                </div>
                <div className="radar-search">
                    <Search size={15} aria-hidden="true" />
                    <input
                        ref={searchRef}
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        placeholder="Find a signal"
                        aria-label="Find an asset"
                    />
                    <kbd>/</kbd>
                </div>
            </nav>

            <section className="radar-hero" id="movement">
                <div className="radar-hero-copy">
                    <span className="radar-live-label">
                        <i /> Live Solana asset intelligence
                    </span>
                    <h1>
                        See the market
                        <br />
                        before the headline.
                    </h1>
                    <p>
                        Tokenized assets are always moving. Radar turns live activity into a field of signals without
                        pretending noise is advice.
                    </p>
                    <div className="radar-hero-meta">
                        <button type="button" onClick={() => void refetch()} disabled={isFetching}>
                            <RefreshCw size={14} className={isFetching ? 'is-spinning' : ''} />
                            Refresh sweep
                        </button>
                        <span>
                            {latestTimestamp
                                ? `Updated ${new Intl.DateTimeFormat('en-US', {
                                      hour: 'numeric',
                                      minute: '2-digit',
                                      second: '2-digit',
                                  }).format(latestTimestamp)}`
                                : 'Awaiting timestamp'}
                        </span>
                    </div>
                </div>
                <RadarField assets={filtered} />
                <aside className="radar-scoreboard">
                    <header>
                        <span>Moving now</span>
                        <b>RADAR / 01</b>
                    </header>
                    {filtered.slice(0, 6).map((asset, index) => (
                        <Link href={assetHref(asset)} key={asset.assetId ?? asset.address}>
                            <span>{String(index + 1).padStart(2, '0')}</span>
                            <strong>{asset.symbol}</strong>
                            <small>{price(asset.price)}</small>
                            <b className={(asset.priceChange1hPercent ?? 0) >= 0 ? 'is-positive' : 'is-negative'}>
                                {percent(asset.priceChange1hPercent)}
                            </b>
                            <em>{asset.radarScore}</em>
                        </Link>
                    ))}
                </aside>
            </section>

            {error ? (
                <section className="radar-error" role="alert">
                    <Radio size={28} />
                    <div>
                        <strong>Live sweep unavailable</strong>
                        <p>
                            The radar could not reach the Tokens data proxy. Check the server-side API origin and key.
                        </p>
                    </div>
                    <button type="button" onClick={() => void refetch()}>
                        Try again
                    </button>
                </section>
            ) : null}

            <section className="radar-pulse" aria-label="Market pulse">
                <div>
                    <span>
                        <Waves size={16} /> Market pulse
                    </span>
                    <strong>{snapshot.assets.length}</strong>
                    <small>active assets sampled</small>
                </div>
                <div>
                    <span>24h on-chain volume</span>
                    <strong>{compactUsd(totalVolume)}</strong>
                    <small>across this live sample</small>
                </div>
                <div>
                    <span>Current liquidity</span>
                    <strong>{compactUsd(totalLiquidity)}</strong>
                    <small>latest reported snapshots</small>
                </div>
                <div>
                    <span>Positive 1h breadth</span>
                    <strong>{positiveShare}%</strong>
                    <small>
                        {positive} of {snapshot.assets.length} reporting
                    </small>
                </div>
            </section>

            <section className="radar-lanes" aria-label="Live market categories">
                <Lane
                    title="⚡ Volume spikes"
                    note="1h pace vs 24h hourly baseline"
                    assets={snapshot.volumeSpikes}
                    metric="volume"
                />
                <Lane
                    title="🟢 Momentum"
                    note="strongest positive reported 1h move"
                    assets={snapshot.momentum}
                    metric="momentum"
                />
                <Lane
                    title="💧 Liquidity beacons"
                    note="deepest current on-chain snapshots"
                    assets={snapshot.liquidityBeacons}
                    metric="liquidity"
                />
                <Lane
                    title="🔴 Cooling"
                    note="negative price or sub-baseline volume"
                    assets={snapshot.cooling}
                    metric="momentum"
                />
                <Lane
                    title="🛡 Representation tier"
                    note="highest-tier representations active now"
                    assets={snapshot.trusted}
                    metric="trust"
                />
                <Lane
                    title="🔥 Moving now"
                    note="highest transparent activity score"
                    assets={snapshot.movingNow}
                    metric="score"
                />
            </section>

            <SignalFeed signals={snapshot.signals} />

            <section className="radar-method" id="method">
                <div>
                    <span className="radar-eyebrow">A score you can open</span>
                    <h2>Five inputs. Zero mystery.</h2>
                    <p>Radar Score measures notable activity, not quality, value, or what anyone should do next.</p>
                </div>
                <ol>
                    <li>
                        <b>30%</b>
                        <span>Activity</span>
                        <small>1h volume, trades, unique wallets</small>
                    </li>
                    <li>
                        <b>25%</b>
                        <span>Acceleration</span>
                        <small>1h pace vs 24h hourly baseline</small>
                    </li>
                    <li>
                        <b>20%</b>
                        <span>Liquidity</span>
                        <small>current reported on-chain depth</small>
                    </li>
                    <li>
                        <b>15%</b>
                        <span>Movement</span>
                        <small>absolute reported 1h price change</small>
                    </li>
                    <li>
                        <b>10%</b>
                        <span>Trust</span>
                        <small>Tokens registry representation tier</small>
                    </li>
                </ol>
                <div className="radar-method-note">
                    <ShieldCheck size={18} />
                    <p>
                        Representation tier is liquidity-derived market context, not a security audit. Radar is analytics, not financial
                        advice.
                    </p>
                </div>
            </section>

            <footer className="radar-footer">
                <span>Data provided by Tokens</span>
                <p>Built on the Solana Foundation Tokens registry.</p>
                <a href="https://docs.tokens.xyz" target="_blank" rel="noreferrer">
                    API docs <ArrowUpRight size={14} />
                </a>
                <span className="radar-shortcut">
                    <Command size={13} /> / to search
                </span>
            </footer>
        </main>
    );
}
