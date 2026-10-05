resource "upcloud_router" "this" {
  name   = "${var.prefix}-router"
  labels = var.labels
  lifecycle { ignore_changes = [static_route] }
}
resource "upcloud_network" "control" {
  name   = "${var.prefix}-control"
  zone   = var.zone
  router = upcloud_router.this.id
  labels = var.labels
  ip_network {
    address            = var.control_cidr
    dhcp               = true
    family             = "IPv4"
    dhcp_default_route = false
  }
}
resource "upcloud_network" "runtime" {
  name   = "${var.prefix}-runtime"
  zone   = var.zone
  router = upcloud_router.this.id
  labels = var.labels
  ip_network {
    address            = var.runtime_cidr
    dhcp               = true
    family             = "IPv4"
    dhcp_default_route = true
    gateway            = cidrhost(var.runtime_cidr, 1)
  }
}
resource "upcloud_network" "objects" {
  name   = "${var.prefix}-objects"
  zone   = var.object_zone
  router = upcloud_router.this.id
  labels = var.labels
  ip_network {
    address            = var.object_cidr
    dhcp               = true
    family             = "IPv4"
    dhcp_default_route = false
  }
}
resource "upcloud_gateway" "runtime_nat" {
  name     = "${var.prefix}-nat"
  zone     = var.zone
  features = ["nat"]
  plan     = var.nat_plan
  labels   = var.labels
  router { id = upcloud_router.this.id }
}
