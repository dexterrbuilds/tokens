output "wif_audience" {
  value       = "//iam.googleapis.com/projects/${var.project_number}/locations/global/workloadIdentityPools/${google_iam_workload_identity_pool.vercel.workload_identity_pool_id}/providers/${google_iam_workload_identity_pool_provider.vercel.workload_identity_pool_provider_id}"
  description = "STS audience for the Vercel WIF provider — set as GCP_WIF_AUDIENCE on the Vercel admin project."
}

output "invoker_sa_email" {
  value       = google_service_account.vercel_admin_invoker.email
  description = "Invoker SA — set as GCP_ADMIN_INVOKER_SA on the Vercel admin project and TOKENS_RPC_INVOKER_SA on the Cloud Run services."
}
