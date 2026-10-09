# Bounded native process calculation kernel

This source slice implements seven native analysis families: event volume,
directly-follows paths, full-sequence variants, first-completion cycle time,
observed blocked intervals, observed terminal-to-nonterminal reopening and
explicit typed process conformance (see `aw-v8-process-conformance.md`).
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
expired readiness, cross-company inputs and result bounds. Explicit conformance
and human finding lifecycle have subsequent source slices; additional conformance
targets, finding conversions and hosted qualification remain open work.

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

## Human inspection and proposal interface

The native default-off Process Intelligence page and sidebar entry now expose
definition proposals, separate publication with a human rationale, retirement,
bounded UTC-day analysis and retained run inspection. Forms choose existing
company owners and current process-purpose evidence; they do not ask operators
to supply readiness grants or raw events. Seven analysis families and sixteen
readiness dimensions have explicit labels and meanings. Null samples remain
different from zero. Ordered variants and directly-follows relationships use
accessible text/tables. Source/hash detail and historical calculation time are
separate from the current access check.

Run history scans at most six candidates per five-run page and reauthorizes every
returned payload. A denied run is omitted, not disclosed as an old cached result.
The page keys all queries by company and current account, hides evidence while
refreshing or after failed access checks, and removes payload at its retention
expiry. Native issue/project, governance, membership and Memory/Learning changes
invalidate only the relevant company's process cache.

Sixty-five UI/cache tests and twenty Chromium scenarios pass. The browser matrix
covers published, draft, review-required and inconclusive states plus proposal
forms at 390/1200 pixels, light/dark, keyboard disclosure controls and WCAG A/AA
axe checks. Proposal and mobile result screenshots were visually inspected.
Storybook fixtures explicitly contain synthetic source pins and do not qualify
live providers or hosted rollout. An optional `StatusBadge.className` uses the
existing foreground token for this page's neutral draft/retired badge; default
badge colors elsewhere are unchanged. Token gates and TypeScript pass. The
official maintainer-published visual baseline and full release checks remain
open; these local screenshots do not update or impersonate that baseline.
