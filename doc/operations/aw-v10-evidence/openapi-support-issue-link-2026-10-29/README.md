# OpenAPI support case issue-link contract

This focused regression documents the existing native POST issue-link route with its shared request/response schemas, strict request body, 201 status, and private no-store response. The test run used the pinned dependency-qualified source mirror.

The V9 operation-coverage checker completed with exit 0: 70 surfaces verified, 70 pending implementation/evidence. Its output explicitly says this is not release acceptance. The failed mirror-only coverage attempt is retained separately; that mirror does not contain the canonical operation inventory JSON.

Changed source is limited to `server/src/routes/v6-api-paths.ts`, `server/src/__tests__/openapi-routes.test.ts`, and `doc/operations/agent-native-ui-operation-coverage.json`. The inventory entry corrects the current SaasDeletion callsite and documents the existing destructive Human-only offboarding effects; it does not waive coverage.

The focused OpenAPI run executed 2 tests (30 skipped), exit 0. This evidence does not qualify the whole API, all customer surfaces, or release readiness.
