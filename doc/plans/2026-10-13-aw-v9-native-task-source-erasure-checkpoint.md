# Native task source inheritance and physical erasure

Two actual PostgreSQL regressions reproduced missing source closure: an
Original Native-created task remained readable after its originating run was
marked erased, and the Original Memory erasure owner retained its title,
description and plan. Both paths now follow the actual Native origin.

Migration `0488_exotic_sentinels` adds a company/origin-run index and preserves
the complete existing direct Workflow/Artifact/Memory predicate as a separate
direct check. The same original public predicate additionally follows up to
sixteen Native task origins. Exact company, Agent, run type and originating-task
references must agree. Missing/malformed origins, foreign runs, cycles and
over-budget chains are withheld. Guarded UUID conversion keeps the originating
run lookup on its primary key and cannot cast an untrusted origin into an SQL
error. The ancestry contains IDs only and survives erasure of receipt bodies.

The current-reader service also reauthorizes each actual ancestor through the
existing analytical owner, then checks the origin set and erasure again. A
hidden analytical input withdraws the descendant payload even without a Memory
deletion marker. Native mutations recheck source authority under their existing
transaction and before saving/replaying a receipt. Current analytical review
acquires its company boundary before Memory, followed by plan/Task/run locks;
the conversation projection uses that same order. A late source-erasure trigger
rolls back the actual task insertion and mutation rather than returning a
successful receipt.

The Original physical erasure owner includes Native-created tasks as well as
workflow tasks. Existing cleanup scrubs their text, linked plans/documents,
comments, work products and associated outputs. Descendant Native runs inherit
the same predicate. The existing payload trigger now checks every NEW Native
task binding before its run row exists. Unrelated tasks retain their content.

## Evidence and limits

The final Native/Original source and migration-snapshot suite passed 73 cases;
the complete existing analytical privacy suite passed 53 cases. After aligning
the lock order, the five affected Native/conversation suites passed 72 cases.
Cases cover actual two-level Native creation, ordinary reads, physical plan/text
erasure, current analytical-source withdrawal, invalid origins, the valid
sixteen-link boundary, rejected seventeenth link, NEW run payload scrubbing and
late mutation rollback. The over-budget graph is an explicit database fixture,
not runtime or model qualification. Migration numbering/safety, token, module,
source coverage and diff gates pass. The generated snapshot was produced by the
repository generator; previously tracked snapshots were retained.
Final server typecheck and database build passed with the source and lock-order
changes applied.

This checkpoint is an implementation/verification slice. It does not qualify
managed model transport, other conversation authoring targets, broad capability
or delegation mappings, remote feedback transport quiescence, independent
restore horizons, human usability, GA or full V9 completion. References: supplied
privacy, security, database, backend, distributed systems, reliability and
verification playbooks. Apply the migration before deploying the updated owner.
