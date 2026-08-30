mock_provider "google" {}
mock_provider "google-beta" {}

run "service_is_private_by_default_and_scales_to_zero" {
  command = plan

  variables {
    project_id                 = "meu-processo-507018"
    image_uri                  = "southamerica-east1-docker.pkg.dev/meu-processo-507018/meu-processo/app:0123456789abcdef"
    browser_renderer_image_uri = "southamerica-east1-docker.pkg.dev/meu-processo-507018/meu-processo/renderer:0123456789abcdef"
  }

  assert {
    condition     = google_cloud_run_v2_service.app.invoker_iam_disabled == false
    error_message = "Cloud Run IAM authentication must remain enabled."
  }

  assert {
    condition     = google_cloud_run_v2_service.browser_renderer.invoker_iam_disabled == false
    error_message = "The browser renderer must require Cloud Run IAM authentication."
  }

  assert {
    condition     = google_cloud_run_v2_service.browser_renderer.template[0].scaling[0].min_instance_count == 0 && google_cloud_run_v2_service.browser_renderer.template[0].scaling[0].max_instance_count == 1
    error_message = "The browser renderer must scale from zero to one isolated instance."
  }

  assert {
    condition     = google_cloud_run_v2_service.browser_renderer.template[0].max_instance_request_concurrency == 1
    error_message = "The browser renderer must accept only one active browser session per instance."
  }

  assert {
    condition     = google_cloud_run_v2_service.browser_renderer.ingress == "INGRESS_TRAFFIC_ALL"
    error_message = "The IAM-private renderer must remain reachable from the gateway through its Cloud Run URL."
  }

  assert {
    condition     = google_cloud_run_v2_service_iam_member.browser_renderer_invoker.member == "serviceAccount:meu-processo-runtime@meu-processo-507018.iam.gserviceaccount.com"
    error_message = "Only the gateway runtime identity may invoke the browser renderer."
  }

  assert {
    condition     = google_cloud_run_v2_service_iam_member.browser_renderer_invoker.role == "roles/run.invoker"
    error_message = "The gateway may receive only the Cloud Run invoker role on the renderer."
  }

  assert {
    condition     = length(google_cloud_run_v2_service_iam_member.public_invoker) == 0
    error_message = "Public invocation must require an explicit rollout flag."
  }

  assert {
    condition     = google_cloud_run_v2_service.app.template[0].scaling[0].min_instance_count == 0
    error_message = "The validation service must scale to zero."
  }

  assert {
    condition     = google_cloud_run_v2_service.app.template[0].session_affinity == true
    error_message = "The short-lived document challenge must keep a best-effort affinity with its issuing instance."
  }

  assert {
    condition     = google_cloud_run_v2_service.app.deletion_protection == true
    error_message = "Deletion protection must remain enabled."
  }

  assert {
    condition     = google_project_service.required["cloudresourcemanager.googleapis.com"].disable_on_destroy == false
    error_message = "The quota-project flow requires Cloud Resource Manager and must not disable it on destroy."
  }
}

run "public_validation_edge_requires_explicit_flag" {
  command = plan

  variables {
    project_id                 = "meu-processo-507018"
    image_uri                  = "southamerica-east1-docker.pkg.dev/meu-processo-507018/meu-processo/app:0123456789abcdef"
    browser_renderer_image_uri = "southamerica-east1-docker.pkg.dev/meu-processo-507018/meu-processo/renderer:0123456789abcdef"
    public_access_enabled      = true
  }

  assert {
    condition     = length(google_cloud_run_v2_service_iam_member.public_invoker) == 1
    error_message = "The explicit public rollout flag must create one invoker binding."
  }

  assert {
    condition     = google_cloud_run_v2_service_iam_member.public_invoker[0].role == "roles/run.invoker"
    error_message = "The public edge may grant only the Cloud Run invoker role."
  }

  assert {
    condition     = google_cloud_run_v2_service_iam_member.public_invoker[0].member == "allUsers"
    error_message = "The validation frontend requires unauthenticated HTTP reachability."
  }
}

run "identity_platform_authentication_is_email_only" {
  command = plan

  variables {
    project_id                 = "meu-processo-507018"
    image_uri                  = "southamerica-east1-docker.pkg.dev/meu-processo-507018/meu-processo/app:0123456789abcdef"
    browser_renderer_image_uri = "southamerica-east1-docker.pkg.dev/meu-processo-507018/meu-processo/renderer:0123456789abcdef"
  }

  assert {
    condition     = google_identity_platform_config.authentication.sign_in[0].email[0].enabled == true
    error_message = "Identity Platform email authentication must be enabled."
  }

  assert {
    condition     = google_identity_platform_config.authentication.sign_in[0].email[0].password_required == true
    error_message = "Email authentication must require a password."
  }

  assert {
    condition     = google_identity_platform_config.authentication.sign_in[0].anonymous[0].enabled == false
    error_message = "Anonymous authentication must remain disabled."
  }

  assert {
    condition     = google_identity_platform_config.authentication.sign_in[0].phone_number[0].enabled == false
    error_message = "Phone/SMS authentication must remain disabled."
  }

  assert {
    condition     = google_cloud_run_v2_service.app.invoker_iam_disabled == false
    error_message = "Adding Identity Platform must not disable Cloud Run IAM authentication."
  }

  assert {
    condition     = google_project_iam_member.runtime_firebase_auth_viewer.role == "roles/firebaseauth.viewer"
    error_message = "The runtime may receive only the read-only Firebase Authentication role needed for revocation checks."
  }

  assert {
    condition     = google_project_iam_member.runtime_firebase_auth_viewer.member == "serviceAccount:meu-processo-runtime@meu-processo-507018.iam.gserviceaccount.com"
    error_message = "The Authentication Viewer role must be bound only to the Cloud Run runtime identity."
  }

  assert {
    condition     = google_project_service.required["apikeys.googleapis.com"].disable_on_destroy == false
    error_message = "The browser authentication key API must remain enabled and managed by Terraform."
  }

  assert {
    condition     = google_apikeys_key.browser_authentication.restrictions[0].api_targets[0].service == "identitytoolkit.googleapis.com"
    error_message = "The public browser key must be restricted to Identity Toolkit only."
  }

  assert {
    condition     = google_apikeys_key.browser_authentication.restrictions[0].browser_key_restrictions[0].allowed_referrers[0] == "http://localhost:*/*"
    error_message = "The restricted key must support only the explicit local development origin in addition to Cloud Run."
  }
}
