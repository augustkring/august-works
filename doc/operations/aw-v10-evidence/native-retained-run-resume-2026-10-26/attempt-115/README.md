# Concurrent first-send witness attempt 115

Fresh source snapshot, syntax, socket/DB cleanup, and exact one-test Playwright listing all passed. The unchanged concurrent-first-send browser test executed once and failed the existing 60-second idle predicate (exit 1), leaving one visible agent reply and a live run. No pass is claimed.

This snapshot includes the bounded run-reader diagnostic. Both actual in-transaction denials report a valid persisted run binding, actor owns the source run, and actor is reading its own run; however, the source and actor run status are already succeeded, so principal-currentness is false. The diagnostic has no matching active temporal scope, zero retained Context roots, and is not a DB identity mismatch. The providers both successfully read task context/history and emitted final item and turn-completed events. The post-timeout cancelled-run denials are consequences, not the initial cause. No authorization predicate was changed.

Preserved: exact source pins, raw test log and actual exit, all preflight logs/exits, provider event trace, Playwright error context, screenshot, trace, and SHA256 checksums.
