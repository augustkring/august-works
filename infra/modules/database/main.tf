resource "upcloud_managed_database_postgresql" "this" {
  name                   = "${var.prefix}-postgres"
  title                  = "${var.prefix} PostgreSQL"
  zone                   = var.zone
  plan                   = var.plan
  termination_protection = var.production
  labels                 = var.labels
  network {
    name   = "control"
    family = "IPv4"
    type   = "private"
    uuid   = var.network_id
  }
  properties {
    public_access                       = false
    public_access_prometheus            = false
    automatic_utility_network_ip_filter = false
    ip_filter                           = ["${var.control_private_ip}/32"]
    timezone                            = "UTC"
    version                             = var.postgres_version
  }
}
resource "upcloud_managed_database_logical_database" "app" {
  service = upcloud_managed_database_postgresql.this.id
  name    = "august_works"
}
resource "upcloud_managed_database_user" "app" {
  service  = upcloud_managed_database_postgresql.this.id
  username = "aw_app"
}
resource "upcloud_managed_database_user" "migrator" {
  service  = upcloud_managed_database_postgresql.this.id
  username = "aw_migrator"
}

resource "upcloud_managed_database_user" "backup" {
  service  = upcloud_managed_database_postgresql.this.id
  username = "aw_backup"
}
