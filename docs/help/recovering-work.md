---
help_article_id: recovering-work
title: Recover interrupted work
summary: Check a task’s current state and use its available next action safely
audience: company-members
product_capability_refs: [V10-161]
screen_contract_refs: [WORK]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: en
last_verified_at: 2026-10-24
review_trigger: Task run status, scheduled retry, stop, continuation, or recovery actions change
security_or_privacy_sensitive: true
linked_source_files: [ui/src/pages/IssueDetail.tsx, ui/src/components/IssueBlockedNotice.tsx, ui/src/lib/wait-for-stopped-runs.ts, server/src/services/issue-recovery-actions.ts]
---

When a task stops making progress, open the original task and check its current status, activity, run history, and next-step notice. A failed response from your browser does not always mean the task failed; the server may have accepted the original action.

## Check before retrying

Read the latest run and any blocker or recovery message. Resolve the named connection, approval, owner, or other requirement if you can. Use a retry action only when it is shown for that task and the current state. If there is no retry action, ask the task owner or an administrator to review the run before creating replacement work.

If a scheduled retry is shown, use the task’s **Retry now** action only if you want to bring that existing retry forward. It does not create a separate task. Check the status again after the action completes.

## When a stop is pending

Keep the task open while a stop action is pending. Wait for the run and task status to update. If the page reports an unknown outcome, refresh the original task and inspect its latest run before sending another instruction or starting replacement work.

For help with an unresolved error, contact [human support](/help/index) with the task identifier and the non-secret message shown on screen. Do not include credentials or private task information that the recipient cannot access.
