'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Effect } from 'effect';
import { ArrowLeft, ArrowUpRight, CircleDot, Clock3, ExternalLink, Radio, ShieldCheck, Waves } from 'lucide-react';

import { FloatingMarketFeedPageContext } from '@/components/floating-market-feed-context';
import { useAssetPriceChart } from '@/hooks/queries/use-asset-price-chart';
import { apiJson } from '@/effect/api-client';
import type { OHLCVData } from '@/lib/birdeye';
import { normalizeLogoSrc } from '@/lib/normalize-logo-src';
import { createRadarSnapshot, type RadarAsset } from '@/lib/radar';
import type { Token } from '@/lib/types';
import type { AssetVariant, CanonicalAsset, LiquidityTier, TrustTier } from '@tokens/asset-registry';

import { RadarShareButton } from './radar-share-card';

interface MarketSnapshot {
    source?: 'birdeye' | 'rwa_xyz' | 'clickhouse_trades';
    metricsSource?: 'birdeye' | 'rwa_xyz' | 'clickhouse_trades';
    price: number | null;
    liquidity: number | null;
    volume1hUSD?: number | null;
    volume24hUSD: number | null;
    trade1h?: number | null;
    trade24h?: number | null;
    uniqueWallet1h?: number | null;
    uniqueWallet24h?: number | null;
    marketCap?: number | null;
    priceChange24hPercent: number | null;
    priceChange1hPercent: number | null;
    logoURI: string | null;
    lastTradeAt?: number | null;
    asOf?: number | null;
    lastFetchedAt?: number | null;
    symbol?: string;
    name?: string;
}

type ApiVariant = AssetVariant & {
    liquidityTier?: LiquidityTier;
    market?: MarketSnapshot | null;
};

interface AssetDetailResponse {
    asset: {
        assetId: string;
        name?: string;
        symbol?: string;
        category?: CanonicalAsset['category'];
        imageUrl?: string | null;
        stats?: {
            price: number | null;
            liquidity: number | null;
            volume24hUSD: number | null;
            priceChange24hPercent: number | null;
            priceChange1hPercent: number | null;
        } | null;
        canonicalMarket?: {
            price: number | null;
            volume24hUSD: number | null;
            priceChange24hPercent: number | null;
        } | null;
        primaryVariant: ApiVariant | null;
        variantGroups: Partial<
            Record<'spot' | 'etf' | 'yield' | 'leveraged' | 'basket' | 'lst' | 'tokenizedEquity', ApiVariant[]>
        >;
    };
}

interface TokenMarket {
    address: string;
    name?: string;
    source?: string;
    liquidity?: number;
    volume24h?: number;
}

interface VariantTopMarketsResponse {
    variants: Array<{
        mint: string;
        topMarket: TokenMarket | null;
        topMarkets?: Array<{ market: TokenMarket }>;
    }>;
}

function finite(value: number | null | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function compactUsd(value: number | null | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 'N/A';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: 'compact',
        maximumFractionDigits: 2,
    }).format(value);
}

function price(value: number | null | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 'N/A';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: value < 1 ? 6 : 2,
    }).format(value);
}

function percent(value: number | null | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A';
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function tapeTimestamp(value: number): string {
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(value * 1000);
}

function getApiVariants(detail: AssetDetailResponse | undefined, fallback: CanonicalAsset): ApiVariant[] {
    if (!detail) return fallback.variants;
    const groups = detail.asset.variantGroups;
    const rows = [
        ...(groups.spot ?? []),
        ...(groups.etf ?? []),
        ...(groups.yield ?? []),
        ...(groups.leveraged ?? []),
        ...(groups.basket ?? []),
        ...(groups.lst ?? []),
        ...(groups.tokenizedEquity ?? []),
    ];
    const byMint = new Map<string, ApiVariant>();
    for (const variant of [...fallback.variants, ...rows]) byMint.set(variant.mint, variant);
    return Array.from(byMint.values());
}

function toRadarAsset(detail: AssetDetailResponse | undefined, fallback: CanonicalAsset): RadarAsset {
    const api = detail?.asset;
    const primary = (api?.primaryVariant ?? fallback.variants[0] ?? null) as ApiVariant | null;
    const market = primary?.market ?? null;
    const stats = api?.stats ?? null;
    const canonical = api?.canonicalMarket ?? null;
    const token: Token = {
        assetId: api?.assetId ?? fallback.assetId,
        address: primary?.mint ?? fallback.assetId,
        name: api?.name ?? fallback.name ?? primary?.name ?? primary?.label ?? fallback.assetId,
        symbol: api?.symbol ?? fallback.symbol ?? primary?.symbol ?? primary?.label ?? 'N/A',
        category: api?.category ?? fallback.category,
        decimals: 9,
        logoURI: api?.imageUrl ?? market?.logoURI ?? undefined,
        price: finite(canonical?.price) || finite(stats?.price) || finite(market?.price),
        liquidity: finite(stats?.liquidity) || finite(market?.liquidity),
        volume1hUSD: market?.volume1hUSD ?? undefined,
        volume24hUSD: finite(stats?.volume24hUSD) || finite(market?.volume24hUSD) || finite(canonical?.volume24hUSD),
        trade1h: market?.trade1h ?? undefined,
        trade24h: market?.trade24h ?? undefined,
        uniqueWallet1h: market?.uniqueWallet1h ?? undefined,
        uniqueWallet24h: market?.uniqueWallet24h ?? undefined,
        priceChange1hPercent: stats?.priceChange1hPercent ?? market?.priceChange1hPercent ?? undefined,
        priceChange24hPercent:
            stats?.priceChange24hPercent ?? market?.priceChange24hPercent ?? canonical?.priceChange24hPercent ?? 0,
        marketCap: finite(market?.marketCap),
        lastTradeAt: market?.lastTradeAt ?? undefined,
        asOf: market?.asOf ?? undefined,
        lastFetchedAt: market?.lastFetchedAt ?? undefined,
    };
    return createRadarSnapshot([token]).assets[0]!;
}

function metricLabel(value: number): 'LOW' | 'MED' | 'HIGH' {
    if (value >= 70) return 'HIGH';
    if (value >= 40) return 'MED';
    return 'LOW';
}

function ScoreBreakdown({ asset }: { asset: RadarAsset }) {
    const rows = [
        ['Activity', asset.scoreComponents.activity],
        ['Volume acceleration', asset.scoreComponents.volumeAcceleration],
        ['Liquidity', asset.scoreComponents.liquidity],
        ['Price movement', asset.scoreComponents.priceMovement],
        ['Representation tier', asset.scoreComponents.trust],
    ] as const;
    return (
        <section className="radar-detail-score">
            <header>
                <div>
                    <span className="radar-eyebrow">Transparent activity index</span>
                    <h2>Radar score</h2>
                </div>
                <strong>
                    {asset.radarScore}
                    <small>/100</small>
                </strong>
            </header>
            <div>
                {rows.map(([label, value]) => (
                    <div key={label}>
                        <span>{label}</span>
                        <i>
                            <b style={{ width: `${value}%` }} />
                        </i>
                        <em>{value}</em>
                    </div>
                ))}
            </div>
            <p>High means notable activity across the displayed inputs. It does not mean “good,” “safe,” or “buy.”</p>
        </section>
    );
}

function SignalTape({ candles, currentLiquidity }: { candles: OHLCVData[]; currentLiquidity: number }) {
    const [index, setIndex] = useState(() => Math.max(0, candles.length - 1));
    const safeIndex = Math.min(index, Math.max(candles.length - 1, 0));
    const candle = candles[safeIndex];
    const first = candles[0];
    const change = candle && first?.close ? ((candle.close - first.close) / first.close) * 100 : null;
    const averageVolume =
        candles.length > 0 ? candles.reduce((sum, row) => sum + finite(row.volume), 0) / candles.length : 0;
    const volumeRatio = candle && averageVolume > 0 ? candle.volume / averageVolume : null;

    return (
        <section className="radar-tape">
            <header>
                <div>
                    <span className="radar-eyebrow">Price + volume history</span>
                    <h2>Signal tape</h2>
                </div>
                <p>
                    <Clock3 size={15} /> Honest rewind: price and candle volume move with the cursor. Liquidity remains
                    the latest snapshot.
                </p>
            </header>
            {candles.length > 1 && candle ? (
                <>
                    <div className="radar-tape-readout">
                        <div>
                            <span>At cursor</span>
                            <strong>{price(candle.close)}</strong>
                        </div>
                        <div>
                            <span>Period change</span>
                            <strong className={(change ?? 0) >= 0 ? 'is-positive' : 'is-negative'}>
                                {percent(change)}
                            </strong>
                        </div>
                        <div>
                            <span>Candle volume</span>
                            <strong>{compactUsd(candle.volume)}</strong>
                        </div>
                        <div>
                            <span>Volume vs tape avg</span>
                            <strong>{volumeRatio ? `${volumeRatio.toFixed(1)}×` : 'N/A'}</strong>
                        </div>
                        <div>
                            <span>Liquidity · live</span>
                            <strong>{compactUsd(currentLiquidity)}</strong>
                        </div>
                    </div>
                    <div className="radar-tape-chart" aria-hidden="true">
                        {candles.map((row, candleIndex) => {
                            const max = Math.max(...candles.map(item => item.close));
                            const min = Math.min(...candles.map(item => item.close));
                            const height = max === min ? 50 : 18 + ((row.close - min) / (max - min)) * 70;
                            return (
                                <i
                                    key={`${row.time}:${candleIndex}`}
                                    className={candleIndex <= safeIndex ? 'is-scanned' : ''}
                                    style={{ height: `${height}%` }}
                                />
                            );
                        })}
                    </div>
                    <input
                        type="range"
                        min={0}
                        max={candles.length - 1}
                        value={safeIndex}
                        onChange={event => setIndex(Number(event.target.value))}
                        aria-label="Move through the price and volume signal tape"
                    />
                    <div className="radar-tape-axis">
                        <span>
                            {tapeTimestamp(candles[0]!.time)}
                        </span>
                        <strong>
                            {tapeTimestamp(candle.time)}
                        </strong>
                        <span>NOW</span>
                    </div>
                </>
            ) : (
                <div className="radar-tape-empty">
                    Historical price and volume candles are not available for this asset yet. No replay has been
                    fabricated.
                </div>
            )}
        </section>
    );
}

function trustLabel(tier: TrustTier): string {
    if (tier === 'tier1') return 'High';
    if (tier === 'tier2') return 'Established';
    return 'Observe';
}

function FamilyMap({
    asset,
    variants,
    markets,
}: {
    asset: RadarAsset;
    variants: ApiVariant[];
    markets: VariantTopMarketsResponse | undefined;
}) {
    const marketsByMint = new Map((markets?.variants ?? []).map(row => [row.mint, row]));
    return (
        <section className="radar-family">
            <header>
                <span className="radar-eyebrow">Canonical asset → on-chain forms</span>
                <h2>Asset family</h2>
                <p>
                    One underlying identity, many Solana representations. Metrics and tiers belong to each
                    representation, not the family as a whole.
                </p>
            </header>
            <div className="radar-family-map">
                <div className="radar-family-root">
                    <span>{asset.symbol}</span>
                    <strong>{asset.name}</strong>
                    <small>
                        {variants.length} representation{variants.length === 1 ? '' : 's'}
                    </small>
                </div>
                <div className="radar-family-branches">
                    {variants.map(variant => {
                        const market = variant.market;
                        const destinations = marketsByMint.get(variant.mint);
                        const topMarkets =
                            destinations?.topMarkets ??
                            (destinations?.topMarket ? [{ market: destinations.topMarket }] : []);
                        const logo = normalizeLogoSrc(market?.logoURI ?? undefined);
                        return (
                            <article key={variant.mint} className="radar-family-card">
                                <div className="radar-family-line" aria-hidden="true" />
                                <header>
                                    {logo ? (
                                        <Image src={logo} alt="" width={38} height={38} unoptimized />
                                    ) : (
                                        <i>{(variant.symbol ?? variant.label ?? asset.symbol).slice(0, 2)}</i>
                                    )}
                                    <div>
                                        <strong>
                                            {variant.symbol ?? market?.symbol ?? variant.label ?? asset.symbol}
                                        </strong>
                                        <span>{variant.name ?? market?.name ?? variant.label ?? variant.kind}</span>
                                    </div>
                                    <em>{trustLabel(variant.trustTier)}</em>
                                </header>
                                <dl>
                                    <div>
                                        <dt>Price</dt>
                                        <dd>{price(market?.price)}</dd>
                                    </div>
                                    <div>
                                        <dt>24h volume</dt>
                                        <dd>{compactUsd(market?.volume24hUSD)}</dd>
                                    </div>
                                    <div>
                                        <dt>Liquidity</dt>
                                        <dd>{compactUsd(market?.liquidity)}</dd>
                                    </div>
                                    <div>
                                        <dt>Source</dt>
                                        <dd>{market?.metricsSource ?? market?.source ?? 'N/A'}</dd>
                                    </div>
                                </dl>
                                <div className="radar-family-tags">
                                    <span>{variant.kind.replaceAll('_', ' ')}</span>
                                    {variant.issuer ? <span>{variant.issuer}</span> : null}
                                </div>
                                <footer>
                                    {topMarkets.length > 0 ? (
                                        topMarkets.slice(0, 2).map(row => (
                                            <a
                                                key={row.market.address}
                                                href={`https://explorer.solana.com/address/${row.market.address}`}
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                {row.market.source ?? row.market.name ?? 'Market'}{' '}
                                                <ExternalLink size={11} />
                                            </a>
                                        ))
                                    ) : (
                                        <span>No cached trading destination</span>
                                    )}
                                </footer>
                            </article>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}

export function RadarAssetPage({ asset: fallbackAsset }: { asset: CanonicalAsset }) {
    const {
        data: detail,
        isLoading,
        error,
        refetch,
    } = useQuery<AssetDetailResponse>({
        queryKey: ['radar', 'asset', fallbackAsset.assetId],
        queryFn: ({ signal }) =>
            Effect.runPromise(
                apiJson<AssetDetailResponse>({
                    url: `/api/v1/assets/${encodeURIComponent(fallbackAsset.assetId)}`,
                    signal,
                }),
                { signal },
            ),
        staleTime: 30_000,
        refetchInterval: 30_000,
        refetchIntervalInBackground: false,
    });
    const { data: markets } = useQuery<VariantTopMarketsResponse>({
        queryKey: ['radar', 'markets', fallbackAsset.assetId],
        queryFn: ({ signal }) =>
            Effect.runPromise(
                apiJson<VariantTopMarketsResponse>({
                    url: `/api/v1/assets/${encodeURIComponent(fallbackAsset.assetId)}/variant-top-markets?offset=0&limit=50`,
                    signal,
                }),
                { signal },
            ),
        staleTime: 60_000,
    });
    const radarAsset = useMemo(() => toRadarAsset(detail, fallbackAsset), [detail, fallbackAsset]);
    const variants = useMemo(() => getApiVariants(detail, fallbackAsset), [detail, fallbackAsset]);
    const { data: candles = [], isLoading: chartLoading } = useAssetPriceChart(radarAsset.assetId!, '15m', 1);
    const chronologicalCandles = useMemo(() => [...candles].sort((a, b) => a.time - b.time), [candles]);
    const logo = normalizeLogoSrc(radarAsset.logoURI);

    return (
        <main className="radar-page radar-detail">
            <FloatingMarketFeedPageContext displayName={radarAsset.name} tokenSymbol={radarAsset.symbol} suppressFeed />
            <nav className="radar-detail-nav">
                <Link href="/">
                    <ArrowLeft size={15} /> Back to live radar
                </Link>
                <Link href="/" className="radar-wordmark">
                    <span className="radar-wordmark-mark">
                        <Radio size={18} />
                    </span>
                    <span>TOKEN</span>
                    <b>RADAR</b>
                </Link>
                <RadarShareButton asset={radarAsset} />
            </nav>

            <section className="radar-detail-hero">
                <div className="radar-detail-identity">
                    {logo ? (
                        <Image src={logo} alt="" width={76} height={76} unoptimized />
                    ) : (
                        <i>{radarAsset.symbol.slice(0, 2)}</i>
                    )}
                    <div>
                        <span>{radarAsset.category} / SOLANA</span>
                        <h1>{radarAsset.symbol}</h1>
                        <p>{radarAsset.name}</p>
                    </div>
                </div>
                <div className="radar-detail-price">
                    <span>Current price</span>
                    <strong>{price(radarAsset.price)}</strong>
                    <small className={(radarAsset.priceChange1hPercent ?? 0) >= 0 ? 'is-positive' : 'is-negative'}>
                        {percent(radarAsset.priceChange1hPercent)} / 1h
                    </small>
                </div>
                <div className="radar-detail-orbit">
                    <span>{radarAsset.radarScore}</span>
                    <small>
                        RADAR
                        <br />
                        SCORE
                    </small>
                </div>
            </section>

            {isLoading ? (
                <div className="radar-detail-loading">
                    <Radio /> Acquiring live asset snapshot…
                </div>
            ) : null}
            {error ? (
                <div className="radar-error radar-detail-error">
                    <Radio />
                    <div>
                        <strong>Live snapshot unavailable</strong>
                        <p>Showing registry identity only. Market values remain blank instead of being estimated.</p>
                    </div>
                    <button type="button" onClick={() => void refetch()}>
                        Retry
                    </button>
                </div>
            ) : null}

            <section className="radar-detail-metrics">
                <div>
                    <span>
                        <CircleDot size={14} /> Activity
                    </span>
                    <strong>{metricLabel(radarAsset.scoreComponents.activity)}</strong>
                    <i>
                        <b style={{ width: `${radarAsset.scoreComponents.activity}%` }} />
                    </i>
                </div>
                <div>
                    <span>
                        <Waves size={14} /> Volume · 24h
                    </span>
                    <strong>{compactUsd(radarAsset.volume24hUSD)}</strong>
                    <small>
                        {radarAsset.volumeAccelerationRatio
                            ? `${radarAsset.volumeAccelerationRatio.toFixed(1)}× hourly baseline`
                            : 'baseline unavailable'}
                    </small>
                </div>
                <div>
                    <span>💧 Liquidity · live</span>
                    <strong>{compactUsd(radarAsset.liquidity)}</strong>
                    <small>latest snapshot, not history</small>
                </div>
                <div>
                    <span>
                        <ShieldCheck size={14} /> Representation tier
                    </span>
                    <strong>{radarAsset.trustLabel}</strong>
                    <small>{radarAsset.trustTier ? `${radarAsset.trustTier} · liquidity-derived` : 'not rated'}</small>
                </div>
            </section>

            <section className="radar-whats-happening">
                <span className="radar-eyebrow">What’s happening?</span>
                <p>{radarAsset.explanation}</p>
                <small>Deterministic summary of the metrics above. Analytics only, not financial advice.</small>
            </section>

            <div className="radar-detail-grid">
                <ScoreBreakdown asset={radarAsset} />
                {chartLoading ? (
                    <section className="radar-tape radar-tape-loading">
                        <Clock3 /> Loading the signal tape…
                    </section>
                ) : (
                    <SignalTape candles={chronologicalCandles} currentLiquidity={radarAsset.liquidity} />
                )}
            </div>

            <FamilyMap asset={radarAsset} variants={variants} markets={markets} />

            <footer className="radar-footer">
                <span>Data provided by Tokens</span>
                <p>Representation data comes from the Tokens asset registry and API.</p>
                <a href="https://docs.tokens.xyz" target="_blank" rel="noreferrer">
                    Method & API <ArrowUpRight size={14} />
                </a>
            </footer>
        </main>
    );
}
