variable "prefix" { type = string }
variable "zone" { type = string }
variable "object_zone" { type = string }
variable "control_cidr" { type = string }
variable "runtime_cidr" { type = string }
variable "object_cidr" { type = string }
variable "nat_plan" { type = string }
variable "labels" { type = map(string) }
