# August Works V7 architecture decisions

Date: 2026-10-05. Baseline: `137e6ab386d6e579e9057d2c44b583a7167dc29f`.

Status: proposed implementation contracts. Wave 0 implements only configuration admission. Later-wave behavior and third-party adoption require their own validation evidence; these records do not assert that those features exist.

The V7 brief and attached playbooks are requirements/reference inputs. User instructions and repository authority govern execution. See the [migration map](../plans/2026-10-05-aw-v7-migration-map.md) and [Wave 0 evidence](../operations/aw-v7-wave0.md).

## ADR-V7-01 — Readiness is action-specific

**Status:** Proposed  
**Date:** 2026-10-05

### Context

Existing Foundation, Context and permissions express different prerequisites.

### Decision

Use versioned requirements and assessments for a subject, action, risk and exact policy version. Unknown mandatory evidence blocks; quality never grants permission.

### Alternatives considered

One company score; permission-as-readiness.

### Quality attributes affected

Explainability, correctness, usability.

### Trade-offs and risks

Assessment costs and expiry must be bounded.

### Assumptions

Foundation and Context remain canonical.

### Reversal cost

Medium: callers and evidence references.

### Evidence

foundation.ts, context_manifests.ts; brief §§133–135.

### Review triggers

Wave 1; stale assessments, scope leakage or missing hard-gate evidence.

## ADR-V7-02 — Cognitive projections do not own truth

**Status:** Proposed  
**Date:** 2026-10-05

### Context

V4 Memory already owns acceptance, visibility and deletion.

### Decision

Keep accepted Memory authoritative. Observations and Mental Models are derived, purpose-scoped projections with lineage and invalidation; Context reauthorizes retrieval.

### Alternatives considered

Provider-owned canonical memory; broad transcript retention.

### Quality attributes affected

Privacy, isolation, recoverability.

### Trade-offs and risks

Deletion/rebuild and degraded-mode behavior require integration proof.

### Assumptions

Existing memory tombstones and sharing policy remain effective.

### Reversal cost

Medium: rebuildable projections; high if canonical authority is moved.

### Evidence

memory.ts, memory_jobs.ts, cross_company_context.ts; brief §§137–141.

### Review triggers

Waves 3–5; correction, erasure, sharing or provider drift.

## ADR-V7-03 — Hindsight remains a replaceable qualified provider

**Status:** Proposed  
**Date:** 2026-10-05

### Context

The brief requests a provider spike, not unconditional production adoption.

### Decision

Define the cognitive provider seam before adoption. Hindsight is a candidate for governed-only derived data; qualify version, region, deletion, isolation, cost and outage fallback before enabling.

### Alternatives considered

Direct SDK coupling; replacing Memory; immediate production adoption.

### Quality attributes affected

Portability, privacy, operability.

### Trade-offs and risks

An adapter and qualification add work; no provider calls ship in Wave 0.

### Assumptions

Hindsight v0.10.2 is an observed candidate, not an approved deployment.

### Reversal cost

Low before adoption; medium for derived-store migration.

### Evidence

upstream-revalidation-2026-10-05.json; brief Wave 4.

### Review triggers

Provider/license/capability change; Wave 4 qualification failures.

## ADR-V7-04 — Learning produces evaluated domain proposals

**Status:** Proposed  
**Date:** 2026-10-05

### Context

V5 Skills and Playbooks already own immutable versions and promotion.

### Decision

Learning cycles record hypotheses, predictions and held-out evaluations, then submit proposals through existing domain review. No reflection or score promotes itself.

### Alternatives considered

Self-editing production Skills; uncontrolled cross-customer learning.

### Quality attributes affected

Quality, auditability, reproducibility.

### Trade-offs and risks

Holdouts, budgets and outcome measures must be designed per domain.

### Assumptions

V5 proposal and promotion paths are reused.

### Reversal cost

Medium: proposal history persists even after disabling learning.

### Evidence

skill_lifecycle.ts, playbooks.ts; brief §§142–144.

### Review triggers

Wave 6; evaluator contamination or unsupported outcome claims.

## ADR-V7-05 — Adaptive orchestration extends Tasks and Workflows

**Status:** Proposed  
**Date:** 2026-10-05

### Context

Durable Tasks, Workflows, attempts and runtime bindings already exist.

### Decision

Plans reference canonical Tasks and Workflows. Each consequential descendant reauthorizes; cumulative budgets are server state, leased and fenced, with exact-action approval hashes. Reuse completion_contracts.

### Alternatives considered

Parallel task platform; ambient parent authorization.

### Quality attributes affected

Reliability, bounded autonomy, consistency.

### Trade-offs and risks

Plan revisions and unknown external effects need reconciliation.

### Assumptions

Existing task status and current principal authority remain canonical.

### Reversal cost

High for durable state; avoid duplicate authorities now.

### Evidence

issues.ts, workflows.ts, completion_contracts.ts, execution_manifests.ts; brief Wave 7.

### Review triggers

Plan/approval drift, budget overspend, restart or stale worker.

## ADR-V7-06 — Deterministic arbitration owns interventions

**Status:** Proposed  
**Date:** 2026-10-05

### Context

Semantic signals and existing runtime supervision have different authority.

### Decision

A durable single arbiter uses CAS/fencing for each worker state. Semantic evaluators propose signals; deterministic policy owns pause, stop, retry, escalation and permission attenuation.

### Alternatives considered

Model-authorized interventions; parallel timers and status stores.

### Quality attributes affected

Security, concurrency, restart safety.

### Trade-offs and risks

Progress signals can be uncertain; interventions require retained evidence.

### Assumptions

V5 Runtime Fabric and canonical work state are extended.

### Reversal cost

High for orchestration history; low for signal adapters.

### Evidence

agent_provider_bindings.ts, heartbeat_runs.ts, issue_watchdogs.ts; brief Waves 8–9.

### Review triggers

Duplicate intervention, failed stop, stale lease or semantic drift.

## ADR-V7-07 — Verification matches the independence claim

**Status:** Proposed  
**Date:** 2026-10-05

### Context

A worker declaring success cannot prove every postcondition.

### Decision

Verification records postconditions, evidence version and independence class. Match rigor to risk, use systems of record where possible, and never let a verifier expand worker permissions.

### Alternatives considered

Self-attestation as universal verification; one universal model ranking.

### Quality attributes affected

Assurance, correctness, cost.

### Trade-offs and risks

Independent evidence can be expensive or unavailable; uncertainty remains explicit.

### Assumptions

Existing completion/finalization history is preserved.

### Reversal cost

Medium: verification evidence is append-only.

### Evidence

completion_contracts.ts, native_run_finalizations.ts, work_assessments.ts; brief §147.

### Review triggers

Changed postcondition, correlated evidence or unverifiable external effect.

## ADR-V7-08 — Work Signals remain candidates until authorized application

**Status:** Proposed  
**Date:** 2026-10-05

### Context

Connector source events are untrusted content, not commitments.

### Decision

Resolve source identity through connectors; authorize source reads and application separately. Candidates use stable event identity and existing task, approval and Routine actions. No employee profiling.

### Alternatives considered

Direct task creation from message text; a second follow-up scheduler.

### Quality attributes affected

Security, privacy, usability.

### Trade-offs and risks

Useful inference must tolerate ambiguity and minimal retention.

### Assumptions

The first adapter is the existing chat connector path; later sources revise admission prerequisites explicitly.

### Reversal cost

Low for candidates; medium for applied task history.

### Evidence

connection_event_deliveries.ts, chat_channels.ts, routines.ts; brief §§148,161.

### Review triggers

Source drift, mistaken commitments, duplicate application or purpose change.

## ADR-V7-09 — OpenShell restricts managed runtime authority

**Status:** Proposed  
**Date:** 2026-10-05

### Context

V6 cells own lifecycle; a sandbox provider owns a narrower enforcement boundary.

### Decision

Compile AW restrictions into sandbox policy, record desired/observed hashes and boundary evidence. Qualify filesystem, process, network, credentials and resources independently. OpenShell assurance failure stops affected work; no unsandboxed fallback.

### Alternatives considered

Provider-owned authority; treating a container as proof; silent fallback.

### Quality attributes affected

Isolation, security, operability.

### Trade-offs and risks

Version/platform-specific capability limits must be exposed.

### Assumptions

Initial OpenShell rollout requires V6 hosted_openclaw_v6; broader provider support needs an explicit graph revision.

### Reversal cost

Medium: adapter replacement; high for changed enforcement claims.

### Evidence

runtime_fleet.ts; OpenShell v0.1.2 policy; brief Waves 11–12.

### Review triggers

Kernel/provider/policy/image change, recreation requirements or failed boundary proof.

## ADR-V7-10 — AI governance is versioned purpose and evidence

**Status:** Proposed  
**Date:** 2026-10-05

### Context

Technical read access is separate from intended purpose and legal applicability.

### Decision

Version use cases, operator-role facts, data surfaces and assessments. Model output proposes findings; accountable review owns material legal applicability. Claims require current linked evidence, owners and revalidation triggers.

### Alternatives considered

A compliance checkbox; blanket provider/deployer labels.

### Quality attributes affected

Privacy, auditability, honest product claims.

### Trade-offs and risks

Legal sources and deployment facts change; uncertain claims cannot satisfy hard gates.

### Assumptions

Wave 0 source checks do not constitute a legal approval.

### Reversal cost

Medium: versioned records and export compatibility.

### Evidence

brief §§132.1–132.8,151–152; Wave 0 evidence ledger.

### Review triggers

Purpose, value-chain, law, data surface or evidence drift.

## ADR-V7-11 — Free Core uses V6 billing authority

**Status:** Proposed  
**Date:** 2026-10-05

### Context

V6 currently denies product access without local paid entitlements.

### Decision

Create an explicit permanent Free baseline in V6 entitlement resolution and admission, preserving bounded capacity, privacy and governance. Paid suspension and downgrade never imply knowledge deletion. No commercial behavior changes in Wave 0.

### Alternatives considered

A time-limited trial; UI-only bypass; separate billing state.

### Quality attributes affected

Consistency, economics, privacy.

### Trade-offs and risks

Capacity limits and migration need cost evidence and downgrade tests.

### Assumptions

Local V6 billing state remains canonical; Paddle is reconciled input.

### Reversal cost

High after commercial cutover; low for the current reserved flag.

### Evidence

saas_billing.ts, saas-commercial-guard.ts; brief Wave 14.

### Review triggers

Pricing/cost change, entitlement drift or downgrade loss.

## ADR-V7-12 — Agent Packages compose immutable existing assets

**Status:** Proposed  
**Date:** 2026-10-05

### Context

V5 already owns Role Packs, Skills and Playbooks; V6 owns catalog/billing.

### Decision

Packages reference exact component versions and immutable digests, release manifests and eval evidence. Install and activate are distinct; company-local readiness, consent and permissions remain mandatory.

### Alternatives considered

Mutable bundles; signatures that grant access; a parallel Skill registry.

### Quality attributes affected

Supply chain, portability, security.

### Trade-offs and risks

Revocation and updates need review against installation versions.

### Assumptions

Existing version/promotion and billing APIs are reused.

### Reversal cost

Medium: installation and release history must remain readable.

### Evidence

role_packs.ts, company_skills.ts, skill_lifecycle.ts, playbooks.ts; brief §§153,164.

### Review triggers

Component vulnerability, changed consent, eval drift or revoked release.

## ADR-V7-13 — Core Stewards are bounded domain jobs

**Status:** Proposed  
**Date:** 2026-10-05

### Context

The platform has durable jobs and Routines, not permission to create privileged persistent agents.

### Decision

Stewards reconcile event-driven domain findings through existing jobs/proposals. Enable only after readiness, learning and governance evidence are present; domain-specific predecessors stay mandatory.

### Alternatives considered

Privileged always-on agents; self-authorizing repairs.

### Quality attributes affected

Cost, auditability, reliability.

### Trade-offs and risks

Each steward needs a budget, deduplication and accountable ownership.

### Assumptions

The initial aggregate flag is deliberately conservative; split flags when domain contracts require it.

### Reversal cost

Low for scheduling; medium for proposal history.

### Evidence

memory_jobs.ts, routines.ts; brief Wave 17.

### Review triggers

Missing domain controls, runaway cadence or material scope expansion.

## ADR-V7-14 — Enterprise identity preserves membership authority

**Status:** Proposed  
**Date:** 2026-10-05

### Context

V5 identity and company-local presence do not confer tenant membership.

### Decision

Implement contracted enterprise identity through verified issuer/domain linkage and existing memberships; require versioned governance evidence and revocation tests. Identity assurance never replaces resource authorization.

### Alternatives considered

Email-domain auto-access; a parallel identity/permission system.

### Quality attributes affected

Isolation, revocation, operability.

### Trade-offs and risks

Issuer/domain lifecycle and deprovisioning require integration evidence.

### Assumptions

Initial managed enterprise rollout uses the V6 SaaS deployment profile.

### Reversal cost

High after customer linkage; no identity change in Wave 0.

### Evidence

auth.ts, company_memberships.ts, agent_identities.ts; brief Wave 18.

### Review triggers

Issuer, domain, contract, membership or deprovisioning drift.
