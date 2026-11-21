---
help_article_id: start-and-first-result
title: Start a company and reach your first result
summary: Follow the guided setup and check the result of your first task
audience: new-company-owners
product_capability_refs: [V10-103]
screen_contract_refs: [ONB-01, ONB-02, ONB-03, ONB-09]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: en
last_verified_at: 2026-10-24
review_trigger: Activation, connection, first Co-worker, first task, or result behavior changes
security_or_privacy_sensitive: true
linked_source_files: [ui/src/pages/Activation.tsx, ui/src/components/ActivationFirstAgent.tsx, ui/src/components/ActivationFirstTask.tsx, ui/src/components/ActivationFirstValue.tsx, server/src/services/saas/activation.ts, server/src/services/saas/activation-first-task.ts]
---

Use the guided setup shown after you sign in to create a company, prepare a Co-worker, and start a first task. Some screens use **Agent** for Co-worker. The setup saves your progress so you can leave and return to the current step.

## Before starting work

Follow the choices on screen to describe what the company does and what you want help with. When setup asks for an app or AI account, review the account and access shown before connecting it. A connection that appears in a list is not proof that the provider will accept it later; resolve any reconnect or setup notice before relying on it.

The guided flow helps prepare one Co-worker and one task. Review the task and the work it may start before selecting its start action. A task can wait for a connection, approval, or another requirement. Starting a task does not promise that its work will succeed or finish by a particular time.

## Check the result

After a run, open the task to review its status, activity, and any result the Co-worker recorded. A completed run and a useful result are different things: read the output and decide whether it meets your need.

If the task is still running, blocked, or failed, use the status and next action shown on the task. See [Recover interrupted work](/help/recovering-work) before starting another attempt when the first outcome is unclear.

## Pause setup or leave

Use the setup navigation to return to an earlier step, or choose the save-and-exit action when it is offered. When first-task setup provides **Stop**, use it to request that work stop and wait for the result shown on screen. Do not treat a pending stop as confirmation that the run has ended.

For access, billing, or deletion questions, see [People and company access](/guides/board-operator/org-structure), [Billing and capacity](/guides/board-operator/costs-and-budgets), and [Export and deletion](/help/export-and-delete).
