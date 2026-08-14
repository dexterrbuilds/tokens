variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "env" {
  type = string
}

variable "name_suffix" {
  type        = string
  description = "Optional trailing suffix on resource names (e.g. \"-us\" for regionally-migrated resources whose live name has an extra tag)."
  default     = ""
}

variable "network_id" {
  type        = string
  description = "VPC network for direct VPC egress."
}

variable "subnet_id" {
  type        = string
  description = "Subnet whose range Cloud Run instances use for direct VPC egress."
}

variable "service_name" {
  type        = string
  description = "Bounded context name (assets, prices, usage, admin)."
}

variable "image" {
  type        = string
  description = "Container image to deploy. Use the placeholder until app code lands."
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "runtime_sa_email" {
  type = string
}

variable "min_instances" {
  type    = number
  default = 0
}

variable "max_instances" {
  type    = number
  default = 10
}

variable "request_concurrency" {
  type        = number
  description = "Max concurrent requests per instance (1-1000). Cloud Run derives ~80x vCPU when unset (640 on 8 vCPU) — far too high for a single-threaded Bun event loop; 80 makes bursts scale out instances instead of queueing."
  default     = 80
}

variable "env_vars" {
  type        = map(string)
  description = "Plaintext non-secret env vars (region, SQL connection name, etc.)."
  default     = {}
}

variable "secret_env_vars" {
  type = map(object({
    secret_id = string
    version   = optional(string, "latest")
  }))
  description = "Env vars sourced from Secret Manager. Key is the env var name, value names the secret in the same project."
  default     = {}
}

variable "ingress" {
  type        = string
  description = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER or INGRESS_TRAFFIC_ALL."
  default     = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
}

variable "allow_unauthenticated" {
  type        = bool
  description = "When true, binds allUsers to roles/run.invoker so the *.run.app URL is publicly reachable. Auth at the handler layer (TOKENS_CLOUDRUN_AUTH_TOKEN bearer) is then the only access gate. Leave false for any service that should only be reachable behind an internal LB."
  default     = false
}

variable "request_timeout" {
  type        = string
  description = "Max duration Cloud Run allows a single request before returning 504 (Cloud Run default: 300s). Must be >= the longest Cloud Scheduler attempt_deadline of any cron job routed to this service, or long-running cron handlers get killed mid-run."
  default     = "300s"
}

variable "cpu" {
  type        = string
  description = "Cloud Run CPU limit. Integer values ('1', '2', '4', '8') required when cpu_idle=true. Values above 8 need per-project quota and a 32Gi memory floor."
  default     = "1"
}

variable "memory" {
  type        = string
  description = "Cloud Run memory limit (e.g. '512Mi', '2Gi', '4Gi'). Must scale with cpu — see Cloud Run's per-cpu minimums."
  default     = "512Mi"
}

variable "deletion_protection" {
  type        = bool
  description = "Provider-side guard against destroying the service. Keep true in prd; stg sets false so region moves can replace services."
  default     = true
}

variable "startup_probe_path" {
  type        = string
  description = "Optional HTTP path used as the Cloud Run startup probe. Null disables the probe."
  default     = null
  nullable    = true
}

variable "startup_probe_tcp_port" {
  type        = number
  description = "Optional TCP startup probe port used during phased migration to the database-aware HTTP probe."
  default     = null
  nullable    = true
}
