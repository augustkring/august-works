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
  budget observations. Missing observations remain unknown. A 72-hour default
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
4. Complete usage outcomes on every fast/exceptional heartbeat termination path.
   Unknown or absent outcomes cannot serve as promotion evidence.
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

Latest recursive typecheck, complete build and UI token gates pass. The complete
`pnpm test:run` is still running at this documentation checkpoint. Focused
regressions pass for provider termination and rollback (16), metadata/evaluation
replacement (22), gateway/Agent Card integration (20), health/planning/budgets
(24), the full Hermes package (89) and full Pi package (74). The two classic
browser flows and authenticated boundary flow passed before the final health UI
addition; the classic flow is being repeated with health disclosure assertions.

The first broad run found fixture/configuration regressions. Their fixes retain
the original behavioral assertions. Its failure count is not presented as a
clean test result. The final result and exact commit will be recorded before
handoff. No CI or external provider evidence is inferred from local tests.

## Recovery

Before implementation, the full V4 workspace and Git bundle were checksummed and
restore-tested. A full V5 workspace archive at `20261004T022539Z` was then restored
and checked file by file, including Git objects and a cold PostgreSQL startup
with migration/table verification. Later source/Git checkpoints retain subsequent
changes. A new full archive and bundle are required after final verification.

Archives include Git history, complete files, migrations, private runtime
configuration and cold database state. They are private workspace files outside
the repository; they have not been uploaded to a real Paperclip issue because
this session has no task/run identity or API credentials. Recovery instructions,+checksums and restore reports remain alongside the archives.
