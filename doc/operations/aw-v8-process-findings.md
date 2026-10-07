# Material native process findings

The native process owner now retains a bounded material finding for missing
qualified data, observed reopening, a human hypothesis about blocked time or a
selected observed variant. Six finding types are admitted by the currently
implemented source families, including deviations from an explicit published
typed process model. Approval-delay and retry/handoff findings require additional
typed source coverage and remain open work.

Every operation reuses the native process-run owner to recheck current company,
human authority, process purpose, definition owner/review, exact event set,
readiness and lineage. No raw events, actor identity or source body are copied
into findings. The server selects scalar facts from the already qualified run;
public requests cannot supply counts, confidence, source hashes or expiry.
Missing-data findings have no object statistics. Reopening and blocked-time
findings require a positive admitted observation. Variant selection requires
at least two observed variants and the exact retained selected hash.
Conformance-deviation findings require a positive admitted deviation count for
the selected perspective and the exact published model version. Their scalar
facts freeze model hash, version, evaluated/deviating objects and the four
violation-category counts. An unrequested comparison or a fully conforming result
cannot support such a finding. A model deviation is not a proven policy violation.

Interpretation and severity are human judgments. Blocked time does not prove
avoidability or a bottleneck; a selected variant is not a statistically established
anomaly. The result explicitly states these limits and never reports a calibrated
probability, employee score or causal effect. The immutable content hash pins
facts, interpretation, priority and exact definition/event hashes. A material
fingerprint prevents duplicate interpretations of the same run/type/perspective/
variant; an exact retry returns the existing finding and changed content conflicts.

The lifecycle is OPEN → ACKNOWLEDGED → INVESTIGATING → RESOLVED, with
SUPPRESSED_WITH_REASON available from each unfinished state. Each step requires
a current expected version and a human reason. Terminal states cannot be reopened.
Migration 0395 forbids rewriting frozen finding evidence, skipping steps, editing
or removing live transition receipts and committing a state without its matching
receipt. Initial creation also requires a matching OPEN interpretation receipt.
Resolution is a human review status; it applies no canonical work or Learning
change and `resolutionRef` remains null in this slice.

Findings expire with their parent run. Same-company run FKs cascade erasure from
native event/Memory source deletion, definition or lineage retention, company
purge and verified restore-ledger replay. Parent deletion also removes human
interpretations and transition reasons. Rollout flags never prevent that erasure.
Reads deny changed, hidden or expired sources rather than returning cached facts.
Lists scan at most 101 rows per 100-finding page; history is separately bounded.

The native UI exposes admitted fact choices, frozen human interpretations,
review priority, immutable evidence and transition history. It requires a reason
before enabling the next permitted review action. Current source-check failures
hide previously listed interpretations and mutation controls. Queries retain the
existing company/account keys and source-event invalidation behavior.

Local PostgreSQL tests cover all six material types, human lifecycle/CAS,
duplicate retry/conflict, SQL immutability and receipt requirements, null scope,
missing data, cross-company/agent denial, changed source authority and source
erasure of every finding/receipt while canonical work survives. Company purge
also populates and removes findings while retaining the second company's history.
Nine UI tests and twenty Chromium light/dark, 390/1200-pixel keyboard/WCAG A/AA
scenarios pass; review panes were visually inspected. TypeScript, token gates and
the generated migration snapshot pass. These local tests do not qualify hosted
rollout, the official visual baseline, provider dispatch or backup archive recovery.

Learning conversion, typed Workflow/Pipeline/Playbook conformance, remaining
process source families and hosted qualification remain separate open work. A
process interpretation is not a replacement for Learning's independently verified
canonical Task outcome/evaluation requirements.

Migration 0396 extends the existing scope constraint to admit explicit-model
deviation findings; it does not relax immutable content, receipt or erasure
guards. The native generator owns its journal and pruned snapshot set. Additional
PostgreSQL coverage freezes comparison facts, rejects absent/zero deviations and
wrong perspectives, and erases the comparison finding and receipts with its
source while retaining the canonical Task. The conformance editor uses full-width
state selectors on small screens. Browser qualification of this additional slice
is recorded separately from the preceding 24-scenario model check.
