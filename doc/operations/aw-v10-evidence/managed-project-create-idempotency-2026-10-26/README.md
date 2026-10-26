# Managed Project creation idempotency proof — 2026-10-26

The pinned managed OpenCode Project integration passed against the current source snapshot. It exercised the actual managed `create_project` result, exact same-call replay, one Project/workspace/activity effect, source and workspace receipt validation, authenticated Alice read, Bob denial, and next-request consumption of the provider-visible result.

The integration now uses strict receipt equality at the original Project service replay assertion. Snapshot and Vite/Oxc syntax preflight both exited 0; Vitest executed one case and passed. The archived source pins identify the exact copied source used by the run. This does not claim the full conversation-frame file has been rerun after adding the exact reply-count/no-review-interaction assertions; that full-file run remains pending.
