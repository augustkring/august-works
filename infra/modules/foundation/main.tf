locals {
  prefix = "aw-${var.environment}"
  labels = {
    app         = "august-works"
    environment = var.environment
    managed_by  = "terraform"
    owner       = "platform"
  }
}
module "network" {
  source       = "../network"
  prefix       = local.prefix
  zone         = var.zone
  object_zone  = var.object_zone
  control_cidr = var.control_cidr
  runtime_cidr = var.runtime_cidr
  object_cidr  = var.object_cidr
  nat_plan     = var.nat_plan
  labels       = local.labels
}
module "control" {
  source               = "../control-plane"
  prefix               = local.prefix
  zone                 = var.zone
  plan                 = var.control_plan
  disk_gib             = var.control_disk_gib
  os_template          = var.os_template
  network_id           = module.network.control_network_id
  private_ip           = cidrhost(var.control_cidr, 10)
  ssh_public_keys      = var.ssh_public_keys
  admin_ipv4_addresses = var.admin_ipv4_addresses
  user_data            = file("${path.module}/../../../deploy/v6/control-cloud-init.yaml")
  labels               = local.labels
}
module "database" {
  source             = "../database"
  prefix             = local.prefix
  zone               = var.zone
  plan               = var.database_plan
  postgres_version   = var.postgres_version
  production         = var.environment == "prod"
  network_id         = module.network.control_network_id
  control_private_ip = module.control.private_ipv4
  labels             = local.labels
}
module "objects" {
  source     = "../object-storage"
  prefix     = local.prefix
  region     = var.object_region
  network_id = module.network.object_network_id
  labels     = local.labels
}
