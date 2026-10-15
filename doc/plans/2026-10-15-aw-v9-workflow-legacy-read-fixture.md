# Verify current workflow writes and legacy read defense separately

The serialized V9 workflow lifecycle suite reached a negative historical-row
fixture that inserted a foreign workflow revision. Migration 0496 now rejects
that insertion with SQLSTATE 23514, before the intended read-layer assertion.
The original failure is retained; it is not an authorization regression.

Strengthen this case: assert that the current Native write rejects the mismatched
revision first. In the owned disposable PostgreSQL fixture only, use one explicit
transaction to disable just aaa_workflow_copy_identity_guard on workflow_runs,
insert the simulated pre-0496 historical row, and re-enable that same guard before
commit. Preserve every other trigger and constraint. A second invalid-insert
assertion proves that the guard is restored before the HTTP request. Then retain
the original 404, absent partial overview and private-payload non-disclosure
assertions. Production schema, guards, route/service code and permissions do not
change. A failed fixture transaction rolls its trigger change back.

The first edited test run exposed a missing sql import (20 passes, then exit 1);
that local editing error and log are retained. With the import corrected all 37
lifecycle cases pass, including both current write denials and the legacy read
boundary. The two remaining serialized suites and broader workspace/general
continuation must still complete; no full-source/release acceptance is inferred.
