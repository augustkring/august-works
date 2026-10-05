resource "upcloud_server" "this" {
  hostname = "${var.prefix}-control"
  title    = "${var.prefix} control plane"
  zone     = var.zone
  plan     = var.plan
  firewall = true
  metadata = true
  labels   = var.labels
  login {
    user              = "aw-operator"
    keys              = var.ssh_public_keys
    create_password   = false
    password_delivery = "none"
  }
  template {
    storage = var.os_template
    size    = var.disk_gib
  }
  network_interface {
    type              = "public"
    ip_address_family = "IPv4"
  }
  network_interface {
    type       = "private"
    network    = var.network_id
    ip_address = var.private_ip
  }
  user_data = var.user_data
}
resource "upcloud_firewall_rules" "this" {
  server_id = upcloud_server.this.id
  dynamic "firewall_rule" {
    for_each = ["80", "443"]
    content {
      action                 = "accept"
      direction              = "in"
      family                 = "IPv4"
      protocol               = "tcp"
      destination_port_start = firewall_rule.value
      destination_port_end   = firewall_rule.value
    }
  }
  dynamic "firewall_rule" {
    for_each = var.admin_ipv4_addresses
    content {
      action                 = "accept"
      direction              = "in"
      family                 = "IPv4"
      protocol               = "tcp"
      source_address_start   = firewall_rule.value
      source_address_end     = firewall_rule.value
      destination_port_start = "22"
      destination_port_end   = "22"
    }
  }
  firewall_rule {
    action    = "drop"
    direction = "in"
  }
  firewall_rule {
    action    = "accept"
    direction = "out"
  }
}
