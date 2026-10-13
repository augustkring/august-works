# V9 feedback local draft and Original request recovery

Full V9 remains incomplete. This checkpoint qualifies the feedback draft and
request-recovery behavior below, not all feedback closure, hosted storage,
human usability or GA. The V9 readiness record stays at R0/sourceComplete false.

## Customer behavior and native ownership

Temporary close preserves the current local text/category. Explicit Discard
clears only an unsent or definitely rejected draft; it makes no server deletion,
submission or image upload. An in-flight or unknown request cannot be discarded,
even when a caller changes the disabled DOM button before React updates it.
The footer wraps on narrow screens and keeps the primary action on the right.

A current canonical receipt clears the local category, text, choices and selected
preview URLs immediately. Stale/unknown acknowledgement does not clear them.
The canonical receipt and history remain available. Unconfirmed image outcomes
still require Original protected status/cleanup; this release of local previews
neither repeats a PUT nor proves remote settlement.

Check if received resolves the exact Original company/principal/request slot.
The route returns private/no-store data, repeats Native admission/ownership, and
locks the case before its retained access row in the parent-first erasure order.
It performs no feedback, image or activity write and consumes no submission
attempt. New-work flag rollback preserves this read. A foreign principal's slot
is not exposed; stale membership, wrong tenant and swapped expected account are
refused. A missing observation can precede a late commit and is never rejection
or quiescence proof. The UI retains the frozen key/body and offers another read
or explicit retry of that same submission. A later definite refusal cannot
release an earlier unknown request.

Recovery never sends automatically. A pending read fences parallel submit;
late responses after an account change remain concealed. A recovered receipt
uses the same original-ID reread on later Source checks as a directly returned
receipt. The existing Native feedback access/request owner remains authoritative;
no new persistence plane, model call, telemetry dataset or privacy claim is added.

## Verification

- Final actual PostgreSQL feedback and retention-erasure suites: 37 cases in two
  files pass, including current slot ownership, absence, rollback reads and no
  extra effect/activity. The new namespace is covered by content-free logging.
- Current UI/API/selection suites: 33 cases in three files pass. English/Danish
  local discard, preview URL release at canonical acceptance, immutable retry
  after unknown-then-400, forced discard refusal and late account withdrawal
  are exercised. The broader private HTTP/UI run passed 76 cases before the
  final customer wording change; its unchanged privacy tests remain recorded.
- All three freshly built experience browser cases pass. They exercise keyboard
  discard, temporary-close preservation, narrow layout, missing-receipt lookup,
  existing workflow review/rollback, and a real committed Native POST whose
  acknowledgement is deliberately lost. Read-only recovery finds the same
  canonical ID with exactly one POST and one history row.
- Changed shared/server/UI types, token gates, module boundaries and the V9
  coverage inventory check pass. The inventory still reports seventy pending
  implementation/evidence surfaces; it is not release acceptance.

The earlier account/runtime/pilot publication e22b0e84befd8a61207e399e335313dd7882fc96
completed all remote CI checks: 70 success, 3 configured skips, 0 failures.
That is historical evidence for its tree, not current integrated qualification.
The final full V9 still requires repository-wide checks, current CI, review and
its remaining implementation. Reference: brief §85.13–85.15; construction,
verification, security, privacy and UX playbooks; Original feedback/erasure owners.
