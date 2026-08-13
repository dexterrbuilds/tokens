variable "project_id" {
  type = string
}

variable "project_number" {
  type = string
}

variable "env" {
  type = string
}

variable "region" {
  type = string
}

variable "vercel_team_slug" {
  type        = string
  description = "Vercel team slug; the OIDC issuer is https://oidc.vercel.com/<team-slug> (team issuer mode)."
}

variable "vercel_project_id" {
  type        = string
  description = "Vercel project id (prj_...) of the admin app; only its tokens may federate."
}

variable "vercel_environment" {
  type        = string
  description = "Vercel OIDC environment claim allowed to federate (preview or production)."

  validation {
    condition     = contains(["preview", "production"], var.vercel_environment)
    error_message = "vercel_environment must be either preview or production."
  }
}

variable "admin_service_name" {
  type        = string
  description = "Cloud Run service name of the admin backend (e.g. tokens-admin-stg-us)."
}
