# Separate plugin route graph loading from behavior timing

The serialized Native shard reached plugin-routes-authz after its preceding
successful suites. Its first case timed out at the unchanged 20-second behavior
budget while createApp was importing the plugins and middleware module graph.
The original run is retained as failed; it does not count as 38 passing cases.

Move those same mocked imports to top-level awaited collection. Keep a fresh app
and clear the same mocks per test, and keep every authorization assertion and
behavior budget unchanged. Do not modify production routes or permissions.

The corrected suite passes all 38 cases: 28.24 seconds of import/collection and
453 milliseconds of behavior, 29.04 seconds total. This distinguishes cold module
loading from the actual request assertions without expanding a test timeout.
The remaining serialized shard and non-server workspaces still require their
recorded continuation. No broader green or release acceptance is inferred.
