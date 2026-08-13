locals {
  misc_cron_jobs = [
    {
      name      = "refresh-token-prices"
      schedule  = var.env == "stg" ? "35 4 * * *" : "24,54 * * * *"
      http_path = "/jobs/refresh-token-prices"
      body_json = jsonencode({
        maxTokens   = 250
        minAgeMs    = 1800000
        concurrency = 2
        delayMs     = 200
        budgetMs    = 500000
      })
      attempt_deadline = "540s"
    },
    {
      name      = "refresh-curated-token-markets"
      schedule  = var.env == "stg" ? "55 4 * * *" : "18,48 * * * *"
      http_path = "/jobs/refresh-curated-token-markets"
      body_json = jsonencode({
        priorityCount     = 25
        maxMints          = 150
        minAgeMs          = 3600000
        concurrency       = 2
        delayMs           = 200
        maxMarketsPerMint = 20
        selectionWindowMs = 1800000
        budgetMs          = 500000
      })
      attempt_deadline = "540s"
    },
  ]
}

module "scheduler_jobs_misc" {
  source = "../scheduler_jobs"
  count  = var.enable_crons ? 1 : 0

  project_id       = var.project_id
  region           = var.region
  env              = var.env
  service_url      = module.cloud_run["assets"].url
  invoker_sa_email = module.iam.scheduler_sa_email

  jobs = local.misc_cron_jobs
}
