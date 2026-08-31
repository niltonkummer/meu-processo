mock_provider "google" {
  mock_data "google_project" {
    defaults = {
      number = "507018507018"
    }
  }
}

mock_provider "google-beta" {}

run "github_oidc_is_keyless_and_restricted_to_validation" {
  command = plan

  variables {
    project_id                 = "meu-processo-507018"
    image_uri                  = "southamerica-east1-docker.pkg.dev/meu-processo-507018/meu-processo/app:0123456789abcdef"
    browser_renderer_image_uri = "southamerica-east1-docker.pkg.dev/meu-processo-507018/meu-processo/renderer:0123456789abcdef"
  }

  assert {
    condition     = google_iam_workload_identity_pool.github.workload_identity_pool_id == "meu-processo-github"
    error_message = "The deployment identity must use the dedicated GitHub workload identity pool."
  }

  assert {
    condition     = google_iam_workload_identity_pool_provider.github.attribute_condition == "assertion.sub == 'repo:niltonkummer/meu-processo:environment:validation' && assertion.repository == 'niltonkummer/meu-processo' && assertion.repository_id == '1350848235' && assertion.repository_owner_id == '823477'"
    error_message = "OIDC tokens from other repositories must be rejected by the provider."
  }

  assert {
    condition = google_iam_workload_identity_pool_provider.github.attribute_mapping == tomap({
      "attribute.repository"          = "assertion.repository"
      "attribute.repository_id"       = "assertion.repository_id"
      "attribute.repository_owner_id" = "assertion.repository_owner_id"
      "google.subject"                = "assertion.sub"
    })
    error_message = "The provider must map only the subject and exact repository claim required by the trust policy."
  }

  assert {
    condition     = google_service_account.deployer.account_id == "meu-processo-deploy"
    error_message = "Validation deploys must use a dedicated service account."
  }

  assert {
    condition     = google_service_account_iam_member.github_deployer.member == "principal://iam.googleapis.com/projects/507018507018/locations/global/workloadIdentityPools/meu-processo-github/subject/repo:niltonkummer/meu-processo:environment:validation"
    error_message = "Only GitHub jobs bound to the validation environment may impersonate the deployer."
  }

  assert {
    condition     = google_service_account_iam_member.github_deployer.role == "roles/iam.workloadIdentityUser"
    error_message = "The external principal may receive only Workload Identity User on the deploy service account."
  }

  assert {
    condition = toset(keys(google_project_iam_member.deployer)) == toset([
      "apikeys_admin",
      "artifact_registry_admin",
      "firebase_admin",
      "identity_platform_admin",
      "kms_admin",
      "project_iam_admin",
      "run_admin",
      "secret_manager_admin",
      "service_usage_admin",
      "storage_admin",
      "workload_identity_pool_admin",
    ])
    error_message = "The deployer project roles must remain an explicit allowlist."
  }

  assert {
    condition = toset(keys(google_service_account_iam_member.deployer_admin)) == toset([
      "browser_renderer",
      "deployer",
      "runtime",
    ])
    error_message = "Service account administration must be scoped to the identities already managed by this validation state."
  }

  assert {
    condition = toset(keys(google_service_account_iam_member.deployer_user)) == toset([
      "browser_renderer",
      "runtime",
    ])
    error_message = "The deployer may impersonate only the two Cloud Run runtime identities."
  }

  assert {
    condition     = alltrue([for binding in google_service_account_iam_member.deployer_user : binding.role == "roles/iam.serviceAccountUser"])
    error_message = "Cloud Run impersonation must use only Service Account User on the exact runtime identities."
  }

  assert {
    condition     = google_project_service.required["iamcredentials.googleapis.com"].disable_on_destroy == false
    error_message = "The IAM Credentials API required for keyless impersonation must remain enabled."
  }

  assert {
    condition     = google_project_service.required["sts.googleapis.com"].disable_on_destroy == false
    error_message = "The Security Token Service API required for OIDC exchange must remain enabled."
  }
}
