import type {
    TokenDoc,
    TokenSearchToken,
    GetSearchTokensByAddressesEntry,
    TokenMarketsDoc,
    GetTokenMarketsLatestByMintsEntry,
    GetTopMarketsByMintsEntry,
    TokenDescriptionSummaryDoc,
} from '../../../../cloudrun-assets/src/handlers/tokensReads';

import type { Effect } from 'effect';

import { cloudRunQuery } from './client';
import type { CloudRunError } from './errors';

export type TokensGetByAddressArgs = { address: string };
export type TokensGetByAddressResult = TokenDoc | null;

export function tokensGetByAddress(args: TokensGetByAddressArgs): Effect.Effect<TokensGetByAddressResult, CloudRunError> {
    return cloudRunQuery<TokensGetByAddressResult>('assets', 'tokensGetByAddress', {
        ...args,
    });
}

export type TokensSearchTokensArgs = { query: string; limit?: number };
export type TokensSearchTokensResult = TokenSearchToken[];

export function tokensSearchTokens(args: TokensSearchTokensArgs): Effect.Effect<TokensSearchTokensResult, CloudRunError> {
    return cloudRunQuery<TokensSearchTokensResult>('assets', 'tokensSearchTokens', {
        ...args,
    });
}

export type TokensGetSearchTokensByAddressesArgs = { addresses: string[] };
export type TokensGetSearchTokensByAddressesResult = GetSearchTokensByAddressesEntry[];

export function tokensGetSearchTokensByAddresses(
    args: TokensGetSearchTokensByAddressesArgs,
): Effect.Effect<TokensGetSearchTokensByAddressesResult, CloudRunError> {
    return cloudRunQuery<TokensGetSearchTokensByAddressesResult>(
        'assets',
        'tokensGetSearchTokensByAddresses',
        { ...args },
    );
}

export type TokenMarketsGetLatestByMintArgs = { mint: string };
export type TokenMarketsGetLatestByMintResult = TokenMarketsDoc | null;

export function tokenMarketsGetLatestByMint(
    args: TokenMarketsGetLatestByMintArgs,
): Effect.Effect<TokenMarketsGetLatestByMintResult, CloudRunError> {
    return cloudRunQuery<TokenMarketsGetLatestByMintResult>(
        'assets',
        'tokenMarketsGetLatestByMint',
        { ...args },
    );
}

export type TokenMarketsGetLatestByMintsArgs = { mints: string[] };
export type TokenMarketsGetLatestByMintsResult = GetTokenMarketsLatestByMintsEntry[];

export function tokenMarketsGetLatestByMints(
    args: TokenMarketsGetLatestByMintsArgs,
): Effect.Effect<TokenMarketsGetLatestByMintsResult, CloudRunError> {
    return cloudRunQuery<TokenMarketsGetLatestByMintsResult>(
        'assets',
        'tokenMarketsGetLatestByMints',
        { ...args },
    );
}

export type TokenMarketsGetTopMarketsByMintsArgs = { mints: string[] };
export type TokenMarketsGetTopMarketsByMintsResult = GetTopMarketsByMintsEntry[];

export function tokenMarketsGetTopMarketsByMints(
    args: TokenMarketsGetTopMarketsByMintsArgs,
): Effect.Effect<TokenMarketsGetTopMarketsByMintsResult, CloudRunError> {
    return cloudRunQuery<TokenMarketsGetTopMarketsByMintsResult>(
        'assets',
        'tokenMarketsGetTopMarketsByMints',
        { ...args },
    );
}

export type TokenDescriptionSummariesGetByAddressArgs = { address: string };
export type TokenDescriptionSummariesGetByAddressResult = TokenDescriptionSummaryDoc | null;

export function tokenDescriptionSummariesGetByAddress(
    args: TokenDescriptionSummariesGetByAddressArgs,
): Effect.Effect<TokenDescriptionSummariesGetByAddressResult, CloudRunError> {
    return cloudRunQuery<TokenDescriptionSummariesGetByAddressResult>(
        'assets',
        'tokenDescriptionSummariesGetByAddress',
        { ...args },
    );
}
