# Required Skill delivery over OpenClaw Gateway

The adapter's managed Blentera Skill delivery follows the Gateway WebSocket
methods implemented by OpenClaw at commit
[a54402e27d585ab69cccda86ce7c0160a68afeaf](https://github.com/openclaw/openclaw/commit/a54402e27d585ab69cccda86ce7c0160a68afeaf).
The adapter checks the Gateway's advertised method list before it attempts the
write:

The pinned upstream file hashes are:

| Upstream file | SHA-256 |
| --- | --- |
| packages/gateway-protocol/src/schema/agents-models-skills.ts | 49cc9d65a274018f558682156624c28ab7a582efe1681a98434db7e44bb3bcdc |
| src/gateway/server-methods/skills-upload.ts | fa1f546a52efdd79cda81f1f431879dc9265b8bd3c000189ee421ca030546193 |
| src/gateway/server-methods/skills-install.ts | 604dacfedc709f4d195edb8be1d11cfff0774b4571df0f6741b010c6fa0f4190 |
| src/gateway/server-methods/skills-files.ts | e405c0a7371d9f955a98b94a9054f2c39f44a7a70dec957bcf7de6ec793367ee |
| src/skills/discovery/status.types.ts | c5100a4c876482234b3893bd98ab12c736ed9bc6d6469cf5bd7b3f48af049551 |

1. skills.status identifies the configured agent workspace and any existing
   effective blentera-platform entry.
2. skills.upload.begin, skills.upload.chunk, and skills.upload.commit
   transfer a bounded skill-archive and verify its SHA-256.
3. skills.install installs that exact uploaded archive into the selected
   agent workspace.
4. skills.status and skills.files.get verify the single effective entry,
   its managed workspace path, and its SKILL.md content before the adapter
   sends agent.

The protocol schema caps a base64 chunk at 5,592,408 characters and the
OpenClaw upload store caps the archive at 4 MiB. The adapter uses 1 MiB chunks.
The shared required-Skill verifier limits the admitted inventory to 4 MiB and
64 files, caps each file at 128 KiB, rejects symlinks and special files, and
allows only SKILL.md plus one-level Markdown references. The adapter applies
the same 4 MiB packed archive ceiling. The admitted
Blentera inventory digest is checked over every local file before packing; the
same archive digest is required from the upload commit and install receipt.
The adapter writes USTAR headers directly with sorted paths, fixed zero
timestamps, fixed permissions, and numeric zero ownership. Rebuilding after a
lost upload response produces the same archive SHA and therefore the same
run/pin/archive idempotency key; retry staging-directory timestamps never
create a second upload identity.

OpenClaw's skills.files.get returns only the selected skill's SKILL.md;
the current skills.status report has no full-file inventory digest. The
adapter therefore verifies the full immutable source before upload, the
archive hash at commit/install, and the effective managed path plus main file
after installation. It does not claim an independently read back hash for
support files.

This protocol does not provide a per-run tool or MCP injection field on
agent. tools.catalog is read-only. The OpenClaw adapter therefore requires
the repository-owned versioned Blentera bridge described in
[GOVERNED_TOOL_BRIDGE_PROTOCOL.md](./GOVERNED_TOOL_BRIDGE_PROTOCOL.md).
Skill delivery and the authenticated run-scoped MCP binding are independently
verified before V10 capability qualification.
