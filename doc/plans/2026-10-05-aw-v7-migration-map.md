# August Works V7 migration and ownership map

Date: 2026-10-05. Post-V6 baseline: `137e6ab386d6e579e9057d2c44b583a7167dc29f`.

## Current change

Wave 0 adds 20 default-off booleans to the existing `instance_settings.experimental` JSON contract. No SQL migration, data backfill, provider install, new runtime execution or billing cutover occurs. Legacy rows receive false values on normalization. Dependency validation runs after Cloud defaults and managed overlays, before startup admission and experimental writes. Experimental writes serialize with `SELECT … FOR UPDATE` in one transaction.

## Candidate schema reconciliation

The brief §132 lists candidate additions, not instructions to create every table now. Each row below has been reconciled to the actual predecessor source domain. Final SQL, constraints, indexes, tenant FKs and routes belong to the owning wave. Source names refer to `packages/db/src/schema/`.

| Candidate model | Wave | Authority and migration direction | Existing source |
| --- | --- | --- | --- |
| `knowledge_quality_findings` | 1 | Foundation + Context; additive evidence, not membership | `foundation.ts, context_manifests.ts` |
| `readiness_requirements` | 1 | Foundation + Context; additive evidence, not membership | `foundation.ts, context_manifests.ts` |
| `readiness_assessments` | 1 | Foundation + Context; additive evidence, not membership | `foundation.ts, context_manifests.ts` |
| `foundation_bootstrap_runs` | 2 | Documents/approved Foundation pointers + onboarding; proposals only | `foundation.ts, document_revisions.ts, company_onboarding_seeds.ts` |
| `foundation_bootstrap_candidates` | 2 | Documents/approved Foundation pointers + onboarding; proposals only | `foundation.ts, document_revisions.ts, company_onboarding_seeds.ts` |
| `cognitive_memory_bindings` | 3–5 | Canonical Memory + jobs; derived and invalidatable | `memory.ts, memory_jobs.ts, cross_company_context.ts` |
| `memory_observations` | 3–5 | Canonical Memory + jobs; derived and invalidatable | `memory.ts, memory_jobs.ts, cross_company_context.ts` |
| `memory_observation_evidence` | 3–5 | Canonical Memory + jobs; derived and invalidatable | `memory.ts, memory_jobs.ts, cross_company_context.ts` |
| `memory_models` | 3–5 | Canonical Memory + jobs; derived and invalidatable | `memory.ts, memory_jobs.ts, cross_company_context.ts` |
| `memory_model_evidence` | 3–5 | Canonical Memory + jobs; derived and invalidatable | `memory.ts, memory_jobs.ts, cross_company_context.ts` |
| `learning_cycles` | 6 | V5 Skill/Playbook evaluations and promotion; add cycle/evidence records, reuse promotion authority | `skill_lifecycle.ts, playbooks.ts, company_skills.ts` |
| `learning_hypotheses` | 6 | V5 Skill/Playbook evaluations and promotion; add cycle/evidence records, reuse promotion authority | `skill_lifecycle.ts, playbooks.ts, company_skills.ts` |
| `learning_evaluations` | 6 | V5 Skill/Playbook evaluations and promotion; add cycle/evidence records, reuse promotion authority | `skill_lifecycle.ts, playbooks.ts, company_skills.ts` |
| `orchestration_plans` | 7–9 | Tasks/Workflows/runtime attempts; extend identities and references, no replacement statuses | `issues.ts, workflows.ts, completion_contracts.ts, heartbeat_runs.ts, work_assessments.ts` |
| `supervision_sessions` | 7–9 | Tasks/Workflows/runtime attempts; extend identities and references, no replacement statuses | `issues.ts, workflows.ts, completion_contracts.ts, heartbeat_runs.ts, work_assessments.ts` |
| `supervision_signals` | 7–9 | Tasks/Workflows/runtime attempts; extend identities and references, no replacement statuses | `issues.ts, workflows.ts, completion_contracts.ts, heartbeat_runs.ts, work_assessments.ts` |
| `supervision_interventions` | 7–9 | Tasks/Workflows/runtime attempts; extend identities and references, no replacement statuses | `issues.ts, workflows.ts, completion_contracts.ts, heartbeat_runs.ts, work_assessments.ts` |
| `verification_runs` | 7–9 | Tasks/Workflows/runtime attempts; extend identities and references, no replacement statuses | `issues.ts, workflows.ts, completion_contracts.ts, heartbeat_runs.ts, work_assessments.ts` |
| `work_signal_candidates` | 10 | Connector event delivery + existing task/approval actions | `connection_event_deliveries.ts, chat_channels.ts, approvals.ts` |
| `coordination_followups` | 10 | Reuse Routines and durable notifications first; no table unless an unmet contract is demonstrated | `routines.ts, agent_wakeup_requests.ts` |
| `runtime_sandbox_bindings` | 11–12 | Add enforcement projections/evidence under existing V6 host/cell lifecycle | `runtime_fleet.ts, environments.ts, company_secrets.ts` |
| `runtime_policy_snapshots` | 11–12 | Add enforcement projections/evidence under existing V6 host/cell lifecycle | `runtime_fleet.ts, environments.ts, company_secrets.ts` |
| `sandbox_qualification_runs` | 11–12 | Add enforcement projections/evidence under existing V6 host/cell lifecycle | `runtime_fleet.ts, environments.ts, company_secrets.ts` |
| `ai_use_cases` | 13 | Purpose/versioned assessment domain; current company authority + approvals | `company_memberships.ts, approvals.ts, activity_log.ts` |
| `ai_use_case_assessments` | 13 | Purpose/versioned assessment domain; current company authority + approvals | `company_memberships.ts, approvals.ts, activity_log.ts` |
| `ai_use_case_change_events` | 13 | Purpose/versioned assessment domain; current company authority + approvals | `company_memberships.ts, approvals.ts, activity_log.ts` |
| `human_oversight_profiles` | 13 | Purpose/versioned assessment domain; current company authority + approvals | `company_memberships.ts, approvals.ts, activity_log.ts` |
| `governance_findings` | 13 | Purpose/versioned assessment domain; current company authority + approvals | `company_memberships.ts, approvals.ts, activity_log.ts` |
| `assurance_claims` | 13 | Add explicit V2 claim, law and derived-data lifecycle evidence; scoped platform records separate from tenant-null access | `activity_log.ts, memory.ts, saas_lifecycle.ts` |
| `assurance_evidence_links` | 13 | Add explicit V2 claim, law and derived-data lifecycle evidence; scoped platform records separate from tenant-null access | `activity_log.ts, memory.ts, saas_lifecycle.ts` |
| `regulatory_obligations` | 13 | Add explicit V2 claim, law and derived-data lifecycle evidence; scoped platform records separate from tenant-null access | `activity_log.ts, memory.ts, saas_lifecycle.ts` |
| `ai_operator_role_assessments` | 13 | Add explicit V2 claim, law and derived-data lifecycle evidence; scoped platform records separate from tenant-null access | `activity_log.ts, memory.ts, saas_lifecycle.ts` |
| `ai_data_surfaces` | 13 | Add explicit V2 claim, law and derived-data lifecycle evidence; scoped platform records separate from tenant-null access | `activity_log.ts, memory.ts, saas_lifecycle.ts` |
| `agent_packages` | 15 | Compose V5 immutable Role Packs/Skills/Playbooks; V6 products and local entitlements | `role_packs.ts, company_skills.ts, skill_lifecycle.ts, playbooks.ts, saas_billing.ts` |
| `agent_package_versions` | 15 | Compose V5 immutable Role Packs/Skills/Playbooks; V6 products and local entitlements | `role_packs.ts, company_skills.ts, skill_lifecycle.ts, playbooks.ts, saas_billing.ts` |
| `agent_package_components` | 15 | Compose V5 immutable Role Packs/Skills/Playbooks; V6 products and local entitlements | `role_packs.ts, company_skills.ts, skill_lifecycle.ts, playbooks.ts, saas_billing.ts` |
| `company_agent_package_installations` | 15 | Compose V5 immutable Role Packs/Skills/Playbooks; V6 products and local entitlements | `role_packs.ts, company_skills.ts, skill_lifecycle.ts, playbooks.ts, saas_billing.ts` |
| `agent_package_release_manifests` | 15 | Compose V5 immutable Role Packs/Skills/Playbooks; V6 products and local entitlements | `role_packs.ts, company_skills.ts, skill_lifecycle.ts, playbooks.ts, saas_billing.ts` |
| `architecture_conformance_findings` | 0 onward | Track material intended/implemented/observed drift; use this ledger first, persist only when a domain needs it | `activity_log.ts` |

## Existing contracts to extend

| Brief concept | Canonical reconciliation |
| --- | --- |
| Completion contract | `completion_contracts.ts` already exists. Extend policy/version references; never recreate this table or work status authority. |
| Descendant autonomy budgets | Reuse `budget_policies.ts`, `budget_incidents.ts`, `execution_manifests.ts` where semantics match. Compound reservations need atomic server enforcement in Wave 7; generic spend budgets alone are insufficient. |
| Free / capacity / package / enterprise products | Add explicit V6 entitlement and catalog semantics in `saas_billing.ts`; `EMPTY_ENTITLEMENTS` and commercial guards currently remain unchanged. |
| Agent identity and presence | V5 `agent_identities.ts`, `agent_provider_bindings.ts`, `agent_memberships.ts` remain canonical. Identity linkage grants no company access. |
| Provider deletion / restore | Extend canonical Memory tombstones and V6 lifecycle reconciliation; test projection rebuild/restore cannot resurrect deleted data. |
| Steward jobs / follow-ups | Reuse Memory jobs, Routines and existing durable delivery. Do not add a second correctness scheduler. |

## API reconciliation

Existing `/api/instance/settings/experimental` GET/PATCH carries V7 settings; no new V7 domain routes ship in Wave 0. The brief route families below are reserved design proposals, not working endpoints.

| Family from brief §§157–165 | Owning existing boundary | Delivery wave |
| --- | --- | --- |
| Company readiness / assessments | Company-scoped Foundation/Context services | 1 |
| Cognitive memory / observations / models | Authorized Memory retrieval and jobs | 3–5 |
| Learning cycles / evaluations / proposals | Skills/Playbooks immutable promotion | 6 |
| Orchestration / supervision / verification | Tasks, Workflows and Runtime Fabric | 7–9 |
| Company work-signals apply/ignore/review | Connector event identity plus task/approval admission | 10 |
| Internal runtime-sandboxes qualify/policy/reconcile | V6 runtime-cell control plane; not ordinary customer operations | 11–12 |
| Company ai-use-cases / governance / evidence exports | Company membership, purpose assessment and scoped exports | 13 |
| Agent-package catalog / preview/install/activate/update | V5 versioned assets + V6 catalog/billing | 15 |
| `/billing/product-access` | V6 local entitlement resolver and capacity meters | 14 |

## Canonical vocabulary decisions

Persist lower-case lifecycle states matching repository conventions and detailed schema contracts. Upper-case labels in conceptual diagrams are presentation, not a second state machine. Do not freeze a state enum until its owning wave reconciles the detailed schema and transitions. Package `published`, observation `accepted` and Foundation approval are different authorities. Runtime assurance, commercial access, technical permission and intended purpose remain separate gates.

## Rollout and rollback

`packages/shared/src/v7-feature-flags.ts` is the configuration source of truth. Its V7 and predecessor dependency graphs and `V7_ROLLOUT` cover all 20 flags. Brief names `AW_V7_<NAME>` map to `<name>_v7` in persisted settings; no new environment variables are introduced. Initial work-signals admission is chat-specific; OpenShell admission is hosted-OpenClaw-specific; Core Stewards conservatively require readiness, learning and governance. Broader adapters or independent steward domains must revise the graph with their acceptance evidence.

Disable dependents together with prerequisites in one PATCH. Retain canonical objects, versions, attempts and evidence. Managed overlays must be repaired at their configuration source. Direct database edits are not supported admission paths. OpenShell rollback must stop workloads requiring its assurance; fallback to unsandboxed execution is forbidden. Wave 0 has no such workloads or provider effects.

## Before each material migration

Reconcile the target master again; define backfill, bounds, idempotency, version/CAS, tenant references and current principal checks. Prove interrupted migration and restore/rebuild behavior, define retention/export/correction/deletion, and preserve prior attempts/evidence. Update shared validators, service, API, documentation and owning ADR together. Wave 0 reserves this map; later-wave schemas remain unimplemented.
