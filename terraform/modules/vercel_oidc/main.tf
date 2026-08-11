# Vercel OIDC → GCP Workload Identity Federation for the admin app.
#
# The tokens-admin Cloud Run service stays IAM-gated (it is intentionally
# excluded from cloud_run_unauthenticated_services). The Vercel-hosted admin
# app authenticates the hop the same way Cloud Scheduler does: it exchanges
# its request-time VERCEL_OIDC_TOKEN for a Google ID token minted as the
# dedicated invoker SA below, and Cloud Run IAM verifies that token. The SA
# holds roles/run.invoker on the admin service ONLY — a compromise of the
# Vercel project cannot touch any other service, and the shared
# TOKENS_CLOUDRUN_AUTH_TOKEN bearer is no longer part of admin auth.

resource "google_iam_workload_identity_pool" "vercel" {
  workload_identity_pool_id = "vercel-${var.env}"
  display_name              = "Vercel (${var.env})"
  description               = "OIDC pool for the Vercel-hosted admin app (${var.env})."
}

resource "google_iam_workload_identity_pool_provider" "vercel" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.vercel.workload_identity_pool_id
  workload_identity_pool_provider_id = "vercel"
  display_name                       = "Vercel OIDC"

  attribute_mapping = {
    "google.subject"        = "assertion.sub"
    "attribute.project_id"  = "assertion.project_id"
    "attribute.environment" = "assertion.environment"
  }

  # Only tokens minted for the admin project may federate.
  attribute_condition = "assertion.project_id == \"${var.vercel_project_id}\""

  oidc {
    issuer_uri        = "https://oidc.vercel.com/${var.vercel_team_slug}"
    allowed_audiences = ["https://vercel.com/${var.vercel_team_slug}"]
  }
}

resource "google_service_account" "vercel_admin_invoker" {
  account_id   = "vercel-admin-invoker-${var.env}"
  display_name = "Vercel admin invoker (${var.env})"
  description  = "Assumed by the Vercel admin app via WIF; may only invoke the admin Cloud Run service."
}

locals {
  vercel_project_principal = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.vercel.name}/attribute.project_id/${var.vercel_project_id}"
}

# workloadIdentityUser lets the federated Vercel identity impersonate the SA;
# serviceAccountTokenCreator is additionally required for generateIdToken
# (the Cloud Run IAM hop needs an ID token, not an access token).
resource "google_service_account_iam_member" "vercel_wif_user" {
  service_account_id = google_service_account.vercel_admin_invoker.name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.vercel_project_principal
}

resource "google_service_account_iam_member" "vercel_wif_token_creator" {
  service_account_id = google_service_account.vercel_admin_invoker.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = local.vercel_project_principal
}

resource "google_cloud_run_v2_service_iam_member" "admin_invoker" {
  project  = var.project_id
  location = var.region
  name     = var.admin_service_name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.vercel_admin_invoker.email}"
}
