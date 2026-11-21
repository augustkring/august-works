---
name: pb-verification-reliability
description: >
  Routes testing, reliability and delivery work to the right chapters of
  playbooks 05 (Verification/Testing), 08 (Reliability/SRE) and 10
  (DevOps/CI-CD/Supply chain) without loading them whole. Use when planning
  tests, triaging flaky or failing CI, choosing a verification method, writing
  release or readiness checks, handling timeouts/retries/recovery, or changing
  CI workflows, dependencies, builds or deployment.
---

# Verification, reliability and delivery playbook router

Each playbook is 33k-40k tokens. Never read one whole.

## How to read

1. Open the index under `doc/reference/aw-v9/playbooks/index/` (files start with `05_`, `08_` or `10_`).
2. Read only the line range of the chapter named below.
3. Repo rules come first: `AGENTS.md` section 7 (smallest relevant check first, full check
   before hand-off). The draft PR template lists the CI gates.

## Which chapters, by change type

| Change | Chapters |
|---|---|
| Deciding what to test | 05: 10 Test strategy, 11 Method selection, 12 Portfolio |
| Unit, integration, e2e tests | 05: 16 Unit/component, 17 Integration/contract, 18 System/e2e/acceptance |
| Flaky or concurrency-sensitive tests | 05: 27 Concurrency and distributed testing, 39 Harness assurance |
| Migrations and schema compatibility | 05: 35 Compatibility, schema and migration testing |
| Accessibility checks | 05: 34 Accessibility conformance and usability validation |
| Security or privacy test design | 05: 32 Security verification, 33 Privacy and test data |
| CI gates | 05: 41 CI/CD quality gates. 10: 12 CI architecture, 19 Runners and secrets |
| Timeouts, retries, overload | 08: 12 Deadlines/timeouts/retries, 13 Overload and backpressure |
| Crash recovery, backups, DR | 08: 15 Recovery, backups and DR. 05: 31 Backup/restore/failover verification |
| Monitoring and alerting | 08: 17 Observability architecture, 18 Monitoring and alerting (path rules: `AGENTS.md` rule 7) |
| Production or beta readiness | 08: 19 Production readiness, 36 Definition of Done. 10: 38 Definition of Done |
| Incidents | 08: 20 Incident engineering, 29 Canonical runbooks |
| Dependencies and supply chain | 10: 10 Dependency engineering, 16 SBOM/VEX, 17 Signing |
| Release, deploy, rollback | 10: 14 Release evidence bundle, 21 Delivery, 22 Progressive delivery, 23 Recovery, 24 Migration-safe delivery |

## Rules for this repo

- Never skip, disable or quarantine a test to get CI green.
- Record a failing run as failing. Do not rewrite a failure as a pass in a summary.
- New verification results go in a short dated summary. Do not create a new evidence folder.
