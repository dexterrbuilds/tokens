import { Effect } from 'effect';

import { route } from '@/effect/next-route';
import {
    executionQuoteTokenMetadata,
    executionQuotesLive,
    tokensGetByAddress,
    variantMarketsGetLatestByMints,
} from '@/lib/cloudrun';
import { BadRequestError, NotFoundError, SolanaAddress, decodeUnknownOrBadRequest } from '@tokens/effect';
import { getVariantByMint } from '@tokens/asset-registry';

type Side = 'buy' | 'sell';
const MAX_U64 = 18_446_744_073_709_551_615n;

function decodeSide(raw: string | null): Effect.Effect<Side, BadRequestError> {
    if (raw === null || raw.trim() === '') return Effect.succeed('buy');
    const value = raw.trim().toLowerCase();
    return value === 'buy' || value === 'sell'
        ? Effect.succeed(value)
        : Effect.fail(new BadRequestError({ message: 'Invalid side: expected buy or sell' }));
}

function decodeAmounts(args: {
    side: Side;
    amountUsd: string[];
    tokenAmount: string[];
}): Effect.Effect<string[], BadRequestError> {
    if (args.side === 'buy') {
        if (args.tokenAmount.length > 0) {
            return Effect.fail(new BadRequestError({ message: 'tokenAmount is only valid when side=sell' }));
        }
        if (args.amountUsd.length === 0) {
            return Effect.fail(new BadRequestError({ message: 'At least one amountUsd is required when side=buy' }));
        }
        return Effect.succeed(args.amountUsd);
    }
    if (args.amountUsd.length > 0) {
        return Effect.fail(new BadRequestError({ message: 'amountUsd is only valid when side=buy' }));
    }
    if (args.tokenAmount.length === 0) {
        return Effect.fail(new BadRequestError({ message: 'At least one tokenAmount is required when side=sell' }));
    }
    return Effect.succeed(args.tokenAmount);
}

function formatRawAmount(rawAmount: string, decimals: number): string {
    const raw = BigInt(rawAmount);
    if (decimals === 0) return raw.toString();
    const padded = raw.toString().padStart(decimals + 1, '0');
    const whole = padded.slice(0, -decimals);
    const fraction = padded.slice(-decimals).replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole;
}

function validateAmounts(args: {
    amounts: string[];
    decimals: number;
    side: Side;
}): Effect.Effect<string[], BadRequestError> {
    return Effect.try({
        try: () => {
            const normalized: string[] = [];
            const seen = new Set<string>();
            for (const raw of args.amounts) {
                const value = raw.trim();
                const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
                if (!match) throw new Error('Amounts must be positive decimal strings');
                const fraction = match[2] ?? '';
                if (fraction.length > args.decimals) {
                    throw new Error(`Amount has more than ${args.decimals} decimal places`);
                }
                const amountRaw = BigInt(`${match[1]}${fraction.padEnd(args.decimals, '0')}`);
                if (amountRaw <= 0n || amountRaw > MAX_U64) throw new Error('Amount is outside the supported range');
                if (args.side === 'buy' && (amountRaw < 1_000_000n || amountRaw > 50_000_000_000_000n)) {
                    throw new Error('amountUsd must be between 1 and 50000000');
                }
                const key = amountRaw.toString();
                if (seen.has(key)) continue;
                seen.add(key);
                normalized.push(formatRawAmount(key, args.decimals));
            }
            if (normalized.length > 9) throw new Error('At most 9 unique amounts are allowed');
            return normalized;
        },
        catch: error =>
            new BadRequestError({ message: error instanceof Error ? error.message : 'Invalid quote amount' }),
    });
}

/** GET /api/v2/execution/evaluate — uncached, exact-mint Titan and Jupiter quotes. */
export const GET = route(
    (request: Request) =>
        Effect.gen(function* () {
            const params = new URL(request.url).searchParams;
            const rawMint = params.get('mint');
            if (!rawMint) {
                return yield* Effect.fail(new BadRequestError({ message: 'Missing required query param: mint' }));
            }
            const mint = yield* decodeUnknownOrBadRequest(SolanaAddress, rawMint, 'Invalid mint');
            const registryMatch = getVariantByMint(mint);
            if (!registryMatch) {
                return yield* Effect.fail(
                    new NotFoundError({ message: `Unsupported token mint: ${mint}`, resource: 'token' }),
                );
            }
            const side = yield* decodeSide(params.get('side'));
            const rawAmounts = yield* decodeAmounts({
                side,
                amountUsd: params.getAll('amountUsd'),
                tokenAmount: params.getAll('tokenAmount'),
            });

            const token = yield* tokensGetByAddress({ address: mint });
            const needsMarket =
                !token || !Number.isInteger(token.decimals) || !token.symbol?.trim() || !token.name?.trim();
            const market = needsMarket
                ? ((yield* variantMarketsGetLatestByMints({ mints: [mint] }))[0]?.market ?? null)
                : null;
            const localDecimals = token?.decimals ?? market?.decimals ?? null;
            const jupiterMetadata = Number.isInteger(localDecimals)
                ? null
                : yield* executionQuoteTokenMetadata({ mint });
            const decimals = localDecimals ?? jupiterMetadata?.decimals ?? null;
            if (!Number.isInteger(decimals) || (decimals as number) < 0) {
                return yield* Effect.fail(
                    new NotFoundError({ message: `Unsupported token mint: ${mint}`, resource: 'token' }),
                );
            }
            const tokenDecimals = decimals as number;
            const symbol =
                token?.symbol ??
                market?.symbol ??
                jupiterMetadata?.symbol ??
                registryMatch.variant.symbol ??
                registryMatch.variant.label ??
                registryMatch.asset.symbol ??
                mint.slice(0, 4);
            const name =
                token?.name ??
                market?.name ??
                jupiterMetadata?.name ??
                registryMatch.variant.name ??
                registryMatch.asset.name ??
                symbol;
            const amounts = yield* validateAmounts({
                amounts: rawAmounts,
                decimals: side === 'buy' ? 6 : tokenDecimals,
                side,
            });

            const result = yield* executionQuotesLive({
                mint,
                side,
                amounts,
                tokenDecimals,
            });

            const inputToken =
                side === 'buy'
                    ? { mint: result.quoteMint, symbol: 'USDC', decimals: 6 }
                    : { mint, symbol, decimals: tokenDecimals };
            const outputToken =
                side === 'buy'
                    ? { mint, symbol, decimals: tokenDecimals }
                    : { mint: result.quoteMint, symbol: 'USDC', decimals: 6 };
            const serializeCandidate = (candidate: (typeof result.entries)[number]['candidates'][number]) => {
                if (candidate.status === 'unavailable') {
                    return {
                        provider: candidate.provider,
                        status: candidate.status,
                        reason: candidate.reason,
                        input: null,
                        output: null,
                        priceImpactPct: null,
                        route: candidate.route,
                        contextSlot: null,
                        quotedAt: candidate.quotedAt,
                    };
                }
                return {
                    provider: candidate.provider,
                    status: candidate.status,
                    input: {
                        ...inputToken,
                        amount: formatRawAmount(candidate.inAmountRaw, inputToken.decimals),
                        rawAmount: candidate.inAmountRaw,
                    },
                    output: {
                        ...outputToken,
                        amount: formatRawAmount(candidate.outAmountRaw, outputToken.decimals),
                        rawAmount: candidate.outAmountRaw,
                    },
                    priceImpactPct: candidate.priceImpactPct,
                    route: candidate.route,
                    contextSlot: candidate.contextSlot,
                    quotedAt: candidate.quotedAt,
                };
            };

            const quotes = result.entries.map(entry => {
                const candidates = entry.candidates.map(serializeCandidate);
                if (entry.status === 'unavailable') {
                    return {
                        request: entry.request,
                        status: entry.status,
                        reason: entry.reason,
                        provider: null,
                        input: null,
                        output: null,
                        priceImpactPct: null,
                        route: entry.route,
                        contextSlot: null,
                        quotedAt: entry.quotedAt,
                        candidates,
                    };
                }

                return {
                    request: entry.request,
                    status: entry.status,
                    provider: entry.provider,
                    input: {
                        ...inputToken,
                        amount: formatRawAmount(entry.inAmountRaw, inputToken.decimals),
                        rawAmount: entry.inAmountRaw,
                    },
                    output: {
                        ...outputToken,
                        amount: formatRawAmount(entry.outAmountRaw, outputToken.decimals),
                        rawAmount: entry.outAmountRaw,
                    },
                    priceImpactPct: entry.priceImpactPct,
                    route: entry.route,
                    contextSlot: entry.contextSlot,
                    quotedAt: entry.quotedAt,
                    candidates,
                };
            });
            const available = quotes.filter(quote => quote.status === 'available').length;
            const providerStats = Object.fromEntries(
                result.providers.map(provider => [
                    provider,
                    {
                        available: result.entries.filter(entry =>
                            entry.candidates.some(candidate => candidate.provider === provider && candidate.status === 'available'),
                        ).length,
                        wins: result.entries.filter(entry => entry.status === 'available' && entry.provider === provider).length,
                    },
                ]),
            );

            return {
                mint,
                side,
                providers: result.providers,
                token: {
                    mint,
                    symbol,
                    name,
                    decimals: tokenDecimals,
                },
                quotes,
                meta: {
                    requested: quotes.length,
                    available,
                    unavailable: quotes.length - available,
                    providerStats,
                },
            };
        }),
    { platform: { requiredScopes: ['execution:read'] } },
);
