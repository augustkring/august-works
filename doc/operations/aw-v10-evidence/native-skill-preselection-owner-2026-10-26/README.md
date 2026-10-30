# Native Skill preselection owner regression (2026-10-26)

The focused V7 learning integration test passed with one executed test and 41 intentionally skipped tests. The fresh dependency-qualified snapshot, source syntax preflight, Vitest run, and wrapper all exited 0.

The test uses the actual V5 manifest/Skill lifecycle owner fixture. It proves that the exact current, company-visible Skill version named by the run manifest remains readable during the unresolved Native preparation window. It then resolves that same fixture run as legacy and asserts the entry is unavailable. Existing assertions in the selected test continue to check private-version denial and access denial for a different/unretained run. This test does not claim provider execution or Skill evaluation.

After this run, the unresolved-mode predicate was tightened to accept only `runtime_mode IS NULL` or unresolved `legacy` for a `paperclip_runner`; resolved legacy and other modes continue through the Native-only validator. The archived passing run predates that final predicate hash, so rerun the same focused test against a fresh snapshot before treating it as validation of the final source.

The test file is `server/src/__tests__/v7-learning.integration.test.ts`; selected test: `uses the native Skill challenger lifecycle and still requires native Skill evaluation for promotion`.
