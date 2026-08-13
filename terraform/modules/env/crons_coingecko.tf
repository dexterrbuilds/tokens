locals {
  coingecko_cron_jobs = [
    {
      name      = "sync-coingecko-coin-list"
      schedule  = "0 4 * * 0"
      http_path = "/jobs/sync-coingecko-coin-list"
      body_json = jsonencode({
        batchSize = 100
      })
      attempt_deadline = "1800s"
    },
    {
      name      = "refresh-curated-coingecko-metadata"
      schedule  = "15 */6 * * *"
      http_path = "/jobs/refresh-curated-coingecko-metadata"
      body_json = jsonencode({
        maxCoins          = 25
        minAgeMs          = 86400000
        concurrency       = 2
        delayMs           = 250
        selectionWindowMs = 21600000
        localization      = false
        marketData        = true
        budgetMs          = 500000
      })
      attempt_deadline = "540s"
    },
    {
      name      = "refresh-curated-coingecko-tickers"
      schedule  = "45 */6 * * *"
      http_path = "/jobs/refresh-curated-coingecko-tickers"
      body_json = jsonencode({
        maxCoins          = 15
        minAgeMs          = 21600000
        concurrency       = 2
        delayMs           = 250
        selectionWindowMs = 21600000
        maxTickers        = 200
        budgetMs          = 500000
      })
      attempt_deadline = "540s"
    },
    {
      name      = "refresh-curated-coingecko-prices"
      schedule  = "1-59/5 * * * *"
      http_path = "/jobs/refresh-curated-coingecko-prices"
      body_json = jsonencode({
        maxCoins          = 250
        minAgeMs          = 0
        chunkSize         = 200
        delayMs           = 150
        selectionWindowMs = 300000
        budgetMs          = 500000
      })
      attempt_deadline = "540s"
    },
    {
      name      = "refresh-curated-coingecko-ohlcv-15m"
      schedule  = "4,34 * * * *"
      http_path = "/jobs/refresh-curated-coingecko-ohlcv-15m"
      body_json = jsonencode({
        interval          = "15m"
        days              = 1
        maxCoins          = 50
        priorityCount     = 20
        concurrency       = 2
        delayMs           = 250
        selectionWindowMs = 1800000
        budgetMs          = 500000
      })
      attempt_deadline = "540s"
    },
    {
      name      = "refresh-curated-coingecko-ohlcv-1h"
      schedule  = "5 * * * *"
      http_path = "/jobs/refresh-curated-coingecko-ohlcv-1h"
      body_json = jsonencode({
        interval          = "1H"
        days              = 90
        maxCoins          = 200
        priorityCount     = 30
        concurrency       = 3
        delayMs           = 150
        selectionWindowMs = 3600000
        budgetMs          = 500000
      })
      attempt_deadline = "540s"
    },
    {
      name      = "refresh-curated-coingecko-ohlcv-4h"
      schedule  = "20 */12 * * *"
      http_path = "/jobs/refresh-curated-coingecko-ohlcv-4h"
      body_json = jsonencode({
        interval          = "4H"
        days              = 365
        maxCoins          = 200
        concurrency       = 2
        delayMs           = 250
        selectionWindowMs = 43200000
        budgetMs          = 500000
      })
      attempt_deadline = "540s"
    },
    {
      name      = "refresh-curated-coingecko-ohlcv-1d"
      schedule  = "35 0 * * *"
      http_path = "/jobs/refresh-curated-coingecko-ohlcv-1d"
      body_json = jsonencode({
        interval          = "1D"
        days              = 365
        maxCoins          = 200
        concurrency       = 2
        delayMs           = 250
        selectionWindowMs = 86400000
        budgetMs          = 500000
      })
      attempt_deadline = "540s"
    },
    {
      name      = "refresh-curated-coingecko-ohlcv-1w"
      schedule  = "50 0 * * *"
      http_path = "/jobs/refresh-curated-coingecko-ohlcv-1w"
      body_json = jsonencode({
        interval          = "1W"
        days              = 365
        maxCoins          = 200
        concurrency       = 2
        delayMs           = 250
        selectionWindowMs = 86400000
        budgetMs          = 500000
      })
      attempt_deadline = "540s"
    },
  ]
}
