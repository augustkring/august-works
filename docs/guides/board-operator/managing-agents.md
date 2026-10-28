---
help_article_id: working-with-coworkers
title: Work with Co-workers
summary: Add a Co-worker, check its status, and control when it can receive work
audience: company-administrators
product_capability_refs: [V10-103]
screen_contract_refs: [SETTINGS-AGENTS-AI, AGENT-MONITOR, AGENT-CHANGE]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: en
last_verified_at: 2026-10-28
review_trigger: Co-worker setup, account connections, status, pause, or task assignment changes
security_or_privacy_sensitive: true
linked_source_files: [ui/src/pages/Agents.tsx, ui/src/pages/AgentDetail.tsx, server/src/services/agents.ts, server/src/services/agents/authoring-publication.ts, server/src/services/experience/model-retirement-notices.ts, ui/src/components/AgentRuntimeCandidates.tsx, ui/src/components/AgentDraftPublication.tsx, ui/src/components/MandatoryProductNotices.tsx]
---

Blentera calls the workers in your company **Co-workers**. Some current screens still use **Agent**. You can find them in the company’s Agents area and open a Co-worker to review its settings, connection, and recent work.

## Add or update a Co-worker

Use the add action in the Agents area and follow the fields shown for its role, instructions, and AI connection. The available setup depends on the selected connection and your instance. Review who can use a shared connection and which actions require review before saving. A saved credential may need to be reconnected later if its provider expires or revokes access.

Open a Co-worker’s detail page to inspect its status and recent task runs. Check the exact error or setup notice shown there; a Co-worker marked ready to receive work is not a guarantee that a particular provider run will succeed.

## Pause future work

Pause a Co-worker when you do not want it to receive new scheduled or assigned work. Pausing a Co-worker and stopping a run already in progress are separate controls. For an active task, open that task and use the current run action shown there. See [Review approvals and stop work](/guides/board-operator/approvals).

When assigning work, review the task’s instructions, owner, and project. The task page is the source for its current status and recorded result; the Co-worker’s status alone does not confirm that a task is complete.

For company members and their access, see [People and company access](/guides/board-operator/org-structure). For a task that did not finish, see [Recover interrupted work](/help/recovering-work).

## Review a model change

If Action Needed says that a current Agent model needs migration, open that Agent and review a replacement through its draft and qualified runtime candidate. Publishing a model change requires a Human review of the exact candidate and retained test evidence. A rollback also requires a currently qualified candidate and review. Blentera does not silently replace a retired model. If qualification or baseline evidence is missing, ask your administrator to resolve the block before publishing.
