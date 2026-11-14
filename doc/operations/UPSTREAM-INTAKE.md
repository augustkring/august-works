# Upstream intake and provenance

The pinned V10 source of truth is [Master Build Brief §7](../reference/blentera-v10/Blentera_Master_Build_Brief_V10_FINAL_v4.0_2026-10-18.md#7-fork-and-upstream-integration). The bounded automation is `scripts/upstream-intake.mjs`; its source decisions are in [upstream-intake.json](upstream-intake.json), and implementation/test/release evidence remains in the existing [integration register](../plans/2026-10-18-blentera-v10-upstream-integration.md) and native release pipeline.

The intake ledger pins Paperclip `5623304586c04092d2a44c25b3850301a909989d` and fork baseline `81d3445b98b1cd80ff400ede6bd44ea71d88d735`. It contains all 86 unique PR/full-SHA source records referenced by package and incremental dispositions in §§7.3–7.20, including the 51 incremental commits in §§7.17 and 7.19 and the residual candidates in §7.20. Each row has the source SHA, PR, package, classification, decision, and pinned source/spec references. Repeated source records retain all applicable spec refs. `decision_recorded` means the brief has a binding selection/disposition; it does not imply implementation admission. `security_fast_path` means a P0 security review is still required. `sourceRead.reviewedRefs` is deliberately empty for imported decisions; a permalink and a disposition in the brief are not proof that an implementation reviewer read source code.

Run the structural check with:

```sh
node scripts/upstream-intake.mjs validate
node --test scripts/upstream-intake.test.mjs
```

To generate the bounded tree inventory, provide GitHub's recursive tree response for the exact pinned commit (it must be complete and must report that same SHA). The report compares exact file path, mode, and blob SHA for the fork baseline against the pinned upstream and the current fork commit:

```sh
node scripts/upstream-intake.mjs inventory \
  --base 81d3445b98b1cd80ff400ede6bd44ea71d88d735 \
  --upstream 5623304586c04092d2a44c25b3850301a909989d \
  --tree /path/to/pinned-recursive-tree.json \
  --commit /path/to/pinned-commit.json \
  --out doc/operations/aw-v10-evidence/upstream-intake-YYYY-MM-DD/inventory.json
```

The command refuses a moving or different upstream ref. It never fetches or merges source code. A tree entry proves a path and Git object ID only; if the source blob is absent from the local object database, the report counts it as unavailable and does not imply the file was read. Tree comparison is a structural inventory, not semantic review, a migration comparison, regression evidence, or runtime qualification. Preserve any fetched tree response outside the repository; only the bounded report belongs in the evidence directory.

The captured report for this pin is [inventory.json](aw-v10-evidence/upstream-intake-2026-10-28/inventory.json), with report SHA-256 in the ledger. It contains 10,713 upstream blobs and compares 3,071 added, 2,770 removed, and 2,256 changed paths against the fork baseline; the separately labeled current fork-head comparison is also included. Of the upstream blobs, 5,143 object bodies were not present in the local Git object store, so their byte content remains unavailable in this evidence. The report preserves their SHA/path metadata and does not claim a semantic review.

Every newly considered source change must be added with a full immutable source SHA and classified as `SECURITY / VULNERABILITY`, `BUG / CORRECTNESS`, `DEPENDENCY / BUILD`, `PROTOCOL / COMPATIBILITY`, `UX / ACCESSIBILITY`, `FEATURE`, `ARCHITECTURE`, or `BRAND / COMMUNITY`. Security findings enter `P0` `security_fast_path` review, even if the feature is rejected. Admission requires an owner, actual reviewed source refs, invariant impact, affected regression names and receipts, a provenance reference, and the exact fork implementation commit. The validator rejects an admitted record without this evidence. Keep original source attribution and distinguish adapted behavior from a cherry-pick; never label a port as a merge.

No workflow merges upstream automatically. Review the exact source and its dependency closure, determine the effect on existing Blentera owners and invariants, implement the smallest compatible change, execute the affected Blentera regressions, and record the exact fork commit and evidence. Releases continue to bind to the repository's existing exact source SHA and artifact provenance; this intake ledger neither publishes artifacts nor grants release approval. No security, correctness, or release claim follows from the inventory alone.
