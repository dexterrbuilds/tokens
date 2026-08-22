locals {
  depth_cron_jobs = [
    {
      # Price-impact curves for multi-variant assets (variant_depth_curves_latest),
      # sampled from the Titan quote API at a $10k/$100k/$1M/$5M ladder. Backs
      # the size-aware fields of GET /v2/execution/route. Rotating stalest-first
      # shard of 60 mints per tick over a ~180-mint universe → full-fleet
      # freshness ≈ 90 min. The handler is a no-op unless DEPTH_REFRESH_ENABLED=true
      # and TITAN_WS_URL/TITAN_API_KEY are set on the assets service (managed
      # out-of-band, like the other refresh flags).
      name      = "refresh-depth-curves"
      schedule  = "*/30 * * * *"
      http_path = "/jobs/refresh-depth-curves"
      body_json = jsonencode({
        maxMints              = 60
        concurrency           = 1
        delayMs               = 500
        requireRefreshEnabled = true
        budgetMs              = 500000
      })
      attempt_deadline = "540s"
      # High-frequency job: the next scheduled tick is the retry.
      retry_count = 0
    },
  ]
}
