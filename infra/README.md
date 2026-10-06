# V6 UpCloud infrastructure

Provider: UpCloudLtd/upcloud 5.45.0. Terraform: 1.12.x or later in the 1.x series. Resource contracts were checked against the official provider documentation on 2026-10-04.

Production and staging have independent state, labels, SDN ranges, databases, buckets and credentials. Control and database run in Copenhagen; private Object Storage attaches through a routed Finland network. Runtime hosts use the NAT gateway and receive no public interface. Provider firewalls protect public/utility interfaces only; runtime host and container firewalls remain mandatory.

For a first, cost-constrained prelaunch, the intended production foundation may be
provisioned once via `environments/prod` and validated before admitting any
customers; see [the single-environment prelaunch plan](../doc/plans/2026-10-06-upcloud-staging-activation.md).
This does **not** turn the prod root into a staging workspace or make destructive
tests on later customer data acceptable. The separate staging root remains an
option for subsequent releases when isolated rehearsal is needed.

## State and access

The environment roots explicitly select HCP Terraform managed state with locking. Set TF_CLOUD_ORGANIZATION to the operator-owned organization. Use separate aw-v6-prod and aw-v6-staging workspaces and UpCloud accounts/subaccounts. Keep credentials in the managed workspace secret variables, never tfvars or cloud-init. Use local execution mode only through the managed locking backend. Do not apply production with -backend=false.

The UpCloud S3 backend is not selected until lock-loss, concurrent apply and version restore evidence exists. The application bucket must never be used as infrastructure state.

## Reproducible checks

Run terraform fmt -check -recursive infra, init -backend=false and validate in each environment. Terraform tests use the actual provider schema and a mock provider; they do not provision resources. A live plan and private connectivity checks require UpCloud credentials. Review the saved plan before apply.

Configure NAT/control/database plans from current availability and prices. Runtime sizing is benchmark-gated. Costs include control VM, private PostgreSQL, NAT, Finland objects, transfer and any runtime host; no fixed production price is promised.

Database users are separate. The controlled deployment bootstrap grants app DML on application tables and migrator DDL. The app never receives the provider administrative service URI. Generated passwords stay in protected state/provider secret storage and are not exported in normal outputs. Object IAM identities separate app access, backup writes, restore reads and retention deletes. Scoped access keys are sensitive Terraform outputs stored in the protected managed state. Transfer each key directly to its operator or deployment secret store; never print `terraform output -json` in CI. Runtime and database writers have PutObject only and receive no bucket listing or read access. Rotation must keep the old key until the replacement is installed and verified, then deactivate the old key. Runtime/customer credentials are not managed in Terraform.

Bucket deletion is protected even in staging. Provider API bucket deletion can otherwise delete nonempty buckets. Deleting backups requires the explicit retention identity and reviewed lifecycle policy.

Cloud-init contains no service, billing, tenant or deployment secrets. It hardens SSH and creates deployment directories. Install the pinned container runtime and digest-bound deployment bundle through the controlled deployment procedure; do not curl an unverified shell installer.

## Live acceptance evidence

Record private DB and object connectivity, runtime outbound NAT/no inbound, DNS/TLS, remote-state lock/recovery exercises, separate secrets and current provider cost before production admission. The source definitions alone do not satisfy those gates.
