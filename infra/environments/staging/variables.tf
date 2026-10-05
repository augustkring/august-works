variable "zone" {
  type    = string
  default = "dk-cph1"
}
variable "object_zone" {
  type    = string
  default = "fi-hel1"
}
variable "object_region" {
  type    = string
  default = "europe-1"
}
variable "control_cidr" {
  type    = string
  default = "10.43.0.0/24"
}
variable "runtime_cidr" {
  type    = string
  default = "10.43.16.0/20"
}
variable "object_cidr" {
  type    = string
  default = "10.43.64.0/24"
}
variable "control_plan" {
  type    = string
  default = "2xCPU-4GB"
}
variable "control_disk_gib" {
  type    = number
  default = 40
}
variable "database_plan" {
  type    = string
  default = "1x1xCPU-2GB-25GB"
}
variable "postgres_version" {
  type    = string
  default = "17"
}
variable "os_template" {
  type    = string
  default = "Ubuntu Server 24.04 LTS (Noble Numbat)"
}
variable "nat_plan" {
  type = string
}
variable "ssh_public_keys" {
  type = list(string)
}
variable "admin_ipv4_addresses" {
  type = set(string)
}
variable "app_hostname" {
  type = string
}
