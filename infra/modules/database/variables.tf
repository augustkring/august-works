variable "prefix" { type = string }
variable "zone" { type = string }
variable "plan" { type = string }
variable "postgres_version" { type = string }
variable "network_id" { type = string }
variable "control_private_ip" { type = string }
variable "production" { type = bool }
variable "labels" { type = map(string) }
