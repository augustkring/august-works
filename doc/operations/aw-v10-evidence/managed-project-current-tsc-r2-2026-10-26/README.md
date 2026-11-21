# Managed Project current source TypeScript check, retry 2

Fresh source snapshot and syntax preflight both exited 0. The bounded server TypeScript command was:

```sh
../node_modules/.bin/tsc --noEmit --singleThreaded -p tsconfig.json
```

It completed with exit 1 and 11 diagnostics. The diagnostics are preserved in `scope-managed-project-current-tsc-r2-20261026-tsc.log`; they cover the managed fixture and Project service/test edits that were in the shared source snapshot. Two Project-owner diagnostics in `native-project-output.ts` and `native-model-input-dispatch.integration.test.ts` have since been fixed in the working tree. History and Binary own the remaining fixture diagnostics. This run is not a passing typecheck; rerun after those fixes are stable.
