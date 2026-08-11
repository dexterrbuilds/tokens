variable "project_id" {
  type        = string
  description = "GCP project hosting tokens.xyz infrastructure."
  default     = "tokens-498908"
}

variable "region" {
  type        = string
  description = "Primary GCP region for all regional resources."
  default     = "us-east4"
}

variable "env" {
  type        = string
  description = "Environment name (dev / stg / prd)."
  default     = "prd"
}

variable "vercel_team_slug" {
  type        = string
  description = "Vercel team slug for the admin app's OIDC issuer (https://oidc.vercel.com/<team-slug>)."
  default     = "solana-foundation"
}

variable "vercel_admin_project_id" {
  type        = string
  description = "Vercel project id (prj_...) of tokens-admin. Empty disables the Vercel WIF module until the id is known."
  default     = ""
}
