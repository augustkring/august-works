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
  Hermes and OpenClaw use real gateway dispatch/cancellation hooks. A2A 0.3.0
  JSON-RPC uses guarded RPC/SSE, retained task/context IDs and owned task receipts.
  Native qualification uses the existing local Codex, OpenCode and ACPX session
  backends with synthetic hidden harness tasks and no platform tools. Native
  profile names alone cannot establish physical isolation. Native contract drift
  invalidates old proof. All conformance runs require actual cost evidence,
  including the last cancellation probe. Contract v5.2 requires fresh proof.
- Expiring execution scopes and immutable execution manifests. Every use checks
  current local presence and represented-human authority. Scoped task reads,
  forecasts, plan proposals and Playbook proposals retain source provenance.
  Connected tool discovery/invocation uses the existing gateway with a local
  target presence and represented human. It creates no guest run or bearer
  credential. Guest tool replies require explicit confidential-sharing policy,
  keep their classification, and recheck authority before dispatch/disclosure.
  Writes require act scope and an idempotency key. Pending/failed calls cannot
  be replayed as success; validated settled replies are retained for exact replay.
  Task-bound or approval-gated tools retain their existing prerequisites.
- Target-accepted relationships, local organizational units and versioned Role
  Pack overlays. These records do not grant access. Deterministic resolution
  filters current policy and pins behavior versions within explicit budgets.
- Private Skill candidates, immutable versions, overlap reviews, paired evidence,
  guarded promotion, dependency invalidation and retained usage observations.
  Executor teardown records loaded observations for committed terminal runs,
  including failure, interruption, cancellation and timeout, with unknown outcomes
  and idempotent per-version events. A running/recovering run is never completed.
  Startup and periodic orphan reaping reconcile observations left behind by
  executor loss or durable native finalization. The atomic insert observes only
  settled legacy or committed native runs. It preserves unknown outcomes.
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
- All 83 mounted V5 API operations are included in OpenAPI. Request bodies reuse
  the same strict shared validators as the routes, including explicit bounded
  conformance consent, proposal review and candidate-only creation. The mounted
  route inventory remains an exact coverage check.
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

## Activation and external requirements

The code is prepared behind flags. Full V5 acceptance and production activation
still require actual participating companies and provider proof. On 2026-10-04
the user confirmed that companies, presences, provider profiles and a pilot budget
are not available. No paid pilot is run or treated as a merge prerequisite for
this dormant implementation.

1. Select actual companies and local presences. Curate/import the private supplied
   Role Pack Skill/Playbook sources there, then evaluate and promote under local
   policy. Unresolved required references stay blocked. Private uploads are not
   published globally and imported candidates do not become active automatically.
2. Configure providers and credentials in the Secret Store and declare a budget.
   Exercise all hard gates with real traces, costs, stop and isolation receipts.
   Internal protocol fixtures never count as live proof. Unknown monetary cost
   on any probe prevents qualification and cannot be replaced by acknowledgement.
3. The local native conformance bridge covers Codex, OpenCode and ACPX. Codex
   requires a canonical, process-owned, private CODEX_HOME; peer profiles must
   actually differ. Managed Claude, AWS AgentCore and remote native conformance
   need their own included transport before a V5 binding can qualify. Existing
   V4 execution support is separate. Unsupported V5 bindings stay unqualified.
4. A2A execution covers protocol 0.3.0 JSON-RPC only. Its profile reference is the
   actual configured interface URL, not an arbitrary label. Other versions and
   transports remain discovery-only. Streaming, context continuity and separate
   profiles must be proved; Agent Cards grant no August Works authority.
5. Run GitHub CI and independent review before merge. GitHub API access was
   verified on 2026-10-04 after the earlier CONNECT block. [PR #32](https://github.com/augustkring/august-works/pull/32) is open. Complete
   CI test coverage is observed separately from aggregate policy gates and review;
   Git transport access is not their evidence. Merge must retain all 20 flags off
   until activation evidence is reviewed.

## Verification record — earlier checkpoint

The following counts and source hash belong to the earlier retained checkpoint.
The finishing changes have a separate final verification record below.


The complete supported stable-suite cover is green across frozen runs, complete
retries of failed jobs, and completion of the last workspace group. It contains
27,922 passing tests and 58 actual skips. The failed original
commands remain failed evidence; this is not one clean monolithic execution.

- All 910 server source test files are assigned without overlap: 755 general
  files, 154 serialized files and the chat suite. A separate vendor-script suite
  adds the server project's remaining `.test.mjs` file and passes five tests.
- All 1,042 chat cases have verified exact identity coverage across four shards.
  The 3,126 selection skips are filters for other shards, not uncovered cases or
  actual suite skips. The modified same-second reorder case also passes fresh.
- All 649 UI files pass 6,778 tests. All 63 CLI files pass 502 tests, including the
  real server-start/import-export flow and onboarding with an owned fixture home.
- All 14 workspace projects from the stable wrapper have completed passing
  coverage. Passing prefix projects are retained, then all remaining projects
  run after their corrections. Adapter-utils passes 1,291 tests with five actual
  skips; OpenCode fixtures use an owned home. Daytona preserves inbound archive
  modes under umasks 022 and 077 and retains the sandbox owner; its full package
  passes 284 tests with six actual skips. Prior failed commands remain recorded.
- The wrapper previously omitted two colocated route/authz files. Serialized
  discovery now uses the same source tree as general discovery, and all 24 Node
  wrapper-control tests pass. No supported server source suite is dropped.

The final non-Markdown source was frozen at code commit
`bcaaf346e1785ecd8aac9edafb55dbc135b00846` with SHA-256
`8aea6f77516cebe84db2c25738055895ca057a1e84e1d465e70cd2ea48f0462f`. Records, commands, raw summaries and source changes
between checkpoints are in the private `complete-verification-effective-report-before-finishing.json`
and its referenced reports. Later repository documentation updates do not change
that source hash. The original full runs and retry failure logs are retained.

Recursive typecheck passes on the canonical API changes, and the last changed
adapter fixture passes its package typecheck. Daytona is excluded from the root
workspace and is typechecked and built separately against its declared SDK; its
284-test package suite passes again after that build. Complete build and UI token gates
passed at earlier checkpoints; the final handoff repeats the complete build at
its recorded Git HEAD. Its log and build stamp are retained with the backup.
Two classic browser flows and an authenticated company-boundary/rollback flow
pass. Browser fixtures use real PostgreSQL, session cookies and Origin/CSRF
checks. They do not call paid providers.

Hermes passes 89 tests and Pi passes 74 separately because the stable wrapper
omits those projects. The other four omitted, unchanged adapter projects are not
claimed as newly verified. Focused provider/cancellation, immutable metadata,
evaluation replacement, project health/budget and rollback regressions pass.
Five PostgreSQL regressions cover terminal Skill observations, local run
ownership, unknown outcomes, no premature completion and concurrent idempotence.
The OpenAPI inventory and strict V5 consent/draft/review contracts pass 13 tests.
No GitHub CI, independent review or live provider evidence is inferred.

## Recovery

Before implementation, the full V4 workspace and Git bundle were checksummed and
restore-tested. A full V5 workspace archive at `20261004T022539Z` was then restored
and checked file by file, including Git objects and a cold PostgreSQL startup
with migration/table verification. Later source/Git checkpoints retain subsequent
changes. The final cold archive, Git bundle, checksum sidecars and verification
reports are tracked outside Git in `v5-recovery/backups/CURRENT.json`. Read its
actual verification status before relying on a snapshot.

Archives include Git history, complete files, migrations, private runtime
configuration and cold database state. They are private workspace files outside
the repository; they have not been uploaded to a real Paperclip issue because
this session has no task/run identity or API credentials. Recovery instructions,
checksums and restore reports remain alongside the archives.

## Finishing verification

The finishing runtime source was frozen with SHA-256
`70fa89175d3cac3da92aa534fe53c9ce94bea5761e540dc4d1138690201c7d17`
and committed as `8b7cdfc2d39c7326c0a3312820175abc8931fccc`.
[The PR CI run](https://github.com/augustkring/august-works/actions/runs/37196833256)
passes all stable-suite test jobs: 12 general server shards, three chat shards,
nine serialized shards, both UI/CLI shards, the remaining workspace group and
both Runner Vitest lanes. The final Runner lane retains the native integration
suite excluded from the general PR shards. Source selection was independently
verified as a complete, non-overlapping partition of all 912 server source test
files and all 14 stable-wrapper workspace projects. Fresh test totals and actual
skip counts are not inferred without raw CI logs.

The additional server vendor-script suite passes five tests. The changed Hermes
package passes 90 tests separately. Recursive typecheck, complete build, token
gates and module boundaries pass locally. `pnpm db:generate` reports no schema
change; the new accounting field refines existing JSON typing and needs no new
DDL. The extra local monolithic `pnpm test:run` invocation was deliberately
interrupted with exit 130 after complete identical-source CI coverage passed.
Its log and unchanged-source report remain retained as interrupted evidence.

The next two non-Markdown changes were CI inputs:
`scripts/e2e-shard.mjs` now matches the existing authenticated-suite exclusion,
and the fork verification workflow runs V4, classic V5 and authenticated V5
browser journeys in separate job instances. This prevents a completed fixture's
PostgreSQL Unix lock from blocking the next fixture. All 11 partition checks
pass. Both classic V5 browser tests and the dedicated authenticated test pass
with real PostgreSQL and Chromium. The initial authenticated startup failure is
retained separately. The workflow YAML parses and preserves the aggregate
readiness requirement and separate failure artifacts.

[The subsequent CI run](https://github.com/augustkring/august-works/actions/runs/37199321321)
at `91179a4d5821bc6d96a798790c3f8534423009f6` also passes all 29 stable test
jobs. One general server shard passed after a single retry. Its original failure
is retained: an existing queue-concurrency fixture exceeded its three-second
polling deadline. The final test-only change gives the fixture its own temporary
application home and waits up to 15 seconds for the exact expected dispatch count
while the first execution stays blocked. All 48 tests in the changed file and the
server package typecheck pass locally. No production runtime source changed.
The latest commit still requires its own GitHub checks.

The final source hash is
`c1388b461d6756fda7dad7a2e5cd3a1df3d4f10afb21f4af59c9b420c22ed0f8`.
Reports distinguish complete CI coverage, the final test-only change and
local interrupted execution. The actual local instance starts correctly, has no
companies, and retains all 20 V5 flags off in persisted settings. No paid provider
calls were made. GitHub's Dependency Review reports disabled Dependency Graph;
aggregate CI and independent review remain unfulfilled merge gates until the
new head is checked and repository review configuration is corrected. CodeRabbit
skipped review because the PR exceeds its 100-file limit and available review
capacity; its successful status does not constitute a completed review. Final
cold backup and restoration status is recorded separately in the private
`v5-recovery/backups/CURRENT.json` and its referenced verification report.
