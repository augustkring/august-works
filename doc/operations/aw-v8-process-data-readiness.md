# V8 native process-data readiness preview

`POST /api/companies/:companyId/process-data-readiness` is a default-off human
preview of current native data quality. It requires native company authority,
`process_intelligence_v8` and its prerequisites, and current V7 process-purpose
evidence. The request declares business question/key, UTC period, required source
providers, object types and typed activities, minimum period, ordering/lifecycle/
arrival requirements and explicit duplicate/unknown-object/late-arrival thresholds.
The public schema accepts no supplied source scan, readiness result or score.

The existing native event reader remains authoritative. Inspection holds company
→ Memory boundaries, shares at most 2,001 minimal native source records, and scans
at most 11 pages of current events with a 2,000-event result bound. Source queries
select typed status/priority/project facts without arbitrary activity JSON, bodies
or actor identities. PostgreSQL statement timeouts and an inter-page work budget
bound database work. Truncation or a missing current projection yields unknown
coverage, never a complete-subset claim. Current source rows/objects/purpose, hash
checks, expiry and Memory guards are still enforced by the event owner.

Sixteen dimensions remain separate. Exact UTC microseconds establish ordering;
UUID order never resolves tied events. A related Project cannot borrow a Task's
primary lifecycle. Observation time is not transport arrival, so required arrival
evidence remains unknown. Unknown external source/entity resolution cannot pass
through native authority. Expired evidence, future/open periods and an empty
authorized population cannot establish required process evidence.

The result binds company, requirement/event-set hashes, current authorized event
count, engine version, dimensions/reasons/findings and a maximum five-minute/source
expiry. It grants no execution permission and persists no second readiness store.
Its scope is the current retained native activity snapshot for the six supported
Task/Project activities. DATA_READY is a preview for exactly its declared properties;
consumers must bind stronger analysis requirements to their own immutable native
definition and recheck current authority before use. It does not certify entire
historical coverage, all native producers, external clock synchronization or
independent hosted source-log retention/restore.

Four known-answer engine tests and actual native PostgreSQL event/API regression
pass (42 in the combined selection). They verify exact microseconds, missing/bounded
source coverage, tied order, related-object lifecycle, external/arrival unknowns,
expiry/open periods and Memory erasure after current source projection. The final
engine/OpenAPI selection passes 19 after adding duplicate-source identity and
unsupported timestamp precision coverage. Direct server/UI TypeScript checks pass.

The native process calculation owner now captures this same inspection internally
and pins readiness with immutable definitions, separate human publication and
native lineage-backed runs. See [native process engine](aw-v8-native-process-engine.md).
Ordering requirements apply to the requested object perspectives; simultaneous
unrequested related Project links do not invent a required Project order.

Still open: quality finding lifecycle, complete producer/coverage contracts,
conformance, source-log metadata lifecycle, operator UI, Learning/Decision/
Planning bridges, performance/security and hosted qualification. No process output
or worker/person score is published by this preview.
