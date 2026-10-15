# 04 — Software Construction & Code Quality — V2.0 Golden Master

> **Evergreen evidence-based standard for constructing code that is correct, understandable, locally reasoned about, safely changeable and maintainable**

```yaml
document_id: PB-04
title: 04 — Software Construction & Code Quality
artifact_type: capability_playbook
version: 2.0-RC1
status: REVIEWED
created: 2026-09-27
last_updated: 2026-09-27
last_reviewed: 2026-09-27
evidence_cutoff: 2026-09-27
owner: Engineering Standards
canonical_language: English
inherits:
  - Master Playbook Standard v2.0-RC1
  - Universal Software & AI Engineering Master Playbook v2.0
primary_archetype:
  - Capability
  - Execution
  - Decision
rigor_level: L3 / CONTROLLED
volatility: Moderate
research_or_review_design:
  - targeted scoping synthesis
  - standards verification
  - empirical evidence review
  - contradiction search
  - folklore falsification
  - adversarial audit
assurance_level: reviewed_not_field_validated
next_scheduled_review: 2027-03-27
review_triggers:
  - new ISO/IEEE software-construction or source-quality standard
  - material SWEBOK revision
  - strong replication/meta-analysis changing typing/refactoring/smell/readability conclusions
  - material language/runtime paradigm shift
  - material AI-assisted engineering evidence
  - recurring field defect caused by this standard
applies_to:
  - application code
  - services
  - libraries
  - APIs
  - engines
  - web/mobile/desktop code
  - infrastructure/configuration code where construction principles transfer
  - AI-assisted and agent-produced source code
out_of_scope:
  - language-specific style profiles
  - architecture/system topology
  - full testing strategy
  - security/privacy specialist controls
  - distributed systems specialist controls
  - CI/CD and software supply-chain specialist controls
supersedes: PB-04 v1.0-RC1
```

---

## Status note

V2 is the result of:

```text
V1 DRAFT
→ targeted standards/research expansion
→ active folklore falsification
→ contradiction audit
→ metric/Goodhart audit
→ 2026 AI freshness audit
→ V2 synthesis
```

It is `REVIEWED`, not `VALIDATED`.

Under the inherited Master Playbook Standard, a polished and researched document is not sufficient for `VALIDATED` status. Representative non-author execution, scenario testing, real repository use and closure of resulting defects are still required.

---

# Executive standard

Software construction is not the act of making source code look clean.

It is the discipline of turning a design and intended behavior into **executable structures that preserve invariants, expose contracts, contain change, make failure explicit, support local reasoning and remain economical to evolve**.

The durable construction chain is:

```text
INTENT
→ INVARIANTS
→ REPRESENTATION
→ OWNERSHIP
→ BOUNDARIES
→ CONTRACTS
→ IMPLEMENTATION
→ FAILURE SEMANTICS
→ VERIFICATION
→ REVIEW
→ CHANGE EVIDENCE
→ MAINTENANCE LEARNING
```

The V2 doctrine is:

> **Make correctness constraints and authority explicit; hide volatile decisions behind coherent boundaries; minimize unjustified cognitive and dependency complexity; optimize for local reasoning and change locality; treat types, patterns, smells, metrics and style rules as tools rather than proof; refactor only against a real quality problem; and require independent evidence for human- or AI-produced code in proportion to consequence.**

The most important falsification result is:

> **There is no evidence-based universal code shape. There are evidence-backed mechanisms and outcomes.**

No source reviewed justifies a universal claim that:

- statically typed code is always better;
- duplicated code is always harmful;
- every smell is a defect;
- SOLID conformance creates quality;
- design patterns improve quality by default;
- functions/classes have a universal correct maximum size;
- one complexity score predicts understandability reliably;
- comments are inherently good or bad;
- exceptions or result types are universally superior;
- refactoring always improves maintainability;
- inheritance is inherently inferior to composition;
- fewer dependencies always produce better code;
- AI-generated code is inherently less maintainable.

---

# 1. Purpose

This playbook enables engineers and AI coding systems to construct software that is:

- correct enough for its consequence level;
- understandable by people who did not author it;
- explicit about material state, authority, assumptions and failure;
- modular around real change boundaries;
- resistant to invalid use;
- economical to review and maintain;
- compatible with future evolution;
- measurable without metric cargo cults;
- safe to modify incrementally.

It standardizes **construction decisions and quality mechanisms**, not one coding style.

---

# 2. How to use this playbook

Use this playbook:

- while implementing a feature or fix;
- when designing a module/interface;
- when choosing error semantics;
- before introducing an abstraction;
- when deciding whether duplication should be removed;
- when reviewing readability/maintainability;
- before/while refactoring;
- before adding a dependency;
- when reviewing AI-generated code;
- when a static-analysis/code-quality tool raises a finding;
- when local coding conventions conflict with a stronger engineering invariant.

Do not use it as:

- a language syntax guide;
- a formatter configuration;
- a replacement for specialist security/testing/architecture standards;
- an excuse to rewrite working code for aesthetic preference;
- a numeric “clean code score”;
- a requirement to introduce OOP, functional programming, DDD, Clean Architecture, SOLID or any named pattern.

---

# 3. Evidence and rule model

## 3.1 Inherited claim taxonomy

Material guidance uses the Master Playbook Standard labels:

| Label | Meaning |
|---|---|
| `REQ` | External requirement in the stated scope |
| `EST` | Well-established practice/mechanism |
| `DEF` | Recommended default |
| `CTX` | Context-dependent practice |
| `EMG` | Emerging practice |
| `HOUSE` | Deliberate internal standard |
| `EXP` | Experiment/hypothesis |
| `UNK` | Important unresolved question |

## 3.2 Engineering evidence lanes

| Lane | Strongest legitimate use |
|---|---|
| `E0` | binding legal/contractual requirement |
| `E1` | international/formal technical standard |
| `E2` | systematic review/meta-analysis |
| `E3` | peer-reviewed empirical study |
| `E4` | government/open consensus framework/body of knowledge |
| `E5` | mature industrial/operational evidence |
| `E6` | official language/platform/protocol semantics |
| `E7` | repeated practitioner heuristic |
| `E8` | opinion/tradition/folklore |

## 3.3 Rule status

| Class | Treatment |
|---|---|
| `A` | durable universal principle |
| `B` | strong contextual principle |
| `C` | control triggered by risk/criticality |
| `D` | heuristic/pattern |
| `E` | implementation choice |
| `F` | dogma/unsupported universalization |

## 3.4 Normative words

`MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, `MAY`, and `JUDGMENT REQUIRED` use the meanings inherited from the Master Playbook Standard.

A `MUST` in this document is a house requirement unless it explicitly cites an external requirement. Normative strength is not evidence strength.

---

# 4. Construction quality model

Software construction quality is multidimensional.

## 4.1 Core dimensions

### Correctness

Can the implementation preserve required observable behavior and material invariants?

### Comprehensibility

Can a competent maintainer form an accurate mental model without disproportionate effort?

### Local reasoning

Can a unit be understood using its contract and nearby code rather than hidden global state or undocumented conventions?

### Change locality

Does one conceptual change normally require edits in one coherent area rather than synchronized changes across unrelated locations?

### Modularity

Do boundaries contain volatility and prevent unrelated change propagation?

### Analyzability

Can a maintainer diagnose why behavior exists and where a defect/change belongs?

### Modifiability

Can required change be introduced without disproportionate regression risk?

### Testability

Can important behavior be verified through sufficiently controllable boundaries?

### Contract clarity

Are valid inputs, outputs, state transitions, side effects and failure semantics knowable?

### Misuse resistance

Are invalid or unauthorized operations difficult to perform accidentally?

### Dependency discipline

Are internal and external dependencies intentional, owned and limited to useful capability?

### Reviewability

Can a reviewer understand the change and its consequences with realistic attention?

### Evolvability

Can contracts, implementation and dependencies change without uncontrolled compatibility debt?

### Cognitive economy

Does the code consume no more concepts, indirection and hidden state than the problem warrants?

## 4.2 No single quality score

`EST / A / HIGH`

No metric or score MAY be treated as a complete representation of construction quality.

ISO/IEC 25023 explicitly avoids universal quality-measure grade ranges because acceptable values depend on product/system context, integrity level and user needs [S04].

Source metrics MAY identify outliers, regressions or investigation targets. They MUST NOT be represented as proof of maintainability or understandability.

---

# 5. Criticality and construction rigor

Construction rigor inherits the engineering root criticality model.

| Criticality | Construction posture |
|---|---|
| `C0 Experimental` | direct/simple code, basic hygiene, explicit non-production status |
| `C1 Ordinary` | normal review, types/lint/tests appropriate to stack, maintainability defaults |
| `C2 Material` | stronger invariant modeling, independent review, failure-path evidence, dependency scrutiny |
| `C3 High assurance` | independent evidence, stronger traceability, restricted unsafe language features where relevant, deeper static/dynamic verification |
| `C4 Safety/mission critical` | specialist domain standard governs; formal methods/tool qualification/certification may apply |

Rigor MUST increase with consequence, irreversibility, uncertainty, blast radius and difficulty of detecting failure.

A low-risk formatting helper and a payment/authorization state machine do not require the same construction controls.

---

# 6. Golden Construction Standards

These are the V2 root construction rules.

## 6.1 Intent, correctness and invariants

1. `EST / A / HIGH` **Construct code from intended behavior and constraints, not from preferred patterns or frameworks.**
2. `EST / A / HIGH` **Material invariants MUST be knowable and SHOULD be enforced at the strongest practical layer.**
3. `EST / A / HIGH` **Make invalid or unauthorized states difficult to create when the consequence justifies the cost.**
4. `EST / A / HIGH` **Do not encode a critical assumption only in developer memory.**
5. `EST / A / HIGH` **Validate data when trust or representation changes; successful parsing is not semantic validity.**
6. `DEF / B / HIGH` **Prefer one canonical representation for persistent facts and business rules that must remain synchronized.**
7. `DEF / B / HIGH` **Prefer explicit failure over silent corruption.**
8. `DEF / B / HIGH` **Use assertions/invariant checks for conditions that should be impossible under correct internal use; do not use them as a substitute for validating untrusted input.**

## 6.2 Types and representation

9. `EST / B / HIGH` **Use available type-system features to eliminate material classes of representable invalid state when the benefit exceeds type complexity.**
10. `EST / B / HIGH` **Static types do not replace runtime validation, authorization, database constraints or distributed-state correctness.**
11. `DEF / B / MODERATE` **Use domain types when confusing semantically different values would create meaningful risk.**
12. `DEF / B / MODERATE` **Represent absence, lifecycle state and variants explicitly enough that callers cannot reasonably confuse their meaning.**
13. `DEF / B / HIGH` **Keep casts/assertions/unsafe escapes narrow and close to the evidence that makes them valid.**
14. `DEF / B / MODERATE` **Do not build type-level machinery whose cognitive cost exceeds the defect class it prevents.**
15. `CTX / E / MODERATE` **Static vs dynamic language choice is not a code-quality verdict; choose from domain, ecosystem, safety, performance, team and operability requirements.**

## 6.3 Modules, cohesion and ownership

16. `EST / A / HIGH` **Decompose around information hiding and change boundaries, not arbitrary processing steps or folder aesthetics [S06].**
17. `EST / A / HIGH` **A module SHOULD own a coherent concept, policy or capability.**
18. `EST / A / HIGH` **Make state ownership and mutation authority explicit.**
19. `DEF / B / HIGH` **Prefer high semantic cohesion and controlled coupling.**
20. `DEF / B / HIGH` **Make dependency direction inspectable.**
21. `DEF / B / HIGH` **Minimize uncontrolled shared mutable state.**
22. `CTX / D / MODERATE` **A dependency cycle is a diagnostic signal, not automatically a defect; remove it when it harms initialization, ownership, testability, layering or change locality.**
23. `DEF / B / HIGH` **A boundary SHOULD hide volatile decisions while exposing stable behavior.**
24. `DEF / B / MODERATE` **Do not split a cohesive concept merely to reduce file/class/function size.**
25. `DEF / B / MODERATE` **Do not combine independent policies merely to reduce module count.**

## 6.4 Interfaces and contracts

26. `EST / A / HIGH` **A contract includes success, failure and side effects—not only data shape.**
27. `EST / A / HIGH` **Material interfaces SHOULD define accepted inputs, output/state effects, error semantics and authority expectations.**
28. `DEF / B / HIGH` **Expose the minimum coherent capability consumers need.**
29. `DEF / B / MODERATE` **Name interfaces in domain/behavioral terms when possible.**
30. `DEF / B / HIGH` **Do not introduce an interface only because a style guide or testing ritual expects one.**
31. `DEF / B / HIGH` **Introduce abstraction at a volatile, policy, trust or substitution boundary—not mechanically between every caller and concrete type.**
32. `EST / A / HIGH` **External/public interfaces require explicit compatibility and deprecation semantics when consumers cannot migrate atomically.**
33. `DEF / B / HIGH` **Consumers SHOULD NOT require undocumented implementation knowledge to use a contract correctly.**
34. `DEF / B / MODERATE` **Boolean/flag parameters are acceptable when they represent one obvious binary domain choice; replace them when they hide unrelated modes or make call sites ambiguous.**

## 6.5 Error and failure semantics

35. `EST / A / HIGH` **Failures that change caller/operator decisions MUST be observable.**
36. `EST / A / HIGH` **Preserve enough causal context to diagnose unexpected failure without exposing sensitive data.**
37. `DEF / B / HIGH` **Translate errors only at a boundary that can add stable domain or operational meaning.**
38. `DEF / B / HIGH` **Do not catch an error merely to suppress it; catch when you can recover, compensate, add context, enforce containment or translate the contract.**
39. `CTX / E / HIGH` **Exception, result, error value, status code, panic/trap and callback representations are language/runtime choices; no one syntax is universal.**
40. `DEF / B / HIGH` **Distinguish expected domain outcomes from dependency/environment failures and invariant/programmer failures where the distinction changes handling.**
41. `EST / C / HIGH` **For material side effects, define what happens if failure occurs after partial completion.**
42. `DEF / B / HIGH` **Cleanup/resource release MUST be reliable under both success and failure.**
43. `DEF / B / HIGH` **Retry/compensation semantics MUST align with operation idempotency and side effects when applicable.**
44. `EST / C / HIGH` **Failure paths require verification proportionate to consequence.**

## 6.6 Abstraction and generalization

45. `EST / A / HIGH` **Minimize unjustified complexity, not capability.**
46. `DEF / B / HIGH` **Abstract stable shared knowledge or policy; delay abstraction while semantic sameness is uncertain.**
47. `DEF / B / HIGH` **An abstraction SHOULD reduce total cognitive/change cost, not merely line count.**
48. `DEF / B / HIGH` **Prefer explicit code when a generic layer would require callers to understand hidden flags, modes or implementation branches.**
49. `DEF / B / HIGH` **Speculative extension points SHOULD NOT be added without credible variability or a protected boundary requirement.**
50. `DEF / B / MODERATE` **When abstraction leaks repeatedly, either narrow the contract, change the boundary or remove the abstraction.**
51. `DEF / B / MODERATE` **A wrapper that only renames a dependency without hiding volatility, policy or semantics is usually unjustified indirection.**
52. `CTX / D / MODERATE` **YAGNI, KISS, SOLID and “Rule of Three” are prompts; none overrides evidence about the actual system.**

## 6.7 Duplication and reuse

53. `EST / A / HIGH` **Protect against duplicated knowledge that must remain synchronized.**
54. `CTX / D / HIGH` **Textual/code duplication is a signal, not automatically a defect [S11][S12][S13][S14].**
55. `DEF / B / HIGH` **Prefer explicit duplication over a shared abstraction when the concepts may evolve independently.**
56. `DEF / B / HIGH` **Extract shared logic when it expresses one stable rule/policy and independent copies create divergence risk.**
57. `DEF / B / MODERATE` **Generated duplication MAY be acceptable when the generator/source of truth is canonical and generated artifacts are not manually edited.**
58. `CTX / E / MODERATE` **Deliberate cloning MAY be useful for isolation/experimentation/migration; document lifecycle and convergence/removal strategy when it creates maintenance risk.**
59. `DEF / B / HIGH` **Do not create a shared utility dumping ground from superficially similar code.**
60. `DEF / B / HIGH` **DRY means avoiding multiple independent representations of the same knowledge, not minimizing repeated syntax.**

## 6.8 Readability, naming and comments

61. `EST / B / MODERATE` **Optimize readability for accurate comprehension by the intended maintainers, not aesthetic conformity.**
62. `DEF / B / MODERATE` **Use names that reveal domain role, important unit and distinction where this reduces ambiguity [S18].**
63. `DEF / B / MODERATE` **Use conventional abbreviations when they are genuinely more familiar to the target audience; avoid private/invented abbreviations.**
64. `DEF / B / MODERATE` **Prefer call sites that can be understood without opening the implementation when the operation is consequential.**
65. `DEF / B / HIGH` **Make side effects and mutation visible enough that callers can reason about them.**
66. `DEF / B / MODERATE` **Prefer straightforward control flow over clever compression when correctness/maintenance matters.**
67. `CTX / D / HIGH` **Comments are neither inherently good nor bad; their comprehension effect is context-dependent [S19].**
68. `DEF / B / HIGH` **Comment rationale, external constraints, invariants, protocol references, safety/security reasons and workaround removal conditions when code alone cannot preserve them.**
69. `DEF / B / HIGH` **Remove comments that merely restate syntax or have become false.**
70. `DEF / B / MODERATE` **Public APIs/modules SHOULD document behavior and constraints that consumers cannot infer safely.**

## 6.9 Functions, objects and control flow

71. `DEF / B / HIGH` **Split units on semantic cohesion and independent change pressure, not arbitrary line counts.**
72. `DEF / B / HIGH` **A function SHOULD represent one coherent operation whose preconditions, effects and result can be reasoned about together.**
73. `DEF / B / HIGH` **A class/object/module SHOULD not accumulate unrelated policy, lifecycle or authority merely for convenience.**
74. `CTX / D / MODERATE` **Guard clauses are useful when they clarify preconditions/exceptional exits; they are not mandatory when multiple exits make behavior harder to follow.**
75. `DEF / B / MODERATE` **Reduce deep or interleaved control flow when a clearer state model, extraction or data transformation exists.**
76. `DEF / B / MODERATE` **Use parameter objects only when the parameters form a meaningful concept or stable contract—not to satisfy a parameter-count rule.**
77. `CTX / D / MODERATE` **Prefer composition when it provides clearer independent variation; inheritance remains valid when the subtype relation is stable and the hierarchy simplifies rather than hides behavior.**
78. `DEF / B / HIGH` **Avoid hidden action at a distance: implicit global mutation, surprising callbacks, magic registration or reflection SHOULD be justified by clear system value.**

## 6.10 Refactoring and structural change

79. `EST / A / HIGH` **A refactoring MUST preserve the intended behavior in its declared scope; behavior changes must be explicit.**
80. `EST / B / HIGH` **Refactoring is a hypothesis about a named quality attribute, not automatic improvement [S10].**
81. `DEF / B / HIGH` **Before material refactoring, define the problem: duplicated policy, change scattering, test friction, performance constraint, defect history, ownership ambiguity, etc.**
82. `DEF / B / HIGH` **Establish sufficient characterization/regression evidence before altering structure when behavior is valuable.**
83. `DEF / B / HIGH` **Prefer incremental refactoring when it can reduce risk while preserving continuous validity.**
84. `DEF / B / MODERATE` **Separate refactoring-only and behavior changes when doing so improves review/rollback evidence; do not split when separation would make the invariant harder to understand.**
85. `DEF / B / HIGH` **Stop refactoring when additional change no longer has credible value relative to regression/cognitive cost.**
86. `CTX / D / HIGH` **A smell MAY initiate investigation; it MUST NOT by itself mandate refactoring [S09].**
87. `CTX / E / HIGH` **Rewrite only when hard requirements or foundational invalid assumptions make incremental evolution materially worse; account for migration and unknown-behavior risk.**

## 6.11 Dependencies and reuse

88. `EST / B / HIGH` **Every material external dependency creates capability and liability.**
89. `DEF / B / HIGH` **Add a dependency only when expected lifetime value exceeds implementation, update, security, compatibility, transitive, licensing and exit cost.**
90. `DEF / B / HIGH` **Remove demonstrably unused dependencies, but verify runtime/reflection/plugin/build-time use before deletion [S22].**
91. `DEF / B / HIGH` **Prefer a mature specialized dependency over bespoke implementation when the domain is security-sensitive, standards-heavy or algorithmically difficult and the dependency is trustworthy enough.**
92. `DEF / B / HIGH` **Prefer local code over a dependency when the capability is trivial and dependency surface would dominate its value.**
93. `EST / A / HIGH` **Pin/lock for reproducibility where appropriate, monitor risk and deliberately update; “pin forever” and “always latest” are both false universals.**
94. `DEF / B / HIGH` **A dependency SHOULD have identifiable ownership and an update/removal path.**
95. `DEF / B / MODERATE` **Minimize unnecessary transitive dependency exposure; dependency count alone is not a quality metric.**
96. `EST / C / HIGH` **Privileged/security-critical dependencies require stronger provenance/supplier review under the relevant specialist standards.**

## 6.12 Review and maintainability

97. `EST / B / HIGH` **Human review SHOULD focus on semantics, correctness, risk, maintainability and knowledge transfer; automate deterministic style checks [S20].**
98. `DEF / B / HIGH` **Prefer the smallest coherent, independently understandable and safely integrable change—not the smallest diff by line count [S21].**
99. `EST / A / HIGH` **Document why consequential decisions exist and what would invalidate them.**
100. `EST / A / HIGH` **Technical debt MUST describe future change/risk cost, not aesthetic dislike.**
101. `DEF / B / HIGH` **Delete dead code and obsolete compatibility paths when usage and migration evidence make removal safe.**
102. `DEF / B / HIGH` **Keep workaround rationale and removal trigger close enough to the code/decision that drift is detectable.**
103. `EST / A / HIGH` **Maintainability is demonstrated through real change/comprehension/evolution evidence, not style compliance.**

## 6.13 AI-assisted construction

104. `EST / A / HIGH` **AI-generated engineering output MUST be treated as untrusted until independently validated.**
105. `EST / A / HIGH` **AI authorship is not a quality class: current evidence does not justify declaring AI-produced code inherently more or less maintainable [S23].**
106. `EST / C / HIGH` **For material changes, AI self-review MUST NOT be the sole assurance signal.**
107. `DEF / B / HIGH` **A responsible owner SHOULD understand material invariants and failure modes in generated code before merge.**
108. `DEF / B / HIGH` **Keep generated changes small/coherent enough for effective review; reject unrelated churn.**
109. `EST / B / HIGH` **Benchmark/test success is not equivalent to mergeability or production usefulness [S25].**
110. `EST / B / MODERATE` **AI may increase output/completeness while reducing code ownership/comprehension in some contexts [S24]; protect understanding where consequence is material.**
111. `DEF / B / HIGH` **Verify generated dependency/API claims against authoritative sources when material.**
112. `EST / A / HIGH` **AI MUST NOT lower existing security, privacy, testing, review or deployment requirements.**

---

# 7. Types and invariant engineering

## 7.1 What types are for

Type systems can provide:

- representational constraints;
- machine-checked contracts;
- discoverability;
- tooling/navigation;
- exhaustive variant handling;
- refactoring support;
- documentation that stays coupled to compilation.

They do not provide:

- correct requirements;
- semantic correctness of arbitrary business logic;
- authorization;
- runtime truth for external data;
- database transaction correctness;
- distributed consistency;
- absence of security defects;
- proof that a chosen abstraction is understandable.

## 7.2 Evidence boundary

Gao, Bird & Barr found that TypeScript 2.0 and Flow 0.30 each detected about 15% of the studied public JavaScript bugs under their reconstruction method [S07].

Hanenberg et al. found static typing beneficial in studied maintenance tasks except semantic-error fixing [S08].

This is meaningful evidence for bounded mechanisms. It is not evidence that:

```text
STATIC LANGUAGE > DYNAMIC LANGUAGE
```

for all software outcomes.

## 7.3 Type decision

Use a stronger domain type when:

```text
Could two values have the same representation but different meaning?
  ├─ NO → primitive may be adequate
  └─ YES → Would confusing them cause material error?
              ├─ NO → choose simplest readable representation
              └─ YES → encode distinction if language/tooling cost is reasonable
```

Examples:

- `UserId` vs `OrganizationId`;
- money amount + currency;
- local date vs instant;
- unvalidated vs validated input;
- draft vs approved state;
- plaintext secret vs secret reference;
- normalized vs raw identifier.

## 7.4 Parse, do not merely assert

When an untrusted representation enters a trusted domain:

```text
untrusted bytes/json/string
→ parse
→ validate semantics
→ construct trusted domain value
→ operate
```

Unsafe casts/type assertions SHOULD occur only after the evidence-producing operation, not before it.

## 7.5 Sum/variant types and impossible states

When a state machine has mutually exclusive cases, a tagged/discriminated representation can prevent combinations such as:

```text
status = "PAID"
payment_id = null
```

But a type-level state model becomes counterproductive when:

- the state also depends on external durable facts;
- generic machinery becomes harder than runtime validation;
- the language cannot express the invariant safely;
- state transitions cross process/database boundaries.

Use the strongest **appropriate** enforcement layer, not the most clever type trick.

## 7.6 Null / absence

Do not use “never return null” as a universal rule.

Instead define whether absence means:

- expected no result;
- unknown/not loaded;
- permission-hidden;
- deleted;
- failed dependency;
- programmer error.

Representations should preserve distinctions that change caller behavior.

---

# 8. Modules, information hiding and change locality

## 8.1 The module test

A useful module answers:

```yaml
concept_owned:
state_owned:
policies_owned:
public_capability:
hidden_decisions:
dependencies:
mutation_authority:
expected_change_pressure:
```

## 8.2 Information hiding

Parnas’ durable contribution is not “make more modules”. It is that modularization quality depends on **what decision is hidden** [S06].

Hide decisions likely to change:

- persistence representation;
- external provider semantics;
- serialization;
- pricing/routing policy;
- cache implementation;
- authorization mechanism;
- model/vendor implementation;
- platform-specific behavior.

Do not hide behavior behind a module that merely forwards calls one-to-one without reducing volatility or semantic complexity.

## 8.3 Semantic cohesion

Use this operational definition:

> A unit is cohesive when its behavior, data and rules jointly express one concept/policy/capability and normally change for related reasons.

This replaces vague “one responsibility” dogma.

## 8.4 Change-locality test

Before choosing a boundary, simulate likely changes:

- switch provider;
- add state;
- change policy;
- add validation rule;
- change persistence;
- change authorization requirement;
- alter output representation;
- add a new consumer.

A good boundary keeps expected changes local **without hiding cross-cutting invariants**.

## 8.5 Coupling

Track meaningful coupling types:

- compile/import coupling;
- runtime/network coupling;
- data/schema coupling;
- temporal ordering;
- shared-state coupling;
- deployment coupling;
- policy coupling;
- organizational ownership coupling.

“Low coupling” is not achieved by replacing one import with five layers that still must change together.

## 8.6 Cycles

A cycle becomes a problem when it creates:

- unclear initialization order;
- hidden recursive behavior;
- impossible independent test/build;
- unclear ownership;
- broad change propagation;
- deployment deadlock;
- dependency injection/container complexity.

If none occurs and the domain is genuinely mutually recursive, a cycle may be acceptable.

---

# 9. Interface and API construction

## 9.1 Contract model

A material interface may need:

```yaml
purpose:
accepted_inputs:
semantic_validation:
preconditions:
authorization:
outputs:
side_effects:
failure_modes:
idempotency:
ordering:
timeouts_or_cancellation:
consistency_or_freshness:
resource_limits:
compatibility:
deprecation:
```

Not every local function needs all fields. Apply proportionately.

## 9.2 Minimum coherent capability

Avoid two extremes:

```text
HUGE INTERFACE
→ consumers receive authority/knowledge they do not need

MICRO-INTERFACE EXPLOSION
→ consumers traverse excessive indirection and object graphs
```

Expose a coherent capability at the smallest useful boundary.

## 9.3 Interface segregation without dogma

Split an interface when:

- different consumers need materially different authority;
- methods evolve independently;
- implementation substitution differs;
- one consumer must not receive a capability;
- testing/compatibility benefits are real.

Do not split merely because “ISP says so”.

## 9.4 API usability evidence

Empirical REST API work has found that some API design-rule violations materially harm comprehension in controlled tasks [S17]. Industrial API-usability work also shows that real developer histories reveal conceptual and usability failures that static interface shape alone misses.

Implication:

> API quality must be validated with realistic consumer tasks where the interface is consequential.

---

# 10. Error and failure construction

## 10.1 Failure taxonomy

Classify by what the caller should do.

### Expected domain outcome

Examples:

- validation rejected;
- already exists;
- conflict;
- not found where absence is normal;
- business rule not satisfied.

### Dependency/environment failure

Examples:

- timeout;
- unavailable service;
- filesystem failure;
- rate limit;
- network reset.

### Invariant/programmer failure

Examples:

- impossible state;
- violated internal precondition;
- corrupt assumption;
- unreachable variant reached.

### Security/policy denial

Examples:

- unauthorized;
- forbidden action;
- tenant boundary rejection.

These categories MAY share one language mechanism while retaining distinct semantics.

## 10.2 Propagation

Good propagation preserves:

- cause;
- operation/context;
- relevant resource identity (safely);
- retry/recovery classification when useful;
- correlation trace;
- security/privacy boundaries.

Bad propagation repeatedly wraps an error with noise that destroys the useful cause.

## 10.3 Catch/handle rule

Handle only when the layer can do one of:

1. recover;
2. compensate;
3. translate to its stable contract;
4. add material context;
5. enforce containment;
6. clean up;
7. record/alert at the ownership boundary.

Otherwise propagate according to language conventions.

## 10.4 Broad catches

A broad catch is often legitimate at:

- request boundary;
- job worker boundary;
- process supervisor;
- plugin sandbox;
- message consumer boundary;

provided it deliberately defines containment, logging and resulting state.

This is why `catch (Exception)` cannot be classified as a defect from syntax alone [S16].

## 10.5 Error messages

Separate:

- safe user-facing message;
- stable machine code/type;
- operator diagnostic context.

Do not force one message to serve all audiences.

## 10.6 Failure testing

For C2+ changes, test as relevant:

- dependency failure;
- partial completion;
- cancellation;
- retry/duplicate;
- corrupted input;
- resource exhaustion;
- cleanup failure;
- simultaneous failures.

---

# 11. Abstraction and indirection

## 11.1 Abstraction gate

Before creating an abstraction, answer:

```yaml
shared_concept:
same_reason_to_change:
stable_boundary:
callers_need_substitution:
policy_enforced:
cognitive_cost_before:
cognitive_cost_after:
failure_modes_hidden_or_added:
```

If these cannot be answered, explicit code is normally safer.

## 11.2 Wrong abstraction indicators

Re-evaluate when:

- many booleans/modes are added;
- callers inspect implementation type;
- callers bypass the abstraction;
- every new feature adds another escape hatch;
- abstraction exposes all underlying provider details;
- changes require editing abstraction + all implementations + all consumers;
- generic naming replaces domain language;
- stack traces/diagnosis become materially harder.

## 11.3 Dependency inversion

Use inversion when a higher-value policy should not depend directly on volatile implementation detail.

Do not use:

```text
Controller
→ IControllerService
→ ControllerService
→ IRepository
→ Repository
```

as automatic architecture.

If each layer is one-to-one delegation with no information hiding, policy, authority, lifecycle or test value, it is likely accidental complexity.

## 11.4 Generics and meta-programming

Use generic/metaprogramming mechanisms when they:

- encode one stable family of operations;
- remove unsafe duplication;
- preserve readable failure messages/tooling;
- keep call sites simpler.

Avoid when the maintainer must mentally execute a meta-language to understand ordinary behavior.

---

# 12. Duplication, clones and DRY

## 12.1 Four kinds of duplication

### A. Syntactic duplication

Similar code text.

May or may not be harmful.

### B. Knowledge duplication

The same policy/fact encoded independently in multiple places.

High divergence risk.

### C. Structural duplication

Repeated scaffolding required by platform/language.

May be acceptable or generated.

### D. Intentional clone

A deliberate copy used for isolation, migration, experiment or specialization.

Can be reasonable with lifecycle control.

## 12.2 DRY decision

```text
Do two fragments encode the same knowledge/policy?
  ├─ NO / UNSURE → tolerate duplication
  └─ YES → Must changes remain synchronized?
              ├─ NO → independent copies may be valid
              └─ YES → can a stable shared representation reduce total risk?
                           ├─ YES → centralize
                           └─ NO → keep explicit and add synchronization evidence
```

## 12.3 Clone evidence

The research is deliberately contradictory:

- Juergens et al.: inconsistent changes to clones can produce faults [S11].
- Bettenburg et al.: release-level defect effect much smaller in studied systems [S12].
- Rahman et al.: little evidence that clones were generally more defect-prone in studied data [S14].
- Kapser & Godfrey: documented principled cloning patterns [S13].

The only defensible universal rule is:

> **Do not treat clone presence or clone count as a quality verdict. Analyze synchronized-change and divergence risk.**

## 12.4 Generated code

Generated copies are acceptable when:

- generator/template/schema is canonical;
- generated outputs are deterministic enough for control;
- humans do not manually edit generated copies;
- regeneration is part of build/change process;
- source and generator are versioned.

---

# 13. Readability and program comprehension

## 13.1 Readability is an outcome

Readable code lets the intended maintainer:

- identify purpose;
- follow control/data flow;
- locate mutation;
- understand invariants;
- predict important side effects;
- identify failure behavior;
- modify code without reconstructing unrelated internals.

“Looks elegant” is not the criterion.

## 13.2 Naming

Use names to carry information that matters for correctness:

Good dimensions:

- domain role;
- unit;
- scope;
- lifecycle;
- authority;
- direction;
- state.

Avoid encoding every implementation detail into names.

Empirical identifier studies show descriptive names can improve semantic comprehension in some tasks, with effects depending on task and experience [S18]. This supports meaningful names—not maximum name length.

## 13.3 Abbreviations

Allowed:

- universally understood domain terms;
- mathematically conventional names in tight scope;
- local loop/index names where semantics are obvious;
- project vocabulary established for the audience.

Avoid private shorthand requiring author memory.

## 13.4 Comments

Comment when information is both:

1. necessary for correct future decisions; and
2. not reliably expressible in code/types/tests/names alone.

High-value comment categories:

- why algorithm/order is required;
- external standard/protocol quirk;
- invariant crossing nonlocal code;
- security/safety constraint;
- performance trade-off proven by measurement;
- workaround and removal trigger;
- intentionally surprising behavior.

Low-value comments:

```text
i++; // increment i
```

Comment effectiveness varies by context; 2026 eye-tracking evidence does not support “more comments = more comprehension” [S19].

## 13.5 Formatting

Formatting is a machine problem.

Use one formatter/convention where possible. Do not consume repeated human review attention debating machine-resolvable style.

## 13.6 Cleverness

A clever solution has to earn its cognitive cost through a material requirement such as:

- performance;
- memory;
- correctness;
- platform constraint;
- algorithmic simplification.

If not, prefer the approach a competent maintainer can reason about fastest.

---

# 14. Functions, classes, objects and control flow

## 14.1 No universal line-count limits

V2 prohibits universal rules such as:

```text
function <= 20 lines
class <= 200 lines
file <= 500 lines
```

unless a local system has validated the threshold for a specific decision.

ISO/IEC 25023’s refusal to provide universal quality measure grade ranges strongly supports this posture [S04].

## 14.2 Split test

Split a function/module when doing so improves one or more of:

- semantic cohesion;
- named reuse;
- invariant visibility;
- independent verification;
- failure isolation;
- change locality;
- policy separation;
- authority separation.

Do not split when it creates:

- navigation ping-pong;
- naming with no added meaning;
- hidden execution order;
- parameter plumbing;
- scattered invariants;
- excessive indirection.

## 14.3 Complexity metrics

Cyclomatic Complexity, Cognitive Complexity, LOC and similar measures MAY:

- flag outliers;
- identify growth/regressions;
- prioritize review;
- support local thresholds calibrated to outcomes.

They MUST NOT:

- automatically reject code as “unmaintainable”;
- substitute for comprehension testing;
- cause behavior to be fragmented purely to lower a score.

Cognitive Complexity has not shown clear superiority over traditional metrics for predicting understandability in empirical evaluation [S05]. Structural measures alone can have limited predictive accuracy [S15].

## 14.4 State machines

When nested branches encode lifecycle transitions, make states/transitions explicit.

Useful when:

- only certain transitions allowed;
- concurrency matters;
- transition side effects differ;
- failure/recovery differs by state.

Do not create formal state machinery for trivial binary conditions.

---

# 15. Refactoring Standard

## 15.1 Definition

Refactoring is a structural change intended to preserve the declared externally relevant behavior while improving a named engineering property.

## 15.2 Refactoring brief

Before material refactoring:

```yaml
problem:
evidence_of_problem:
target_quality_attribute:
behavior_to_preserve:
invariants:
scope:
risk:
verification:
expected_change_locality_after:
stop_rule:
rollback_or_recovery:
```

## 15.3 Valid refactoring goals

Examples:

- reduce policy duplication;
- isolate volatile provider;
- reduce change scattering;
- make state machine explicit;
- improve test boundary;
- remove dead path;
- narrow authority;
- replace unsafe representation;
- reduce measured performance/resource bottleneck;
- enable required compatibility change.

“A smell exists” is not enough.

## 15.4 Safety sequence

```text
UNDERSTAND
→ CHARACTERIZE
→ DEFINE PRESERVED BEHAVIOR
→ MAKE SMALL STRUCTURAL CHANGE
→ VERIFY
→ REVIEW NEW COMPLEXITY
→ CONTINUE / STOP
```

## 15.5 Evidence boundary

The 2019 systematic mapping of refactoring studies found inconsistent quality effects and contradictory findings across settings [S10].

Therefore:

> **Refactoring is not assumed beneficial merely because a catalog calls the old structure a smell.**

## 15.6 Refactor vs rewrite

Refactor/evolve by default when:

- core semantics are valuable;
- behavior can be characterized;
- risk can be reduced incrementally;
- boundaries can be introduced gradually.

Rewrite becomes more defensible when:

- hard platform/runtime constraints cannot be satisfied;
- critical foundation assumptions are invalid;
- legacy environment cannot be supported;
- new system can be validated in parallel;
- migration boundary and rollback/exit are credible.

Rewrite risk includes:

- unknown behavior loss;
- migration defects;
- dual-system cost;
- missing edge-case knowledge;
- delayed value.

---

# 16. Dependencies and reuse standard

## 16.1 Dependency decision record

For material dependencies:

```yaml
capability:
why_needed:
local_or_existing_alternative:
maintainer/governance:
release_activity:
license:
security/provenance:
transitive_surface:
runtime_privilege:
data_access:
compatibility:
update_strategy:
lock_or_pin:
exit_cost:
owner:
```

## 16.2 Dependency bloat

Maven research found substantial dependency bloat in its sampled ecosystem [S22]. The transferable principle is:

> **Unused dependencies create avoidable surface and SHOULD be removed when non-use is verified.**

Do not mechanically apply static “unused” results where runtime loading, reflection, plugin discovery, generated code or build tooling may create real use.

## 16.3 Build vs depend

Prefer a dependency when:

- capability is complex and mature implementation materially reduces risk;
- standards/crypto/parsing expertise matters;
- maintenance ecosystem is strong;
- update path is acceptable;
- API surface is stable enough.

Prefer local implementation when:

- behavior is trivial;
- dependency transitive/privilege surface is disproportionate;
- long-term ownership is simpler locally;
- dependency imposes unacceptable policy/license/data/availability cost.

## 16.4 Dependency wrappers

Wrap a third-party API when the wrapper:

- isolates vendor semantics;
- enforces domain policy;
- narrows authority;
- stabilizes error semantics;
- protects migration boundary.

Do not wrap every library by default.

---

# 17. Maintainability and technical debt

## 17.1 Maintainability evidence

Maintainability is better inferred from actual tasks/signals than from a style score.

Useful evidence:

- time/effort for representative change;
- defect/change failure;
- number of independently changing modules touched;
- review comprehension;
- onboarding comprehension;
- test feedback;
- dependency upgrade difficulty;
- repeated incident/change hotspots;
- ownership gaps;
- dead compatibility burden.

## 17.2 Technical debt record

```yaml
item:
decision_or_constraint:
future_cost_or_risk:
evidence:
interest_paid_now:
affected_changes:
trigger_for_action:
remediation_options:
owner:
expiry_or_review:
```

“Ugly code” is not a debt definition.

## 17.3 Hotspot logic

Prioritize code improvement when **complexity/change frequency/consequence** intersect.

A rarely changed complex parser may be less urgent than a moderately complex pricing/authorization module changed every week.

## 17.4 Delete safely

Before deleting code:

- verify references/usage;
- inspect runtime/dynamic usage;
- check compatibility consumers;
- check feature/config flags;
- verify migration/deprecation;
- preserve required historical/audit evidence;
- run relevant regression tests.

---

# 18. Code review and change design

## 18.1 Review objective

Review is independent engineering evidence and knowledge transfer, not a formatting ceremony.

Google’s large industrial study documents modern code review’s role in code improvement, defect detection and knowledge sharing in that environment [S20].

## 18.2 Review focus

Prioritize:

1. intent;
2. correctness/invariants;
3. security/privacy implications;
4. state/authority;
5. failure semantics;
6. maintainability/change locality;
7. new dependencies;
8. test/evidence quality;
9. operational compatibility;
10. unnecessary complexity.

Formatting/lint/type-check results SHOULD be automated.

## 18.3 Change size

Google’s engineering guidance explicitly rejects hard line-count rules for “small changes”, instead emphasizing one self-contained understandable change [S21].

V2 adopts the principle, not Google’s example sizes.

Target:

> **the smallest change that preserves one coherent outcome/invariant and can be reviewed/integrated safely.**

## 18.4 Refactoring and feature work

Separate when:

- structural change obscures behavioral diff;
- rollback needs differ;
- reviewers need characterization baseline;
- risk can be staged.

Keep together when:

- splitting creates an invalid intermediate state;
- behavior/invariant cannot be understood independently.

---

# 19. AI-assisted construction standard

## 19.1 Provenance-neutral quality

Judge code by:

- behavior;
- risk;
- evidence;
- maintainability;
- comprehension;
- integration;
- security;
- ownership.

Not by whether a human or model typed it.

## 19.2 Current evidence

### Maintainability

Borg et al. (2026), in a preregistered experiment with 151 participants (95% professionals), did not detect systematic downstream maintainability advantages or disadvantages for the studied AI-co-developed Java code [S23].

This falsifies the universal claim:

> AI-generated code is inherently less maintainable.

It does not prove maintainability neutrality for all agentic workflows.

### Code ownership

A 2026 IEEE TSE experiment found much higher task completeness with AI but lower ability to answer technical questions about the implemented code in the studied setting [S24].

Construction implication:

> High output volume is not sufficient if accountable humans cannot explain critical behavior.

### Benchmark vs mergeability

METR’s 2026 maintainer-review study found maintainer merge decisions materially below automated SWE-bench pass rates in its sample [S25].

Construction implication:

> Green benchmark/tests are evidence, not repository-quality proof.

## 19.3 AI change acceptance

For material generated code:

- [ ] intent/specification is correct;
- [ ] responsible reviewer understands relevant invariants;
- [ ] generated API/dependency claims are verified;
- [ ] tests cover risk-relevant behavior and failure;
- [ ] no control/test was weakened to make the change pass;
- [ ] diff has no unrelated generated churn;
- [ ] security/authorization logic has appropriate independent review;
- [ ] migrations/commands are inspected;
- [ ] documentation/rationale is current;
- [ ] deploy/recovery implications are understood.

## 19.4 AI code volume

Do not optimize:

- generated lines;
- commits;
- tokens;
- “accepted suggestions”;
- benchmark score alone.

Prefer:

```text
accepted useful outcome
+ cycle time
+ review effort
+ rework
+ escaped defects
+ comprehension/ownership
+ maintainability
+ operational/security outcome
```

---

# 20. Universal construction decision framework

When a code-quality decision is disputed:

## Step 1 — State the behavior

What observable behavior must exist or remain unchanged?

## Step 2 — State the invariant

What must never become false?

## Step 3 — State likely change pressure

What is likely to vary independently?

## Step 4 — Locate ownership

Who/what owns the state, policy and decision?

## Step 5 — Identify failure modes

How can each option fail or become hard to change?

## Step 6 — Compare cognitive/dependency cost

Count concepts and hidden coupling, not merely LOC.

## Step 7 — Select the least complex adequate structure

Prefer the option that:

- preserves invariants;
- supports local reasoning;
- contains change;
- exposes failure;
- minimizes novel dependencies;
- is verifiable.

## Step 8 — Gather evidence

As relevant:

- tests;
- static analysis;
- dependency graph;
- benchmark;
- code-history hotspot;
- user/developer comprehension test;
- proof/model;
- review;
- production telemetry.

## Step 9 — Define revisit trigger

Examples:

- repeated divergent edits;
- recurring defect;
- new consumer;
- performance threshold;
- dependency EOL;
- comprehension failure;
- changed regulation/contract.

---

# 21. Construction decision trees

## 21.1 Introduce an abstraction?

```text
Do the candidates represent the same domain knowledge/policy?
  ├─ NO / UNSURE → keep explicit
  └─ YES → Do they need to change together?
              ├─ NO → keep independent
              └─ YES → Is there a stable contract/boundary?
                           ├─ NO → centralize knowledge without over-generalizing
                           └─ YES → create smallest useful abstraction
```

## 21.2 Introduce an interface?

```text
Is there a real policy/authority/volatility/substitution boundary?
  ├─ NO → depend on concrete implementation
  └─ YES → Can consumers share one coherent capability contract?
              ├─ NO → reconsider boundary
              └─ YES → define narrow contract
```

## 21.3 Remove duplication?

```text
Is it duplicated knowledge?
  ├─ NO → no automatic action
  └─ YES → Has divergence caused or plausibly created material error/change cost?
              ├─ NO → monitor / delay abstraction
              └─ YES → centralize or enforce synchronization
```

## 21.4 Refactor a smell?

```text
Is there a named maintenance/correctness/risk problem?
  ├─ NO → do not refactor only for the smell
  └─ YES → Can the target improvement be verified?
              ├─ NO → gather evidence/characterization first
              └─ YES → refactor incrementally and re-measure
```

## 21.5 Composition or inheritance?

```text
Is there a stable semantic subtype relation?
  ├─ NO → prefer composition/delegation
  └─ YES → Does inheritance hide coupling or expose parent implementation?
              ├─ YES → composition likely clearer
              └─ NO → inheritance may be appropriate
```

## 21.6 Exception or result/error value?

```text
Does the language/runtime have a strong idiom/contract?
  ├─ YES → follow it unless domain constraint overrides
  └─ NO → Can caller reasonably recover/branch on failure?
              ├─ YES → explicit result may improve control flow
              └─ NO → propagation mechanism may be clearer

Always preserve causal/failure semantics independent of syntax.
```

## 21.7 Add a dependency?

```text
Is capability non-trivial or high-risk to implement correctly?
  ├─ YES → assess mature dependency first
  └─ NO → compare local implementation with dependency lifetime surface

Does dependency meet security/license/support/update/exit constraints?
  ├─ NO → avoid / find alternative
  └─ YES → add intentionally with owner/update policy
```

## 21.8 Comment this code?

```text
Is important information missing from names/types/tests/contracts?
  ├─ NO → do not narrate syntax
  └─ YES → Is the information durable rationale/constraint/invariant?
              ├─ YES → comment/document it
              └─ NO → improve code/structure if possible
```

---

# 22. PLAY-CONSTRUCT-001 — Construct a material code change

## Objective

Produce the smallest coherent implementation that satisfies the intended behavior and quality constraints with adequate evidence.

## Use when

- adding/changing production behavior;
- implementing a material defect fix;
- modifying important internal policy;
- accepting a significant AI-generated change.

## Preconditions

- intent/acceptance known;
- criticality known;
- relevant architecture/security/privacy/testing overlays identified.

## Execution

1. State behavior and invariant.
2. Inspect existing canonical code/boundaries.
3. Identify state and authority.
4. Choose simplest adequate representation.
5. Define contract and failure semantics.
6. Implement with explicit dependencies.
7. Validate external input/trust transitions.
8. Add/adjust risk-relevant verification.
9. Remove accidental complexity introduced by implementation.
10. Review dependency and compatibility effects.
11. Run automated deterministic checks.
12. Perform independent review proportional to risk.
13. Verify post-integration behavior if material.

## Acceptance criteria

- [ ] required behavior satisfied;
- [ ] material invariants preserved;
- [ ] invalid/untrusted input controlled;
- [ ] state/authority understandable;
- [ ] failure semantics intentional;
- [ ] abstraction/dependency justified;
- [ ] no uncontrolled duplicated knowledge;
- [ ] risk-relevant tests/evidence pass;
- [ ] code is understandable by reviewer;
- [ ] operational/migration implications handled.

---

# 23. PLAY-REFACTOR-001 — Refactor safely

## Trigger

A real quality/change problem exists.

## Inputs

- problem evidence;
- behavior to preserve;
- regression/characterization evidence;
- target quality outcome.

## Execution

1. Name the problem without using a smell name as the explanation.
2. Establish baseline behavior.
3. Identify smallest structural move.
4. Separate behavior change if practical.
5. Apply change.
6. Verify behavior/invariants.
7. Compare target signal before/after.
8. Inspect new complexity/indirection.
9. Stop if marginal benefit no longer justifies risk.
10. Record rationale when future maintainers could otherwise undo it.

## Failure modes

| Failure | Detection | Response |
|---|---|---|
| behavior changed unintentionally | regression/contract failure | revert/fix before further refactor |
| abstraction expands flags/modes | review | narrow/remove abstraction |
| tests coupled to old internals | excessive test rewrite | move verification toward behavior |
| quality metric improves but comprehension worsens | reviewer/task evidence | reject metric-driven change |
| large refactor blocks delivery | prolonged branch/review | stage incremental boundaries |

---

# 24. PLAY-DEPENDENCY-001 — Add or replace a dependency

## Objective

Acquire capability without creating unjustified lifetime risk.

## Decision dimensions

- correctness value;
- implementation complexity avoided;
- security/provenance;
- maintenance activity;
- release/support policy;
- transitive surface;
- license;
- data/privilege;
- performance;
- ecosystem compatibility;
- lock-in/exit;
- team familiarity.

## Acceptance criteria

- [ ] capability need is real;
- [ ] existing/internal alternative assessed;
- [ ] package/project identity verified;
- [ ] owner/update strategy exists;
- [ ] license acceptable;
- [ ] security/supply-chain policy satisfied;
- [ ] transitive/runtime surface understood proportionately;
- [ ] dependency is actually used;
- [ ] exit path acceptable for material dependency.

---

# 25. PLAY-ERROR-001 — Design failure semantics

## Objective

Make caller/operator behavior correct when the operation does not succeed.

## Execution

1. Enumerate expected domain outcomes.
2. Enumerate dependency/environment failure.
3. Enumerate invariant/programmer failure.
4. Define caller recovery/branching needs.
5. Choose language-idiomatic representation.
6. Preserve cause/context.
7. Define user-safe vs operator detail.
8. Define cleanup/partial completion.
9. Define retry/idempotency interaction.
10. Verify important failure paths.

---

# 26. Pull-request / code-review standard

## Intent

- [ ] change reason and acceptance condition clear;
- [ ] scope coherent;
- [ ] behavior vs refactor distinction visible.

## Correctness

- [ ] invariant identified where material;
- [ ] boundary/invalid input handled;
- [ ] state mutation/authority correct;
- [ ] concurrency/order considered where relevant;
- [ ] failure path intentional.

## Structure

- [ ] module/boundary hides real volatility/policy;
- [ ] no speculative abstraction;
- [ ] no unjustified interface/layer;
- [ ] duplicated knowledge assessed;
- [ ] names expose useful domain meaning;
- [ ] comments preserve useful non-obvious information.

## Dependencies

- [ ] new dependency justified;
- [ ] unused dependency not introduced;
- [ ] update/compatibility implications known.

## Verification

- [ ] tests/evidence address actual risks;
- [ ] static checks used appropriately;
- [ ] no metric/coverage score substituted for behavior.

## Maintainability

- [ ] reviewer can explain change;
- [ ] likely future change remains local enough;
- [ ] no hidden global state/action-at-distance introduced;
- [ ] debt/workaround has explicit consequence/trigger.

## AI-generated change

- [ ] not accepted on AI self-assessment alone;
- [ ] external claims verified;
- [ ] no unrelated churn;
- [ ] responsible human/system owner understands material behavior;
- [ ] benchmark/test pass not mistaken for mergeability.

---

# 27. Construction metrics and Goodhart resistance

## 27.1 Metrics are questions

For each metric:

```yaml
metric:
question:
decision:
population:
known_confounders:
threshold_basis:
gaming_risk:
review_trigger:
```

If `decision` and `threshold_basis` are blank, do not turn the metric into a gate.

## 27.2 Useful metric families

Potential signals:

- change frequency;
- defect history;
- code churn;
- dependency fan-in/fan-out;
- clone divergence;
- source complexity;
- test feedback time;
- review duration;
- number of modules touched per conceptual change;
- dependency upgrade lag;
- dead code;
- static-analysis findings.

They remain proxies.

## 27.3 Prohibited metric interpretations

Do not infer:

```text
LOW LOC = GOOD CODE
HIGH COVERAGE = CORRECT CODE
LOW CYCLOMATIC COMPLEXITY = UNDERSTANDABLE CODE
LOW COGNITIVE COMPLEXITY = MAINTAINABLE CODE
ZERO SMELLS = GOOD DESIGN
FEW DEPENDENCIES = SAFE CODE
MANY COMMENTS = DOCUMENTED CODE
SMALL PR = LOW RISK
GREEN CI = PRODUCTION READY
```

without supporting evidence.

## 27.4 Local thresholds

A team MAY establish thresholds when:

- outcome/problem is explicit;
- historical/local data supports the threshold;
- exceptions are allowed with rationale;
- threshold is periodically validated against real maintenance/failure outcomes;
- gaming is monitored.

---

# 28. Coding folklore falsification standard

| Claim | V2 verdict | Class | Evidence-weighted replacement |
|---|---|---:|---|
| Strong typing prevents bugs | Bounded truth | B | Types prevent some representable errors; they are one layer |
| Static languages create higher-quality software | Unsupported universal | F | Choose language by scoped requirements |
| Dynamic typing is always faster | Unsupported universal | F | Measure local workflow/outcome |
| Make invalid states unrepresentable | Strong contextual | B | Make material invalid states difficult at appropriate layer |
| DRY everything | False | F | Avoid duplicated knowledge requiring synchronization |
| Duplication is always bad | False | F | Analyze divergence/change coupling |
| Duplication is always cheaper than wrong abstraction | Heuristic | D | Delay abstraction while semantics diverge |
| Rule of Three is a law | Heuristic | D | Abstract when stable shared knowledge is demonstrated |
| Function must be under N lines | False threshold | F | Split by cohesion/local reasoning |
| Class must be under N lines | False threshold | F | Split by policy/lifecycle/change boundary |
| Cyclomatic Complexity < 10 = good | False universal threshold | F | Use as contextual diagnostic |
| Cognitive Complexity is superior | Not supported | F | Use multiple signals + human/task evidence |
| Maintainability Index proves maintainability | False assurance | F | Measure actual change/comprehension outcomes |
| SOLID is proven best practice | Not established as package | D | Apply individual mechanisms only when problem exists |
| SRP yields one objectively correct class split | False | F/D | Use semantic cohesion/change locality |
| OCP means design for future extension now | Risky literalism | D | Add extension points for credible variability |
| ISP means tiny interfaces | False literalism | D | Expose minimum coherent capability |
| DIP means interface for every dependency | False | F | Invert meaningful volatile/policy boundaries |
| Composition always beats inheritance | False universal | D | Choose clearer variation/subtype model |
| Inheritance is bad | False universal | F | Evaluate hierarchy semantics/coupling |
| Design patterns improve quality | Contradictory evidence | E/D | Pattern = option + shared vocabulary |
| Code smells are defects | Not supported | D | Smell = investigation signal |
| Remove every smell | False | F | Refactor against demonstrated quality problem |
| Long method is always bad | False universal | D | Examine cohesion/control/change burden |
| God class detector proves design problem | Proxy only | D | Inspect ownership/change coupling |
| Refactoring always improves quality | False | F | Target named attribute and verify |
| Refactor whenever you see duplication | False | F | Determine knowledge sameness first |
| Rewrite removes technical debt | Incomplete | E | Rewrite exchanges known debt for migration/unknown risk |
| Never rewrite | Also false | F | Rewrite when hard constraints justify migration risk |
| Good code is self-documenting | False | F | Mechanics can be clear; rationale/constraints still need durable docs |
| Comments are code smell | False | F | Preserve useful non-obvious information |
| More comments improve comprehension | Context-dependent | F | Optimize comment information value |
| Descriptive names should be as long as possible | False | F | Use enough semantic information for task/audience |
| Abbreviations are always bad | False | D | Use conventional abbreviations; avoid private shorthand |
| Clever code is always bad | Too absolute | D | Cleverness must earn cognitive cost through real constraint |
| Guard clauses are always clearer | Contextual | D | Use when they clarify exits/preconditions |
| Single return is always better | Contextual | D | Choose flow easiest to reason about |
| Multiple returns are always better | Contextual | D | Same |
| Exceptions are bad | False | F | Explicit failure semantics matter |
| Exceptions are always better than result values | False | F | Follow language/domain recovery semantics |
| Result types are always better | False | F | Same |
| Never catch generic exceptions | Too absolute | D | Broad catch can be correct at containment boundary |
| Never return null | Contextual | D/E | Model absence meaning explicitly |
| Interfaces make code testable | False | F | Test behavior through appropriate controllable boundaries |
| Mock everything | False | F | Use mocks only where they preserve relevant contract semantics |
| Dependency injection container = decoupled design | False | E | Explicit dependencies matter; container is optional |
| Repository layer is best practice | Contextual | E | Add only when hiding real persistence volatility/semantics |
| Service layer is best practice | Contextual | E | Add only for real policy/orchestration boundary |
| Functional programming is more maintainable | Broad unsupported universal | F | Use paradigm mechanisms where they reduce risk |
| OOP is more maintainable | Broad unsupported universal | F | Same |
| Pure functions solve state problems | Incomplete | D | Local purity helps reasoning; effects/state still need ownership |
| Immutability everywhere | Overbroad | D | Prefer where change/state risk warrants; account for cost/model |
| Few dependencies = better code | False | F | Minimize unjustified dependency surface |
| Never use a dependency for a small utility | Contextual | D | Compare lifetime risk |
| Always update dependencies immediately | False | F | Monitor and deliberately update |
| Never update stable dependencies | False | F | Unsupported/stale deps create risk |
| Lint clean = clean code | False assurance | F | Lint covers machine-detectable rules only |
| Zero warnings = quality | False assurance | F | Warnings are evidence |
| 100% coverage = quality | False assurance | F | Coverage ≠ correctness |
| TDD always yields better code | Context-dependent inherited evidence | D | Use when test-first feedback helps |
| Pair programming is always better | Context-dependent inherited evidence | D | Use where objective justifies effort |
| Small PR = good PR | Incomplete | D | Smallest coherent safe change |
| More abstractions = flexible code | False | F | Abstraction carries cognitive cost |
| Fewer abstractions = simpler code | Also false | F | Hide necessary volatility/policy |
| AI code is inherently insecure | False universal | F | Independently verify security regardless of author |
| AI code is inherently unmaintainable | Not supported | F | Measure local maintenance evidence |
| AI tests can validate AI code by themselves | Weak independence | F | Add diverse deterministic/human/runtime evidence |
| Passing SWE-bench means production-ready | Empirically false as naive mapping | F | Maintainer/integration/quality evidence still required |
| More generated code = productivity | False metric | F | Measure accepted outcome + downstream burden |

---

# 29. Contradiction ledger

| Tension | V2 resolution |
|---|---|
| Type safety vs type complexity | Encode high-value invariants; stop when type machinery costs more comprehension than it protects |
| Abstraction vs explicit code | Abstract stable shared knowledge/policy; retain explicit code while semantics differ |
| DRY vs duplication | Remove synchronized knowledge duplication; tolerate syntax clones when divergence is intentional |
| Small functions vs navigation | Split for semantic clarity, not size; avoid call-chain ping-pong |
| Cohesion vs reuse | Prefer domain cohesion over generalized reuse that couples unrelated change |
| Interface vs concrete dependency | Interface across real boundary; concrete dependency is fine when no boundary exists |
| Composition vs inheritance | Use the representation that best expresses stable variation with least hidden coupling |
| Exception vs result | Preserve recovery semantics; syntax follows language/runtime/domain |
| Comments vs self-documenting code | Put mechanics in code; preserve non-obvious rationale/constraints in durable documentation |
| Metrics vs judgment | Metrics identify questions; evidence and outcomes decide |
| Smells vs stable legacy | Smell alone does not justify risk of change |
| Refactor vs feature delivery | Refactor when it reduces material current/future risk; stop aesthetic churn |
| Refactor vs rewrite | Prefer incremental evidence-preserving evolution; rewrite only under hard foundation constraints |
| Local code vs dependency | Compare correctness/security/maintenance/exit lifetime cost |
| AI throughput vs understanding | Protect code ownership/comprehension for accountable systems |
| Small diff vs coherent invariant | Do not fragment one invariant merely to shrink line count |
| Pure code vs operational state | Favor explicit effects and clear state ownership; not purity for its own sake |

---

# 30. Universal vs contextual

## 30.1 Strong universal defaults

Rarely omit:

- intended behavior;
- material invariants;
- explicit ownership/state authority;
- semantic boundary validation;
- failure visibility;
- information hiding for volatile decisions;
- local reasoning;
- change locality;
- controlled dependencies;
- risk-relevant verification;
- independent review/evidence proportionate to consequence;
- maintainability as real change outcome;
- AI output verification.

## 30.2 Strong contextual principles

Apply when mechanism fits:

- static typing/domain types;
- immutability;
- functional purity;
- dependency inversion;
- composition;
- inheritance;
- interfaces;
- design patterns;
- dependency injection;
- repository/service layers;
- result types vs exceptions;
- refactoring catalog operations;
- formal state machines.

## 30.3 Heuristics only

Useful prompts, never quality laws:

- KISS;
- YAGNI;
- DRY shorthand;
- SOLID;
- Rule of Three;
- “composition over inheritance”;
- “prefer guard clauses”;
- “small functions”;
- code smell catalogs;
- design-pattern catalogs;
- complexity thresholds;
- “boring technology”.

A mature construction standard teaches **when a mechanism earns its cost**.

---

# 31. Construction anti-patterns

## 31.1 Pattern compliance

Symptom: code exists to demonstrate a pattern.

Fix: name the requirement/mechanism the pattern serves; remove it if none.

## 31.2 Interface inflation

Symptom: every concrete class has a one-to-one interface.

Fix: introduce interfaces only at meaningful capability/volatility/authority boundaries.

## 31.3 Abstraction inversion

Symptom: generic abstraction is larger than concrete logic.

Fix: restore explicit implementation; extract only stable shared policy.

## 31.4 DRY by text

Symptom: unrelated code coupled because lines looked alike.

Fix: duplicate until semantic sameness/change coupling is real.

## 31.5 Smell-driven churn

Symptom: stable code changed solely to reduce smell count.

Fix: require quality problem and expected evidence.

## 31.6 Metric gaming

Symptom: methods split into meaningless fragments to lower complexity.

Fix: optimize comprehension/change outcome, not score.

## 31.7 Error laundering

Symptom: each layer wraps an exception with generic text and loses cause.

Fix: add context only where semantics improve.

## 31.8 Silent failure

Symptom: failure swallowed to keep path “clean”.

Fix: define observable contract/recovery.

## 31.9 Comment narration

Symptom: comments repeat syntax and drift.

Fix: remove or replace with rationale/invariant.

## 31.10 Utility landfill

Symptom: “utils/common/helpers” contains unrelated behavior.

Fix: move behavior to concept/policy owner.

## 31.11 Over-generalized domain

Symptom: one generic engine uses modes/flags for unrelated business cases.

Fix: separate concepts; share only proven stable policy.

## 31.12 Dependency convenience

Symptom: package added for trivial behavior without lifetime assessment.

Fix: compare dependency surface with local implementation.

## 31.13 NIH security

Symptom: bespoke crypto/parser/auth because dependency avoidance is considered cleaner.

Fix: prefer vetted specialized implementations where risk justifies.

## 31.14 Review by green CI

Symptom: semantic review skipped because checks pass.

Fix: CI is evidence, not correctness proof.

## 31.15 AI comprehension debt

Symptom: generated system grows faster than accountable humans can explain/change it.

Fix: smaller diffs, architecture constraints, review, documentation and ownership tests.

---

# 32. Quality gates

## Gate 0 — Intent

Pass when:

- intended behavior known;
- criticality known;
- invariant/failure consequence known;
- specialist overlays identified.

## Gate 1 — Construction design

Pass when:

- state/authority clear;
- boundary/contract justified;
- abstraction/dependency justified;
- failure semantics selected;
- no known simpler adequate option ignored.

## Gate 2 — Implementation

Pass when:

- inputs validated at boundaries;
- invariants enforced appropriately;
- side effects visible enough;
- error paths implemented;
- no accidental duplicated knowledge introduced.

## Gate 3 — Verification

Pass when:

- relevant automated checks pass;
- risk-relevant behavior/failure evidence exists;
- metric success is not substituted for behavior;
- high-consequence evidence has adequate independence.

## Gate 4 — Review

Pass when:

- reviewer understands intent/invariants;
- change is coherent/reviewable;
- maintainability/dependency impact acceptable;
- AI-generated material received independent review.

## Gate 5 — Integration

Pass when:

- compatibility/migration implications handled;
- production/config effects understood;
- required docs/decision rationale current.

---

# 33. Definition of Done — material code change

## Intent/correctness

- [ ] behavior/acceptance condition explicit;
- [ ] relevant invariant preserved;
- [ ] invalid state/input addressed;
- [ ] state/authority clear.

## Structure

- [ ] module/abstraction exists for a real reason;
- [ ] change is local enough;
- [ ] duplication assessed by knowledge rather than syntax;
- [ ] no arbitrary metric threshold drove structure.

## Failure

- [ ] expected failures defined;
- [ ] unexpected cause preserved;
- [ ] partial side effects/recovery addressed where relevant;
- [ ] sensitive error data not exposed.

## Dependencies

- [ ] new dependency justified;
- [ ] transitive/privilege/update implications considered;
- [ ] unused/dead dependency not left behind.

## Verification/review

- [ ] deterministic checks pass;
- [ ] important behavior/failure paths verified;
- [ ] reviewer can explain material behavior;
- [ ] blocker defects zero;
- [ ] major defects zero or formally accepted.

## Maintainability

- [ ] naming/contracts sufficiently clear;
- [ ] rationale documented where code cannot carry it;
- [ ] debt/workarounds have consequence/trigger;
- [ ] dead/stale code removed where safe.

## AI

- [ ] AI self-assessment not sole evidence;
- [ ] generated dependency/API claims verified where material;
- [ ] owner understands critical generated behavior;
- [ ] no unrelated generated churn.

---

# 34. Validation scenarios for this playbook

Before promotion to `TESTED`, execute at least:

## Scenario A — duplicated policy

Two modules contain similar authorization rules with diverging history.

Expected: user distinguishes textual duplication from duplicated policy and selects a canonical enforcement boundary.

## Scenario B — long but cohesive function

A 90-line parser is linear, cohesive and well tested.

Expected: user does not split purely for line count; only splits if comprehension/test/change evidence improves.

## Scenario C — code smell without harm

Stable adapter has a catalog smell but near-zero change/fault history.

Expected: no automatic refactor.

## Scenario D — high-churn medium complexity

Pricing module changes weekly and requires edits across six files.

Expected: prioritize change-locality/policy consolidation despite moderate metric scores.

## Scenario E — inheritance vs composition

Framework provides stable subtype contract and deep ecosystem tooling.

Expected: user does not reject inheritance by slogan.

## Scenario F — dependency choice

Security token parsing vs five-line deterministic string formatting.

Expected: dependency posture differs by domain risk/correctness value.

## Scenario G — AI benchmark pass

Generated patch passes tests but reviewer cannot explain edge behavior.

Expected: block/iterate until ownership/evidence adequate.

## Scenario H — exception smell

Top-level worker catches broad error intentionally to isolate one job and record failure.

Expected: evaluate containment semantics rather than syntax alone.

---

# 35. Measurement and learning

Track the playbook as an operating standard, not by rule compliance count.

Potential signals:

- review defects attributable to unclear contracts;
- production defects from invalid state;
- change scattering;
- repeated clone divergence;
- failed dependency upgrades;
- time-to-understand hotspots;
- refactor regressions;
- static-analysis false positive rate;
- code-quality gate bypass rate;
- AI-generated rework/rejection;
- maintainer comprehension;
- technical debt interest.

A “clean code score” is not an outcome.

---

# 36. Research / evidence map

> Evidence is intentionally heterogeneous. Standards define baselines and terminology; systematic reviews summarize mixed literature; controlled studies provide scoped effects; industrial evidence demonstrates mechanisms in real environments. None is promoted beyond its legitimate claim.

## S00 — Master Playbook Standard v2.0-RC1

**Source:** user-provided foundation.  
**Role:** research/evidence/falsification/risk/audit/status architecture.  
**Key inherited mechanisms:** context before prescription; evidence before assertion; proportional rigor; contradiction search; verification/validation; universal vs contextual separation.  
**Limitation:** house standard, not an external certification.

## S01 — Universal Software & AI Engineering Master Playbook v2.0

**Source:** user-provided foundation.  
**Role:** engineering constitution inherited by this specialist playbook.  
**Key mechanisms:** least unjustified complexity; information hiding; explicit invariants/state/authority; controlled dependencies; risk-based verification; AI output as untrusted.  
**Limitation:** root standard intentionally delegates construction depth here.

## S02 — IEEE Computer Society — SWEBOK v4.0a

URL: https://www.computer.org/education/bodies-of-knowledge/software-engineering  
Evidence: `E4 — consensus body of knowledge`  
Use: Software Construction coverage map: fundamentals, managing construction, coding, testing/quality, integration, API design, reuse/dependencies and defensive/error-related techniques.  
Limitation: disciplinary map, not causal evidence that every listed practice is universally optimal.

## S03 — ISO/IEC/IEEE 12207:2026

URL: https://www.iso.org/standard/90219.html  
Evidence: `E1 — international standard`  
Finding: current lifecycle framework applies across development/operation/maintenance/retirement, can be concurrent/iterative and does not mandate one lifecycle methodology.  
Limitation: process framework, not source-code style evidence.

## S04 — ISO/IEC 25023:2016

URL: https://www.iso.org/standard/35747.html  
Evidence: `E1 — international standard`  
Finding: defines software/system product-quality measures and explicitly does not assign universal ranges to quality grades because acceptable values depend on system/product category, integrity and user needs.  
Status: current edition confirmed in 2022 at cutoff.  
Use: falsifies universal metric thresholds.  
Limitation: does not say metrics are useless.

## S05 — Lavazza et al. — Cognitive Complexity evaluation (JSS 2023)

URL: https://doi.org/10.1016/j.jss.2022.111561  
Evidence: `E3 — empirical study`  
Finding: Cognitive Complexity was not materially better than traditional metrics for predicting code understandability in the evaluated data.  
Limitation: scoped datasets/methodology; does not prove complexity metrics have no diagnostic value.

## S06 — D. L. Parnas — “On the Criteria To Be Used in Decomposing Systems into Modules” (CACM 1972)

URL: https://doi.org/10.1145/361598.361623  
Evidence: `E3 — foundational peer-reviewed software engineering`  
Finding: modularization effectiveness depends on decomposition criteria; information hiding improves flexibility/comprehensibility.  
Limitation: foundational principle, not a modern architecture cookbook.

## S07 — Gao, Bird & Barr — “To Type or Not to Type” (ICSE 2017)

URL: https://www.microsoft.com/en-us/research/?p=428532  
Evidence: `E3 — empirical software-engineering study`  
Finding: Flow 0.30 and TypeScript 2.0 each detected about 15% of studied public JavaScript bugs under the reconstruction method.  
Limitation: language/tool/version/sample specific; does not prove statically typed languages are universally superior.

## S08 — Hanenberg et al. — Static types and maintainability (ICPC 2012)

URL: https://ieeexplore.ieee.org/document/6240483/  
Evidence: `E3 — controlled empirical study`  
Finding: static typing benefited studied maintenance activities except semantic-error fixing.  
Limitation: bounded tasks/languages/participants.

## S09 — “A systematic review on the code smell effect” (JSS 2018)

URL: https://doi.org/10.1016/j.jss.2018.07.035  
Evidence: `E2 — systematic review`  
Finding: no strong evidence that smell concept supports practical design-quality evaluation; mixed relationships and low human agreement.  
Limitation: smell definitions and study methods heterogeneous.

## S10 — “How does object-oriented code refactoring influence software quality?” (JSS 2019)

URL: https://doi.org/10.1016/j.jss.2019.110394  
Evidence: `E2 — systematic mapping`  
Finding: refactoring effects on quality attributes inconsistent; industrial/academic findings can conflict.  
Limitation: object-oriented refactoring literature and heterogeneous metrics.

## S11 — Juergens et al. — “Do Code Clones Matter?” (ICSE 2009)

URL: https://doi.org/10.1109/ICSE.2009.5070547  
Evidence: `E3 — large case study`  
Finding: inconsistent clone changes frequent and a meaningful number of faults identified in studied systems.  
Limitation: case-study systems and clone methodology.

## S12 — Bettenburg et al. — inconsistent clone changes at release level (2012)

URL: https://doi.org/10.1016/j.scico.2010.11.010  
Evidence: `E3 — empirical case study`  
Finding: only 1.02–4.00% of clone genealogies introduced software defects at release level in three studied systems, weaker than revision-level claims.  
Limitation: small number of open-source systems.

## S13 — Kapser & Godfrey — “Cloning considered harmful considered harmful” (ESE 2008)

URL: https://doi.org/10.1007/s10664-008-9076-6  
Evidence: `E3 — empirical case-study patterns`  
Finding: cloning observed as a principled engineering tool in some contexts.  
Limitation: does not justify indiscriminate duplication.

## S14 — Rahman, Bird & Devanbu — “Clones: What is that Smell?” (MSR 2010)

URL: https://www.microsoft.com/en-us/research/publication/clones-what-is-that-smell-2/  
Evidence: `E3 — repository-mining study`  
Finding: studied clones were not generally more defect-prone; results challenge clone folklore.  
Limitation: observational repository context.

## S15 — Lavazza, Morasca & Gatto — software understandability and code characteristics (ESE 2023)

URL: https://doi.org/10.1007/s10664-023-10396-7  
Evidence: `E3`  
Finding: structural measures correlate with understandability but produced relatively inaccurate predictive models; Cognitive Complexity did not substantially improve them.  
Limitation: small participant/sample size; preliminary.

## S16 — Ebert et al. — exception handling bugs in Java (JSS 2015)

URL: https://doi.org/10.1016/j.jss.2015.04.066  
Evidence: `E3`  
Finding: 220 exception-handling bugs + 154-developer survey; exception handling often under-tested/documented, while common syntactic smells were not simple bug predictors.  
Limitation: Java, Eclipse/Tomcat, exploratory design.

## S17 — REST API design-rule comprehension study (Empirical Software Engineering 2023)

URL: https://doi.org/10.1007/s10664-023-10367-y  
Evidence: `E3`  
Finding: most evaluated API design-rule violations significantly worsened comprehension in the controlled study.  
Limitation: REST and selected rules; not proof of universal API style.

## S18 — “Descriptive Compound Identifier Names Improve Source Code Comprehension” (ICPC 2018)

URL: https://ieeexplore.ieee.org/document/8973056/  
Evidence: `E3`  
Finding: descriptive identifiers improved semantic-defect location time in studied Java tasks; effect depended on task/experience.  
Limitation: bounded task/sample; does not imply maximum identifier length.

## S19 — Abdelsalam et al. — comments and program comprehension (ESE 2026)

URL: https://doi.org/10.1007/s10664-025-10721-2  
Evidence: `E3`  
Finding: comments guide attention and can affect comprehension, but effects vary by code/context.  
Limitation: controlled eye-tracking study; not a universal comment policy.

## S20 — Sadowski et al. — Modern Code Review at Google (ICSE SEIP 2018)

URL: https://research.google/pubs/modern-code-review-a-case-study-at-google/  
Evidence: `E3/E5`  
Finding: evidence from interviews, survey and logs for 9 million reviewed changes; code review serves code improvement, defects, consistency and knowledge sharing in Google’s environment.  
Limitation: Google tooling/culture/scale.

## S21 — Google Engineering Practices — Small CLs

URL: https://github.com/google/eng-practices/blob/master/review/developer/small-cls.md  
Evidence: `E5/E7`  
Finding: recommends self-contained small changes for reviewability and explicitly says there are no hard-and-fast size rules.  
Limitation: practitioner guidance, not universal numeric evidence.

## S22 — Soto-Valero et al. — bloated dependencies in Maven (ESE 2021)

URL: https://doi.org/10.1007/s10664-020-09914-8  
Evidence: `E3`  
Finding: large Maven study found substantial direct/inherited/transitive dependency bloat and demonstrated practical removal in open-source projects.  
Limitation: Java/Maven ecosystem and static analysis assumptions.

## S23 — Borg et al. — “Echoes of AI” (ESE 2026)

URL: https://doi.org/10.1007/s10664-026-10889-1  
Evidence: `E3 — preregistered controlled experiment`  
Finding: in studied tasks, no systematic downstream maintainability advantage/disadvantage detected; 151 participants, 95% professionals.  
Limitation: bounded Java/web tasks and model/tool generation.

## S24 — “More Code, Less Understanding?” (IEEE TSE 2026)

URL: https://doi.org/10.1109/TSE.2026.3679627  
Evidence: `E3 — controlled experiment`  
Finding: AI users achieved much higher median task completeness but lower technical-question performance about their implemented code in the study.  
Limitation: 69 participants and bounded tasks; ownership effect is a risk signal, not a universal effect size.

## S25 — METR — “Many SWE-bench-Passing PRs Would Not Be Merged into Main” (2026)

URL: https://metr.org/notes/2026-03-10-many-swe-bench-passing-prs-would-not-be-merged-into-main/  
Evidence: `E3 — maintainer-review empirical study`  
Finding: maintainer merge decisions materially lower than automated benchmark pass rates in sampled repos; naive benchmark-to-usefulness mapping fails.  
Limitation: 3 repositories; agents had no review iteration; does not establish fundamental capability ceiling.

## S26 — Wedyan & Abufakher — design patterns and software quality SLR (IET Software 2020)

URL: https://doi.org/10.1049/iet-sen.2018.5446  
Evidence: `E2 — systematic literature review`  
Finding: quality effects of GoF patterns are contradictory/hard to compare; little simple consensus.  
Limitation: literature through 2018 and OO/GoF focus.

## S27 — ISO/IEC 5055:2021

URL: https://www.iso.org/standard/80623.html  
Evidence: `E1 — international standard`  
Finding: standardizes automated source-code quality measures based on coding/architectural weaknesses linked to operational risk/cost.  
Status at cutoff: published edition under systematic review.  
Limitation: measured violations are not complete evidence of external quality.

## S28 — IEEE 730-2026

URL: https://standards.ieee.org/ieee/730/10854/  
Evidence: `E1 — active IEEE standard`  
Finding: current standard for initiating/planning/controlling/executing software quality-assurance processes.  
Limitation: quality-assurance process standard, not a style guide.

## S29 — ISO/IEC 25010:2023

URL: https://www.iso.org/standard/78176.html  
Evidence: `E1 — international standard`  
Finding: maintainability/product quality is multi-dimensional rather than one source-code score.  
Limitation: quality model does not prescribe exact construction tactics.

---

# 37. Claim-evidence summary

| Claim | Class | Confidence | Primary evidence |
|---|---|---|---|
| Information hiding supports change/comprehension | `EST/A` | HIGH | S06 + S01 |
| No universal source metric threshold | `EST/A` | HIGH | S04, S05, S15 |
| Types can prevent bounded error classes | `EST/B` | HIGH | S07, S08 |
| Static language is universally superior | `F` | INSUFFICIENT | S07/S08 boundaries + S01 |
| Code smells mandate refactoring | `F/D` | HIGH rejection | S09 |
| Refactoring always improves quality | `F` | HIGH rejection | S10 |
| Text duplication is always harmful | `F` | HIGH rejection | S11–S14 contradiction |
| Design patterns automatically improve quality | `F/E` | HIGH rejection | S26 |
| Comments are universally helpful/harmful | `F` | HIGH rejection | S19 |
| Broad exception syntax is automatically a defect | `F/D` | MODERATE rejection | S16 |
| Code review supports quality/knowledge | `EST/B` | MODERATE-HIGH | S20 |
| Small coherent changes improve reviewability | `DEF/B` | MODERATE | S20, S21 |
| Dependency bloat can create maintenance burden | `CTX/B` | MODERATE-HIGH | S22 |
| AI code inherently less maintainable | `F` | MODERATE-HIGH rejection | S23 |
| AI use can create comprehension/ownership risk | `CTX/B` | MODERATE | S24 |
| Automated coding benchmark pass = mergeable | `F` | MODERATE-HIGH rejection | S25 |

---

# 38. Research sanity-check verdict

## 38.1 Strongly supported

### A. Information hiding and local reasoning

**Confidence: HIGH.**

The exact module system varies; the mechanism survives.

### B. Explicit invariants and contracts

**Confidence: HIGH.**

Implementation layer is contextual.

### C. Risk-proportionate construction assurance

**Confidence: HIGH.**

Inherited from 00 and current lifecycle/quality standards.

### D. Metric thresholds are contextual

**Confidence: HIGH.**

ISO measurement guidance explicitly refuses universal grade ranges; empirical understandability metrics are imperfect.

### E. Duplication requires semantic/context analysis

**Confidence: HIGH.**

Contradictory clone literature directly falsifies universal “duplication bad”.

### F. Smells are diagnostic, not verdicts

**Confidence: HIGH** for rejecting automatic smell→defect/refactor logic.

### G. Refactoring benefits are target/context-dependent

**Confidence: HIGH.**

### H. Patterns/SOLID are not universal quality guarantees

**Confidence: HIGH** for rejecting guarantee; **MODERATE** for individual mechanisms, depending on context.

### I. AI provenance is not maintainability evidence

**Confidence: HIGH** as a decision rule; empirical effect estimates remain task/model dependent.

## 38.2 House synthesis

The following are `HOUSE` structures:

- the exact Golden Construction Standard numbering;
- the construction quality model combination;
- the four duplication categories;
- the abstraction gate;
- the refactoring brief;
- the dependency brief;
- the error-design play;
- the V2 quality gates;
- exact Definition of Done;
- exact folklore matrix.

They are derived from evidence but are not ISO/IEEE requirements.

## 38.3 Remaining uncertainty

1. How to validate change-locality measures without creating another metric proxy.
2. Which developer-comprehension tests are practical enough for normal production teams.
3. How newer autonomous coding agents affect maintainability beyond bounded 2026 studies.
4. When automatically detected code-quality weaknesses from ISO/IEC 5055-aligned tools predict real system outcome in different languages/domains.
5. Which local thresholds, if any, prove useful enough to standardize across repositories.
6. How much type-level sophistication improves vs harms maintenance across modern strongly typed languages.
7. Which AI review practices preserve human/system ownership at high generation throughput.

These should be resolved through field use and new evidence, not invented certainty.

---

# 39. V1 → audit → V2 change record

| V1 area | Audit finding | V2 disposition |
|---|---|---|
| Static typing preference | too universal | type mechanisms retained; language ideology removed |
| Duplication | too close to “remove” | replaced by duplicated-knowledge/change-coupling model |
| Smells | too close to refactor trigger | demoted to diagnostic |
| Refactoring | benefit implied | now requires named quality hypothesis + evidence |
| Function/class size | threshold cargo-cult risk | explicit prohibition on universal line thresholds |
| Complexity | metric overreach risk | metrics = diagnostic, local thresholds only |
| SRP | ambiguous responsibility | semantic cohesion + change locality |
| SOLID | could be inferred as doctrine | explicitly heuristic |
| Composition over inheritance | too strong | contextual trade-off |
| Design patterns | insufficiently falsified | pattern = option/vocabulary |
| Comments | too simplistic | context/information-value model |
| Errors | representation too prescriptive | semantics universal, syntax contextual |
| Dependencies | minimalism risk | justified dependency surface |
| AI maintainability | fast-moving | updated with 2026 neutral/ownership/benchmark evidence |
| Code review | broad default | scaled by risk, semantics first |
| Quality status | draft | V2 = REVIEWED, pending field validation |

---

# 40. Validation requirements before `TESTED` / `VALIDATED`

V2 MUST NOT be promoted solely because the research is strong.

Before `TESTED`:

- execute scenarios A–H with at least two competent non-author engineers;
- apply to at least one TypeScript/JavaScript repository;
- apply to at least one strongly typed non-TypeScript repository;
- apply to at least one dynamic-language repository;
- apply to one AI-generated material change;
- record ambiguities and conflicting decisions;
- regression-check folklore classification.

Before `VALIDATED`:

- demonstrate real repository use;
- collect maintainer/reviewer feedback;
- show that the standard improves or preserves decision quality without excessive ceremony;
- close BLOCKER defects;
- close or explicitly accept MAJOR defects;
- confirm language-specific profiles can strengthen but not contradict the protected principles.

---

# 41. One-page Golden Construction Standard

If only one section can be used:

1. **Start from intended behavior and invariants, not a pattern.**
2. **Use the strongest practical layer—types, constructors, schemas, validation, state machines—to prevent material invalid states.**
3. **Static typing is a mechanism, not proof of correctness or language superiority.**
4. **Decompose around information hiding, semantic cohesion and real change boundaries.**
5. **Make state ownership, mutation authority and dependency direction explicit.**
6. **An interface must earn its indirection by hiding volatility, policy, authority or meaningful substitution.**
7. **Contracts include failure and side effects, not just inputs/outputs.**
8. **Preserve error cause/context; choose exception/result/error syntax by language and caller recovery semantics.**
9. **Abstract stable shared knowledge; tolerate explicit duplication while semantic sameness is uncertain.**
10. **DRY means one canonical representation of knowledge that must stay synchronized—not zero repeated syntax.**
11. **Optimize readability for accurate maintainer comprehension, not aesthetic style.**
12. **Use descriptive domain names; comment durable rationale/constraints that code cannot express safely.**
13. **No universal function/class/complexity threshold proves quality. Metrics trigger investigation.**
14. **Code smells are questions, not defects.**
15. **Refactor against a named quality problem and verify the expected improvement.**
16. **Design patterns, SOLID, KISS, YAGNI and composition-over-inheritance are heuristics/options, not laws.**
17. **Choose dependencies by lifetime value and risk, not package count or NIH ideology.**
18. **Prefer the smallest coherent, safely integrable change—not the smallest LOC diff.**
19. **Automate formatting/mechanical checks; reserve human review for semantics, risk, design and understanding.**
20. **Maintainability is demonstrated by real change/comprehension outcomes, not “clean code” scores.**
21. **AI-generated code is untrusted until independently validated; AI provenance alone predicts neither good nor bad maintainability.**
22. **Protect code ownership: accountable humans/systems must understand material invariants and failure modes.**
23. **Benchmark/test success is evidence, not automatic mergeability or production readiness.**
24. **When evidence is contextual, encode the boundary condition instead of inventing a universal rule.**

---

# 42. Mechanical release audit

The V2 artifact was mechanically checked after synthesis:

```text
required specialist topics present: yes
code fences balanced: yes
unresolved drafting markers: 0
V2 status: REVIEWED
external evidence cutoff: 2026-09-27
source IDs referenced without a definition: 0
```

The mechanical audit does **not** convert `REVIEWED` into `TESTED` or `VALIDATED`; it only verifies artifact integrity.

---

# 43. Change log

```yaml
version: 2.0-RC1
date: 2026-09-27
status: REVIEWED
supersedes: 1.0-RC1
major_changes:
  - replaced style-shape doctrine with mechanism/outcome doctrine
  - falsified universal DRY/duplication assumptions
  - demoted code smells to diagnostic signals
  - made refactoring outcome/evidence driven
  - prohibited universal source-metric thresholds
  - replaced SRP literalism with semantic cohesion/change locality
  - explicitly demoted SOLID/design patterns/composition-over-inheritance to contextual heuristics/options
  - made error semantics universal but representation language-contextual
  - strengthened dependency lifetime decision logic
  - added 2026 AI maintainability/comprehension/benchmark evidence
  - added construction/refactor/dependency/error Plays
  - added validation scenarios and status discipline
next_gate: non_author_scenario_testing
```
