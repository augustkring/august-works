# Bounded native process calculation kernel

This source slice implements six native analysis families: event volume,
directly-follows paths, full-sequence variants, first-completion cycle time,
observed blocked intervals and observed terminal-to-nonterminal reopening.
It is an internal calculation kernel, not an independently authorized API or a
complete Process Intelligence release.

Definitions declare the native object perspectives, activities, provider coverage,
period, purpose, retention, owner and review interval. Family-specific ordering
and lifecycle requirements are derived internally. A relaxed readiness preview
cannot grant a stronger analysis: company, requirement hash, exact event-set hash,
current readiness expiry and event count must match. Source authorization remains
the native event owner's responsibility.

Recorded multi-object links contribute separate paths. A related Project cannot
borrow a Task's primary lifecycle. Ordering uses exact UTC microseconds and never
UUID order. First completion since recorded creation defines cycle time; later
reopening is a separate observed count. Cancellation is a competing outcome and
does not fabricate completion duration. Empty completed-cycle samples return null;
genuine zero-duration completion returns zero. Median/p90 use linear interpolation
over observed first-completion samples. Status-free metadata updates do not invent
transitions or shorten blocked intervals. Volume-only analyses publish no lifecycle
counts. No causal or person effect is estimated.

The kernel admits at most 2,000 events. It abstains for paths longer than 512
activities when variants/DFG are requested, over 500 edges or over 100 variants per
object perspective. Event volume can exceed the path display bound within the
event input bound. Missing creation/terminal facts, ambiguous ordering, required
arrival evidence or unqualified external coverage produce DATA_NOT_READY.

Nine calculation/readiness tests pass, including known durations, blocked time,
reopening, cancellation, zero/null, reversed input, multi-object paths, changed or
expired readiness, cross-company inputs and result bounds. Native definitions,
publication receipts, persisted runs and lineage/erasure, API/UI, conformance,
finding lifecycle and hosted qualification remain separate open work.
