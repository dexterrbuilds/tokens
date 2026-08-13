locals {
  clickhouse_cron_jobs = [
    {
      name      = "sync-clickhouse-stock-mappings"
      schedule  = "0 6 * * *"
      http_path = "/jobs/sync-clickhouse-stock-mappings"
      body_json = jsonencode({
        limit                 = 5000
        requireRefreshEnabled = true
        budgetMs              = 500000
      })
      attempt_deadline = "540s"
    },
    {
      name      = "refresh-public-equity-stock-prices"
      schedule  = "2-59/5 * * * *"
      http_path = "/jobs/refresh-public-equity-stock-prices"
      body_json = jsonencode({
        maxAssets         = 250
        concurrency       = 2
        delayMs           = 50
        selectionWindowMs = 300000
        budgetMs          = 500000
      })
      attempt_deadline = "540s"
    },
    {
      # Daily: shares outstanding barely moves intraday; company market cap is
      # derived at read time from the 5-minute-fresh stock price.
      name      = "refresh-public-equity-shares-outstanding"
      schedule  = "30 6 * * *"
      http_path = "/jobs/refresh-public-equity-shares-outstanding"
      body_json = jsonencode({
        maxAssets             = 1000
        requireRefreshEnabled = true
        budgetMs              = 500000
      })
      attempt_deadline = "540s"
    },
    {
      name      = "refresh-solana-clickhouse-trade-snapshots"
      schedule  = "3-59/5 * * * *"
      http_path = "/jobs/refresh-solana-clickhouse-trade-snapshots"
      body_json = jsonencode({
        maxMints              = 250
        priorityCount         = 50
        concurrency           = 3
        delayMs               = 25
        selectionWindowMs     = 300000
        requireRefreshEnabled = true
        budgetMs              = 500000
      })
      attempt_deadline = "540s"
    },
  ]
}
