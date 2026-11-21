# Real MCP origin in the Native worker fixture

The actual heartbeat draft case passes after the fixture starts an ephemeral HTTP listener with the original MCP gateway route and service, supplies its real API origin, and verifies unauthenticated access receives 401. The existing model, budget, source, result, review and erasure assertions remain intact. Production admission is unchanged.

R4: one selected case passed, 66 filtered, exit 0. The earlier R3 failure is retained: its probe collided with the test’s model-fetch replacement; R4 uses Supertest against the same actual listener. This receipt does not qualify the other 66 gateway cases. Exact source manifests, reconstruction patches and compressed raw logs are retained for each attempt.
