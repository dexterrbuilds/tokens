import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';

// Point git at the tracked hooks directory so the pre-commit secret scan runs
// for every clone. Safe to re-run; skipped entirely outside a git checkout
// (e.g. tarball installs in CI images).
try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
} catch {
    process.exit(0);
}

if (!existsSync('.githooks/pre-commit')) process.exit(0);

try {
    chmodSync('.githooks/pre-commit', 0o755);
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
} catch {
    // Best-effort: never fail the install over hook setup.
}
