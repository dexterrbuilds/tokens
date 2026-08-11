import { execFileSync } from 'node:child_process';
import { openSync, readSync, closeSync } from 'node:fs';

const ALLOWLIST = new Set([]);
const FORBIDDEN_ARTIFACT_SEGMENTS = new Set(['.claude', '.cursor', '.agents']);
const FORBIDDEN_FILENAMES = new Set(['.DS_Store']);
// Scratch / migration output directories must never be tracked: they have held
// production secrets and end-user PII in the past.
const FORBIDDEN_PREFIXES = ['tmp/', 'migration-output/'];

function readTrackedFiles() {
    const output = execFileSync('git', ['ls-files', '-z'], {
        cwd: process.cwd(),
        encoding: 'utf8',
    });

    return output
        .split('\0')
        .map(path => path.trim())
        .filter(Boolean);
}

function isEnvTemplate(path) {
    return path.endsWith('.env.example') || path.includes('.env.example.');
}

function isTrackedSecretFile(path) {
    const basename = path.split('/').pop() ?? path;
    if (!basename.startsWith('.env')) return false;
    if (isEnvTemplate(path)) return false;
    return true;
}

function hasForbiddenArtifactSegment(path) {
    const segments = path.split('/');
    return segments.some(segment => FORBIDDEN_ARTIFACT_SEGMENTS.has(segment));
}

function hasForbiddenFilename(path) {
    const basename = path.split('/').pop() ?? path;
    return FORBIDDEN_FILENAMES.has(basename);
}

function hasForbiddenPrefix(path) {
    return FORBIDDEN_PREFIXES.some(prefix => path.startsWith(prefix));
}

// Terraform plan/state artifacts embed provider credentials and full resource
// attributes in plaintext; they must never be tracked in a public repo.
function isTerraformArtifact(path) {
    const basename = path.split('/').pop() ?? path;
    if (basename.includes('.tfstate')) return true;
    if (path.startsWith('terraform/') && basename.startsWith('tfplan')) return true;
    if (basename.endsWith('.tfplan')) return true;
    return false;
}

// Terraform sources are text (.tf/.tfvars/.sh/.md); a tracked binary under
// terraform/ is almost certainly a plan/state bundle under another name.
function isBinaryFile(path) {
    let fd;
    try {
        fd = openSync(path, 'r');
    } catch {
        return false;
    }
    try {
        const buffer = Buffer.alloc(8192);
        const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
        return buffer.subarray(0, bytesRead).includes(0);
    } finally {
        closeSync(fd);
    }
}

const trackedFiles = readTrackedFiles();
const secretFileViolations = [];
const artifactViolations = [];
const junkFileViolations = [];
const scratchDirViolations = [];
const terraformArtifactViolations = [];

for (const path of trackedFiles) {
    if (ALLOWLIST.has(path)) continue;

    if (isTrackedSecretFile(path)) {
        secretFileViolations.push(path);
        continue;
    }

    if (hasForbiddenPrefix(path)) {
        scratchDirViolations.push(path);
        continue;
    }

    if (hasForbiddenArtifactSegment(path)) {
        artifactViolations.push(path);
        continue;
    }

    if (isTerraformArtifact(path) || (path.startsWith('terraform/') && isBinaryFile(path))) {
        terraformArtifactViolations.push(path);
        continue;
    }

    if (hasForbiddenFilename(path)) {
        junkFileViolations.push(path);
    }
}

if (
    secretFileViolations.length === 0 &&
    artifactViolations.length === 0 &&
    junkFileViolations.length === 0 &&
    scratchDirViolations.length === 0 &&
    terraformArtifactViolations.length === 0
) {
    console.log('Repo hygiene checks passed.');
    process.exit(0);
}

if (secretFileViolations.length > 0) {
    console.error('Tracked secret-bearing env files are not allowed:');
    for (const path of secretFileViolations) console.error(`- ${path}`);
}

if (artifactViolations.length > 0) {
    console.error('Tracked assistant/tooling artifacts are not allowed:');
    for (const path of artifactViolations) console.error(`- ${path}`);
}

if (junkFileViolations.length > 0) {
    console.error('Tracked junk files are not allowed:');
    for (const path of junkFileViolations) console.error(`- ${path}`);
}

if (scratchDirViolations.length > 0) {
    console.error('Tracked scratch/migration-output files are not allowed:');
    for (const path of scratchDirViolations) console.error(`- ${path}`);
}

if (terraformArtifactViolations.length > 0) {
    console.error('Tracked Terraform plan/state artifacts (or binaries under terraform/) are not allowed:');
    for (const path of terraformArtifactViolations) console.error(`- ${path}`);
}

process.exit(1);
