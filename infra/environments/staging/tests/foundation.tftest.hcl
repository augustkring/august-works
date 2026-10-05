mock_provider "upcloud" {}

variables {
  nat_plan             = "development"
  ssh_public_keys      = ["ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMockKeyForPlanOnlyNoLiveAccess00000000"]
  admin_ipv4_addresses = ["192.0.2.1"]
  app_hostname         = "staging.example.invalid"
}

run "isolated_foundation_plan" {
  command = plan
  assert {
    condition     = module.foundation.posture.database.public_access == false && module.foundation.posture.database.utility_access == false
    error_message = "The managed database must reject public and utility-network access."
  }
  assert {
    condition     = module.foundation.posture.database.termination_protection == false
    error_message = "Production database termination protection must be enabled."
  }
  assert {
    condition     = module.foundation.posture.control.default_inbound_action == "drop" && toset(module.foundation.posture.control.public_ports) == toset(["80", "443", "22"])
    error_message = "The public control VM must expose only web ports and address-scoped SSH."
  }
  assert {
    condition     = contains(module.foundation.posture.network.runtime_nat_features, "nat") && module.foundation.posture.network.runtime_default_route
    error_message = "Private runtime networking requires outbound NAT."
  }
}
