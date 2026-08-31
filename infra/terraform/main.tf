locals {
  labels = {
    application = "meu-processo"
    environment = var.environment
    managed_by  = "terraform"
    service     = "meu-processo"
  }

  required_services = toset([
    "apikeys.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "cloudkms.googleapis.com",
    "firebase.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "identitytoolkit.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "sts.googleapis.com",
    "storage.googleapis.com",
  ])
}

resource "google_identity_platform_config" "authentication" {
  provider = google-beta
  project  = var.project_id

  autodelete_anonymous_users = true
  authorized_domains = distinct(concat(
    [
      "localhost",
      trimprefix(google_cloud_run_v2_service.app.uri, "https://"),
    ],
    var.additional_auth_domains,
  ))
  sign_in {
    allow_duplicate_emails = false

    email {
      enabled           = true
      password_required = true
    }

    anonymous {
      enabled = false
    }

    phone_number {
      enabled = false
    }
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.required["identitytoolkit.googleapis.com"]]
}

resource "google_apikeys_key" "browser_authentication" {
  project      = var.project_id
  name         = "meu-processo-browser-auth"
  display_name = "Meu Processo browser Identity Platform"

  restrictions {
    browser_key_restrictions {
      allowed_referrers = concat(
        [
          "http://localhost:*/*",
          "https://${trimprefix(google_cloud_run_v2_service.app.uri, "https://")}/*",
        ],
        [for domain in var.additional_auth_domains : "https://${domain}/*"],
      )
    }

    api_targets {
      service = "identitytoolkit.googleapis.com"
    }
  }

  depends_on = [
    google_project_service.required["apikeys.googleapis.com"],
    google_project_service.required["identitytoolkit.googleapis.com"],
  ]
}

resource "google_project_service" "required" {
  for_each = local.required_services

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = "meu-processo-runtime"
  display_name = "Meu Processo Cloud Run runtime"
  description  = "Unprivileged runtime identity for the stateless DJEN validation service."

  depends_on = [google_project_service.required]
}

resource "google_service_account" "browser_renderer" {
  project      = var.project_id
  account_id   = "meu-processo-renderer"
  display_name = "Meu Processo browser renderer"
  description  = "Unprivileged identity for the isolated, ephemeral Chromium renderer."

  depends_on = [google_project_service.required]
}

resource "google_project_iam_member" "runtime_firebase_auth_viewer" {
  project = var.project_id
  role    = "roles/firebaseauth.viewer"
  member  = "serviceAccount:${google_service_account.runtime.account_id}@${var.project_id}.iam.gserviceaccount.com"

  depends_on = [
    google_identity_platform_config.authentication,
    google_project_service.required["identitytoolkit.googleapis.com"],
  ]
}

resource "google_kms_key_ring" "artifact_registry" {
  project  = var.project_id
  name     = "meu-processo-artifacts"
  location = var.region

  depends_on = [google_project_service.required]
}

resource "google_kms_crypto_key" "artifact_registry" {
  name            = "artifact-registry"
  key_ring        = google_kms_key_ring.artifact_registry.id
  rotation_period = "7776000s"
  labels          = local.labels

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key_iam_member" "artifact_registry" {
  crypto_key_id = google_kms_crypto_key.artifact_registry.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-artifactregistry.iam.gserviceaccount.com"
}

resource "google_artifact_registry_repository" "app" {
  project       = var.project_id
  location      = var.region
  repository_id = var.artifact_repository
  description   = "Immutable application images for Meu Processo"
  format        = "DOCKER"
  kms_key_name  = google_kms_crypto_key.artifact_registry.id
  labels        = local.labels

  cleanup_policy_dry_run = false

  docker_config {
    immutable_tags = true
  }

  cleanup_policies {
    id     = "keep-recent-revisions"
    action = "KEEP"

    most_recent_versions {
      keep_count = 20
    }
  }

  cleanup_policies {
    id     = "delete-old-untagged"
    action = "DELETE"

    condition {
      tag_state  = "UNTAGGED"
      older_than = "2592000s"
    }
  }

  depends_on = [
    google_kms_crypto_key_iam_member.artifact_registry,
    google_project_service.required,
  ]
}

resource "google_cloud_run_v2_service" "app" {
  project  = var.project_id
  name     = var.service_name
  location = var.region

  deletion_protection = true
  ingress             = "INGRESS_TRAFFIC_ALL"
  # Google recommends disabling the per-request Invoker IAM check for a public
  # Cloud Run service, especially when Domain Restricted Sharing blocks an
  # allUsers IAM binding. Application routes still enforce Firebase tokens.
  invoker_iam_disabled = var.public_access_enabled

  template {
    service_account = google_service_account.runtime.email
    # The application keeps an authenticated WebSocket open while the user
    # answers the tribunal challenge. Leave bounded infrastructure headroom
    # beyond the 120-second application session timeout.
    timeout                          = "180s"
    max_instance_request_concurrency = 20
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"
    session_affinity                 = true

    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    containers {
      name  = "app"
      image = var.image_uri

      ports {
        name           = "http1"
        container_port = 8080
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "CLOUD_RUN_REGION"
        value = var.region
      }

      env {
        name  = "AUTH_MODE"
        value = "firebase"
      }

      env {
        name  = "BROWSER_RENDERER_URL"
        value = google_cloud_run_v2_service.browser_renderer.uri
      }

      env {
        name  = "BROWSER_RENDERER_AUTH_MODE"
        value = "google-id-token"
      }

      dynamic "env" {
        for_each = var.commercial_billing_enabled ? {
          APPLICATION_PUBLIC_URL = var.commercial_application_public_url
          BILLING_MODE           = "stripe-test"
          STRIPE_PERSON_PRICE_ID = var.stripe_person_price_id
        } : {}

        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.commercial_billing_enabled ? {
          BILLING_WEBHOOK_CONFIG_JSON = {
            secret_key = "billing_webhook_config"
            version    = var.billing_webhook_config_secret_version
          }
          STRIPE_SECRET_KEY = {
            secret_key = "stripe_secret_key"
            version    = var.stripe_secret_key_version
          }
        } : {}

        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.managed[env.value.secret_key].secret_id
              version = env.value.version
            }
          }
        }
      }

      resources {
        cpu_idle = true
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      startup_probe {
        initial_delay_seconds = 1
        timeout_seconds       = 3
        period_seconds        = 5
        failure_threshold     = 6

        http_get {
          path = "/health"
          port = 8080
        }
      }

      liveness_probe {
        initial_delay_seconds = 5
        timeout_seconds       = 3
        period_seconds        = 30
        failure_threshold     = 3

        http_get {
          path = "/health"
          port = 8080
        }
      }
    }
  }

  labels = local.labels

  depends_on = [
    google_artifact_registry_repository.app,
    google_project_service.required,
    google_secret_manager_secret_iam_member.managed_accessor,
  ]
}

resource "google_cloud_run_v2_service" "browser_renderer" {
  project  = var.project_id
  name     = var.browser_renderer_service_name
  location = var.region

  deletion_protection  = true
  ingress              = "INGRESS_TRAFFIC_ALL"
  invoker_iam_disabled = false

  template {
    service_account = google_service_account.browser_renderer.email
    # The renderer session expires internally after 120 seconds. Cloud Run
    # must not terminate the WebSocket before that controlled shutdown.
    timeout                          = "180s"
    max_instance_request_concurrency = 1
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"
    session_affinity                 = false

    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }

    containers {
      name  = "browser-renderer"
      image = var.browser_renderer_image_uri

      ports {
        name           = "http1"
        container_port = 8080
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      resources {
        cpu_idle = true
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }

      startup_probe {
        initial_delay_seconds = 1
        timeout_seconds       = 3
        period_seconds        = 5
        failure_threshold     = 12

        http_get {
          path = "/health"
          port = 8080
        }
      }

      liveness_probe {
        initial_delay_seconds = 10
        timeout_seconds       = 3
        period_seconds        = 30
        failure_threshold     = 3

        http_get {
          path = "/health"
          port = 8080
        }
      }
    }
  }

  labels = local.labels

  depends_on = [
    google_artifact_registry_repository.app,
    google_project_service.required,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "browser_renderer_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.browser_renderer.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.runtime.account_id}@${var.project_id}.iam.gserviceaccount.com"
}
