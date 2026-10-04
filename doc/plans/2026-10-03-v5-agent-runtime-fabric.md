# V5 fresh implementation

The user authorized a new implementation on 2026-10-03 after exact recovery was
blocked by truncated historical patches and an inaccessible original executor.
The V4 baseline is `f4f594c8571d13b9cb7e6803f8a894075ab8b4f8`; the working branch is
`codex/v5-agent-runtime-fabric`. Historical fragments remain evidence outside the
repository. They are not a source snapshot and are not executed.

All 37 supplied documents were fully read. The V5 master brief defines scope;
engineering playbooks guide implementation without granting operational access.
Ponytail applies: reuse existing company authorization, registries, immutable
versions, context/memory, workflows, audit and project models. No requirement,
authorization check or accessibility behavior is removed for simplicity.

## Ordered delivery and acceptance

- [ ] 0: compatibility ADR; all 20 feature flags safe off with dependency checks.
- [ ] 1–2: stable agent identities, verified backfill, one home, unique local
  presences, guarded lifecycle; identity and home confer no guest authority.
- [ ] 3: normalized provider bindings, isolated profile/session defaults,
  explicit reduced-isolation acknowledgements, capability hashes and drift.
- [ ] 4: explicit cross-company execution scopes with active local presence,
  represented-human intersection, read/contribute/act, evidence provenance,
  restriction propagation and fresh authorization on every use.
- [ ] 5: company relationships requiring target acceptance; local Org Units
  and memberships; neither grants company access.
- [ ] 6–8: persisted immutable Execution Manifests; versioned Role Packs;
  deterministic, authorized Skill and capability resolution and budgets.
- [ ] 9–10: private/proposed Skills, immutable active versions and challengers,
  overlap review, paired evals and guardrails, promotion, drift/revalidation.
- [ ] 11–12: canonical versioned Playbooks, optimistic proposals, pinned links,
  candidate-only projections and human-reviewed feedback, detectable drift.
- [ ] 13: authorized portfolio publish/discover/install/subscribe/fork with
  local policy/evaluation and no silent update or permission inheritance.
- [ ] 14–15: milestones and canonical planned dates; accessible Roadmap,
  dependency checks, explicit baselines, separate forecast and actuals,
  optimistic roadmap proposals, deterministic health and plan-vs-actual.
- [ ] 16: authorized portfolio and August OS aggregation over canonical data;
  external project field authority prevents dual masters.
- [ ] 17: AUTH-501–510, PRIV-501–506 and all 20 pilot hard gates; provider
  conformance, migration/concurrency/recovery and multi-company browser checks.

## Verification and backups

The baseline workspace and Git bundle were checksummed and restore-tested before
source changes. They are in `/workspace/v5-recovery/backups/`, alongside the
separate evidence archive. Each implementation group gets relevant behavioral
and negative tests. The final handoff requires recursive typecheck, test:run,
build and UI token gates. External provider/pilot claims require actual evidence.
Create and restore-test a full final workspace archive and Git bundle.

## Progress — 2026-10-04

The implementation now covers the runtime fabric, company boundaries, governed
Skill and canonical Playbook lifecycle, portfolio adoption and canonical project
control described in the [acceptance evidence](2026-10-04-v5-acceptance-evidence.md).
The Studio pages and authenticated browser scenarios are implemented. Canonical
review, immutable candidates, suite replacement, baseline preservation and
membership/flag rollback have been verified in browser and PostgreSQL checks.

The earlier complete checkpoint has 27,922 passing stable-wrapper tests and
58 actual skips over all 910 server source test files. Its complete source,
Git history, 336 migration hashes and cold PostgreSQL restore were verified.
The finishing work adds scoped connected tools, local native and A2A protocol
bridges, exact replay, full probe accounting and post-crash Skill reconciliation.
The complete supported tests now pass in exact-head CI shards over all 912 server
source test files and 14 workspace projects. Local typecheck/build, explicit
scoped/protocol regressions and all three V5 browser flows pass. The final CI-only
changes and the deliberately interrupted duplicate local run are documented in
the evidence report. Read the private backup index for final cold restore status.

The ordered wave checkboxes describe full activation acceptance. Actual-company
library curation and live provider pilots remain external activation conditions;
the user currently has no pilot companies, presences, profiles or budget.
Unsupported conformance transports remain unqualified. All 20 flags stay off.
CI and independent review must pass before merge. Local fixtures do not certify
live provider isolation or pilot hard gates.
