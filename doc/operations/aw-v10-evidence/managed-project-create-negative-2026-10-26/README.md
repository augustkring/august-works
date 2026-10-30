# Managed Project create capture negative

This focused PostgreSQL run exercised only `creates no Project effects for malformed or foreign managed Project captures` in `server/src/services/native-runtime/native-model-input-dispatch.integration.test.ts`.

The test used the suite's embedded PostgreSQL fixture and checked that malformed and foreign settled tool-use captures produce no Project, workspace, activity, or run-receipt changes. Vitest reported 1 passed and 44 skipped; no other test from that file ran. This is negative capture coverage only: it does not qualify the managed provider Project-create positive path or source-withdrawal behavior.

The locked qualification snapshot is recorded in `scope-project-capture-negative-20261026-source-pins.json`. Syntax snapshot check exited 0. The focused Vitest command was:

```sh
node_modules/.bin/vitest run src/services/native-runtime/native-model-input-dispatch.integration.test.ts \
  -t "creates no Project effects for malformed or foreign managed Project captures" --maxWorkers=1
```

The evidence was captured before the managed Project-create provider-wire test and before a current server TypeScript check.
