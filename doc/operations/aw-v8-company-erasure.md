# Native company erasure and frozen analytical evidence

The existing V6 `purgeCompanyContent` owner remains authoritative. It waits for
confirmed physical runtime deletion during normal offboarding; isolated,
verified restore-ledger replay uses its existing quarantine boundary. Rollout
flags do not gate erasure. The company and Memory locks serialize purge with
analytical source inspection/publication, with an eight-second statement bound.

Published Strategy, Target, Process and Metric roots are erased through their
native cascade owners before the generic company FK planner. Frozen versions,
publication/approval receipts and generated source pins are never edited to
break their references. Metric publication is revoked before deleting its root.
Canonical work and all analytical descendants are deleted in the same company
transaction, while billing/runtime deletion receipts and the company tombstone
remain under the existing retention policy.

V7 governance previously prohibited every DELETE of immutable purpose versions,
assessments, change events and obligations, deployments and durable Stop records.
That also prohibited legitimate company erasure. Migration 0394 adds a minimal
transaction ID on the existing company tombstone. Only DELETE in that same
transaction, for that exact archived `company_deleted` company, is admitted.
All immutable UPDATE guards and normal deployment/Stop admission remain intact.
An archived company without this marker, a session setting, another company and
a committed old marker grant no exception. The marker is set only inside the
existing native purge transaction after its runtime precondition; any failure
rolls the marker and archival back. No public request accepts the marker.

Real PostgreSQL tests create two companies with published Metrics, approved
Targets/Strategy, process events, immutable process runs/lineage and V7 intended
purpose, assessment, change, deployment and Stop records. Purge with flags off
erases every populated owned surface and preserves the second company's data.
Tests also reject ordinary evidence deletion, archival/session-setting bypass,
immutable rewriting and cross-company erasure. The tombstone's transaction
authorization expires at commit. Existing V6 purge and V7 governance regression
tests continue to pass. This local proof does not qualify hosted runtime/object
storage erasure or backup archive recovery.
