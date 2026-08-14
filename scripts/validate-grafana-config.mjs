import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = process.cwd();
const jsonRoots = ['alert-rules', 'dashboards', 'notification-policies'];
const errors = [];
const alertUids = new Map();
let checked = 0;

async function jsonFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(error => {
        if (error?.code === 'ENOENT') return [];
        throw error;
    });
    const files = [];
    for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) files.push(...(await jsonFiles(path)));
        else if (entry.isFile() && entry.name.endsWith('.json')) files.push(path);
    }
    return files;
}

for (const directory of jsonRoots) {
    for (const path of await jsonFiles(join(root, directory))) {
        const displayPath = relative(root, path);
        let document;
        try {
            document = JSON.parse(await readFile(path, 'utf8'));
            checked += 1;
        } catch (error) {
            errors.push(`${displayPath}: invalid JSON (${error.message})`);
            continue;
        }

        if (directory !== 'alert-rules') continue;
        const uid = document?.uid;
        if (typeof uid !== 'string' || uid.length === 0) {
            errors.push(`${displayPath}: missing non-empty top-level uid`);
            continue;
        }
        if (uid.length > 40) errors.push(`${displayPath}: alert uid is ${uid.length} characters; Grafana allows 40`);
        if (!/^[A-Za-z0-9_-]+$/.test(uid)) {
            errors.push(`${displayPath}: alert uid contains unsupported characters`);
        }
        const previous = alertUids.get(uid);
        if (previous) errors.push(`${displayPath}: alert uid duplicates ${previous}`);
        else alertUids.set(uid, displayPath);
    }
}

if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR: ${error}`);
    process.exit(1);
}

console.log(`Validated ${checked} Grafana JSON files (${alertUids.size} alert UIDs).`);
