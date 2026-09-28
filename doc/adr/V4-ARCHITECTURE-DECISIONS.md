# August Works V4 Architecture Decisions

**Status:** Accepted baseline  
**Date:** 2026-09-28

This ledger implements the ADR set required by the V4 Implementation Golden Master. Each record is an architectural baseline, not a prohibition on lower-level implementation evolution.

## ADR-001 — Foundation uses existing documents/revisions as canonical content store

**Status:** Accepted

### Context
The V4 Golden Master requires an explicit durable boundary for this decision before dependent implementation proceeds.

### Decision
Foundation content remains in existing documents/document_revisions; Foundation tables add semantics, authority, review lifecycle, indexing metadata, and proposals.

### Alternatives considered
A second Foundation content store; free-form files as sole authority.

### Quality attributes affected
Correctness, provenance, migration safety, maintainability.

### Trade-offs and risks
The decision deliberately prefers one authority and reuse of existing August Works primitives over parallel infrastructure. Any additional complexity must be justified by measured need and must preserve tenant isolation, authorization-before-side-effect, auditability, reversibility, and migration safety.

### Assumptions
Current repository primitives remain reusable and V4 architecture invariants remain authoritative.

### Reversal cost
Medium. Replace only through an explicit additive migration or superseding ADR with compatibility and recovery evidence.

### Evidence
- August Works Unified Platform Master Build Brief V4 — Implementation Golden Master.
- Current repository primitives inspected at base commit `be43c23e2df9fc88392390569f5e3b1356cfe275`.
- Supplied engineering, requirements, architecture, SDLC, construction, backend, UI, and UX playbooks.

### Review triggers
Revisit if production evidence, security findings, upstream changes, licensing, scale, or user research invalidate the assumed boundary.

## ADR-002 — Context Engine normalized EvidenceItem contract

**Status:** Accepted

### Context
The V4 Golden Master requires an explicit durable boundary for this decision before dependent implementation proceeds.

### Decision
Retrieval providers normalize authorized source material into one evidence contract before ranking, budgeting, and model serialization; source systems remain authoritative.

### Alternatives considered
Provider-native prompt serialization; one giant vector index.

### Quality attributes affected
Security, explainability, interoperability, maintainability.

### Trade-offs and risks
The decision deliberately prefers one authority and reuse of existing August Works primitives over parallel infrastructure. Any additional complexity must be justified by measured need and must preserve tenant isolation, authorization-before-side-effect, auditability, reversibility, and migration safety.

### Assumptions
Current repository primitives remain reusable and V4 architecture invariants remain authoritative.

### Reversal cost
Medium. Replace only through an explicit additive migration or superseding ADR with compatibility and recovery evidence.

### Evidence
- August Works Unified Platform Master Build Brief V4 — Implementation Golden Master.
- Current repository primitives inspected at base commit `be43c23e2df9fc88392390569f5e3b1356cfe275`.
- Supplied engineering, requirements, architecture, SDLC, construction, backend, UI, and UX playbooks.

### Review triggers
Revisit if production evidence, security findings, upstream changes, licensing, scale, or user research invalidate the assumed boundary.

## ADR-003 — Hybrid live/synced Connected Knowledge model

**Status:** Accepted

### Context
The V4 Golden Master requires an explicit durable boundary for this decision before dependent implementation proceeds.

### Decision
Support live, synced, and hybrid evidence providers; preserve source ACLs, provenance, freshness, and source authority.

### Alternatives considered
Sync everything; live-read everything; make indexes authoritative.

### Quality attributes affected
Freshness, scale, authorization, latency, resilience.

### Trade-offs and risks
The decision deliberately prefers one authority and reuse of existing August Works primitives over parallel infrastructure. Any additional complexity must be justified by measured need and must preserve tenant isolation, authorization-before-side-effect, auditability, reversibility, and migration safety.

### Assumptions
Current repository primitives remain reusable and V4 architecture invariants remain authoritative.

### Reversal cost
Medium. Replace only through an explicit additive migration or superseding ADR with compatibility and recovery evidence.

### Evidence
- August Works Unified Platform Master Build Brief V4 — Implementation Golden Master.
- Current repository primitives inspected at base commit `be43c23e2df9fc88392390569f5e3b1356cfe275`.
- Supplied engineering, requirements, architecture, SDLC, construction, backend, UI, and UX playbooks.

### Review triggers
Revisit if production evidence, security findings, upstream changes, licensing, scale, or user research invalidate the assumed boundary.

## ADR-004 — Shared vs private Memory separation

**Status:** Accepted

### Context
The V4 Golden Master requires an explicit durable boundary for this decision before dependent implementation proceeds.

### Decision
Agent-private memory and Shared Organizational Memory are distinct; sharing is a governed evidence/review/promotion path.

### Alternatives considered
One shared memory pool; chat history as memory; automatic publication.

### Quality attributes affected
Privacy, security, correctness, organizational learning.

### Trade-offs and risks
The decision deliberately prefers one authority and reuse of existing August Works primitives over parallel infrastructure. Any additional complexity must be justified by measured need and must preserve tenant isolation, authorization-before-side-effect, auditability, reversibility, and migration safety.

### Assumptions
Current repository primitives remain reusable and V4 architecture invariants remain authoritative.

### Reversal cost
Medium. Replace only through an explicit additive migration or superseding ADR with compatibility and recovery evidence.

### Evidence
- August Works Unified Platform Master Build Brief V4 — Implementation Golden Master.
- Current repository primitives inspected at base commit `be43c23e2df9fc88392390569f5e3b1356cfe275`.
- Supplied engineering, requirements, architecture, SDLC, construction, backend, UI, and UX playbooks.

### Review triggers
Revisit if production evidence, security findings, upstream changes, licensing, scale, or user research invalidate the assumed boundary.

## ADR-005 — Workflow remains distinct from Routine and Pipeline

**Status:** Accepted

### Context
The V4 Golden Master requires an explicit durable boundary for this decision before dependent implementation proceeds.

### Decision
Routine owns recurrence, Pipeline owns persistent business state, Workflow owns multi-step execution, and Task owns accountable work.

### Alternatives considered
One universal workflow primitive; agent tasks as implicit workflows.

### Quality attributes affected
Domain clarity, UX comprehension, change locality, compatibility.

### Trade-offs and risks
The decision deliberately prefers one authority and reuse of existing August Works primitives over parallel infrastructure. Any additional complexity must be justified by measured need and must preserve tenant isolation, authorization-before-side-effect, auditability, reversibility, and migration safety.

### Assumptions
Current repository primitives remain reusable and V4 architecture invariants remain authoritative.

### Reversal cost
Medium. Replace only through an explicit additive migration or superseding ADR with compatibility and recovery evidence.

### Evidence
- August Works Unified Platform Master Build Brief V4 — Implementation Golden Master.
- Current repository primitives inspected at base commit `be43c23e2df9fc88392390569f5e3b1356cfe275`.
- Supplied engineering, requirements, architecture, SDLC, construction, backend, UI, and UX playbooks.

### Review triggers
Revisit if production evidence, security findings, upstream changes, licensing, scale, or user research invalidate the assumed boundary.

## ADR-006 — Published workflow revisions are immutable

**Status:** Accepted

### Context
The V4 Golden Master requires an explicit durable boundary for this decision before dependent implementation proceeds.

### Decision
Drafts may change; publication freezes a revision; runs permanently bind to the revision they start with.

### Alternatives considered
Mutable live workflows; graph snapshots only inside run rows.

### Quality attributes affected
Reproducibility, auditability, recovery, concurrency safety.

### Trade-offs and risks
The decision deliberately prefers one authority and reuse of existing August Works primitives over parallel infrastructure. Any additional complexity must be justified by measured need and must preserve tenant isolation, authorization-before-side-effect, auditability, reversibility, and migration safety.

### Assumptions
Current repository primitives remain reusable and V4 architecture invariants remain authoritative.

### Reversal cost
Medium. Replace only through an explicit additive migration or superseding ADR with compatibility and recovery evidence.

### Evidence
- August Works Unified Platform Master Build Brief V4 — Implementation Golden Master.
- Current repository primitives inspected at base commit `be43c23e2df9fc88392390569f5e3b1356cfe275`.
- Supplied engineering, requirements, architecture, SDLC, construction, backend, UI, and UX playbooks.

### Review triggers
Revisit if production evidence, security findings, upstream changes, licensing, scale, or user research invalidate the assumed boundary.

## ADR-007 — Workflow executor uses durable checkpoints and idempotent effects

**Status:** Accepted

### Context
The V4 Golden Master requires an explicit durable boundary for this decision before dependent implementation proceeds.

### Decision
Persist run/step/wait state, separate attempts, use atomic ownership/leases, and require idempotency or explicit retry guards for effects.

### Alternatives considered
In-memory execution; restart whole graph; provider retries as durability.

### Quality attributes affected
Reliability, integrity, recovery, operability.

### Trade-offs and risks
The decision deliberately prefers one authority and reuse of existing August Works primitives over parallel infrastructure. Any additional complexity must be justified by measured need and must preserve tenant isolation, authorization-before-side-effect, auditability, reversibility, and migration safety.

### Assumptions
Current repository primitives remain reusable and V4 architecture invariants remain authoritative.

### Reversal cost
Medium. Replace only through an explicit additive migration or superseding ADR with compatibility and recovery evidence.

### Evidence
- August Works Unified Platform Master Build Brief V4 — Implementation Golden Master.
- Current repository primitives inspected at base commit `be43c23e2df9fc88392390569f5e3b1356cfe275`.
- Supplied engineering, requirements, architecture, SDLC, construction, backend, UI, and UX playbooks.

### Review triggers
Revisit if production evidence, security findings, upstream changes, licensing, scale, or user research invalidate the assumed boundary.

## ADR-008 — Workflow reuses existing Connections and permissions

**Status:** Accepted

### Context
The V4 Golden Master requires an explicit durable boundary for this decision before dependent implementation proceeds.

### Decision
Resolve workflow capabilities through existing connection grants, secrets, approvals, risk metadata, and audit at execution time.

### Alternatives considered
Workflow-local credentials or permission model; embedded second control plane.

### Quality attributes affected
Security, least privilege, consistency, maintainability.

### Trade-offs and risks
The decision deliberately prefers one authority and reuse of existing August Works primitives over parallel infrastructure. Any additional complexity must be justified by measured need and must preserve tenant isolation, authorization-before-side-effect, auditability, reversibility, and migration safety.

### Assumptions
Current repository primitives remain reusable and V4 architecture invariants remain authoritative.

### Reversal cost
Medium. Replace only through an explicit additive migration or superseding ADR with compatibility and recovery evidence.

### Evidence
- August Works Unified Platform Master Build Brief V4 — Implementation Golden Master.
- Current repository primitives inspected at base commit `be43c23e2df9fc88392390569f5e3b1356cfe275`.
- Supplied engineering, requirements, architecture, SDLC, construction, backend, UI, and UX playbooks.

### Review triggers
Revisit if production evidence, security findings, upstream changes, licensing, scale, or user research invalidate the assumed boundary.

## ADR-009 — Use XYFlow and selectively adapt MIT Activepieces UI patterns

**Status:** Accepted

### Context
The V4 Golden Master requires an explicit durable boundary for this decision before dependent implementation proceeds.

### Decision
Use @xyflow/react for graph primitives and only provenance-verified MIT-core Activepieces patterns/components; keep August Works behavior and visual language.

### Alternatives considered
Build canvas from scratch; embed Activepieces/n8n/Windmill wholesale.

### Quality attributes affected
UX quality, accessibility, delivery speed, licensing, maintainability.

### Trade-offs and risks
The decision deliberately prefers one authority and reuse of existing August Works primitives over parallel infrastructure. Any additional complexity must be justified by measured need and must preserve tenant isolation, authorization-before-side-effect, auditability, reversibility, and migration safety.

### Assumptions
Current repository primitives remain reusable and V4 architecture invariants remain authoritative.

### Reversal cost
Medium. Replace only through an explicit additive migration or superseding ADR with compatibility and recovery evidence.

### Evidence
- August Works Unified Platform Master Build Brief V4 — Implementation Golden Master.
- Current repository primitives inspected at base commit `be43c23e2df9fc88392390569f5e3b1356cfe275`.
- Supplied engineering, requirements, architecture, SDLC, construction, backend, UI, and UX playbooks.

### Review triggers
Revisit if production evidence, security findings, upstream changes, licensing, scale, or user research invalidate the assumed boundary.

## ADR-010 — Automation Artifacts execute in a constrained sandbox

**Status:** Accepted

### Context
The V4 Golden Master requires an explicit durable boundary for this decision before dependent implementation proceeds.

### Decision
No ambient secrets or host filesystem; bounded resources; restricted network; allowlisted pinned dependencies; redacted logs; immutable versions; governed tool gateway.

### Alternatives considered
Run generated code in server process; raw credentials; arbitrary installs.

### Quality attributes affected
Security, isolation, reproducibility, operability.

### Trade-offs and risks
The decision deliberately prefers one authority and reuse of existing August Works primitives over parallel infrastructure. Any additional complexity must be justified by measured need and must preserve tenant isolation, authorization-before-side-effect, auditability, reversibility, and migration safety.

### Assumptions
Current repository primitives remain reusable and V4 architecture invariants remain authoritative.

### Reversal cost
Medium. Replace only through an explicit additive migration or superseding ADR with compatibility and recovery evidence.

### Evidence
- August Works Unified Platform Master Build Brief V4 — Implementation Golden Master.
- Current repository primitives inspected at base commit `be43c23e2df9fc88392390569f5e3b1356cfe275`.
- Supplied engineering, requirements, architecture, SDLC, construction, backend, UI, and UX playbooks.

### Review triggers
Revisit if production evidence, security findings, upstream changes, licensing, scale, or user research invalidate the assumed boundary.

## ADR-011 — Optimizer changes production only through governed promotion

**Status:** Accepted

### Context
The V4 Golden Master requires an explicit durable boundary for this decision before dependent implementation proceeds.

### Decision
Suggestion → generation → replay → shadow → risk gate → canary/promotion → drift/fallback/rollback; no silent self-modification.

### Alternatives considered
Automatic production rewrite; permanently agentic repeated work.

### Quality attributes affected
Correctness, safety, cost, latency, reversibility.

### Trade-offs and risks
The decision deliberately prefers one authority and reuse of existing August Works primitives over parallel infrastructure. Any additional complexity must be justified by measured need and must preserve tenant isolation, authorization-before-side-effect, auditability, reversibility, and migration safety.

### Assumptions
Current repository primitives remain reusable and V4 architecture invariants remain authoritative.

### Reversal cost
Medium. Replace only through an explicit additive migration or superseding ADR with compatibility and recovery evidence.

### Evidence
- August Works Unified Platform Master Build Brief V4 — Implementation Golden Master.
- Current repository primitives inspected at base commit `be43c23e2df9fc88392390569f5e3b1356cfe275`.
- Supplied engineering, requirements, architecture, SDLC, construction, backend, UI, and UX playbooks.

### Review triggers
Revisit if production evidence, security findings, upstream changes, licensing, scale, or user research invalidate the assumed boundary.

## ADR-012 — OpenClaw/external agents are explicit attenuated principals

**Status:** Accepted

### Context
The V4 Golden Master requires an explicit durable boundary for this decision before dependent implementation proceeds.

### Decision
Every invocation gets explicit identity, scoped context/capabilities, timeout, output contract, responsible user, cancellation semantics, and audit; no ambient inheritance.

### Alternatives considered
Treat external agent as native connector; inherit parent authority.

### Quality attributes affected
Security, interoperability, least privilege, auditability.

### Trade-offs and risks
The decision deliberately prefers one authority and reuse of existing August Works primitives over parallel infrastructure. Any additional complexity must be justified by measured need and must preserve tenant isolation, authorization-before-side-effect, auditability, reversibility, and migration safety.

### Assumptions
Current repository primitives remain reusable and V4 architecture invariants remain authoritative.

### Reversal cost
Medium. Replace only through an explicit additive migration or superseding ADR with compatibility and recovery evidence.

### Evidence
- August Works Unified Platform Master Build Brief V4 — Implementation Golden Master.
- Current repository primitives inspected at base commit `be43c23e2df9fc88392390569f5e3b1356cfe275`.
- Supplied engineering, requirements, architecture, SDLC, construction, backend, UI, and UX playbooks.

### Review triggers
Revisit if production evidence, security findings, upstream changes, licensing, scale, or user research invalidate the assumed boundary.

## ADR-013 — MCP and A2A have different responsibilities

**Status:** Accepted

### Context
The V4 Golden Master requires an explicit durable boundary for this decision before dependent implementation proceeds.

### Decision
MCP serves governed tools/resources/data; A2A-style protocols serve independently operated external agents; internal work models remain August Works-owned.

### Alternatives considered
Use one protocol for every boundary.

### Quality attributes affected
Interoperability, security, conceptual clarity, evolvability.

### Trade-offs and risks
The decision deliberately prefers one authority and reuse of existing August Works primitives over parallel infrastructure. Any additional complexity must be justified by measured need and must preserve tenant isolation, authorization-before-side-effect, auditability, reversibility, and migration safety.

### Assumptions
Current repository primitives remain reusable and V4 architecture invariants remain authoritative.

### Reversal cost
Medium. Replace only through an explicit additive migration or superseding ADR with compatibility and recovery evidence.

### Evidence
- August Works Unified Platform Master Build Brief V4 — Implementation Golden Master.
- Current repository primitives inspected at base commit `be43c23e2df9fc88392390569f5e3b1356cfe275`.
- Supplied engineering, requirements, architecture, SDLC, construction, backend, UI, and UX playbooks.

### Review triggers
Revisit if production evidence, security findings, upstream changes, licensing, scale, or user research invalidate the assumed boundary.

## ADR-014 — Extend the existing activity log for audit/provenance

**Status:** Accepted

### Context
The V4 Golden Master requires an explicit durable boundary for this decision before dependent implementation proceeds.

### Decision
Reserve stable namespaced actions and record actor/company/entity/run/source/outcome/safe metadata; never require hidden reasoning or raw credentials.

### Alternatives considered
Separate audit store per subsystem; raw prompt/reasoning retention.

### Quality attributes affected
Auditability, privacy, security, incident response.

### Trade-offs and risks
The decision deliberately prefers one authority and reuse of existing August Works primitives over parallel infrastructure. Any additional complexity must be justified by measured need and must preserve tenant isolation, authorization-before-side-effect, auditability, reversibility, and migration safety.

### Assumptions
Current repository primitives remain reusable and V4 architecture invariants remain authoritative.

### Reversal cost
Medium. Replace only through an explicit additive migration or superseding ADR with compatibility and recovery evidence.

### Evidence
- August Works Unified Platform Master Build Brief V4 — Implementation Golden Master.
- Current repository primitives inspected at base commit `be43c23e2df9fc88392390569f5e3b1356cfe275`.
- Supplied engineering, requirements, architecture, SDLC, construction, backend, UI, and UX playbooks.

### Review triggers
Revisit if production evidence, security findings, upstream changes, licensing, scale, or user research invalidate the assumed boundary.

## ADR-015 — Routines and Pipelines migrate additively

**Status:** Accepted

### Context
The V4 Golden Master requires an explicit durable boundary for this decision before dependent implementation proceeds.

### Decision
Use expand/migrate/contract: add generalized targets, backfill, dual-read temporarily, reconcile, cut over, then remove obsolete fields only after evidence.

### Alternatives considered
Big-bang replacement; implicit lazy reinterpretation.

### Quality attributes affected
Compatibility, migration safety, recoverability, continuity.

### Trade-offs and risks
The decision deliberately prefers one authority and reuse of existing August Works primitives over parallel infrastructure. Any additional complexity must be justified by measured need and must preserve tenant isolation, authorization-before-side-effect, auditability, reversibility, and migration safety.

### Assumptions
Current repository primitives remain reusable and V4 architecture invariants remain authoritative.

### Reversal cost
Medium. Replace only through an explicit additive migration or superseding ADR with compatibility and recovery evidence.

### Evidence
- August Works Unified Platform Master Build Brief V4 — Implementation Golden Master.
- Current repository primitives inspected at base commit `be43c23e2df9fc88392390569f5e3b1356cfe275`.
- Supplied engineering, requirements, architecture, SDLC, construction, backend, UI, and UX playbooks.

### Review triggers
Revisit if production evidence, security findings, upstream changes, licensing, scale, or user research invalidate the assumed boundary.
