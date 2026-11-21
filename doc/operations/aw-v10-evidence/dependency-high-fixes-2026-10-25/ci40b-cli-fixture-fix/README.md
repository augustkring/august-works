# CLI fixture typecheck

The two edited CLI test files now provide the required `Company.locale` and `Company.timezone` values. The three portability manifest fixtures use `en` and `UTC`; production types and backward-compatible import defaults were not changed.

Validation ran in `/workspace/v10-dep-qualification` under `/workspace/v10-preparation/v10-pg-tests.lock` using the pinned wrapper `/workspace/v10-preparation/pnpm-9`:

```text
pnpm-9 --filter paperclipai typecheck
exit: 0
Node: v24.19.0
pnpm: 9.15.4
TypeScript: 7.0.2
```

`cli-typecheck.log` and `cli-typecheck.exit` contain the raw output and numeric result. `sourcepins.txt` records the source commits and matching SHA-256 values for both fixture files.

`invalid-command-attempt.log` is retained only to explain the first malformed shell invocation; it did not run the CLI typecheck and is not validation evidence.
