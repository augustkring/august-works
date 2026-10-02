# August Works V4 build qualification

Date: 2026-10-02. Baseline: `056f04072003c67672a9470837f909633c710705`.
Branch: `feat/aw-v4-completion`.

## Current decision

Final repository qualification is in progress. This document does not declare
full Golden Master acceptance or authorize a customer deployment. A passing
build is one input to the existing customer-pilot readiness process.

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
- Full repository suite: pending.

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

The GitHub Actions API was unavailable during the audit. Remote CI and review
status require separate verification. Build identity and final test counts will
be added after qualification.
