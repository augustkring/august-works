output "id" { value = upcloud_managed_database_postgresql.this.id }
output "host" { value = upcloud_managed_database_postgresql.this.service_host }
output "port" { value = upcloud_managed_database_postgresql.this.service_port }
output "database" { value = upcloud_managed_database_logical_database.app.name }
output "app_user" { value = upcloud_managed_database_user.app.username }
output "migrator_user" { value = upcloud_managed_database_user.migrator.username }
output "posture" {
  value = {
    public_access          = upcloud_managed_database_postgresql.this.properties[0].public_access
    utility_access         = upcloud_managed_database_postgresql.this.properties[0].automatic_utility_network_ip_filter
    termination_protection = upcloud_managed_database_postgresql.this.termination_protection
  }
}

output "backup_user" { value = upcloud_managed_database_user.backup.username }
