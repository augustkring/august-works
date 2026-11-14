# Plugin-managed Routine source binding evidence

The issue privacy graph now classifies a validated plugin operation `originRunId` as a Routine Run source only when the exact current plugin, managed Routine resource, revision, operation template, and supported Run source (`manual`, `api`, `schedule`, or `webhook`) match. The 0549 database trigger rejects invalid plugin-shaped origins. Tests cover manual positive ownership, scheduled-origin structural classification, invalid retarget rejection without mutation, and denial of a foreign manual Routine Run.

The generated authorization SQL also received two syntax corrections found by the focused PostgreSQL smoke: the Comment-root alternative's closing parenthesis and the outer boolean group returned by `pipelineAutomationRoutineSourceCondition`. The final fresh SQL smoke and the complete plugin-managed Routine test file passed after those fixes.

- Focused check: 1 passed, 2 skipped; exit 0 (`r21-focused-test.log`).
- Full file: 3 passed; exit 0 (`r22-full-test.log`).
- Both runs used pinned dependencies in `/workspace/v10-dep-qualification`, base commit `886014cae5a7d6ed5a9ab99d62613ec7646308cb`, and source head `16299f63a2f27b1784cc0b4be054d6271b9dcb32` plus the exact dirty source copies listed in each `*-source-pins.json`. These pins describe qualification inputs, not a claim that those edits are committed at the source head.
- Migration 0549 SQL SHA-256: `f715f95e8587975b44b57a9c93dbfdc128bef299fc3d0b087bcd35b55a1daf6b`.
- Each run used the shared host lock, a fresh source snapshot, and syntax preflight. No diagnostic observer ran in the passing attempts.
