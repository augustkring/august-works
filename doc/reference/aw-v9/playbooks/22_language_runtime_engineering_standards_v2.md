
# 22 — Language & Runtime Engineering Standards — V2
## Universal language/runtime principles and production profiles for TypeScript, JavaScript, Python, Go, Rust, Java/Kotlin, C#, Swift, C/C++, SQL, Solidity and Shell

```yaml
document_id: SWE-22
version: 2.0-REVIEWED
status: REVIEWED
created: 2026-09-27
last_updated: 2026-09-27
last_reviewed: 2026-09-27
evidence_cutoff: 2026-09-27
canonical_language: English
artifact_type: domain_playbook
primary_archetype: capability + execution + decision
rigor_level: L3-CONTROLLED
volatility: mixed
inherits:
  - MPS-001 Master Playbook Standard v2.0-RC1
  - Universal Software & AI Engineering Master Playbook v2.0
applies_to:
  - application code
  - services and engines
  - libraries and SDKs
  - CLI and automation
  - data and database code
  - systems software
  - smart contracts
  - AI-generated engineering output
supersedes: SWE-22 v1.0-DRAFT
out_of_scope:
  - framework-specific style guides
  - vendor-specific cloud architecture
  - domain safety certification
  - language tutorials
```

> **V2 status note.** V2 is the falsification- and freshness-reviewed successor to V1. It incorporates the V1 audit across version status, preview/stable boundaries, package/build supply chain, ABI/FFI, ambient runtime state, ordering, SQL dialect semantics, polyglot systems and language-specific edge cases. The audit found no architecture-breaking BLOCKER defect but required material revisions. Status is therefore `REVIEWED`, not `VALIDATED`: representative non-author execution against real repositories/systems is still required before field validation.

---

# Executive standard

A programming language is not merely syntax and a runtime is not merely an execution engine. Together they define a material part of the system contract: types, memory, concurrency, failure, modules, dependency resolution, build behavior, ABI/FFI boundaries, deployment assumptions, diagnostics and upgrade risk.

The governing chain is:

```text
SYSTEM REQUIREMENTS
→ LANGUAGE / RUNTIME FIT
→ EXPLICIT VERSION + TARGET CONTRACT
→ MODULE / PACKAGE BOUNDARIES
→ TYPE + STATE + ERROR SEMANTICS
→ MEMORY + RESOURCE + CONCURRENCY SEMANTICS
→ DETERMINISTIC TOOLCHAIN + DEPENDENCIES
→ RISK-DRIVEN VERIFICATION
→ IDENTIFIED ARTIFACT + RUNTIME
→ OBSERVABLE OPERATION
→ CONTROLLED UPGRADE / RETIREMENT
```

The core doctrine is:

> **Choose and configure a language/runtime because its semantics, ecosystem, operational model and assurance mechanisms fit the system—not because the language is fashionable or presumed to create quality by itself. Make the actual compiler/interpreter/runtime version part of the deployment contract; use the strongest practical static and dynamic checks; validate untrusted runtime data even in typed languages; make memory, concurrency, error and resource semantics explicit; and treat toolchains, packages, native extensions and generated code as supply-chain dependencies.**

---

# 1. Purpose, scope and outcomes

This playbook establishes:

1. universal language/runtime engineering principles that apply across technologies;
2. a decision framework for selecting languages and runtimes;
3. minimum production controls for versions, builds, dependencies, analysis, tests and runtime operation;
4. language-specific profiles for twelve language families;
5. upgrade, migration and compatibility rules;
6. AI-assisted engineering controls at language/runtime level;
7. an evidence and freshness model that prevents previews, drafts or folklore from becoming silent production standards.

A conforming project should be able to answer:

- Which language, language edition/standard and runtime implementation are we using?
- Which exact versions are supported in development, CI and production?
- Which properties does the type system prove, and which still require runtime validation?
- What are the error, memory, resource, concurrency and cancellation semantics?
- How are dependencies resolved and locked?
- Which compiler/linter/analyzer/test/sanitizer checks are required?
- Which runtime/platform-specific assumptions exist?
- What is the compatibility and upgrade policy?
- Which unsafe/dynamic escape hatches exist, and how are they reviewed?
- Can a different engineer or AI agent reproduce the toolchain and build?

---

# 2. Evidence and normative language

This playbook inherits the Master Playbook Standard's distinction between evidence, recommendation strength and contextual implementation. Rules use:

- **MUST / MUST NOT** — house requirement for production conformance; exceptions require rationale and risk ownership.
- **SHOULD / SHOULD NOT** — strong default with documented contextual exceptions.
- **MAY** — optional mechanism.
- **JUDGMENT REQUIRED** — no universal deterministic choice is justified.

Claim status:

- `REQ` authoritative external requirement in a defined scope;
- `EST` well-established engineering practice;
- `DEF` recommended default;
- `CTX` context-dependent practice;
- `EMG` emerging/fast-moving practice;
- `HOUSE` deliberate standard for this playbook;
- `UNK` unresolved material uncertainty.

Source priority is claim-fit, not brand prestige. Language specifications and official runtime documentation are authoritative for their semantics, not for proving that the technology is the best choice.

---

# 3. Language/runtime domain model

A production language/runtime profile is a **stack of contracts**, not one version number:

```text
LANGUAGE / STANDARD / EDITION
→ COMPILER OR INTERPRETER IMPLEMENTATION
→ STANDARD LIBRARY / CORE RUNTIME
→ VM / EXECUTION ENGINE / HOST API (where applicable)
→ BUILD TOOL + PACKAGE / MODULE RESOLVER
→ BUILD-TIME EXECUTABLE PLUGINS / MACROS / GENERATORS
→ TARGET OS / ARCH / ABI / DEPLOYMENT PLATFORM
→ NATIVE / EXTERNAL RUNTIME DEPENDENCIES
→ RUNTIME FLAGS + AMBIENT PROCESS STATE
```

A project MUST record every layer that can materially change observable behavior, artifact compatibility, security, performance or supportability. A language specification can define syntax and semantics without defining host APIs, package-manager behavior, JIT/AOT details, database dialect behavior, ABI compatibility or vendor support horizon.

## 3.1 Version/status model

Distinguish:

- **language/edition status** — published standard, stable language release, draft/preview;
- **implementation status** — compiler/interpreter/runtime release and patch level;
- **support channel** — LTS, active, maintenance, EOL or vendor-specific equivalent;
- **deployment target** — minimum OS/runtime/VM/chain/DBMS/browser/architecture actually supported;
- **ecosystem compatibility** — framework, compiler API, build plugin, native extension and package support;
- **local qualification** — evidence that the project's own build/tests/operations work on that stack.

`Latest`, `stable`, `LTS` and `supported` are not synonyms.

---
# 4. Version baseline at the V2 research cutoff

| Profile | Current stable / normative baseline at 2026-09-27 | Watch item / production note |
|---|---|---|
| TypeScript | TypeScript 7.0 stable | Compiler/runtime tool integration must be rechecked across major upgrades |
| JavaScript | ECMAScript 2026; Node.js 24 Active LTS for production Node workloads | Node.js 26 is Current and scheduled for LTS transition after cutoff |
| Python | CPython 3.14 stable line | Python 3.15 is release-candidate, final scheduled 2026-10-01 |
| Go | Go 1.27 stable line | Go supports each major until two newer major releases |
| Rust | Rust 1.98.1 stable; Rust 2024 edition current | Rust toolchain releases frequently; define MSRV where consumers need it |
| Java | Java SE / JDK 27 latest feature release; JDK 25 latest Oracle LTS | Production support horizon depends on JDK distributor/support policy |
| Kotlin | Kotlin 2.4.20 stable | Kotlin 2.5.0 Beta is pre-release |
| C# / .NET | C# 14 on .NET 10 LTS | C# 15 / .NET 11 are preview |
| Swift | Swift 6.4 | Swift 6 language mode provides full data-race checking |
| C | ISO/IEC 9899:2024 (C23 publication) | Compiler support for all C23 features varies |
| C++ | ISO/IEC 14882:2024 (C++23 publication) | C++26 replacement is DIS/under development, not final |
| SQL | ISO/IEC 9075:2023 family (+ applicable corrigenda) | Real semantics remain DBMS/dialect/version-specific |
| Solidity | Solidity 0.8.37 stable | Compiler known-bug list and target EVM version are release-critical |
| Shell | POSIX.1-2024 / Issue 8 shell language; Bash 5.3 current GNU Bash line | POSIX sh and Bash are distinct target profiles; do not write accidental hybrids |

**Rule:** current version is not automatically the production default. Production should use a supported stable line whose ecosystem, dependencies and deployment environment are verified.

---

# 5. Universal language/runtime principles

## LR-01 — Language choice is contextual
`EST / HIGH`

No language is universally “better software.” Select from system requirements: safety, memory model, latency, throughput, startup, footprint, ecosystem, platform, interoperability, team competence, build/deploy model, support horizon and assurance needs.

## LR-02 — The runtime is part of the system
`EST / HIGH`

The same source language can behave differently across runtimes, implementations, OS/architecture, standard libraries and host APIs. Runtime identity MUST be explicit where it affects behavior.

## LR-03 — Pin the semantic contract
`HOUSE / HIGH`

Production repositories MUST identify, as applicable:

```yaml
language:
language_edition_or_standard:
compiler_or_interpreter:
compiler_or_interpreter_version:
runtime:
runtime_version:
target_os_arch:
standard_library_version_or_distribution:
build_tool:
package_manager:
lock_or_resolution_artifact:
```

## LR-04 — Stable is a status, not a guarantee
A stable release can still contain defects. Preview/beta/RC/nightly features MUST NOT become production dependencies without explicit justification, isolation, compatibility plan and risk acceptance.

## LR-05 — Support horizon matters
Choose a version whose security/update/support horizon fits expected service life. Unsupported runtimes MUST be treated as security and operational debt.

## LR-06 — Types reduce classes of error; they do not validate reality
Static types MAY make invalid program states harder to represent. They do not prove that network payloads, files, environment variables, database rows, user input or third-party responses satisfy those types. Validate at trust boundaries.

## LR-07 — Prefer explicit absence/nullability semantics
Represent absence intentionally. Avoid sentinel ambiguity, unchecked null dereferences, implicit missing-field assumptions and “undefined means anything” designs at important boundaries.

## LR-08 — Convert domain invariants into enforceable constructs
Where practical, encode important invariants in types, constructors, enums/sealed unions, schemas, database constraints, state machines or validated value objects.

## LR-09 — Escape hatches increase assurance burden
Dynamic evaluation, reflection, unsafe memory operations, FFI, unchecked casts, raw pointers, arbitrary shell execution, compiler extensions and metaprogramming MUST be localized and reviewed according to consequence.

## LR-10 — Errors are part of the API
Public/module boundaries MUST define whether failure is represented by return value/result, exception, panic/trap, process exit or asynchronous rejection. Error context and recoverability SHOULD be preserved without leaking secrets.

## LR-11 — Do not use crash mechanisms for expected domain outcomes
Panics, assertions, traps and fatal exits SHOULD represent programmer/invariant or unrecoverable process conditions, not normal validation/business errors, unless the runtime/domain explicitly makes another contract appropriate.

## LR-12 — Cleanup must be structural
Prefer language mechanisms that bind resource lifetime to scope or explicit ownership: RAII, `defer`, context managers, `using`, `defer`-style constructs, structured task scopes or `try/finally`. Cleanup that depends on “remembering later” is weak.

## LR-13 — Cancellation is a semantic contract
Long-running or remote work SHOULD define cancellation/deadline behavior. Cancellation MUST NOT silently leave critical state half-mutated without recovery semantics.

## LR-14 — Concurrency model must be named
Document whether the runtime uses threads, goroutines, tasks/event loops, actors, processes, async state machines, cooperative scheduling, parallel interpreters or another model. Do not infer thread safety from single-threaded tests.

## LR-15 — Shared mutable state requires a synchronization story
When state is accessible concurrently, define ownership, allowed writers/readers, synchronization, ordering, atomicity and lifecycle. Language memory-safety does not automatically provide race-free business semantics.

## LR-16 — Avoid orphaned asynchronous work
Spawned tasks, goroutines, promises, threads or child processes SHOULD have an owner, bounded lifetime, completion/error handling and cancellation strategy.

## LR-17 — Memory semantics are production semantics
For manual/unsafe memory languages, undefined behavior, lifetime, aliasing and bounds safety are first-class risks. For managed languages, allocation/GC/retention/pinning/finalization can still affect latency and availability.

## LR-18 — Numeric semantics must be intentional
Integer width, signedness, overflow, floating-point precision, decimal arithmetic and conversion rules MUST be chosen according to domain. Financial/accounting quantities SHOULD NOT rely on binary floating point where exact decimal semantics are required.

## LR-19 — Time, timezone and locale are not primitive strings
Use runtime date/time types with explicit timezone/offset semantics. Use monotonic clocks for durations where supported. Avoid locale-sensitive parsing/formatting for machine contracts unless the contract says so.

## LR-20 — Text encoding must be explicit at boundaries
Use Unicode-aware APIs and define byte/text boundaries. UTF-8 is the preferred default for new text protocols/artifacts unless an external contract requires another encoding.

## LR-21 — Module/package boundaries should reduce change coupling
Use the language's native module/package system to express ownership and public surface. Internal implementation details SHOULD remain non-public unless consumers genuinely require them.

## LR-22 — Public API compatibility is a deliberate product choice
Library/API authors MUST define compatibility policy for source, binary/ABI, serialized data and behavioral semantics as applicable.

## LR-23 — FFI/ABI crossings are trust boundaries
Foreign code can violate the source language's type, memory, exception and concurrency assumptions. FFI signatures, ownership, allocation/freeing, calling convention, error propagation and thread rules MUST be explicit.

## LR-24 — Generated code needs ownership
Generated code MUST have a canonical generator/input, deterministic regeneration path where practical, and a policy for whether generated output is committed. Do not manually fork generated truth without intent.

## LR-25 — Metaprogramming must earn its complexity
Macros, annotation processors, source generators, reflection and compile-time code generation MAY reduce duplication or enforce policy, but SHOULD NOT hide critical control flow or security decisions from reviewers.

## LR-26 — Toolchains are supply-chain dependencies
Compilers, interpreters, package managers, build plugins, linters, generators and native toolchains MUST be versioned/controlled proportionate to risk.

## LR-27 — Lock resolved dependency state for deployable artifacts
Deployable applications/services SHOULD use the ecosystem's supported lock/resolution mechanism and CI should fail rather than silently rewrite resolution state.

## LR-28 — Locking and updating are complementary
A lockfile is not a vulnerability strategy. Pin/lock for reproducibility; monitor; update deliberately; verify; release.

## LR-29 — One canonical formatter
Where a mature canonical formatter exists, use it mechanically. Do not spend recurring review effort on formatting preferences that tooling can enforce.

## LR-30 — Warnings and analyzers are part of verification
Enable strong compiler diagnostics and static analysis appropriate to the language. New warnings introduced by upgrades MUST be triaged, not globally silenced without review.

## LR-31 — Do not equate zero warnings with correctness
Static checks are evidence about covered properties. They do not replace runtime, integration, security, concurrency, migration or performance verification.

## LR-32 — Test at semantic boundaries
Tests SHOULD exercise parsing/serialization, error behavior, concurrency, cancellation, resource cleanup, native/FFI edges, package/API compatibility and platform-specific paths where relevant.

## LR-33 — Use dynamic bug detectors where the language/runtime provides them
Race detectors, sanitizers, fuzzers, leak detectors and profilers SHOULD be used for risk classes they can observe. They are not production hardening by themselves.

## LR-34 — Build and test more than one optimization mode when it can change behavior
Debug-only success is insufficient for native/optimized code. Release/optimized builds MUST be exercised before release where optimization, integer behavior, linking or code generation can expose defects.

## LR-35 — Build target and deployment target must match
Compiler target, CPU features, OS/libc/SDK level and runtime image MUST reflect the production environment. “Builds locally” is not compatibility evidence.

## LR-36 — Prefer reproducible environment setup
A clean machine or container should be able to install the required toolchain and reproduce build/test behavior using repository-controlled configuration.

## LR-37 — Production diagnostics must survive optimization
For production incidents, retain enough symbols/source mapping/build IDs/version metadata to turn crashes, stack traces and profiles into actionable evidence without shipping unsafe debug behavior.

## LR-38 — Benchmark the deployed shape
Language/runtime performance claims MUST be measured on representative workloads, data and build modes. Microbenchmarks do not establish end-to-end performance.

## LR-39 — GC and allocator behavior require measurement, not mythology
Tune garbage collectors, heaps, allocators and pools only from workload evidence and latency/memory objectives. Defaults are hypotheses, not sacred values.

## LR-40 — Runtime configuration is code-like operational state
Environment variables, runtime flags, feature switches, JVM/CLR/Node/Python flags, allocator options and compiler profiles that affect semantics/performance MUST be documented and change-controlled when material.

## LR-41 — Upgrade one semantic layer at a time when practical
Separate language/runtime major upgrades from unrelated architecture changes. Establish before/after tests, deprecation inventory and rollback/roll-forward path.

## LR-42 — Preview features need an exit plan
If adopted, record owner, reason, isolation, migration trigger and behavior if the feature changes or disappears.

## LR-43 — AI-generated language-specific output is untrusted
AI-written code, compiler flags, package constraints, FFI, SQL, shell commands and unsafe blocks MUST be validated against current language/runtime semantics and project tests.

## LR-44 — AI self-review is not independent assurance
Use compiler/type checker/analyzer/tests/sanitizers/runtime evidence and human/domain review proportionate to risk.

## LR-45 — Prefer semantic clarity over clever language tricks
Concise syntax is valuable only when it preserves local reasoning, error behavior and change safety.

## LR-46 — Do not rely on unspecified or incidental ordering
If order affects correctness, make it part of the contract and enforce it. Do not infer stable semantics from hash/map/object iteration, filesystem enumeration, database row order, reflection/member order or scheduler timing unless the relevant specification/runtime explicitly guarantees it.

## LR-47 — Runtime-global state is part of behavior
Locale, timezone, current working directory, environment, umask, signal handlers, default encoding/charset, process limits and similar ambient state MUST be controlled or validated when they affect correctness, security or reproducibility.

## LR-48 — Randomness is purpose-specific
Security-sensitive tokens, keys/nonces and secrets MUST use an approved cryptographically secure source appropriate to the platform. Ordinary PRNG APIs MUST NOT be assumed cryptographically unpredictable. Tests MAY use deterministic seeds to make failures reproducible while preserving a separate production entropy policy.

## LR-49 — Text encoding and pathname representation are different contracts
Text protocols/files SHOULD use explicit encodings; UTF-8 is a strong default where the protocol permits it. OS-native pathname representations MUST be handled according to platform semantics and MUST NOT be silently forced through a text assumption that loses round-trip fidelity.

## LR-50 — Build-time code execution is code execution
Package lifecycle scripts, build backends, compiler plugins, macros, proc-macros, annotation processors, source generators, build plugins and native build steps execute with build privileges. Treat them as supply-chain code, constrain privileges, pin/review where material and keep untrusted contributions away from secrets.

## LR-51 — Separate resolution, integrity, provenance and reproducibility
A lockfile records some form of dependency resolution; it does not alone prove content integrity, trustworthy origin or bit-for-bit reproducible output. Production assurance SHOULD identify the required combination of lock/resolution, hashes/signatures, source registries, toolchain pinning, build environment and artifact provenance.

## LR-52 — Dynamic/native loading is a runtime dependency boundary
Shared libraries, native extensions, JNI/P/Invoke/dlopen-like loading, drivers and plugins can change behavior outside package-manager locks. Record native dependency identity, architecture/ABI and loader/search-path policy where material.

## LR-53 — Error taxonomies should preserve caller action
Across exceptions, result types, error values, SQL codes and process exit statuses, callers SHOULD be able to distinguish the material actions: invalid input, authorization/policy denial, conflict, cancellation/deadline, transient dependency failure, resource exhaustion and permanent/internal failure.

## LR-54 — Pre-release status can enter transitively
Controlled builds SHOULD detect not only direct preview/nightly compiler/runtime usage but also prerelease SDKs, plugins, code generators and build tools that can alter the produced artifact. Unexpected prerelease tooling is a build failure or explicit exception.

## LR-55 — Benchmark the same execution mode users receive
Debug/interpreted/JIT-cold/AOT/release/optimized modes can differ materially. Performance evidence MUST identify warmup, optimization, GC/allocator, architecture, runtime flags, workload and artifact mode relevant to production.

## LR-56 — Cross-language schemas need one canonical owner
When several languages represent one protocol/domain model, choose a canonical contract or schema and generate/validate language bindings from it where appropriate. Duplicated handwritten models MUST have compatibility tests or another drift control.

## LR-57 — Language count is an architecture cost
Each additional language/runtime adds toolchains, dependency/security updates, observability, packaging, knowledge, incident and deployment surfaces. Introduce another language only when its benefit exceeds that lifetime cost.

## LR-58 — Patch updates can be correctness/security changes
A pinned compiler/runtime does not justify ignoring patch releases. Monitor compiler/runtime correctness, security and support advisories; expedite qualification when a patch fixes a defect that can affect generated or executed behavior.

---

# 6. Language/runtime selection framework

Do not ask “which language is best?” Ask which candidate best satisfies the system's material constraints.

| Dimension | Questions |
|---|---|
| Correctness model | Which defects can the language/toolchain prevent or expose? |
| Safety | Memory safety? data-race controls? unsafe escape hatches? |
| Runtime | GC/ARC/manual memory? startup? footprint? JIT/AOT/interpreter? |
| Concurrency | Thread/task/actor/event-loop model? cancellation? structured lifetime? |
| Performance | Latency/tail/throughput constraints? predictable vs adaptive optimization? |
| Platform | Browser/mobile/JVM/.NET/native/EVM/POSIX/embedded constraints? |
| Ecosystem | Required protocols/libraries/drivers? dependency quality? |
| Interop | Existing native/JVM/.NET/JS/C ABI interfaces? |
| Operations | Diagnostics, profiling, crash handling, observability, deployment? |
| Support | Stable/LTS cadence, vendor support, EOL horizon? |
| Team | Can owners review/debug/operate it without one specialist? |
| Build/supply chain | Reproducibility, package provenance, native dependencies? |
| Assurance | Static analysis, fuzzing, sanitizer, formal/tool support? |
| Change cost | Migration, ABI/data compatibility, generated code, lock-in? |

### Decision rule

1. Define hard constraints.
2. Remove candidates that cannot meet them without disproportionate complexity.
3. Compare remaining candidates on lifecycle cost and failure risk.
4. Prototype only the highest-uncertainty properties.
5. Prefer the least operationally complex adequate choice.
6. Record assumptions and revisit triggers.

---

# 7. Universal repository/toolchain contract

Every production codebase SHOULD expose a machine-readable or clearly documented contract containing:

```yaml
language_profile:
language_or_standard_version:
compiler_or_interpreter:
compiler_or_interpreter_version:
runtime_or_vm:
runtime_version_policy:
standard_library_or_distribution:
support_channel:
build_tool:
package_manager_or_module_resolver:
lock_or_resolution_artifact:
content_integrity_policy:
registry_or_source_policy:
build_time_plugins_macros_generators:
native_or_system_dependencies:
target_os_arch_abi:
deployment_target:
format_command:
lint_command:
typecheck_or_static_analysis_command:
test_command:
dynamic_analysis_or_fuzz_command:
security_or_vulnerability_command:
release_build_command:
artifact_identity_or_digest:
minimum_supported_version_if_library:
preview_or_prerelease_policy:
upgrade_owner:
```

CI MUST run from a clean dependency/toolchain state often enough to detect hidden workstation dependencies.

---

# 8. Profile — TypeScript

## Baseline

- **Stable baseline:** TypeScript 7.0.
- **Nature:** statically analyzed superset of JavaScript; types are erased at runtime.
- **Runtime:** JavaScript host/runtime is a separate contract (browser, Node.js, worker, edge runtime, etc.).

## TS-01 — Runtime validation remains mandatory
TypeScript types do not validate JSON, HTTP input, database values, environment variables, files, messages or `JSON.parse()` results. Boundary data MUST be parsed/validated before becoming trusted domain types.

## TS-02 — Strict type checking is the default
New production projects MUST use `strict: true` unless an exception is documented. Existing migrations SHOULD move toward strictness incrementally.

Strong defaults for application/domain code SHOULD include `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` when migration cost is acceptable because they close common holes around missing indexed values and absent-vs-undefined properties.

## TS-03 — `any` is an explicit trust downgrade
Prefer `unknown` at untrusted/dynamic boundaries and narrow it. `any` SHOULD be localized, documented when material and prevented from spreading through public APIs.

## TS-04 — Type assertions do not validate
`as T`, non-null assertions and double assertions MUST NOT be used to convert untrusted input into trusted domain state without runtime evidence.

## TS-05 — Model domain states with unions, not boolean soups
Use discriminated unions/enums/value types for state machines and require exhaustive handling where consequence warrants it.

## TS-06 — Align `module`, resolution and runtime
ESM/CommonJS/bundler resolution must reflect the actual runtime and packaging contract. Avoid configurations that type-check one resolution model while production loads another.

## TS-07 — Public package exports are contracts
Libraries SHOULD define explicit package exports/types and test consumption from supported module systems. Avoid depending on package-private paths.

## TS-08 — Compiler version belongs in the repository
Pin the TypeScript compiler in the project dependency graph. Do not rely on an arbitrary globally installed compiler.

## TS-09 — TypeScript 7 migration separates application compilation from compiler-API tooling
TypeScript 7.0 is stable for ordinary compiler use, but the 7.0 release does **not** ship the historical programmatic API. Tooling that embeds, imports, patches or depends on TypeScript compiler/language-service APIs MUST be inventoried and qualified separately. Framework/tool integrations that are not ready MAY require side-by-side TypeScript 6 until a compatible TypeScript 7.x API/tool path exists. A successful application `tsc` build does not prove compiler-API ecosystem compatibility.

## TS-09A — Runtime target and lib declarations must match deployment
`target`, `lib`, module resolution and ambient types MUST not claim APIs unavailable in the actual host. Browser/Node/edge host support is verified independently of TypeScript syntax support.

## TS-10 — Do not hide compiler diagnostics for speed
Options that skip or reduce checking MAY be used with measured justification, but CI/release assurance must still detect material declaration/API inconsistencies.

## TS-11 — Async work must be owned
Promises MUST be awaited, returned, deliberately collected, or explicitly detached with error handling. Floating promises SHOULD be detected mechanically where tooling supports it.

## TS-12 — Cancellation propagates explicitly
Use the host's cancellation primitive (commonly `AbortSignal`) through async boundaries when work is cancelable. Do not invent incompatible cancellation tokens without need.

## TS-13 — Structural typing can over-accept
For security/identity/domain distinctions that must not be accidentally interchangeable, use validated constructors, opaque/branded patterns or separate runtime identifiers rather than trusting shape equality alone.

## TS-14 — Avoid ambient global type pollution
Declare required global type packages explicitly. Libraries SHOULD minimize global augmentation and document it when unavoidable.

## TS-15 — Verify emitted/runtime behavior
For transpiled or downleveled code, test the emitted target in the real runtime. A successful type check is not evidence that the target supports the generated APIs/polyfills.

### TypeScript CI baseline

```text
install frozen dependencies
→ format check
→ tsc/typecheck with project config
→ lint/static rules
→ unit + integration tests
→ boundary validation tests
→ production build
→ run smoke tests in target runtime
```

### TypeScript anti-patterns

- `as SomeType` immediately after `JSON.parse()`.
- `any` in shared domain/public interfaces.
- ignoring `Promise` results.
- mixing ESM/CJS accidentally.
- compiling against DOM/Node globals not present in deployment.
- choosing compiler flags from a copied template without knowing runtime implications.

---

# 9. Profile — JavaScript

## Baseline

- **Language:** ECMAScript 2026.
- **Node production baseline:** Active/Maintenance LTS only; at cutoff Node 24 is Active LTS and Node 26 is Current.
- **Host distinction:** ECMAScript specifies the language; browsers/Node/other runtimes provide host APIs.

## JS-01 — Name the host runtime
JavaScript code MUST not assume browser, Node.js, edge-worker or other host APIs without declaring that deployment target.

## JS-02 — Prefer supported production runtime lines
For Node.js production workloads, use Active LTS or Maintenance LTS unless Current is an explicit, tested exception.

## JS-03 — Use one intentional module model
New projects SHOULD prefer standards-based ESM when ecosystem constraints allow. CommonJS remains legitimate where compatibility requires it. The module model MUST be explicit in package/runtime configuration.

## JS-04 — Use strict dependency installs
Commit the ecosystem lockfile for deployable projects and use frozen/clean CI installation semantics (for npm, `npm ci`).

## JS-05 — Dynamic input is untrusted
Validate decoded JSON, environment variables, request payloads, messages, storage and third-party results. JSDoc/editor inference is not runtime validation.

## JS-06 — Avoid implicit type coercion in critical logic
Use explicit conversions and strict comparison by default in domain/security code. Language coercion is not forbidden, but it must not obscure invariants.

## JS-07 — Distinguish `null`, `undefined`, absent properties and holes
APIs SHOULD define which states are valid. Do not use truthiness when `0`, `false`, empty string or `NaN` are legitimate values.

## JS-08 — Promise failures require ownership
Unhandled asynchronous failure is a process/service reliability issue. Every promise chain must terminate in a consumer that handles/propagates its result.

## JS-09 — Bound event-loop work
Server runtimes using an event loop MUST not place unbounded CPU-bound work or synchronous I/O on latency-critical paths. Measure event-loop delay and offload work when required.

## JS-10 — Treat worker/thread boundaries like distributed boundaries
Messages are serialized/shared according to runtime semantics; define ownership, transfer and error behavior.

## JS-11 — Dynamic code execution is high-risk
`eval`, `Function`, shell interpolation and dynamic module loading from untrusted strings MUST NOT be used for ordinary application extensibility.

## JS-12 — Prototype/object merging requires defensive handling
Avoid unsafe merges of untrusted object keys and protect security-sensitive policy objects from prototype manipulation.

## JS-13 — Runtime API support needs feature targeting
Do not assume that ECMAScript edition support means a host API exists. Test runtime/browser/platform support independently.

## JS-14 — Process crashes and fatal errors need supervisor policy
Server-side JS MUST define behavior for uncaught exceptions, fatal runtime errors and graceful shutdown; continuing after unknown corrupted state is not automatically safer than restart.

## JS-15 — Source maps/build IDs are operational artifacts
Production minification/transpilation SHOULD retain secure access to source maps or equivalent symbolization sufficient for incident diagnosis.

---

# 10. Profile — Python

## Baseline

- **Stable:** CPython 3.14 stable line; 3.14.7 available at cutoff.
- **Watch:** Python 3.15 release candidate; final scheduled after cutoff.
- **Implementation:** CPython behavior is not automatically a Python-language guarantee for PyPy/other runtimes.

## PY-01 — Declare Python implementation and supported versions
Libraries SHOULD define supported Python versions. Deployable applications SHOULD pin the runtime image/toolchain and test the exact implementation used in production.

## PY-02 — Use `pyproject.toml` as the standard project configuration anchor
Project/build metadata SHOULD use current PyPA standards instead of ad hoc installer behavior where tooling supports it.

## PY-03 — Lock deployable dependency resolution
Use a reproducible lock mechanism supported by the chosen tooling. `pylock.toml` is a standardized lock-file format for reproducible installation, but format standardization does not imply identical support across every installer/build service. Use it when the selected toolchain supports it correctly; otherwise commit the tool-specific lock artifact and document the installer, package-index/source policy and hash/integrity behavior.

## PY-04 — Isolate environments
Development, CI and production MUST avoid accidental dependency on user/global site packages. Use virtual environments, containers or equivalent isolated environments.

## PY-05 — Type annotations are static evidence, not runtime enforcement
Run one configured static type checker in CI for typed code. Validate runtime inputs separately.

## PY-06 — Avoid broad exception swallowing
Catch the narrowest useful exceptions; preserve causal context. Broad catches at process/task boundaries MUST log/translate/rethrow intentionally rather than silently continue.

## PY-07 — Use context managers for resources
Files, locks, transactions, temporary resources and sessions SHOULD use context managers or explicit `try/finally` cleanup.

## PY-08 — Prefer structured async lifetimes
For related asyncio work, prefer `TaskGroup`/structured ownership over untracked fire-and-forget tasks. Cancellation must be propagated and cleanup-safe.

## PY-09 — Do not assume the GIL is a synchronization contract
Python 3.14 supports free-threaded CPython. Even on GIL-enabled builds, relying on incidental interpreter atomicity for shared-state correctness is fragile. Use explicit locks/queues/ownership.

## PY-10 — Free-threaded Python is a deployment choice
If using free-threaded builds, verify third-party and C-extension compatibility, performance and thread safety. Do not silently enable it because it is “more parallel.”

## PY-10A — Free-threaded adoption requires extension qualification
Before enabling free-threaded CPython for production, inventory native/C-extension dependencies, verify declared thread-safety/support, test whether extensions change GIL behavior, and run concurrency-oriented tests under the actual deployment mode.

## PY-11 — Native extensions raise the risk tier
C/C++/Rust/native extensions can bypass Python's memory guarantees and differ across interpreters/ABIs. Treat them as FFI components with platform and thread-safety tests.

## PY-12 — Serialization is a trust boundary
Unsafe object-deserialization formats MUST NOT accept untrusted content. Prefer data-only formats plus schema validation for external boundaries.

## PY-13 — Subprocess execution separates arguments from shell syntax
Pass argument arrays where possible. `shell=True` or equivalent shell interpretation of untrusted/constructed strings requires explicit security review.

## PY-14 — Mutability defaults require care
Do not use shared mutable default arguments unintentionally. Prefer immutable/default factories and explicit ownership of module/global caches.

## PY-15 — Performance claims require interpreter-aware profiling
Profile representative production code; account for interpreter, C extensions, allocation and concurrency model before rewriting critical paths.

---

# 11. Profile — Go

## Baseline

- **Stable line:** Go 1.27 (released August 2026).
- **Compatibility:** Go 1 promise; major releases supported until two newer major releases exist.

## GO-01 — Use the standard toolchain path
Production Go repositories SHOULD use `gofmt`/`go fmt`, `go test`, `go vet` and module-aware builds as baseline controls.

## GO-02 — Keep the module/toolchain contract explicit
`go.mod` MUST state the module path and language/toolchain expectations appropriate to the repository. `go.sum` MUST remain source-controlled when generated.

## GO-03 — Errors are values with causal identity
Return expected failures as errors, add context without destroying identity, and use `errors.Is`/`errors.As` where callers need classification. Do not compare error strings for control flow.

## GO-04 — `panic` is not routine error handling
Use panic for programmer/invariant failures or unrecoverable initialization conditions where process failure is appropriate. Recover only at deliberate boundaries that can restore a valid state.

## GO-05 — Context controls request-scoped lifetime
Pass `context.Context` through cancelable request/operation paths, respect cancellation/deadlines, and do not create background contexts that accidentally detach work from ownership.

## GO-06 — Every goroutine needs a termination story
Before spawning, identify who owns it, how it stops, how errors are observed and what bounds its work. Goroutine leaks are resource leaks.

## GO-07 — Channels are synchronization contracts
Choose channel direction, buffering and close ownership intentionally. Do not close a channel from an arbitrary receiver. Do not use channels merely because Go has them when a mutex or direct call is clearer.

## GO-08 — Maps/shared state require synchronization
Concurrent read/write access to ordinary maps is not safe. Use ownership, mutexes or appropriate concurrent structures.

## GO-09 — Run race detection on concurrent code
CI SHOULD run `go test -race` on representative packages/workflows when platform support and cost allow. Race detection only finds executed races.

## GO-10 — Use fuzzing at parsers and hostile boundaries
Native Go fuzzing SHOULD be considered for parsers, codecs, protocol inputs and high-risk invariant logic.

## GO-11 — Run vulnerability analysis
Use `govulncheck` or equivalent Go vulnerability analysis in CI/release workflows proportionate to exposure.

## GO-12 — Prefer small interfaces defined by consumers
Interfaces SHOULD represent required behavior, not mirror entire implementations. Avoid speculative abstraction.

## GO-13 — `defer` binds cleanup to scope
Use it for close/unlock/rollback patterns where semantics and performance are appropriate; do not hide material errors returned by cleanup.

## GO-14 — `cgo` is an FFI escalation
Use cgo when required, not as an invisible implementation detail. Test ABI, memory ownership, callbacks, thread affinity and cross-compilation implications.

## GO-15 — Benchmark allocation/GC behavior rather than guessing
Use Go benchmarks/pprof and production telemetry before object-pooling or unsafe optimizations.

---

# 12. Profile — Rust

## Baseline

- **Stable compiler:** Rust 1.98.1 at cutoff.
- **Edition:** Rust 2024 is current stable edition.

## RS-01 — Safe Rust is the default boundary
New code SHOULD remain safe Rust unless unsafe operations are required by FFI, performance or low-level invariants that cannot be expressed safely.

## RS-02 — `unsafe` requires an explicit safety contract
Every material unsafe block/function/trait/extern boundary MUST document the invariants the compiler cannot verify and why callers/implementation uphold them.

## RS-03 — Keep unsafe surface small
Wrap unsafe internals behind the smallest sound safe API feasible. A safe wrapper is only safe if its hidden unsafe invariants are actually correct.

## RS-04 — Use Rust 2024 unsafe discipline
Do not rely on an `unsafe fn` body as implicit permission for unsafe operations; use explicit unsafe blocks and migration lints.

## RS-05 — Ownership expresses resource lifetime
Prefer ownership/borrowing/RAII over global mutable state and manual lifetime protocols. Use shared ownership only when shared lifetime is truly required.

## RS-06 — `Send`/`Sync` are safety contracts
Manual `unsafe impl Send/Sync` is high-risk and MUST be reviewed like unsafe memory code. Do not assume a type is thread-safe because it compiles after an unsafe implementation.

## RS-07 — Avoid poison-through-panics assumptions
Define whether panics may unwind or abort, especially across FFI/task/process boundaries. Do not rely on unwinding across foreign ABI boundaries unless explicitly supported.

## RS-08 — Model recoverable errors with `Result`
Use typed error propagation for expected failure. Libraries SHOULD preserve useful error sources/context without requiring consumers to parse strings.

## RS-09 — Define MSRV for reusable libraries
If consumers need a minimum supported Rust version, declare `rust-version` and test it. Applications MAY track stable more aggressively when deployment is controlled.

## RS-10 — Use Cargo's deterministic state intentionally
Commit `Cargo.lock` when deterministic repository builds are valuable (default when in doubt); pair locked builds with CI that also detects dependency updates/compatibility.

## RS-11 — Edition is explicit
Set `edition = "2024"` for new projects unless compatibility constraints require an older edition. Edition upgrades are migrations, not compiler-version replacements.

## RS-12 — Machine-enforce format/lints
Use `cargo fmt --check` and `cargo clippy` with project-selected lint policy. Treat `pedantic`/restriction-style lints as contextual rather than universal truth.

## RS-13 — FFI is unsafe by definition
Validate layout, ownership, nullability, callbacks, panic/unwind, allocator and thread assumptions at FFI boundaries.

## RS-14 — Feature combinations are part of the state space
Crates with features SHOULD test material combinations and avoid mutually inconsistent feature graphs. Security-critical behavior MUST NOT silently depend on an optional feature default.

## RS-14A — Compiler patch releases can be correctness updates
Pinned Rust toolchains SHOULD still monitor stable patch releases and compiler advisories. A patch release that fixes miscompilation or security/correctness defects can justify expedited qualification even when feature-level change is otherwise frozen.

## RS-15 — Benchmark before unsafe optimization
Do not introduce unsafe code merely for presumed speed. Require profiling/benchmark evidence and regression tests for the invariant the unsafe optimization depends on.

---

# 13. Profile — Java / Kotlin

## Baseline

- **Java:** Java/JDK 27 is the latest feature release at cutoff; JDK 25 is an LTS line under Oracle's support roadmap. `LTS`/support lifetime is distribution/vendor policy, not a Java language-spec guarantee.
- **Kotlin:** 2.4.20 stable; 2.5 beta is not a production baseline.
- **Runtime:** JVM target/runtime compatibility is part of the contract.

## JVM-01 — Separate language level, bytecode target and runtime
Projects MUST define JDK used to build, source/language level and minimum runtime/bytecode target. “It compiles on my JDK” is not deployment compatibility.

## JVM-02 — Separate Java feature release from distributor support policy
A Java feature release can be stable while having a short support horizon under a chosen distributor. Production MUST identify JDK distribution/vendor, feature version, patch channel and support/EOL policy. Long-lived services SHOULD normally prefer a support horizon that matches service life unless the organization deliberately tracks six-month feature releases.

## JVM-03 — Preview/incubator features are not invisible dependencies
Use Java preview/incubator APIs only with explicit enablement, upgrade plan and isolation. At JDK 27, structured concurrency remains preview.

## JVM-03A — Repeated preview does not equal stable
Java preview/incubator status remains normative even when a feature has appeared across several releases. Preview APIs/language features MUST remain behind explicit enablement and migration tests until finalized.

## JVM-04 — Use build-tool toolchains/wrappers
Pin or constrain JDK/build-tool versions with repository-controlled toolchain/wrapper configuration. Do not let developer workstation JDK drift decide release bytecode.

## JVM-05 — Nullability is part of cross-language contracts
Java APIs SHOULD use explicit nullability conventions/annotations where tooling supports them. Kotlin SHOULD preserve its type-system null guarantees and treat Java platform types as a boundary requiring care.

## JVM-06 — Prefer immutable state and explicit ownership
Do not treat garbage collection as state management. Shared mutable objects still require synchronization and clear ownership.

## JVM-07 — Structured resource cleanup
Use `try-with-resources` in Java and `use`/structured equivalents in Kotlin for closeable resources. Do not rely on finalizers/GC timing for critical cleanup.

## JVM-08 — Exceptions define API semantics
Do not use exceptions for invisible control flow across hot paths without reason. Preserve causes; avoid catch-all swallowing. Kotlin/Java interop MUST document checked-exception behavior where relevant.

## JVM-09 — Concurrency primitive must match lifetime
Virtual threads can reduce thread-per-request cost but do not remove shared-state races, resource limits or cancellation requirements. Coroutine/virtual-thread tasks still need bounded ownership.

## JVM-10 — Kotlin coroutines require structured ownership
Scopes/jobs MUST reflect application/request/component lifecycle. Avoid global or detached coroutine scopes for ordinary request work.

## JVM-11 — Align Kotlin `jvmTarget` and Java toolchain target
Mixed-language builds MUST fail on incompatible targets rather than silently produce mixed bytecode assumptions.

## JVM-12 — Reflection/dynamic proxies are architecture costs
Use them when framework/platform value justifies reduced static discoverability. Security-sensitive policy SHOULD not depend solely on reflective naming conventions.

## JVM-13 — Serialization frameworks are boundary code
Treat polymorphic/deserialization features, class-name based loading and object graphs from untrusted input as security-sensitive. Prefer explicit data contracts.

## JVM-14 — GC tuning follows SLO evidence
Choose heap/collector/runtime flags from measured allocation, pause, throughput and container-memory behavior; keep changes observable and reversible.

## JVM-15 — Dependency graph and plugin execution are supply chain
Lock/verify dependencies and build plugins according to chosen Maven/Gradle mechanism and organizational risk. Repository wrappers are code execution and require review.

---

# 14. Profile — C# / .NET

## Baseline

- **Stable language:** C# 14.
- **Stable runtime:** .NET 10 LTS.
- **Watch:** C# 15 / .NET 11 preview.

## CS-01 — Target framework and SDK are distinct contracts
Define `TargetFramework`/runtime target and pin/constrain the SDK used to build, commonly with `global.json` in controlled repositories.

## CS-02 — Do not let preview SDKs enter production accidentally
Set prerelease policy explicitly. In controlled CI, `global.json` SHOULD specify an exact SDK baseline/roll-forward strategy and `allowPrerelease: false` unless preview use is deliberately approved; outside Visual Studio the SDK resolver can otherwise consider prerelease versions by default. Preview language/runtime features require an intentional exception and migration plan.

## CS-03 — Enable nullable reference types
New production code MUST enable nullable reference type analysis unless a documented compatibility reason prevents it. Treat nullability warnings as contract mismatches, not cosmetic noise.

## CS-04 — Nullable analysis does not change runtime values
External/reflection/legacy inputs can still produce null at runtime. Validate boundary data and interop contracts.

## CS-05 — Async must propagate lifetime and cancellation
Async APIs SHOULD accept/propagate `CancellationToken` when operations are meaningfully cancelable. Avoid sync-over-async deadlock/thread-pool starvation patterns.

## CS-06 — Do not fire-and-forget critical Tasks
Detached tasks need explicit owner, exception observation, shutdown behavior and service lifetime.

## CS-07 — `IDisposable` / `IAsyncDisposable` define resource lifetime
Use `using`/`await using` for deterministic cleanup. Do not rely on finalizers for routine resources.

## CS-08 — Exceptions are not return codes
Throw for exceptional failure according to framework/domain conventions; preserve inner exceptions and avoid broad catch-without-action.

## CS-09 — Unsafe/native interop raises assurance
`unsafe`, pointers, P/Invoke, COM/native handles and marshalling MUST define layout, ownership, lifetime, calling convention and error semantics.

## CS-10 — Lock dependency state in controlled builds
Use NuGet lock files/locked restore when deterministic dependency closure is required; CI SHOULD fail rather than mutate the graph during release builds.

## CS-11 — Treat analyzers as policy code
Enable .NET/Roslyn analyzers and configure severity in source control. New analyzer waves SHOULD be adopted deliberately, not globally suppressed.

## CS-12 — Span/ref-like performance features require lifetime understanding
Use `Span<T>`, `Memory<T>`, pooling and zero-copy techniques when measured benefit exists and ownership/lifetime rules remain clear.

## CS-13 — Reflection/source generation trade off different risks
Prefer source generation when it materially improves trimming/AOT/startup or static discoverability; do not adopt generators without reviewing emitted behavior and build trust.

## CS-14 — AOT/trimming are separate deployment profiles
If publishing NativeAOT or trimmed apps, test that exact publish mode; reflection/dynamic loading can break despite normal JIT tests passing.

## CS-15 — Runtime roll-forward is policy
Define supported runtime roll-forward/patch behavior and test deployment images, rather than assuming any installed .NET runtime is compatible.

---

# 15. Profile — Swift

## Baseline

- **Stable toolchain:** Swift 6.4.
- **Language mode:** Swift language mode is a separate compiler contract; Swift 6 mode is the strong default for new production code where supported.
- **Build:** Swift 6.4 makes Swift Build the default build engine in SwiftPM; build-engine changes require clean qualification.

## SW-01 — Use Swift 6 language mode for new concurrent code
Swift 6 enables full compile-time data-race safety checking. Legacy modules MAY migrate incrementally but SHOULD not permanently suppress concurrency diagnostics without ownership.

## SW-02 — Actor isolation is a correctness boundary
Use actors/global actors/isolation annotations to express shared mutable state ownership. Do not bypass isolation with unchecked annotations unless the invariant is independently guaranteed.

## SW-03 — `Sendable` is a concurrency contract
Manual/unchecked sendability claims MUST be reviewed as safety escape hatches.

## SW-04 — Structured concurrency owns child tasks
Prefer task groups/child tasks whose lifetime is bound to the parent operation. Detached tasks require explicit service-level ownership.

## SW-05 — Cancellation is cooperative
Long-running async operations SHOULD check/propagate cancellation and restore valid state when cancelled.

## SW-06 — Optionals model absence
Use optionals intentionally; avoid force unwrap (`!`) in production paths unless an invariant is locally obvious and failure is intentionally fatal.

## SW-07 — Error model is explicit
Use `throws`/typed domain results according to API semantics. Do not erase errors into optional/nil when callers need reason/recovery information.

## SW-08 — ARC is deterministic reference counting, not automatic cycle prevention
Design ownership (`strong`/`weak`/`unowned`) intentionally and test long-lived graph/lifecycle behavior for leaks.

## SW-09 — Package/toolchain version belongs in repository contract
Set Swift tools version/package constraints and test the actual Xcode/Swift toolchain used to ship Apple-platform apps.

## SW-10 — Deployment target matters
New standard-library/language features can compile under a new compiler while requiring runtime/platform availability constraints. Test minimum supported OS targets.

## SW-11 — C/Objective-C interop is a safety boundary
Validate nullability, ownership, lifetime, threading and representation across bridges. Imported annotations are evidence, not proof of third-party correctness.

## SW-12 — `unsafe`, raw pointers and manual buffers are high-risk
Localize them, document lifetime/bounds/alignment assumptions and use sanitizers/testing where supported.

## SW-13 — SwiftPM/build changes are production changes
Swift 6.4 makes Swift Build the default in SwiftPM; toolchain upgrades SHOULD include clean-build and artifact compatibility verification.

## SW-14 — Measure performance before ownership micro-optimization
Avoid premature `unowned`, manual buffers or concurrency tricks solely to reduce ARC overhead without profiling evidence.

## SW-15 — Crash diagnostics require symbolication artifacts
Retain dSYMs/build identifiers/source mapping and version correlation needed to diagnose optimized production crashes.

---

# 16. Profile — C / C++

## Baseline

- **C:** ISO/IEC 9899:2024 is the current published C standard.
- **C++:** ISO/IEC 14882:2024 is current published standard; the next edition is still a DIS at cutoff.
- **Risk posture:** native memory-unsafe code requires elevated assurance where exposed to hostile input or high consequence.

For ABI-sensitive/native production code, the controlled target SHOULD record:

```yaml
compiler_family_version:
language_standard_mode:
standard_library_implementation_version:
c_runtime_or_libc:
linker:
target_triple_architecture:
abi_mode_or_flags:
optimization_profile:
sanitizer_profile_if_test:
native_dependency_versions:
```

## CPP-01 — Select an explicit language standard
Compiler invocations/build systems MUST specify the intended C/C++ standard mode rather than silently inherit workstation defaults.

## CPP-02 — Warnings should be strong and source-controlled
Enable a high-signal warning set for supported compilers and treat newly introduced critical warnings as failures after triage. Do not claim one vendor's `-Wall` means “all warnings.”

## CPP-03 — Undefined behavior is a correctness and security risk
Code MUST not rely on signed overflow, invalid lifetime, out-of-bounds, use-after-free, invalid aliasing, data races or other undefined behavior for ordinary semantics.

## CPP-04 — Prefer scoped resource ownership
In C++, use RAII and ownership types rather than manual paired allocation/free or lock/unlock when practical. In C, define single ownership and cleanup paths explicitly.

## CPP-05 — Raw owning pointers are suspect
C++ interfaces SHOULD use values/references/smart ownership types to express lifetime. Raw pointers MAY represent non-owning/low-level access when lifetime remains explicit.

## CPP-06 — Bounds must be represented
Prefer span/range/container APIs that carry size over naked pointer-plus-implicit-length. In C, pass sizes explicitly and validate arithmetic before allocation/copy.

## CPP-07 — Integer conversion is a first-class boundary
Audit signed/unsigned conversion, truncation, size arithmetic and overflow at input/allocation/index boundaries.

## CPP-08 — Concurrency requires the language memory model
Data races in C/C++ can be undefined behavior. Synchronize shared mutable state using standard atomics/locks/ownership and define memory ordering deliberately.

## CPP-09 — `volatile` is not thread synchronization
Use atomics/synchronization primitives for inter-thread ordering. `volatile` serves different low-level purposes and MUST NOT substitute for synchronization.

## CPP-10 — Sanitizers are risk-routed dynamic assurance
Risk-relevant native code SHOULD use appropriate dynamic detectors: AddressSanitizer for address/lifetime classes, UndefinedBehaviorSanitizer for selected UB, ThreadSanitizer for data races, and MemorySanitizer for uninitialized-memory flows where full instrumentation/platform support is practical. These tools have different compatibility and coverage; one clean sanitizer configuration does not imply absence of other bug classes.

## CPP-11 — Static analysis complements compiler warnings
Use Clang Static Analyzer/clang-tidy or equivalent analyzers with project-tuned rules for memory, lifetime, API and security defects.

## CPP-12 — Fuzz parsers and binary/protocol boundaries
Fuzz untrusted byte/text parsers, decoders and state machines with sanitizers enabled where practical.

## CPP-13 — C++ exceptions/no-exceptions is an architecture decision
Do not mix exception assumptions accidentally across libraries/ABI. Define error propagation and cleanup semantics consistently.

## CPP-14 — ABI is not source compatibility
Libraries exposing binary interfaces MUST define compiler, standard library, C runtime, architecture/target, calling convention and symbol/version compatibility. Prefer stable C ABI boundaries where cross-toolchain compatibility is required and practical. Dynamic-loader search/path policy and shared-library identity are part of runtime assurance.

## CPP-15 — Object lifetime crosses FFI explicitly
Never allocate in one runtime/allocator and free in another unless the contract explicitly guarantees compatibility. Export create/destroy operations when ownership must remain within a module.

## CPP-16 — Compiler optimization is allowed to exploit the standard
Do not “fix” optimized-only bugs by disabling optimization before ruling out UB/race/lifetime errors.

## CPP-17 — Build optimized configurations in CI
At least one release-like configuration MUST compile and execute tests before production release.

## CPP-18 — Memory-safe alternatives should be considered for new exposed components
For new security-sensitive code, evaluate whether a memory-safe implementation language can meet the requirement with acceptable interoperability/cost. This is a contextual risk-reduction principle, not an automatic rewrite mandate.

## CPP-19 — C++ guideline sets are guidance, not the standard
Use modern C++ guidelines (RAII, bounds/lifetime profiles, concurrency discipline) as applied practice, but do not pretend every guideline is complete, enforceable or universally appropriate.

## CPP-20 — C++26 remains a watch item
Do not represent draft C++26 features as a final ISO baseline until the replacement standard is published; experimental compiler implementations require compatibility review.

---

# 17. Profile — SQL

## Baseline

- **Normative family:** ISO/IEC 9075:2023 plus applicable corrigenda.
- **Operational reality:** SQL is implemented as dialects with materially different types, DDL, concurrency, functions, planner behavior and extensions.

Every production SQL use MUST have a DBMS overlay:

```yaml
dbms_product:
major_minor_version_policy:
driver_or_client:
default_and_required_isolation:
serialization_deadlock_error_classes:
ddl_transactionality_and_locking:
online_schema_change_capabilities:
identity_sequence_semantics:
upsert_merge_semantics:
timezone_timestamp_semantics:
numeric_precision_policy:
collation_case_semantics:
json_or_extension_semantics:
backup_restore_and_replication_assumptions:
migration_tool_and_version:
```

## SQL-01 — Use SQL core + DBMS overlay
“SQL” alone is insufficient. Production repositories MUST identify database engine/version and the semantics their application actually relies on. SQL-standard conformance does not make isolation, DDL, planner, type, identity, collation or extension behavior portable.

## SQL-02 — Parameterize data values
Application code MUST use prepared/parameterized query mechanisms for untrusted values. String concatenation is not an escaping strategy.

## SQL-03 — Dynamic identifiers require allow-listed construction
Table/column/order identifiers usually cannot be ordinary bind parameters. Map untrusted choices to known identifiers rather than interpolating arbitrary strings.

## SQL-04 — Constraints are executable invariants
Use `NOT NULL`, `UNIQUE`, `CHECK`, foreign keys and appropriate keys where the database is the authoritative enforcement point. Do not duplicate critical integrity only in application code.

## SQL-05 — Transactions encode business atomicity
Define transaction boundaries from invariants, not one transaction per ORM call by accident.

## SQL-06 — Isolation level is a semantic decision
Know the database's actual isolation implementation and anomalies. “Serializable” is strongest conceptually but cost/retry behavior is contextual; lower levels require invariant analysis.

## SQL-07 — Serialization/deadlock failures are expected control flow where applicable
Transactions that can be aborted for concurrency reasons need bounded retry at the transaction boundary when safe and idempotent.

## SQL-08 — Migrations are versioned production code
Schema migrations MUST be source-controlled, reviewed, tested against representative data and designed for mixed-version rollout where zero/low downtime is required.

## SQL-09 — Use expand/migrate/contract for incompatible live changes
Do not rename/drop/change semantics in one step when old and new application versions coexist.

## SQL-10 — DDL rollback semantics are engine-specific
Never assume transactional DDL/online index/lock behavior without verifying the target DBMS/version.

## SQL-11 — Query plans are runtime behavior
Use `EXPLAIN`/execution statistics and representative production-like data before indexing/query rewrites. Query text equivalence does not imply plan equivalence.

## SQL-12 — Avoid `SELECT *` in stable application contracts
Name required columns when result shape, bandwidth or compatibility matters.

## SQL-13 — Time/numeric/collation semantics are schema design
Choose timestamp timezone behavior, numeric precision/scale and collation explicitly for domain requirements.

## SQL-14 — Privilege is per workload identity
Applications SHOULD use least-privilege DB identities/roles; migration/admin privileges SHOULD be separated from runtime privileges where practical.

## SQL-15 — Stored code/triggers are production logic
Functions, triggers, procedures and generated columns need the same versioning, tests, observability and ownership as application code.

---

# 18. Profile — Solidity

## Baseline

- **Stable compiler:** Solidity 0.8.37 at cutoff.
- **Execution:** EVM semantics, chain/network and configured `evmVersion` are part of the runtime contract.
- **Default criticality:** value-bearing immutable/upgradeable contracts should normally be treated as high-assurance due to public adversarial execution and difficult/irreversible state change.

## SOL-01 — Pin the complete contract build identity
Production deployments MUST record exact `solc` version, optimizer settings/runs, via-IR/codegen choice where relevant, metadata settings, EVM target, source hashes, linked libraries and build-tool configuration sufficient to reproduce/verify creation bytecode and runtime bytecode. Compiler version alone is insufficient provenance.

## SOL-02 — Check the compiler known-bug list
Release assurance MUST check whether the chosen compiler/settings are affected by known bugs. “Latest 0.8.x” is not sufficient provenance.

## SOL-03 — Avoid floating pragmas in deployed builds
Source compatibility ranges MAY exist in reusable code, but release builds MUST resolve to one known compiler and artifact configuration.

## SOL-04 — External calls are adversarial boundaries
Any external call can execute unknown code, consume gas, revert or reenter through broader call paths. Design state transitions accordingly.

## SOL-05 — Apply checks-effects-interactions where it matches the flow
Perform validation before state effects and external interaction after intended effects, while recognizing that complex cross-contract invariants may require stronger reentrancy controls.

## SOL-06 — Reentrancy is broader than Ether transfer
Analyze callback/reentrancy across token hooks, proxies, fallback/receive, cross-contract calls and composable protocols.

## SOL-07 — Authorization must be explicit and testable
Admin, owner, role, upgrade and delegated authority paths need negative tests, event/audit visibility and key/governance recovery design.

## SOL-08 — Upgradeability is a second system
If using proxies/upgrades, protect initializer state, storage layout, implementation/admin slots, upgrade authorization, rollback/emergency policy and version compatibility.

## SOL-09 — Storage layout is persistent API
Changing type/order/layout can corrupt durable state. Treat layout diffs as migration-critical artifacts.

## SOL-10 — Arithmetic semantics still need domain bounds
Solidity 0.8+ checked arithmetic does not prove economic invariants. Review casts, `unchecked`, rounding, precision, fee math and unit conversions.

## SOL-11 — Gas can become availability risk
Bound loops over mutable/unbounded collections; analyze worst-case gas for state growth and adversarial inputs.

## SOL-12 — Timestamp/block values are weak environmental signals
Do not treat block timestamp/ordering/randomness as secure randomness or precise wall-clock authority.

## SOL-13 — Oracle/external price data require trust models
Define freshness, manipulation resistance, decimals/units, fallback and stale/invalid behavior.

## SOL-14 — Formal tools strengthen scoped properties, not intent
Use SMTChecker/invariant/property testing where useful, but independently validate that assertions/specifications encode the intended economic/security property.

## SOL-15 — Test at multiple assurance layers
High-value contracts SHOULD combine unit tests, invariant/property tests, fuzzing, static analysis, fork/integration tests and independent review/audit proportionate to value/risk.

## SOL-16 — Deployment is an irreversible release
Verify creation/runtime bytecode identity, source/settings, chain ID, addresses, constructor/initializer args, ownership/admin keys and post-deploy invariants before announcing completion. For material value/control, independent review and invariant/fuzz/formal evidence SHOULD increase with irreversible loss potential.

## SOL-17 — Emergency controls are explicit governance
Pause/failsafe capabilities can reduce loss but add central authority risk. Design scope, access, observability and exit/removal criteria deliberately.

---

# 19. Profile — Shell

## Baseline

- **Portable shell:** POSIX.1-2024 / Issue 8 shell command language.
- **Bash:** GNU Bash 5.3 line.

## SH-01 — Choose POSIX `sh` or Bash explicitly
A script MUST declare its target shell and use only features available there. “Works in my Bash” is not evidence of POSIX portability.

## SH-02 — Quote expansions by default
Variable/command substitutions used as data SHOULD be double-quoted unless field splitting/globbing is deliberately required and reviewed.

## SH-03 — Never construct shell code from untrusted strings
Prefer direct executable invocation with argument arrays from a safer host language. If shell is the host, avoid `eval` and command strings whose syntax is data-dependent.

## SH-04 — Treat filenames according to OS-native pathname semantics
Do not assume filenames are UTF-8 text or lack spaces, newlines, leading dashes or wildcard characters. POSIX pathnames may contain arbitrary non-NUL bytes. Use `--`, NUL-delimited interfaces or safe loops where utilities support them; keep text encoding rules separate from pathname representation.

## SH-05 — Exit status is the error channel
Check/propagate meaningful failures. Define whether a missing command/file/no-match is expected or fatal.

## SH-06 — `set -e` is not a complete error model
Its behavior depends on syntactic context. If used, understand exceptions and still write explicit error handling around critical operations.

## SH-07 — `pipefail` is Bash/non-POSIX behavior
Use only in scripts explicitly targeting a shell that supports it; do not rely on it in portable POSIX sh.

## SH-08 — Traps need idempotent cleanup
Use `trap` for temporary files/locks/termination cleanup, but account for which signals/events are catchable and avoid cleanup that corrupts partial successful state.

## SH-09 — Temporary files/directories must be created safely
Use secure platform utilities/APIs such as `mktemp` where available; do not invent predictable names in shared directories.

## SH-10 — Privilege makes shell much riskier
Privileged scripts MUST control `PATH`, environment, working directory, file permissions and invoked binaries; prefer dedicated programs for complex privileged logic.

## SH-11 — Avoid parsing human-formatted command output
Prefer machine-readable interfaces, dedicated query flags, APIs or structured formats. Locale and formatting changes are compatibility hazards.

## SH-12 — Pin external tool expectations
A shell script depends on every external utility it invokes. Record required commands/versions or target a defined POSIX/platform baseline. Portable shell syntax does not imply GNU/BSD/BusyBox utility-option or output-format portability.

## SH-13 — Shell is orchestration, not a universal application language
When state, data structures, concurrency, error recovery or security complexity grows, move logic to a language with stronger abstractions and tests rather than expanding fragile shell machinery.

## SH-14 — Lint shell code
Use a mature shell analyzer (for example ShellCheck) appropriate to the target shell, while treating its rules as analysis guidance rather than the POSIX specification.

## SH-15 — Test scripts in clean target environments
Use the real target shell, utility set and platform; test failure paths, spaces/special filenames, interrupted execution and repeated execution/idempotency where relevant.

---

# 20. Cross-language production profiles

## 19.1 Library profile

A reusable library MUST define:

- language/edition and minimum supported toolchain/runtime;
- public API and compatibility policy;
- dependency/version policy;
- supported platforms/architectures;
- concurrency/thread-safety contract;
- error contract;
- FFI/ABI contract if any;
- test matrix across minimum/current versions where appropriate;
- deprecation/removal policy.

## 19.2 Service/application profile

A deployable artifact MUST define:

- exact build toolchain;
- locked dependency closure;
- target runtime/container/platform;
- production configuration contract;
- release build mode;
- startup/shutdown/cancellation behavior;
- diagnostics/version metadata;
- vulnerability/update process;
- rollback/roll-forward compatibility.

## 19.3 High-assurance/native/contract profile

Add:

- independent review;
- stricter static analyzers;
- fuzz/property/invariant testing;
- race/sanitizer/memory tooling where applicable;
- explicit unsafe/FFI register;
- compiler/runtime defect/watch review;
- artifact provenance;
- stronger reproducibility;
- fault/adversarial testing;
- retained assurance evidence.

---

# 21. Polyglot and cross-language boundary standard

A polyglot system MUST treat every language boundary as an explicit contract rather than assuming equivalent semantics.

## 21.1 Boundary record

```yaml
boundary_id:
producer_language_runtime:
consumer_language_runtime:
transport_or_ffi:
canonical_schema_or_abi:
null_absence_semantics:
numeric_width_precision:
text_encoding:
time_timezone_semantics:
ordering_guarantees:
error_mapping:
cancellation_timeout:
ownership_lifetime:
compatibility_policy:
generated_code_owner:
cross_language_tests:
```

## 21.2 Required principles

- One canonical representation SHOULD own shared schema/protocol truth.
- Generated bindings are build artifacts and MUST be reproducible enough to detect drift.
- Numeric ranges, signedness, decimal precision, enum unknown values, nullable/optional states and timestamp semantics MUST be mapped explicitly.
- FFI boundaries MUST define layout/alignment/calling convention/allocator/panic-exception behavior and lifetime.
- RPC/event boundaries MUST define timeout, retries/idempotency, ordering, versioning and unknown-field behavior.
- Build/release orchestration MUST identify which toolchain produces which artifact and how versions are correlated in production.
- Cross-language integration tests SHOULD exercise boundary values that each language represents differently.

## 21.3 Language introduction gate

Before adding a new language/runtime to an existing system, record:

```yaml
requirement_not_met_by_current_stack:
benefit_expected:
new_operational_surface:
new_security_supply_chain_surface:
interop_boundary:
team_competence_and_ownership:
observability_debugging_support:
deployment_and_patch_model:
exit_or_consolidation_path:
```

Default: do not add a language merely because a component is easier to prototype in it.

---

# 22. Language/runtime conformance record

Use this as the minimum project overlay for the selected profile.

```yaml
profile:
project_or_component:
criticality:
owner:

language_standard_or_edition:
compiler_or_interpreter:
compiler_version:
runtime_or_vm:
runtime_version:
standard_library_or_distribution:
support_channel_and_eol:

build_tool:
package_manager_or_resolver:
lock_resolution_artifact:
registry_source_policy:
build_time_executable_plugins:
native_dependencies:

target_os_arch_abi:
deployment_target:
runtime_flags:
ambient_state_requirements:

unsafe_dynamic_escape_hatches:
ffi_boundaries:
concurrency_model:
cancellation_model:
error_taxonomy:

format_check:
static_type_lint_analysis:
unit_integration_tests:
dynamic_race_sanitizer_fuzz_tests:
security_dependency_checks:
release_mode_tests:

artifact_identity:
provenance_or_attestation_if_required:
version_observability:
upgrade_owner:
review_triggers:
exceptions:
```

## 22.1 Conformance evidence

A profile is not conformant because the YAML is filled in. CI/release evidence SHOULD demonstrate the material claims: exact toolchain selected, locked resolution honored, intended target built, analysis/tests run, release artifact smoke-tested, and runtime version observable after deployment.

---
# 23. Language/runtime change and upgrade play

## Trigger

- language/runtime release;
- security advisory;
- dependency ecosystem requirement;
- EOL/support event;
- compiler diagnostic change;
- platform/OS/toolchain change;
- performance/reliability issue linked to runtime.

## Method

1. Identify current version and support status.
2. Read authoritative release/migration notes.
3. Enumerate removed/deprecated/changed semantics.
4. Inventory preview/unsafe/runtime flags and dependencies.
5. Update one layer in a dedicated change where practical.
6. Re-resolve dependencies intentionally.
7. Run formatter/lints/types/static analysis.
8. Run unit/integration/compatibility tests.
9. Run race/sanitizer/fuzz/property suites where relevant.
10. Build release/optimized target artifacts.
11. Benchmark material performance/memory/startup regressions.
12. Deploy progressively when production behavior could differ.
13. Observe errors, resource behavior and user-relevant signals.
14. Record migration defects and new assumptions.

## Acceptance

- no unresolved blocker compatibility/correctness defects;
- supported runtime line;
- dependencies compatible;
- production artifact reproduced;
- material behavior/performance/security regression addressed or accepted;
- docs/toolchain config updated.

---

# 24. Decision tables

## 21.1 Use a dynamic escape hatch?

| Condition | Default |
|---|---|
| Ordinary typed/domain logic | Do not use it |
| Required by framework/interop | Isolate and validate boundary |
| Needed for measured performance | Benchmark, isolate, document invariant, add tests |
| Security-sensitive policy | Prefer statically inspectable/enforced mechanism |
| Untrusted content controls code generation/eval | Prohibit |

## 21.2 Adopt a preview language/runtime feature?

| Question | If no |
|---|---|
| Does it solve a material requirement? | Do not adopt |
| Is it isolated behind a boundary? | Design isolation first |
| Can we migrate if syntax/API changes? | Avoid production dependency |
| Is tool/IDE/build support adequate? | Wait or sandbox |
| Is release/support status explicit? | Verify first |
| Is owner/review trigger recorded? | Do not adopt |

## 21.3 Upgrade immediately?

- **Security/correctness patch with exposure:** accelerate after focused verification.
- **Supported patch/minor with no urgency:** batch on controlled cadence.
- **Major/edition/runtime semantic change:** dedicated migration + regression evidence.
- **Preview/beta:** test in CI/branch, not production by default.
- **EOL runtime:** migration becomes risk-remediation work, not optional housekeeping.

---

# 25. AI-assisted language/runtime engineering

AI increases the rate at which code can exploit language features incorrectly as well as correctly. Therefore:

1. AI MUST be given the repository's actual language/runtime/toolchain contract.
2. AI MUST NOT invent package APIs or compiler flags without authoritative verification when material.
3. Generated casts/assertions/unsafe blocks/FFI/shell/SQL MUST receive extra scrutiny because they can bypass high-level guarantees.
4. Generated tests MUST NOT be the only oracle for generated implementation.
5. The compiler/type checker/linter/analyzer SHOULD run after each coherent generated change.
6. Large generated diffs SHOULD be split until a responsible reviewer can explain invariants and failure modes.
7. AI MUST NOT weaken warnings/tests/type strictness to “make CI green” without explicit decision.
8. Runtime behavior MUST be verified in the real target, not inferred from plausible-looking code.

---

# 26. Anti-patterns and falsification targets

## A1 — “Strongly typed means runtime validation is unnecessary.”
**Reject.** External bytes/values are not guaranteed by source-language types.

## A2 — “The latest version is always best.”
**Reject.** Support/ecosystem/compatibility may favor an LTS/stable earlier line.

## A3 — “LTS is always safest.”
**Reject.** LTS improves support horizon; it does not prove absence of defects or fit.

## A4 — “Memory-safe language means secure software.”
**Reject.** It removes/reduces important classes of memory bugs, not authorization, injection, logic, supply-chain or configuration failures.

## A5 — “GC means no memory leaks.”
**Reject.** Reachable-but-unused objects, caches, listeners/tasks and native resources still leak.

## A6 — “Async means parallel.”
**Reject.** Async primarily models concurrency/non-blocking progress; runtime and workload determine parallel execution.

## A7 — “More threads/goroutines/tasks increase throughput.”
**Reject.** Unbounded concurrency increases contention, queueing, memory and downstream load.

## A8 — “Compiler warning-free means production-ready.”
**Reject.** Warnings cover a subset of properties.

## A9 — “Lockfile means reproducible build.”
**Reject.** Toolchain, build scripts, registries, native inputs, environment and artifacts still matter.

## A10 — “One formatter/linter configuration is universal best style.”
**Reject.** Canonical tooling reduces debate; exact style rules remain ecosystem/project context.

## A11 — “C/C++ sanitizer clean means no UB.”
**Reject.** Dynamic sanitizers only observe executed paths and supported checks.

## A12 — “Rust unsafe is bad and should never exist.”
**Reject.** Unsafe is required for some low-level/FFI work; the correct rule is contained, justified, verified unsafety.

## A13 — “Python's GIL makes shared state thread-safe.”
**Reject.** Correctness must not rely on incidental implementation atomicity, and free-threaded CPython changes the execution model.

## A14 — “Node Current is better than LTS because it is newer.”
**Reject.** Node explicitly recommends Active/Maintenance LTS for production applications.

## A15 — “SQL is portable.”
**Reject.** Core language is standardized; production semantics are dialect/version/engine-specific.

## A16 — “Solidity 0.8 prevents arithmetic bugs.”
**Reject.** Checked arithmetic does not prove units, rounding, economics, casts or invariants.

## A17 — “`set -euo pipefail` makes shell scripts safe.”
**Reject.** `pipefail` is not POSIX and `errexit` has context-sensitive semantics; quoting, data/code separation and explicit error handling remain necessary.

## A18 — “Java/Kotlin GC removes resource-lifetime concerns.”
**Reject.** Files, sockets, DB resources and native handles still need deterministic cleanup.

## A19 — “Swift 6 eliminates concurrency bugs.”
**Reject.** It strongly addresses data races in covered Swift concurrency semantics, not higher-level ordering, deadlocks, distributed races or unsafe/foreign code.

## A20 — “C# nullable types prevent nulls.”
**Reject.** Nullable reference analysis is compile-time and runtime/legacy/reflection boundaries can violate assumptions.

---

# 27. Review checklist

## Toolchain
- [ ] Language/edition/standard explicit
- [ ] Compiler/interpreter/runtime explicit
- [ ] Supported production version line
- [ ] Preview/nightly features and transitive build tooling inventoried
- [ ] Support/EOL channel explicit and vendor/distribution identified where relevant
- [ ] Build tool/package manager version controlled
- [ ] Target OS/arch/ABI/deployment target explicit
- [ ] Clean build reproducible enough for risk

## Semantics
- [ ] Null/absence semantics explicit
- [ ] Error propagation defined
- [ ] Resource cleanup structural
- [ ] Concurrency ownership/lifetime defined
- [ ] Cancellation/deadline semantics defined
- [ ] Numeric/time/encoding assumptions reviewed
- [ ] Ordering/iteration assumptions explicit where behavior depends on them
- [ ] Randomness/entropy semantics correct for purpose
- [ ] Ambient process state (locale/timezone/env/cwd/etc.) reviewed where material
- [ ] FFI/unsafe/dynamic escape hatches inventoried

## Dependencies
- [ ] Resolution/lock state committed where applicable
- [ ] Frozen/locked CI install
- [ ] Vulnerability/update process
- [ ] Build scripts/plugins/macros/generators included in supply-chain boundary
- [ ] Native/system/dynamic libraries included where material
- [ ] Resolution lock distinguished from content integrity/provenance

## Verification
- [ ] Format check
- [ ] Compiler warnings/type/static analysis
- [ ] Tests cover error/boundary/concurrency paths
- [ ] Race/sanitizer/fuzz/property tests where applicable
- [ ] Release/optimized artifact tested
- [ ] Target runtime smoke test

## Operations
- [ ] Version/build ID observable
- [ ] Crash/stack trace symbolization possible
- [ ] Runtime flags/config and ambient global state controlled
- [ ] Native/dynamic loader behavior controlled where material
- [ ] Memory/performance profile known where material
- [ ] Upgrade/EOL owner and trigger defined

---

# 28. V2 source register

> V2 prioritizes primary language/runtime/specification sources for exact semantics and version status, while preserving the master playbooks for cross-cutting engineering controls. Applied tools/guidelines are implementation evidence, not universal authority. The register records the strongest decision-driving sources; inherited security/supply-chain/testing sources remain in Playbook 00 rather than being duplicated exhaustively.

| ID | Source | Role |
|---|---|---|
| BASE01 | Master Playbook Standard v2.0-RC1 | playbook evidence/risk/audit construction rules |
| BASE02 | Universal Software & AI Engineering Master Playbook v2.0 | inherited engineering principles; explicitly delegates language/runtime depth |
| TS01 | TypeScript 7.0 release, Microsoft TypeScript team, 2026-07-08 | current TS release/status |
| TS02 | TypeScript TSConfig reference | `strict`, optional/indexed checking semantics |
| JS01 | ECMA-262 / ECMAScript 2026 | language semantics |
| NODE01 | Node.js Releases / Release WG | production LTS policy and support cadence |
| NPM01 | npm `npm ci` docs | frozen clean install semantics |
| PY01 | Python 3.14.7 release | stable CPython baseline |
| PY02 | Python 3.15.0rc2 release | preview status and final schedule |
| PY03 | Python Packaging `pylock.toml` specification | standardized reproducible dependency-lock format |
| PY04 | Python free-threading docs | free-threaded model and compatibility limits |
| GO01 | Go 1.27 release notes | current stable Go line |
| GO02 | Go release policy | support cadence |
| GO03 | Go race detector / security best practices | race/vet/fuzz controls |
| GO04 | govulncheck docs | reachability-aware vulnerability analysis |
| RS01 | Rust 1.98.1 release | current stable Rust |
| RS02 | Rust 2024 Edition Guide | edition/unsafe migration rules |
| RS03 | Cargo Book | lockfile, MSRV, manifest semantics |
| RS04 | Rustonomicon | unsafe / Send / Sync / FFI contracts |
| JVM01 | Java SE 27 specifications/release notes | current Java language/VM baseline |
| JVM02 | Oracle Java SE support roadmap | JDK 25 LTS vs JDK 27 feature support horizon |
| JVM03 | Java 27 Structured Concurrency docs | preview status/lifetime semantics |
| KT01 | Kotlin 2.4.20 release docs | current stable Kotlin |
| KT02 | Kotlin Gradle project configuration | JVM target/toolchain compatibility |
| CS01 | .NET release/support docs | .NET 10 LTS baseline |
| CS02 | C# 14 docs | current stable C# language |
| CS03 | C# 15 docs | preview status |
| CS04 | .NET `global.json` docs | SDK version contract, roll-forward and environment-sensitive `allowPrerelease` behavior |
| CS05 | C# nullable reference docs | static nullability semantics |
| CS06 | NuGet PackageReference docs | lock/locked restore semantics |
| SW01 | Swift 6.4 release | current Swift baseline |
| SW02 | Swift 6 concurrency migration/data race safety | language-mode concurrency guarantees |
| C01 | ISO/IEC 9899:2024 | current C standard |
| CPP01 | ISO/IEC 14882:2024 | current C++ standard |
| CPP02 | ISO/IEC DIS 14882 (2026) | next C++ edition is draft/watch item |
| CPP03 | Clang ASan/UBSan/TSan/MSan + Static Analyzer docs | complementary native dynamic/static defect-detection mechanisms |
| CPP04 | C++ Core Guidelines | applied modern C++ safety/resource/concurrency guidance |
| SQL01 | ISO/IEC 9075:2023 | SQL normative family |
| SQL02 | OWASP SQL Injection Prevention | parameterized query security control |
| SQL03 | PostgreSQL concurrency/SQL docs | example of engine-specific semantics; not universalized |
| SOL01 | Solidity 0.8.37 release | current stable compiler; material bug/miscompilation fixes demonstrate patch-level correctness importance |
| SOL02 | Solidity known-bugs list | compiler assurance requirement |
| SOL03 | Solidity security considerations | reentrancy/CEI/failsafe guidance |
| SOL04 | Solidity SMTChecker docs | scoped formal verification |
| SH01 | POSIX.1-2024 / Issue 8 Shell Command Language | portable shell normative semantics |
| SH02 | GNU Bash 5.3 manual/release | Bash-specific baseline |

---

## 28.1 Decision-driving current primary sources

- TypeScript 7.0 stable release: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- ECMAScript current specification: https://tc39.es/ecma262/
- Node.js release lines: https://nodejs.org/en/about/previous-releases
- Python releases: https://www.python.org/downloads/ ; `pylock.toml`: https://packaging.python.org/en/latest/specifications/pylock-toml/
- Go 1.27: https://go.dev/doc/go1.27
- Rust releases/edition: https://blog.rust-lang.org/ ; https://doc.rust-lang.org/edition-guide/
- Java/OpenJDK 27: https://openjdk.org/projects/jdk/27/ ; support roadmap: https://www.oracle.com/java/technologies/java-se-support-roadmap.html
- Kotlin releases: https://kotlinlang.org/docs/releases.html
- .NET/C#: https://dotnet.microsoft.com/platform/support/policy ; `global.json`: https://learn.microsoft.com/dotnet/core/tools/global-json
- Swift 6.4: https://www.swift.org/blog/swift-6.4-released/
- C: ISO/IEC 9899:2024 — https://www.iso.org/standard/82075.html
- C++: ISO/IEC 14882:2024 — https://www.iso.org/standard/83626.html ; next edition remains DIS: https://www.iso.org/standard/91179.html
- LLVM/Clang analysis: https://clang.llvm.org/docs/
- SQL: ISO/IEC 9075-1:2023 — https://www.iso.org/standard/76583.html ; Technical Corrigendum 1:2026 — https://www.iso.org/standard/93690.html
- Solidity 0.8.37: https://www.soliditylang.org/blog/2026/09/10/solidity-0.8.37-release-announcement/ ; known bugs: https://docs.soliditylang.org/en/v0.8.37/bugs.html
- POSIX.1-2024 / Issue 8: https://pubs.opengroup.org/onlinepubs/9799919799/ ; GNU Bash: https://www.gnu.org/software/bash/

---

# 29. V2 audit closure and remaining watch items

The dedicated V1 falsification audit recorded **0 BLOCKER, 14 MAJOR, 13 MINOR and 3 editorial/architecture findings**. All required V2 revisions were incorporated. Material closures include TypeScript 7 compiler-API/tooling migration, version/support-channel separation, native ABI matrices, SQL DBMS overlays, build-time code execution, lock-vs-integrity-vs-provenance, pathname/text separation, ambient process state, ordering, randomness, polyglot contracts, dynamic/native loading, transitive prerelease detection and a conformance record.

Remaining **watch items**, not defects:

1. TypeScript 7.1+ programmatic API stabilization and framework/tool migration readiness.
2. Python 3.15 final after the scheduled 2026-10-01 release and ecosystem readiness; future free-threading defaults.
3. Node 26 LTS transition after this evidence cutoff.
4. Java/Kotlin/.NET/Swift rapid release cadence and distributor/support-policy changes.
5. Publication of the next C++ International Standard replacing ISO/IEC 14882:2024.
6. SQL engine-specific releases: each project overlay must requalify its own DBMS/version.
7. Solidity compiler/EVM changes and known-bug list: treat as fast-moving release evidence.
8. Package-manager lock/provenance capabilities: formats and ecosystem support continue to evolve.

**Status rule:** a watch item is not permission to adopt a preview. Current published/stable baseline remains authoritative until the newer item is released and locally qualified.

---

# 30. Change log

## 2.0-REVIEWED — 2026-09-27

- Completed deep V1 freshness/falsification audit.
- Added language/runtime stack model and separated language release from implementation/distribution/support policy.
- Strengthened TypeScript 7 compiler-API migration controls.
- Added runtime-global state, ordering, randomness, build-time executable code, native loading and lock/integrity/provenance principles.
- Added native C/C++ ABI target matrix and risk-routed sanitizer guidance.
- Added mandatory SQL DBMS overlay.
- Strengthened Python free-threading/native-extension, .NET prerelease SDK, JVM support-channel and Solidity build-identity rules.
- Added polyglot boundary standard and project conformance record.
- Closed all material V1 audit findings; retained current fast-moving items as explicit watch items.

## 1.0-DRAFT — 2026-09-27

- Initial universal language/runtime standard with twelve profiles.
- Superseded by V2 after falsification/freshness audit.
