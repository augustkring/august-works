# August Works v2 — release-foundation follow-up

Date: 2026-10-06. Branch: `fix/aw-v2-release-foundation`.
Continues [implementation 1](2026-10-06-aw-v2-release-foundation.md).
This note supersedes its dependency counts and local-toolchain blockers;
it does not supersede its product, deployment or release-approval boundaries.

## Changes

- Update within existing major lines: qs 6.16.0, body-parser 2.3.0,
  Hono 4.13.13, ip-address 10.7.3, DOMPurify 3.4.16, smol-toml 1.9.0
  and fast-copy 4.1.2. Range-scoped overrides cover the transitive copies.
- Update Svix from 1.76.1 to 1.99.1, removing its UUID 10 dependency without
  forcing a different UUID major into the old parent.
- Raise the MCP TypeScript SDK from 1.30.0 to 1.31.0 after the new high-severity
  OAuth credential-routing advisory surfaced in PR CI. The compatible 1.x
  security floor is reflected in the committed lock.
- Update Sharp to 0.35.5 and its platform binaries. A fresh audit surfaced
  [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w),
  added to the advisory database after the earlier audit. The installed Linux
  binary reports librsvg 2.63.2 and successfully rasterizes a local SVG.
- Add HTTP parser regression coverage for bracketed comma-array limits,
  null serialization, invalid body-limit configuration and enforced body size.
- Preserve TOML parser-created tables in Codex startup trust updates. The new
  parser uses null-prototype tables; spreading them into ordinary objects made
  the strict semantic comparison reject valid edits. Keep strict comparison,
  unrelated bytes, atomic writes and idempotency; do not relax the trust guard.
- Document native verification prerequisites. Install the pinned Rust 1.97.1
  toolchain with rustfmt and the local C build tools; no runtime services,
  deployment flags or cloud infrastructure are changed.
- Let the stable test wrapper use an explicit short disk-backed temporary root
  through `PAPERCLIP_TEST_TMPDIR`, preserving the existing short `/tmp` default
  and per-invocation isolation. The existing real-CLI shard regression checks
  both the selected temporary root and exact test coverage.
- Fix the shared bundled-skill resolver's missing server source/build layout.
  It previously preferred an enclosing workspace's unrelated `skills/` folder
  over this repository's connector skills. Cover both `server/src/services`
  and `server/dist/services` beneath a workspace with a conflicting skills root.

## Dependency audit and residual triage

The new production source-lock audit reports **0 critical, 0 high, 2 moderate
and 2 low** findings, versus the previous 18 moderate and 5 low. No finding
is suppressed. This is not a built-image scan or evidence of zero vulnerabilities.
PR CI then found [GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h)
in MCP SDK 1.30.0. After the 1.31.0 update, the local production audit again
reports 0 critical/high and 2 moderate/2 low. Existing persisted OAuth client
credentials still require issuer binding or a fresh sign-in before an untrusted
remote MCP server is admitted; a package update alone does not repair them.
The updated lock passed a frozen install. MCP-server typecheck, Google Sheets
MCP tests (27/27), and KV demo MCP tests (12/12) passed. The standalone
MCP-server suite had 13/14 passing; its create-issue assertion expects no
`allowDuplicate` field, while the existing implementation sends `false`.
That test and implementation are outside this change and need reconciliation.

| Residual | Evidence and disposition |
| --- | --- |
| `esbuild@0.18.20` through Drizzle's `@esbuild-kit/esm-loader` (moderate) | The installed loader uses esbuild transforms; no `.serve()` call was found in its core-utils implementation. The [advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99) concerns the development server. The current parent still ships this dependency. Do not override across esbuild minor lines without compatibility verification. Final image contents and absence of a reachable affected dev server remain to be qualified. |
| `postcss-selector-parser@6.0.10` through Tailwind typography (moderate) | The latest typography 0.5.20 still pins this version. It is used to parse build-time CSS selectors. The [fix](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) is in 7.1.6, outside the parent's pinned version. No untrusted production selector-parsing route was identified by this scoped review; final bundle/image review remains open. |
| `katex@0.16.47` through Mermaid (low) | Mermaid 11.17.2 and current 12.1.0 both retain the affected KaTeX range. The [advisory](https://github.com/advisories/GHSA-238p-pmpm-9mq7) requires pre-existing prototype pollution and unsanitized rendered output. Our Markdown renderer requests `securityLevel: strict`; Mermaid's installed renderer sanitizes final SVG with the updated DOMPurify. This reduces the identified exposure but does not certify every rendering path. A compatible parent fix or separately qualified KaTeX update is still needed. |
| `cli@0.3.1` (low) | The finding has no dependency path. `cli/package.json` names the local package `paperclipai`, and the source lock has no npm `cli@` entry. Evidence supports a workspace-name collision, not installation of npm's vulnerable `cli` package. Retain the raw finding until the production SBOM confirms package identity. |

These are recorded dispositions for further qualification, not acceptance of
release risk. The high/critical CI gate remains unchanged.

## Verification

Private logs continue in
`knowledge/august-works/2026-10-06/implementation-evidence/`.
Node 24.21.0 and pnpm 9.15.4 are used for package checks.

- Frozen installation after both update batches passed (`35`, `39`).
- A fresh detached checkout at `bbfb958c9` installed frozen/offline with scripts
  enabled (`52`), a clean tracked tree and lock SHA-256
  `b87f3276be2feca69a7d6882b2bc7065a0ab78a0caba2e5c2ff833e1189ad208`.
  It reused the package cache, not an existing node_modules directory; cold
  registry availability is not established by this check.
- Negative controls (`41`) reproduce the bracket-array and invalid-body-limit
  failures in qs 6.15.0/body-parser 2.2.2; the patched versions reject them.
- Local native smoke (`42`) checks Sharp/librsvg versions, SVG-to-PNG output,
  link-local address classification, cross-family subnet rejection and
  rejection of an overlong IPv6 input.
- Six targeted server suites passed, 69 tests (`43`): parser regressions,
  malformed JSON, SVG uploads, announcements, avatar handling and AgentMail
  webhook signatures.
- Codex startup trust initially failed 8/9 tests with the updated TOML parser
  (`44`); after preserving parser tables, all 9 passed (`46`).
- The first broad test attempt (`45`) hit a 768 MiB JavaScript heap ceiling.
  Its process group was stopped after the observed failure before retrying
  with a 1536 MiB ceiling (`47`). A detached fixture HTTP server was later
  identified by its cancelled-test working directory and stopped separately.
- That retry hit `/tmp`'s user write quota (system error -122/EDQUOT), reproduced
  independently in a single previously passing suite (`48`). It was stopped,
  not accepted. With disk-backed temporary storage, the affected tool-access
  suite and real-CLI sharding regression passed: 352 tests in 2 files (`49`).
- The disk-backed full-suite retry (`50`) was interrupted without a final
  summary or exit marker. No test process remained on resumption. It is
  incomplete and cannot establish a full-suite pass.
- Runner TypeScript checking of the TOML compatibility fix passed (`51`).
- The broad run found two email connector failures, reproduced independently
  (`55`): lookup attempted to read the enclosing workspace's nonexistent
  AgentMail skill. After the shared resolver fix, all 26 email integration tests
  and 120 adapter utility tests passed (`56`). The broad run is diagnostic,
  not an immutable-tree qualification: this fix was made after it started.
- Recursive typecheck (`36`) progressed through the Rust check and built the
  native release Runner, but the server TypeScript compiler was killed with
  exit 137. Kernel evidence (`54`) confirms global out-of-memory with exhausted
  swap. This run overlapped tests and is not a successful full typecheck.
- Broad-test runtime-environment failure was rechecked after temporary-directory
  cleanup: the isolated test passed (`53`); the other 160 cases were filtered
  out, not covered by that diagnostic. The earlier broad failure remains recorded.
- Sequential recursive typecheck (`57`) still failed in server tsc with exit
  137. Kernel evidence confirms OOM with no competing test/build process.
- A resource-bounded retry (`58`, `GOMEMLIMIT=1800MiB`, `GOGC=40`,
  `GOMAXPROCS=2`) also ended at server tsc with kernel-confirmed OOM, exit 137.
  A targeted termination was attempted near exhaustion, but the kernel kill
  determines the recorded outcome. An orphan UI compiler was stopped before
  continuing the separately tracked UI/CLI checks.
- This 4 GiB host has not qualified a full server typecheck. Repeating the same
  full build here would encounter the same compiler dependency; a fresh full
  build is deferred to a suitable isolated verification host, not marked passed.
- UI typecheck passed (`59`). CLI typecheck was intentionally stopped with
  SIGKILL at renewed memory pressure (~5.2 GiB of 6 GiB swap used); its exit 137
  is not a compiler diagnostic or a claimed kernel OOM. CLI checking remains open.
- Final source at `2dd45628d`: all 161 workspace-runtime tests and 26 email
  integration tests passed together (`60`, 187 total, no skips). This includes
  the database-backed runtime cases previously skipped by the `/tmp` failure.
- All 120 shared adapter-utility tests passed separately (`61`, no skips).
  An unmatched adapter filename in the `60` invocation selected no adapter
  tests; `61` explicitly selects the correct suite. Counts reflect actual output.
- Full suite and full build remain unqualified; no green release claim is made.

## Release status

**NO-GO remains in force.** No push, release, provider call or deployment is
authorized or performed by this follow-up. GitHub rulesets, independent review,
remaining upstream workflow conversion, image/SBOM evidence and live operational
qualification remain outstanding as listed in implementation 1.


## Shortest credible route to a pilot (proposal, not release approval)

Move verification to a production-like **staging** environment with sufficient
memory. Do not replace missing evidence with code-review sign-off or run
negative security/migration tests against production customer data.

1. Pin the source commit and lock. Review the release-foundation diff and build
   the actual control-plane/backup artifacts on the larger host. Preserve build,
   typecheck, dependency/image scan, SBOM and provenance results.
2. Use synthetic tenants and separate staging credentials. Verify startup,
   login, cross-tenant denials, secret handling, supported draft budget
   reservations and cancellation/publication fencing. Rehearse fresh/upgrade
   migrations, backup restore and rollback against the actual artifacts.
3. Run the broad suite in staging/CI while investigating failures. Record
   skips and failures explicitly; critical-path failures block pilot activation.
   Any proposed deferral of noncritical checks needs an explicit disposition,
   not an implicit waiver of the repository's release gates.
4. Before inviting users, agree the narrow outcome, data class, operator,
   budget and rollback/stop criteria. The previously proposed operator-assisted
   `aw_text_only` internal draft is not yet an accepted product scope.
5. Keep unqualified capabilities closed. The V7 readiness ledger still marks
   native OpenShell host bridging, physical credential-use brokering/revocation
   and pre-spend enforcement for managed autonomous sessions incomplete. A
   narrow pilot cannot be represented as full V7 production readiness.

This supplements the existing A00–A10 and readiness requirements; it does not
replace their evidence or authorize provisioning, spend, external provider
calls, production activation, invitations or deployment.
