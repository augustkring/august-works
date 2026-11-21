# Managed model deadlines and cancellation

Managed Messages previously armed a 30-second timer before source admission and kept it armed after a complete provider response. The transport now owns a separate 30-second network deadline. The gateway retains the original reservation/capability expiry, current-authority watch and caller cancellation through settlement and final checks. Both gateway paths recheck cancellation after the awaited authority read.

The exact four-file HEAD-based component passed 21 transport tests, one real PostgreSQL cancellation regression (70 unrelated cases excluded), source parsing and the full server typecheck. The old-source negative control returned the response after cancellation and failed the new assertion. The fixed path withholds it, retains completed known usage and pauses the plan.

`publication.json` distinguishes staged component hashes from the working tree: the existing unrelated Project receipt changes remain dirty and preserved. `qualification.tar.gz` includes source/dependency snapshot pins, raw logs and the negative control. This is scoped component evidence against a separately pinned worktree/dependency snapshot; the complete Native/Relay journeys, final unchanged-head aggregate and release qualification remain open. No live paid-provider call, merge or deployment was performed.
