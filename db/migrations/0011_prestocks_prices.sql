-- PreStocks reference data for tokenized pre-IPO equities.
-- Source: `GET https://prestocks.com/api/<SYMBOL>` (unauthenticated; no
-- provider timestamp, so `last_fetched_at` is stamped by our cron).
-- `implied_valuation_usd` and `token_price_usd` are the provider-reported
-- values kept for divergence checks; the API derives its own implied
-- valuation from the mark fields and our on-chain token price.

CREATE TABLE prestocks_prices_latest (
    id                    text PRIMARY KEY,
    mint                  text NOT NULL,
    symbol                text NOT NULL,
    name                  text,
    mark_price_usd        double precision,
    mark_valuation_usd    double precision,
    token_price_usd       double precision,
    implied_valuation_usd double precision,
    supply                double precision,
    image_url             text,
    external_url          text,
    last_fetched_at       bigint NOT NULL,
    source                text NOT NULL CHECK (source IN ('prestocks')),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX prestocks_prices_latest_by_mint ON prestocks_prices_latest (mint);
CREATE INDEX prestocks_prices_latest_by_symbol ON prestocks_prices_latest (symbol);
CREATE INDEX prestocks_prices_latest_by_fetched ON prestocks_prices_latest (last_fetched_at, mint);

INSERT INTO schema_migrations(version) VALUES ('0011_prestocks_prices');
