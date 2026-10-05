output "control" { value = { id = module.control.id, public_ipv4 = module.control.public_ipv4, private_ipv4 = module.control.private_ipv4 } }
output "database" { value = { id = module.database.id, host = module.database.host, port = module.database.port, name = module.database.database, app_user = module.database.app_user, migrator_user = module.database.migrator_user, backup_user = module.database.backup_user } }
output "objects" { value = { id = module.objects.id, endpoints = module.objects.endpoints, buckets = module.objects.buckets, users = module.objects.users } }
output "runtime_network_id" { value = module.network.runtime_network_id }
output "posture" { value = { control = module.control.posture, database = module.database.posture, network = module.network.posture } }
output "dns_records" { value = [{ type = "A", name = var.app_hostname, value = module.control.public_ipv4, ttl = 300 }] }

output "object_credentials" {
  value     = module.objects.credentials
  sensitive = true
}
