# Contain asynchronous Native quarantine diagnostics

Status: implemented. All 138 Native session-runtime cases, the ten-case actual
chat-project-tools suite and Runner typecheck pass. Complete current-source
qualification remains pending.

The frozen checkpoint-69 general shard 0 ends with 6,606 passing cases and 68
skips (456 passing suites, four skipped), but exits 1 because of two unhandled
rejections. Both originate from chat-project-tools after fixture database
closure. The stack reaches the existing Native quarantine observer through
heartbeat onLog and its unchanged current-source payload authorizer.

The observer explicitly permits Promise<void>. The runtime catches synchronous
throws but discards a returned promise. An async diagnostic failure therefore
escapes as an unhandled rejection. This is a runtime callback defect, not a
reason to suppress Vitest's unhandled-error gate or weaken the payload guard.

Attach a rejection handler to that observer result. Do not await the observer:
a stalled diagnostic must not delay required provider cleanup. Keep the existing
synchronous observer policy. The original execution failure, quarantine state,
provider close contract, retention/recovery bounds and current onLog authority
remain unchanged. No raw diagnostic payload is copied into another log sink.

The existing cleanup regression now covers a plain observer that throws,
rejects asynchronously or never settles. It retains the original exact snapshot
failure, owner null notification and one provider close. The plain async
pre-fix case fails the run with one unhandled rejection after a macrotask turn.
The initial mocked observer attached its own rejection listener and hid that
signal; its result is not the defect reproduction. The plain callback is used
in the final regression. After the patch the full runtime file passes all 138
cases without skips or unhandled errors (4.83 seconds).

The actual migrated chat-project-tools fixture then passes all ten cases with
exit 0 and no unhandled errors (41.68 seconds). Its real routes, task/plan
transactions, current actor, mode restrictions and cancelled-run refusals remain
intact. Runner typecheck passes, including its existing Rust/protocol checks.
All 36 workspace projects and 76 workspace dependency links resolve within this
worktree; none resolves into another candidate.

Guidance: the V9 inherited Native authority lock and the supplied reliability,
construction, verification, security and privacy playbooks. The correction
handles only a diagnostic observer failure; it grants no execution, cancellation,
provider cleanup, logging or erasure authority. Whole V9, the 70 launch rows,
source completeness and R0 remain open. No PR/push or provider qualification.
