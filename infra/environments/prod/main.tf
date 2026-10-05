terraform {
  required_version = ">= 1.12.2, < 2.0.0"
  required_providers {
    upcloud = { source = "UpCloudLtd/upcloud", version = "= 5.45.0" }
  }
  cloud {
    workspaces { name = "aw-v6-prod" }
  }
}
provider "upcloud" {}
module "foundation" {
  source               = "../../modules/foundation"
  environment          = "prod"
  zone                 = var.zone
  object_zone          = var.object_zone
  object_region        = var.object_region
  control_cidr         = var.control_cidr
  runtime_cidr         = var.runtime_cidr
  object_cidr          = var.object_cidr
  nat_plan             = var.nat_plan
  control_plan         = var.control_plan
  control_disk_gib     = var.control_disk_gib
  database_plan        = var.database_plan
  postgres_version     = var.postgres_version
  os_template          = var.os_template
  ssh_public_keys      = var.ssh_public_keys
  admin_ipv4_addresses = var.admin_ipv4_addresses
  app_hostname         = var.app_hostname
}
output "deployment" { value = { control = module.foundation.control, database = module.foundation.database, objects = module.foundation.objects, runtime_network_id = module.foundation.runtime_network_id, dns_records = module.foundation.dns_records } }

output "object_credentials" {
  value     = module.foundation.object_credentials
  sensitive = true
}
