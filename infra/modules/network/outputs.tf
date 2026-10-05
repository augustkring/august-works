output "control_network_id" { value = upcloud_network.control.id }
output "runtime_network_id" { value = upcloud_network.runtime.id }
output "object_network_id" { value = upcloud_network.objects.id }
output "router_id" { value = upcloud_router.this.id }
output "posture" {
  value = {
    runtime_nat_features  = upcloud_gateway.runtime_nat.features
    runtime_cidr          = upcloud_network.runtime.ip_network[0].address
    runtime_default_route = upcloud_network.runtime.ip_network[0].dhcp_default_route
  }
}
