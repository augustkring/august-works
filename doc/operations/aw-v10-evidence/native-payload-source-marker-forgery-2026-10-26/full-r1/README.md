# Full marker integrity suite

- Test file: `server/src/__tests__/native-payload-source-binding.integration.test.ts`
- Result: 29/29 passed, exit 0.
- Source head: `7dc599641de2fd122f15fce54667a35d75bf6f25`.
- Migration `0546_human_memory_evidence_snapshot_seal.sql` SHA-256: `aaffb31ade34aa719736f69efbb95fb17af2867932a41d30a157d0572605a80a`.
- Fresh source snapshot executed by `/workspace/v10-preparation/snapshot-current-source-for-dependency-check.py`; run held the host PG flock.
- The focused failure and diagnosis are retained under `../r1/`; this run verifies restoration of the original 0513 forged-INSERT guard.
