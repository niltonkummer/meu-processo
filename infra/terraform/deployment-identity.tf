locals {
  github_repository    = "niltonkummer/meu-processo"
  github_repository_id = "1350848235"
  github_owner_id      = "823477"
  github_subject       = "repo:niltonkummer@823477/meu-processo@1350848235:environment:validation"

  deployer_project_roles = {
    apikeys_admin                = "roles/serviceusage.apiKeysAdmin"
    artifact_registry_admin      = "roles/artifactregistry.admin"
    firebase_admin               = "roles/firebase.admin"
    identity_platform_admin      = "roles/identityplatform.admin"
    kms_admin                    = "roles/cloudkms.admin"
    project_iam_admin            = "roles/resourcemanager.projectIamAdmin"
    run_admin                    = "roles/run.admin"
    secret_manager_admin         = "roles/secretmanager.admin"
    service_usage_admin          = "roles/serviceusage.serviceUsageAdmin"
    storage_admin                = "roles/storage.admin"
    workload_identity_pool_admin = "roles/iam.workloadIdentityPoolAdmin"
  }

  deployer_service_account_admin_targets = merge(
    {
      browser_renderer = google_service_account.browser_renderer.name
      deployer         = google_service_account.deployer.name
      runtime          = google_service_account.runtime.name
    },
    {
      for workload, account in google_service_account.managed_workload :
      workload => account.name
    },
  )

  deployer_service_account_user_targets = {
    browser_renderer = google_service_account.browser_renderer.name
    runtime          = google_service_account.runtime.name
  }
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "meu-processo-github"
  display_name              = "Meu Processo GitHub Actions"
  description               = "Keyless GitHub Actions identities restricted to the Meu Processo repository."
  disabled                  = false

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.required["iam.googleapis.com"]]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  # checkov:skip=CKV_GCP_125:The GitHub subject template embeds immutable owner/repository IDs with @ delimiters; Checkov 3.3.0 rejects that stronger valid syntax, while tests and the workflow assert the observed subject exactly.
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "Meu Processo GitHub OIDC"
  description                        = "Accepts GitHub OIDC tokens only from niltonkummer/meu-processo."

  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.repository"          = "assertion.repository"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
  }
  # Immutable numeric IDs prevent a deleted repository or renamed owner from
  # silently transferring trust to a newly created account with the same name.
  attribute_condition = "assertion.sub == 'repo:niltonkummer@823477/meu-processo@1350848235:environment:validation' && assertion.repository == '${local.github_repository}' && assertion.repository_id == '${local.github_repository_id}' && assertion.repository_owner_id == '${local.github_owner_id}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [
    google_project_service.required["iam.googleapis.com"],
    google_project_service.required["sts.googleapis.com"],
  ]
}

resource "google_service_account" "deployer" {
  project      = var.project_id
  account_id   = "meu-processo-deploy"
  display_name = "Meu Processo validation deployer"
  description  = "Keyless CI identity used only by the GitHub validation environment."

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.required["iam.googleapis.com"]]
}

resource "google_service_account_iam_member" "github_deployer" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principal://iam.googleapis.com/projects/${data.google_project.current.number}/locations/global/workloadIdentityPools/${google_iam_workload_identity_pool.github.workload_identity_pool_id}/subject/${local.github_subject}"

  depends_on = [google_iam_workload_identity_pool_provider.github]
}

resource "google_project_iam_member" "deployer" {
  for_each = local.deployer_project_roles

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_service_account_iam_member" "deployer_admin" {
  for_each = local.deployer_service_account_admin_targets

  service_account_id = each.value
  role               = "roles/iam.serviceAccountAdmin"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_service_account_iam_member" "deployer_user" {
  for_each = local.deployer_service_account_user_targets

  service_account_id = each.value
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}
