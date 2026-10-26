# CI1a server1/server12 focused regression evidence

This locked run used a fresh source snapshot in `/workspace/v10-dep-qualification`.
The full source pins are in `source-pins.json`; the Vitest output and exit receipts
are preserved alongside it.

Vitest ran five files: four passed and one failed, for 38 passing tests and one
failing test. `skill-version-file-erasure.integration.test.ts` passed in this
run, including the scoped company purge case for the Skill/version ownership
cycle. The migration replay test failed before migrations ran because the
historical conversation Task fixture omitted its required `conversation_state`.
That field is now set to `waiting`; a fresh migration-only run is queued. This
archive records the partial run and does not claim the migration test passed.

The test log is gzipped from the raw Vitest output. `sha256sums.txt` records the
snapshot-pin and raw-log hashes. The migration test source hash at this snapshot
was `ee35288a0232393cffb66a2e50a84d7c652b7106094868c97bea0e0e61f744cb`; the
Skill purge test source hash was
`9e672743fab0a57261bcdc3917832d9b9e7e9bca946f773815d8d70ec2964967`.
