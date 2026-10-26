# Native read-source wait regressions — 2026-10-26

The current-source server syntax preflight and TypeScript check passed (`scope-read-current-server-*`, exit 0). The focused PostgreSQL test run `scope-source-wait-tests-r4-20261026` passed both selected regressions:

- The same-conversation attachment reader rejects after the bound Native Run is withdrawn during storage retrieval, before staging bytes.
- The Fabric Playbook reader stays blocked behind the original Run row lock; after that Run is withdrawn and its responsible Human binding is cleared, the read rejects and stores no procedure-delivery observation.

Earlier raw attempts are retained separately. `scope-source-wait-tests-20261026` exposed a missing wait assertion; `r2` exposed an unprepared execution-manifest fixture; `r3` reached the withdrawal path but had an assertion bug when `runnerProfileJson` was null. The final test setup prepares the manifest and handles a null profile without changing product behavior.

These two checks cover source/session withdrawal while an owner read waits. They do not establish the separate provider read-result receipt chain; that managed-provider integration remains with its source owners.

The evidence includes the exact source pin manifests, snapshot/syntax outputs, Vitest logs and exits, and TypeScript output. The verification commands used the pinned dependency workspace, a source snapshot taken under `/workspace/v10-preparation/v10-pg-tests.lock`, and `vitest run --config vitest.config.ts` with `--maxWorkers=1`.
