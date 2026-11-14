# V10-128 Role Pack tool selection evidence, r1

Date: 2026-10-28 UTC

## Scope and implementation state

This qualification covers current task-query capability discovery, exact declared `tool:<catalogEntryUUID>` selection, policy-filtered selection through the workflow capability resolver, delegated-scope task-purpose selection under each delegated local actor and company, and scoped `tool.list`/`tool.invoke` constrained by the immutable execution manifest and current catalog version. When no primary Role Pack tool subset exists and the task query matches no tool, the runtime uses a deterministic resolver-ordered fallback of up to eight tool entries. Each explicitly claimed delegated scope gets its own task-purpose query and a bounded fallback of up to eight current-policy-allowed tool entries. Catalog UUIDs are resolved and checked against the exact source company before pinning. Current authorization and policy still apply on every operation.

The pinned manifest constrains both disclosure and invocation, consistent with §21B.6: a newer visible tool or broader current catalog cannot silently widen an existing run. Current policy BLOCK decisions still reach the policy decision/audit path before the manifest guard prevents a non-blocked unpinned operation. Material version drift prevents dispatch. Delegated guest tools are selected under each claimed guest scope's local identity, task purpose, and current guest policy; UUIDs are rechecked against that exact company before pinning. The current PostgreSQL integration now passes for primary and guest paths. This requirement remains **partial / implemented but narrowly qualified** because broader full-gate, hosted release, and representative Human evidence are outside these focused tests.

## PostgreSQL test command and recorded output

Command:

```sh
flock -x /workspace/v10-preparation/v10-pg-tests.lock pnpm exec vitest run server/src/__tests__/agent-runtime-fabric-v5.test.ts -t 'selects only Role Pack catalog UUIDs and rejects task-blocked or drifted tool pins' --no-file-parallelism --maxWorkers=1
```

The following is an explicit transcription of the earlier successful tool result. The terminal output was returned in the assistant tool message; no raw log file was captured at that time.

```text
Test Files  1 passed (1)
Tests  1 passed | 7 skipped (8)
Start at  19:00:13
Duration  24.58s (transform 11.18s, setup 84ms, import 16.17s, tests 8.19s, environment 0ms)
```

That run exercised Role Pack publication/assignment, a current task block, exact catalog UUID selection, and SHA-256 version drift on resume. It preceded subsequent `tool.list`/`tool.invoke` manifest enforcement. Its earlier assertion that an unlisted-but-profile-allowed tool remained invocable was superseded after §21B.6 review; that earlier behavior is not qualification evidence for the current requirement. Its source hashes were collected immediately after that run:

| File | Hash recorded after earlier passing run |
|---|---|
| `server/src/services/agent-runtime-fabric.ts` | `391432b36475f6c5a9ea0952460cc12dce748e3efb3c9110e7237f1d834e98ce` |
| `server/src/services/capability-resolver.ts` | `014ccda5e9ab9a56e77cc63c2302af0be8f852350c93e35251d2512b0c027ec1` |
| `server/src/services/workflows/workflow-capability-resolver.ts` | `725ced7faa550f754cc828d53fb4e67d22624d0c5efa8095a79bef3186f7936c` |
| `server/src/services/capability-resolver.test.ts` | `aad4ac76ab91bfabf469a8199b312c73a8b41336c05aea7d347c90e9371f089b` |
| `server/src/__tests__/agent-runtime-fabric-v5.test.ts` | `0c313bea3909c479ef197566c5463c3359e3797ed6ce0fb835a183a2c9a4aa8d` |

The same PostgreSQL command was rerun after adding the `tool.list` assertion. Its actual output was:

```text
❯ |@paperclipai/server| src/__tests__/agent-runtime-fabric-v5.test.ts (8 tests | 1 failed | 7 skipped) 5303ms
     × selects only Role Pack catalog UUIDs and rejects task-blocked or drifted tool pins 822ms

Failed Tests
FAIL |@paperclipai/server| src/__tests__/agent-runtime-fabric-v5.test.ts > V5 execution authority > selects only Role Pack catalog UUIDs and rejects task-blocked or drifted tool pins
Error: The required platform Skill needs validation against the current operation and tool contracts
  conflict src/errors.ts:29:10
  requiredPlatformSkill server/src/services/company-skills.ts:6255:182
  prepare server/src/services/agent-runtime-fabric.ts:342:24
  server/src/__tests__/agent-runtime-fabric-v5.test.ts:454:24

Test Files  1 failed (1)
Tests  1 failed | 7 skipped (8)
Start at  19:05:07
Duration  20.73s (transform 10.54s, setup 86ms, import 15.21s, tests 5.30s, environment 0ms)
Exit code: 1
```

This failure was an admission precondition and did not reach the new tool-list behavior. The root-owned immutable v2 release/admission refresh was subsequently verified separately by its owner; the current PostgreSQL integration below passed using that path.

## Current PostgreSQL integration result

An initial run after the v2 admission path reached both test bodies and caught an incorrect request-count expectation in the guest fixture. Its actual output was:

```text
❯ |@paperclipai/server| src/__tests__/agent-runtime-fabric-v5.test.ts (8 tests | 1 failed | 6 skipped) 18163ms
    × routes guest connected tools through current local authority and denies writes/revoked result disclosure 9180ms

AssertionError: expected "vi.fn()" to be called 2 times, but got 4 times
  at server/src/__tests__/agent-runtime-fabric-v5.test.ts:346:20

Test Files  1 failed (1)
Tests  1 failed | 1 passed | 6 skipped (8)
Start at  19:24:55
Duration  35.10s (transform 11.56s, setup 94ms, import 16.69s, tests 18.16s, environment 0ms)
```

The fixture had already made four remote calls across its permitted and revoked-result scenarios; the expectation of two was wrong. The assertion was corrected to check the final call count accurately, and the next run passed both selected tests.

Command:

```sh
flock -x /workspace/v10-preparation/v10-pg-tests.lock pnpm exec vitest run server/src/__tests__/agent-runtime-fabric-v5.test.ts -t 'routes guest connected tools through current local authority and denies writes/revoked result disclosure|selects only Role Pack catalog UUIDs and rejects task-blocked or drifted tool pins' --no-file-parallelism --maxWorkers=1
```

The following is an explicit transcription of the actual tool result; the runner streamed output rather than saving a raw log:

```text
Test Files  1 passed (1)
Tests  2 passed | 6 skipped (8)
Start at  19:25:53
Duration  38.12s (transform 13.70s, setup 92ms, import 19.43s, tests 18.42s, environment 0ms)
```

The Role Pack test verified exact UUID selection, current Task BLOCK taking effect before the manifest guard, declared list disclosure, a tool added after admission staying undisclosed and uninvocable despite the allow profile, declared tool invocation, blocked Role Pack capability rejection, and SHA drift preventing invoke and resume. The delegated-scope test verified a bounded guest list, guest-local invocation, current guest BLOCK, revoked result disclosure, and guest catalog SHA drift preventing dispatch. Catalog-drift calls did not dispatch. The passing result covers the exact two selected test cases; six other cases in that file were skipped by the test-name filter.

## Unit test

Command:

```sh
flock -x /workspace/v10-preparation/v10-pg-tests.lock pnpm exec vitest run server/src/services/capability-resolver.test.ts --no-file-parallelism --maxWorkers=1
```

Recorded output:

```text
Test Files  1 passed (1)
Tests  2 passed (2)
Start at  19:03:00
Duration  16.50s (transform 11.49s, setup 102ms, import 16.23s, tests 5ms, environment 0ms)
Exit code: 0
```

Runtime during the recorded runs: Node `v24.19.0`, pnpm `9.15.4`, Vitest `4.1.11`. The PostgreSQL fixture uses the repository's `@paperclipai/db` embedded-PostgreSQL helper, starts an ephemeral local PostgreSQL cluster, and applies current migrations. MCP transport responses are local `vi.fn` synthetic fixtures; no external provider is contacted.

## Fixture details

The primary PostgreSQL fixture uses the existing `startEmbeddedPostgresTestDatabase("aw-v5-runtime-")` helper and `seedV5Presences`, then creates a test-only `paperclip_native` provider binding, active company membership and `tools:use` grant, organization MCP connection/grant, `defaultAction: allow` tool profile, three synthetic catalog rows and exact UUID-backed published Role Packs. Two catalog rows are relevant to the same task query; only the declared UUID is selected for the manifest/list. A third write tool allowed by the current profile is excluded from manifest invocation. The current version pin is a SHA-256-shaped 64-character fixture and resume is expected to reject a changed SHA-256-shaped value. Scoped invocation assertions verify declared tool success, undeclared tool denial, and no transport after catalog version drift. A separate explicit delegated-scope test fixture creates guest-local identity, membership, `tools:use` grant, organization connection/grant and profile; it covers bounded current-policy guest list, guest invocation, policy BLOCK, revocation during upstream response, and guest catalog version drift. Upstream MCP responses are local synthetic fixtures and do not make network calls.

## Current source pins

Hashes below were measured after the latest implementation edits and after the failed PostgreSQL run. These are current pins, not claims about files loaded during the earlier passing run.

| File | Current hash | Comparison with earlier passing-run hash |
|---|---|---|
| `server/src/services/agent-runtime-fabric.ts` | `6f241e0102c15da8956a71f724deef458070d47d1dbb37bf30d8849371205bc8` | changed |
| `server/src/services/capability-resolver.ts` | `014ccda5e9ab9a56e77cc63c2302af0be8f852350c93e35251d2512b0c027ec1` | same |
| `server/src/services/workflows/workflow-capability-resolver.ts` | `725ced7faa550f754cc828d53fb4e67d22624d0c5efa8095a79bef3186f7936c` | same |
| `server/src/services/capability-resolver.test.ts` | `aad4ac76ab91bfabf469a8199b312c73a8b41336c05aea7d347c90e9371f089b` | same |
| `server/src/__tests__/agent-runtime-fabric-v5.test.ts` | `aa7d101850d7d64206595fff0040187c9ed78b2d1220c4b0b2379bc44d3d5f76` | changed |
| `server/src/services/scoped-runtime-actions.ts` | `9866a73da491888a0afee396cdb382370b08944c1d9d6c99e30e2d0ece1d4e41` | added after earlier run |
| `server/src/services/tool-gateway.ts` | `42ff20943120f7033354b7ccfdee841e4d0d18cf476d2b0dc248328781f4f180` | added after earlier run |
| `server/src/services/agent-native-operation-manifest.ts` | `8bfc90d76744eebd938c7f90348495b641119ba056b6beb1e78d6008098b59cc` | current operation-contract owner change |
| `server/src/services/platform-skill-admission.ts` | `7ec9732ddaa461401f3213d8d72e24a0433de92d0e966d487d27bbfd04623db8` | current admission owner change |
| `server/src/services/company-skills.ts` | `e86b5a4e5b86ecb426ade02e1bc36e13f3da6f8aae36e5a0679d1d9d05cb11c5` | current release owner change |
| `skills-releases/blentera-platform/releases.json` | `de3c45896a6b7d4b5e8c56bbf5d28a8d10d36dcce473ac12752e8ce6199ecfc8` | current release registry |

Machine-readable source pins and the recorded comparison are in `source-pins.json`. They identify the current shared dirty worktree and do not imply those bytes were loaded in either historical run.

`git diff --check` passed after these measurements. No full server compiler was run in this lane; the root agent had requested no duplicate compiler invocation.
