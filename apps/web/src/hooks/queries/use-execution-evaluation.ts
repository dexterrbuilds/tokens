'use client';

import * as React from 'react';
import { Effect } from 'effect';

import { apiJson } from '@/effect/api-client';

export type ExecutionQuoteSide = 'buy' | 'sell';
export type ExecutionQuoteProvider = 'jupiter' | 'titan';

export interface ExecutionQuoteRouteStep {
    ammKey: string | null;
    label: string | null;
    percent: number | null;
    inputMint: string | null;
    outputMint: string | null;
    inAmountRaw: string | null;
    outAmountRaw: string | null;
    feeAmountRaw: string | null;
    feeMint: string | null;
}

export interface ExecutionQuoteAmount {
    mint: string;
    symbol: string;
    decimals: number;
    amount: string;
    rawAmount: string;
}

interface ExecutionQuoteRequest {
    unit: 'usd' | 'token';
    amount: string;
    rawAmount: string;
}

export type ExecutionQuoteCandidate =
    | {
          provider: ExecutionQuoteProvider;
          status: 'available';
          input: ExecutionQuoteAmount;
          output: ExecutionQuoteAmount;
          priceImpactPct: number | null;
          route: ExecutionQuoteRouteStep[];
          contextSlot: number | null;
          quotedAt: string;
      }
    | {
          provider: ExecutionQuoteProvider;
          status: 'unavailable';
          reason: 'quote_unavailable';
          input: null;
          output: null;
          priceImpactPct: null;
          route: [];
          contextSlot: null;
          quotedAt: string;
      };

export type ExecutionQuoteRow =
    | {
          request: ExecutionQuoteRequest;
          status: 'available';
          provider: ExecutionQuoteProvider;
          input: ExecutionQuoteAmount;
          output: ExecutionQuoteAmount;
          priceImpactPct: number | null;
          route: ExecutionQuoteRouteStep[];
          contextSlot: number | null;
          quotedAt: string;
          candidates: ExecutionQuoteCandidate[];
      }
    | {
          request: ExecutionQuoteRequest;
          status: 'unavailable';
          reason: 'quote_unavailable';
          provider: null;
          input: null;
          output: null;
          priceImpactPct: null;
          route: [];
          contextSlot: null;
          quotedAt: string;
          candidates: ExecutionQuoteCandidate[];
      };

export interface ExecutionEvaluationResponse {
    mint: string;
    side: ExecutionQuoteSide;
    providers: ['jupiter', 'titan'];
    token: { mint: string; symbol: string; name: string; decimals: number };
    quotes: ExecutionQuoteRow[];
    meta: {
        requested: number;
        available: number;
        unavailable: number;
        providerStats: Record<ExecutionQuoteProvider, { available: number; wins: number }>;
    };
}

export interface ExecutionQuoteRequestArgs {
    mint: string;
    side: ExecutionQuoteSide;
    amounts: string[];
}

export function useExecutionEvaluation() {
    const [data, setData] = React.useState<ExecutionEvaluationResponse | null>(null);
    const [error, setError] = React.useState<unknown>(null);
    const [isPending, setIsPending] = React.useState(false);
    const abortRef = React.useRef<AbortController | null>(null);
    const requestIdRef = React.useRef(0);

    const reset = React.useCallback(() => {
        requestIdRef.current += 1;
        abortRef.current?.abort();
        abortRef.current = null;
        setData(null);
        setError(null);
        setIsPending(false);
    }, []);

    const execute = React.useCallback(async (args: ExecutionQuoteRequestArgs) => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setData(null);
        setError(null);
        setIsPending(true);

        const params = new URLSearchParams({ mint: args.mint, side: args.side });
        const key = args.side === 'buy' ? 'amountUsd' : 'tokenAmount';
        for (const amount of args.amounts) params.append(key, amount);

        try {
            const response = await Effect.runPromise(
                apiJson<ExecutionEvaluationResponse>({
                    url: `/api/v2/execution/evaluate?${params.toString()}`,
                    init: { cache: 'no-store' },
                    signal: controller.signal,
                }),
            );
            if (requestIdRef.current === requestId) {
                setData(response);
                setIsPending(false);
            }
            return response;
        } catch (requestError) {
            if (requestIdRef.current === requestId && !controller.signal.aborted) {
                setError(requestError);
                setIsPending(false);
            }
            if (!controller.signal.aborted) throw requestError;
            return null;
        }
    }, []);

    React.useEffect(() => () => abortRef.current?.abort(), []);

    return { data, error, isError: error !== null, isPending, execute, reset };
}
