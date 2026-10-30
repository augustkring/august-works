---
help_article_id: approvals-and-stop
title: Review approvals and stop work
summary: Inspect a request, record a decision, or stop an active task run
audience: company-administrators
product_capability_refs: [V10-032]
screen_contract_refs: [APPROVAL-CARD, WORK]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: en
last_verified_at: 2026-10-24
review_trigger: Approval decisions, active task stop controls, or run outcome behavior changes
security_or_privacy_sensitive: true
linked_source_files: [ui/src/pages/Approvals.tsx, ui/src/pages/ApprovalDetail.tsx, ui/src/pages/IssueDetail.tsx]
---

An approval is a request for a decision. Open **Approvals** to review pending requests you can access, then open a request to read its details and linked work before deciding.

## Record an approval decision

The request page may offer **Approve**, **Reject**, or **Request revision**. Choose based on the request shown. A revision request sends the item back for changes; it does not approve the action. After submitting, check the status shown on the approval page.

Some app actions have their own access review in **Apps**. Review the provider, account, permissions, and action scope shown there. An app connection or an approval for one action does not automatically approve a different action.

## Pause or stop task work

Open the task to find controls for its active run. Depending on the current state, you may see **Pause work**, **Stop and done**, or **Stop and cancel**. Pause controls the active run; marking a task done or cancelled is a separate task outcome. Read each action’s label and current task status before using it.

Wait for the task page to show the resulting run and task state. If a stop or decision has an unknown result, refresh the original task or approval and check its status before repeating the action. See [Recover interrupted work](/help/recovering-work) for the next safe checks.
