# Drain model authority watches before returning output

Both model transports now stop and await the in-flight periodic authority check before the final mandatory check and reply. Error cleanup also awaits it. A denied watch still cancels the response; all periodic/final checks and financial settlement rules remain. This prevents a completed request from leaving source-reader locks behind.

Three focused real gateway regressions passed: normal completion, Human membership revocation, and provider failure with truthful reservation state. The subsequent Native nine-case fixture still exceeded its separate source-work bound. No full Native, workspace or TypeScript pass is claimed.

qualification.tar.gz preserves the exact source snapshot, reconstruction patch, logs and minimal staged diffs. Only the watch-lifecycle hunks are staged from the gateway; earlier Native/Project work in that file remains a separate pending closure.
