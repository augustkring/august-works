# V9 lifecycle and duplicate-request regressions

The focused lifecycle pause/recovery case passed on the current source snapshot (one selected test, 36 neighboring tests skipped). The duplicate original-request race passed on r3 (one selected test, 21 neighboring tests skipped).

The duplicate test’s r1/r2 failures are retained as diagnosis. r1 exposed a cleanup query that masked the original read failure. r2 captured the original error: a concurrent executor checkpoint held a `workflow_step_runs` row while source currentness used `FOR SHARE NOWAIT`. The current source read now waits under its existing eight-second statement timeout and then revalidates the row. The current r3 regression confirms both simultaneous requests recover the same receipt through the later draft replacement/publication checks.

The cleanup change in authorization preserves an earlier read error if transaction-local GUC cleanup fails after the transaction is already aborted; successful reads still surface cleanup-only failures. No authorization, lease, workflow pause, rollout, or request-id policy was relaxed. Each attempt contains exact source pins, runner args, raw test output, and process exits. Recheck source hashes after the pending repository checkpoint before treating this archive as the final committed proof.
