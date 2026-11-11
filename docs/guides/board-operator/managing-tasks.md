---
help_article_id: create-and-track-work
title: Create and track work
summary: Make a task, assign an owner, and check its current status
audience: company-members
product_capability_refs: [V10-032]
screen_contract_refs: [WORK]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: en
last_verified_at: 2026-11-11
review_trigger: Task creation, assignment, chat-plan handoff, bounded Orchestration plans, status, comments, or run details change
security_or_privacy_sensitive: true
linked_source_files: [ui/src/pages/ExperienceWork.tsx, ui/src/pages/IssueDetail.tsx, server/src/services/agent-conversations.ts, server/src/services/heartbeat.ts, ui/src/pages/Orchestration.tsx, ui/src/i18n/experience/en.json]
---

Tasks are the work items in a company. Open **Work** to find company work you can access, or open a task to review its description, owner, status, comments, and activity.

Choose **Ask Blentera** to open your preferred Co-worker chat, if you have set one, or choose a Co-worker.

You can attach a file in your own chat before sending the first message, then add more files as the conversation continues. You must still have access to the conversation and its files.

If a Co-worker asks a question or shows a confirmation card, answer or accept/reject it in the chat. A plan that has changed needs its current confirmation. Recording your answer or approval does not itself mean the work is complete.

## Create a useful task

State the outcome you need in the title, then add the context and acceptance details someone needs to do the work. Select a project or parent task when the work belongs with an existing effort. Choose an owner only after checking that person or Co-worker is appropriate for the task.

A task you create under an existing parent or Project keeps that work’s access restrictions. Write the instructions the new task needs. A chat handoff can use an existing Project without creating another one.

## Review an approved chat-plan handoff

Approving a plan in a Co-worker chat authorizes the handoff only. The Co-worker creates ordinary assigned Tasks in Backlog with the relevant part of the approved plan carried into each Task’s plan document. The Tasks are not started, and that approval does not approve or start each Task’s separate execution plan. The original chat remains available for discussion.

Before work is queued, open each Task and review its scope, required output, intended action and risk, and model, tool, and time limits. In **Orchestration**, set the maximum model-cost limit in minor currency units (0–1,000,000), then save and start the bounded plan. A Task in **Backlog** stays idle. Move it to **To do** only when its plan is ready to queue the assigned Co-worker.

When a Run succeeds, check the actual output against the requested result and complete any required Human signoff. A successful Run alone does not prove the outcome is complete. Keep a Task in **In review** while required Human review is pending. If the approved scope changes, obtain current approval before handing off the changed work.

The task page shows its current status. Assignment or a status change does not by itself prove that a Co-worker started work or that the requested result is complete. Read the task’s activity and output before closing it.

## Follow progress

Use the task’s comments and activity to follow updates. If work is blocked, read the reason shown and resolve the dependency if you can. Open the run or recovery details offered on the task to see whether work is still running, waiting, stopped, or failed.

If the outcome of a start, retry, or stop is unclear, check the original task before repeating the action. See [Recover interrupted work](/help/recovering-work) and [Review approvals and stop work](/guides/board-operator/approvals).

If your company has **Workflows** enabled, see [Use Workflows](/help/workflows-preview) for the separate draft, test, and publish flow.
