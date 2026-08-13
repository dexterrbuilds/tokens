/**
 * HTTP client for the GCP Cloud Run services (see `terraform/modules/cloud_run/`).
 *
 * The core API is Effect-native: `cloudRunQuery` / `cloudRunMutation` return
 * `Effect<T, CloudRunError>` and run against Effect's runtime abort signal, so
 * a client disconnect (route() runs handlers with `{ signal: request.signal }`)
 * interrupts in-flight backend calls.
 */

import { Duration, Effect, Schedule, type Schema } from 'effect';
import { MissingEnvError, type UpstreamDataError, decodeUpstreamOrFail } from '@tokens/effect';
import { loadEnv, resetEnvForTests } from '../env';
import {
    CloudRunHttpError,
    CloudRunTimeoutError,
    CloudRunTransportError,
    isRetryableCloudRunError,
    type CloudRunError,
} from './errors';

export type CloudRunService = 'assets' | 'prices' | 'usage' | 'admin';

export type CloudRunCallKind = 'query' | 'mutation';

export interface CloudRunCallerIdentity {
    clerkUserId: string;
    projectId?: string;
}

export interface CloudRunCallOptions {
    identity?: CloudRunCallerIdentity;
    /**
     * Optional response schema, decoded STRICTLY (our own contract; excess
     * keys are dropped, so additive upstream deploys never break us). A
     * mismatch fails with a tagged UpstreamDataError (500).
     */
    schema?: Schema.ConstraintDecoder<unknown>;
    /** Per-call timeout override in ms. Defaults to the client-level timeout (15s). */
    timeoutMs?: number;
    /**
     * Retries on retryable failures (timeout, network error, HTTP 5xx) after
     * the first attempt. Defaults to 0 (no retry). Honored only for queries —
     * mutations are never retried, since they may not be safe to replay.
     */
    maxRetries?: number;
    /** Base delay between retry attempts in ms (exponential with jitter). Defaults to 150. */
    retryDelayMs?: number;
}

export const CLOUDRUN_IDENTITY_HEADER = 'x-tokens-identity';

export function encodeCallerIdentity(identity: CloudRunCallerIdentity): string {
    const json = JSON.stringify(identity);
    return Buffer.from(json, 'utf8').toString('base64');
}

export interface CloudRunClientConfig {
    /** Per-service base URLs (Cloud Run service URLs or LB-fronted hostnames). */
    baseUrls: Partial<Record<CloudRunService, string>>;
    /** Bearer token sent in the `Authorization` header. */
    authToken: string;
    /** Per-request timeout. Defaults to 15s. */
    timeoutMs?: number;
    /** Override the global `fetch` (test injection). */
    fetch?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export interface CloudRunCaller {
    query<TResult = unknown>(
        service: CloudRunService,
        name: string,
        args?: Record<string, unknown>,
        options?: CloudRunCallOptions,
    ): Effect.Effect<TResult, CloudRunError>;
    mutation<TResult = unknown>(
        service: CloudRunService,
        name: string,
        args?: Record<string, unknown>,
        options?: CloudRunCallOptions,
    ): Effect.Effect<TResult, CloudRunError>;
}

/** Build a caller from explicit config (test seam; production uses the env-backed singleton). */
export function makeCloudRunCaller(cfg: CloudRunClientConfig): CloudRunCaller {
    const fetchImpl = cfg.fetch ?? fetch;
    const defaultTimeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    function callOnce<T>(
        base: string,
        service: CloudRunService,
        kind: CloudRunCallKind,
        name: string,
        args: Record<string, unknown>,
        timeoutMs: number,
        identity: CloudRunCallerIdentity | undefined,
        schema: Schema.ConstraintDecoder<unknown> | undefined,
    ): Effect.Effect<T, CloudRunError> {
        const url = `${base.replace(/\/$/, '')}/${kind}/${encodeURIComponent(name)}`;
        const headers: Record<string, string> = {
            'content-type': 'application/json',
            authorization: `Bearer ${cfg.authToken}`,
            'accept-encoding': 'gzip, deflate',
        };
        if (identity) {
            headers[CLOUDRUN_IDENTITY_HEADER] = encodeCallerIdentity(identity);
        }

        return Effect.tryPromise({
            try: (signal: AbortSignal) =>
                fetchImpl(url, {
                    method: 'POST',
                    signal,
                    headers,
                    body: JSON.stringify(args),
                }),
            catch: err =>
                new CloudRunTransportError({
                    message: `CloudRun ${kind} ${service}.${name} threw: ${String(err)}`,
                    service,
                    kind,
                    callName: name,
                    cause: err instanceof Error ? err.message : String(err),
                }),
        }).pipe(
            Effect.flatMap(res => {
                if (!res.ok) {
                    return Effect.tryPromise(() => res.text()).pipe(
                        Effect.catch(() => Effect.succeed('')),
                        Effect.flatMap(body =>
                            Effect.fail(
                                new CloudRunHttpError({
                                    message: `CloudRun ${kind} ${service}.${name} failed: HTTP ${res.status}`,
                                    service,
                                    kind,
                                    callName: name,
                                    status: res.status,
                                    body: body.slice(0, 1024),
                                }),
                            ),
                        ),
                    ) as Effect.Effect<T, CloudRunError>;
                }
                return Effect.tryPromise({
                    try: () => res.json() as Promise<T>,
                    catch: err =>
                        new CloudRunTransportError({
                            message: `CloudRun ${kind} ${service}.${name} returned invalid JSON`,
                            service,
                            kind,
                            callName: name,
                            cause: err instanceof Error ? err.message : String(err),
                        }),
                }).pipe(
                    Effect.flatMap(payload => {
                        if (!schema) return Effect.succeed(payload);
                        return decodeUpstreamOrFail(schema, `cloudrun:${service}.${name}`)(
                            payload,
                        ) as Effect.Effect<T, UpstreamDataError, never>;
                    }),
                );
            }),
            Effect.timeout(Duration.millis(timeoutMs)),
            Effect.catchTag('TimeoutError', () =>
                Effect.fail(
                    new CloudRunTimeoutError({
                        message: `CloudRun ${kind} ${service}.${name} timed out after ${timeoutMs}ms`,
                        service,
                        kind,
                        callName: name,
                        timeoutMs,
                    }),
                ),
            ),
        );
    }

    function call<T>(
        service: CloudRunService,
        kind: CloudRunCallKind,
        name: string,
        args: Record<string, unknown>,
        options: CloudRunCallOptions,
    ): Effect.Effect<T, CloudRunError> {
        return Effect.suspend(() => {
            const base = cfg.baseUrls[service];
            if (!base) {
                return Effect.fail(
                    new MissingEnvError({
                        message: `CloudRunClient: no base URL configured for service '${service}'`,
                        name: `TOKENS_CLOUDRUN_${service.toUpperCase()}_URL`,
                    }),
                );
            }

            const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
            const attempt = callOnce<T>(base, service, kind, name, args, timeoutMs, options.identity, options.schema);

            // Mutations are never retried regardless of options — replaying a
            // non-idempotent call is worse than failing it.
            const maxRetries = kind === 'query' ? Math.max(0, options.maxRetries ?? 0) : 0;
            if (maxRetries === 0) return attempt;

            const retryDelayMs = Math.max(0, options.retryDelayMs ?? 150);
            // Jitter de-synchronizes retries across concurrent callers so a
            // shared upstream blip doesn't turn into a thundering herd.
            return Effect.retry(attempt, {
                while: isRetryableCloudRunError,
                times: maxRetries,
                schedule: Schedule.exponential(Duration.millis(Math.max(1, retryDelayMs))).pipe(Schedule.jittered),
            });
        });
    }

    return {
        query: (service, name, args = {}, options = {}) => call(service, 'query', name, args, options),
        mutation: (service, name, args = {}, options = {}) => call(service, 'mutation', name, args, options),
    };
}

// -----------------------------------------------------------------------------
// Env-backed singleton
// -----------------------------------------------------------------------------

let cachedConfig: CloudRunClientConfig | null = null;
let cachedCaller: CloudRunCaller | null = null;

function readConfigFromEnv(): CloudRunClientConfig | MissingEnvError {
    const cloudRun = loadEnv().cloudRun;
    if (cloudRun === null) {
        const missing = [
            'TOKENS_CLOUDRUN_AUTH_TOKEN',
            'TOKENS_CLOUDRUN_ASSETS_URL',
            'TOKENS_CLOUDRUN_PRICES_URL',
            'TOKENS_CLOUDRUN_USAGE_URL',
        ].find(name => !process.env[name]?.trim());
        return new MissingEnvError({
            message: `CloudRun client: missing required env var ${missing ?? 'TOKENS_CLOUDRUN_AUTH_TOKEN'}`,
            name: missing ?? 'TOKENS_CLOUDRUN_AUTH_TOKEN',
        });
    }

    return {
        baseUrls: {
            assets: cloudRun.urls.assets,
            prices: cloudRun.urls.prices,
            usage: cloudRun.urls.usage,
            ...(cloudRun.urls.admin ? { admin: cloudRun.urls.admin } : {}),
        },
        authToken: cloudRun.authToken,
        ...(cloudRun.timeoutMs !== undefined ? { timeoutMs: cloudRun.timeoutMs } : {}),
    };
}

/**
 * Resolve the CloudRun client config from the environment (cached).
 *
 * Required env:
 * - TOKENS_CLOUDRUN_AUTH_TOKEN
 * - TOKENS_CLOUDRUN_{ASSETS,PRICES,USAGE}_URL
 *
 * Optional:
 * - TOKENS_CLOUDRUN_ADMIN_URL
 * - TOKENS_CLOUDRUN_TIMEOUT_MS (default 15000)
 */
export function getCloudRunConfig(): Effect.Effect<CloudRunClientConfig, MissingEnvError> {
    return Effect.suspend(() => {
        if (cachedConfig) return Effect.succeed(cachedConfig);
        const config = readConfigFromEnv();
        if (config instanceof MissingEnvError) return Effect.fail(config);
        cachedConfig = config;
        return Effect.succeed(config);
    });
}

function getCaller(): Effect.Effect<CloudRunCaller, MissingEnvError> {
    return Effect.suspend(() => {
        if (cachedCaller) return Effect.succeed(cachedCaller);
        return getCloudRunConfig().pipe(
            Effect.map(config => {
                cachedCaller = makeCloudRunCaller(config);
                return cachedCaller;
            }),
        );
    });
}

/** Run a query against a Cloud Run service. Fails with a tagged `CloudRunError`. */
export function cloudRunQuery<TResult = unknown>(
    service: CloudRunService,
    name: string,
    args: Record<string, unknown> = {},
    options: CloudRunCallOptions = {},
): Effect.Effect<TResult, CloudRunError> {
    return getCaller().pipe(Effect.flatMap(caller => caller.query<TResult>(service, name, args, options)));
}

/** Run a mutation against a Cloud Run service. Never retried. */
export function cloudRunMutation<TResult = unknown>(
    service: CloudRunService,
    name: string,
    args: Record<string, unknown> = {},
    options: CloudRunCallOptions = {},
): Effect.Effect<TResult, CloudRunError> {
    return getCaller().pipe(Effect.flatMap(caller => caller.mutation<TResult>(service, name, args, options)));
}

/** Test helper — reset the singletons between tests that toggle env vars. */
export function __resetCloudRunClientForTesting() {
    cachedConfig = null;
    cachedCaller = null;
    // Config now flows through loadEnv(); tests that toggle env need both caches cleared.
    resetEnvForTests();
}
