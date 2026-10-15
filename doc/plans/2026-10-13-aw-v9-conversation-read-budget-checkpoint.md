# Bounded private conversation proposal reads

Saved conversation proposal reads now share the existing private experience
admission controller: at most four active admitted views, with a 1,500-ms total
budget and cancellation checks before protected access, each workflow and final
owner verification. Admission stays occupied until underlying work settles.
Transaction-local PostgreSQL statement and lock timeouts bound real database
waits. Expected lock/statement timeout errors become an unavailable view; the
HTTP route returns a private/no-store 503 without raw database detail.

The owner still reads actual owned Original revisions under current verified
account, generation, membership, Source and workflow authority. No stale private
payload, model call, write, automatic replay or queue is introduced. The existing
UI can explicitly refresh an unavailable read; a missing result proves no
mutation outcome. The optional cancellation signal is an internal read option.

## Verification

Current Native conversation, Original admission and OpenAPI suites passed 36
cases and affected server types passed. One actual PostgreSQL transaction holds
the company privacy lock; the competing view stops at its budget and returns no
proposal data. After the blocker and query settle, the next read succeeds,
proving admission was released. A pre-aborted read is also refused and does not
poison later reads. Existing provenance, later private-expression comparison,
retirement/reset and late authority/account rollback cases remain passing.

This is bounded read admission, not full V9 completion or a hosted latency SLA.
References: V9 §41 and supplied performance, reliability, backend, privacy and
verification playbooks.
