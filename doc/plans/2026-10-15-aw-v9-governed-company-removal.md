# Preserve governed records when legacy company removal is blocked

Status: implemented; three scoped Native PostgreSQL cases pass. Affected types
and broader current-source qualification remain pending.

The checkpoint-47 synthetic browser exposed a PostgreSQL foreign-key failure on
`governance_obligations_company_id_companies_id_fk` during the legacy local
company DELETE. Its transaction rolls back, but the caller gets an unexpected
500 instead of an actionable conflict. Native governed records must remain
under their existing deletion and retention owners.

The legacy company service will translate a foreign-key failure from its own
removal transaction into HTTP 409 with the stable code
`company_removal_requires_governed_cleanup`. It will exclude SQL, parameters,
constraint names and private error prose. Classification happens after rollback.
Other failures and existing hold conflicts retain their original behavior.

This change grants no erasure authority. The existing governed deletion owner
still controls runtime/provider cleanup, retention holds and minimal tombstones.
A conflict is not an erasure receipt. The ordinary bare legacy-company removal
path remains supported.

Verification uses the existing migrated Native metric fixture: retained
governance plus a legacy project must survive a refused removal exactly; the
bare other-company fixture must still be removable; an unrelated database
failure must propagate unchanged. Required checks and the final API/UI evidence
must identify this source separately from the frozen checkpoint-68 baseline.

The actual three-case Native run passes (32.38 seconds; 7.00 seconds test work;
26 unrelated cases excluded by the explicit test-name selection). The refused
transaction preserves the complete company, project and governance rows. This
is a rollback/refusal check, not a physical-erasure qualification.
The strengthened repeat also rejects a copied database cause and requires exact
content-free error details: three cases pass again (27.17 seconds total).

All V9 launch rows, source completeness and operating acceptance remain pending.
No PR/push, provider action or customer-data deletion is authorized by this test.
