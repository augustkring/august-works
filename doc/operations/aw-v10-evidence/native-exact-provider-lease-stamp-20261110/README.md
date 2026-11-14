# Exact Native workspace stamp lease identity — 2026-11-10

Native workspace finalization now treats provider lease IDs as opaque identifiers. It requires the exact current lease ID from the server-owned source instead of an invented character format. Worker and conversation callers supply that ID. Stamp requests require an empty environment and retain the existing exact command, workspace, Run and content-hash checks.

The regression captures the actual stamp producer with a URI-form lease ID. It rejects missing or different expected IDs, injected environment entries and malformed content hashes.

## Verification

- r304: all nine runtime-context preparation module cases pass.
- r305: the full managed OpenCode conversation Task erasure integration passes. The case takes 139.034 seconds; the bounded harness takes 160.855 seconds. It verifies conversation dispatch, creation of its private Task, canonical conversation retirement and erasure of the Task copy.
- r306: the full server TypeScript check passes in 104.734 seconds.

The attached receipts bind each check to exact input hashes. Source pins stay unchanged during each check. No resource stop or OOM is observed. Owned PostgreSQL and fixture runtime processes are closed. The TSC and SDK windows also include two separately saved, uncommitted no-launch fixture changes; those changes are not part of this stamp checkpoint or qualified as passing retry coverage.

## Limits

The integration uses the local SDK, embedded PostgreSQL and a controlled software provider/Host fixture. It does not establish external provider, production Host, deployment or complete V10 acceptance. Slack retry closure, remaining legacy recovery coverage, full repository checks and final review remain open.
