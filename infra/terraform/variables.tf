variable "project_id" {
  description = "Google Cloud project that owns the MVP resources."
  type        = string
  default     = "meu-processo-507018"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a valid Google Cloud project ID."
  }
}

variable "region" {
  description = "Google Cloud region. southamerica-east1 keeps execution in Brazil."
  type        = string
  default     = "southamerica-east1"

  validation {
    condition     = can(regex("^[a-z]+-[a-z]+[0-9]$", var.region))
    error_message = "region must be a valid Google Cloud region name."
  }
}

variable "environment" {
  description = "Deployment environment label."
  type        = string
  default     = "validation"

  validation {
    condition     = contains(["validation", "staging", "production"], var.environment)
    error_message = "environment must be validation, staging, or production."
  }
}

variable "service_name" {
  description = "Cloud Run service name."
  type        = string
  default     = "meu-processo-mvp"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,47}[a-z0-9]$", var.service_name))
    error_message = "service_name must be a valid Cloud Run service name."
  }
}

variable "public_access_enabled" {
  description = "Explicitly allow anonymous HTTP reachability after the Identity Platform-protected revision has passed private smoke tests."
  type        = bool
  default     = false
}

variable "artifact_repository" {
  description = "Artifact Registry repository for immutable application images."
  type        = string
  default     = "meu-processo"
}

variable "image_uri" {
  description = "Immutable container image URI, preferably tagged with the Git commit SHA."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+-docker\\.pkg\\.dev/.+:[a-f0-9]{7,40}$", var.image_uri))
    error_message = "image_uri must be an Artifact Registry URI with an immutable Git SHA tag."
  }
}

variable "browser_renderer_image_uri" {
  description = "Immutable browser renderer image URI, tagged with the same reviewed Git commit SHA."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+-docker\\.pkg\\.dev/.+:[a-f0-9]{7,40}$", var.browser_renderer_image_uri))
    error_message = "browser_renderer_image_uri must be an Artifact Registry URI with an immutable Git SHA tag."
  }
}

variable "browser_renderer_service_name" {
  description = "Private Cloud Run service name for the isolated Chromium worker."
  type        = string
  default     = "meu-processo-browser-renderer"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,47}[a-z0-9]$", var.browser_renderer_service_name))
    error_message = "browser_renderer_service_name must be a valid Cloud Run service name."
  }
}

variable "additional_auth_domains" {
  description = "Additional exact hostnames allowed to complete Identity Platform authentication; omit scheme and path."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for domain in var.additional_auth_domains :
      can(regex("^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$", domain))
    ])
    error_message = "additional_auth_domains must contain exact DNS hostnames without scheme, port, wildcard, or path."
  }
}

variable "managed_foundation_enabled" {
  description = "Include the passive managed-product foundation in plans or in an explicitly approved validation rollout."
  type        = bool
  default     = false
}

variable "managed_foundation_acknowledgement" {
  description = "Exact reviewed gate for the passive foundation: plan-only, or cost assessment 0040 restricted to validation."
  type        = string
  default     = ""

  validation {
    condition = (
      !var.managed_foundation_enabled ||
      var.managed_foundation_acknowledgement == "PLAN_ONLY_NO_APPLY" ||
      (
        var.environment == "validation" &&
        var.managed_foundation_acknowledgement == "APPROVED_VALIDATION_ROLLOUT_0040"
      )
    )
    error_message = "managed_foundation_enabled requires PLAN_ONLY_NO_APPLY, or APPROVED_VALIDATION_ROLLOUT_0040 in validation only."
  }
}

variable "process_object_bucket_name" {
  description = "Optional globally unique GCS bucket name. When null, Terraform derives a validation name from project and environment."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition = (
      var.process_object_bucket_name == null ||
      can(regex("^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$", var.process_object_bucket_name))
    )
    error_message = "process_object_bucket_name must be a valid 3-63 character GCS bucket name."
  }
}

variable "commercial_billing_enabled" {
  description = "Include the Stripe test-mode commercial MVP only behind the reviewed cost and environment gates."
  type        = bool
  default     = false
}

variable "commercial_billing_acknowledgement" {
  description = "Exact reviewed gate for commercial billing: plan-only, or cost assessment 0042 restricted to validation."
  type        = string
  default     = ""

  validation {
    condition = (
      !var.commercial_billing_enabled ||
      (
        var.managed_foundation_enabled &&
        var.commercial_application_public_url != null &&
        var.stripe_person_price_id != null &&
        var.stripe_secret_key_version != null &&
        var.billing_webhook_config_secret_version != null &&
        (
          var.commercial_billing_acknowledgement == "PLAN_ONLY_NO_APPLY" ||
          (
            var.environment == "validation" &&
            var.commercial_billing_acknowledgement == "APPROVED_VALIDATION_ROLLOUT_0042"
          )
        )
      )
    )
    error_message = "commercial billing requires the managed foundation, complete test-mode inputs, and PLAN_ONLY_NO_APPLY or APPROVED_VALIDATION_ROLLOUT_0042 in validation only."
  }
}

variable "commercial_application_public_url" {
  description = "Public HTTPS origin used only for Stripe test-mode return URLs."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition = (
      var.commercial_application_public_url == null ||
      can(regex("^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?/?$", var.commercial_application_public_url))
    )
    error_message = "commercial_application_public_url must be an HTTPS origin without path, query, credentials, or fragment."
  }
}

variable "stripe_person_price_id" {
  description = "Allowlisted Stripe test-mode Price ID for the individual plan; this is not a secret."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.stripe_person_price_id == null || can(regex("^price_[A-Za-z0-9]{8,255}$", var.stripe_person_price_id))
    error_message = "stripe_person_price_id must be a valid Stripe Price ID."
  }
}

variable "stripe_secret_key_version" {
  description = "Pinned numeric Secret Manager version containing the Stripe test secret key."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.stripe_secret_key_version == null || can(regex("^[1-9][0-9]*$", var.stripe_secret_key_version))
    error_message = "stripe_secret_key_version must be a pinned positive numeric version, never latest."
  }
}

variable "billing_webhook_config_secret_version" {
  description = "Pinned numeric version of the JSON bundle containing only the webhook signing secret and dedicated database URL."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.billing_webhook_config_secret_version == null || can(regex("^[1-9][0-9]*$", var.billing_webhook_config_secret_version))
    error_message = "billing_webhook_config_secret_version must be a pinned positive numeric version, never latest."
  }
}
