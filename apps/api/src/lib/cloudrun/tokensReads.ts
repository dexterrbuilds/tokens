import type {
    TokenDoc,
    TokenSearchToken,
    GetSearchTokensByAddressesEntry,
    TokenMarketsDoc,
    GetTokenMarketsLatestByMintsEntry,
    GetTopMarketsByMintsEntry,
    TokenDescriptionSummaryDoc,
} from '../../../../cloudrun-assets/src/handlers/tokensReads';

import { Schema, type Effect } from 'effect';

import { cloudRunQuery } from './client';
import type { CloudRunError } from './errors';


// -----------------------------------------------------------------------------
// Response schemas (strict decode of our own contract; excess keys dropped, so
// additive cloudrun-assets deploys never break us). The compile-time asserts
// below turn drift between schema and the imported handler types into build
// failures. Remaining result types adopt incrementally via the `schema` option.
// -----------------------------------------------------------------------------

const TokenDocSchema = Schema.Struct({
    _id: Schema.String,
    _creationTime: Schema.Number,
    address: Schema.String,
    symbol: Schema.String,
    name: Schema.String,
    decimals: Schema.Number,
    logoUri: Schema.optionalKey(Schema.String),
    coingeckoId: Schema.optionalKey(Schema.String),
    description: Schema.optionalKey(Schema.String),
    website: Schema.optionalKey(Schema.String),
    twitter: Schema.optionalKey(Schema.String),
    discord: Schema.optionalKey(Schema.String),
    telegram: Schema.optionalKey(Schema.String),
    reddit: Schema.optionalKey(Schema.String),
    github: Schema.optionalKey(Schema.String),
    price: Schema.optionalKey(Schema.Number),
    priceChange24hPercent: Schema.optionalKey(Schema.Number),
    priceChange1hPercent: Schema.optionalKey(Schema.Number),
    volume24hUSD: Schema.optionalKey(Schema.Number),
    liquidity: Schema.optionalKey(Schema.Number),
    marketCap: Schema.optionalKey(Schema.Number),
    lastFetchedAt: Schema.Number,
});

const TokenSearchTokenSchema = Schema.Struct({
    address: Schema.String,
    symbol: Schema.String,
    name: Schema.String,
    decimals: Schema.Number,
    logoURI: Schema.optionalKey(Schema.String),
    liquidity: Schema.Number,
    volume24hUSD: Schema.Number,
    price: Schema.Number,
    priceChange24hPercent: Schema.Number,
    priceChange1hPercent: Schema.optionalKey(Schema.Number),
    marketCap: Schema.Number,
});

const TokensGetByAddressResultSchema = Schema.NullOr(TokenDocSchema);
const TokensSearchTokensResultSchema = Schema.Array(TokenSearchTokenSchema);

type AssertAssignable<_A extends B, B> = never;
// Drift guards: the schema's decoded type must satisfy the handler contract.
type _TokenDocDrift = AssertAssignable<Schema.Schema.Type<typeof TokenDocSchema>, TokenDoc>;
type _TokenSearchTokenDrift = AssertAssignable<Schema.Schema.Type<typeof TokenSearchTokenSchema>, TokenSearchToken>;

export type TokensGetByAddressArgs = { address: string };
export type TokensGetByAddressResult = TokenDoc | null;

export function tokensGetByAddress(args: TokensGetByAddressArgs): Effect.Effect<TokensGetByAddressResult, CloudRunError> {
    return cloudRunQuery<TokensGetByAddressResult>(
        'assets',
        'tokensGetByAddress',
        { ...args },
        { schema: TokensGetByAddressResultSchema },
    );
}

export type TokensSearchTokensArgs = { query: string; limit?: number };
export type TokensSearchTokensResult = TokenSearchToken[];

export function tokensSearchTokens(args: TokensSearchTokensArgs): Effect.Effect<TokensSearchTokensResult, CloudRunError> {
    return cloudRunQuery<TokensSearchTokensResult>(
        'assets',
        'tokensSearchTokens',
        { ...args },
        { schema: TokensSearchTokensResultSchema },
    );
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
