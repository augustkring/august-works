# Production hotspot responsibility register

Reviewed 28 October 2026 against the pinned V10 brief, §26 and V10-100.
The [machine-readable register](production-hotspot-responsibilities.json)
covers all 25 production paths named in §26.1. It records source hashes,
responsibility boundaries, direct import callers, direct import tests and
change-specific extraction rules. A source hash identifies the review snapshot;
it does not pin a runtime or certify that a test passes.

The domain labels describe the code's responsibilities. They do not assign a
person, create an authorization role or promise operational coverage. The
current `.github/CODEOWNERS` names reviewers for release and dependency paths;
it does not assign these production paths. Each entry therefore records its
accountable maintainer as unassigned. Repository maintainers must make those
assignments before treating the register as an operational escalation roster.

When changing a listed path:

1. Read its existing responsibilities, callers and relevant characterization
   tests. Follow runtime wiring and indirect callers for the affected command.
2. Keep the change within its current domain. If a new responsibility needs a
   boundary, use an existing policy, adapter, projection or lifecycle owner.
3. Preserve the owner's transaction, current authorization, approval, privacy,
   idempotency and Stop rules. Extract only the seam needed by the change.
4. Run the affected behavior checks and record their exact source snapshot.
   Update this register when an owned responsibility or import seam changes.
5. Use `scripts/check-module-boundaries.mjs` for the registered module-layer
   boundaries. This check does not validate all policy or runtime boundaries.

The six critical domains have additional constraints:

| Domain | Boundary to preserve |
|---|---|
| Chat channels | Provider intake and publication use current principal and conversation bindings. Provider adapters do not create permission. |
| Heartbeat | Scheduling and run claiming compose existing admission, continuation and recovery owners. Task-before-Run lock order and physical Stop proof remain intact. |
| Tool access | Credentials, grants and provider transport use the existing connection and policy owners. Discovery does not grant execution rights. |
| Tool gateway | Operation adapters retain current authority, approval, ledger idempotency and uncertain-effect reconciliation. |
| Workflow executor | Published revision, step checkpoints, Human publication, cancellation and effect accounting remain owned by the workflow lifecycle. |
| Native executor | Pinned manifests, current source access, exact process/lease identity and Stop/erasure receipts remain enforced across transport boundaries. |

The import lists contain direct relative imports only. They are navigation aids,
not a full dependency graph; aliases, dynamic imports and runtime injection
need change-specific inspection. File bytes are measured at the recorded hash.
Churn, defect density, test duration and review difficulty are unmeasured here.
There is no synthetic complexity score or file-size acceptance threshold.

Retained `.production` screens and LegacyInbox remain explicitly listed. This
register does not authorize their removal: mounted routes, flags, deep links,
permissions and migration evidence must establish replacement coverage first.
