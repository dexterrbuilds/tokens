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
  description = "Optional trailing suffix on the regional resource names (subnet, router, VPC connector). Global resources (VPC, PSA range, firewalls) always keep their env-only names."
  default     = ""
}

variable "flow_logs" {
  type = object({
    aggregation_interval = string
    flow_sampling        = number
    metadata             = string
    filter_expr          = string
  })
  description = "Optional VPC Flow Logs configuration for the Cloud Run subnet."
  default     = null
  nullable    = true
}
