# Load shared mocked route graphs during collection

Status: implemented. Seven actual HTTP/service suites pass all 225 cases.
Current server typecheck passes. Remaining serialized continuation is open.

The checkpoint-73 continuation reaches issue-closed-workspace-routes and skips
all 12 cases when the shared hoistModuleGraph beforeAll exceeds 30 seconds.
This is the same import-only failure mechanism already reproduced in checkout
ownership and the access-floor suite. Raising a shared hook or behavior timeout
would obscure the distinction between cold transformation and behavior.

The helper now registers the exact stable mocks and awaits the actual graph
once during module collection. All seven remaining callers use top-level await
before their suites. Its readonly value API remains; forgetting await is a type
error. Existing per-test mock rearming, issue-list cache clearing and route
requests/permission assertions remain. No per-test module reset, timeout,
production route or Native policy changes.

All seven callers pass together without skips or unhandled errors: Agent
permissions, approval idempotency, company skills, costs, instance settings,
closed-workspace routes and comment cancellation. Server typecheck passes.
The earlier failing aggregate remains recorded. Caller order and the existing
serialized file classification remain unchanged.

Guidance: the supplied construction, workflow/configuration, verification and
security playbooks. This correction concerns test initialization only. Runtime
software remains checkpoint 72. Complete current integration, all 70 launch
rows and whole V9 acceptance remain open. No PR/push.
