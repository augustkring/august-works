# UpCloud staging activation — reviewable first step

Date: 2026-10-06. Status: preparation only; no cloud resources or DNS changed.
Source: `infra/` and `doc/operations/aw-v6-runtime.md`. Release foundation branch
`fix/aw-v2-release-foundation` remains NO-GO for a customer pilot.

## Decision

Use the existing Terraform V6 foundation to create **staging first**, with
separate account/state, private PostgreSQL, object storage, Caddy/control VM
and staging-only secrets. Do not provision production in the same apply. Build
and test immutable images in CI/a separate sufficiently large build runner;
the control VM should run the product, not compile the monorepo. Deploy only
accepted digests to staging, then rehearse migration, backup/restore, access
boundaries and rollback before considering production/pilot activation.

## What already exists

- `infra/environments/staging` and `prod` select separate HCP Terraform
  workspaces. Terraform modules cover private networks, NAT, control VM,
  managed PostgreSQL and object storage. Mocked Terraform tests are not a live
  provider plan.
- `deploy/v6/compose.yaml`, Caddy, cloud-init, separate application/migrator/
  backup roles, release CLI, backup and public smoke tooling already exist.
- Staging defaults target Copenhagen control/DB and Finland object network.
  Staging requires explicit NAT plan, SSH key, admin IP and hostname.
- The current `control_plan = "2xCPU-4GB"` is a source default, **not an
  approved size**. UpCloud's current catalog presents `STARTER-*` plan IDs;
  live availability and provider 5.45.0 compatibility must be checked in the
  account. Four GiB on a VM running a 4 GiB-limited app container plus Caddy
  and the OS leaves little headroom; propose an 8 GiB staging VM, not an
  on-host build machine.

## Initial cost envelope, not a quote

Current public EUR list prices: 8 GiB/2-core Starter VM €18/month, single
2 GiB PostgreSQL Developer €14/month, Essentials NAT €0/month, Managed Object
Storage minimum 250 GiB €5/month: **€37/month baseline**. Additional VM disk,
backups, DNS, image registry, build runner, taxes and vendor integrations are
not included. Price/availability and exact plan identifiers need a live
UpCloud account check. No runtime host is included; automatic host creation
stays closed. Source: https://upcloud.com/pricing/ and
https://upcloud.com/docs/products/cloud-servers/configurations/ (checked
2026-10-06).

## Before a live plan/apply

1. Identify the UpCloud staging account/subaccount, HCP Terraform organisation
   and staging workspace, operator SSH public key, restricted admin source IP,
   staging hostname and DNS ownership. Confirm current account resource
   inventory to avoid duplicate spend. Keep provider and HCP credentials in
   their secret systems, not source or chat.
2. Check UpCloud's live Copenhagen VM, PostgreSQL 17, NAT and object-service
   plan IDs/availability against the pinned provider. Select a staging VM with
   operational headroom. Review the actual monthly ceiling, including extras.
3. Run Terraform formatting, init/validate and mocked tests, then a saved
   **staging-only** plan with remote state locking. Review each resource and
   sensitive output without printing secrets. A plan is the spend approval
   artifact; no apply before reviewing it and the account inventory.
4. After staging apply, prove private DB/object reachability, public firewall,
   SSH source restriction, DNS/TLS and state locking. Bootstrap separate roles
   and staging secrets; never reuse production/provider credentials.
5. Build source-bound, digest-pinned `saas` and `saas-backup` images on a
   sufficiently provisioned runner. Typecheck/build/test failures stay open.
   Deploy staging with synthetic data, run migrations and critical security,
   backup/restore and rollback drills, and retain evidence.

## Boundary

No live Terraform plan was run: UpCloud/HCP credentials and Terraform CLI were
not available in the current environment. No resource price or availability
has been verified inside August's UpCloud account. No production rollout,
DNS change, provider calls, pilot invitations or feature activation is implied.
