# Collect the invite-resolution graph before its behavior clock

The current serialized0 continuation reached invite-test-resolution-route after
41 passing suites, then its first behavior timed out at the unchanged 20 seconds.
The async createApp loaded access/middleware for the first time inside that test.
Move those stable imports to module collection, retaining a fresh per-case app,
controlled DNS/probe mocks and every private/local/multicast/reserved-address,
redirect and network boundary assertion. Do not increase a test timeout or change
production invite resolution.

All seven cases now pass: 22.72 seconds collection and 94 milliseconds behavior.
The failed broad attempt remains inspectable. Its 41 prior suites ran on the same
production code and byte-identical test files, and the remaining 38 suites will
continue on this checkpoint, including this corrected seven-case suite. Coverage
is an explicit continuation with source identity, not a false one-command pass.

Checkpoint85 includes the preceding connected-policy Date-only fixture correction;
both changes are test/documentation-only after checkpoint83. Existing worktrees
running checkpoint83/84 stay frozen. Full workspace/browser/type/build qualification
is still pending. R0, sourceComplete=false and all 70 release gaps remain. No PR,
push, deployment, real provider send or human/host qualification is claimed.
