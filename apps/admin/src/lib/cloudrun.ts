import 'server-only';

/**
 * Minimal Cloud Run client for the admin app (admin + assets services).
 *
 * Auth for the hop to Cloud Run, in order of preference:
 * 1. Vercel OIDC → GCP Workload Identity Federation: exchange the request-time
 *    `VERCEL_OIDC_TOKEN` for a Google ID token minted as the dedicated invoker
 *    SA, with the target service URL as audience. Cloud Run IAM verifies it on
 *    the IAM-gated admin service; cloudrun-assets verifies it in-app against
 *    the same audience/SA pinning (`oidc.ts`). Requires `GCP_WIF_AUDIENCE` and
 *    `GCP_ADMIN_INVOKER_SA`.
 * 2. Legacy shared bearer (`TOKENS_CLOUDRUN_AUTH_TOKEN`) — local dev only; the
 *    shared bearer must not be configured on the deployed Vercel project.
 *
 * Either way the Clerk-session-verified caller travels in the base64
 * `x-tokens-identity` header (same wire contract as apps/api's client).
 */

export interface CloudRunCallerIdentity {
    clerkUserId: string;
    email?: string;
}

const SERVICE_URL_ENV: Record<'admin' | 'assets', string> = {
    admin: 'TOKENS_CLOUDRUN_ADMIN_URL',
    assets: 'TOKENS_CLOUDRUN_ASSETS_URL',
};

const STS_URL = 'https://sts.googleapis.com/v1/token';

export class CloudRunCallError extends Error {
    constructor(
        message: string,
        readonly service: string,
        readonly callName: string,
        readonly status?: number,
        readonly body?: string,
    ) {
        super(message);
        this.name = 'CloudRunCallError';
    }
}

function requireEnv(name: string): string {
    const v = process.env[name]?.trim();
    if (!v) throw new Error(`CloudRun client: missing required env var ${name}`);
    return v;
}

interface CachedIdToken {
    token: string;
    expiresAtMs: number;
}

// Google ID tokens live ~1h; refresh with margin. Keyed by audience (one per service).
const ID_TOKEN_TTL_MS = 50 * 60 * 1000;
const idTokenCache = new Map<string, CachedIdToken>();

function isWifConfigured(): boolean {
    return Boolean(process.env.GCP_WIF_AUDIENCE?.trim() && process.env.GCP_ADMIN_INVOKER_SA?.trim());
}

async function fetchJson(url: string, init: RequestInit, context: string): Promise<Record<string, unknown>> {
    const res = await fetch(url, init);
    const body = await res.text();
    if (!res.ok) {
        throw new Error(`${context} failed: HTTP ${res.status} ${body.slice(0, 512)}`);
    }
    return JSON.parse(body) as Record<string, unknown>;
}

/**
 * VERCEL_OIDC_TOKEN → STS federated access token → SA-minted Google ID token
 * with the target service's URL as audience.
 */
async function mintGoogleIdToken(audience: string): Promise<string> {
    const now = Date.now();
    const cached = idTokenCache.get(audience);
    if (cached && cached.expiresAtMs > now) return cached.token;

    const vercelOidcToken = process.env.VERCEL_OIDC_TOKEN?.trim();
    if (!vercelOidcToken) {
        throw new Error('CloudRun client: VERCEL_OIDC_TOKEN is not available (enable Vercel OIDC on the project)');
    }
    const wifAudience = requireEnv('GCP_WIF_AUDIENCE');
    const invokerSa = requireEnv('GCP_ADMIN_INVOKER_SA');

    const sts = await fetchJson(
        STS_URL,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                audience: wifAudience,
                grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
                requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
                scope: 'https://www.googleapis.com/auth/cloud-platform',
                subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
                subjectToken: vercelOidcToken,
            }),
        },
        'GCP STS token exchange',
    );
    const federatedToken = typeof sts.access_token === 'string' ? sts.access_token : '';
    if (!federatedToken) throw new Error('GCP STS token exchange returned no access_token');

    const minted = await fetchJson(
        `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(invokerSa)}:generateIdToken`,
        {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${federatedToken}`,
            },
            body: JSON.stringify({ audience, includeEmail: true }),
        },
        'GCP generateIdToken',
    );
    const idToken = typeof minted.token === 'string' ? minted.token : '';
    if (!idToken) throw new Error('GCP generateIdToken returned no token');

    idTokenCache.set(audience, { token: idToken, expiresAtMs: now + ID_TOKEN_TTL_MS });
    return idToken;
}

async function buildAuthorizationHeader(baseUrl: string): Promise<string> {
    if (isWifConfigured()) {
        return `Bearer ${await mintGoogleIdToken(baseUrl)}`;
    }
    return `Bearer ${requireEnv('TOKENS_CLOUDRUN_AUTH_TOKEN')}`;
}

export async function callCloudRun<T>(
    service: 'admin' | 'assets',
    kind: 'query' | 'mutation',
    name: string,
    args: Record<string, unknown>,
    identity: CloudRunCallerIdentity,
    timeoutMs = 15_000,
): Promise<T> {
    const base = requireEnv(SERVICE_URL_ENV[service]).replace(/\/$/, '');

    let authorization: string;
    try {
        authorization = await buildAuthorizationHeader(base);
    } catch (err) {
        throw new CloudRunCallError(`CloudRun ${kind} ${service}.${name} auth failed: ${String(err)}`, service, name);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(`${base}/${kind}/${encodeURIComponent(name)}`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'content-type': 'application/json',
                authorization,
                'x-tokens-identity': Buffer.from(JSON.stringify(identity), 'utf8').toString('base64'),
            },
            body: JSON.stringify(args),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new CloudRunCallError(
                `CloudRun ${kind} ${service}.${name} failed: HTTP ${res.status}`,
                service,
                name,
                res.status,
                body.slice(0, 1024),
            );
        }
        return (await res.json()) as T;
    } catch (err) {
        if (err instanceof CloudRunCallError) throw err;
        if (err instanceof Error && err.name === 'AbortError') {
            throw new CloudRunCallError(`CloudRun ${kind} ${service}.${name} timed out after ${timeoutMs}ms`, service, name);
        }
        throw new CloudRunCallError(`CloudRun ${kind} ${service}.${name} threw: ${String(err)}`, service, name);
    } finally {
        clearTimeout(timeout);
    }
}
