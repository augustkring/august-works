# Native governance and protected policy-proof inputs — 2026-11-10

This is an incremental draft checkpoint against the retained V10 rev4.0 brief. It does not establish full V10 acceptance. Each receipt records a separate exact source window; source manifests take precedence over a later commit identifier.

- r151: all 86 Node Host tests pass, with no Docker skip. The gated test uses actual local Docker, the built RT01 runtime and pinned OpenShell prover. It verifies read-only staged proof inputs, exact-path containment and refusal of unsupported ancestor-only filesystem containment. Ancestor audits also reject immutable-image symlinks. Local Docker uses `vfs`; this is not the required physical production Host qualification.
- r153: all 12 governance integration tests pass against embedded PostgreSQL. Platform Skill inventory is reconciled in the shared bind transaction before authority hashing. Existing skill and runtime-configuration changes still invalidate authority.
- r157: all 29 Native execution-input tests pass. The actual Human review-withdrawal integration still fails; these component cases do not qualify that lifecycle.
- r158: the actual first-result regression passes through the shared production governance owner, with the fixture workaround removed. It verifies one current native task/run/review and replay without execution or new grants.
- r155: full server TypeScript passes before the later software-peer test overlay.
- r159: full server TypeScript finds five errors in that new test overlay. The retained log records them. r161 closes these type errors: full server TypeScript passes in 102.17 seconds with unchanged source pins and no OOM.
- r160: 55 of 56 policy/Host-bridge tests pass. The added synthetic fixture cannot satisfy the production provider qualification owner. The added synthetic owner assertions were removed; the real owner is exercised by the pending SDK conformance path. r162 then passes all 56 policy and signed-bridge cases with unchanged source pins and normal cleanup. Production qualification checks stay strict.

The provider-conformance proof maximum narrows filesystem roots to the current exact Task and runtime/model helpers. The original operator boundary, hash and refs remain retained. The signed bridge independently derives the same maximum from the current Human/Task/Plan/Run/manifest/lease/workspace owner. Ordinary nested filesystem proofs remain unsupported by the pinned prover and fail closed.

The new signed software peer executes the actual pinned prover and labels its observations `software_only_host_peer` with `physicalQualification: false`. Its complete SDK attachment and six-probe runs are pending. It must not stand in for physical Host enforcement, paid-provider qualification, final privacy/erasure checks or representative Human acceptance.

Runtime build: source `6648bd0c290efbc41ba131ee9831ee45cd431f94`, retained RT01 patch digest `f8cc9c552cb71a974a8b00821438e365f29ad49b182177fe3aa0c3ba67c43012`, Cargo.lock `ea10e2922eece4077a2c1be17cac83214aa5f79f39fd6c5cc830e1a2cf9d459a`. Build used Rust 1.97.1; upstream asks for 1.95.0, so this is not release-toolchain qualification. Runtime SHA-256 `f679705bb968b8a34c0b4695ccd319bff8f9818db92ca0416bbed76f15a1abba`; prover SHA-256 `3e80c0d041a7552d57cc338868bc825a6261e21b5f29a7d7527bcc7926d423f1`; local image `sha256:931bf7f4f0e29397a69991b46f628ac7ee7a53c73e964f50064f0ce5662f26d6`.

No historical phase status, deployment, release or merge approval is promoted. PR 42 remains draft.
