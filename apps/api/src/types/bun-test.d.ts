declare module 'bun:test' {
    export function describe(name: string, fn: () => void): void;
    export function it(name: string, fn: () => void): void;
    export const test: typeof it;
    export function beforeEach(fn: () => void | Promise<void>): void;
    export function afterEach(fn: () => void | Promise<void>): void;
    export function expect<T>(value: T): {
        toBe(expected: unknown): void;
        toBeCloseTo(expected: number, numDigits?: number): void;
        toBeInstanceOf(expected: unknown): void;
        toBeLessThan(expected: number): void;
        toBeLessThanOrEqual(expected: number): void;
        toBeNull(): void;
        toContain(expected: string): void;
        toEqual(expected: unknown): void;
        not: {
            toBe(expected: unknown): void;
            toBeNull(): void;
            toEqual(expected: unknown): void;
        };
    };
}
