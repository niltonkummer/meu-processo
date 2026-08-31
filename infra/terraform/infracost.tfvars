# Synthetic, non-secret inputs used only by Infracost. Terraform does not load
# this file automatically and deployment workflows must never pass it to apply.
project_id                 = "meu-processo-507018"
region                     = "southamerica-east1"
environment                = "validation"
image_uri                  = "southamerica-east1-docker.pkg.dev/meu-processo-507018/meu-processo/app:0123456789abcdef"
browser_renderer_image_uri = "southamerica-east1-docker.pkg.dev/meu-processo-507018/meu-processo/renderer:0123456789abcdef"

managed_foundation_enabled         = true
managed_foundation_acknowledgement = "PLAN_ONLY_NO_APPLY"
process_object_bucket_name         = "meu-processo-507018-process-objects-validation"
