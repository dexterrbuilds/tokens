data "google_project" "this" {}

module "env" {
  source = "../../modules/env"

  project_id     = data.google_project.this.project_id
  project_number = data.google_project.this.number
  env            = var.env
  region         = var.region
  name_suffix    = "-us"

  cloud_sql_tier                = "db-custom-1-3840"
  cloud_sql_availability_type   = "ZONAL"
  cloud_sql_disk_size_gb        = 20
  cloud_sql_deletion_protection = false

  memorystore_tier           = "BASIC"
  memorystore_memory_size_gb = 1

  cloud_run_max_instances       = 5
  cloud_run_deletion_protection = false
  cloud_run_ingress             = "INGRESS_TRAFFIC_ALL"
  cloud_run_unauthenticated_services = [
    "assets",
    "prices",
    "usage",
  ]

  # Enable the DB-aware startup probe and isolated worker in a follow-up
  # apply only after the application revision containing /startup is live.
  enable_assets_db_startup_probe = false
  enable_assets_worker           = false
  route_assets_jobs_to_worker    = false

  enable_load_balancer = false
  enable_crons         = true
}

output "wif_provider" {
  value = module.env.wif_provider
}

output "tf_deployer_sa_email" {
  value = module.env.tf_deployer_sa_email
}

output "tf_planner_sa_email" {
  value = module.env.tf_planner_sa_email
}

output "cloudrun_deployer_sa_email" {
  value = module.env.cloudrun_deployer_sa_email
}

output "cloud_run_runtime_sa_email" {
  value = module.env.cloud_run_runtime_sa_email
}

output "artifact_registry_url" {
  value = module.env.artifact_registry_url
}

output "cloud_run_urls" {
  value = module.env.cloud_run_urls
}

output "cloud_sql_connection_name" {
  value = module.env.cloud_sql_connection_name
}

output "cloud_sql_app_password" {
  value     = module.env.cloud_sql_app_password
  sensitive = true
}

output "memorystore_host" {
  value = module.env.memorystore_host
}

output "memorystore_auth_string" {
  value     = module.env.memorystore_auth_string
  sensitive = true
}

output "cloudrun_auth_token_secret_id" {
  value = module.env.cloudrun_auth_token_secret_id
}

output "cloudrun_auth_token_value" {
  value     = module.env.cloudrun_auth_token_value
  sensitive = true
}

output "database_url_secret_id" {
  value = module.env.database_url_secret_id
}

# Vercel OIDC → WIF for the admin app (see modules/vercel_oidc). Created only
# once the Vercel project id is provided; the admin Cloud Run service stays
# IAM-gated either way.
module "vercel_oidc" {
  count  = var.vercel_admin_project_id == "" ? 0 : 1
  source = "../../modules/vercel_oidc"

  project_id         = data.google_project.this.project_id
  project_number     = data.google_project.this.number
  env                = var.env
  region             = var.region
  vercel_team_slug   = var.vercel_team_slug
  vercel_project_id  = var.vercel_admin_project_id
  vercel_environment = "preview"
  admin_service_name = "tokens-admin-${var.env}-us"
}

output "vercel_wif_audience" {
  value       = try(module.vercel_oidc[0].wif_audience, null)
  description = "Set as GCP_WIF_AUDIENCE on the Vercel tokens-admin project."
}

output "vercel_admin_invoker_sa_email" {
  value       = try(module.vercel_oidc[0].invoker_sa_email, null)
  description = "Set as GCP_ADMIN_INVOKER_SA on Vercel and TOKENS_RPC_INVOKER_SA on the Cloud Run services."
}
