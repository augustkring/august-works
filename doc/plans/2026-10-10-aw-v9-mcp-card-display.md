# V9 MCP display-reference tool

Supporting source increment, 2026-10-10. This does not accept a launch surface or
qualify live provider delivery, hosted identity or all 18 interactive card forms.

The existing Paperclip MCP server now lists `aw_experience_card` through the
installed official SDK (resolved 1.31.0; no dependency version was changed). Its
strict bounded input identifies only a company, pre-approved component and exact
Native card/source/version. It returns a display reference with authority=none.
It performs no API fetch, mutation, execution, approval or grant. The existing
client renderer still requires a fresh, current-account/company Native view and
exact source/version; tool output supplies no view prose, URL, HTML or callback.

The new tool uses the installed SDK registerTool API with the full strict schema,
including the cross-company refinement. Passing only schema.shape would discard
that new semantic validation. Other existing tool registrations are unchanged.
Read-only/destructive/idempotent annotations are interoperability hints, never
permissions. Invalid direct inputs get a content-free refusal, including oversized
references and getters. Actual MCP JSON requests retain strict unknown-field and
cross-company rejection.

The renderer and typed transcript recognize only `aw_experience_card` and the
exact Paperclip MCP-qualified `mcp__paperclip__aw_experience_card`. Unknown server
prefixes and suffix matches cannot select this renderer. Initial references stay
immutable during streaming, and tool-result prose is discarded. The installed
assistant-ui runtime registers both exact names without an effect implementation.

The original root Vitest configuration does not include the MCP server package;
verification therefore runs that package's existing test command separately.
Its 21 cases pass, including actual SDK initialize/list/call via the official
in-memory transport. Six existing shared/UI files pass 228 cases, including both
installed assistant-ui registrations, both typed transcript references, existing
thread/system-notice checks and exact-name negatives. The first root invocation
found no MCP tests and is not counted as a pass. A package run also exposed an
old exact create-body expectation missing the already-existing Native
allowDuplicate=false default. The test now checks that explicit existing default;
the issue writer and shared legacy schema were not changed by this increment.
All unsuccessful runs remain recorded.

Strict shared/MCP/UI types and builds, token/coverage, all 21 package cases and
all 228 shared/UI cases pass in the final frozen run. Whole source/HEAD before
and after match 0d4b119856f183ad997dc4429bb29d0d7aefdc24bb4ce4f0a9863877d7957e7c.
Integration with the latest project/task/account wave remains pending. No new Tool Gateway business
effect or MCP Apps iframe host is introduced. Actual runtime/provider admission,
channel parity, broad semantic authoring and human/hosted launch checks remain
open. R0/sourceComplete and all 70 acceptance rows remain pending.
