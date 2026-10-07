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
expired readiness, cross-company inputs and result bounds. Operator UI,
conformance, finding lifecycle and hosted qualification remain
separate open work.

## Native publication and retained runs

The default-off `/api/companies/:companyId/process-definitions` owner now stores
immutable definition versions, separate human publication receipts and bounded
synchronous runs. Definition writes use existing human permission management;
running/reading uses current native company authority. The public run request
accepts only a published version and UTC period, not supplied events/readiness.
Revisions stay proposed until separate publication with expected revision.
Retirement remains available after rollout rollback.

One native inspection captures both current authorized events and their readiness.
The database shares existing source rows and reinspects source identities after
event authorization: a backdated insert during inspection cannot qualify a subset.
Windows retain PostgreSQL microseconds. Every run retains a native analytical
lineage manifest, event source hashes, recorded object links, current privacy
ancestry and purpose pins. Database admission requires matching publication,
definition/input hashes, window, engine, lineage owner and expiry. Run/version/
publication updates are forbidden.

Retained reads reauthorize the current definition owner and purpose, all native
events and all retained lineage object sources, including ancestry that is not a
historical event link. Missing lineage edges, hidden/erased sources, changed input
or unknown current coverage for a formerly successful run deny its payload.
`authorizationCheckedAt` is separate from historical `createdAt`/readiness time;
historical readiness is never a new grant. No-store HTTP/client reads also bind an
optional current account identity.

Native Memory deletion and verified restore-ledger replay delete the manifest and
cascade the run payload. They acquire no company lock from a Memory-only callback.
Existing analytical expiry and a native process-definition retention sweep operate
with flags off and paused companies; expired definition histories remove their
lineage/runs without deleting canonical Tasks/Projects.

The combined native event, process/readiness, calculation and OpenAPI selection
passes 56 tests. Ten process PostgreSQL cases additionally cover current policy
supersession, human publication/CAS, immutable receipts/results, unknown coverage,
exact windows, source and lineage drift, retention, a reader waiting for Memory,
backdated arrival during object authorization and replay into a separate migrated
quarantine database. This copied-row restore proof does not qualify backup archive
or hosted recovery. The generated 0393 snapshot matches the Drizzle schema. Direct
server/UI TypeScript checks pass; full monorepo/release checks remain open.
