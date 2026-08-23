import { decode } from '@msgpack/msgpack';
import bs58 from 'bs58';

import { withExternalTiming } from './externalTiming';
import type { ExactQuote, ExactQuoteClient, ExecutionRouteStep } from './handlers/liveQuotes';

export const TITAN_DEMO_BASE_URL = 'https://us1.api.demo.titan.exchange';
export const TITAN_DEFAULT_QUOTE_USER_PUBLIC_KEY = 'Fake111111111111111111111111111111111111111';

const QUOTE_PATH = '/api/v1/quote/swap';

export interface TitanRestClientOptions {
    authToken: string;
    baseUrl?: string;
    userPublicKey?: string;
    fetch?: typeof globalThis.fetch;
    maxRetries?: number;
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
}

export class TitanRestHttpError extends Error {
    constructor(
        readonly status: number,
        readonly responseBody: string,
    ) {
        super(`Titan REST quote failed with HTTP ${status}`);
        this.name = 'TitanRestHttpError';
    }
}

export class TitanRestMalformedResponseError extends Error {
    constructor(cause: unknown) {
        super('Titan REST returned malformed MessagePack', { cause });
        this.name = 'TitanRestMalformedResponseError';
    }
}

function normalizeBaseUrl(value: string): string {
    const trimmed = value.trim();
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return withProtocol.replace(/\/+$/, '');
}

export function isValidTitanQuotePublicKey(value: string): boolean {
    try {
        return bs58.decode(value).length === 32;
    } catch {
        return false;
    }
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function integerString(value: unknown, allowZero = false): string | null {
    if (typeof value === 'bigint') return value > 0n || (allowZero && value === 0n) ? value.toString() : null;
    if (typeof value === 'number' && Number.isSafeInteger(value) && (value > 0 || (allowZero && value === 0))) {
        return String(value);
    }
    if (typeof value === 'string' && /^\d+$/.test(value)) {
        const parsed = BigInt(value);
        return parsed > 0n || (allowZero && parsed === 0n) ? value : null;
    }
    return null;
}

function finiteNumber(value: unknown): number | null {
    const parsed = typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : NaN;
    return Number.isFinite(parsed) ? parsed : null;
}

function publicKey(value: unknown): string | null {
    if (typeof value === 'string') return isValidTitanQuotePublicKey(value) ? value : null;
    return value instanceof Uint8Array && value.length === 32 ? bs58.encode(value) : null;
}

function routeSteps(value: unknown): ExecutionRouteStep[] {
    if (!Array.isArray(value)) return [];
    return value.map(raw => {
        const step = asRecord(raw) ?? {};
        const allocation = finiteNumber(step.allocPpb);
        return {
            ammKey: publicKey(step.ammKey),
            label: typeof step.label === 'string' && step.label ? step.label : null,
            percent: allocation === null ? null : allocation / 10_000_000,
            inputMint: publicKey(step.inputMint),
            outputMint: publicKey(step.outputMint),
            inAmountRaw: integerString(step.inAmount),
            outAmountRaw: integerString(step.outAmount),
            feeAmountRaw: integerString(step.feeAmount, true),
            feeMint: publicKey(step.feeMint),
        };
    });
}

function normalizeQuote(value: unknown): ExactQuote | null {
    const root = asRecord(value);
    const quotes = asRecord(root?.quotes);
    if (!quotes) return null;

    let winner: ExactQuote | null = null;
    for (const raw of Object.values(quotes)) {
        const quote = asRecord(raw);
        if (!quote) continue;
        const inAmountRaw = integerString(quote.inAmount);
        const outAmountRaw = integerString(quote.outAmount);
        if (!inAmountRaw || !outAmountRaw) continue;
        const contextSlotRaw = finiteNumber(quote.contextSlot);
        const candidate: ExactQuote = {
            inAmountRaw,
            outAmountRaw,
            priceImpactPct: null,
            route: routeSteps(quote.steps),
            contextSlot:
                contextSlotRaw !== null && Number.isSafeInteger(contextSlotRaw) && contextSlotRaw > 0
                    ? contextSlotRaw
                    : null,
        };
        if (!winner || BigInt(candidate.outAmountRaw) > BigInt(winner.outAmountRaw)) winner = candidate;
    }
    return winner;
}

function shouldRetryStatus(status: number): boolean {
    return status === 408 || status === 429 || status >= 500;
}

export function makeTitanRestQuoteClient(options: TitanRestClientOptions): ExactQuoteClient {
    const baseUrl = normalizeBaseUrl(options.baseUrl ?? TITAN_DEMO_BASE_URL);
    const userPublicKey = (options.userPublicKey ?? TITAN_DEFAULT_QUOTE_USER_PUBLIC_KEY).trim();
    if (!isValidTitanQuotePublicKey(userPublicKey)) throw new Error('Invalid TITAN_QUOTE_USER_PUBLIC_KEY');
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const maxRetries = options.maxRetries ?? 2;
    const timeoutMs = options.timeoutMs ?? 15_000;
    const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));

    return {
        id: 'titan',
        async fetchQuote(args): Promise<ExactQuote | null> {
            const params = new URLSearchParams({
                inputMint: args.inputMint,
                outputMint: args.outputMint,
                amount: args.amountRaw,
                userPublicKey,
                slippageBps: '50',
            });
            const url = `${baseUrl}${QUOTE_PATH}?${params}`;

            for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
                try {
                    const response = await withExternalTiming('titan', url, () =>
                        fetchImpl(url, {
                            headers: { Authorization: `Bearer ${options.authToken}` },
                            signal: AbortSignal.timeout(timeoutMs),
                        }),
                    );
                    if (!response.ok) {
                        const body = (await response.text().catch(() => '')).slice(0, 1024);
                        if (shouldRetryStatus(response.status) && attempt < maxRetries) {
                            await sleep(150 * 2 ** attempt);
                            continue;
                        }
                        if (response.status === 400 || response.status === 404) return null;
                        throw new TitanRestHttpError(response.status, body);
                    }
                    const bytes = new Uint8Array(await response.arrayBuffer());
                    let decoded: unknown;
                    try {
                        decoded = decode(bytes, { useBigInt64: true });
                    } catch (error) {
                        throw new TitanRestMalformedResponseError(error);
                    }
                    return normalizeQuote(decoded);
                } catch (error) {
                    if (
                        error instanceof TitanRestHttpError ||
                        error instanceof TitanRestMalformedResponseError ||
                        attempt >= maxRetries
                    ) {
                        throw error;
                    }
                    await sleep(150 * 2 ** attempt);
                }
            }
            return null;
        },
    };
}

export const __testing = { normalizeQuote, routeSteps };
