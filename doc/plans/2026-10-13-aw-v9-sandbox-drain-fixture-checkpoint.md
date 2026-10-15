# Deterministic queued-request drain fixture

The GitHub workspace test timed out waiting for its first sandbox bridge
handler. The fixture wrote directly to final JSON paths while the worker was
polling them. The production filesystem queue client already publishes through
a temporary file and atomic rename. An actual worker diagnostic reproduced a
partial final-path request being consumed with HTTP 400 before its handler
started; this demonstrates the unsafe fixture pattern, not independent proof
of the exact remote scheduling sequence.

The fixture now publishes both complete requests with the existing atomic
queue client before starting the worker. Its first handler waits at an explicit
gate until the real 10-ms drain deadline passes. This removes dependence on
queue setup finishing inside a 100-ms handler sleep. Cleanup releases the gate
and stops the worker. The first request remains handled exactly once with its
real response; the queued second request is never handled and must have actual
HTTP 503, retaining the original stopped-before-handling assertion.

## Verification

The full sandbox callback bridge file passed 61 cases. The same 60-file
adapter-utils project that failed remotely passed 1,293 cases with five existing
skips. The entire broader local workspace group also completed successfully. Production
bridge implementation, five-second test timeout and ten-millisecond drain bound
are unchanged. No caller-retry or unconfirmed-mutation policy was relaxed.

The full repository runner was paused between completed phases to apply this
concrete CI correction. Four general-server partitions on the preceding
`6062cfe330c89c05fa83173369acf5dc5462b6e1` source passed 4,091 cases with 25 skips;
that is partial exact-parent evidence, not a full suite for this later fixture.
Full V9 completion remains pending. References: supplied verification,
reliability, backend and workflow playbooks.
