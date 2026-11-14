# Current-Human heartbeat scheduling fixture

The complete existing scheduling suite passed **8/8**, exit 0, on the source snapshot recorded here. This is a mocked-provider scheduling proof, not a real runtime/provider qualification.

These tests name two Human principals in wake contexts. The fixture now seeds their current memberships and cleans up the associated permission grants before deleting companies. It also supplies the deterministic local API origin normally set by full server startup; the fixture does not boot that server. The first run without that origin correctly failed with `PAPERCLIP_API_URL is required to deliver managed runtime MCP servers`. No production admission guard was weakened.

The raw test log retains warnings from the mock runtime and expected cancellation/setup races. The suite assertions cover wake coalescing, blockers, concurrency, stale queued cancellation and pause-hold interaction wakes.
