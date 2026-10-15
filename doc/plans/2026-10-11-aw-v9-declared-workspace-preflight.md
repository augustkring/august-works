# Declared workspace preflight

The integrated V9 workspace's complete typecheck passed on 2026-10-11 at
`d363642b09e53c3b76cb4f46483885877b6534c8`. The subsequent original
`pnpm test:run` stopped before Vitest: preflight recursively inspected the
owner-only generated `server/ui-dist` directory as if it could contain a
workspace package. Preserve the failed v3 logs; no test pass follows from it.

Preflight now obtains the declared workspace graph from the installed pnpm's
local `list --recursive --depth=-1 --json` command. This honors the original
manifest exclusions and avoids traversing generated assets, runtime data and
nested source fixtures. The graph must contain valid, unique package names
inside the repository. Existing dependency validation/relinking is unchanged;
there is no test exclusion, deadline change or blanket EACCES catch.

The focused Vitest case executes the actual package manager against an owned
throwaway workspace. It verifies included packages, excluded packages, nested
non-workspace packages and inaccessible private/build directories containing
invalid package JSON. The original preflight also completes on the public
repair worktree. Exact logs: `v9-workspace-declaration-focused-v1.log` and
`v9-workspace-declaration-preflight-v1.log` in the task workspace. Integrated
Native test-user preflight and complete checks remain pending. This repair
makes no V9 source-complete or release-readiness claim.
