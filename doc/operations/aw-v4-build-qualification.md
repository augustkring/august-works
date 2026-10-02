# August Works V4 build qualification

Date: 2026-10-02. Baseline: `056f04072003c67672a9470837f909633c710705`.
Branch: `feat/aw-v4-completion`.

## Current decision

The implemented paths have completed local repository qualification. The final
implementation commit builds successfully. This is a local build candidate,
with the explicit implementation limits below. Full Golden Master acceptance
remains open. A customer rollout still requires the target-environment evidence
in the existing pilot readiness process.

## Delivered product paths

| Area | Delivered behavior | Acceptance evidence |
| --- | --- | --- |
| Workflows | Pinned connector and artifact execution; switch/default; fork/merge; bounded HTTPS read and map; Foundation/Memory reads; durable subworkflows | Executor, gateway, map, HTTP, artifact and registry suites |
| Recovery | Original execution authority; durable tool review; explicit failure branch, nullable continuation and human recovery; deadlines and child cancellation | PostgreSQL recovery/failure tests and browser policy authoring |
| Native agents | Immutable schema-checked Task results and bounded Direct Agent Call without a Task | Direct-call and executor integration suites |
| Existing automation | Routine and Pipeline delegate authority, with enqueue-time Pipeline binding and revocation checks | Routine, Pipeline and delegation suites |
| Artifacts | Catalogue create/review, immutable versions, testing, activation and revocation | Qualified Linux sandbox tests and keyboard browser flow |
| Optimizer | Reviewed runs, scalar-transform proposal, real compiler/replay/shadow, bound approval, bounded canary, activation, fallback and drift | Four PostgreSQL lifecycle/drift scenarios and browser proposal/shadow/retirement |
| Memory privacy | Export, permanent deletion, source/derived erasure, restore ledger, retention, child late-write guards and local/S3 log tombstones | Memory/privacy/direct-call/run-log suites and browser export/delete |
| Memory jobs | Native dedupe, compaction, index refresh and operator-proposed reflection, with durable retry and review | Maintenance and job suites; browser actual index-refresh worker |
| UI | Company routes, semantic capability/agent/subworkflow selectors, explicit result/failure contracts and merged request headers | Component/client/routing tests and three Chromium flows |
| API contracts | All 32 new governance operations documented with shared validation schemas, correct status codes, board/run authority and required maintenance idempotency header | Exact route coverage and 12 OpenAPI contract checks |

Existing Foundation, Context Engine, Connected Knowledge, OpenClaw bindings,
draft-only AI authoring and native-work primitives remain part of the baseline.
The final repository suite covers their regression checks. The earlier audit
is historical context; its missing-node and integration findings must not be
read as the current implementation state.

## Explicit implementation limits

The live optimizer replacement path covers a single pure C0 transform. Larger
subgraphs, semantic agent/tool replacements and higher-risk replacements need
an explicit reviewed contract and their own runtime qualification. The lower
level compiler helpers do not establish those live paths. The product displays
this restriction. Full optimizer breadth in the Golden Master remains open.

Map uses a bounded pure collection operation with concurrency one. Workflow
forks also execute with explicit concurrency one. Reflection creates a pending
operator-proposed lesson from reviewed sources; it does not implement universal
autonomous reflection. Advanced A2A and graph-memory work is later Wave 15.

Deletion covers application-owned content and logs. It does not establish
deletion from arbitrary agent workspace files or external provider storage.
Local browser tests exercise keyboard authoring and key journeys; they are not
a screen-reader user study or complete device/accessibility certification.

## Qualification commands

Run on the same source tree:

```bash
pnpm -r typecheck
pnpm test:run
pnpm build
pnpm check:tokens
pnpm check:token-gates
pnpm --filter @paperclipai/db check:migrations
pnpm check:aw-v4-security-evals
pnpm test:aw-v4-security-evals
pnpm check:aw-v4-pilot-readiness
pnpm test:aw-v4-pilot-readiness
```

For the changed product journeys:

```bash
PAPERCLIP_PLAYWRIGHT_EXECUTABLE=/usr/bin/chromium pnpm exec playwright test \
  --config tests/e2e/playwright.config.ts tests/e2e/aw-v4-completion.spec.ts
```

The cloud image needs a complete Node 24 installation, including its headers,
for the existing Linux SO_PEERCRED native build. Artifact qualification needs
working bubblewrap namespaces and process limits. Git/process integration tests
need an execution context which allows real child processes and worktrees.
Restricted sandbox failures are not silently skipped or treated as passing.
The root lockfile stays CI-owned; the existing lock refresh workflow resolves
the new pinned compiler API alias. Local onboarding uses an ignored lockfile
directory and preserves dependency patches.

Existing graphs with `continueOnFailure: true` need an explicit reviewed failure
policy before publishing again. An old revision without a policy stops on
failure. See the migration runbook; nullable continuation is never inferred.

## Results

- Fresh whole-repository typecheck: passed.
- Fresh whole-repository build: passed after installing complete Node 24.19.0.
- Migration numbering and safety: passed.
- All four UI token gates and forbidden-token check: passed.
- Security coverage and pilot static contract: passed.
- Three changed-product Chromium scenarios: passed.
- Memory maintenance/jobs: 15 tests passed.
- Direct Agent Call: six PostgreSQL scenarios passed, including revoked
  initiating authority before prompt hydration or result submission.
- Optimizer lifecycle/drift: four PostgreSQL scenarios passed.
- Explicit failure policies: four PostgreSQL scenarios passed.
- Delegation authority: three PostgreSQL scenarios passed.
- Local/S3 log store: 19 tests passed.
- Deterministic security hard gates: 27 suites, 805 tests passed. The manifest
  includes the new delegated-erasure, prompt-revocation, log-tombstone,
  human-recovery and optimizer-drift suites.
- Pilot-validator tests: 13 passed; event-extractor checks: seven passed.
- Full repository manifest: 1,888 files covered through the official partitions
  and focused correction reruns; 27,745 passed tests and 63 existing skips.
  This is an aggregate of partition runs and correction reruns, not a claim
  that one uninterrupted `pnpm test:run` invocation passed.

| Official partition | Files covered | Passed tests after correction reruns | Existing skipped tests |
| --- | ---: | ---: | ---: |
| General server (two local duration-balanced shards) | 744 | 14,052 | 51 |
| UI | 647 | 6,772 | 0 |
| CLI | 63 | 502 | 0 |
| Other workspace projects | 282 | 3,664 | 12 |
| Serialized server routes/recovery | 152 | 2,755 | 0 |
| Total | 1,888 | 27,745 | 63 |

The serialized manifest was checked for exact coverage. It has 149 initial
passing files plus the freshly passing heartbeat recovery (305 tests),
workflow routes (17 tests) and OpenAPI contracts (12 tests). The final complete
heartbeat recovery file passed with its scoped low-trust binding.

V4 CI now uses 11 independent partitions with `fail-fast: false`: four general
server shards, two UI/CLI shards, one other-workspace partition and four
serialized partitions. The matrices cover every official manifest entry exactly
once. Browser, static, security and pilot gates remain required. This improves
failure visibility and bounds job duration; it does not remove test coverage.

Correction reruns retained the assertions and production boundaries:

- Workflow executor: all 51 tests passed after allowing cold fixture workers
  45 seconds to start; the real SIGKILL and durable idempotency checks remain.
- Chat ordering: the failed rapid callback scenario passed after bounded
  database polling replaced its implicit one-second limit. The other 1,041
  chat scenarios passed in the partition run. The test still requires all eight
  ordered messages, wake requests and lease cleanup.
- Runtime exposure: all 31 tests passed in isolation after a fixed-port collision
  with another live fixture. The port ownership protection remains intact.
- CLI: all 78 tests in the three affected files passed. Atomic writes now apply
  the requested executable mode despite a restrictive umask. Mocked telemetry
  tests set their own opt-out environment. Logical backups retain CHECK constraints.
- Adapter utilities: all 119 process tests, 188 ACPX engine tests and 146
  execution-target tests passed after fixture startup budgets accounted for real
  child processes. Zombie state is treated as stopped while live kill checks
  remain. The actual installed Codex prerelease MCP check also passed.
- Codex CPU watchdog: both real-process tests passed. The busy fixture runs
  longer than its five-second inactivity threshold so `/proc` group sampling
  can observe CPU progress; the wedged-process deadline test is unchanged.
- Daytona file sync: all 23 tests passed under the fixture's standard `umask 022`.
  Its two original mode expectations failed under the cloud shell's `077`.
  Production permissions were not made less restrictive.
- Mocked Codex fixtures explicitly supply dummy credentials. The low-trust
  isolation fixture uses an encrypted mock secret and only its own allowed
  binding. Inline-sensitive-env and missing-binding rejection remain enforced.

Local logs are in `/workspace/.cloud-setup/v4-final-*.log`. The serialized
coverage map and remaining-file exit results are retained alongside them.
These local paths are not remote CI evidence.

The final authority check also passed 61 workflow/executor/direct-call/failure
tests after extracting the shared Task-assignment authorization helper. Memory
reflection was retested with an accepted source which has no summary; all 15
maintenance/job tests passed.

Intermediate failures were investigated rather than omitted. Mocked adapter
fixtures now declare their dummy credentials explicitly. Fake command fixtures
use the actual Node executable. The organization-audience race test observes a
real blocked database lock instead of assuming lock order from a fixed delay.
Native sandbox checks must run without excessive competing host process load;
the focused 17-test qualified sandbox suite passed.

## Evidence needed in the target environment

Use `aw-v4-customer-pilot-readiness.md` and its evidence schema. Record actual
Connections, AW/OpenClaw agent and model behavior checks; representative
migration/reconciliation and restore; accessibility acceptance; realistic
latency, capacity and cost; SLO/alerts; rollout ownership and exposure controls.
Keep flags default-off until those target checks pass. Do not create success
evidence from fixture results or claim online CI/reviews which were not read.

## Source and delivery identity

Qualified implementation commit: `2faf53e4b` on `feat/aw-v4-completion`, following
`d01a3cb877` (product implementation) and `34d1b156ce` (CI partitioning).
The full `pnpm build` passed and embeds
`2faf53e4b94329f5bf324198c38fa9f6e799f0f5` in `server/dist/build-info.json`.
Fresh full workspace typecheck also passed on this final source.
Later documentation commits do not change the qualified executable source.

The branch was pushed to `augustkring/august-works`. Both GraphQL draft-PR
creation and REST pull-request creation returned `Forbidden`; no PR was
created. The prepared PR description remains in the local cloud evidence
folder. Remote CI, root-lockfile refresh and review status were not verified.
The root lockfile remains owned by the repository's lock refresh workflow.

## Gates before full V4 acceptance

1. Implement and qualify the broader optimizer paths in master brief sections
   77–86: stable agent/tool work and larger spans compiled to deterministic
   implementations, with preserved side-effect authority, structured business
   invariants, replay/shadow/canary and actual agent fallback. Current live
   qualification supports only one pure C0 transform. Compiler helper tests
   are not evidence that these broader paths exist.
2. Record the target-environment acceptance evidence described above. Local
   mocked providers, temporary PostgreSQL instances and Chromium scenarios do
   not establish real account/model behavior, representative production restore,
   user accessibility acceptance or production capacity/SLOs.
3. Run remote CI and its governed lockfile refresh, then review the branch.
   Git push succeeded, but GitHub API permissions prevented PR creation here.

The candidate can be used for the next integration build with the V4 rollout
flags default-off. It must not be labelled fully accepted Golden Master V4
while these gates remain open.
