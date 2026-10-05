output "id" { value = upcloud_server.this.id }
output "public_ipv4" { value = upcloud_server.this.network_interface[0].ip_address }
output "private_ipv4" { value = upcloud_server.this.network_interface[1].ip_address }
output "posture" {
  value = {
    public_ports           = [for rule in upcloud_firewall_rules.this.firewall_rule : rule.destination_port_start if rule.direction == "in" && rule.action == "accept"]
    default_inbound_action = upcloud_firewall_rules.this.firewall_rule[length(upcloud_firewall_rules.this.firewall_rule) - 2].action
  }
}
