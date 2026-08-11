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

variable "admin_service_name" {
  type        = string
  description = "Cloud Run service name of the admin backend (e.g. tokens-admin-stg-us)."
}
