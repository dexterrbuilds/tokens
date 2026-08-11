#!/usr/bin/env bun
/**
 * Generates `packages/asset-registry/src/data/curated-token-added-at.ts` — a map of
 * curated token mint address → the unix timestamp (ms) of the commit that first added
 * it to the curated token data files.
 *
 * This is what powers "Latest Added" on the home page: instead of manually keeping the
 * newest mint at the end of the array (which drifted out of sync), the latest token is
 * literally the most recently committed address.
 *
 * Usage:
 *   bun scripts/generate-curated-token-added-at.ts
 *
 * NOTE: with the no-PR admin pipeline, normal token adds go through the admin
 * UI, which stamps `added_at` in Postgres at insert time — no regeneration
 * needed. This script remains for the rare bulk-import PR that adds mints to
 * the committed registry files (the map also seeds the DB `added_at` values
 * via the one-time `backfill-curated-added-at` job and new registry inserts).
 *
 * Run this after adding new mints to any curated list **via a registry PR**.
 * Addresses present in the working tree but not yet committed are stamped with
 * the current time (they are, by definition, the newest) and will settle to
 * their real commit time on the next regeneration.
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Data files whose git history defines when a curated mint was "added". */
const CURATED_DATA_FILES = [
    'packages/asset-registry/src/data/curated-token-lists.ts',
    'packages/asset-registry/src/data/ondo-stock-mints.ts',
];

const OUTPUT_PATH = join(REPO_ROOT, 'packages/asset-registry/src/data/curated-token-added-at.ts');

const MINT_IN_STRING_RE = /['"]([1-9A-HJ-NP-Za-km-z]{32,44})['"]/g;
// ondo-stock-mints.ts stores bare addresses (one per line) inside a template literal.
const BARE_MINT_LINE_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function git(args: string[]): string {
    const result = spawnSync('git', args, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 512 * 1024 * 1024,
    });
    if (result.status !== 0) {
        throw new Error(`git ${args.slice(0, 3).join(' ')}… failed: ${result.stderr}`);
    }
    return result.stdout;
}

/** Collect every historical path of a file (renames included) so `git log -p` sees full history. */
function historicalPathsOf(file: string): string[] {
    const out = git(['log', '--follow', '--name-only', '--format=', '--', file]);
    const paths = new Set<string>([file]);
    for (const line of out.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) paths.add(trimmed);
    }
    return [...paths];
}

function collectAddedAtFromHistory(paths: string[]): Map<string, number> {
    // Oldest → newest with patches; the first commit that adds a mint line wins.
    const log = git(['log', '--reverse', '-p', '--format=@commit\t%H\t%ct', '--', ...paths]);

    const addedAtMs = new Map<string, number>();
    let currentCommitMs = 0;

    for (const line of log.split('\n')) {
        if (line.startsWith('@commit\t')) {
            const seconds = Number(line.split('\t')[2]);
            currentCommitMs = Number.isFinite(seconds) ? seconds * 1000 : 0;
            continue;
        }
        if (!line.startsWith('+') || line.startsWith('+++')) continue;

        for (const match of line.matchAll(MINT_IN_STRING_RE)) {
            const mint = match[1]!;
            if (!addedAtMs.has(mint)) addedAtMs.set(mint, currentCommitMs);
        }

        const bare = line.slice(1).trim();
        if (BARE_MINT_LINE_RE.test(bare) && !addedAtMs.has(bare)) {
            addedAtMs.set(bare, currentCommitMs);
        }
    }

    return addedAtMs;
}

async function main() {
    const paths = CURATED_DATA_FILES.flatMap(historicalPathsOf);
    const historyAddedAt = collectAddedAtFromHistory([...new Set(paths)]);

    // Only keep mints that are currently part of a curated list.
    const { CURATED_TOKEN_LISTS } = await import('../packages/asset-registry/src/data/curated-token-lists');

    const entries: Array<[mint: string, addedAtMs: number]> = [];
    const seen = new Set<string>();
    const uncommitted: string[] = [];

    for (const list of Object.values(CURATED_TOKEN_LISTS)) {
        for (const address of list.addresses) {
            if (seen.has(address)) continue;
            seen.add(address);

            const fromHistory = historyAddedAt.get(address);
            if (fromHistory !== undefined) {
                entries.push([address, fromHistory]);
            } else {
                // Present in the working tree but not committed yet — it's the newest.
                uncommitted.push(address);
                entries.push([address, Date.now()]);
            }
        }
    }

    if (uncommitted.length > 0) {
        console.warn(
            `warning: ${uncommitted.length} address(es) not found in git history (uncommitted?); ` +
                `stamped with the current time:\n  ${uncommitted.join('\n  ')}`,
        );
    }

    // Stable output: sort by addedAt, then address, for reviewable diffs.
    entries.sort(([mintA, a], [mintB, b]) => a - b || (mintA < mintB ? -1 : 1));

    const body = entries.map(([mint, ts]) => `    '${mint}': ${ts}, // ${new Date(ts).toISOString().slice(0, 10)}`);
    const file = [
        '// GENERATED FILE — do not edit by hand.',
        '// Regenerate with: bun scripts/generate-curated-token-added-at.ts',
        '//',
        '// Maps curated token mint address → unix ms of the commit that first added it to',
        '// the curated token lists. Used to derive the "Latest Added" home highlight.',
        '',
        'export const CURATED_TOKEN_ADDED_AT: Record<string, number> = {',
        ...body,
        '};',
        '',
    ].join('\n');

    writeFileSync(OUTPUT_PATH, file);
    console.log(`wrote ${entries.length} entries to ${OUTPUT_PATH}`);
}

await main();
