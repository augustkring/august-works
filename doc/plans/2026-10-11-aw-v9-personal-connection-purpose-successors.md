# Personal connection purpose successors — 2026-10-11

Continue V9 §78.9 with a new explicit C3 after withdrawing a prior purpose.
Preserve each earlier purpose, first completion, credential and validation.
An old approval remains terminal; no status revival, history overwrite, second
connection, copied credentials or Agent access is allowed.

Source introduces immutable predecessor identity and a unique successor chain.
Current connection/reservation uniqueness applies to live purposes; historical
withdrawals remain queryable. The original Native owners choose the sole live
purpose, or retain terminal ownership to prevent legacy credential fallback.
Each new review pins its exact predecessor. Existing root-purpose review hashes
remain unchanged because a null display predecessor is excluded from the canonical
hash. The current original method, personal subject and resource must remain the
same; broader profiles or cross-run identity changes need their own future review.

The insert guard requires a terminal same-company/run/user/application/connection
parent without a successor, preserving the original method hash. Existing consent
immutability remains the owner of later transitions. Original adoption, allocation,
callback, positive completion and validation guards remain in force. They prefer
current ownership without allowing an old withdrawal to grant future Agent reach.

A health observation predating a current secret revision cannot establish current
setup. Original setup reads and positive Native completion/revalidation guards
compare the actual secret metadata clock with the observed health clock. The clock
is not added to the material setup hash. No provider I/O or credential resolution
is added to consent reads or held database locks.

The UI refetches its review after withdrawal, discloses that the decision is new
and requires another explicit confirmed command. Five new Native cases cover
concurrent fresh C3/history preservation, repeated generations/current-owner
selection, invalid/ancestor/immutable parents, Original change-setup revision and
a rotated credential with only stale health. The new UI case checks review refresh
and separate C3. Neither new case set has run.

This branch begins at unqualified renewal WIP `019f68a51`; its own migration has
not yet been generated. Qualification is pending. Healthy unassigned personal
connections in the same onboarding run are the bounded scope; an unhealthy or
expired login after withdrawal, cross-run replacement, wider grants and preserving
existing organizational/Agent reach remain open. Full V9 and PR readiness remain
open. Tests and local fixtures never constitute hosted or human acceptance.

Original migration generation V1 passed and produced `0474_open_cammi.sql`.
Its schema statements retain the Original owner; the inspectable successor/
current-owner/positive-proof guards were appended. All 11 historical snapshots
pruned by the Original generator were restored byte-for-byte from Git. Shared
and DB builds V1 passed. Native, UI and full type/browser qualification remains
pending. No customer migration or operation was executed.
