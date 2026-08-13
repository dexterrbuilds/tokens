/**
 * Shared handler error types for the cloudrun services, mapped to HTTP
 * statuses by each service's dispatcher. Previously triplicated across
 * cloudrun-admin, cloudrun-usage, and cloudrun-assets (twice).
 */

/** Malformed/invalid arguments → 400 `invalid_args`. */
export class InvalidArgsError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InvalidArgsError';
    }
}

/** Handler requires a caller identity (`x-tokens-identity`) and none was sent → 401 `identity_required`. */
export class IdentityRequiredError extends Error {
    constructor(message = 'caller identity required') {
        super(message);
        this.name = 'IdentityRequiredError';
    }
}

/** Caller identity failed an authorization check (membership/role/allowlist) → 403 `unauthorized`. */
export class UnauthorizedError extends Error {
    constructor(message = 'Unauthorized') {
        super(message);
        this.name = 'UnauthorizedError';
    }
}

export interface DispatchErrorResponse {
    body: { error: string; message?: string };
    status: 400 | 401 | 403 | 500;
}

/** Shared query/mutation dispatcher error mapping (full error logged, stack preserved). */
export function dispatchErrorResponse(
    serviceName: string,
    err: unknown,
    kind: string,
    name: string,
): DispatchErrorResponse {
    if (err instanceof InvalidArgsError) {
        return { body: { error: 'invalid_args', message: err.message }, status: 400 };
    }
    if (err instanceof IdentityRequiredError) {
        return { body: { error: 'identity_required' }, status: 401 };
    }
    if (err instanceof UnauthorizedError) {
        return { body: { error: 'unauthorized' }, status: 403 };
    }
    console.error(`[${serviceName}] ${kind} ${name} threw`, err);
    return { body: { error: 'handler_error' }, status: 500 };
}
