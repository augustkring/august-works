# Chat channel publication authorization

The removed-wake FIFO notice fix keeps ordinary source deletion denied. A soft-deleted comment is tolerated only after the exact `removed` wake receipt and previously published queue notice pass authorization; linked-author and private-task checks still run.

- `fifo-072`: isolated removed FIFO notice regression passed 1/1.
- `focused-073`: targeted composer, publication, attachment, reaction, FIFO, and large-comment selection passed 12/12.
- `stable-shards-075`: all 1,051 chat integration tests passed across the repository's three exact-coverage shards.
- `full-file-074-incomplete-timeout`: a separate unsharded run reached its 600-second harness cap without a Vitest completion summary. It is recorded as incomplete, not as a product failure or a pass.

The integrated server TSC r20 passed before the FIFO authorization change; the shared current TSC lane is responsible for its fresh compiler validation.
