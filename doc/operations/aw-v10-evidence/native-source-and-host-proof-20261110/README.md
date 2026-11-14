# Native source transitions and Host policy proof — 2026-11-10

This packet records separate controlled source windows. Its archive contains exact source hashes, command and resource receipts, and cleanup records. It does not combine these windows into an end-to-end qualification.

| Window | Result | Scope |
| --- | --- | --- |
| r104 | 78 passed | Complete Native Text gateway integration file, including input acknowledgement ordering |
| r108 | 18 passed | Complete manual upload integration file, exact first-comment binding and migration 0573 |
| r111 | 29 passed | Native execution input hashes and bounded attachment display descriptors |
| r113 | 1 passed, 29 skipped | Real unknown-charge cancellation followed by explicit Human continuation; original charge stays unknown |
| r120 | 1 passed, 53 skipped | Signed Host proof calls use distinct command nonces and reject changed admission state |
| r128 | 84 passed, 1 skipped | Complete Node Host suite after the read-only bootstrap bind correction |
| r127 | See receipt | Full server typecheck against the recorded current source |

## Resulting behavior

The first Human comment binds the complete current upload set atomically, retaining original upload/audit ownership. Migration 0573 adds only a narrowly checked source-history transition; it never resets invalidation or promotes legacy input. Snapshots 0572 and 0573 were produced with the actual Drizzle schema generator with no model delta.

An interrupted Native Text charge remains unknown. Explicit Human continuation captures its exact resolved action, original stopped Run, reservation and wire ownership, and starts a fresh session after current authorization. The original unknown result does not become continuation context. Dispatch waits for the durable input acknowledgement.

Connected knowledge retains the original authorization actor in server-only state and independently rechecks current provider access. Attachment preparation defers source closure only until exact staging completes and aborts before execution if the final closure is absent.

Protected Host policy proof uses signed current stopped-binding ownership, unique compilation and preparation records, fresh command nonces, and exact candidate/effective document hashes. The Host snapshots stopped-container paths into bounded private scratch, checks daemon identity and snapshot mounts, and invokes the pinned actual prover inside an isolated helper. The qualified runtime bootstrap is staged as an exact mode-0555 read-only bind; Docker rejects copying it into a read-only root filesystem.

The r125 typecheck found two call-site errors from the same inferred UUID default parameter. The parameter is now explicitly typed as the existing string contract; r127 is the subsequent full check. The newest 0573 migration snapshot drift test also passes (r126, one test).

## Open qualification boundaries

The Docker-gated actual runtime test was skipped in r128. Local Docker uses vfs, whereas production proof requires qualified overlay storage and quota support. Isolated pinned-prover execution and a read-only executable bind were exercised separately; they do not establish full Host or physical enforcement qualification.

The current complete SDK attachment/conformance pipeline is not passing. The last r121 attempt reached the new Host proof request and exposed a request-key ordering defect, now covered by r128. The old provider pack predates the latest Runner acknowledgement hook and must be rebuilt before current-pack qualification. Historical completed-source stability and Native review cancellation remain under investigation. Other CI integration/browser failures remain open. This checkpoint is not release approval or a PR-ready declaration; PR 42 remains a draft and must not be merged on the strength of this packet.
