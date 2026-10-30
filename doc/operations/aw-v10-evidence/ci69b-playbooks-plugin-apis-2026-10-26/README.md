# CI69 playbooks and plugin API fixture repairs

The final fresh-source qualification run is `ci69b-playbooks-plugin-apis-r6-20261026`.
It copied the current source into `/workspace/v10-dep-qualification`, passed the
snapshot syntax check, and ran both assigned Vitest files with one worker:

```text
src/__tests__/playbooks-project-control-v5.test.ts
src/__tests__/plugin-orchestration-apis.test.ts
```

Result: **2 test files passed, 43 tests passed**. The exact snapshot pins,
runner logs, and exit codes are archived alongside this note. The pinned source
head is `1a2593757100e1b06ef01acf78fd03c51a8e8350`.

The Playbooks fixture now creates its Project through the canonical Human
session route and creates its Task through `issueService` with that current
Human actor. This Project-linked, in-progress Task with a forecast reason is
outside the direct root manual-input producer, so the test asserts it has no
payload-source snapshot instead of manufacturing a snapshot in SQL. Its
reviewed roadmap, baseline, forecast separation, and forecast-risk assertions
remain intact.

The plugin operation fixture now uses a ready managed-plugin manifest and a
canonical Human Project, reconciles the managed resources, and runs the
Routine through `routineService` with the current Human source actor. It checks
the actual linked operation Task and retains a negative case proving that an
unbound plugin operation origin is rejected without inserting a Task. Cleanup
also removes the Routine rows and Human grants created by these fixtures.

Final fixture source hashes:

```text
playbooks-project-control-v5.test.ts  d131d2f694ddb5358fa54531f711d53ae2457ce6623c8c4040ba559ec43c1b82
plugin-orchestration-apis.test.ts      eb5753ab360b99bb7bd3da36b5e6d308f8024b0a93730257a5bc9c8066ae66c7
```
