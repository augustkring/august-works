# V7-ADR-012 — Agent Package distribution and company authority

Date: 2026-10-05. Decision: extend native AW registries.

The global `agent_packages`, versions and components are first-party distribution metadata. They contain no company content, identity store, permissions or connection credentials. This is an explicit metadata-only scope exception; installed state, source-derived proposals, run pins, cancellation and audit remain company scoped.

A release has one immutable content digest, exact component digests and separately recorded release-evidence dimensions. Publication requires a configured platform publisher and current-build protected artifact references. Installation resolves equivalent native Role Pack/Skill/Playbook/Workflow/Routine versions in the selected company; mismatching, private, revoked, overdue or source-invalid resources cannot be borrowed across tenants. Additional policy/template/evaluation references are reproducible publisher artifacts, not executable opaque prompts or implicit grants.

Installation and activation are separate. The Role Pack resolver can preview a replacement of the agent's direct native assignment while preserving system and organization overlays. Readiness adds the release's knowledge criteria to mandatory native policies. Current authority and immutable activation revisions fence reused sessions. Material updates and Learning proposals require explicit human review; acceptance configures without activating. Learned updates retain source lineage and flag-independent erasure/restore guards. Canonical company business records survive cancellation/uninstall.

Managed package products purchase maintained capability, without granting company authorization or bundling unlimited runtime/model costs. Actual environment price mappings remain external configuration. The internal package is free and cannot acquire paid managed capacity. Customer releases require independent supply-chain/evaluation evidence and an approved purpose; no protected-host or legal claim follows from a recorded artifact reference alone.
