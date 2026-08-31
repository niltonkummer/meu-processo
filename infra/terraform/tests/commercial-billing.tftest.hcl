mock_provider "google" {}
mock_provider "google-beta" {}

variables {
  project_id                 = "meu-processo-507018"
  image_uri                  = "southamerica-east1-docker.pkg.dev/meu-processo-507018/meu-processo/app:0123456789abcdef"
  browser_renderer_image_uri = "southamerica-east1-docker.pkg.dev/meu-processo-507018/meu-processo/renderer:0123456789abcdef"
}

run "commercial_billing_is_absent_by_default" {
  command = plan

  assert {
    condition     = length(local.commercial_billing_secret_ids) == 0
    error_message = "Billing secrets must remain absent without the explicit commercial gate."
  }

  assert {
    condition     = length([for env in google_cloud_run_v2_service.app.template[0].containers[0].env : env if startswith(env.name, "BILLING_") || startswith(env.name, "STRIPE_")]) == 0
    error_message = "Billing environment variables must remain absent by default."
  }
}

run "commercial_billing_plan_is_test_only_and_cost_bounded" {
  command = plan

  variables {
    managed_foundation_enabled            = true
    managed_foundation_acknowledgement    = "PLAN_ONLY_NO_APPLY"
    commercial_billing_enabled            = true
    commercial_billing_acknowledgement    = "PLAN_ONLY_NO_APPLY"
    commercial_application_public_url     = "https://validation.meu-processo.example"
    stripe_person_price_id                = "price_12345678ABC"
    stripe_secret_key_version             = "1"
    billing_webhook_config_secret_version = "1"
  }

  assert {
    condition     = length(local.commercial_billing_secret_ids) == 2
    error_message = "The approved billing plan may add exactly two secret containers."
  }

  assert {
    condition     = length(google_secret_manager_secret.managed) == 9
    error_message = "Billing must extend the seven-secret foundation to exactly nine containers."
  }

  assert {
    condition = toset(keys(local.commercial_billing_secret_ids)) == toset([
      "billing_webhook_config",
      "stripe_secret_key",
    ])
    error_message = "Only the Stripe key and bundled private webhook configuration may be added."
  }

  assert {
    condition = alltrue([
      for binding in google_secret_manager_secret_iam_member.managed_accessor :
      binding.role == "roles/secretmanager.secretAccessor"
    ])
    error_message = "Billing secret access must use the narrow accessor role."
  }

  assert {
    condition = {
      for env in google_cloud_run_v2_service.app.template[0].containers[0].env : env.name => env
    }["BILLING_MODE"].value == "stripe-test"
    error_message = "The validation plan must hard-code Stripe test mode."
  }

  assert {
    condition = {
      for env in google_cloud_run_v2_service.app.template[0].containers[0].env : env.name => env
    }["STRIPE_PERSON_PRICE_ID"].value == "price_12345678ABC"
    error_message = "The allowlisted test Price ID must be explicit."
  }

  assert {
    condition = {
      for env in google_cloud_run_v2_service.app.template[0].containers[0].env : env.name => env
    }["STRIPE_SECRET_KEY"].value_source[0].secret_key_ref[0].version == "1"
    error_message = "The Stripe key must use a pinned Secret Manager version."
  }

  assert {
    condition = {
      for env in google_cloud_run_v2_service.app.template[0].containers[0].env : env.name => env
    }["BILLING_WEBHOOK_CONFIG_JSON"].value_source[0].secret_key_ref[0].version == "1"
    error_message = "The webhook bundle must use a pinned Secret Manager version."
  }
}

run "approved_billing_rollout_is_rejected_outside_validation" {
  command = plan

  variables {
    environment                           = "staging"
    managed_foundation_enabled            = true
    managed_foundation_acknowledgement    = "PLAN_ONLY_NO_APPLY"
    commercial_billing_enabled            = true
    commercial_billing_acknowledgement    = "APPROVED_VALIDATION_ROLLOUT_0042"
    commercial_application_public_url     = "https://staging.meu-processo.example"
    stripe_person_price_id                = "price_12345678ABC"
    stripe_secret_key_version             = "1"
    billing_webhook_config_secret_version = "1"
  }

  expect_failures = [var.commercial_billing_acknowledgement]
}
