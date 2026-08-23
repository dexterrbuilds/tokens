/* eslint-disable no-console */

/**
 * Live contract check for the v2 execution API.
 *
 * Usage:
 *   API_BASE_URL=http://localhost:3002 API_KEY=... bun scripts/verify-execution-api-v2-contract.ts
 *
 * Exercises GET /v2/execution/links and GET /v2/execution/evaluate
 * (execution:read). Route checks tolerate depthCoverage.withCurves = 0 so the
 * script passes before the depth-sampling cron warms.
 */

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const CBBTC_MINT = 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij';
const IMPACT_GRADES = ['excellent', 'good', 'fair', 'poor', 'avoid'];

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
    assert(value !== null && typeof value === 'object', `${path} must be an object`);
}

function coerceBaseUrl(value: string): string {
    const trimmed = value.trim().replace(/\/$/, '');
    assert(trimmed.length > 0, 'API_BASE_URL must be a non-empty string');
    const hasScheme = /^https?:\/\//i.test(trimmed);
    const withScheme = hasScheme
        ? trimmed
        : trimmed.startsWith('localhost') || trimmed.startsWith('127.0.0.1')
          ? `http://${trimmed}`
          : `https://${trimmed}`;
    try {
        return new URL(withScheme).toString().replace(/\/$/, '');
    } catch {
        throw new Error(`API_BASE_URL is not a valid URL: ${value}`);
    }
}

async function getRaw(baseUrl: string, apiKey: string, path: string): Promise<Response> {
    return fetch(new URL(path, baseUrl), { headers: { 'x-api-key': apiKey } });
}

async function getJson(baseUrl: string, apiKey: string, path: string): Promise<unknown> {
    const res = await getRaw(baseUrl, apiKey, path);
    assert(res.ok, `GET ${path} failed: HTTP ${res.status} ${await res.text().then(t => t.slice(0, 300))}`);
    return res.json();
}

function assertLink(link: unknown, path: string): { id: string; url: string } {
    assertObject(link, path);
    assert(typeof link.id === 'string' && link.id.length > 0, `${path}.id must be a non-empty string`);
    assert(typeof link.name === 'string' && link.name.length > 0, `${path}.name must be a non-empty string`);
    assert(link.kind === 'swap', `${path}.kind must be "swap"`);
    assert(
        link.venueType === 'aggregator' || link.venueType === 'dex',
        `${path}.venueType must be "aggregator" or "dex"`,
    );
    assert(typeof link.url === 'string', `${path}.url must be a string`);
    try {
        new URL(link.url as string);
    } catch {
        throw new Error(`${path}.url is not a valid URL: ${String(link.url)}`);
    }
    if (link.iconUrl !== null) {
        assert(
            typeof link.iconUrl === 'string' && /^https?:\/\//.test(link.iconUrl),
            `${path}.iconUrl must be null or an absolute URL`,
        );
    }
    return { id: link.id as string, url: link.url as string };
}

function assertLinksResponse(body: unknown, label: string): { linkIds: string[]; primary: string | null } {
    assertObject(body, label);
    assert(typeof body.buyMint === 'string' && body.buyMint.length > 0, `${label}.buyMint must be a string`);
    assert(
        body.sellMint === null || typeof body.sellMint === 'string',
        `${label}.sellMint must be a string or null`,
    );
    assert(body.primary === null || typeof body.primary === 'string', `${label}.primary must be a string or null`);
    assert(Array.isArray(body.links), `${label}.links must be an array`);
    const linkIds = body.links.map((link, i) => assertLink(link, `${label}.links[${i}]`).id);
    assertObject(body.meta, `${label}.meta`);
    assert(Array.isArray(body.meta.kinds) && body.meta.kinds.includes('swap'), `${label}.meta.kinds must include swap`);
    if (typeof body.primary === 'string') {
        assert(linkIds.includes(body.primary), `${label}.primary must reference a returned link id`);
    }
    return { linkIds, primary: body.primary as string | null };
}

async function main(): Promise<void> {
    const baseUrl = coerceBaseUrl(process.env.API_BASE_URL ?? '');
    const apiKey = (process.env.API_KEY ?? '').trim();
    assert(apiKey.length > 0, 'API_KEY must be set');

    // 1. Full venue set for a mint.
    const byMint = await getJson(baseUrl, apiKey, `api/v2/execution/links?mint=${CBBTC_MINT}`);
    const { linkIds, primary } = assertLinksResponse(byMint, 'links(mint)');
    assert(linkIds.length >= 5, `expected at least 5 venues, got ${linkIds.length}`);
    assert(primary === 'titan', `expected primary=titan, got ${String(primary)}`);
    console.log(`links(mint): ${linkIds.length} venues, primary=${primary}`);

    // 2. Sell-side defaulting when buying SOL.
    const solBody = await getJson(baseUrl, apiKey, `api/v2/execution/links?mint=${SOL_MINT}`);
    assertObject(solBody, 'links(sol)');
    assert(solBody.sellMint === USDC_MINT, 'buying SOL must default the sell side to USDC');
    console.log('links(sol): sell side defaults to USDC');

    // 3. Venue filter honored; filtered-out primary is null.
    const filtered = await getJson(baseUrl, apiKey, `api/v2/execution/links?mint=${CBBTC_MINT}&venues=orca,jupiter`);
    const filteredResult = assertLinksResponse(filtered, 'links(filtered)');
    assert(
        filteredResult.linkIds.join(',') === 'jupiter,orca',
        `venues filter not honored: ${filteredResult.linkIds.join(',')}`,
    );
    assert(filteredResult.primary === null, 'primary must be null when the recommended venue is filtered out');
    console.log('links(filtered): filter honored, primary nulled');

    // 4. assetId resolution.
    const byAsset = await getJson(baseUrl, apiKey, 'api/v2/execution/links?assetId=bitcoin');
    const assetResult = assertLinksResponse(byAsset, 'links(assetId)');
    assert(assetResult.linkIds.length > 0, 'assetId=bitcoin must resolve to venues');
    console.log('links(assetId): bitcoin resolved');

    // 5. Error envelopes.
    const badVenue = await getRaw(baseUrl, apiKey, `api/v2/execution/links?mint=${CBBTC_MINT}&venues=uniswap`);
    assert(badVenue.status === 400, `unknown venue must 400, got ${badVenue.status}`);
    const badVenueBody = (await badVenue.json()) as { error?: { _tag?: string } };
    assert(badVenueBody.error?._tag === 'BadRequestError', 'unknown venue must return the BadRequestError envelope');

    const unknownAsset = await getRaw(baseUrl, apiKey, 'api/v2/execution/links?assetId=not-a-real-asset');
    assert(unknownAsset.status === 404, `unknown asset must 404, got ${unknownAsset.status}`);

    const missing = await getRaw(baseUrl, apiKey, 'api/v2/execution/links');
    assert(missing.status === 400, `missing mint/assetId must 400, got ${missing.status}`);
    console.log('links(errors): 400/404 envelopes verified');

    // 6. Evaluate: scorecard (no amount) — graded ladders when depth is warm.
    const routeBody = await getJson(baseUrl, apiKey, 'api/v2/execution/evaluate?asset=bitcoin');
    const ranked = assertRouteResponse(routeBody, 'route(bitcoin)', { expectAmount: null });
    assert(ranked.variantMints.length > 1, 'bitcoin must rank multiple variants');
    console.log(`route(bitcoin): ${ranked.variantMints.length} variants, primary=${ranked.primaryMint ?? 'null'}`);

    // 7. Evaluate: sized request (fields typed, tolerant of no depth data yet).
    const sized = await getJson(baseUrl, apiKey, 'api/v2/execution/evaluate?asset=bitcoin&amountUsd=1000000');
    assertRouteResponse(sized, 'route(bitcoin, $1M)', { expectAmount: 1_000_000 });
    console.log('route(bitcoin, $1M): size-aware contract verified');

    // 8. Evaluate errors.
    const routeUnknown = await getRaw(baseUrl, apiKey, 'api/v2/execution/evaluate?asset=not-a-real-asset');
    assert(routeUnknown.status === 404, `unknown asset must 404, got ${routeUnknown.status}`);
    const routeMissing = await getRaw(baseUrl, apiKey, 'api/v2/execution/evaluate');
    assert(routeMissing.status === 400, `missing asset must 400, got ${routeMissing.status}`);
    const routeBadAmount = await getRaw(baseUrl, apiKey, 'api/v2/execution/evaluate?asset=bitcoin&amountUsd=-1');
    assert(routeBadAmount.status === 400, `negative amountUsd must 400, got ${routeBadAmount.status}`);
    console.log('route(errors): 400/404 envelopes verified');

    console.log('v2 execution API contract OK');
}

function assertNullableNumber(value: unknown, path: string): void {
    if (value === null) return;
    assert(typeof value === 'number' && Number.isFinite(value), `${path} must be a finite number or null`);
}

function assertRouteResponse(
    body: unknown,
    label: string,
    opts: { expectAmount: number | null },
): { variantMints: string[]; primaryMint: string | null } {
    assertObject(body, label);
    assertObject(body.asset, `${label}.asset`);
    assert(typeof body.asset.assetId === 'string', `${label}.asset.assetId must be a string`);
    assert(body.side === 'buy' || body.side === 'sell', `${label}.side must be buy or sell`);
    assert(body.amountUsd === opts.expectAmount, `${label}.amountUsd must echo ${String(opts.expectAmount)}`);
    assert(Array.isArray(body.variants), `${label}.variants must be an array`);

    const variantMints: string[] = [];
    body.variants.forEach((entry, i) => {
        const path = `${label}.variants[${i}]`;
        assertObject(entry, path);
        assert(typeof entry.mint === 'string' && entry.mint.length > 0, `${path}.mint must be a string`);
        assert(typeof entry.variantId === 'string', `${path}.variantId must be a string`);
        assert(entry.rank === i + 1, `${path}.rank must be ${i + 1}`);
        assertNullableNumber(entry.liquidityUsd, `${path}.liquidityUsd`);
        assertNullableNumber(entry.executionScore, `${path}.executionScore`);
        assertNullableNumber(entry.estimatedImpactBps, `${path}.estimatedImpactBps`);
        assertNullableNumber(entry.sizeAwareScore, `${path}.sizeAwareScore`);
        // Graded ladder: null before the depth cron warms, otherwise ascending graded rungs.
        if (entry.ladder !== null) {
            assert(Array.isArray(entry.ladder), `${path}.ladder must be an array or null`);
            let previousSize = 0;
            entry.ladder.forEach((rung, r) => {
                const rungPath = `${path}.ladder[${r}]`;
                assertObject(rung, rungPath);
                assert(
                    typeof rung.sizeUsd === 'number' && rung.sizeUsd > previousSize,
                    `${rungPath}.sizeUsd must ascend`,
                );
                previousSize = rung.sizeUsd;
                assert(typeof rung.impactBps === 'number', `${rungPath}.impactBps must be a number`);
                assert(IMPACT_GRADES.includes(rung.grade as string), `${rungPath}.grade must be a known grade`);
            });
        }
        if (entry.executionGrade !== null) {
            assert(
                IMPACT_GRADES.includes(entry.executionGrade as string),
                `${path}.executionGrade must be a known grade or null`,
            );
        }
        assert(typeof entry.isFillQualityEligible === 'boolean', `${path}.isFillQualityEligible must be boolean`);
        assert(Array.isArray(entry.reasons) && entry.reasons.length > 0, `${path}.reasons must be non-empty`);
        variantMints.push(entry.mint);
    });

    let primaryMint: string | null = null;
    if (body.primary !== null) {
        assertObject(body.primary, `${label}.primary`);
        assert(typeof body.primary.mint === 'string', `${label}.primary.mint must be a string`);
        assert(variantMints.includes(body.primary.mint), `${label}.primary.mint must be a ranked variant`);
        primaryMint = body.primary.mint as string;
    }

    assertObject(body.meta, `${label}.meta`);
    assert(typeof body.meta.scoringVersion === 'string', `${label}.meta.scoringVersion must be a string`);
    assert(typeof body.meta.gradingVersion === 'string', `${label}.meta.gradingVersion must be a string`);
    assertObject(body.meta.depthCoverage, `${label}.meta.depthCoverage`);
    assert(
        typeof body.meta.depthCoverage.withCurves === 'number' && typeof body.meta.depthCoverage.total === 'number',
        `${label}.meta.depthCoverage must have numeric withCurves/total`,
    );
    assert(
        body.meta.strategy === 'execution_quality' || body.meta.strategy === 'size_aware',
        `${label}.meta.strategy must be execution_quality or size_aware`,
    );
    return { variantMints, primaryMint };
}

main().catch(error => {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(1);
});
