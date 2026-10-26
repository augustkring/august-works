# Native Task source status/body regression

The focused PostgreSQL test passed on 2026-10-26 using a fresh qualification-worktree snapshot. It creates an original Human-authored Task with the canonical Human actor, captures its Task source, changes only operational status through `issueService.update`, and confirms the old source remains current. It then edits the Task title through `issueService.update`, confirms the owner snapshot is invalidated, and confirms the previously captured source is denied.

The passing run is `r11`: Vitest reported 1 passed and 9 skipped. The copied source pins record the qualification base commit, source head, and exact source hashes; the tested `context-engine-integration.test.ts` SHA-256 is `21708b7e6a13cd614f474de7ab21754d13712540418e827b183d4263b23c333b`. The command was:

```sh
../node_modules/.bin/vitest run src/services/context/context-engine-integration.test.ts \
  -t "preserves an original Human Task source across status changes and rejects it after a canonical body edit" \
  --maxWorkers=1
```

The raw cleanup, snapshot, syntax, test, and exit files for `r8` through `r11` are retained here. `r8` and `r9` ran the larger Context test and reached the status/body assertions, then failed later in its unrelated Context-read witness setup. `r10` stopped at fixture setup because its in-progress Task lacked an assignee. `r11` fixes that fixture and is the accepted focused result.
