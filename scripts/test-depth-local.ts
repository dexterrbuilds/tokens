/* eslint-disable no-console */

/**
 * Local end-to-end test for the depth-sampling pipeline (no Cloud Run, no OIDC).
 *
 * Wires the real Titan quote client to the real cron handler against your local
 * Postgres, then reads the curves back the way the API does.
 *
 * Setup — add to apps/cloudrun-assets/.env.local:
 *   TITAN_WS_URL=wss://<your-endpoint>/api/v1/ws     # the URL Titan/Triton gave you
 *   TITAN_API_KEY=<your key>
 *
 * Usage (from repo root):
 *   bun scripts/test-depth-local.ts probe     # connect + one quote, no writes
 *   bun scripts/test-depth-local.ts run       # sample the 8 BTC mints, write curves
 *   bun scripts/test-depth-local.ts read      # print stored curves + interpolated impact
 */

import { SQL } from 'bun';

import { BITCOIN_VARIANT_GROUP } from '../packages/asset-registry/src/data/token-variants';
import { interpolateImpactBps } from '../packages/asset-registry/src/primary-variant-ranking';
import { makeTitanQuoteClient } from '../apps/cloudrun-assets/src/clients';
import {
    DEPTH_SIZE_LADDER_USD,
    DEPTH_USDC_QUOTE_MINT,
    listDepthUniverseMints,
    refreshDepthCurves,
} from '../apps/cloudrun-assets/src/handlers/crons.depth';
import { makePostgresDepthCurvesRepo, makePostgresDepthCurveReadsRepo } from '../apps/cloudrun-assets/src/db';

function loadEnvLocal(path: string): Record<string, string> {
    const out: Record<string, string> = {};
    let text = '';
    try {
        text = require('fs').readFileSync(path, 'utf8');
    } catch {
        return out;
    }
    for (const line of text.split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m) out[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, '');
    }
    return out;
}

const env = { ...loadEnvLocal('apps/cloudrun-assets/.env.local'), ...process.env } as Record<string, string>;
const mode = process.argv[2] ?? 'probe';

const wsUrl = (env.TITAN_WS_URL ?? '').trim();
const apiKey = (env.TITAN_API_KEY ?? '').trim();
const databaseUrl = (env.DATABASE_URL ?? '').trim();

if (!databaseUrl) {
    console.error('DATABASE_URL missing (expected in apps/cloudrun-assets/.env.local)');
    process.exit(1);
}
if (mode !== 'read' && (!wsUrl || !apiKey)) {
    console.error(
        'TITAN_WS_URL and TITAN_API_KEY must be set in apps/cloudrun-assets/.env.local\n' +
            `  TITAN_WS_URL: ${wsUrl ? 'set' : 'MISSING'}\n  TITAN_API_KEY: ${apiKey ? 'set' : 'MISSING'}`,
    );
    process.exit(1);
}

const sql = new SQL(databaseUrl);
const BTC_MINTS = BITCOIN_VARIANT_GROUP.addresses.map(a => a.address);

async function probe() {
    console.log(`connecting: ${wsUrl.replace(/\/\/[^/]+/, '//<host>')} (key ${apiKey.slice(0, 4)}…)`);
    const client = makeTitanQuoteClient({ wsUrl, authToken: apiKey });
    try {
        const started = performance.now();
        const quote = await client.fetchQuote({
            inputMint: DEPTH_USDC_QUOTE_MINT,
            outputMint: BTC_MINTS[1]!, // cbBTC
            amount: 10_000 * 1_000_000, // $10k
        });
        const ms = Math.round(performance.now() - started);
        if (!quote) {
            console.log(`no route returned (${ms}ms) — pair untradable or endpoint rejected the request`);
            return;
        }
        console.log(`OK in ${ms}ms: in=${quote.inAmount} out=${quote.outAmount}`);
        console.log(`  implied price: ${(quote.inAmount / 1e6 / (quote.outAmount / 1e8)).toFixed(2)} USDC/BTC`);
        console.log('First-quote latency matters for cron pacing — note this number.');
    } finally {
        await client.close();
    }
}

async function run() {
    const universe = listDepthUniverseMints();
    console.log(`universe: ${universe.length} mints total; sampling ${BTC_MINTS.length} BTC mints`);
    console.log(`ladder: ${DEPTH_SIZE_LADDER_USD.map(s => `$${(s / 1000).toLocaleString()}k`).join(', ')}`);

    const client = makeTitanQuoteClient({ wsUrl, authToken: apiKey });
    const result = await refreshDepthCurves(
        {
            quoteSource: client,
            repo: makePostgresDepthCurvesRepo(sql),
            now: () => Date.now(),
            env: () => ({ DEPTH_REFRESH_ENABLED: 'true' }) as NodeJS.ProcessEnv,
        },
        { mints: BTC_MINTS, delayMs: 500, requireRefreshEnabled: false },
    );
    console.log('\ncron result:', JSON.stringify(result, null, 2));
}

async function read() {
    const entries = await makePostgresDepthCurveReadsRepo(sql).findLatestByMints({
        mints: BTC_MINTS,
        quoteMint: DEPTH_USDC_QUOTE_MINT,
        side: 'buy',
        source: 'titan',
    });
    if (entries.length === 0) {
        console.log('no curves stored yet — run: bun scripts/test-depth-local.ts run');
        return;
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    for (const row of entries) {
        const ladder = (row.ladder as Array<{ sizeUsd: number; priceImpactBps: number | null }>) ?? [];
        const ageMin = Math.round((nowSeconds - Number(row.as_of)) / 60);
        console.log(`\n${row.mint}  (age ${ageMin}m, points=${row.points}, failed=${row.failed_points})`);
        for (const rung of ladder) {
            console.log(`  $${(rung.sizeUsd / 1000).toLocaleString()}k -> ${rung.priceImpactBps ?? 'null'} bps`);
        }
        for (const size of [50_000, 1_000_000, 20_000_000]) {
            const interp = interpolateImpactBps(ladder, size);
            console.log(
                `  interp @$${(size / 1000).toLocaleString()}k: ` +
                    (interp ? `${interp.impactBps} bps${interp.extrapolated ? ' (extrapolated)' : ''}` : 'null'),
            );
        }
    }
}

try {
    if (mode === 'probe') await probe();
    else if (mode === 'run') await run();
    else if (mode === 'read') await read();
    else {
        console.error(`unknown mode: ${mode} (use probe | run | read)`);
        process.exit(1);
    }
} finally {
    await sql.end();
}
