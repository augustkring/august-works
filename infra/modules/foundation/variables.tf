variable "environment" {
  type = string
  validation {
    condition     = contains(["prod", "staging"], var.environment)
    error_message = "Use a separate prod or staging environment."
  }
}
variable "zone" { type = string }
variable "object_zone" { type = string }
variable "object_region" { type = string }
variable "control_cidr" { type = string }
variable "runtime_cidr" { type = string }
variable "object_cidr" { type = string }
variable "nat_plan" { type = string }
variable "control_plan" { type = string }
variable "control_disk_gib" { type = number }
variable "database_plan" { type = string }
variable "postgres_version" { type = string }
variable "os_template" { type = string }
variable "ssh_public_keys" { type = list(string) }
variable "admin_ipv4_addresses" {
  type = set(string)
  validation {
    condition     = alltrue([for address in var.admin_ipv4_addresses : can(cidrnetmask("${address}/32"))])
    error_message = "Admin ingress requires individual IPv4 addresses."
  }
}
variable "app_hostname" {
  type = string
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]+[a-z0-9]$", var.app_hostname))
    error_message = "Use an explicit DNS hostname without a scheme or path."
  }
}
