# Same-procedure platform contract refresh

The raw PostgreSQL receipt records 4/4 passing tests on its exact source snapshot.
The first attempt failed because the version schema uses `candidate`, not `draft`;
the successful attempt uses the real candidate lifecycle state.

V1 remains byte-for-byte unchanged. V2 binds the same 14 verified procedure files,
content digest and canonical source commit to the expanded operation manifest.
Its API-only records are unqualified source metadata, not new tools or grants.
Fresh admission can adopt only an identical-byte trusted release binding. Reads,
resumed Runs and material mutation checks cannot promote the release. Degraded
or revalidation states remain blocking. The original Run pin is unchanged and
fails current-contract validation after drift; a new Run receives the new pin.

These tests cover package materialization, required admission, missing/stale
pins, revoked Human membership, lifecycle revalidation and same-byte refresh.
They do not establish final aggregate or hosted/runtime/provider acceptance.
