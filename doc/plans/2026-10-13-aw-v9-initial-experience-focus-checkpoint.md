# Preserve an in-progress keyboard gesture at first experience render

The shared experience heading hook previously focused H1 when an asynchronous
first projection completed. A real browser probe reproduced Feedback losing
focus immediately before Enter: Enter reached H1, so no dialog opened. The
feedback event listener did not lose a dispatched opening signal. Probe records
contained only node identities, event types/times and dialog/control presence;
temporary instrumentation has been removed from the browser fixture.

Initial heading focus now runs before paint and preserves an already focused
interactive control or dialog. It still orients an otherwise idle page on entry
and recovery. This fixes Home and the other experience pages that share the
hook without weakening private source withdrawal or retrying a native action.
Partial dependency descriptions also use English/Danish customer labels instead
of internal domain identifiers.

Verification: the new keyboard regression fails against the original hook and
passes after the fix. All 67 cases in five affected UI suites pass. Fifteen built
browser cases pass with five repetitions: deliberately late Home projections in
English/Danish and the existing image feedback unknown-reply/account-withdrawal
journey. This corrects the observed shard-8 failure on published commit
346226824f5180c2bdf50997b2621e0551770e83; that remote failure remains historical
failed evidence. An intermediate browser attempt used the wrong Danish region
label; it was corrected and is not counted as passing qualification.

Full V9, full integrated checks, current CI, manual assistive technology and human
usability acceptance remain open. Reference: V9 global focus/keyboard and feedback
contracts; verification, UI, UX and accessibility playbooks.

Changed UI/server types, token gates and module boundaries pass on this slice.
