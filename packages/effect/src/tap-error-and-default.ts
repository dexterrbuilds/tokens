import { Effect } from 'effect';

import { toApiErrorInfo } from './api-errors';

function shouldEscalate(error: unknown): boolean {
    return error instanceof TypeError || error instanceof SyntaxError;
}

export function tapErrorAndDefault<A>(
    operation: string,
    fallback: A,
    context?: Record<string, unknown>,
): <B, R>(effect: Effect.Effect<B, unknown, R>) => Effect.Effect<B | A, never, R> {
    return <B, R>(effect: Effect.Effect<B, unknown, R>) =>
        effect.pipe(
            Effect.catch(error => {
                if (shouldEscalate(error)) return Effect.die(error);

                const info = toApiErrorInfo(error);
                console.error('Defaulting after effect error', {
                    operation,
                    error: {
                        tag: info._tag,
                        message: info.message,
                        details: info.details,
                    },
                    ...(context ? { context } : {}),
                });

                return Effect.succeed(fallback as A);
            }),
        );
}
