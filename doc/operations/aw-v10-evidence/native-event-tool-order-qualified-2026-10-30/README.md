# Native event and managed-tool ordering qualification

Each invocation now shares one operation queue from before event-port creation through managed-tool activation. The queue contains each complete event authorization-and-append transaction and each complete managed verify/effect/receipt operation. Postcommit event callbacks run after the queue slot is released. Fresh event source checks, transaction locks, authority, work bounds and deadlines remain in place.

The actual PostgreSQL safe-progress regression passed 1/1; 14 unrelated tests were unselected. It holds an operation and verifies that no event persists, checks recovery after a rejected operation, and reenters the queue from a committed callback without deadlock. The qualification archive contains the immutable source pins, reconstruction patch, focused diff and actual test log. Source pins identify the complete working-source image, including other pending work; this commit stages only the isolated ordering change.

The full nine-case Native cohort on the same source still failed on the source-graph work bound (one pass, eight skipped). Its four Context manifest inserts took 3.9–38 ms with no captured concurrent privacy SQL during insertion. This is bounded scheduling evidence, not a Native-wide pass, full typecheck, host/provider qualification, deployment, or release approval.
