import { Schema } from 'effect';

/**
 * Lenient shadow-mode schemas for Birdeye responses: only the fields we
 * consume, everything optional — wired via fetchJson's `schema` option in
 * 'warn' mode, so mismatches log `upstream_decode_failed` without changing
 * behavior. Flip to decodeMode: 'fail' once the event is quiet in logs.
 */

const TokenExtensionsSchema = Schema.Struct({
    coingeckoId: Schema.optionalKey(Schema.NullishOr(Schema.String)),
    website: Schema.optionalKey(Schema.NullishOr(Schema.String)),
    twitter: Schema.optionalKey(Schema.NullishOr(Schema.String)),
    discord: Schema.optionalKey(Schema.NullishOr(Schema.String)),
    telegram: Schema.optionalKey(Schema.NullishOr(Schema.String)),
    description: Schema.optionalKey(Schema.NullishOr(Schema.String)),
    github: Schema.optionalKey(Schema.NullishOr(Schema.String)),
});

export const BirdeyeOverviewResponseSchema = Schema.Struct({
    success: Schema.optionalKey(Schema.Boolean),
    data: Schema.optionalKey(
        Schema.NullishOr(
            Schema.Struct({
                address: Schema.optionalKey(Schema.String),
                name: Schema.optionalKey(Schema.String),
                symbol: Schema.optionalKey(Schema.String),
                decimals: Schema.optionalKey(Schema.Number),
                logoURI: Schema.optionalKey(Schema.NullishOr(Schema.String)),
                extensions: Schema.optionalKey(Schema.NullishOr(TokenExtensionsSchema)),
                price: Schema.optionalKey(Schema.NullishOr(Schema.Number)),
                priceChange24hPercent: Schema.optionalKey(Schema.NullishOr(Schema.Number)),
                marketCap: Schema.optionalKey(Schema.NullishOr(Schema.Number)),
                fdv: Schema.optionalKey(Schema.NullishOr(Schema.Number)),
                liquidity: Schema.optionalKey(Schema.NullishOr(Schema.Number)),
                v24h: Schema.optionalKey(Schema.NullishOr(Schema.Number)),
                v24hUSD: Schema.optionalKey(Schema.NullishOr(Schema.Number)),
                holder: Schema.optionalKey(Schema.NullishOr(Schema.Number)),
                totalSupply: Schema.optionalKey(Schema.NullishOr(Schema.Number)),
                circulatingSupply: Schema.optionalKey(Schema.NullishOr(Schema.Number)),
                lastTradeHumanTime: Schema.optionalKey(Schema.NullishOr(Schema.String)),
            }),
        ),
    ),
});
