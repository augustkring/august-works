# CI 69b derived-memory and workflow lifecycle repair

CI run `40323486958` at source head `69b774c17497db81bbce15d08eec41531f9fbac2` exposed derived-memory source fixtures that referenced no current Task owner and workflow lifecycle rows with no accountable Human owner.

The fixture updates in `v7-derived-memory.integration.test.ts` now seed a verified current Human session, source accepted Memory evidence from actual completed Tasks owned by that Human, and carry the source Task version and timestamp. The revoke case uses that same Human and restores feature settings in `afterEach`. Private-source promotion expects the privacy-preserving 403 once the Human no longer has source access. The Context erasure case uses an accountable Task/Run pair and supplies its matching responsible Human to Context assembly. Its single integration invocation uses a 5-second request-local budget to exercise the complete manifest/source checks; production defaults are unchanged.

`v9-workflow-lifecycle-routes.test.ts` now attributes the queued runs in the grant and actual-admin-role tests to the Human whose current authorization is under test. The launch test includes a response body on failure to make future route errors diagnosable.

Validation used the fresh qualification workspace `/workspace/v10-dep-qualification/server`, pinned dependencies, one Vitest worker, and the shared PostgreSQL flock. Source pins record the copied source file hashes for every run. The qualification base was `886014cae5a7d6ed5a9ab99d62613ec7646308cb`; source HEAD was `69b774c17497db81bbce15d08eec41531f9fbac2` with dirty fixture copies captured in the source-pin manifests.

Final focused results:

- R2: the combined derived-memory and workflow-lifecycle files executed 45 tests; the workflow-lifecycle file passed all 37 tests. Two derived-memory fixture issues remained at that point.
- R5: the final derived-memory file passed all 8 tests.
- R1–R4 logs and source pins are retained here to preserve the diagnosis trail. All logs contain test output only.
