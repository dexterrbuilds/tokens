output "service_name" {
  value = google_cloud_run_v2_service.this.name
}

output "url" {
  value = google_cloud_run_v2_service.this.uri
}

output "id" {
  value = google_cloud_run_v2_service.this.id
}

output "image" {
  value = google_cloud_run_v2_service.this.template[0].containers[0].image
}
