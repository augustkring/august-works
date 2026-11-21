# Assigned MCP, linked-channel Native conversations, and pinned Skills

Current source is checked by the protected workspace typecheck (r525), workspace build (r526), and 64 focused tests across five files (r527). The tests combine unit and actual embedded-PostgreSQL owner/policy checks; they do not qualify the new Native SDK/Host journeys. All owned PostgreSQL/runtime processes exited normally and source pins remained unchanged.

The initial r525 build was stopped at its 6 GiB RSS cap without an OOM. Its successful typecheck remains recorded separately; r526 rebuilt identical source with a 7 GiB cap and the existing 2 GiB global reserve.

MCP calls now retain validated result bytes and authenticated Gateway/credential provenance at the canonical invocation owner, share existing authorization/approval/budget checks, and reserve bounded source-capture capacity before effects. On-demand catalogs keep oversized schemas out of the fixed provider envelope. Linked channel runs reuse the canonical inbound delivery owner. New registered SDK fixtures cover channel turns and physically staged agent-pinned Skills. Their runtime qualification remains pending.

This is an implementation checkpoint, not PR-ready or release acceptance. See verification-summary.json and the CI81 triage reports for remaining failures and the accepted-origin approval-retention edge. The PR stays draft and unmerged.
