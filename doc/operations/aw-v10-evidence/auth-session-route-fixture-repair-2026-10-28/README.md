# Auth-session route fixture repair evidence

The first captured run reproduced 4 failures in `server/src/__tests__/auth-session-route.test.ts` (13 tests total). The diagnostic run identified `TypeError: tx.update is not a function` from `ensureHumanRoleDefaultGrants` in `server/src/services/principal-access-compatibility.ts:87`. The failure was in the mock database: the production service correctly opens a transaction, locks the newly inserted membership, inserts role-default grants, and marks permissions initialized; the mock did not implement the transaction's update operation or locked select chain.

The test fixture was updated to model those operations. The final captured full-file run (`attempt-6.log`, `attempt-6.exit`) passed all 13 tests. `attempt-1` is the initial full reproduction, `attempt-4` contains the diagnostic stack, and attempts 2, 3, and 5 preserve intermediate captured runs.

The source digest in `source-sha256-after-test.txt` is a post-test digest of the current test file. No pre-test digest was captured, so this evidence does not claim one. Runner: `/workspace/v10-preparation/pinned-bin/pnpm --filter @paperclipai/server exec vitest run src/__tests__/auth-session-route.test.ts`.
