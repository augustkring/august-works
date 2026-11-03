# Context tombstone and legacy-run fixture regression receipts

Current-source snapshot `dd496d2e6f567fcec08159e661a0d6dd28ba44a9` passed both selected integration files in the dependency-qualified mirror under the shared PostgreSQL lock:

- `context-derived-source-tombstones.integration.test.ts`: 8 passed. The fixture now creates evidence through an authenticated Human Task, reviewed Memory candidate, and exact task evidence; the two post-deletion source-insertion barriers remain covered.
- `legacy-finalization-regression.test.ts`: 1 passed. The flag-off direct-adapter fixture provides the API origin normally set by server boot before managed MCP configuration; its byte-stability and zero-Native-row checks remain intact.

Vitest: 9 passed, exit 0. The stale model-lineage read returns 403 before source deletion and 409 after its observation is removed; both outcomes withhold model payload, and the fixture asserts the current stale-evidence conflict. `source-pins.json`, `source.patch.gz`, `test.log.gz`, individual stage exits and `SHA256SUMS` bind the receipt to the actual source.
