# V5 acceptance evidence — 2026-10-04

This is a fresh build from V4 commit
`f4f594c8571d13b9cb7e6803f8a894075ab8b4f8`, on
`codex/v5-agent-runtime-fabric`. The user authorized starting over. All 37 supplied
documents were read before source changes. The V5 master brief defines scope;
the supporting documents guide the work and do not grant access or spending.

The historical recovery fragment was checked and retained outside the repository.
Its truncated patches were not used as a source snapshot or executed.

## Implemented behavior

- Global identity with one home and unique local presences. Local permissions,
  keys, profiles, budgets and reporting lines remain local. Lifecycle changes
  serialize and cancellation runs after transaction commit.
- Provider bindings with per-presence defaults, explicit shared-state consent,
  discovery hashes, current peer/configuration proof and drift invalidation.
  Unconfirmed provider termination pauses the local presence and invalidates its
  binding on conformance and normal execution. V5 wait timeouts require stop
  confirmation; agent finalization preserves a concurrent pause or termination.
  Hermes and OpenClaw use real gateway dispatch/cancellation hooks. A2A Agent
  Cards use bounded, guarded discovery and stable protocol/security metadata.
- Expiring execution scopes and immutable execution manifests. Every use checks
  current local presence and represented-human authority. Scoped task reads,
  forecasts, plan proposals and Playbook proposals retain source provenance.
- Target-accepted relationships, local organizational units and versioned Role
  Pack overlays. These records do not grant access. Deterministic resolution
  filters current policy and pins behavior versions within explicit budgets.
- Private Skill candidates, immutable versions, overlap reviews, paired evidence,
  guarded promotion, dependency invalidation and retained usage observations.
  Executor teardown records loaded observations for committed terminal runs,
  including failure, interruption, cancellation and timeout, with unknown outcomes
  and idempotent per-version events. A running/recovering run is never completed.
  Required evaluation suites can be replaced atomically while preserving old
  cases and evaluation history. Private and classified boundaries survive
  rollout rollback.
- Canonical reviewed Playbooks, optimistic proposals, metadata administration,
  pinned Skill projections, feedback and drift. Projection creates candidates.
  A failed candidate compilation preserves the human-approved canonical source.
  Source sensitivity propagates to derived Skills and revokes public sharing.
- Frozen portfolio publications and explicit local adoption/subscriptions.
  Installation and upgrade are atomic. They cannot activate Skills, approve
  Playbooks, or inherit source-company permissions.
- Canonical task plans, milestones, optimistic schedule proposals, explicit
  baselines and separate forecasts/actuals. Retained external field ownership
  continues to block conflicting legacy writes when the V5 view is disabled.
- Roadmap calendar and accessible table, keyboard proposals, drag/resize,
  named baselines, plan/forecast/actual rails, scoped export and deterministic
  health. Health exposes source tasks, milestone variance and authorized project
  budget observations. Missing observations and explicitly unknown billed costs remain unknown. A 72-hour default
  reports missing task updates; it does not claim the absence of all activity.
- Bundled `task-planning` Skill, titled Project Planning & Execution, reused by
  CEO/CTO planning requirements and available to local project-lead overlays.
  Import alone does not create an active V5 version.
- Per-company August OS and portfolio aggregation over current authorized data.
  All 20 V5 flags default off and enforce their prerequisites.

## Hard-gate evidence map

These are local regression checks. They do not certify an external pilot. The
pilot must exercise the configured provider and actual participating companies.

| Gate | Local evidence | Pilot status |
| --- | --- | --- |
| Identity does not grant access | `agent-identities-v5.test.ts` | Not run |
| Guest authority stays local | `agent-identities-v5.test.ts`, `v5-scope-organization-provider.test.ts` | Not run |
| Home grants no guest access | `agent-identities-v5.test.ts` | Not run |
| Scope is explicit | `v5-scope-organization-provider.test.ts`, `agent-runtime-fabric-v5.test.ts` | Not run |
| Results retain source company | `agent-runtime-fabric-v5.test.ts` | Not run |
| Read-only scopes cannot mutate | `agent-runtime-fabric-v5.test.ts` | Not run |
| Shared runtime is explicitly acknowledged | `v5-scope-organization-provider.test.ts` | Not run |
| Actual provider isolation | Gateway conformance drivers and bound peer/configuration regressions | Real provider proof required |
| Relationships do not grant access | `v5-scope-organization-provider.test.ts`, `portfolio-v5.test.ts` | Not run |
| Org Units do not grant access | `v5-scope-organization-provider.test.ts` | Not run |
| Role Packs do not grant authority | `role-packs-v5.test.ts` | Not run |
| Skills do not grant authority | Resolver and lifecycle policy regressions | Not run |
| Self-promotion needs explicit policy | `skill-lifecycle-v5.test.ts` and evaluation regressions | Not run |
| Degraded Skills are excluded | Dependency/resolver regressions | Not run |
| Playbooks do not activate Skills | `playbooks-project-control-v5.test.ts`, browser candidate flow | Not run |
| Skills do not approve Playbooks | Canonical review/projection regressions | Not run |
| Provider loss invalidates dependents | `provider-conformance-v5.test.ts` | Not run |
| Roadmap uses canonical fields | `playbooks-project-control-v5.test.ts`, browser baseline/review flow | Not run |
| Forecast is not a commitment | Project-control and scoped-action regressions | Not run |
| August OS respects current company access | `portfolio-v5.test.ts` | Not run |

All server files in the table are under `server/src/__tests__/`. Authenticated
browser checks use real PostgreSQL, two users, separate companies, session
cookies and Origin/CSRF checks. They cover company switching, foreign-object
denial, revoked membership and feature rollback. Browser fixtures do not call
paid providers.

## Remaining implementation and operational requirements

This checkpoint is not full V5 acceptance or a production release.

1. Add the native `paperclip_runner` V5 discovery/conformance bridge to the native
   coordinator. Existing native execution regressions pass, but they do not
   qualify a new V5 provider binding. Native bindings remain unqualified.
2. Complete A2A execution/conformance transport integration. Agent Card discovery
   is advertisement, not proof. A2A bindings remain unqualified.
3. Extend the scoped action wrapper to general guest-company connected tools.
   The current wrapper supports the four documented task/Playbook actions.
   Existing local tool-session/run ownership cannot be bypassed by a fabricated
   guest run or primary-company credential.
4. Reconcile retained Skill observations after process loss and durable recovery
   that completes outside the active executor. The shared executor teardown now
   covers terminal fast/exceptional returns; a missing observation or unknown
   outcome still cannot serve as promotion evidence.
5. Curate/import the supplied Role Pack Skill/Playbook sources into the actual
   selected companies and evaluate/promote them under local policy. Unresolved
   required references fail closed. Do not publish private uploads globally or
   mark unevaluated candidates active.
6. Configure real provider profiles and credentials in the Secret Store, name
   the pilot companies/presences and declare a budget. Execute the full pilot,
   retain actual receipts/costs/cancellation/isolation proof, and assess all hard
   gates. Internal fixture receipts never count as live evidence.
7. Run CI and independent review before merge. The local GitHub API credential
   was rejected, so GitHub duplicate search, PR creation and CI/Greptile status
   are not certified by this document.

## Verification record

Latest recursive typecheck, complete build and UI token gates pass. Two classic
browser flows and the authenticated company-boundary/rollback flow pass. The full
Hermes package passes 89 tests, and Pi passes 74 separately because the stable
wrapper omits those projects. Focused provider/cancellation, immutable metadata,
evaluation replacement, project health/budget and rollback regressions pass.

The two monolithic stable runs failed and are retained as failed evidence. The
second general-server phase reported 14,198 passing and 11 failing tests; its
failure prevented the later workspace and serialized phases from starting.
Fresh focused verification of the affected files passes 209 tests, and the
GitHub reorder case passes separately. Fixes retain all privacy, immutable-record
and dependency-provisioning assertions: Skill/feedback assertions use stable
record identity, and worktree fixtures use an owned writable worktree directory.
Five new PostgreSQL regressions cover terminal Skill observations, local run
ownership, unknown outcomes, no premature completion and concurrent idempotence.

A complete run through the repository's supported shards is in progress. An
independent file-set check found two colocated suites that were omitted from the
old shard partition. The stable wrapper now discovers serialized suites across
the same source tree as general suites; its 24 Node control tests pass. The new
partition covers all 910 server test files without overlap, including the chat
and native-runner suites, plus all workspace groups from the normal stable
wrapper. Chat shards verify exact case identity coverage using Vitest collection.

The completed result, source hash and final commit will be recorded before
handoff. No GitHub CI or external provider evidence is inferred from local tests.

## Recovery

Before implementation, the full V4 workspace and Git bundle were checksummed and
restore-tested. A full V5 workspace archive at `20261004T022539Z` was then restored
and checked file by file, including Git objects and a cold PostgreSQL startup
with migration/table verification. Later source/Git checkpoints retain subsequent
changes. A new full archive and bundle are required after final verification.

Archives include Git history, complete files, migrations, private runtime
configuration and cold database state. They are private workspace files outside
the repository; they have not been uploaded to a real Paperclip issue because
this session has no task/run identity or API credentials. Recovery instructions,
checksums and restore reports remain alongside the archives.
