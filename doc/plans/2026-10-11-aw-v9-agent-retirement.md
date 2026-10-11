# V9 paused-agent retirement: Safe Change Record and implementation plan

Status: **in progress; new Source and tests are not qualified**.
Brief: §79.6. Applicable references: requirements/domain engineering,
architecture, databases, security, privacy, reliability, construction/testing,
agentic engineering and UX/UI playbooks in `doc/reference/aw-v9/playbooks/`.
The references supply guidelines; the user's request authorizes implementation.

## Problem and risk

The existing Agent `terminate` operation changes status and revokes API keys.
It does not supply the full reviewed V9 retirement contract. Retirement is a
C3 consequential change. It requires explicit current-human review and must
not delete shared provider state, conceal pending work, discard evidence or
create an automatic restoration path. Core built-in agents remain protected.

## Canonical owner and proposed boundary

Extend the original Agent owner with an agent-specific `agent_retirements`
receipt. This is neither a second queue nor a source of execution authority.
The original Activity Log retains actor identity and its existing retention
owner. The receipt stores only bound request/source hashes, policy version,
counts of detached local Agent access and a checked local postcondition.
Company/Agent cascade erasure follows the original owning entities; ordinary
retirement preserves configuration, versions, work and audit history.

Require a paused Agent, or explicit reconciliation of a legacy stopped Agent,
and settled/reassigned original work. A legacy `terminated` status alone never
becomes a V9 retirement receipt. Unresolved
provider/tool effects, pending requests, live plans, connected automations,
dependent reporting chains and active installed capabilities/provider grants
block retirement. Their original owners must settle, disconnect or reconcile
them. This operation makes no provider-side revocation or stopped external
runtime claim. Shared provider/credential definitions stay with their owner.

The Native transaction locks current company/Agent and current human authority,
checks a reviewed source token and current blockers, invokes the original
termination writer, detaches only this Agent's local access, verifies the
postcondition and records the receipt/audit atomically. Same-request replay
reads current original state; different content or stale source cannot repeat
the effect. A pre-commit failure rolls back all local mutations and publishes
no live audit event. SQL owner fences must prevent later revival/active binding
inserts for this retired Agent, including callers outside the new UI.

## Bounds, privacy and recovery

Preserve original five-second transaction and one-second lock budgets. Inspect
at most 257 records per access family; more than 256 blocks the action instead
of reporting zero or performing partial cleanup. Reads expose current Agent
identity/name, fixed blocker codes, count metadata and an opaque source token;
no configuration, secret values, prompt/output, credential names or private
errors. Current verified account, membership and original configure/runtime
authority are required, as are original permission-administration and
tool-administration authority; instance-admin status is insufficient. The
[processing contract](../../../packages/shared/src/agent-retirement.ts) records
allowed/prohibited fields, scope, sink, existing retention and rights behavior.
Local gateway sessions count alongside Agent tool tokens. Agent permission
settings count as one settings record separately from grants and delegations.
Unexpired or ambiguous credential issuance blocks retirement until its original
owner reconciles it; an unknown issuance never becomes revoked implicitly.
Pending original OAuth attempts also block retirement. Local Agent membership
is made inactive alongside permission cleanup; human and other-presence
memberships stay untouched. Later membership/OAuth writes are fenced by the
same original Agent receipt. Ordinary retirement preserves history, while the
original Agent erasure owner may cascade its receipt without removing another
company's presence or inventing a separate erasure policy.

Unknown replies require an original-owner read/retry of the same request.
Rollback applies only before Native commit. Once recorded, retirement is
permanent in this scope; there is no undo/resume button or reconstructed grant.
Rollout can disable new retirement admission while existing retired state and
SQL owner fences remain. Data deletion/retention keeps its existing policy;
retirement is not an erasure receipt or a retention executor.

## Qualification required before any completion claim

Generate the real Drizzle migration, add SQL owner fences, check migration
safety/numbering, and run strict types and original migrated PostgreSQL suites.
Exercise concurrent/unknown-ack replay, current authority/source withdrawal,
pending and ambiguous work, original provider/installation boundaries, rollback,
cross-company isolation, bounded inspection, protected agents, no shared-state
removal, permanent Native fencing and preservation of prior revocation times.
Built customer UI needs explicit confirmation, safe retry/current account
fencing, English/Danish, keyboard/touch, reflow and axe checks. Software UI
transport does not qualify Native permission, hosted identity or live providers.

Heavy generation/types/Native/browser checks wait for the frozen integrated
qualification and first-agent qualification to finish, avoiding competition
with original Native test budgets. No migration/test result is claimed yet.
Full V9 source, other lifecycle stages, human/live acceptance and PR review
remain open. `sourceComplete` stays false and all 70 launch surfaces stay pending.

## Focused software check, 2026-10-11

The first scoped snapshot passed all 33 cases in five complete shared/UI/API/
locale/log-policy files and the original token gates. Evidence is
`/workspace/v9-agent-retirement-focused-v1-*`, with matching before/after Source
hashes. Subsequent Native fences, processing contract and separate Agent
permission-settings count changed Source; the earlier result does not qualify
the current snapshot. Migration, strict types, migrated Native tests, built UI
and current combined regression remain pending. No production flag is enabled.

The second focused snapshot also passed all 33 cases and token/non-release
traceability gates, with unchanged Source SHA-256
`90942beabdcab99be471384e0030d6717fad3e4ad88b38e029826380acc0e179`.
Later additions cover original membership and OAuth ownership plus the truthful
onboarding review heading; a fresh focused check will precede heavy scope
qualification. None of these checks qualifies Native retirement or full V9.

## Generated Native migration — 2026-10-11

Actual `pnpm db:generate` created `0464_short_talon.sql` and its Drizzle
snapshot/journal entry. The reviewed migration installs the new receipt table,
original composite Agent/company cascade references and permanent Native
state, binding and automation fences. Generated DDL contains no destructive
table/column/data operation. The historical 0459 snapshot automatically pruned
by generation is restored unchanged from committed source.

Original migration numbering and safety checks pass (existing historical
baseline remains unchanged). Actual migrated Native, current full server/UI
types and built retirement browser qualification remain pending. A generated
migration or source fence is not a passed postcondition.

## Original shared identity lifecycle — 2026-10-11

The first actual Native run passed 103 cases but failed ten new retirement
cases against the original shared-home lifecycle trigger; three legacy suites
could not import four unreadable public Source files. The fixture was an active
shared home, which cannot be terminated while another company presence is
active. This failure is preserved in the Native v2 log.

Review now latches the original identity before the presence, includes its native
version in the reviewed source token and blocks a shared home until the original
identity owner rehomes it. No global archive or other-company termination is
introduced. Ordinary native retirement cases explicitly use the existing
rehome owner, then pause this presence. A dedicated case retains the shared-home
blocker, verifies the other presence remains active, and requires fresh review
after rehome. Original triggers and all earlier assertions remain in place.
Current changed Source requires a new complete qualification; no pass is claimed
from the earlier version.
