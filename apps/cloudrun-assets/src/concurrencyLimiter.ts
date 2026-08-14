export type ConcurrencyLimiter = <T>(task: () => Promise<T>) => Promise<T>;

/** Small FIFO limiter used to keep one composite request from monopolizing the DB pool. */
export function createConcurrencyLimiter(maxConcurrency: number): ConcurrencyLimiter {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
        throw new Error('maxConcurrency must be a positive integer');
    }

    let active = 0;
    const queue: Array<() => void> = [];

    const drain = () => {
        while (active < maxConcurrency) {
            const start = queue.shift();
            if (!start) return;
            active += 1;
            start();
        }
    };

    return <T>(task: () => Promise<T>) =>
        new Promise<T>((resolve, reject) => {
            queue.push(() => {
                void task()
                    .then(resolve, reject)
                    .finally(() => {
                        active -= 1;
                        drain();
                    });
            });
            drain();
        });
}
