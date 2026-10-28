# Bounded cross-company runtime receipts

These receipts cover the bounded delegated guest `read` and `contribute` path, guest `act` denial in a plan, and worker/native-tool admission after current Human membership revocation. The PostgreSQL tests use internal fixtures and the repository's embedded test database. They are software evidence only; they do not establish live vendor conformance or external deployment qualification.

## Current qualifying receipts

| Receipt | Result | What it exercises |
| --- | --- | --- |
| `read-contribute-r6/` | snapshot 0, syntax 0, test 0; 1 passed, 5 skipped | Real PostgreSQL fabric preparation for guest read and Human-granted Playbook contribution within bounded plans; private/restricted sources excluded; guest act rejected when the plan already exists and when it starts after preparation; contribution result stays owned by the home company. |
| `worker-boundary-r1/` | snapshot 0, syntax 0, test 0; 1 passed, 66 skipped | Exact represented-Human guest binding at bounded worker admission, Native `get_task_context`, then guest Human-membership revocation blocking worker admission and native-tool callback before dispatch. |

Both source-pin files record source head `9094f862fd200bc1fb81d884238149df85e53ad6`, qualification base `886014cae5a7d6ed5a9ab99d62613ec7646308cb`, and hashes for the captured changed files. Their `SHA256SUMS` files validate. The two passing snapshots pin the same relevant source hashes.

## Preserved diagnostic attempts

- `read-contribute-r1/`: test failed because its fixture enabled `orchestration_v7` without `enableWorkflowsV1`.
- `read-contribute-r2/`: the worker/native-boundary case passed, but the fabric case failed its Foundation-source fixture assertion.
- `read-contribute-r3/` and `read-contribute-r4/`: contribution was correctly denied because the guest Agent lacked the required current local permission/membership setup.
- `read-contribute-r5/`: after adding the local membership, the original Playbook owner correctly denied the missing guest Agent `foundation:read` permission.

Those failures are retained as diagnostic history. The final passing fixture now seeds active local guest-Agent membership and the Human-granted `foundation:read` and `foundation:propose` permissions; production admission logic was not weakened.

The source changes also make pure delegated Context revalidation acquire the company analytical, Memory, and issue-privacy advisory fences in shared mode, in canonical order, before run/source rows. `lockIssuePrivacyTree` remains exclusive by default for writers. `git diff --check` passed. No dedicated reverse-order concurrency stress test or live provider test is included in this receipt set.
