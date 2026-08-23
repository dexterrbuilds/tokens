import { Effect } from 'effect';

import { route } from '@/effect/next-route';
import { withStaleFallback } from '@/effect/stale-response-cache';
import { BadRequestError } from '@tokens/effect';
import {
    computeSizeAwareScore,
    EXECUTION_GRADING_VERSION,
    FILL_QUALITY_SCORING_VERSION,
    getAsset,
    gradeImpactBps,
    interpolateImpactBps,
    isFillQualityEligibleForPrimary,
    rankVariantsWithReasons,
    type VariantFillQualityRankingSnapshot,
    type VariantMarketRankingSnapshot,
} from '@tokens/asset-registry';
import {
    executionQuotesLive,
    variantDepthCurvesGetLatestByMints,
    variantFillQualityGetLatestByMints,
    variantMarketsGetLatestByMints,
    type VariantDepthCurvesGetLatestByMintsResult,
} from '@/lib/cloudrun';
import { tapErrorAndDefault } from '@tokens/effect';

import { buildCuratedMintRank, executionQualitySnapshotFromConvexFillQuality } from '../../../v1/assets/_asset-helpers';
import { resolveAssetRefContext } from '../../../v1/assets/_resolve-asset-ref';

const STALE_TTL_SECONDS = 10 * 60;
const MIN_AMOUNT_USD = 1;
const MAX_AMOUNT_USD = 50_000_000;
const MAX_VARIANT_MINTS = 250;
/** Curves older than this are treated as absent (depth_unavailable). */
const MAX_DEPTH_AGE_SECONDS = 6 * 60 * 60;

/**
 * Which sampled source the read path trusts. Prod runs Titan; local/staging
 * may sample with Jupiter instead, and without this the endpoint would
 * silently report zero depth coverage there.
 */
function depthReadSource(): 'titan' | 'jupiter_lite' {
    return process.env.DEPTH_READ_SOURCE?.trim() === 'jupiter_lite' ? 'jupiter_lite' : 'titan';
}

// Registry data is static per deploy; the curated rank never changes at runtime.
const CURATED_MINT_RANK = buildCuratedMintRank();

type Side = 'buy' | 'sell';
type QuoteMode = 'sampled' | 'live';

function decodeQuoteMode(raw: string | null): Effect.Effect<QuoteMode, BadRequestError> {
    if (raw == null || raw.trim() === '') return Effect.succeed('sampled');
    const mode = raw.trim().toLowerCase();
    if (mode !== 'sampled' && mode !== 'live') {
        return Effect.fail(new BadRequestError({ message: 'Invalid quotes: expected sampled or live' }));
    }
    return Effect.succeed(mode);
}

function decodeAmountUsd(raw: string | null): Effect.Effect<number | null, BadRequestError> {
    if (raw == null || raw.trim() === '') return Effect.succeed(null);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return Effect.fail(new BadRequestError({ message: 'Invalid amountUsd: expected a positive number' }));
    }
    return Effect.succeed(Math.min(MAX_AMOUNT_USD, Math.max(MIN_AMOUNT_USD, parsed)));
}

function decodeSide(raw: string | null): Effect.Effect<Side, BadRequestError> {
    if (raw == null || raw.trim() === '') return Effect.succeed('buy');
    const side = raw.trim().toLowerCase();
    if (side !== 'buy' && side !== 'sell') {
        return Effect.fail(new BadRequestError({ message: 'Invalid side: expected buy or sell' }));
    }
    return Effect.succeed(side);
}

/** Bucket the stale-fallback cache key to 2 significant figures to bound cardinality. */
function amountCacheBucket(amountUsd: number | null): string {
    if (amountUsd === null) return 'na';
    return Number(amountUsd.toPrecision(2)).toString();
}

/**
 * GET /api/v2/execution/evaluate — ranked "best variant" recommendation for a
 * canonical asset ("I want to buy bitcoin on Solana — which mint?").
 *
 * The full ranked list is always returned so callers render what they want;
 * `primary` is our recommendation, consistent with the primary-variant
 * concept used across v1. Size-aware fields (`estimatedImpactBps`,
 * `sizeAwareScore`, ...) are part of the contract from day one and populate
 * once the depth-sampling pipeline lands — until then they are null and
 * `amountUsd` requests carry a `depth_unavailable` reason per variant.
 */
export const GET = route(
    (request: Request) =>
        Effect.gen(function* () {
            const url = new URL(request.url);
            const assetRef = url.searchParams.get('asset')?.trim() || null;
            if (!assetRef) {
                return yield* Effect.fail(new BadRequestError({ message: 'Missing required query param: asset' }));
            }
            const amountUsd = yield* decodeAmountUsd(url.searchParams.get('amountUsd'));
            const side = yield* decodeSide(url.searchParams.get('side'));
            const quoteMode = yield* decodeQuoteMode(url.searchParams.get('quotes'));
            // Live quotes only exist for the buy side at a concrete size.
            const wantsLive = quoteMode === 'live' && amountUsd !== null && side === 'buy';

            const resolution = yield* resolveAssetRefContext(assetRef);

            const main = Effect.gen(function* () {
                const asset = getAsset(resolution.assetId);
                const variants = asset?.variants ?? [];
                const mints = variants.map(variant => variant.mint).slice(0, MAX_VARIANT_MINTS);

                const wantsDepth = mints.length > 0;
                const [marketRows, fillQualityRows, depthRows] =
                    mints.length > 0
                        ? yield* Effect.all(
                              [
                                  variantMarketsGetLatestByMints({ mints }),
                                  variantFillQualityGetLatestByMints({ mints }),
                                  // Depth is additive: a read failure degrades to
                                  // depth_unavailable instead of failing the request.
                                  wantsDepth
                                      ? variantDepthCurvesGetLatestByMints({
                                            mints,
                                            side,
                                            source: depthReadSource(),
                                        }).pipe(
                                            tapErrorAndDefault(
                                                'v2.execution.evaluate.depthCurves',
                                                [] as VariantDepthCurvesGetLatestByMintsResult,
                                            ),
                                        )
                                      : Effect.succeed([] as VariantDepthCurvesGetLatestByMintsResult),
                              ],
                              { concurrency: 'unbounded' },
                          )
                        : [[], [], [] as VariantDepthCurvesGetLatestByMintsResult];

                const marketByMint = new Map<string, VariantMarketRankingSnapshot | null>();
                const marketDocByMint = new Map<string, (typeof marketRows)[number]['market']>();
                for (const row of marketRows) {
                    marketDocByMint.set(row.mint, row.market);
                    marketByMint.set(
                        row.mint,
                        row.market
                            ? {
                                  liquidity: row.market.liquidity ?? null,
                                  volume24hUSD: row.market.volume24hUSD ?? null,
                                  trade24h: row.market.trade24h ?? null,
                              }
                            : null,
                    );
                }
                const fillQualityByMint = new Map<string, VariantFillQualityRankingSnapshot | null>();
                for (const row of fillQualityRows) {
                    fillQualityByMint.set(row.mint, executionQualitySnapshotFromConvexFillQuality(row.fillQuality));
                }

                const nowSeconds = Math.floor(Date.now() / 1000);
                // Fresh curves, including empty-ladder rows: an empty ladder is a
                // recorded "no route right now" finding, not missing data.
                const freshCurveByMint = new Map<string, (typeof depthRows)[number]['depthCurve']>();
                for (const row of depthRows) {
                    const curve = row.depthCurve;
                    if (!curve) continue;
                    if (nowSeconds - curve.asOf > MAX_DEPTH_AGE_SECONDS) continue;
                    freshCurveByMint.set(row.mint, curve);
                }
                const liveByMint = new Map<string, number>();
                let liveAsOf: number | null = null;
                if (wantsLive && freshCurveByMint.size > 0 && amountUsd !== null) {
                    const live = yield* executionQuotesLive({
                        mints: [...freshCurveByMint.keys()],
                        amountUsd,
                    }).pipe(tapErrorAndDefault('v2.execution.evaluate.liveQuotes', null));
                    if (live) {
                        liveAsOf = live.asOf;
                        for (const entry of live.entries) {
                            if (entry.impactBps !== null) liveByMint.set(entry.mint, entry.impactBps);
                        }
                    }
                }

                const depthSource = freshCurveByMint.values().next().value?.source ?? null;
                const firstWithLadder = [...freshCurveByMint.values()].find(curve => curve!.ladder.length > 0);
                const sizeLadderUsd = firstWithLadder
                    ? [...firstWithLadder.ladder].map(point => point.sizeUsd).sort((a, b) => a - b)
                    : null;

                const ranked = asset
                    ? rankVariantsWithReasons({
                          asset,
                          mintRank: CURATED_MINT_RANK,
                          marketByMint,
                          fillQualityByMint,
                          options: { strategy: 'execution_quality' },
                      })
                    : [];

                const first = ranked[0] ?? null;

                return {
                    asset: {
                        assetId: resolution.assetId,
                        name: asset?.name ?? null,
                        symbol: asset?.symbol ?? null,
                        category: asset?.category ?? null,
                    },
                    side,
                    amountUsd,
                    primary:
                        first && first.isPrimaryCandidate
                            ? { mint: first.variant.mint, variantId: first.variant.variantId, reason: first.reason }
                            : null,
                    variants: ranked.map(entry => {
                        const market = marketDocByMint.get(entry.variant.mint) ?? null;
                        const fillQuality = fillQualityByMint.get(entry.variant.mint) ?? null;

                        const curve = freshCurveByMint.get(entry.variant.mint) ?? null;
                        const hasRoute = curve !== null && curve.ladder.length > 0;
                        const liveImpactBps = wantsLive ? (liveByMint.get(entry.variant.mint) ?? null) : null;
                        const impact =
                            liveImpactBps !== null
                                ? { impactBps: liveImpactBps, extrapolated: false }
                                : hasRoute && amountUsd !== null
                                  ? interpolateImpactBps(curve.ladder, amountUsd)
                                  : null;
                        const reasons: string[] = [entry.reason];
                        if (!curve) reasons.push('depth_unavailable');
                        // Sampled and found untradable — the strongest avoid signal.
                        if (curve && !hasRoute) reasons.push('no_route');
                        if (impact?.extrapolated) reasons.push('beyond_sampled_depth');
                        // Live was requested but this variant fell back to the sampled curve.
                        if (wantsLive && hasRoute && liveImpactBps === null) reasons.push('live_quote_unavailable');

                        return {
                            rank: entry.rank,
                            mint: entry.variant.mint,
                            variantId: entry.variant.variantId,
                            kind: entry.variant.kind,
                            issuer: entry.variant.issuer ?? null,
                            trustTier: entry.variant.trustTier,
                            symbol: entry.variant.symbol ?? market?.symbol ?? null,
                            name: entry.variant.name ?? market?.name ?? null,
                            liquidityUsd: market?.liquidity ?? null,
                            volume24hUSD: market?.volume24hUSD ?? null,
                            executionScore: fillQuality?.executionScore ?? null,
                            feeBps: fillQuality?.feeBps ?? null,
                            isFillQualityEligible: isFillQualityEligibleForPrimary(fillQuality),
                            // Informational until size-aware reordering activates:
                            // these never affect ordering today.
                            estimatedImpactBps: impact ? impact.impactBps : null,
                            estimatedOutUsd:
                                impact && amountUsd !== null
                                    ? Math.round(amountUsd * (1 - impact.impactBps / 10_000) * 100) / 100
                                    : null,
                            sizeAwareScore: impact
                                ? computeSizeAwareScore({
                                      executionScore: fillQuality?.executionScore ?? 0,
                                      impactBps: impact.impactBps,
                                  })
                                : null,
                            depthAsOf: liveImpactBps !== null ? liveAsOf : (curve?.asOf ?? null),
                            // Sampled evaluation points, graded. Internal
                            // sampling fields (outAmount, routeVenues, ...)
                            // are deliberately not surfaced.
                            ladder: curve
                                ? curve.ladder
                                      .filter(rung => rung.priceImpactBps !== null)
                                      .sort((a, b) => a.sizeUsd - b.sizeUsd)
                                      .map(rung => ({
                                          sizeUsd: rung.sizeUsd,
                                          impactBps: rung.priceImpactBps as number,
                                          grade: gradeImpactBps(rung.priceImpactBps as number),
                                      }))
                                : null,
                            executionGrade: impact ? gradeImpactBps(impact.impactBps) : null,
                            reasons,
                        };
                    }),
                    meta: {
                        asOf: nowSeconds,
                        scoringVersion: FILL_QUALITY_SCORING_VERSION,
                        // Reported once size-aware reordering activates; the
                        // informational fields never influence ordering today.
                        sizeAwareScoringVersion: null as string | null,
                        gradingVersion: EXECUTION_GRADING_VERSION,
                        quoteMode: (wantsLive && liveByMint.size > 0 ? 'live' : 'sampled') as QuoteMode,
                        strategy: 'execution_quality' as const,
                        sizeLadderUsd,
                        depthSource,
                        depthCoverage: {
                            withCurves: ranked.filter(entry => freshCurveByMint.has(entry.variant.mint)).length,
                            total: ranked.length,
                        },
                    },
                };
            });

            return yield* withStaleFallback(
                {
                    operation: 'v2.execution.evaluate',
                    cacheKey: `v2:execution:evaluate:${resolution.assetId}:${side}:${amountCacheBucket(amountUsd)}:${quoteMode}`,
                    ttlSeconds: STALE_TTL_SECONDS,
                },
                main,
            );
        }),
    { platform: { requiredScopes: ['execution:read'] }, cache: { maxAge: 60 } },
);
