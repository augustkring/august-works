# Native Memory Gateway replay evidence (2026-10-26)

The pinned replay regression exercises the real managed OpenCode route and Gateway call. The first matching replay succeeds; the Human accepts and canonically revokes the output; replay of the same exact call is denied while the original invocation remains singular. The test also verifies the consumed Task/dispatch prefix remains current across output revocation.

`replay-r10-*` is the successful run. The qualified OpenCode binary SHA is recorded beside its source pins. Snapshot and syntax preflights both exited 0. Vitest executed one test: 1 passed, 3 skipped.

`replay-r8-*` preserves the preceding diagnostic failure and its exact source pins. Vitest actually executed one test and failed at matching replay because the replay validator required the producer Task in `sourceIssueIds`, although the canonical output snapshot carried that exact Task as an input. The wrapper's final exit was 79 because its summary parser misread the nonzero run; the raw Vitest exit is 1 and `executed.count` is 1. This was not an all-skipped result.

The production fix checks the sealed snapshot for the exact current Task tuple and retains run, invocation, result, owner hash, output visibility, and current consumed-source checks. The test-only diagnostic logging used to identify the failed predicate was removed after the successful run; that cleanup did not change the validated predicate. The exact successful source pins remain the source as executed before that logging-only cleanup.


The full current `server/src/__tests__/tool-gateway.test.ts` suite also passed after the replay fix: 74 executed, 74 passed, with fresh source and syntax checks at 0. Its exact logs and source pins are in `gateway52-*`. This is broader than the earlier 52-test Gateway regression captured in previous evidence.
