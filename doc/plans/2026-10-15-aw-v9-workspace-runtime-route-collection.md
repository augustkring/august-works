# Keep fresh workspace route fixtures outside cold graph timing

The serialized shard stopped at workspace-runtime-routes-authz: its first case
reached the unchanged 15-second behavior limit while transforming the cold route
graph. Preserve that failed run; no skipped/unrun cases count as passing.

Load the same registered mock dependency graphs with top-level await during
collection. Keep the existing per-case query-keyed route imports, fresh apps,
per-test mock resets, request assertions and 15-second behavior budget. The
collection import does not issue a route request or change production code.

All 12 cases now pass: collection/import 29.47 seconds, actual behavior 576 ms,
30.32 seconds total. Continue the two remaining serialized suites and the other
non-server workspaces separately. All release/Human acceptance remains open.
