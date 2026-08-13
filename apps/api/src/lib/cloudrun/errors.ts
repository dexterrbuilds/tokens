import { Data } from 'effect';
import type { MissingEnvError, UpstreamDataError } from '@tokens/effect';
import type { CloudRunCallKind, CloudRunService } from './client';

/** Upstream responded with a non-2xx status. */
export class CloudRunHttpError extends Data.TaggedError('CloudRunHttpError')<{
    message: string;
    service: CloudRunService;
    kind: CloudRunCallKind;
    callName: string;
    status: number;
    body?: string;
}> {}

/** The call exceeded its timeout (the in-flight fetch is interrupted). */
export class CloudRunTimeoutError extends Data.TaggedError('CloudRunTimeoutError')<{
    message: string;
    service: CloudRunService;
    kind: CloudRunCallKind;
    callName: string;
    timeoutMs: number;
}> {}

/** Network failure, or the upstream broke the JSON contract. */
export class CloudRunTransportError extends Data.TaggedError('CloudRunTransportError')<{
    message: string;
    service: CloudRunService;
    kind: CloudRunCallKind;
    callName: string;
    cause?: string;
}> {}

export type CloudRunError =
    | CloudRunHttpError
    | CloudRunTimeoutError
    | CloudRunTransportError
    | MissingEnvError
    | UpstreamDataError;

/** Timeouts and network failures are transient; upstream 5xx is transient-shaped. 4xx is caller/data-dependent. */
export function isRetryableCloudRunError(error: CloudRunError): boolean {
    switch (error._tag) {
        case 'CloudRunTimeoutError':
        case 'CloudRunTransportError':
            return true;
        case 'CloudRunHttpError':
            return error.status >= 500;
        case 'MissingEnvError':
        case 'UpstreamDataError':
            return false;
    }
}
