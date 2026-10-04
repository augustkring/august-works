---
name: task-planning
description: >
  Project Planning & Execution. Map company goals to a small, owned task graph,
  milestones, blockers and reviewed Roadmap proposals. Use for CEOs, CTOs,
  project managers and project leads planning or updating execution.
---

# Project Planning & Execution

Use the current Execution Manifest, local company scope and current authority.
This Skill never grants access, hiring authority, approval authority or a budget.
Installing it does not make its candidate an active V5 Skill. Local evaluation
and promotion policy apply before the resolver can select an active version.

1. Read the project, goal, visible tasks, milestones, relationships and current
   Roadmap policy. Identify the outcome, acceptance criteria, constraints and
   unknowns. Read the local agent roster and actual specialty capabilities.
2. Begin with one end-to-end task. Add a task only for a separate owner or
   permission boundary, useful independent deliverable, hard blocker, independent
   review, or independently retryable work. Put implementation steps inside the
   owning task. Merge every split without one of these reasons.
3. Prepare a compact matrix: goal, task, verified local owner, deliverable,
   acceptance criteria, split reason, milestone and real blockers. Keep one
   assignee per task. Surface a missing specialist instead of inventing an owner.
4. Use the normal company task APIs to create or update the authorized tasks.
   Record hard dependencies in `blockedByIssueIds`; parent nesting does not block
   execution. Preserve field ownership and existing checkout semantics. Do not
   copy a primary-company key into a guest-company request.
5. Create milestones through the local project milestone API only with current
   authority. Submit planned dates and effort through Roadmap proposals with
   current task/project `updatedAt` values. A proposed date is not a commitment.
   Wait for required human review. External-owned planning fields stay external.
6. Keep forecasts separate from commitments. Update them with observed execution
   evidence, explicit confidence and a reason. Never invent actual completion,
   effort, provider costs, or a forecast when observation is missing.
7. Re-read the resulting task graph and Roadmap. Verify local owners, blockers,
   milestones, approved commitments and lack of unjustified fragmentation. Read
   deterministic health observations and link their source tasks. Explain their
   significance; do not replace them with an opaque AI score.
8. Report outcome, pending decisions, source company and evidence. Preserve
   source sensitivity and export restrictions. Recheck authorization on each
   action and stop when membership, budget or runtime qualification is revoked.

Use the existing `paperclip-converting-plans-to-tasks` and `paperclip` Skills for
task mechanics when those Skills are authorized and available in the manifest.
Do not load other companies' libraries or automatically delegate from this text.
