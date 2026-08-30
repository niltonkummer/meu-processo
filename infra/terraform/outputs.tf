output "artifact_repository_url" {
  description = "Docker repository URL used by CI/CD."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}"
}

output "cloud_run_service_name" {
  description = "Cloud Run service name."
  value       = google_cloud_run_v2_service.app.name
}

output "cloud_run_service_uri" {
  description = "Cloud Run service URI. IAM reachability depends on public_access_enabled; application API authorization always remains enabled."
  value       = google_cloud_run_v2_service.app.uri
}

output "public_access_enabled" {
  description = "Whether Terraform grants allUsers the Cloud Run invoker role for frontend reachability."
  value       = var.public_access_enabled
}

output "browser_renderer_service_name" {
  description = "IAM-private Cloud Run service that hosts the isolated Chromium session."
  value       = google_cloud_run_v2_service.browser_renderer.name
}

output "browser_renderer_service_uri" {
  description = "Renderer audience and endpoint; invocation still requires roles/run.invoker."
  value       = google_cloud_run_v2_service.browser_renderer.uri
}

output "active_google_project" {
  description = "Project resolved from the authenticated Google provider context."
  value       = data.google_client_config.current.project
}

output "firebase_web_config" {
  description = "Identity Platform web SDK configuration. The restricted API key is public configuration, not user authorization."
  value = {
    api_key     = google_apikeys_key.browser_authentication.key_string
    app_id      = "identity-platform:${var.project_id}"
    auth_domain = trimprefix(google_cloud_run_v2_service.app.uri, "https://")
    project_id  = var.project_id
  }
  sensitive = true
}
