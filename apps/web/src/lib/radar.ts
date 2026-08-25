import { classifyLiquidityTier, getVariantByMint, type TrustTier } from '@tokens/asset-registry';

import type { Token } from '@/lib/types';

export interface RadarScoreComponents {
    activity: number;
    volumeAcceleration: number;
    liquidity: number;
    priceMovement: number;
    trust: number;
}

export interface RadarAsset extends Token {
    radarScore: number;
    scoreComponents: RadarScoreComponents;
    volumeAccelerationRatio: number | null;
    trustTier: TrustTier | null;
    trustLabel: 'High' | 'Established' | 'Observe' | 'Unrated';
    explanation: string;
}

export interface RadarSignal {
    id: string;
    assetId: string;
    symbol: string;
    label: string;
    detail: string;
    tone: 'hot' | 'up' | 'down' | 'neutral';
    timestamp: number | null;
}

export interface RadarSnapshot {
    assets: RadarAsset[];
    movingNow: RadarAsset[];
    volumeSpikes: RadarAsset[];
    liquidityBeacons: RadarAsset[];
    momentum: RadarAsset[];
    cooling: RadarAsset[];
    trusted: RadarAsset[];
    signals: RadarSignal[];
}

function finite(value: number | null | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min = 0, max = 100): number {
    return Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);
}

function logScale(value: number | null | undefined, floor: number, ceiling: number): number {
    const safe = Math.max(finite(value), 0);
    if (safe <= floor) return 0;
    if (safe >= ceiling) return 100;
    return clamp(((Math.log10(safe) - Math.log10(floor)) / (Math.log10(ceiling) - Math.log10(floor))) * 100);
}

export function getVolumeAccelerationRatio(token: Token): number | null {
    const hour = finite(token.volume1hUSD);
    const day = finite(token.volume24hUSD);
    if (hour <= 0 || day <= 0) return null;
    return hour / Math.max(day / 24, 1);
}

function trustScore(tier: TrustTier | null): number {
    if (tier === 'tier1') return 100;
    if (tier === 'tier2') return 68;
    if (tier === 'tier3') return 36;
    return 20;
}

function trustLabel(tier: TrustTier | null): RadarAsset['trustLabel'] {
    if (tier === 'tier1') return 'High';
    if (tier === 'tier2') return 'Established';
    if (tier === 'tier3') return 'Observe';
    return 'Unrated';
}

/**
 * TOKEN RADAR score methodology (0–100).
 *
 * This is an activity score, not an investment-quality score:
 * - Activity, 30%: log-scaled 1h volume (45%), trades (30%), and unique wallets (25%).
 * - Volume acceleration, 25%: 1h volume pace versus the asset's own 24h hourly baseline.
 * - Liquidity, 20%: log-scaled current on-chain liquidity from $10k to $20m.
 * - Price movement, 15%: magnitude of the reported 1h move, capped at 5%.
 * - Representation tier, 10%: the repository's liquidity-derived tier for this representation
 *   (100/68/36; 20 if unrated). This is market context, not an issuer/security audit.
 *
 * Missing metrics score zero. The formula is intentionally deterministic and is
 * documented here and in the project README so the UI never implies a mysterious AI score.
 */
export function computeRadarScore(token: Token): {
    score: number;
    components: RadarScoreComponents;
    ratio: number | null;
    tier: TrustTier | null;
} {
    const match = getVariantByMint(token.address);
    // `trustTier` is deprecated in the registry and mirrors liquidity tier. The
    // API refreshes that tier from current market liquidity, so do the same for
    // trending rows that do not carry a tier. Fall back to the registry only
    // when the live snapshot has no usable liquidity.
    const tier = finite(token.liquidity) > 0 ? classifyLiquidityTier(token.liquidity) : (match?.variant.trustTier ?? null);
    const ratio = getVolumeAccelerationRatio(token);

    const activity =
        0.45 * logScale(token.volume1hUSD, 500, 2_000_000) +
        0.3 * logScale(token.trade1h, 5, 5_000) +
        0.25 * logScale(token.uniqueWallet1h, 2, 1_000);
    const volumeAcceleration = ratio === null ? 0 : clamp(((ratio - 0.5) / 3.5) * 100);
    const liquidity = logScale(token.liquidity, 10_000, 20_000_000);
    const priceMovement = clamp((Math.abs(finite(token.priceChange1hPercent)) / 5) * 100);
    const trust = trustScore(tier);

    const components = {
        activity: Math.round(activity),
        volumeAcceleration: Math.round(volumeAcceleration),
        liquidity: Math.round(liquidity),
        priceMovement: Math.round(priceMovement),
        trust,
    };
    const score = Math.round(
        0.3 * components.activity +
            0.25 * components.volumeAcceleration +
            0.2 * components.liquidity +
            0.15 * components.priceMovement +
            0.1 * components.trust,
    );

    return { score: clamp(score), components, ratio, tier };
}

function formatRatio(value: number): string {
    return `${value.toFixed(value >= 10 ? 0 : 1)}×`;
}

function formatCompactUsd(value: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: 'compact',
        maximumFractionDigits: 1,
    }).format(value);
}

export function explainRadarAsset(
    asset: Pick<RadarAsset, 'volumeAccelerationRatio' | 'priceChange1hPercent' | 'liquidity'>,
): string {
    const ratio = asset.volumeAccelerationRatio;
    const change = finite(asset.priceChange1hPercent);
    const liquidity = finite(asset.liquidity);
    const parts: string[] = [];

    if (ratio !== null && ratio >= 1.5)
        parts.push(`volume is running at ${formatRatio(ratio)} its 24h hourly baseline`);
    else if (ratio !== null && ratio <= 0.7) parts.push('volume pace is below its 24h hourly baseline');
    else if (ratio !== null) parts.push('volume pace is close to its 24h hourly baseline');

    if (change >= 0.5) parts.push(`price is up ${change.toFixed(2)}% over 1h`);
    else if (change <= -0.5) parts.push(`price is down ${Math.abs(change).toFixed(2)}% over 1h`);
    else parts.push('the reported 1h price move is muted');

    if (liquidity > 0) parts.push(`current on-chain liquidity is ${formatCompactUsd(liquidity)}`);

    const supportingDetail = parts[2]
        ? ` ${parts[2][0]?.toUpperCase() ?? ''}${parts[2].slice(1)}.`
        : '';
    const sentence =
        parts.length > 0
            ? `${parts.slice(0, 2).join(' and ')}.${supportingDetail}`
            : 'Current market metrics are limited.';
    return `${sentence[0]?.toUpperCase() ?? ''}${sentence.slice(1)}`;
}

function normalizeTimestamp(value: number | null | undefined): number | null {
    const timestamp = finite(value);
    if (timestamp <= 0) return null;
    return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

function createSignals(asset: RadarAsset): RadarSignal[] {
    const signals: RadarSignal[] = [];
    const assetId = asset.assetId?.trim() || asset.address;
    const timestamp = normalizeTimestamp(asset.lastTradeAt ?? asset.asOf ?? asset.lastFetchedAt);
    const ratio = asset.volumeAccelerationRatio;
    const change = finite(asset.priceChange1hPercent);

    if (ratio !== null && ratio >= 2) {
        signals.push({
            id: `${assetId}:volume`,
            assetId,
            symbol: asset.symbol,
            label: 'Volume spike',
            detail: `${formatRatio(ratio)} hourly baseline`,
            tone: 'hot',
            timestamp,
        });
    }
    if (change >= 1) {
        signals.push({
            id: `${assetId}:price-up`,
            assetId,
            symbol: asset.symbol,
            label: 'Positive momentum',
            detail: `+${change.toFixed(2)}% in 1h`,
            tone: 'up',
            timestamp,
        });
    } else if (change <= -1) {
        signals.push({
            id: `${assetId}:price-down`,
            assetId,
            symbol: asset.symbol,
            label: 'Cooling',
            detail: `${change.toFixed(2)}% in 1h`,
            tone: 'down',
            timestamp,
        });
    }
    if (asset.radarScore >= 78 && signals.length === 0) {
        signals.push({
            id: `${assetId}:activity`,
            assetId,
            symbol: asset.symbol,
            label: 'Unusual activity',
            detail: `Radar score ${asset.radarScore}`,
            tone: 'neutral',
            timestamp,
        });
    }

    return signals;
}

function uniqueCanonicalAssets(tokens: Token[]): Token[] {
    const byAsset = new Map<string, Token>();
    for (const token of tokens) {
        const key = token.assetId?.trim() || token.address;
        const current = byAsset.get(key);
        if (!current || computeRadarScore(token).score > computeRadarScore(current).score) byAsset.set(key, token);
    }
    return Array.from(byAsset.values());
}

export function createRadarSnapshot(tokens: Token[]): RadarSnapshot {
    const assets = uniqueCanonicalAssets(tokens)
        .map(token => {
            const { score, components, ratio, tier } = computeRadarScore(token);
            const base = {
                ...token,
                radarScore: score,
                scoreComponents: components,
                volumeAccelerationRatio: ratio,
                trustTier: tier,
                trustLabel: trustLabel(tier),
            };
            return { ...base, explanation: explainRadarAsset(base) } satisfies RadarAsset;
        })
        .sort((a, b) => b.radarScore - a.radarScore || finite(b.volume1hUSD) - finite(a.volume1hUSD));

    return {
        assets,
        movingNow: assets.slice(0, 8),
        volumeSpikes: assets
            .filter(asset => (asset.volumeAccelerationRatio ?? 0) >= 1.5)
            .sort((a, b) => (b.volumeAccelerationRatio ?? 0) - (a.volumeAccelerationRatio ?? 0))
            .slice(0, 6),
        liquidityBeacons: assets
            .filter(asset => asset.liquidity > 0)
            .sort((a, b) => b.liquidity - a.liquidity)
            .slice(0, 6),
        momentum: assets
            .filter(asset => finite(asset.priceChange1hPercent) >= 0.5)
            .sort((a, b) => finite(b.priceChange1hPercent) - finite(a.priceChange1hPercent))
            .slice(0, 6),
        cooling: assets
            .filter(asset => finite(asset.priceChange1hPercent) <= -0.5 || (asset.volumeAccelerationRatio ?? 1) <= 0.7)
            .sort((a, b) => finite(a.priceChange1hPercent) - finite(b.priceChange1hPercent))
            .slice(0, 6),
        trusted: assets
            .filter(asset => asset.trustTier === 'tier1' || asset.trustTier === 'tier2')
            .sort((a, b) => b.scoreComponents.trust - a.scoreComponents.trust || b.radarScore - a.radarScore)
            .slice(0, 6),
        signals: assets
            .flatMap(createSignals)
            .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
            .slice(0, 12),
    };
}
