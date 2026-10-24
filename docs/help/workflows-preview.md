---
help_article_id: workflows-preview
title: Use Workflows
summary: Review a workflow draft, test it, and publish only when its steps are ready
audience: company-administrators
product_capability_refs: [V10-152]
screen_contract_refs: [WORKFLOW, WORKFLOW-DESCRIBE, WORKFLOW-REVIEW, WORKFLOW-TEST, WORKFLOW-PUBLISH, WORKFLOW-RECOVER]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: en
last_verified_at: 2026-10-24
review_trigger: Workflow authoring, supported steps, test, publish, run, or recovery behavior changes
security_or_privacy_sensitive: true
linked_source_files: [ui/src/pages/Workflows.tsx, ui/src/pages/WorkflowDescribe.tsx, ui/src/pages/WorkflowBuilder.tsx, ui/src/pages/WorkflowReview.tsx, server/src/routes/workflows.ts, server/src/services/workflows/workflow-node-registry.ts, server/src/services/workflows/workflow-service.ts]
---

Workflows are available only when they are enabled for your company and instance. If you do not see **Workflows**, ask your instance administrator whether the feature is available.

## Draft, test, and publish

Open **Workflows** to view the workflows you can access. Create or open a draft, then review its steps and the information each step will use. The editor may let you save a draft even when a step is not ready to run.

Use the available test and review actions before publishing. Read the result and any blocking issue. A step marked draft-only or unavailable cannot be assumed to run because it appears in an editor. Fix or remove unsupported steps before publishing.

Publishing makes a specific reviewed revision available to run. Review the trigger, inputs, actions, and approvals shown in the publish flow. Changes to the draft after publishing do not change the already-published revision; publish the updated draft when it is ready.

## Review runs

Open a workflow’s run history to check its current state and step details. A run can wait for a task, approval, delay, or other supported condition. Use the run’s own recovery or stop action when one is shown. Do not create a duplicate run just because a response was interrupted; first check whether the original run was accepted.

This feature is in preview and its available steps depend on the current registry and deployment. For technical details, see the [Workflow API reference](/api/workflows).
