# August Works v2 — release foundation, implementation 1

Date: 2026-10-06. Baseline: `4686ec66ce2cc62dd752a316d7074780577b2e91`.
Branch: `fix/aw-v2-release-foundation`.

## Scope and decision

Implement the dependency/security/CI foundation from v2 A01–A03 before changing
SaaS bootstrap or enabling capabilities. This is not completion of A00–A03,
a release candidate, or an authorization to deploy. No cloud resources,
provider calls, customer invitations, publishing, or GitHub settings changed.

The proposed R1 remains an invited, operator-assisted `aw_text_only` internal
draft with human acceptance. The first customer outcome, budget, provider,
data class and operator are still product/operational decisions. R2 retains
the V4 platform, V5 runtime/multiorg, V6 SaaS and V7-v2 safe-execution requirements.
A small R1 is not a waiver of tenant/auth/secret/spend/deletion controls.

## Implemented

| v2 finding / package | Change | Qualification boundary |
| --- | --- | --- |
| F01 / A01 | Reconcile declared manifests and SCIM patch with the source lock. Pin local/AW/PR/Docker CI Node to 24.21.0; retain pnpm 9.15.4. | Clean-install evidence below; no hidden resolution repair. |
| F02 / A02 | Patch affected proxy/routing/YAML/URI/glob/source-map/Undici versions within their major lines; update grpc-js, Multer and Cursor SDK. | Cursor SDK update removes the obsolete Connect Node → Undici 5 chain; no cross-major Undici override. |
| F02 / A02 | Validate IP/CIDR trust configuration with `node:net.isIP` and safe hop integers; regression-test actual Express trust resolution and forwarding headers. | Local application boundary only, not the deployed load-balancer chain. |
| F01/F03 / A03 | PR, AW V4/V6 and Docker verification use frozen installs and reject lock changes. PR calls this repository's workflow at the same commit. Pin external Actions in these workflows. | GitHub branch protections and independent review still need configuration/verification. |
| F01 / A03 | Remove the obsolete manual-lock-edit ban and inline repair/ephemeral lock commits. Refresh is manual, reviewable maintenance without auto-merge. | Privileged `pull_request_target` stays on base-branch code; initial PR can still see the old rule until merged. |
| F02/F04 / A03 | Add the high/critical production-advisory gate; bind SaaS image input lock to both contract checksum and checked-out source. | No SaaS image built, scanned, published or deployed here. |

No new dependency or application abstraction was introduced for IP validation.
Existing CI caches, shard coverage and restricted upstream runner routing are
preserved. The lockfile policy in `doc/DEVELOPING.md` changes with the code.

## Security evidence and residual findings

The configuration-dependent proxy issue is
[GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h).
The new Express regression failed with proxy-addr 2.0.7 and passed with 2.0.8.
It checks that short IPv6 prefixes do not inadvertently trust IPv4 peers,
that a correct IPv4-mapped prefix works, and that an untrusted peer cannot
select its client IP/protocol through forwarding headers. Invalid IPs,
malformed CIDRs and unsafe integer hop counts fail parsing.

Production audit after initial lock reconciliation/direct updates reported
1 critical, 19 high, 34 moderate and 11 low findings. Final source-lock audit
reports **0 critical, 0 high, 18 moderate and 5 low**. Counts are pnpm audit
counts, not unique exploitable application bugs. No advisory is suppressed.

Residual triage is open and owned by Morse before R1 release; this table is
not a risk acceptance or a claim of non-exploitability:

| Package / graph path | Current observation | Required follow-up |
| --- | --- | --- |
| `qs@6.15.0`, `body-parser@2.2.2` via Express | Production HTTP parsing; potentially reachable. | Compatible fixes plus malformed query/body and size-limit regressions. |
| `hono@4.13.2`, `ip-address@10.5.0` via Claude ACP → MCP SDK | Adapter transitives; installed does not establish runtime reachability. | Update compatible parent/patch versions; prove parser, rate-limit and address behavior. |
| `dompurify@3.4.14` in server and Mermaid | App sanitizers do not use `IN_PLACE`; this alone does not clear the Mermaid path. | Patch and verify SVG/announcement/diagram sanitization. |
| `smol-toml@1.8.0`, `fast-copy@4.0.2` | Runner/server config parsing and Pino pretty-printer. | Update with config-size/depth regression checks. |
| `uuid@10.0.0` via Svix | Affected buffer API not yet traced through the parent. | Parent compatibility/reachability review; do not force an unreviewed major. |
| `esbuild@0.18.20` via Drizzle loader | Advisory concerns exposed dev-server behavior, not merely compilation. | Prove final runtime contents and absence of exposed affected dev server; prefer parent upgrade. |
| `katex@0.16.47` via Mermaid; `postcss-selector-parser@6.0.10` via typography | Affected versions cross a minor/major boundary for published fixes. | Parent upgrade and rendered-output/build verification. |
| `cli@0.3.1` with empty dependency paths | Probable workspace-name false positive: local `cli/package.json` is named `paperclipai`, not npm `cli`; no `cli` package entry in the lock. | Confirm against final production SBOM; retain raw finding meanwhile. |

## Verification

Detailed commands, exit statuses and logs are retained in the private
`knowledge/august-works/2026-10-06/implementation-evidence/` directory.
Only sanitized outcomes belong in this repository; no private brief corpus,
credentials or raw application logs are committed.

All verification below used Node 24.21.0 and pnpm 9.15.4 where applicable.
Implementation commits: `5ca124a7c` (dependencies/proxy) and `5ff2a29d6`
(CI policy). These are local commits; nothing was pushed or deployed.

| Check | Observed result | Evidence log |
| --- | --- | --- |
| Frozen installation in the working checkout, scripts enabled | Passed; includes the reconciled SCIM patch. | `02`, `08`, `20` |
| Two fresh worktrees at `5ff2a29d6`, `pnpm install --frozen-lockfile --offline` | Both exited 0, with scripts enabled and clean tracked trees. They reused the existing pnpm content-addressed store, not existing node_modules. This is not a cold-registry availability test. | `31-clean-install-summary.log`, `31-clean-install-{1,2}.log` |
| Proxy, forwarding headers, board mutation guard, Cursor adapter | 58 tests passed across 6 files. | `25-recovered-boundary-adapter-tests.log` |
| Tool-access service and V6 SaaS config | 383 tests passed across 2 files after building the plugin SDK. | `28-plugin-sdk-build.log`, `29-sdk-recovery-saas-tests.log` |
| CI scripts and test sharding | 425 checks passed. | `14-ci-policy-tests.log` |
| Six changed workflows | Actionlint passed; shellcheck was disabled. | `16-actionlint.log`; repeated after the restart |
| Database typecheck and migration guards | Passed with bounded compiler memory. | `15-db-typecheck-memory-bounded.log` |
| Production source-lock audit | 0 critical, 0 high, 18 moderate, 5 low; not an image scan. | `22-final-audit.json` |
| Full recursive typecheck | **Not passed.** Initial run exited 137; sequential memory-bounded retry progressed past the DB and failed because `cargo` is absent. | `13`, `17` |
| Full build | **Failed:** native Tailscale broker build cannot spawn the missing C compiler `cc`. Rust/Cargo is also required downstream. | `27-build.log` |
| Full test suite | **Incomplete:** interrupted by the restart without a final result. A collection failure was reproduced as a missing plugin-SDK build, then the affected selected suite passed after building it. The complete suite was not rerun or certified. | `21`, `26`, `28`, `29` |

Both clean installs preserved lockfile SHA-256
`2c0e6cfd9a2ebd14303ffb55a562274f373d00272effd0571035974432851745`.
An earlier fresh install under `/tmp` failed with a pnpm store-write error
(`ERR_PNPM_UNKNOWN`); it is retained as failed evidence in `30`, not counted
as a successful install. The successful worktrees used the disk-backed
workspace and existing store. Installation warns about workspace executable
links whose generated build outputs do not exist yet; install success does
not establish build success.

The 441 selected application/adapter tests and 425 CI/script checks are not
the full repository suite. Browser/release-smoke, clean image builds, cold
registry installation, GitHub CI/rulesets and live proxy-chain tests are not
qualified by this work. Missing native build tools are local verification
prerequisites, not evidence that the untested code is correct. No source
checks were disabled to hide these failures.

## Remaining release work and rollout

1. Complete residual advisory triage/fixes and run the full checks on a suitable
   build host with the pinned Rust toolchain and native build prerequisites.
2. Convert or disable the remaining upstream release/evaluation paths before
   treating them as AW release paths. In particular `release*`, cloud-migrator,
   Storybook, Sentry and live Runner evaluation workflows still contain
   non-frozen installs. This change does not claim to close all of F01/F03.
3. Require the correct checks/review in GitHub rulesets; independently review
   workflow and proxy changes. Do not work around the transitional quality
   comment by running untrusted PR code with a privileged token.
4. Finish A00's R1 requirement/threat register, then A04–A10 bootstrap,
   invitations, entitlement, model-profile, privacy, boundary and deletion work.
5. Build digest-pinned SaaS control/backup images, preserve SBOM/provenance,
   verify fresh/upgrade migrations and qualify deployment/rollback/restore.
   The existing Docker `production` target is not a qualified SaaS release.

Threat boundaries touched here: source/manifests → resolved dependencies →
CI artifacts/images, and socket peer → trusted proxy chain → application
identity. Remaining browser/app/DB/jobs/provider/secret-store/backup boundaries
are unchanged and not newly qualified by these tests.

Rollback: revert each coherent source/manifests/patch/lock change together.
Never roll back only the lockfile or an applied patch. CI-policy rollback must
not authorize deployment of an unreviewed graph; keep the release blocked.

**Release decision: NO-GO.** Local regression success is not CI or live qualification.
