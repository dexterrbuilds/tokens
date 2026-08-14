const TRANSIENT_DB_CODES = new Set([
    'CONNECT_TIMEOUT',
    'CONNECTION_CLOSED',
    'CONNECTION_ENDED',
    'CONNECTION_DESTROYED',
    'ECONNRESET',
    'ETIMEDOUT',
]);

const TRANSIENT_CODE_RE =
    /\b(CONNECT_TIMEOUT|CONNECTION_CLOSED|CONNECTION_ENDED|CONNECTION_DESTROYED|ECONNRESET|ETIMEDOUT)\b/;

export interface AtomicReadRetryOptions {
    random?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
    onRetry?: (details: { operation: string; errorCode: string; delayMs: number; elapsedMs: number }) => void;
}

function errorCause(error: unknown): unknown {
    if (!error || typeof error !== 'object') return undefined;
    return (error as { cause?: unknown }).cause;
}

/** Resolve postgres/Bun socket codes even when a driver only includes the code in its message. */
export function databaseErrorCode(error: unknown): string | null {
    let current: unknown = error;
    for (let depth = 0; depth < 5 && current !== undefined; depth += 1) {
        if (current && typeof current === 'object') {
            const value = current as { code?: unknown; errno?: unknown; message?: unknown };
            const explicit = value.code ?? value.errno;
            if (typeof explicit === 'string' && explicit.trim()) return explicit.trim().toUpperCase();
            if (typeof value.message === 'string') {
                const match = value.message.toUpperCase().match(TRANSIENT_CODE_RE);
                if (match?.[1]) return match[1];
            }
        } else if (typeof current === 'string') {
            const match = current.toUpperCase().match(TRANSIENT_CODE_RE);
            if (match?.[1]) return match[1];
        }
        current = errorCause(current);
    }
    return null;
}

export function isTransientDatabaseError(error: unknown): boolean {
    const code = databaseErrorCode(error);
    return code !== null && TRANSIENT_DB_CODES.has(code);
}

/**
 * Retry one atomic, idempotent read once. Composite handlers must never use
 * this wrapper because replaying a wide fan-out multiplies the incident load.
 */
export async function runAtomicReadWithRetry<T>(
    operation: string,
    run: () => Promise<T>,
    options: AtomicReadRetryOptions = {},
): Promise<T> {
    const startedAt = Date.now();
    try {
        return await run();
    } catch (error) {
        if (!isTransientDatabaseError(error)) throw error;
        const random = options.random ?? Math.random;
        const delayMs = 100 + Math.floor(random() * 201);
        const errorCode = databaseErrorCode(error) ?? 'UNKNOWN';
        options.onRetry?.({ operation, errorCode, delayMs, elapsedMs: Date.now() - startedAt });
        await (options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))))(delayMs);
        return run();
    }
}

export function structuredDatabaseFailure(
    operation: string,
    error: unknown,
    options: { attempts: number; elapsedMs: number },
): Record<string, string | number> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
        event: 'cloudrun_assets_db_operation_failure',
        operation,
        errorCode: databaseErrorCode(error) ?? 'UNKNOWN',
        attempt: options.attempts,
        attempts: options.attempts,
        elapsedMs: options.elapsedMs,
        revision: process.env.K_REVISION?.trim() || 'local',
        instanceId: process.env.HOSTNAME?.trim() || 'local',
        errorMessage: errorMessage.slice(0, 500),
    };
}
