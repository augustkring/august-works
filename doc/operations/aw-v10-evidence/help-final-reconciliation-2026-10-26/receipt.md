# Help final reconciliation evidence

The stdout transcripts below were retained from the completed commands; exit files record the observed successful status. Current input hashes and checked-out commit are in `source-pins.json`.

| Check | Command | Exit |
| --- | --- | --- |
| Help document metadata, navigation, registry and links | `flock /workspace/v10-preparation/v10-pg-tests.lock node scripts/check-help-docs.mjs` | 0 |
| Regenerate bilingual Help search catalog | `flock /workspace/v10-preparation/v10-pg-tests.lock node server/scripts/generate-company-search-help.mjs` | 0 |
| Check regenerated catalog freshness | `flock /workspace/v10-preparation/v10-pg-tests.lock node server/scripts/generate-company-search-help.mjs --check` | 0 |
| Help documentation and change-review tests | `flock /workspace/v10-preparation/v10-pg-tests.lock node --test scripts/check-help-docs.test.mjs scripts/check-help-change-review.test.mjs` | 0; 14 passed |
| Current full article/source hash validation | Local `validateHelpChangeReview` against working-tree bytes | 0; 28 articles |
| Whitespace check for changed Help files/catalog | `git diff --check -- docs/help/export-and-delete.md docs/da/help/export-and-delete.md docs/help/change-review.json server/src/services/company-search-help.generated.ts` | 0 |

`check-help-change-review --base ... --head ...` is intentionally pending the checkpoint commit. That command reads source and article blobs from `HEAD`, so its final diff-based result cannot validate these uncommitted Help bytes.

The committed diff-based source review passed exit0 at full head5922901f20f0b9a2e79ae7d218c5d7121d3bf189 against original master81d3445b98b1cd80ff400ede6bd44ea71d88d735. The JSON retains exact linked-source/article digests and decisions. An earlier invocation used an invalid revision and did not run validation; that failed invocation remains in the preparation directory.
