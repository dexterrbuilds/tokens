import { InvalidArgsError } from './assets';

export interface PrestocksPriceRow {
    mint: string;
    symbol: string;
    name: string | null;
    mark_price_usd: number | null;
    mark_valuation_usd: number | null;
    token_price_usd: number | null;
    implied_valuation_usd: number | null;
    supply: number | null;
    last_fetched_at: number;
    source: string;
}

export interface PrestocksReadsRepo {
    findLatestByMints(mints: readonly string[]): Promise<PrestocksPriceRow[]>;
}

export interface PrestocksPriceResult {
    mint: string;
    symbol: string;
    name: string | null;
    markPriceUsd: number | null;
    markValuationUsd: number | null;
    tokenPriceUsd: number | null;
    impliedValuationUsd: number | null;
    supply: number | null;
    lastFetchedAt: number;
    source: 'prestocks';
}

export interface GetLatestByMintsEntry {
    mint: string;
    snapshot: PrestocksPriceResult | null;
}

function rowToResult(row: PrestocksPriceRow): PrestocksPriceResult {
    return {
        mint: row.mint,
        symbol: row.symbol,
        name: row.name,
        markPriceUsd: row.mark_price_usd,
        markValuationUsd: row.mark_valuation_usd,
        tokenPriceUsd: row.token_price_usd,
        impliedValuationUsd: row.implied_valuation_usd,
        supply: row.supply,
        lastFetchedAt: row.last_fetched_at,
        source: row.source as 'prestocks',
    };
}

function readStringArray(args: unknown, key: string): string[] {
    if (typeof args !== 'object' || args === null) {
        throw new InvalidArgsError('args must be an object');
    }
    const raw = (args as Record<string, unknown>)[key];
    if (!Array.isArray(raw)) {
        throw new InvalidArgsError(`${key} must be an array of strings`);
    }
    for (const item of raw) {
        if (typeof item !== 'string') {
            throw new InvalidArgsError(`${key} must be an array of strings`);
        }
    }
    return raw as string[];
}

export async function getLatestByMints(
    repo: PrestocksReadsRepo,
    args: unknown,
): Promise<GetLatestByMintsEntry[]> {
    const rawList = readStringArray(args, 'mints');

    const mints = rawList
        .slice(0, 100)
        .map(mint => mint.trim())
        .filter(mint => mint.length > 0);

    if (mints.length === 0) return [];

    const rows = await repo.findLatestByMints(mints);
    const byMint = new Map(rows.map(r => [r.mint, r] as const));

    return mints.map(mint => {
        const row = byMint.get(mint);
        if (!row) return { mint, snapshot: null };
        return { mint, snapshot: rowToResult(row) };
    });
}
