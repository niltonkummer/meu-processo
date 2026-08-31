mock_provider "google" {}
mock_provider "google-beta" {}

variables {
  project_id                 = "meu-processo-507018"
  image_uri                  = "southamerica-east1-docker.pkg.dev/meu-processo-507018/meu-processo/app:0123456789abcdef"
  browser_renderer_image_uri = "southamerica-east1-docker.pkg.dev/meu-processo-507018/meu-processo/renderer:0123456789abcdef"
}

run "managed_foundation_is_absent_by_default" {
  command = plan

  assert {
    condition     = length(google_storage_bucket.process_objects) == 0
    error_message = "The passive managed foundation must not create a bucket by default."
  }

  assert {
    condition     = length(google_secret_manager_secret.managed) == 0
    error_message = "The passive managed foundation must not create secret containers by default."
  }

  assert {
    condition     = length(google_service_account.managed_workload) == 0
    error_message = "The passive managed foundation must not create workload identities by default."
  }
}

run "managed_foundation_plan_is_private_and_least_privilege" {
  command = plan

  variables {
    managed_foundation_enabled         = true
    managed_foundation_acknowledgement = "PLAN_ONLY_NO_APPLY"
  }

  assert {
    condition     = length(google_storage_bucket.process_objects) == 1
    error_message = "The opt-in plan must contain exactly one private object bucket."
  }

  assert {
    condition = (
      google_storage_bucket.process_objects[0].uniform_bucket_level_access == true &&
      google_storage_bucket.process_objects[0].public_access_prevention == "enforced" &&
      google_storage_bucket.process_objects[0].force_destroy == false &&
      google_storage_bucket.process_objects[0].deletion_policy == "PREVENT"
    )
    error_message = "The process-object bucket must fail closed and resist deletion."
  }

  assert {
    condition     = google_storage_bucket.process_objects[0].versioning[0].enabled == true
    error_message = "The process-object bucket must retain object versions."
  }

  assert {
    condition     = google_storage_bucket.process_objects[0].soft_delete_policy[0].retention_duration_seconds == 604800
    error_message = "Soft delete must be bounded to seven days."
  }

  assert {
    condition     = length(google_secret_manager_secret.managed) == 7
    error_message = "The foundation must declare the seven reviewed secret containers."
  }

  assert {
    condition     = alltrue([for secret in google_secret_manager_secret.managed : secret.deletion_protection])
    error_message = "Every managed secret container must enable deletion protection."
  }

  assert {
    condition     = length(google_service_account.managed_workload) == 5
    error_message = "Every privileged workload must receive a distinct identity."
  }

  assert {
    condition = toset([
      for config in google_project_iam_audit_config.process_object_data_access[0].audit_log_config :
      config.log_type
    ]) == toset(["DATA_READ", "DATA_WRITE"])
    error_message = "Process-object reads and writes must be recorded by Cloud Audit Logs."
  }

  assert {
    condition = (
      google_storage_bucket_iam_member.process_object_access["runtime:read"].role == "roles/storage.objectViewer" &&
      google_storage_bucket_iam_member.process_object_access["document:create"].role == "roles/storage.objectCreator" &&
      google_storage_bucket_iam_member.process_object_access["document:verify"].role == "roles/storage.objectViewer" &&
      google_storage_bucket_iam_member.process_object_access["lifecycle:manage"].role == "roles/storage.objectUser"
    )
    error_message = "Bucket roles must preserve read/create+verify/lifecycle separation."
  }

  assert {
    condition = alltrue([
      for binding in google_secret_manager_secret_iam_member.managed_accessor :
      binding.role == "roles/secretmanager.secretAccessor"
    ])
    error_message = "Every secret grant must use the narrow accessor role."
  }

  assert {
    condition = (
      length(setsubtract(
        toset(keys(local.managed_secret_access)),
        toset(["dispatcher", "document", "lifecycle", "monitoring", "runtime"]),
      )) == 0 &&
      length(setsubtract(
        toset(["dispatcher", "document", "lifecycle", "monitoring", "runtime"]),
        toset(keys(local.managed_secret_access)),
      )) == 0
    )
    error_message = "Secret access may target only the five reviewed workload identities."
  }
}

run "approved_validation_rollout_uses_the_reviewed_cost_gate" {
  command = plan

  variables {
    environment                        = "validation"
    managed_foundation_enabled         = true
    managed_foundation_acknowledgement = "APPROVED_VALIDATION_ROLLOUT_0040"
  }

  assert {
    condition     = length(google_storage_bucket.process_objects) == 1
    error_message = "The approved validation rollout must include the reviewed process-object bucket."
  }

  assert {
    condition     = length(google_service_account.managed_workload) == 5
    error_message = "The approved validation rollout must preserve one identity per privileged workload."
  }

  assert {
    condition = alltrue(concat(
      [
        google_kms_crypto_key.artifact_registry.labels["service"] == "meu-processo",
        google_kms_crypto_key.artifact_registry.labels["environment"] == "validation",
        google_kms_crypto_key.process_objects[0].labels["service"] == "meu-processo",
        google_kms_crypto_key.process_objects[0].labels["environment"] == "validation",
        google_storage_bucket.process_objects[0].labels["service"] == "meu-processo",
        google_storage_bucket.process_objects[0].labels["environment"] == "validation",
      ],
      [for secret in google_secret_manager_secret.managed :
        secret.labels["service"] == "meu-processo" &&
        secret.labels["environment"] == "validation"
      ],
    ))
    error_message = "Every stateful managed resource must expose GCP-compatible FinOps service and environment labels."
  }
}

run "approved_rollout_token_is_rejected_outside_validation" {
  command = plan

  variables {
    environment                        = "staging"
    managed_foundation_enabled         = true
    managed_foundation_acknowledgement = "APPROVED_VALIDATION_ROLLOUT_0040"
  }

  expect_failures = [var.managed_foundation_acknowledgement]
}
