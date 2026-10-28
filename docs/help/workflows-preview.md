---
help_article_id: workflows-preview
title: Use Workflows
summary: Review a workflow draft, test it, and publish only when its steps are ready
audience: company-administrators
product_capability_refs: [V10-152, V10-027]
screen_contract_refs: [WORKFLOW, WORKFLOW-DESCRIBE, WORKFLOW-REVIEW, WORKFLOW-TEST, WORKFLOW-PUBLISH, WORKFLOW-RECOVER]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: en
last_verified_at: 2026-10-28
review_trigger: Workflow authoring, supported steps, test, publish, run, or recovery behavior changes
security_or_privacy_sensitive: true
linked_source_files: [ui/src/pages/Workflows.tsx, ui/src/pages/WorkflowDescribe.tsx, ui/src/pages/WorkflowBuilder.tsx, ui/src/pages/WorkflowReview.tsx, server/src/routes/workflows.ts, server/src/services/workflows/workflow-node-registry.ts, server/src/services/workflows/workflow-service.ts, ui/src/pages/CompanyAccess.tsx, ui/src/pages/IssueDetail.tsx, server/src/routes/access.ts, server/src/services/access.ts, server/src/services/workflows/workflow-executor.ts, packages/shared/src/validators/access.ts, packages/db/src/schema/workflows.ts]
---

Workflows are available only when they are enabled for your company and instance. If you do not see **Workflows**, ask your instance administrator whether the feature is available.

## Draft, test, and publish

Open **Workflows** to view the workflows you can access. Create or open a draft, then review its steps and the information each step will use. The editor may let you save a draft even when a step is not ready to run.

Use the available test and review actions before publishing. Read the result and any blocking issue. A step marked draft-only or unavailable cannot be assumed to run because it appears in an editor. Fix or remove unsupported steps before publishing.

Publishing makes a specific reviewed revision available to run. Review the trigger, inputs, actions, and approvals shown in the publish flow. Changes to the draft after publishing do not change the already-published revision; publish the updated draft when it is ready.

## Review runs

Open a workflow’s run history to check its current state and step details. A run can wait for a task, approval, delay, or other supported condition. Use the run’s own recovery or stop action when one is shown. Do not create a duplicate run just because a response was interrupted; first check whether the original run was accepted.

This feature is in preview and its available steps depend on the current registry and deployment. For technical details, see the [Workflow API reference](/api/workflows).

## Temporary workflow coverage

In your company’s access settings, use **Temporary workflow coverage** to choose another active Human, a published workflow version, and a start and expiry time. Choose manual starts or one visible Task, and give a reason. Coverage can last up to 30 days. Both people must already have the required current permissions and Task access.

The other person can select your coverage when starting that workflow from its editor or the chosen Task. The run records the person who actually starts it. Access and the coverage window are checked again when a queued run is claimed.

Coverage applies to the chosen published version. Review and create new coverage after publishing a different version. Revoke coverage in access settings to end it early. Withdrawal of a required permission, account closure, or a restored database invalidates prior coverage; create a new arrangement once the current access and version have been reviewed.
