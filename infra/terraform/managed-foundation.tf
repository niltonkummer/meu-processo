locals {
  managed_workload_service_accounts = {
    dispatcher = {
      account_id   = "meu-processo-dispatcher"
      display_name = "Meu Processo outbox dispatcher"
    }
    document = {
      account_id   = "meu-processo-document"
      display_name = "Meu Processo document worker"
    }
    lifecycle = {
      account_id   = "meu-processo-lifecycle"
      display_name = "Meu Processo lifecycle worker"
    }
    monitoring = {
      account_id   = "meu-processo-monitoring"
      display_name = "Meu Processo monitoring worker"
    }
    scheduler = {
      account_id   = "meu-processo-scheduler"
      display_name = "Meu Processo future scheduler invoker"
    }
  }

  managed_secret_ids = {
    dispatcher_database_url = "meu-processo-${var.environment}-dispatcher-database-url"
    document_database_url   = "meu-processo-${var.environment}-document-database-url"
    identifier_blind_index  = "meu-processo-${var.environment}-identifier-blind-index"
    identifier_keyring      = "meu-processo-${var.environment}-identifier-keyring"
    lifecycle_database_url  = "meu-processo-${var.environment}-lifecycle-database-url"
    monitoring_database_url = "meu-processo-${var.environment}-monitoring-database-url"
    runtime_database_url    = "meu-processo-${var.environment}-runtime-database-url"
  }

  managed_secret_access = {
    dispatcher = ["dispatcher_database_url"]
    document   = ["document_database_url"]
    lifecycle = [
      "identifier_blind_index",
      "identifier_keyring",
      "lifecycle_database_url",
    ]
    monitoring = [
      "identifier_blind_index",
      "identifier_keyring",
      "monitoring_database_url",
    ]
    runtime = [
      "identifier_blind_index",
      "identifier_keyring",
      "runtime_database_url",
    ]
  }

  managed_secret_bindings = merge([
    for workload, secret_keys in local.managed_secret_access : {
      for secret_key in secret_keys : "${workload}:${secret_key}" => {
        secret_key = secret_key
        workload   = workload
      }
    }
  ]...)

  process_object_bucket_name = coalesce(
    var.process_object_bucket_name,
    "${var.project_id}-process-objects-${var.environment}",
  )

  process_object_access = {
    "document:create" = {
      workload = "document"
      role     = "roles/storage.objectCreator"
    }
    "document:verify" = {
      workload = "document"
      role     = "roles/storage.objectViewer"
    }
    "lifecycle:manage" = {
      workload = "lifecycle"
      role     = "roles/storage.objectUser"
    }
    "runtime:read" = {
      workload = "runtime"
      role     = "roles/storage.objectViewer"
    }
  }
}

data "google_storage_project_service_account" "managed_foundation" {
  count = var.managed_foundation_enabled ? 1 : 0

  project = var.project_id

  depends_on = [google_project_service.required["storage.googleapis.com"]]
}

resource "google_service_account" "managed_workload" {
  for_each = var.managed_foundation_enabled ? local.managed_workload_service_accounts : {}

  project      = var.project_id
  account_id   = each.value.account_id
  display_name = each.value.display_name
  description  = "Least-privilege identity reserved for the ${each.key} workload; no Cloud Run Job is activated by this gate."

  depends_on = [google_project_service.required["iam.googleapis.com"]]
}

resource "google_kms_crypto_key" "process_objects" {
  count = var.managed_foundation_enabled ? 1 : 0

  name            = "process-objects-${var.environment}"
  key_ring        = google_kms_key_ring.artifact_registry.id
  rotation_period = "7776000s"
  labels          = local.labels

  lifecycle {
    prevent_destroy = true

    precondition {
      condition = contains([
        "PLAN_ONLY_NO_APPLY",
        "APPROVED_VALIDATION_ROLLOUT_0040",
      ], var.managed_foundation_acknowledgement)
      error_message = "The managed foundation requires the plan-only gate or the approved validation rollout 0040."
    }
  }
}

resource "google_kms_crypto_key_iam_member" "process_objects_gcs" {
  count = var.managed_foundation_enabled ? 1 : 0

  crypto_key_id = google_kms_crypto_key.process_objects[0].id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${data.google_storage_project_service_account.managed_foundation[0].email_address}"
}

# Cloud Audit Logs replaces legacy GCS server access logs so access events stay
# in the central, redacted operational plane instead of a second object bucket.
resource "google_project_iam_audit_config" "process_object_data_access" {
  count = var.managed_foundation_enabled ? 1 : 0

  project = var.project_id
  service = "storage.googleapis.com"

  audit_log_config {
    log_type = "DATA_READ"
  }

  audit_log_config {
    log_type = "DATA_WRITE"
  }
}

resource "google_storage_bucket" "process_objects" {
  # checkov:skip=CKV_GCP_62:Cloud Audit Logs DATA_READ/DATA_WRITE is enabled above instead of legacy access-log delivery to another bucket.
  count = var.managed_foundation_enabled ? 1 : 0

  project                     = var.project_id
  name                        = local.process_object_bucket_name
  location                    = var.region
  storage_class               = "STANDARD"
  force_destroy               = false
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  deletion_policy             = "PREVENT"
  labels                      = local.labels

  encryption {
    default_kms_key_name = google_kms_crypto_key.process_objects[0].id
  }

  versioning {
    enabled = true
  }

  soft_delete_policy {
    retention_duration_seconds = 604800
  }

  lifecycle_rule {
    action {
      type = "AbortIncompleteMultipartUpload"
    }
    condition {
      age = 1
    }
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age        = 7
      with_state = "ARCHIVED"
    }
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [
    google_kms_crypto_key_iam_member.process_objects_gcs,
    google_project_iam_audit_config.process_object_data_access,
    google_project_service.required["storage.googleapis.com"],
  ]
}

resource "google_storage_bucket_iam_member" "process_object_access" {
  for_each = var.managed_foundation_enabled ? local.process_object_access : {}

  bucket = google_storage_bucket.process_objects[0].name
  role   = each.value.role
  member = "serviceAccount:${each.value.workload == "runtime" ? google_service_account.runtime.email : google_service_account.managed_workload[each.value.workload].email}"
}

resource "google_secret_manager_secret" "managed" {
  for_each = var.managed_foundation_enabled ? local.managed_secret_ids : {}

  project             = var.project_id
  secret_id           = each.value
  deletion_protection = true
  version_destroy_ttl = "604800s"
  labels              = local.labels

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.required["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_iam_member" "managed_accessor" {
  for_each = var.managed_foundation_enabled ? local.managed_secret_bindings : {}

  project   = var.project_id
  secret_id = google_secret_manager_secret.managed[each.value.secret_key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member = "serviceAccount:${(
    each.value.workload == "runtime"
    ? google_service_account.runtime.email
    : google_service_account.managed_workload[each.value.workload].email
  )}"
}
