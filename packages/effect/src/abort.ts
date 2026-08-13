export interface MergeSignalsResult {
    signal: AbortSignal;
    cleanup: () => void;
}

/**
 * Merge two abort signals into one that fires when either does. Used to
 * combine Effect's interruption signal with a caller-supplied request signal.
 */
export function mergeSignals(primary: AbortSignal, secondary?: AbortSignal): MergeSignalsResult {
    const noop = () => {};
    if (!secondary) return { signal: primary, cleanup: noop };
    const secondarySignal = secondary;

    // Prefer native AbortSignal.any when available.
    const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
    if (typeof anyFn === 'function') return { signal: anyFn([primary, secondarySignal]), cleanup: noop };

    if (primary.aborted) return { signal: primary, cleanup: noop };
    if (secondarySignal.aborted) return { signal: secondarySignal, cleanup: noop };

    const controller = new AbortController();

    function onAbort() {
        cleanup();
        controller.abort();
    }

    primary.addEventListener('abort', onAbort, { once: true });
    secondarySignal.addEventListener('abort', onAbort, { once: true });

    function cleanup() {
        primary.removeEventListener('abort', onAbort);
        secondarySignal.removeEventListener('abort', onAbort);
    }

    return { signal: controller.signal, cleanup };
}
