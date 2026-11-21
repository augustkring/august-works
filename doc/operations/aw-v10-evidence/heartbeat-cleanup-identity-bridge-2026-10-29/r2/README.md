# Current Human fixture admission and identity bridge checks (r2)

This receipt records the current fixture corrections for two historical CI failures. It does not qualify a deployment or external identity provider.

The cleanup admission fixture now seeds a canonical current Human company membership and installs the normal heartbeat API URL fixture before it starts runtime tools. The identity bridge fixture now supplies the policy timestamp consumed by the production projection.

The pinned dependency-mirror run used `vitest run src/__tests__/heartbeat-native-cleanup-admission.test.ts src/__tests__/v7-enterprise-identity-bridge.test.ts --reporter=verbose` from `/workspace/v10-dep-qualification/server`. Both files passed: 6 tests, exit 0. The snapshot copied and verified 1,048 current source files; Oxc syntax checked 891 files and passed. Snapshot and syntax exit codes are both 0.

`source-pins.json.gz` retains the exact full source snapshot. `owned-fixture.patch.gz` contains only the two fixture-file diffs for this receipt. `test.log.gz` is the raw selected test output; credential-pattern scans found zero Bearer-token-like and zero API-key-like matches. Hashes for every artifact are in `SHA256SUMS`.
