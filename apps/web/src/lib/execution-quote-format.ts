/** Jupiter returns priceImpactPct as a decimal ratio (0.9846 = 98.46%). */
export function formatPriceImpactRatio(priceImpactRatio: number | null): string {
    if (priceImpactRatio === null || !Number.isFinite(priceImpactRatio)) return '—';
    const percentage = priceImpactRatio * 100;
    if (percentage > 0 && percentage < 0.001) return '<0.001%';
    return `${percentage.toFixed(Math.abs(percentage) < 1 ? 3 : 2)}%`;
}

export function fullPriceImpactRatio(priceImpactRatio: number | null): string | undefined {
    if (priceImpactRatio === null || !Number.isFinite(priceImpactRatio)) return undefined;
    return `${priceImpactRatio * 100}%`;
}
