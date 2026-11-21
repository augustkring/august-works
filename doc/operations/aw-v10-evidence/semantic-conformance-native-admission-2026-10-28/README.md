# Semantic conformance Native admission fixture (2026-10-28)

The production conformance fixture now models a current Native run with a real responsible Human, active company membership, and canonical server-owned platform Skill admission. Its test request context reads the Human's active membership from the database, matching the authenticated agent middleware contract. The mock adapter and the expected `company_scope_violation` denial are unchanged, so the vector reaches the foreign blocker boundary only after ordinary active-task authority passes.

Attempt `r1` added Human/run/admission state but initially omitted the authenticated membership projection from the simulated request actor. `assertCompanyAccess` correctly denied the PATCH as `RESPONSIBLE_USER_UNAVAILABLE` before dependency validation. Attempt `r2` reads that projection from the current database membership row and passes the full semantic conformance suite.

`r2` ran the test under `/workspace/v10-preparation/v10-pg-tests.lock`; source snapshot and syntax check were run under the same lock before Vitest. Snapshot, syntax, and test exits are `0`.

- Source head: `68d07838add3a9ce77ba876571b0c3af2dc15fa4`
- Test: `server/src/__tests__/paperclip-semantic-conformance.test.ts`
- Result: 1 file passed; 1 test passed
- Raw test log SHA-256: `3f2fefa4c67334b16ca2373ec13f8e21d9e90503503bc8161fec51432da838dc`
- Source pins SHA-256: `6493c8fa8937e5ff83e7e87bdee17bdb2f20bc8af8ca1af717faab31485c2965`
