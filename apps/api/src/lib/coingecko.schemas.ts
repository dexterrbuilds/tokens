import { Schema } from 'effect';

/**
 * Lenient shadow-mode schema for the CoinGecko coin response: only consumed
 * fields, everything optional/nullable — wired in 'warn' mode so mismatches
 * log `upstream_decode_failed` without changing behavior.
 */

const UsdNumberSchema = Schema.Struct({ usd: Schema.optionalKey(Schema.NullishOr(Schema.Number)) });
const UsdStringSchema = Schema.Struct({ usd: Schema.optionalKey(Schema.NullishOr(Schema.String)) });

export const CoinGeckoResponseSchema = Schema.Struct({
    id: Schema.optionalKey(Schema.String),
    symbol: Schema.optionalKey(Schema.String),
    name: Schema.optionalKey(Schema.String),
    description: Schema.optionalKey(
        Schema.NullishOr(Schema.Struct({ en: Schema.optionalKey(Schema.NullishOr(Schema.String)) })),
    ),
    links: Schema.optionalKey(
        Schema.NullishOr(
            Schema.Struct({
                homepage: Schema.optionalKey(Schema.NullishOr(Schema.Array(Schema.String))),
                twitter_screen_name: Schema.optionalKey(Schema.NullishOr(Schema.String)),
                telegram_channel_identifier: Schema.optionalKey(Schema.NullishOr(Schema.String)),
                subreddit_url: Schema.optionalKey(Schema.NullishOr(Schema.String)),
                chat_url: Schema.optionalKey(Schema.NullishOr(Schema.Array(Schema.String))),
                official_forum_url: Schema.optionalKey(Schema.NullishOr(Schema.Array(Schema.String))),
            }),
        ),
    ),
    market_data: Schema.optionalKey(
        Schema.NullishOr(
            Schema.Struct({
                current_price: Schema.optionalKey(Schema.NullishOr(UsdNumberSchema)),
                market_cap: Schema.optionalKey(Schema.NullishOr(UsdNumberSchema)),
                fully_diluted_valuation: Schema.optionalKey(Schema.NullishOr(UsdNumberSchema)),
                total_volume: Schema.optionalKey(Schema.NullishOr(UsdNumberSchema)),
                circulating_supply: Schema.optionalKey(Schema.NullishOr(Schema.Number)),
                total_supply: Schema.optionalKey(Schema.NullishOr(Schema.Number)),
                price_change_percentage_24h: Schema.optionalKey(Schema.NullishOr(Schema.Number)),
                ath: Schema.optionalKey(Schema.NullishOr(UsdNumberSchema)),
                ath_date: Schema.optionalKey(Schema.NullishOr(UsdStringSchema)),
            }),
        ),
    ),
});
