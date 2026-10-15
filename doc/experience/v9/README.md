# V9 experience coverage

The supporting [original Agent retirement contract](contracts/native-agent-retirement.json)
adds a reviewed C3 cleanup boundary on the original Agent owner. It preserves
work/history and shared provider state, blocks unsettled work or credentials,
and requires explicit current-source confirmation. Migration, Native and built
UI checks remain pending in the
[scope plan](../../plans/2026-10-11-aw-v9-agent-retirement.md). Full lifecycle,
human/live acceptance and V9 launch readiness remain open.

The [coverage manifest](coverage.json) links stable screen IDs to exact sections
of the unchanged V3 brief, including all ONB/HIRE/CUSTOM screens. It distinguishes
source-defined policy from delivered and verified behavior. Source paragraph
hashes prevent accidental specification drift. The full runtime schema lives
in `packages/shared/src/experience.ts`; required fields follow §76.2.

Run `pnpm check:aw-v9-coverage` to check source inventory and traceability.
`pnpm check:aw-v9-coverage -- --release` additionally requires resolved contracts,
component paths and passed functional/accessibility/security/privacy/usability
evidence for each surface tied to an exact artifact. A pending surface never
passes release just because the brief describes it. Evidence entries have
`kind`, `status`, `artifactSha` and repository `path` fields.

See [architecture decisions](../../adr/V9-ARCHITECTURE-DECISIONS.md),
[implementation ledger](../../plans/2026-10-13-aw-v9-completion.md) and
[source readiness](../../../evals/aw-v9/readiness.json). Operator activation and
hosted qualification remain separate from source coverage.

The supporting [native Memory maintenance-history contract](contracts/native-memory-maintenance-history.json)
adds a bounded historical M1 index-check view over the original Memory jobs and
atomic Activity Log postconditions. It excludes material Memory changes and
does not accept a job status as proof. General maintenance automation and full
V9 acceptance remain open; exact-source qualification is tracked in its
[implementation plan](../../plans/2026-10-11-aw-v9-memory-index-history.md).

The [support and recovery runbook](support-readiness.md) records the confirmed
contact destinations, original support controls, diagnostic limits and unresolved
operating acceptance. It does not declare public support or V9 launch readiness.

The [legacy parity inventory](legacy-parity-inventory.md) records actual shell,
page, test and Storybook callers before retirement. The V9 card stories use the
actual presentation components with explicit fixtures; their presence does not
accept the complete state matrix or Native/human launch evidence.

The supporting [original support controls contract](contracts/native-support-controls.json)
keeps Native review reservation, exact original receipt replay, pending-reference
recovery and cancellation separate from grant-use authority. Its source/tests do
not replace the 70 launch surfaces or hosted/human acceptance.

## Optional protocol experiments

The [AG-UI/A2UI experiment](protocol-interop/README.md) retains pinned upstream
schemas and demonstrates read-only mapping to actual V9 cards. It is not a
production protocol host or authority source; strict types, build, actual upstream tests and built Storybook checks pass. Full
regression and production adoption remain open.


The original first-result binding supports metadata for an already existing C1
Task/run/output that has current independent human worker verification. The
[ONB-11](contracts/onb-11.json) and [ONB-12](contracts/onb-12.json) contracts retain
the explicit completion/revocation boundary. Actual Native tests and built-browser
software fixtures pass; the Original first-task preparation/continue/stop implementation is tracked in the
current ledger. Qualified Free Core delivery, artifact correction and full launch
acceptance remain open.

The supporting [current-owner activation measures contract](contracts/native-activation-measures.json)
projects content-free buckets from original onboarding and independent review.
Recorded transitions are distinct from all required customer actions, and the
usable-account TTFO baseline stays unavailable. No new dataset/provider export
is introduced; existing Paperclip Telemetry remains a separate unchanged path.
The [scope plan](../../plans/2026-10-11-aw-v9-activation-measures.md) records exact
Native, focused, type and built-UI software snapshots and remaining acceptance.

The supporting [first-agent preparation contract](contracts/native-first-agent-preparation.json)
creates one paused original agent or one original hire-approval request through
the existing onboarding/Agent writers. Preparation is distinct from a safe
test, runtime activation and first value. The
[scope plan](../../plans/2026-10-11-aw-v9-first-agent-preparation.md) records the
canonical owners, recovery boundaries, focused checks and pending Native/types/browser tests.

The [activation connection review](../../plans/2026-10-11-aw-v9-activation-connection-review.md)
projects current original Apps setup for published requirements and rechecks it
before the original onboarding step advances to review. Recorded connection
setup remains distinct from Agent authority, credential resolution and a safe
first task. Qualification on this authored scope remains pending.


## Partial Native mappings for the remaining five screen rows

The Apps, Agent change, Agent retirement, workflow access and workflow approval
rows now have V3 screen contracts and actual Native/UI source paths. They were
previously unmapped, even where bounded software already existed. Their status
is in_progress, with explicit remaining implementation and qualification in
their acceptance sections. None has release evidence or verified status.

These mappings do not establish full provider/channel coverage, live-edit/legacy
convergence, automatic reassignment/external cleanup, material permission/policy
editing or complete approval-card settlement. Existing Native owners remain
authoritative. All 70 launch rows and R0 remain open.
