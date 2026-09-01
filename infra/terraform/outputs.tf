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
  description = "Whether Terraform disables the application service Invoker IAM check for public frontend reachability."
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

output "managed_foundation_enabled" {
  description = "Whether the passive managed foundation is included in this plan. This is not rollout approval."
  value       = var.managed_foundation_enabled
}

output "process_object_bucket" {
  description = "Private process-object bucket name when the passive foundation is included."
  value       = try(google_storage_bucket.process_objects[0].name, null)
}

output "managed_secret_ids" {
  description = "Secret Manager container IDs. Values and versions are intentionally never managed by this state."
  value       = var.managed_foundation_enabled ? local.managed_secret_ids : {}
}

output "managed_workload_service_accounts" {
  description = "Least-privilege workload identities reserved by the passive foundation."
  value = {
    for workload, account in google_service_account.managed_workload :
    workload => account.email
  }
}

output "github_workload_identity_provider" {
  description = "Fully qualified provider name configured as the validation environment GCP_WORKLOAD_IDENTITY_PROVIDER variable."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "github_deploy_service_account" {
  description = "Keyless service account configured as the validation environment GCP_DEPLOY_SERVICE_ACCOUNT variable."
  value       = google_service_account.deployer.email
}
