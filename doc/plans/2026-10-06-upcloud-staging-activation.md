# UpCloud single-environment prelaunch — reviewable first step

Date: 2026-10-06. Status: preparation only; no cloud resources or DNS changed.
Source: `infra/` and `doc/operations/aw-v6-runtime.md`. Release foundation branch
`fix/aw-v2-release-foundation` remains NO-GO for a customer pilot.

## Decision

Provision the **intended production foundation once**, using the existing
`infra/environments/prod` root and its locked `aw-v6-prod` state. Treat it as a
closed prelaunch environment until admission evidence and a pilot decision are
complete. This avoids paying continuously for a second VM, managed PostgreSQL
cluster, NAT gateway and object-store instance. Do not apply the separate
`infra/environments/staging` root merely to validate the first release.

Build and test immutable images in CI/a separate sufficiently large build
runner; the control VM should run the product, not compile the monorepo. Use
synthetic data and prelaunch-only credentials for controlled validation. Before
customer admission, replace/reset test state through a reviewed procedure,
rotate prelaunch secrets and prove the final database is clean. Test restoration
must use an isolated logical database, never overwrite the future customer DB.
Then deploy the accepted digest and open only the agreed pilot surface.

## What already exists

- `infra/environments/staging` and `prod` select separate HCP Terraform
  workspaces. **Use only `prod` for this route.** Terraform modules cover private
  networks, NAT, control VM, managed PostgreSQL and object storage. Mocked
  Terraform tests are not a live provider plan. The prod root enables database
  termination protection.
- `deploy/v6/compose.yaml`, Caddy, cloud-init, separate application/migrator/
  backup roles, release CLI, backup and public smoke tooling already exist.
- Production defaults target Copenhagen control/DB and Finland object network.
  A live plan requires explicit NAT plan, SSH key, admin IP and hostname.
- The current `control_plan = "2xCPU-4GB"` is a source default, **not an
  approved size**. UpCloud's current catalog presents `STARTER-*` plan IDs;
  live availability and provider 5.45.0 compatibility must be checked in the
  account. Four GiB on a VM running a 4 GiB-limited app container plus Caddy
  and the OS leaves little headroom; propose an 8 GiB control VM, not an
  on-host build machine.

## Initial cost envelope, not a quote

Current public EUR list prices: 8 GiB/2-core Starter VM €18/month, single
2 GiB PostgreSQL Developer €14/month, Essentials NAT €0/month, Managed Object
Storage minimum 250 GiB €5/month: **€37/month baseline**. Additional VM disk,
backups, DNS, image registry, build runner, taxes and vendor integrations are
not included. Price/availability and exact plan identifiers need a live
UpCloud account check. There is **one** such foundation, not one each for
staging and production. No runtime host is included; automatic host creation
stays closed. Source: https://upcloud.com/pricing/ and
https://upcloud.com/docs/products/cloud-servers/configurations/ (checked
2026-10-06).

## Before a live plan/apply

1. Identify the UpCloud account/subaccount, HCP Terraform organisation and
   `aw-v6-prod` workspace, operator SSH public key, restricted admin source IP,
   intended public hostname and DNS ownership. Confirm current account resource
   inventory to avoid duplicate spend. Keep provider and HCP credentials in
   their secret systems, not source or chat.
2. Check UpCloud's live Copenhagen VM, PostgreSQL 17, NAT and object-service
   plan IDs/availability against the pinned provider. Select a control VM with
   operational headroom. Review the actual monthly ceiling, including extras.
3. Run Terraform formatting, init/validate and mocked tests, then a saved
   **single-foundation** plan with remote state locking. Review each resource and
   sensitive output without printing secrets. A plan is the spend approval
   artifact; no apply before reviewing it and the account inventory.
4. After apply, prove private DB/object reachability, public firewall, SSH
   source restriction, DNS/TLS and state locking. Keep signup, checkout,
   customer invitations and autonomous runtime admission closed. Bootstrap
   separate least-privilege roles and prelaunch-only secrets.
5. Build source-bound, digest-pinned `saas` and `saas-backup` images on a
   sufficiently provisioned runner. Typecheck/build/test failures stay open.
   Deploy with synthetic data, run migrations and critical security,
   backup/restore and rollback drills, and retain evidence. Before opening a
   pilot, discard test accounts/data, rotate prelaunch credentials, verify a
   clean final DB and repeat the admission smoke on the exact release image.

## Trade-off after launch

There will be no permanently isolated staging environment for later changes.
Do not test destructive migrations or restore against live customer data.
Use CI plus an isolated logical database or a short-lived clone for later
releases; if that stops being credible, add a separate temporary staging
environment then. This saves recurring spend now but makes release rehearsal
and rollback discipline more important.

## All-features dry run on source (2026-10-06)

The local V5/V6/V7 all-true feature dependency test and migrated-PostgreSQL
admission test passed: 11/11 tests across two suites. This shows a
dependency-complete flag configuration can be admitted; it does **not** exercise
all enabled feature behavior or a deployed UpCloud instance. The read-only V7
readiness checker (`--require-ready`) exited 1, reporting three incomplete
implementation blockers (native OpenShell host bridge, physical credential-use
broker/revocation, and pre-spend enforcement for managed autonomous sessions)
and 35 required evidence items absent because no live pilot report exists.
Keep this distinction explicit when doing the later all-on deployment exercise:
test everything in the closed prelaunch installation, record failures, then
decide which features are complete enough to admit. Do not equate all flags
being true with release readiness.

## Boundary

No live Terraform plan was run: UpCloud/HCP credentials and Terraform CLI were
not available in the current environment. No resource price or availability
has been verified inside August's UpCloud account. This is a choice of
resource topology, **not authorization to apply it or activate production**.
No DNS change, provider call, pilot invitation or feature activation is implied.
