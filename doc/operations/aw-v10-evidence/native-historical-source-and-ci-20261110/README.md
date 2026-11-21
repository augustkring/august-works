# Historical Native sources and CI prerequisites — 2026-11-10

Historical current-source validation now reconstructs the exact succeeded Native Text receiver and original wake/comment/action/reservation/Stop records. A later comment or change of the responsible Human does not replace those original source records. The reader still needs current authorization. Initial continuation admission retains the running receiver, current assignment and latest Human comment requirements.

The AW V4 workflow now builds the Runner binary and provider pack once, retaining a source-bound run-attempt artifact. Server partitions verify the archive, source revision, pinned OpenCode 1.18.32 executable and pinned OpenShell prover before using the fixture paths. Permissions and event scope remain unchanged. The lockfile is checked after installation and packaging. This corrects a missing prerequisite in AW V4 only; other workflows' failures remain separate.

## Recorded software checks

- r130: actual unknown-charge explicit Human continuation passes; the test revalidates the complete completed source set after success, after a later Human comment, and after changing the responsible Human while the original authorized reader remains. One test passes, 29 are skipped. No unknown charge is changed to known.
- r131: current Runner TypeScript build passes in 4.59 seconds, and the provider pack rebuild passes in 9.74 seconds. The retained manifest records Runner source revision c777b1b8f4966e4eef63997e7042636677a3f7c7 and exact distribution/artifact hashes. No subsequent complete SDK qualification is implied.
- r132: full server TypeScript passes in 101.91 seconds with unchanged recorded source pins, no OOM and no resource stop.
- Workflow YAML unique-key parsing and shell syntax pass for all 38 run steps. GitHub Actions execution is still required.

The archive retains separate source windows, commands, resource observations and cleanup receipts. The initial r129 test failed because an additional receiver query checked Native columns before initial capture had populated them; these completed-receiver checks now apply only to historical reads. r130 is the corrected subsequent run.

Native review cancellation, the complete SDK attachment/conformance pipeline, full erasure/privacy and remaining CI/browser checks are open. Controlled software Host fixtures do not qualify physical enforcement. The real runtime Docker check remains separate. No historical migration phase, release, merge or deployment status is promoted. PR 42 remains a draft.
