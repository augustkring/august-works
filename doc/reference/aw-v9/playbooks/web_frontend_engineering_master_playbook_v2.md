# 14 — Web & Frontend Engineering — V2.0

> **Evidence-weighted evergreen standard for browser/web-platform engineering, frontend architecture, rendering, accessibility, performance, state, security, components, interoperability, testing and evolution**

```yaml
document_id: SWE-14-WEB-FRONTEND
title: 14 — Web & Frontend Engineering
version: 2.0
status: REVIEWED
release_label: Research-Reviewed Golden Master Candidate
artifact_type: specialist capability playbook
primary_archetype: Operating + Capability + Execution + Decision
inherits:
  - Master Playbook Standard v2.0-RC1
  - Universal Software & AI Engineering Master Playbook v2.0
evidence_cutoff: 2026-09-27
canonical_language: English
rigor_level: R3 / CONTROLLED for production guidance
volatility:
  durable_principles: MODERATE
  browser_platform_status: FAST
  security_platform_status: FAST
  framework_tooling: FAST
owner_role: Engineering Standards Owner
owner_assignment: REQUIRED_BEFORE_VALIDATED
review_cadence: quarterly + event-driven
validation_state:
  research_review: complete
  v1_falsification_audit: complete
  mechanical_audit: complete
  non_author_field_execution: pending
  independent_high_risk_review: pending where applicable
```

## Status note

This V2 is the research-reviewed successor to the V1 research draft.

It is deliberately marked **`REVIEWED` rather than `VALIDATED`**. The parent Master Playbook Standard requires representative non-author execution/field testing before promotion to `VALIDATED`. V2 is intended to be the canonical research-reviewed engineering standard, but its operational validation debt remains visible.

---

# Executive standard

A frontend is not “the React/Vue/Svelte part” of a product. It is a software system executed inside a browser user agent whose platform already provides semantics, navigation, history, forms, layout, accessibility mappings, security boundaries, caching, storage, lifecycle behavior and network protocols.

The durable engineering chain is:

```text
INTENT / USERS / CONSTRAINTS
→ BROWSER + SERVER SYSTEM BOUNDARY
→ SEMANTICS / STATE / AUTHORITY
→ RENDERING + DATA FLOW
→ ACCESSIBILITY + SECURITY + PERFORMANCE
→ COMPONENT / MODULE BOUNDARIES
→ FAILURE + RECOVERY
→ RISK-DRIVEN VERIFICATION
→ CONTROLLED RELEASE
→ FIELD OBSERVATION
→ EVOLUTION / DEPRECATION
```

The V2 doctrine is:

> **Use the web platform as the lowest adequate layer; keep authority and state ownership explicit; add client complexity only when it buys a material product capability; choose rendering and state mechanisms from requirements rather than framework identity; engineer accessibility, security and performance into architecture; verify browser behavior in real browsers; and preserve uncertainty where evidence is contextual or fast-moving.**

The strongest conclusions from the research/audit are:

1. **HTML/platform semantics are architecture.** WHATWG explicitly encourages declarative alternatives where possible and graceful degradation in the absence of scripting [WEB01][WEB02].
2. **Frameworks are implementation choices, not the standard.** No evidence reviewed establishes one universal framework, state library, rendering model, styling system or test pyramid.
3. **The browser client is not an authorization authority.** UI state can express availability; trusted server/policy boundaries decide permission [ENG00][SEC01].
4. **State must be classified before it is stored.** Server-authoritative, URL, form, local UI, shared client, persistent client and derived state have different lifecycle and consistency semantics.
5. **Rendering is a constraint decision.** Static, SSR, streaming, CSR and hybrid/partial hydration each create different latency, cacheability, compute, activation and operational trade-offs [PERF02].
6. **Hydration can be both a performance and correctness risk.** HTML can appear ready before interaction handlers exist; server/client divergence can also create incorrect state [PERF02].
7. **Accessibility cannot be proven by automation alone.** W3C states that tools cannot automatically check all aspects and cannot determine accessibility; knowledgeable human evaluation is required [ACC04].
8. **Native HTML generally carries more built-in semantics/interaction behavior than ARIA reconstruction.** APG's core warning remains “No ARIA is better than Bad ARIA” [ACC03].
9. **Core Web Vitals are valuable field guardrails, not a complete performance model.** Current thresholds are LCP ≤2.5s, INP ≤200ms and CLS ≤0.1 at the 75th percentile [PERF01].
10. **Lab and field evidence answer different questions.** Controlled reproduction does not represent the variability of real devices, networks and user behavior [PERF04].
11. **Browser lifecycle matters.** `unload` is unreliable and can harm bfcache eligibility; correctness must not depend on it [PERF03].
12. **CORS is not authorization.** It is a browser response-sharing mechanism; server resource authorization remains separate [WEB03].
13. **Browser storage is not a credential vault.** OWASP warns against storing session IDs/JWTs/refresh tokens in local/session storage because origin JavaScript can read them [SEC02].
14. **Cookie-based session state changes still need an explicit CSRF design.** SameSite is defense in depth, not automatic complete protection [SEC03].
15. **CSP, Trusted Types, Permissions Policy, Service Workers and Web App Manifest require status-aware use.** Several current specifications remain Working Draft or Candidate Recommendation Draft as of the cutoff [SEC05][SEC06][SEC07][PWA01][PWA02].
16. **Compatibility is a product policy.** Web Platform Baseline is an interoperability signal; it does not know the product's actual users [COMPAT01].
17. **Micro-frontends are contextual.** Research ties their usefulness and cost to project/team complexity; they are not a frontend maturity ladder [ARCH01].
18. **Testing follows failure modes.** DOM/unit tests, real-browser integration, E2E, accessibility, visual, performance and security tests provide different evidence.
19. **Internationalization is correctness.** Locale-sensitive formatting and text direction have platform semantics; translation-only thinking is incomplete [I18N01][I18N02].
20. **AI changes candidate-generation speed, not assurance obligations.** Generated HTML, ARIA, CSS, state logic, tests and security claims remain untrusted until independently verified [ENG00].

---

# 1. Purpose

This specialist playbook exists to make web/front-end systems:

- correct enough for their risk profile;
- browser-native where that lowers complexity;
- accessible to intended users;
- performant under relevant real-world conditions;
- explicit about state, authority and data ownership;
- secure at browser/server trust boundaries;
- testable across the failure modes that matter;
- compatible with an explicit support policy;
- observable without unnecessary privacy leakage;
- maintainable as browser APIs, frameworks and product requirements evolve.

It expands the frontend/web responsibilities deliberately delegated by the Universal Software & AI Engineering Master Playbook [ENG00].

It does not prescribe one:

- framework;
- metaframework;
- state library;
- CSS architecture;
- component library;
- rendering model;
- browser automation tool;
- build tool;
- deployment platform.

---

# 2. How to use this playbook

Use four layers.

## Layer 1 — Orientation

Use:

- Executive standard;
- Web system model;
- Golden Frontend Standards;
- One-page Golden Standard.

## Layer 2 — Decision

Use:

- state classification;
- rendering decision framework;
- component decision framework;
- cache/storage decision rules;
- progressive-enhancement decision;
- service-worker/PWA decision;
- micro-frontend decision;
- testing evidence matrix.

## Layer 3 — Execution

Use:

- component contract;
- route transition contract;
- data-fetch contract;
- optimistic mutation contract;
- performance budget;
- accessibility verification plan;
- frontend production-readiness checklist.

## Layer 4 — Assurance and learning

Use:

- evidence/source register;
- V1 audit incorporation;
- browser/support freshness triggers;
- defect/exception governance;
- RUM/field validation;
- non-author field test.

---

# 3. Inheritance and specialist boundaries

This playbook inherits without weakening the parent standards:

- requirements and acceptance criteria;
- criticality/risk-proportionate assurance;
- architecture trade-off discipline;
- secure-by-design lifecycle;
- privacy/data minimization;
- reliability/resilience;
- performance/resource engineering;
- API/distributed-systems semantics;
- CI/CD/supply-chain integrity;
- maintenance/migration/retirement;
- AI-assisted engineering controls.

Frontend-specific rule:

> **This playbook owns the browser translation of cross-cutting controls; it SHOULD link to deeper specialist standards rather than duplicate their full truth.**

Examples:

- HTTP retry safety belongs to distributed/API semantics; this standard says how UI state represents it.
- authorization belongs to trusted policy/backend boundaries; this standard says the client cannot become authority.
- privacy retention belongs to privacy engineering; this standard controls browser storage/telemetry surfaces.
- supply-chain assurance belongs to release/supply-chain engineering; this standard treats third-party scripts/packages as frontend dependencies.

---

# 4. Evidence model

This playbook inherits the parent claim taxonomy and assurance discipline [BASE00]:

| Label | Meaning |
|---|---|
| `REQ` | external requirement applicable in the stated context |
| `EST` | well-established practice |
| `DEF` | recommended default |
| `CTX` | context-dependent practice |
| `EMG` | emerging practice / incomplete evidence |
| `HOUSE` | deliberate internal standard |
| `EXP` | experiment |
| `UNK` | unresolved material question |

Normative words:

- **MUST / MUST NOT** — house requirement;
- **SHOULD / SHOULD NOT** — strong default;
- **MAY** — optional;
- **JUDGMENT REQUIRED** — context determines the answer.

## 4.1 Source-fit rule

Use sources for the claims they can establish:

```text
browser semantics / platform behavior → WHATWG / W3C / IETF / Ecma
accessibility conformance             → W3C WCAG / WAI-ARIA
security verification                 → specialist standard + OWASP / platform specs
browser compatibility status          → interoperable implementation evidence / Baseline
performance field metrics             → field measurement + current metric definitions
architecture causal superiority       → empirical evidence + local system evidence
framework behavior                    → current official framework documentation
```

A browser vendor's successful architecture does not become a universal frontend law.

## 4.2 Fast-changing facts

Re-verify before relying on:

- browser support;
- Baseline status;
- draft W3C specs;
- security browser features;
- Core Web Vitals definitions;
- framework rendering semantics;
- bundler behavior;
- browser lifecycle changes;
- service-worker/install behavior.

---

# 5. Web/frontend system model

```text
HUMAN USER
  ↕
ASSISTIVE TECHNOLOGY / INPUT DEVICES
  ↕
BROWSER USER AGENT
  ├── HTML semantics + accessibility tree
  ├── CSS cascade/layout/paint/compositing
  ├── DOM + events + JS execution
  ├── navigation + history + URL
  ├── Fetch + HTTP cache + CORS
  ├── cookies + storage + IndexedDB
  ├── origin/sandbox/security policy
  ├── workers/service workers
  ├── media/images/fonts
  └── performance/lifecycle APIs
  ↕
NETWORK / CDN / EDGE
  ↕
ORIGIN / BFF / API / SERVICES
  ↕
AUTHORITATIVE DATA + POLICY
```

## 5.1 Consequences of the model

1. The DOM is not the entire frontend.
2. A framework virtual tree is not the browser contract.
3. UI state is not authoritative server state unless the architecture explicitly makes it so.
4. navigation/history/focus/accessibility are behavior, not polish.
5. HTTP caching and browser caching are architecture.
6. client code is observable/tamperable by the client.
7. browser/device/AT diversity is part of the environment.
8. page lifecycle can outlive or restore state in ways a naive mount/unmount model does not capture.

---

# 6. Frontend quality model

For every material frontend, ask:

1. **Intent/value** — can intended users accomplish the intended task?
2. **Functional correctness** — do UI and mutations preserve product invariants?
3. **Semantic correctness** — does markup communicate the right structure/control semantics?
4. **Accessibility** — can intended users operate/understand it with relevant AT/input modes?
5. **Security** — can the client be manipulated to gain capability or inject executable content?
6. **Privacy** — does browser storage, URL or telemetry expose unnecessary sensitive data?
7. **State integrity** — can stale, duplicated, out-of-order or conflicting state create wrong behavior?
8. **Navigation integrity** — do URL, deep links, back/forward, title, focus and scroll behave coherently?
9. **Performance** — is loading and interaction responsive on relevant devices/networks?
10. **Resilience** — what happens under slow/offline/partial failure?
11. **Compatibility** — does behavior meet the explicit browser/device support policy?
12. **Maintainability** — can semantics/state/components be changed without disproportionate blast radius?
13. **Observability** — can failures/performance regressions be detected and diagnosed?
14. **Delivery safety** — can frontend changes/assets/cache/service workers be released and recovered safely?
15. **Internationalization** — can locale/language/direction/time/number/text requirements be handled correctly?
16. **Resource/economic efficiency** — do JS, media, third-party, origin and telemetry costs justify their user value?
17. **Supply-chain integrity** — are client packages/scripts/build inputs controlled?

Do not collapse these into one frontend “quality score.”

---

# 7. Criticality and assurance

Inherit the engineering master criticality model.

Frontend assurance increases when the UI controls or materially influences:

- financial transactions;
- privileged/administrative actions;
- health/safety decisions;
- authentication/recovery;
- personal/sensitive data;
- irreversible deletion;
- high-value commerce;
- public-sector access;
- high-volume public journeys;
- agentic/AI actions;
- regulated disclosures.

## 7.1 Assurance examples

### Ordinary content/marketing page
Likely emphasis:

- semantic HTML;
- accessibility;
- performance;
- browser compatibility;
- content/security hygiene.

### Authenticated business application
Adds:

- authorization-boundary verification;
- state consistency;
- route/error recovery;
- session architecture;
- long-lived performance/memory;
- real-browser E2E.

### High-impact transactional interface
Adds:

- independent security review;
- stronger auditability;
- error prevention/reversal;
- concurrency/idempotency checks;
- accessible authentication;
- stronger cross-browser/AT validation;
- controlled rollout and recovery.

---

# 8. Golden Frontend Standards

## Intent and platform

1. **Start from user journeys, constraints and unacceptable failure—not from a preferred framework.**
2. **Treat the browser user agent as part of system architecture.**
3. **Use semantic HTML for semantics and behavior the platform already represents.**
4. **Prefer declarative platform capabilities over custom JavaScript when they satisfy the requirement [WEB01].**
5. **Progressively enhance where a useful lower-capability path materially improves resilience, accessibility, reach or simplicity.**
6. **Do not force a no-JavaScript duplicate for experiences whose essential requirement is inherently client-computational; document the capability dependency instead.**
7. **Feature/framework choice MUST remain subordinate to support policy and product requirements.**

## Authority and state

8. **The browser client MUST NOT be the final authority for authorization, tenant isolation, financial integrity or business invariants.**
9. **Every material fact SHOULD have one authoritative owner.**
10. **Classify state before choosing where/how to store it.**
11. **Treat client copies of server-authoritative data as replicas/caches with freshness and conflict semantics.**
12. **Keep local UI state local unless a real cross-boundary coherence requirement exists.**
13. **Do not add a global state store merely because the application is large.**
14. **Keep derivable state derived unless caching its computation has measurable value and correct invalidation.**
15. **Use URL/history for shareable/bookmarkable navigation state when appropriate, but MUST NOT place secrets or unnecessarily sensitive data in URLs.**
16. **Persistent client state MUST have ownership, versioning/migration and deletion semantics when format/lifecycle can change.**

## Async and mutation

17. **Overlapping async work MUST define stale-result/supersession behavior when response order can differ from intent order.**
18. **UI cancellation MUST NOT be mistaken for guaranteed cancellation of already-started server side effects.**
19. **Optimistic mutations MUST define authoritative response, idempotency/duplication, conflict, rollback and reconciliation behavior.**
20. **Disable duplicate submissions or make their business effect idempotent where duplicate action is material.**
21. **Do not retry state-changing requests automatically without safe/idempotent semantics [HTTP01].**

## Components

22. **A component is a semantic/behavioral contract, not a file boundary.**
23. **Prefer native controls before recreating native interaction with ARIA [ACC03].**
24. **Custom widgets MUST implement the expected semantic, keyboard, focus and state behavior for the role they claim.**
25. **Polymorphic component APIs MUST preserve valid semantics for the rendered element.**
26. **Reusable primitives SHOULD receive stronger assurance because a primitive defect propagates across consumers.**
27. **Do not maximize component reuse; reuse stable shared semantics/policy.**
28. **Design-system consistency MUST NOT override accessibility or platform behavior.**

## Rendering

29. **Rendering architecture is a requirements decision, not a team identity.**
30. **Static, SSR, streaming, CSR and hybrid/partial activation are implementation options; none is universally best.**
31. **Evaluate both HTML-delivery cost and client activation cost.**
32. **Hydration/activation that makes controls appear usable before handlers are ready is an interaction defect.**
33. **Hydrated interfaces MUST test server/client initial-state consistency.**
34. **Do not equate SEO/discoverability with SSR; define crawler/metadata/indexing requirements separately.**
35. **Avoid avoidable data/resource waterfalls on critical paths.**
36. **Do not ship client code for behavior that can stay server-only or platform-native without losing required interaction.**

## Navigation

37. **Direct URL entry, refresh and back/forward are part of navigation correctness.**
38. **Distinct SPA views SHOULD update the document title to represent the current view [ACC05].**
39. **Client navigation MUST have an intentional focus/orientation strategy for keyboard/AT users [ACC06].**
40. **Scroll restoration and history state SHOULD follow user expectations rather than framework defaults blindly.**
41. **Navigation error/not-found/authorization paths MUST be defined.**

## Accessibility

42. **Accessibility is an architecture and component requirement, not a final audit phase.**
43. **WCAG conformance and usable task completion are different evidence questions.**
44. **Automated accessibility tools MUST NOT be treated as proof of accessibility [ACC04].**
45. **Material interactive journeys SHOULD receive non-author keyboard and assistive-technology evaluation proportionate to risk/audience.**
46. **Keyboard focus MUST remain visible and predictable for interactive operation [ACC03].**
47. **Information and state MUST NOT rely on color alone.**
48. **Zoom/reflow/text expansion MUST be considered in responsive layout.**
49. **Motion/animation SHOULD respect user preference and avoid unnecessary barriers.**
50. **Authentication UX SHOULD preserve accessible mechanisms such as password-manager/paste support unless a stronger scoped requirement justifies restriction.**
51. **Loading/status/error feedback SHOULD be perceivable without creating noisy announcements.**

## Performance

52. **Define frontend performance by user journeys, population and distributions—not one benchmark score.**
53. **Use Core Web Vitals as applicable field guardrails, not as the complete performance model [PERF01].**
54. **Use both lab and field evidence when material [PERF04].**
55. **Measure before optimizing unless a hard architectural constraint is already known.**
56. **Budget main-thread work and JavaScript activation on interaction-critical paths.**
57. **Do not impose a universal bundle-size threshold; create route/journey budgets from measured device/network requirements.**
58. **Prioritize critical resources intentionally; not every asset should preload/prefetch.**
59. **LCP-critical images SHOULD NOT be indiscriminately lazy-loaded.**
60. **Reserve image/media dimensions or equivalent layout space to reduce avoidable layout shift.**
61. **Third-party scripts MUST have an explicit value, owner and performance/privacy/security budget.**
62. **Long-lived applications SHOULD test memory/resource growth where session duration makes leaks material.**
63. **Do not rely on `unload` for correctness; preserve bfcache-friendly lifecycle behavior where practical [PERF03].**
64. **A Lighthouse/aggregate synthetic score MUST NOT be treated as release proof.**

## Network/cache

65. **Use HTTP semantics before inventing redundant application-level equivalents [HTTP01][HTTP02].**
66. **Every cache MUST define source of truth, key, freshness, invalidation and failure behavior.**
67. **Shared/authenticated caches MUST preserve user/tenant privacy and variation semantics.**
68. **Client data layers SHOULD define cancellation, deduplication, freshness, revalidation and error classification.**
69. **Speculative fetch/prerender MUST respect safe request semantics, privacy, server cost and user-network cost.**
70. **CORS MUST NOT be treated as authorization [WEB03].**

## Security/privacy

71. **Any value delivered/embedded in client assets MUST be considered observable to the recipient; never compile secrets into client bundles.**
72. **Untrusted text SHOULD use safe text/DOM sinks rather than HTML interpretation [SEC04].**
73. **Untrusted rich HTML MUST use an intentional, maintained, context-appropriate sanitization/trust pipeline.**
74. **Server data embedded into HTML/script contexts MUST be serialized/escaped for that exact context.**
75. **Cookie-authenticated state-changing requests MUST have an explicit CSRF strategy; SameSite is defense in depth [SEC03].**
76. **Session/token architecture MUST be threat-modeled; browser local/session storage MUST NOT be treated as a credential vault [SEC02].**
77. **Cross-window/frame `postMessage` receivers MUST validate expected origin/source and message schema/action.**
78. **CSP SHOULD be used as defense in depth where applicable; CSP Level 3 draft status MUST remain visible [SEC05].**
79. **Trusted Types is an emerging/contextual DOM-XSS hardening mechanism, not a universal final-standard requirement [SEC06].**
80. **Permissions Policy MAY restrict browser capabilities where useful; current draft status MUST remain visible [SEC07].**
81. **UI hiding/disabling is not authorization enforcement.**
82. **Client logs, analytics and RUM MUST NOT capture secrets or unnecessary sensitive form/DOM/query data.**

## Compatibility/platform evolution

83. **“Modern browsers” is not a testable support policy.**
84. **Web Platform Baseline MAY inform feature risk, but product support MUST reflect actual users/requirements [COMPAT01].**
85. **Prefer capability detection/progressive enhancement over browser sniffing; documented UA-specific exceptions MAY exist for real browser defects.**
86. **Critical browser semantics require real-browser evidence; DOM emulators are not a browser substitute.**
87. **Support policy MUST include relevant embedded webviews/AT/device constraints when they materially differ.**
88. **Draft specifications MUST NOT be represented as final Recommendations merely because some browsers implement them.**

## Offline/PWA

89. **Service workers are contextual infrastructure, not a web-app default [PWA01].**
90. **Offline behavior MUST define freshness, mutation conflicts, credentials, cache lifecycle and recovery.**
91. **Logout/account/tenant switches MUST define what cached/persisted data is retained or cleared.**
92. **Service-worker activation/update/recovery MUST be observable and release-controlled if the product depends on it.**
93. **Web App Manifest/installability is an optional product capability; the current spec remains a Working Draft [PWA02].**

## i18n/RTL

94. **Internationalization is correctness, not translation polish.**
95. **Use locale-aware APIs for number/date/time/currency/list/plural/collation behavior where applicable [I18N01].**
96. **Set semantic language and base text direction in markup; use `dir` rather than CSS-only direction [I18N02].**
97. **Use logical layout properties where directional mirroring is expected.**
98. **Test text expansion, locale formats, time zones and RTL/bidirectional content when supported locales require them.**

## Testing/operations/evolution

99. **Select test methods from failure modes, not a fixed frontend test pyramid.**
100. **Component tests SHOULD assert user-observable semantics and behavior over private framework implementation.**
101. **Snapshot/visual tests are drift evidence, not complete behavioral/accessibility proof.**
102. **Critical paths SHOULD be tested in the browser engines promised by support policy.**
103. **Frontend telemetry SHOULD connect failure/performance to route/version/journey while minimizing sensitive data.**
104. **Loading, partial, empty, stale, validation, offline and error states are part of feature completeness where applicable.**
105. **A successful build/typecheck/lint does not prove browser runtime correctness.**
106. **Dependencies and third-party scripts inherit parent supply-chain controls.**
107. **Framework/platform migrations MUST preserve semantics, accessibility, URLs/state and observable behavior—not merely compile.**
108. **AI-generated frontend output remains untrusted until independently verified [ENG00].**
109. **Do not merge generated abstractions that accountable owners cannot explain or safely modify.**
110. **When a platform capability makes framework code unnecessary and support permits, evaluate deleting the abstraction.**

---

# 9. Frontend requirements brief

Before architecture/tool selection, capture:

```yaml
product_surface:
primary_users:
critical_journeys:
criticality:

browser_support:
  engines:
  versions_or_baseline_policy:
  mobile:
  embedded_webviews:
  assistive_technology:
  low_end_device_or_network_constraints:

content_and_navigation:
  public_or_authenticated:
  discoverability_indexing:
  direct_links:
  back_forward_expectations:
  offline_expectations:

interaction:
  density:
  realtime:
  long_lived_session:
  local_compute:
  media_graphics:

data:
  authoritative_sources:
  personal_sensitive_data:
  mutation_consequence:
  consistency_conflicts:
  persistence:

quality:
  accessibility_target:
  performance_population:
  reliability:
  security_threats:
  privacy:
  i18n_locales:
  rtl:

delivery:
  release_model:
  rollback_or_rollforward:
  service_worker_if_any:
  third_party_scripts:

known_constraints:
known_unknowns:
```

Do not choose rendering/state architecture before enough of this is known to justify it.

---

# 10. HTML, semantics and platform-first engineering

## 10.1 Declarative before imperative

`DEF / HIGH`

WHATWG encourages authors to use declarative alternatives to scripting where possible and to degrade gracefully when scripting is unavailable [WEB01].

Examples of platform-first questions:

- Is this navigation actually a link?
- Is this action actually a button?
- Is this disclosure adequately represented by `details`?
- Can native form submission provide a resilient baseline?
- Can CSS handle the state/layout without JS measurement?
- Can the browser URL/history own navigation state?
- Can built-in validation semantics contribute to UX while server validation remains authoritative?

Platform-first does **not** mean “never use JavaScript.” It means custom code should buy a requirement.

## 10.2 Semantic structure

Documents/views SHOULD have:

- meaningful title;
- language;
- logical heading hierarchy;
- landmarks/sections as appropriate;
- links that navigate;
- buttons that invoke actions;
- labeled form controls;
- table semantics for tabular data.

Avoid generic containers plus ARIA when a native element directly matches the semantics.

## 10.3 Progressive enhancement decision

Use progressive enhancement strongly when:

- the server can complete the core transaction;
- navigation/content should remain robust under script failure;
- public reach/discoverability matters;
- low-capability environments matter;
- the native path is simpler and safer.

A fully no-JS path is not required when:

- the essential product is a local graphical/editor/real-time tool;
- duplicating the experience would materially increase complexity;
- requirements explicitly depend on client APIs.

Even then, semantic/accessibility/security requirements remain.

---

# 11. CSS, layout and presentation

## 11.1 CSS architecture objective

> **Make the cascade, scope, theming and responsive behavior understandable with the least necessary runtime/build complexity.**

Valid implementation options include:

- plain CSS;
- modules/scoped CSS;
- utility systems;
- CSS-in-JS;
- generated styles;
- cascade layers.

No one mechanism is the universal standard.

## 11.2 Cascade discipline

Control:

- origin/layer order;
- specificity;
- source order;
- component/theme overrides;
- third-party CSS;
- `!important` usage.

Cascade layers provide an explicit precedence mechanism and MAY be useful for reset/library/theme/component concerns [CSS01].

## 11.3 Responsive design

Design for available space/content rather than device labels alone.

Do not infer:

```text
small viewport = touch only
large viewport = mouse/keyboard only
```

Consider:

- viewport;
- component container;
- content length;
- zoom;
- user font settings;
- orientation;
- input capabilities;
- safe areas;
- virtual keyboard;
- reduced motion/contrast preferences where relevant.

## 11.4 Layout stability

Reserve predictable space for:

- images/media;
- embeds;
- ads/third party content;
- async regions,

when dimensions can be known or bounded.

Avoid moving controls/content unexpectedly during interaction.

## 11.5 Motion

Animation SHOULD:

- communicate state/change;
- avoid unnecessary main-thread work;
- respect user motion preferences where applicable;
- not be required to understand essential content;
- avoid trapping focus or creating inconsistent interaction timing.

---

# 12. JavaScript execution and browser lifecycle

## 12.1 Main-thread budget

On ordinary browser pages, JavaScript, style/layout and many events compete for main-thread time.

Treat as material costs:

- parse/compile;
- execution;
- framework activation/hydration;
- event handlers;
- layout/style recalculation;
- DOM mutation;
- serialization;
- garbage collection;
- third-party work.

The goal is not “zero JavaScript.” It is **the least client execution necessary for the intended interaction**.

## 12.2 Scheduling and interaction

For interaction-critical handlers:

- do the minimum synchronous work necessary;
- break up long work where possible;
- move suitable CPU-heavy work to workers if transfer/coordination cost is justified;
- avoid forced sync layout/read-write loops;
- avoid background work that competes with visible interaction.

Current INP guidance specifically identifies script evaluation/long tasks as sources of interaction delay [PERF05].

## 12.3 Page lifecycle

Do not assume a simple lifecycle:

```text
load → use → unload
```

Browsers can:

- freeze/suspend;
- restore from bfcache;
- terminate mobile tabs without reliable unload;
- background pages;
- navigate away and restore DOM/JS state.

`MUST NOT`: depend on `unload` for saving essential state or correctness [PERF03].

Use lifecycle-appropriate signals/persistence and server durability for material data.

---

# 13. Frontend architecture and module boundaries

## 13.1 Default posture

Prefer the least distributed and least abstract architecture that meets:

- deployment;
- team ownership;
- performance;
- failure isolation;
- security;
- migration;
- reuse;
- product evolution

requirements.

## 13.2 Boundary test

A boundary is stronger when it hides a decision likely to change:

- API transport;
- persistence/storage;
- analytics vendor;
- auth integration;
- domain calculation;
- feature flag provider;
- rich-text engine;
- date/i18n implementation;
- browser capability adapter.

Avoid “layers” that only proxy the next layer.

## 13.3 Feature/domain organization

A feature/domain module SHOULD make clear:

```yaml
owned_routes:
owned_components:
owned_state:
server_contracts:
side_effects:
permissions:
telemetry:
tests:
public_exports:
```

Global “utils/components/hooks/services” directories are not automatically wrong, but SHOULD NOT become dumping grounds that erase ownership.

## 13.4 Micro-frontends

Classification: `CTX / MODERATE`.

Use only when material benefits exist, such as:

- independent team ownership;
- independent release/deployment;
- staged legacy migration;
- isolation of product/business domains.

Costs can include:

- duplicate frameworks/runtime;
- larger payload;
- inconsistent UX/accessibility;
- cross-app routing/state complexity;
- dependency/version skew;
- monitoring/debugging complexity.

Research indicates adoption fit depends strongly on project/team size and complexity [ARCH01].

Default for a normal single-team product: one frontend deployment with strong internal modularity unless a distributed boundary earns its cost.

---

# 14. Component and design-system engineering

## 14.1 Atomic component contract

For a reusable interactive component, define applicable fields:

```yaml
purpose:
native_equivalent_evaluated:
semantic_role:
accessible_name_source:
content_model:
props_inputs:
controlled_state:
uncontrolled_state:
events:
keyboard_behavior:
focus_entry:
focus_exit:
selection_behavior:
loading:
empty:
error:
disabled:
validation:
responsive:
rtl:
theming:
security_content_rules:
performance_constraints:
test_contract:
```

Do not render unused complexity for trivial components.

## 14.2 Native vs custom decision

Use native control when:

- semantics match;
- native keyboard behavior is adequate;
- styling constraints are acceptable;
- platform behavior improves compatibility/accessibility.

Build custom widget when:

- interaction model materially differs;
- domain requirement cannot be expressed with native control;
- the team can own keyboard/focus/AT behavior.

## 14.3 Design-system assurance multiplier

A primitive used in 100 screens has higher blast radius than a local component.

High-reuse primitives SHOULD have:

- semantic/keyboard tests;
- accessibility review;
- cross-browser tests;
- visual/responsive tests;
- version/migration discipline;
- documented breaking changes;
- representative use-case validation.

## 14.4 Polymorphism

APIs like `as`, slotting or render-prop substitution MUST NOT let callers silently create invalid semantics.

Example risk:

```text
Button component + rendered <a> without href
Link component + rendered <button> but navigation semantics expected
```

The semantic element/behavior is part of the API.

---

# 15. State, data and synchronization

## 15.1 Canonical state taxonomy

| Class | Typical authority | Lifetime | Examples |
|---|---|---|---|
| server-authoritative | backend/policy/data store | cross-session | account, permission, order |
| URL/navigation | URL/history | navigation | route, filter, pagination |
| form/draft | user interaction/feature | edit session | unsaved fields |
| ephemeral UI | component | short | open menu, hover, modal |
| shared client | bounded frontend domain | session | editor graph, coordinated selection |
| persistent client | browser store | sessions | preference, offline draft |
| derived | source state | computed | filtered/sorted/calculated view |

A library does not change these semantics.

## 15.2 One authoritative fact

Avoid:

```text
server value
+ query cache value
+ global store value
+ component copy
+ localStorage copy
```

all independently writable.

If multiple representations exist, define:

- authority;
- propagation;
- freshness;
- conflict;
- invalidation;
- failure.

## 15.3 Server-state cache contract

```yaml
source_of_truth:
cache_key:
authorization_scope:
freshness:
stale_tolerance:
revalidation:
deduplication:
revision_or_etag_if_needed:
mutation_invalidation:
out_of_order_response_policy:
offline_behavior:
error_classification:
```

## 15.4 Async stale-result control

For an input/search flow:

```text
A: "ca" request starts
B: "cat" request starts
B returns -> intended current result
A returns later -> MUST NOT overwrite B
```

Candidate controls:

- cancel A;
- sequence ID;
- request key;
- latest-intent guard;
- library cache identity.

## 15.5 Optimistic mutation contract

```yaml
operation:
authoritative_server_result:
optimistic_projection:
mutation_id_or_idempotency:
duplicate_behavior:
concurrent_conflict:
server_rejection:
rollback:
reconciliation:
retry_owner:
user_pending_signal:
offline_policy:
```

The optimistic UI is a prediction, not authority.

## 15.6 Persistent client state

If persistent browser state can survive releases:

- version format;
- migration path;
- corrupt-state fallback;
- logout/account/tenant behavior;
- retention/deletion;
- sensitivity classification;
- size/quota failure;
- multi-tab concurrency where relevant.

---

# 16. Forms and validation

HTML forms can perform submission without client scripting in many cases [WEB02].

## 16.1 Validation layers

```text
CLIENT UX VALIDATION
→ improves feedback

TRUSTED BOUNDARY VALIDATION
→ enforces schema/business constraints

AUTHORIZATION
→ decides allowed action/resource

DATA CONSTRAINTS
→ preserve invariants
```

Never replace later layers with the first.

## 16.2 Form quality

Material forms SHOULD define:

- labels/instructions;
- required/optional semantics;
- input type/autocomplete;
- errors tied to fields and summary where useful;
- focus after failed submit where helpful;
- server error mapping;
- duplicate submit behavior;
- pending state;
- preserved user input after recoverable failure;
- accessible authentication constraints;
- locale-aware parsing/formatting;
- destructive/financial confirmation where consequence requires.

## 16.3 Native submission vs enhanced submission

Enhanced client submission MAY:

- preserve scroll/context;
- provide optimistic feedback;
- update partial UI.

But direct/full submission MAY remain the resilient fallback when practical.

---

# 17. Routing, navigation, URL and history

## 17.1 Route transition contract

For each meaningful view transition:

```yaml
url:
history_entry:
document_title:
primary_heading_or_orientation_target:
focus_behavior:
scroll_behavior:
loading_behavior:
error_behavior:
not_found:
authorization_redirect:
back_forward_restore:
analytics_route_identity:
```

## 17.2 SPA title

WCAG guidance notes that dynamically changing distinct SPA views should also update the page title to reflect the current view [ACC05].

## 17.3 SPA focus

WAI examples demonstrate moving focus to newly loaded primary content for SPA-like navigation where no full page load occurs [ACC06].

The exact focus target is contextual. The invariant is that keyboard/AT users should be able to understand that navigation completed and where they are.

## 17.4 URL safety

Do not put in URLs unless explicitly acceptable:

- access tokens;
- session secrets;
- unnecessary personal data;
- sensitive form contents;
- secret internal identifiers whose exposure itself is harmful.

URLs can appear in:

- history;
- logs;
- analytics;
- screenshots;
- referrers;
- copied links.

## 17.5 Navigation API

Newer browser navigation APIs MAY simplify SPA navigation in compatible environments.

They are implementation options, not requirements. Application correctness remains defined by navigation behavior, not API choice.

---

# 18. Rendering architecture

## 18.1 Architecture options

### Static/prerendered HTML
Strong when:

- content changes less frequently than requests;
- public cacheability matters;
- low server runtime dependency is valuable;
- interactivity is limited/selective.

Costs:

- build/revalidation complexity;
- stale content if invalidation is weak.

### Server-side rendering (SSR)
Strong when:

- request/user state affects initial HTML;
- useful content should arrive before large client execution;
- server access simplifies data composition.

Costs:

- server/edge compute;
- TTFB sensitivity;
- cache complexity;
- activation/hydration if the same tree becomes interactive.

### Streaming SSR
Strong when:

- independent regions can make progress separately;
- slow data should not block useful shell/content.

Costs:

- error boundaries;
- ordering;
- cache complexity;
- loading consistency;
- client activation coordination.

### Client-side rendering (CSR)
Strong when:

- product is interaction-heavy;
- session is long-lived;
- authenticated shell dominates;
- offline/local computation matters;
- initial client boot cost is acceptable.

Costs:

- JS parse/execute;
- data waterfalls;
- blank/skeleton startup;
- client routing/accessibility obligations.

### Hybrid / partial activation / islands
Strong when:

- most content can remain HTML;
- only bounded regions need client behavior;
- JS reduction is valuable.

Costs:

- server/client boundary complexity;
- multiple execution mental models;
- serialization/ownership constraints.

These are mechanisms, not ranks.

## 18.2 Rendering decision framework

Evaluate:

| Constraint | Question |
|---|---|
| initial content | How soon must useful content appear? |
| interaction | How soon must controls actually respond? |
| client CPU | What devices execute the JS? |
| network | What bandwidth/latency population matters? |
| cacheability | Can output be shared/reused? |
| personalization | What must vary per request/user? |
| data locality | Where can data be composed safely/cheaply? |
| discoverability | Which crawlers/metadata/indexing requirements exist? |
| session length | Is initial load or long-session interaction dominant? |
| offline | Must behavior continue without origin access? |
| server cost | What runtime/edge compute is acceptable? |
| complexity | Can the team operate the rendering model? |
| recovery | What happens on partial render/data failure? |

## 18.3 Hydration/activation

Applied browser-performance guidance notes that full rehydration can add significant main-thread work and that server-rendered pages can appear interactive before event handlers attach [PERF02].

Rules:

- identify which regions truly require client activation;
- do not present critical enabled controls that silently ignore input during activation;
- serialize server/client state safely;
- test hydration mismatch;
- avoid duplicated server/client computation when it provides no benefit;
- measure activation on representative devices.

## 18.4 Data waterfalls

Model critical dependency chain:

```text
navigation
→ HTML
→ JS
→ JS executes
→ request data A
→ data A reveals request B
→ render
```

Ask whether dependencies can move earlier or run concurrently.

Do not move everything server-side mechanically; remove avoidable serialization based on evidence.

---

# 19. Network, Fetch and HTTP cache

## 19.1 Browser fetch boundary

Fetch/CORS behavior follows the browser platform [WEB03].

Define:

```yaml
origin:
credentials:
method:
request_body:
response_type:
cache_semantics:
timeout_or_abort_ui_policy:
retry_policy:
error_mapping:
authorization:
```

## 19.2 CORS

CORS controls whether browser script can access a cross-origin response under configured rules.

It does not answer:

> Is this authenticated principal allowed to perform this action on this resource?

That is authorization.

## 19.3 HTTP methods and retry safety

RFC 9110 defines safe/idempotent semantics and cautions automatic retry of non-idempotent operations unless the client knows retry is safe [HTTP01].

Frontend implications:

- do not retry mutation simply because “network error” occurred;
- mutation may have succeeded before response was lost;
- use idempotency keys/operation status/reconciliation for consequential actions where appropriate.

## 19.4 HTTP cache contract

For cacheable frontend resources/data define:

```yaml
resource:
public_or_private:
cache_key_dimensions:
freshness:
revalidation:
validator:
vary:
personalization:
sensitive_content:
stale_behavior:
invalidation:
```

RFC 9111 is the protocol baseline [HTTP02].

## 19.5 Application cache vs HTTP cache

Before adding a query/data cache, ask:

1. Does browser/CDN HTTP caching already solve this?
2. Is the data user-specific?
3. Is stale data acceptable?
4. How is mutation invalidation handled?
5. Can two caches create contradictory freshness?
6. What happens after logout/account switch?

---

# 20. Performance engineering

## 20.1 Define population and journey first

A valid performance target needs:

```yaml
journey_or_route:
user_population:
device_class:
network_class:
geography_if_material:
cold_or_warm:
authenticated_or_public:
sample_window:
percentile:
```

“Fast” is not a requirement.

## 20.2 Core Web Vitals

At the evidence cutoff, the current field targets are [PERF01]:

- **LCP:** ≤ 2.5 seconds;
- **INP:** ≤ 200 ms;
- **CLS:** ≤ 0.1;
- evaluate at the **75th percentile**, segmented across mobile and desktop.

Interpretation:

- LCP → loading of major visible content;
- INP → interaction responsiveness across the page visit;
- CLS → visual stability.

They do not directly measure:

- business-journey completion;
- SPA route transition latency;
- data freshness;
- memory leaks;
- error rate;
- offline recovery;
- accessibility.

## 20.3 Field vs lab

Field:

- real devices;
- real networks;
- real user behavior;
- browser lifecycle/cache variation.

Lab:

- controlled;
- reproducible;
- diagnostic;
- suitable for CI/regression.

web.dev explicitly documents that these datasets represent different conditions [PERF04].

Use both when performance is decision-relevant.

## 20.4 Main-thread responsiveness

Current INP guidance identifies JavaScript evaluation and long tasks as interaction-delay contributors [PERF05].

Inspect:

- initial activation;
- event handlers;
- render loops;
- heavy serialization;
- large DOM operations;
- third parties;
- long task distribution.

## 20.5 Resource criticality

Images:

- provide responsive variants where material;
- reserve layout dimensions;
- prioritize the likely LCP/hero asset;
- lazy-load below-the-fold/non-critical media rather than blindly lazy-loading everything.

Fonts:

- limit unnecessary variants;
- choose loading/display behavior intentionally;
- test fallback/layout effects.

Scripts/styles:

- split at user-meaningful boundaries;
- avoid duplicate libraries;
- defer non-critical work;
- remove unused client code when feasible.

## 20.6 Performance budgets

Budgets are `HOUSE` project controls, not universal numbers.

```yaml
journey:
population:

field:
  LCP:
  INP:
  CLS:
  route_transition:
  action_feedback:

lab:
  critical_path_requests:
  main_thread_blocking:
  critical_js_transfer:
  critical_js_execution:
  critical_css:
  image_media:
  third_party:

long_session:
  memory_growth:
  listener_observer_growth:

guardrails:
  error_rate:
  accessibility:
  functional_correctness:
```

A budget is useful only if it changes a decision.

## 20.7 bfcache

bfcache can restore a prior page quickly. Current guidance warns never to rely on `unload`; it is unreliable and can prevent bfcache eligibility in some browsers [PERF03].

Test important navigations:

```text
page A → page B → back
```

for state restoration, freshness and focus behavior.

## 20.8 Performance anti-metrics

Do not optimize in isolation:

- Lighthouse score;
- raw bundle KB;
- request count;
- DOM node count;
- component count;
- cache hit ratio.

Each is a diagnostic/proxy, not the user outcome.

---

# 21. Accessibility engineering

## 21.1 Standards baseline

WCAG 2.2 is the current W3C Recommendation baseline reviewed here [ACC01].

WAI-ARIA 1.2 is a completed Recommendation; ARIA 1.3 remains under development [ACC02].

Applicable legal/contractual conformance targets MUST be resolved separately.

## 21.2 Accessibility as architecture

Accessibility becomes expensive when foundational primitives are wrong:

- custom controls without keyboard behavior;
- visual-only state;
- DOM order inconsistent with reading/focus order;
- inaccessible modal/focus management;
- data model cannot carry labels/alternatives;
- route transitions without orientation;
- layouts that fail zoom/reflow;
- authentication that blocks assistive mechanisms.

Choose semantics early.

## 21.3 Native before ARIA

APG warns that “No ARIA is better than Bad ARIA” and that a role is a promise of expected behavior [ACC03].

Rule:

```text
native element fits?
  ├─ YES → use/extend native behavior
  └─ NO  → custom widget + complete semantics/keyboard/focus contract
```

ARIA does not automatically create:

- keyboard behavior;
- focus behavior;
- native form behavior;
- browser validation;
- visual state.

## 21.4 Keyboard/focus

Material interfaces SHOULD verify:

- every required function reachable without pointer-only action;
- visible focus;
- logical/predictable tab order;
- no accidental focus traps;
- focus restored after dialog/overlay close where appropriate;
- focus remains valid when focused DOM is removed;
- composite widgets follow expected conventions.

WAI APG treats focus visibility/predictability and keyboard conventions as essential interaction concerns [ACC03].

## 21.5 View navigation

For client-rendered route changes:

- update title;
- expose new primary context;
- intentionally manage focus;
- avoid dumping focus to document body;
- preserve expected back/forward semantics.

[ACC05][ACC06]

## 21.6 Forms/errors/status

Users need:

- programmatically associated labels;
- clear instructions;
- error identification;
- helpful correction when feasible;
- accessible status;
- preserved data after recoverable errors;
- non-color-only error state.

## 21.7 Responsive accessibility

Test:

- zoom;
- text resize;
- narrow reflow;
- long translated text;
- high contrast/forced colors where relevant;
- reduced motion;
- touch target requirements applicable to the chosen WCAG target.

## 21.8 Authentication

WCAG 2.2 added accessible-authentication criteria among other requirements [ACC07].

Do not block paste/password managers or require cognitive transcription/puzzle behaviors without a valid accessible alternative where the criterion applies.

## 21.9 Evaluation stack

```text
SEMANTIC / STATIC CHECKS
+ AUTOMATED ACCESSIBILITY CHECKS
+ MANUAL KEYBOARD
+ SCREEN READER / RELEVANT AT
+ RESPONSIVE / ZOOM / CONTRAST
+ REPRESENTATIVE USER TESTING when consequence/audience warrants
```

W3C explicitly states that tools cannot check all aspects and cannot determine accessibility; human judgment is required [ACC04].

## 21.10 Conformance vs usability

Keep separate:

- `conforms to selected WCAG target`;
- `user can efficiently and correctly complete the task`.

Both can matter.

---

# 22. Browser security engineering

This section translates the parent security standard into browser-specific controls.

## 22.1 Client is observable/tamperable

Assume users/attackers can inspect or modify:

- client JavaScript;
- DOM;
- network calls;
- local state;
- hidden inputs;
- feature flags delivered to client;
- client validation;
- route guards;
- disabled controls.

Therefore:

> **A client-side “permission check” is UX unless a trusted boundary independently enforces it.**

## 22.2 Client-delivered configuration

Any value compiled into or serialized to the client can be observed by that recipient.

Never expose:

- server secrets;
- private API keys that confer server privilege;
- signing keys;
- database credentials;
- privileged service tokens.

A “private env var” stops being private if the build includes it in browser code.

## 22.3 XSS / DOM injection

Default:

- text → `textContent`/framework escaped text path;
- attributes/URLs → context-specific validation;
- untrusted rich HTML → explicit sanitizer/allowlist;
- never disable framework escaping casually;
- avoid string-to-code or string-to-HTML APIs with untrusted values.

OWASP DOM-XSS guidance emphasizes safe sinks such as text-oriented DOM APIs [SEC04].

## 22.4 Server-state serialization

When server data is embedded into HTML/script:

- encode for the exact context;
- prevent closing-tag/script-context breakouts;
- avoid raw string concatenation into executable contexts;
- treat serialized user data as untrusted.

SSR does not remove XSS risk.

## 22.5 Sessions and browser storage

OWASP warns against storing session IDs/JWTs/refresh tokens in `localStorage`/`sessionStorage` because same-origin JavaScript can access them [SEC02].

Strong default where architecture permits:

- server-managed session/BFF;
- `HttpOnly`;
- `Secure`;
- appropriate `SameSite`;
- narrow cookie scope.

But token architecture is contextual. OAuth/public-client/cross-origin constraints can require different mechanisms; threat-model them rather than applying cookie dogma.

## 22.6 CSRF

If authentication credentials are automatically included by the browser for cross-site-capable requests, state-changing actions need an explicit CSRF design.

SameSite helps but OWASP treats it as defense in depth rather than a total replacement for CSRF controls [SEC03].

## 22.7 `postMessage`

Receiver MUST:

- know expected sender/origin;
- compare exact allowed origin;
- validate source if material;
- validate message schema;
- authorize requested action;
- never treat message text as code/HTML.

## 22.8 Third-party code

A third-party script executing in the page origin can often access substantial DOM/data capability.

Treat as high-trust dependency:

```yaml
vendor:
owner:
business_purpose:
origin:
data_access:
cookies_storage:
dom_access:
network_access:
update_mechanism:
integrity_control_if_applicable:
csp_requirements:
performance_budget:
failure_behavior:
removal_trigger:
```

## 22.9 CSP

CSP can constrain resource/script execution and reduce exploitability.

Use as defense in depth, not as a replacement for:

- safe rendering;
- input/data handling;
- dependency control.

CSP Level 3 is a **Working Draft** as of 16 Sep 2026 [SEC05].

## 22.10 Trusted Types

Trusted Types can harden powerful DOM injection sinks [SEC06].

Classification: `EMG / CTX`.

Use when:

- browser support fits;
- DOM-XSS consequence is material;
- team can operate policies without unsafe bypass.

Do not call the 2026 Working Draft a final Recommendation.

## 22.11 Permissions Policy

Permissions Policy can restrict selected browser features [SEC07].

Classification: `CTX`, with current spec status `Working Draft`.

Use where restricting capability reduces a meaningful attack/privacy surface.

---

# 23. Privacy and client storage

## 23.1 Browser data inventory

For client-retained data:

```yaml
data:
purpose:
sensitivity:
storage:
origin_scope:
readers:
writers:
retention:
logout_behavior:
account_switch:
tenant_switch:
deletion:
sync_to_server:
telemetry_exposure:
```

## 23.2 Storage selection

### URL
Good for shareable navigation state. Poor for secrets/sensitive state.

### Cookie
Good for small server-bound state/session attributes when security semantics fit.

### local/sessionStorage
Good for limited non-secret client key/value state; readable by origin JavaScript.

### IndexedDB
Good for larger structured/offline data; still client storage requiring sensitivity/retention policy.

Storage API choice does not create trust.

## 23.3 Telemetry privacy

Default-deny collection of:

- passwords/tokens;
- authorization headers;
- full form fields;
- raw DOM text;
- unnecessary query strings;
- customer document contents.

Define explicit allowlisted telemetry dimensions where practical.

---

# 24. Compatibility, Baseline and progressive capability

## 24.1 Explicit support contract

```yaml
core_browser_engines:
minimum_versions_or_baseline_policy:
mobile_browsers:
embedded_webviews:
assistive_technology:
device_cpu_memory_constraints:
network_constraints:
unsupported_behavior:
```

## 24.2 Baseline

Web Platform Baseline currently classifies features as Limited, Newly available and Widely available. “Widely available” uses a 30-month period after cross-browser interoperability [COMPAT01].

Use Baseline to answer:

> How broadly interoperable is this platform feature across the core browser set?

It cannot answer:

> Do 99.9% of our users have it?

## 24.3 Compatibility decision

```text
Feature needed?
  ↓
Is it within product support policy?
  ├─ YES → use + test
  └─ NO
      Can feature detection + graceful fallback preserve outcome?
        ├─ YES → progressive enhancement
        └─ NO → polyfill/alternate design/raise support floor
```

## 24.4 Browser-specific exceptions

User-agent/engine checks MAY be used when:

- a real browser defect requires it;
- capability detection cannot distinguish the failure;
- scope is narrow;
- workaround has test + removal trigger.

Do not build primary architecture on browser-name branching.

## 24.5 Web Platform Tests

WPT is a cross-browser test suite for the Web Platform and provides interoperability evidence [TEST01].

It does not test your product's:

- business flows;
- design system;
- auth logic;
- performance;
- accessibility usability.

---

# 25. Offline, installability and service workers

## 25.1 Status discipline

- Service Workers: Candidate Recommendation Draft at 17 Sep 2026 [PWA01].
- Web App Manifest: Working Draft at 13 Aug 2026 [PWA02].

Status does not imply unusability. It means the standard must remain version-aware.

## 25.2 Adoption gate

Add service worker only if it materially enables:

- offline/read resilience;
- install experience;
- controlled caching;
- background/push capability;
- network mediation.

Do not add because “PWAs are best practice.”

## 25.3 Service-worker contract

```yaml
capability_required:
registration_scope:
asset_cache_version:
data_cache:
freshness:
offline_read:
offline_mutation:
auth_behavior:
logout_clearance:
account_tenant_switch:
activation_strategy:
old_worker_coexistence:
cache_migration:
bad_release_recovery:
observability:
```

## 25.4 Offline mutation

Offline writes create a distributed consistency problem.

Define:

- operation identity;
- ordering;
- retries;
- duplicate handling;
- conflict resolution;
- user-visible pending state;
- rejection/compensation.

Do not hide unresolved conflict behind a “synced” badge.

---

# 26. Internationalization, localization and bidi

ECMA-402 13th edition, June 2026, is the finalized current ECMAScript internationalization API standard at the cutoff [I18N01].

## 26.1 Internationalization contract

Supported locale testing SHOULD consider:

- number/currency;
- date/time/time zone;
- list formatting;
- relative time;
- plural/message grammar;
- sorting/collation;
- text segmentation where material;
- name/address formats;
- input/parsing;
- translated text expansion;
- truncation;
- font/glyph coverage;
- line breaking.

## 26.2 Language

Set document/content language appropriately for assistive technology and language-sensitive behavior.

## 26.3 Direction

W3C advises using HTML `dir` for base direction and logical CSS for directional layout rather than CSS-only base direction [I18N02].

For RTL:

```html
<html lang="ar" dir="rtl">
```

Use `dir="auto"` where user-generated text direction is unknown and the behavior fits.

## 26.4 Do not “mirror everything”

Directional UI may need:

- logical spacing/alignment;
- icon review;
- media that should not mirror;
- charts/timelines domain review;
- mixed LTR/RTL content testing.

---

# 27. User-visible async, empty and failure states

A material async feature SHOULD define the states that can actually occur.

## 27.1 State set

Potential:

```text
idle
loading_initial
loading_incremental
ready
empty
stale
saving
queued_offline
validation_error
authorization_error
not_found
network_error
server_error
conflict
canceled
partial_success
success
```

Do not implement every state mechanically. Model the real state machine.

## 27.2 Loading strategy

Choose among:

- preserve previous content;
- skeleton;
- inline pending indicator;
- optimistic projection;
- progressive stream.

Avoid replacing stable content with disruptive loading UI when stale-but-valid content is better.

## 27.3 Recovery

Errors SHOULD answer where relevant:

- what happened in user terms;
- whether action applied;
- what data was preserved;
- retry safety;
- alternative action;
- support/escalation.

“Infinite spinner” is an undefined failure policy.

---

# 28. Frontend observability and RUM

## 28.1 Questions first

Frontend observability should help answer:

- Is the critical journey working in real browsers?
- Which route/version/browser is failing?
- Are users slow because of network, server, JS or third party?
- Did a deployment regress CWV or route latency?
- Are errors concentrated in one browser/locale?
- Is a service-worker version causing failure?
- Are long-lived sessions leaking memory/resources?

## 28.2 Signal classes

- JS/runtime errors;
- unhandled promise rejection;
- resource load failures;
- API error categories;
- navigation/route failures;
- CWV;
- route/action latency;
- long tasks/interactions;
- release/build version;
- browser/device segment;
- service-worker version/status;
- selected business outcome signals.

## 28.3 Privacy-safe telemetry

Define:

```yaml
event:
decision_supported:
fields_allowlist:
redaction:
sampling:
retention:
user_identifier_need:
sensitive_data_prohibited:
owner:
```

## 28.4 Source maps

Choose explicitly:

- public;
- private uploaded to telemetry tooling;
- restricted/no map.

Do not accidentally publish internal source merely because the build defaults do so.

---

# 29. Testing and verification

## 29.1 Evidence matrix

| Risk/question | Strong candidate evidence |
|---|---|
| transformation/domain calculation | unit/property test |
| semantic component behavior | DOM/component + browser test |
| focus/keyboard | real-browser/manual + automated where useful |
| route/history | browser integration/E2E |
| API/cache/data state | integration/contract |
| mutation duplicates/conflict | integration/state-machine test |
| browser engine differences | multi-engine browser test |
| visual drift | visual regression |
| responsive layout | viewport/container/zoom browser matrix |
| accessibility conformance | automated rules + manual |
| accessible usability | keyboard + AT + representative users |
| performance | lab profiling + RUM |
| memory/session leak | long-session profiling |
| XSS/DOM injection | security review/tests/sanitizer tests |
| authz | trusted-boundary tests; client UI tests only UX |
| SSR/hydration | server/client integration + mismatch cases |
| service worker/offline | lifecycle/offline integration |
| i18n/RTL | locale/direction matrix |
| third-party failure | blocked/slow/failing dependency scenarios |

## 29.2 Test pyramid

Classification: `D — heuristic`.

A large unit-test base may be efficient for some systems. It is not a universal frontend evidence distribution.

Example:

- a component library may need many DOM/interaction tests;
- a thin server-rendered site may need fewer unit tests and stronger route/accessibility/performance checks;
- an editor may need property/state tests plus browser E2E.

## 29.3 Real browser rule

Browser-specific properties require browser evidence.

DOM emulators MAY provide fast tests for:

- logic;
- basic DOM manipulation;
- event contracts.

They do not establish:

- actual layout/paint;
- browser focus quirks;
- accessibility tree behavior;
- bfcache;
- service worker lifecycle;
- real network/cache behavior;
- engine interoperability.

## 29.4 Component tests

Prefer:

- role/name;
- visible state;
- event result;
- keyboard;
- focus;
- error/pending state.

Avoid over-coupling to:

- internal hook/state names;
- private class names;
- exact wrapper nesting.

## 29.5 Snapshot/visual

Use snapshots/visual diffs for appearance/regression.

They do not prove:

- correct semantics;
- keyboard;
- screen-reader experience;
- business action;
- security;
- performance.

## 29.6 Accessibility test gate

For material paths:

```text
automated checks
→ manual keyboard
→ relevant screen reader / AT
→ zoom/reflow/contrast/motion
→ representative user test where consequence warrants
```

## 29.7 Cross-browser

At minimum, test critical journeys against the engines actually included in support policy.

Testing every browser/version combination is not required when compatibility evidence and risk allow smaller sampling.

## 29.8 Failure testing

Test, as relevant:

- slow network;
- offline;
- 4xx/5xx;
- timeout;
- duplicate click;
- stale response;
- malformed data;
- authorization loss mid-session;
- account/tenant switch;
- service-worker update;
- back/forward restore;
- cache stale/revalidation;
- third-party block/failure.

---

# 30. Build, assets, tooling and dependencies

## 30.1 Build requirements

Frontend builds SHOULD:

- be versioned/reproducible enough for release assurance;
- identify source revision;
- validate types/schemas as applicable;
- fail clearly;
- produce identifiable/hash-addressed static assets where appropriate;
- separate server secrets from public client config;
- control source maps;
- preserve cache-busting/release semantics;
- produce asset manifests/metadata where operations need them.

## 30.2 Tooling rule

A bundler/compiler/metaframework is justified by:

- capability;
- performance;
- DX/maintenance;
- ecosystem;
- deployment;
- team competence.

Not by popularity alone.

## 30.3 Dependencies

Before adding a material frontend dependency:

```yaml
need:
native_platform_alternative:
maintenance:
license:
size_runtime_cost:
security_history:
transitive_dependencies:
browser_support:
accessibility_behavior:
update_strategy:
exit_cost:
```

A UI library can reduce implementation risk or centralize it. Verify the relevant behavior.

---

# 31. Third-party script governance

Third-party scripts deserve a distinct play because they can combine:

- supply-chain risk;
- privacy/data collection;
- main-thread performance;
- layout shifts;
- network dependency;
- CSP exceptions.

## 31.1 Third-party admission

`PLAY-WEB-3P-001`

### Objective
Add third-party client code only when the user/business value exceeds full browser-side cost.

### Inputs
- business need;
- vendor;
- script/origin;
- data;
- performance evidence;
- security/privacy terms.

### Decision
Reject or isolate if:

- purpose unclear;
- owner absent;
- data access excessive;
- script requires broad unsafe CSP exceptions without compensating rationale;
- performance cost materially violates budget;
- no removal path exists.

### Acceptance
- owner named;
- purpose documented;
- network/data access understood;
- performance measured;
- security/privacy reviewed;
- update/removal path known.

---

# 32. AI-assisted frontend engineering

Inherit the parent rule: AI-generated engineering output is untrusted until verified [ENG00].

## 32.1 Frontend-specific AI failure modes

Watch for:

- invented/obsolete browser APIs;
- inaccurate compatibility claims;
- div/span soup with ARIA overlays;
- missing keyboard behavior;
- inaccessible modals/menus;
- client-only auth;
- secrets in public environment variables;
- unsafe `innerHTML`;
- stale-response races;
- unnecessary global stores;
- over-componentization;
- one-off CSS overrides;
- tests that only snapshot generated DOM;
- missing loading/error/offline states;
- incorrect RTL assumptions;
- library APIs hallucinated from old versions.

## 32.2 Required independent evidence

For material AI-generated UI changes:

- type/build checks;
- semantic/behavior tests;
- real-browser execution;
- accessibility checks;
- security review for trust-boundary changes;
- performance evidence when bundle/interaction paths change;
- accountable human/team comprehension.

A second model reviewing the first model is useful diversity, not automatically independent assurance.

---

# 33. Universal frontend decision framework

When frontend architecture is disputed:

## Step 1 — Define user outcome
What must the user accomplish?

## Step 2 — Define environment
Browsers, AT, devices, networks, public/authenticated, session length.

## Step 3 — Define authority/state
Which facts/actions are server-authoritative? Which can be local?

## Step 4 — Define critical quality attributes
Accessibility, performance, security, privacy, discoverability, offline, i18n.

## Step 5 — Model failure
Slow API, stale state, script failure, browser mismatch, service-worker issue, lost auth.

## Step 6 — Generate alternatives
Include simpler platform-native alternative.

## Step 7 — Compare lifecycle cost
Build + runtime + operations + upgrades + migration + testing.

## Step 8 — Verify uncertain assumptions
Prototype/benchmark/browser test/user test/threat model.

## Step 9 — Choose least complex adequate option
Prefer more reversible/lower-coupling option when outcomes are otherwise equivalent.

## Step 10 — Record revisit trigger
User growth, browser support, new requirements, measured bottleneck, team ownership change.

---

# 34. Decision trees

## 34.1 Do we need client-side rendering for this region?

```text
Does the region require post-load interaction/local state?
  ├─ NO → HTML/CSS/server/static output
  └─ YES
      Can native HTML/CSS behavior satisfy it?
        ├─ YES → enhance minimally
        └─ NO → add client component/logic
```

## 34.2 Where does state belong?

```text
Server authoritative?
  ├─ YES → server source + client cache/replica semantics
  └─ NO
      Shareable navigation?
        ├─ YES → URL/history (unless sensitive)
        └─ NO
            Unsaved user input?
              ├─ YES → form/draft state
              └─ NO
                  Local to component/feature?
                    ├─ YES → local state
                    └─ NO → define shared owner before global store
```

## 34.3 Should we persist state in browser storage?

```text
Does it need to survive navigation/session?
  ├─ NO → don't persist
  └─ YES
      Is it a credential/secret?
        ├─ YES → do not use ordinary JS-readable storage as vault
        └─ NO
            Is retention/sensitivity/versioning defined?
              ├─ NO → define lifecycle first
              └─ YES → choose suitable storage
```

## 34.4 Static vs request-time rendering

```text
Can initial representation be reused across users/requests?
  ├─ YES → static/prerender/cache is strong candidate
  └─ NO
      Must request-specific data be in initial HTML?
        ├─ YES → SSR/edge/server rendering candidate
        └─ NO → client fetch/render may be adequate
```

Then evaluate activation/client CPU and operational cost.

## 34.5 Add a global store?

```text
Is the state truly shared across distant features?
  ├─ NO → keep nearest owner
  └─ YES
      Is the need server cache / URL / form state instead?
        ├─ YES → use semantic owner
        └─ NO
            Does central store reduce total coordination complexity?
              ├─ YES → use smallest adequate shared state
              └─ NO → keep bounded owners
```

## 34.6 Add a custom widget?

```text
Does native element/pattern satisfy semantics and behavior?
  ├─ YES → use native
  └─ NO
      Can team implement + test complete keyboard/focus/AT contract?
        ├─ NO → redesign / use proven accessible primitive
        └─ YES → custom widget
```

## 34.7 Add service worker?

```text
Is there a real offline/install/background/cache capability requirement?
  ├─ NO → don't add
  └─ YES
      Is freshness/auth/cache/update/recovery defined?
        ├─ NO → design lifecycle first
        └─ YES → implement + lifecycle test
```

## 34.8 Add micro-frontends?

```text
Need independent team ownership/deployment/migration boundary?
  ├─ NO → modular single frontend
  └─ YES
      Does boundary value exceed duplicate runtime/integration/UX cost?
        ├─ NO → modular single frontend
        └─ YES → bounded micro-frontend architecture
```

## 34.9 Cache data?

```text
Measured latency/load problem?
  ├─ NO → avoid cache by default
  └─ YES
      Can source/HTTP caching solve it?
        ├─ YES → use simpler layer
        └─ NO
            Are key/freshness/invalidation/privacy defined?
              ├─ NO → define semantics
              └─ YES → add measured application cache
```

---

# 35. Frontend architecture review standard

## 35.1 Intent
- [ ] Critical journeys are defined
- [ ] Browser/device/AT environment is defined
- [ ] Criticality assigned
- [ ] Discoverability/offline/i18n constraints explicit

## 35.2 Platform
- [ ] Native platform alternative evaluated
- [ ] New APIs fit support policy
- [ ] Draft-spec dependencies are labeled/status-aware

## 35.3 Rendering
- [ ] Rendering model follows constraints
- [ ] Client activation/hydration cost understood
- [ ] Data waterfalls analyzed
- [ ] Server/client state serialization safe
- [ ] Direct navigation and client navigation both behave correctly

## 35.4 State
- [ ] Authoritative data owners clear
- [ ] URL/form/local/shared/persistent state classified
- [ ] Duplicate truth minimized
- [ ] Stale/out-of-order responses handled
- [ ] Optimistic mutation contract defined where used

## 35.5 Accessibility
- [ ] Native semantics chosen where appropriate
- [ ] Keyboard/focus route/component behavior defined
- [ ] Applicable WCAG target identified
- [ ] Manual/AT validation planned

## 35.6 Security/privacy
- [ ] Client never final auth authority
- [ ] Secrets excluded from client assets/storage
- [ ] XSS/rich HTML model defined
- [ ] CSRF/CORS/session model correct
- [ ] Third-party scripts inventoried
- [ ] telemetry/client storage privacy reviewed

## 35.7 Performance
- [ ] Performance population defined
- [ ] Field + lab strategy defined
- [ ] CWV/journey targets selected appropriately
- [ ] third-party/main-thread/resource risks bounded
- [ ] long-session memory considered if relevant

## 35.8 Operations/evolution
- [ ] error/loading/offline states defined
- [ ] frontend observability owner/signals clear
- [ ] build/release/cache/service-worker recovery clear
- [ ] framework/dependency exit/migration risk understood

---

# 36. Component review standard

- [ ] Purpose/semantics are clear
- [ ] Native element evaluated
- [ ] Accessible name strategy
- [ ] Keyboard contract
- [ ] Focus contract
- [ ] Selection vs focus distinguished where relevant
- [ ] Controlled/uncontrolled state contract
- [ ] No duplicate authority
- [ ] Loading/error/empty/disabled behavior
- [ ] Safe untrusted-content rendering
- [ ] Responsive/zoom/text expansion
- [ ] RTL/locale behavior
- [ ] Polymorphic variants preserve semantics
- [ ] Real-browser behavior tested where browser semantics matter
- [ ] Design-system blast radius justifies assurance depth

---

# 37. Route/journey review standard

- [ ] Direct URL entry
- [ ] Refresh
- [ ] Back/forward
- [ ] Title
- [ ] Primary heading/orientation
- [ ] Focus transition
- [ ] Scroll restoration
- [ ] Loading/partial
- [ ] Empty
- [ ] not-found
- [ ] authorization failure/redirect
- [ ] network/server error
- [ ] duplicate mutation behavior
- [ ] stale response
- [ ] relevant performance/RUM
- [ ] keyboard
- [ ] screen reader/AT
- [ ] mobile/zoom/reflow
- [ ] target browser engines
- [ ] locale/RTL if supported
- [ ] telemetry privacy

---

# 38. Accessibility release gate

For the chosen product/conformance target:

- [ ] page/view language set
- [ ] titles meaningful
- [ ] heading/landmark structure coherent
- [ ] controls have accessible names
- [ ] native controls used where fitting
- [ ] keyboard reaches/operates functionality
- [ ] focus visible
- [ ] focus not lost after dynamic removal/dialog/navigation
- [ ] errors identified and recoverable
- [ ] status messages handled
- [ ] contrast/non-color-only meaning checked
- [ ] zoom/reflow checked
- [ ] motion preferences checked where applicable
- [ ] target sizes/drag alternatives checked where target requires
- [ ] accessible-authentication requirements checked
- [ ] automated scan completed
- [ ] manual keyboard completed
- [ ] relevant AT/screen-reader journey completed
- [ ] representative user validation completed where risk/audience warrants

Automation-only cannot pass this gate for a material interactive product [ACC04].

---

# 39. Performance release gate

- [ ] Critical journeys/population defined
- [ ] Field baseline available or collection plan exists
- [ ] Lab regression run
- [ ] LCP/INP/CLS checked where applicable
- [ ] route/action feedback checked
- [ ] main-thread long tasks investigated if material
- [ ] client activation/hydration measured
- [ ] LCP resource prioritized intentionally
- [ ] layout shift sources controlled
- [ ] image/font strategy reviewed
- [ ] third-party cost reviewed
- [ ] bfcache checked for relevant navigations
- [ ] no correctness/security/accessibility weakened for performance
- [ ] long-session memory checked where relevant

---

# 40. Frontend security release gate

- [ ] trusted-boundary authorization exists
- [ ] no client-delivered secrets
- [ ] user-controlled HTML/URL/data uses safe context handling
- [ ] rich HTML sanitizer/trust pipeline reviewed if used
- [ ] server-to-client serialization safe
- [ ] session/token storage model threat-modeled
- [ ] CSRF design correct for credential model
- [ ] CORS not used as authorization
- [ ] postMessage origin/schema validated
- [ ] third-party scripts inventoried/reviewed
- [ ] CSP considered/implemented where useful
- [ ] security policies tested in target browsers
- [ ] logout/account/tenant storage/cache behavior tested
- [ ] telemetry/logging excludes sensitive data

ASVS 5.0.0 is a strong current application-security verification reference [SEC01].

---

# 41. Production readiness standard

## Product/ownership
- [ ] product owner
- [ ] engineering owner
- [ ] critical routes/journeys
- [ ] support escalation path

## Browser/support
- [ ] explicit support policy
- [ ] critical flows tested in target engines
- [ ] fallback/unsupported behavior defined

## Accessibility
- [ ] applicable target identified
- [ ] automated + manual evidence
- [ ] keyboard/AT validation proportionate to risk

## Performance
- [ ] population/targets
- [ ] lab + field
- [ ] resource/third-party/main-thread risk
- [ ] bfcache/lifecycle

## State/data
- [ ] authority ownership
- [ ] stale/conflict/optimistic semantics
- [ ] persistent-state migration
- [ ] cache privacy/freshness

## Security/privacy
- [ ] client authority boundary
- [ ] XSS/serialization
- [ ] sessions/CSRF/CORS
- [ ] third parties
- [ ] storage/telemetry privacy

## Failure
- [ ] loading/empty/error/offline
- [ ] API failure
- [ ] authorization loss
- [ ] duplicate/retry
- [ ] recovery

## Release
- [ ] asset versioning
- [ ] feature flags owner/cleanup if used
- [ ] source-map policy
- [ ] CDN/cache invalidation
- [ ] service-worker rollout/recovery if used
- [ ] post-release verification

---

# 42. Frontend metrics and Goodhart resistance

## 42.1 Useful signals

Possible:

- task success;
- route/action latency;
- LCP/INP/CLS;
- JS error rate;
- API operation error;
- accessibility defects;
- escaped UX defects;
- client asset transfer/execution;
- third-party cost;
- memory growth in long sessions;
- browser-specific failure rate;
- support tickets tied to frontend defects.

## 42.2 Anti-metrics

Do not use alone as frontend quality:

- lines of UI code;
- component count;
- component reuse percentage;
- Storybook story count;
- unit test count;
- code coverage;
- Lighthouse score;
- bundle KB;
- DOM node count;
- number of accessibility scanner violations;
- generated AI code volume.

Metric question:

```yaml
metric:
user_or_system_outcome:
decision_supported:
population:
known_blind_spots:
gaming_risk:
guardrail:
```

---

# 43. Anti-playbook — claims to actively resist

## 43.1 “Every serious web app should be an SPA”
**Verdict:** `F — false universalization.`  
**Better rule:** Choose navigation/rendering from product constraints.

## 43.2 “SSR is always faster”
**Verdict:** `F.`  
Server compute, TTFB, caching, hydration/client activation and device profile determine the result [PERF02].

## 43.3 “CSR is bad for SEO”
**Verdict:** `F — overgeneralization.`  
Define indexing/discovery/crawler requirements; rendering is one implementation mechanism.

## 43.4 “Server Components / resumability / islands solve frontend architecture”
**Verdict:** `E — implementation family.`  
Verify actual state boundaries, client payload, interaction and ecosystem constraints.

## 43.5 “Hydration is basically free after HTML arrives”
**Verdict:** `F.`  
Activation can consume client CPU and delay responsiveness [PERF02].

## 43.6 “State belongs in a global store”
**Verdict:** `F.`  
Classify authority/lifetime first.

## 43.7 “One state library should own server data, forms, URL and local UI”
**Verdict:** `F.`  
Different state classes have different semantics.

## 43.8 “Store derived state to make rendering simpler”
**Verdict:** `F as default.`  
Derived copies create invalidation/consistency risk.

## 43.9 “ARIA makes custom HTML accessible”
**Verdict:** `F.`  
Role is a behavioral promise; native semantics usually provide more built-in behavior [ACC03].

## 43.10 “Accessibility scanner green means accessible”
**Verdict:** `F.`  
W3C requires human judgment for unautomatable aspects [ACC04].

## 43.11 “WCAG conformance means the experience is usable”
**Verdict:** `F as full claim.`  
Conformance is necessary evidence in many contexts, not total usability proof.

## 43.12 “Lighthouse 100 means fast”
**Verdict:** `F.`  
Synthetic aggregate score ≠ real-user journey.

## 43.13 “Core Web Vitals are frontend performance”
**Verdict:** `F as complete definition.`  
They cover important facets; route latency, errors, memory and business interaction remain.

## 43.14 “Keep JS under N KB”
**Verdict:** `F as universal law.`  
Use population/journey budgets.

## 43.15 “Lazy-load every image”
**Verdict:** `F.`  
Critical/LCP imagery may need early loading.

## 43.16 “Prefetch everything likely next”
**Verdict:** `F.`  
Network/privacy/server cost and request safety matter.

## 43.17 “Global state makes large apps easier”
**Verdict:** `CTX at best.`  
It may centralize coordination or create global coupling.

## 43.18 “Micro-frontends scale the frontend”
**Verdict:** `E/CTX.`  
They may scale team/deployment ownership while increasing runtime/integration complexity [ARCH01].

## 43.19 “CSS-in-JS is more maintainable”
**Verdict:** `E.`

## 43.20 “Utility CSS is more maintainable”
**Verdict:** `E.`

## 43.21 “Design systems should replace native controls with branded custom widgets”
**Verdict:** `F.`  
Brand consistency does not justify losing platform semantics.

## 43.22 “More reuse is better”
**Verdict:** `F.`  
Reuse stable knowledge, not superficial similarity.

## 43.23 “Viewport width tells us mobile vs desktop interaction”
**Verdict:** `F.`  
Viewport and input capability are different dimensions.

## 43.24 “Client validation secures the form”
**Verdict:** `F.`

## 43.25 “Hide the admin button to prevent access”
**Verdict:** `F.`  
UI hiding is not authorization.

## 43.26 “CORS protects the API”
**Verdict:** `F.`  
It controls browser response sharing, not resource authorization [WEB03].

## 43.27 “JWT in localStorage is standard frontend auth”
**Verdict:** `F as universal default.`  
Threat-model token/session architecture [SEC02].

## 43.28 “SameSite means CSRF solved”
**Verdict:** `F.`  
Defense in depth, not universal complete protection [SEC03].

## 43.29 “CSP solves XSS”
**Verdict:** `F.`  
Defense in depth; safe rendering/data flow remains primary.

## 43.30 “Trusted Types is now a universal standard”
**Verdict:** `F.`  
Current spec remains a Working Draft [SEC06].

## 43.31 “Service worker makes a web app resilient”
**Verdict:** `CTX.`  
It creates capability plus persistent update/cache failure modes.

## 43.32 “PWA should be the default”
**Verdict:** `F.`  
Adopt install/offline/background capabilities only when required.

## 43.33 “Baseline Widely available means all our users support it”
**Verdict:** `F.`  
Baseline uses an interoperability-time model, not product analytics [COMPAT01].

## 43.34 “Never use user-agent detection”
**Verdict:** `F as absolute.`  
Capability detection is preferred, but narrow browser-bug workarounds can be justified.

## 43.35 “jsdom proves browser behavior”
**Verdict:** `F.`

## 43.36 “E2E tests are enough”
**Verdict:** `F.`  
They are one evidence type; accessibility, performance, state and security need other methods.

## 43.37 “The test pyramid is best practice”
**Verdict:** `D — heuristic.`

## 43.38 “Snapshots are frontend regression testing”
**Verdict:** `INCOMPLETE.`  
They detect some drift; they do not prove behavior.

## 43.39 “Internationalization is translating strings”
**Verdict:** `F.`  
Locale, grammar, time, number, collation, direction and layout matter [I18N01][I18N02].

## 43.40 “The build passed, so frontend is production-ready”
**Verdict:** `F.`  
Browser runtime, accessibility, performance, cache/lifecycle and failure behavior remain.

## 43.41 “AI-generated UI is safe if it looks correct”
**Verdict:** `F.`  
Semantics/security/state/accessibility can fail invisibly.

---

# 44. Contradiction ledger

| Debate | Evidence-weighted conclusion |
|---|---|
| native vs custom | native when semantics fit; custom only when requirement earns owned behavior |
| progressive enhancement vs app complexity | preserve resilient baseline where valuable; do not duplicate inherently client-native products ceremonially |
| static vs SSR | cacheability/content reuse favors static; request-specific initial representation can favor SSR |
| SSR vs CSR | compare server TTFB/compute with client boot/activation and session interaction needs |
| full hydration vs partial activation | full hydration simplifies one mental model; partial activation can reduce JS but adds boundaries |
| local vs global state | nearest semantic owner by default; global only for real shared coherence |
| derived vs stored state | derive by default; cache expensive computation with correct keys/invalidation |
| optimistic vs pessimistic UI | optimistic when rollback/conflict semantics are safe; pessimistic when consequence/ambiguity is high |
| HTTP cache vs client cache | use protocol cache where it fits; client cache for richer application semantics |
| accessibility automation vs manual | automate what is machine-testable; human/AT evaluation remains necessary |
| semantic HTML vs ARIA | native semantics first; ARIA extends/recreates only with full behavior |
| lab vs field performance | lab diagnoses/regresses; field validates real population |
| CWV vs product SLO | CWV useful field guardrails; product journeys may require more/different targets |
| feature detection vs UA detection | feature detection default; narrow UA workaround for genuine defects |
| design system vs local component | shared primitive reduces variance; local component reduces blast radius when reuse is weak |
| monofrontend vs microfrontend | single deployable simpler; microfrontends earn cost through independent ownership/deployment/migration |
| service worker vs network simplicity | service worker buys offline/control capability at lifecycle complexity cost |
| browser storage vs server storage | client storage reduces latency/offline dependency but is less trustworthy and requires device lifecycle handling |
| strict CSP vs compatibility | stricter policy reduces attack surface; integration constraints may require staged adoption |
| runtime styling vs static CSS | runtime can enable dynamic theming/scoping; adds JS/runtime/SSR complexity |
| E2E vs component tests | E2E proves integration journey; component tests give focused fast behavior evidence |
| visual fidelity vs native controls | style native controls where possible; do not sacrifice semantics for pixel identity |
| prefetch vs resource economy | prefetch when probability/value exceeds bandwidth/privacy/server cost |
| stale content vs loading spinner | stale-but-valid can be better than blank loading if freshness semantics allow it |

---

# 45. Maintenance and evolution

## 45.1 Browser/platform evolution

Review when:

- support floor changes;
- Baseline status changes for important feature;
- browser deprecates lifecycle/API behavior;
- W3C/WHATWG/IETF spec status materially changes;
- Core Web Vitals definition/threshold changes;
- accessibility standard/legal target changes;
- security control/support changes;
- service-worker/install behavior changes.

## 45.2 Framework/tool migration

Migration success criteria SHOULD include:

- same/approved user behavior;
- URLs/history preserved;
- accessibility preserved/improved;
- performance measured;
- auth/security boundaries preserved;
- data/state semantics preserved;
- tests remain meaningful;
- observability preserved;
- bundle/build/release behavior understood.

“A build passes” is not migration validation.

## 45.3 Deprecated platform code

Remove:

- browser workarounds after support window;
- legacy polyfills no longer needed;
- dead feature flags;
- obsolete compatibility layers;
- unused third-party scripts;
- stale service-worker caches;
- abandoned design-system variants.

Deletion reduces attack, performance and maintenance surface.

---

# 46. Governance and review triggers

## 46.1 Accountable owner

Before `VALIDATED`, assign an accountable Engineering Standards Owner for:

- source freshness;
- defect triage;
- exception decisions;
- change review;
- deprecation.

## 46.2 Event-triggered review

Trigger review on:

- new WCAG Recommendation or material interpretation affecting the standard;
- WAI-ARIA Recommendation change;
- Core Web Vitals metric/threshold change;
- major browser lifecycle/security change;
- CSP/Trusted Types/Permissions Policy status shift;
- Service Workers/App Manifest status/behavior shift;
- Baseline compatibility model change;
- major security advisory affecting browser/frontend pattern;
- repeated production incident/defect;
- representative field test falsifies a rule.

## 46.3 Exceptions

```yaml
rule:
exception:
context:
reason:
risk:
compensating_control:
owner:
approval:
expiry_or_review_trigger:
```

Permanent recurring exceptions should change the standard or be explicitly rejected.

---

# 47. Frontend project startup template

```yaml
project:
owner:
criticality:

users:
critical_journeys:

support:
  browsers:
  mobile:
  webviews:
  assistive_technology:
  device_network_constraints:

navigation:
  public_or_authenticated:
  direct_links:
  title_focus_scroll:
  discoverability:

rendering:
  selected_model:
  why:
  activation_hydration:
  cacheability:
  personalization:

state:
  server_authoritative:
  url:
  forms_drafts:
  local_ui:
  shared_client:
  persistent_client:
  derived:

data:
  sensitive:
  consistency:
  optimistic_mutations:
  offline:

accessibility:
  target:
  keyboard:
  AT:
  manual_test:

performance:
  population:
  field_targets:
  lab_budgets:
  long_session:

security:
  session:
  csrf:
  xss:
  csp:
  third_party:
  client_secrets: prohibited

i18n:
  locales:
  time_zones:
  rtl:

testing:
  component:
  integration:
  real_browser:
  e2e:
  accessibility:
  performance:
  security:

operations:
  RUM:
  errors:
  source_maps:
  service_worker:

release:
  assets:
  cache_invalidation:
  progressive_exposure:
  rollback_or_rollforward:
```

---

# 48. One-page Golden Standard

If only one section can be used:

1. Start from user journeys, browser environment and unacceptable failure.
2. Use semantic HTML/platform behavior before custom client code.
3. Treat the browser as an untrusted client, never the final authorization authority.
4. Keep secrets out of client-delivered assets and ordinary JS-readable storage.
5. Classify server, URL, form, local, shared, persistent and derived state before selecting tools.
6. Give every material fact one authoritative owner.
7. Treat client server-state copies as caches/replicas with freshness/conflict rules.
8. Handle stale/out-of-order async responses intentionally.
9. Give optimistic mutations idempotency/conflict/rollback/reconciliation semantics.
10. Use URL/history for navigation state only when shareability is appropriate and data is safe to expose.
11. Choose rendering from cacheability, personalization, client CPU, interaction, discoverability and operational constraints.
12. Treat hydration as client execution with both performance and correctness risks.
13. Do not equate SSR with SEO or CSR with poor SEO.
14. Make direct URL, refresh, back/forward, title, focus and scroll part of route correctness.
15. Prefer native controls; custom ARIA widgets must fulfill the complete behavioral promise.
16. Accessibility automation is necessary evidence but cannot prove accessibility alone.
17. Use manual keyboard and relevant AT testing for material interactive journeys.
18. Define performance by real population/journeys and distributions.
19. Use LCP/INP/CLS as useful field guardrails, not the whole performance system.
20. Combine field and lab evidence.
21. Budget main-thread/client activation and third-party cost.
22. Do not rely on `unload`; test browser lifecycle/bfcache behavior.
23. Use HTTP semantics/caching before redundant custom layers.
24. Cache only with explicit source of truth, key, freshness, invalidation and privacy.
25. CORS is not authorization.
26. Cookie-auth mutations require explicit CSRF design; SameSite is defense in depth.
27. Use safe DOM/text sinks; sanitize intentional untrusted rich HTML.
28. Serialize server data safely into HTML/script contexts.
29. Treat CSP as defense in depth and draft security specs as status-aware controls.
30. Treat third-party scripts as privileged dependencies.
31. Define a real browser support policy; Baseline informs but does not decide it.
32. Use real-browser tests for browser behavior.
33. Select tests from failure modes rather than a fixed pyramid.
34. Snapshot/visual tests do not prove interaction/accessibility.
35. Treat service workers/offline as optional distributed-state infrastructure with update/recovery design.
36. Treat internationalization/RTL as correctness, not translation polish.
37. Make loading/empty/stale/offline/error/conflict states part of feature completeness where real.
38. Instrument user journeys without collecting unnecessary sensitive data.
39. Treat design-system primitives as high-blast-radius code deserving stronger assurance.
40. Treat micro-frontends as contextual organizational/deployment architecture.
41. Keep framework/CSS/state choices reversible and subordinate to requirements.
42. Treat AI-generated frontend output as untrusted until independently verified.
43. Delete obsolete abstractions/polyfills/scripts when platform/support makes them unnecessary.
44. Re-verify fast-moving browser/security/performance facts at decision time.
45. Promote this playbook to `VALIDATED` only after representative non-author field execution.

---

# 49. Evidence map and annotated source register

> Sources have different evidentiary roles. Specifications establish semantics/status; applied browser/vendor guidance provides operational mechanisms; security guidance provides controls; empirical research informs contextual architecture. No source is treated as universal authority outside the claim it supports.

## BASE00 — Master Playbook Standard v2.0-RC1
**Source:** user-provided canonical parent playbook.  
**Use:** research/evidence model, risk-proportionate rigor, normative language, QA gates, statuses, audit and non-author validation requirement.  
**Limitation:** domain-agnostic; web implementation detail belongs here.

## ENG00 — Universal Software & AI Engineering Master Playbook v2.0
**Source:** user-provided engineering master.  
**Use:** correctness, architecture, state, security, privacy, reliability, performance, testing, supply chain, AI-assisted engineering.  
**Limitation:** intentionally delegates detailed frontend implementation guidance to this specialist playbook.

## WEB01 — WHATWG HTML Living Standard — Scripting
**URL:** https://html.spec.whatwg.org/multipage/scripting.html  
**Status at cutoff:** Living Standard, updated Sep 2026.  
**Finding:** encourages declarative alternatives where possible and graceful degradation without scripting.  
**Use:** platform-first/progressive-enhancement principle.  
**Limitation:** does not imply every rich application must be fully functional without JS.

## WEB02 — WHATWG HTML Living Standard — Forms
**URL:** https://html.spec.whatwg.org/multipage/forms.html  
**Status:** Living Standard.  
**Finding:** many forms can function without client scripting; scripting can augment UX.  
**Use:** resilient form baseline.  
**Limitation:** server/trusted-boundary validation and product interaction still contextual.

## WEB03 — WHATWG Fetch Standard
**URL:** https://fetch.spec.whatwg.org/  
**Status:** Living Standard.  
**Use:** browser fetch, credentials, origin/CORS semantics.  
**Limitation:** fetch/CORS semantics do not define application authorization policy.

## HTTP01 — IETF RFC 9110 — HTTP Semantics
**URL:** https://www.rfc-editor.org/rfc/rfc9110.html  
**Use:** safe/idempotent methods, retry semantics, core HTTP behavior.  
**Finding:** clients should not automatically retry non-idempotent requests unless they know retry is safe/not applied.  
**Limitation:** business idempotency can require application-level keys/state.

## HTTP02 — IETF RFC 9111 — HTTP Caching
**URL:** https://www.rfc-editor.org/rfc/rfc9111.html  
**Use:** HTTP cache freshness/revalidation/storage semantics.  
**Limitation:** application caches can add independent semantics and must be reasoned about separately.

## COMPAT01 — WebDX / web.dev — Web Platform Baseline
**URL:** https://web.dev/baseline  
**Status:** current compatibility model.  
**Finding:** Newly available means interoperable across core browsers; Widely available adds 30 months.  
**Use:** compatibility evidence.  
**Limitation:** does not represent a product's specific user/browser population.

## ACC01 — W3C — WCAG 2.2
**URL:** https://www.w3.org/TR/WCAG22/  
**Status:** W3C Recommendation; latest published Recommendation 12 Dec 2024.  
**Use:** testable web accessibility conformance criteria.  
**Limitation:** conformance does not by itself prove complete usability or legal compliance in every jurisdiction.

## ACC02 — W3C WAI — WAI-ARIA
**URL:** https://www.w3.org/WAI/standards-guidelines/aria/  
**Status:** ARIA 1.2 completed Recommendation; 1.3 draft under development.  
**Use:** accessibility semantics for custom interface elements.  
**Limitation:** roles/properties do not create keyboard behavior automatically.

## ACC03 — W3C WAI — ARIA Authoring Practices, Read Me First / Keyboard
**URLs:**  
https://www.w3.org/WAI/ARIA/apg/practices/read-me-first/  
https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/  
**Use:** native-first warning, ARIA role behavioral promise, keyboard/focus practices.  
**Evidence role:** applied WAI guidance.  
**Limitation:** APG examples are patterns/examples, not a requirement that every product copy an exact implementation.

## ACC04 — W3C WAI — Evaluating Web Accessibility
**URL:** https://www.w3.org/WAI/test-evaluate/  
**Finding:** no tool alone can determine if a site meets accessibility needs/standards; knowledgeable human evaluation is required.  
**Use:** automation limitation and manual evaluation requirement.

## ACC05 — W3C — Understanding WCAG 2.2, Page Titled
**URL:** https://www.w3.org/WAI/WCAG22/Understanding/page-titled  
**Finding:** distinct SPA views that change dynamically should update title to match current topic/content.  
**Use:** client route transition contract.

## ACC06 — WAI APG — Navigation Menubar Example
**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/menubar/examples/menubar-navigation/  
**Finding:** SPA-like navigation example moves focus to new content heading to communicate completion/destination.  
**Use:** evidence for intentional focus/orientation after dynamic navigation.  
**Limitation:** exact focus target remains contextual.

## ACC07 — W3C WAI — What’s New in WCAG 2.2
**URL:** https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/  
**Use:** new criteria including focus, target size, redundant entry and accessible authentication.  
**Limitation:** actual conformance target/project applicability must be determined separately.

## PERF01 — web.dev — Web Vitals
**URL:** https://web.dev/articles/vitals  
**Status:** current metric guidance at cutoff.  
**Finding:** LCP ≤2.5s, INP ≤200ms, CLS ≤0.1; evaluate at 75th percentile across mobile/desktop.  
**Use:** field performance guardrails.  
**Limitation:** Google-defined web user-experience metrics; not a complete product performance/SLO model.

## PERF02 — web.dev — Rendering on the Web
**URL:** https://web.dev/articles/rendering-on-the-web  
**Last updated:** 5 Jan 2026.  
**Finding:** defines SSR/CSR/prerender/hydration trade-offs; hydration can add TBT/INP cost and apparent-before-real interactivity.  
**Use:** applied performance evidence for rendering decisions.  
**Limitation:** browser-vendor applied guidance, not a universal architecture standard.

## PERF03 — web.dev — Back/forward cache
**URL:** https://web.dev/articles/bfcache  
**Finding:** unload handlers are unreliable and can harm bfcache eligibility; pagehide/lifecycle patterns are preferred.  
**Use:** lifecycle correctness/performance.  
**Limitation:** browser behavior can evolve; recheck target browsers.

## PERF04 — web.dev — Why lab and field data can be different
**URL:** https://web.dev/articles/lab-and-field-data-differences  
**Finding:** lab is controlled; field reflects varied devices, networks, users and browser optimizations.  
**Use:** multi-method performance evidence.

## PERF05 — web.dev — Optimize Interaction to Next Paint
**URL:** https://web.dev/articles/optimize-inp  
**Finding:** JavaScript evaluation and long main-thread tasks can increase interaction delay.  
**Use:** main-thread performance mechanism.  
**Limitation:** implementation tactics must be measured in the actual product.

## SEC01 — OWASP Application Security Verification Standard 5.0.0
**URL:** https://owasp.org/www-project-application-security-verification-standard/  
**Status:** latest stable version listed as 5.0.0 at cutoff.  
**Use:** concrete application-security verification reference.  
**Limitation:** not a full threat model or substitute for backend/infrastructure security standards.

## SEC02 — OWASP Session Management Cheat Sheet
**URL:** https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html  
**Finding:** advises against storing authentication tokens/session IDs/JWTs/refresh tokens in local/session storage; discusses secure cookie attributes.  
**Use:** browser session/storage threat guidance.  
**Limitation:** exact session architecture remains contextual.

## SEC03 — OWASP CSRF Prevention Cheat Sheet
**URL:** https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html  
**Finding:** SameSite is defense in depth against CSRF.  
**Use:** cookie-auth mutation controls.  
**Limitation:** XSS and application architecture can undermine CSRF controls; threat model remains required.

## SEC04 — OWASP DOM-based XSS Prevention Cheat Sheet
**URL:** https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html  
**Use:** safe DOM sinks and context-aware injection prevention.  
**Limitation:** one layer in the application security program.

## SEC05 — W3C — Content Security Policy Level 3
**URL:** https://www.w3.org/TR/CSP3/  
**Status:** Working Draft, 16 Sep 2026.  
**Use:** current CSP evolution and security policy mechanism.  
**Rule:** MUST NOT be represented as a final Recommendation.

## SEC06 — W3C — Trusted Types
**URL:** https://www.w3.org/TR/trusted-types/  
**Status:** Working Draft, 23 Jun 2026.  
**Use:** emerging DOM injection-sink hardening.  
**Rule:** contextual/emerging, not universal final-standard baseline.

## SEC07 — W3C — Permissions Policy
**URL:** https://www.w3.org/TR/permissions-policy/  
**Status:** Working Draft, 22 Sep 2026.  
**Use:** selective browser capability restriction.  
**Limitation:** support/feature behavior varies; status remains draft.

## CSS01 — W3C — CSS Cascading and Inheritance Level 5
**URL:** https://www.w3.org/TR/css-cascade-5/  
**Status:** Candidate Recommendation Snapshot.  
**Finding:** introduces cascade layers.  
**Use:** optional CSS precedence architecture.  
**Limitation:** cascade layers are a mechanism, not a mandatory CSS methodology.

## PWA01 — W3C — Service Workers
**URL:** https://www.w3.org/TR/service-workers/  
**Status:** Candidate Recommendation Draft, 17 Sep 2026.  
**Use:** worker/network/offline mechanism.  
**Limitation:** lifecycle and browser behavior require real-platform testing.

## PWA02 — W3C — Web App Manifest
**URL:** https://www.w3.org/TR/appmanifest/  
**Status:** Working Draft, 13 Aug 2026.  
**Use:** install/application metadata.  
**Limitation:** install UX/support varies by platform/browser.

## I18N01 — Ecma International — ECMA-402, 13th edition, June 2026
**URL:** https://402.ecma-international.org/  
**Status:** finalized 2026 edition.  
**Use:** language-sensitive ECMAScript formatting/collation APIs.  
**Limitation:** application message/localization architecture still requires product-level design.

## I18N02 — W3C Internationalization — Structural markup and right-to-left text
**URL:** https://www.w3.org/International/questions/qa-html-dir  
**Finding:** use HTML `dir` for base direction and logical CSS for directional layout.  
**Use:** RTL/bidi correctness.

## TEST01 — Web Platform Tests
**URL:** https://web-platform-tests.org/  
**Finding:** cross-browser web-platform test suite designed to increase interoperable implementation confidence.  
**Use:** platform interoperability evidence.  
**Limitation:** not application-level correctness evidence.

## ARCH01 — Micro-frontend systematic mapping research
**Sources:**  
https://zenodo.org/records/14834868  
https://zenodo.org/records/12194330  
**Finding:** benefits/challenges depend on project/team complexity and careful architecture; large/complex contexts dominate motivation.  
**Use:** falsifies micro-frontends as universal frontend default.  
**Limitation:** heterogeneous emerging architecture literature; local organizational evidence matters.

---

# 50. V2 research/falsification audit incorporation

V2 incorporated the V1 adversarial audit rather than merely expanding V1.

## 50.1 Material corrections from V1

V2:

- removed score-like rendering comparisons;
- prevents applied SSR guidance from becoming universal architecture law;
- makes progressive enhancement outcome/context based;
- separates WCAG conformance from accessible usability;
- strengthens SPA title/focus/history/scroll contract;
- prohibits sensitive URL state;
- expands authoritative server-state consistency and async race handling;
- treats hydration mismatch as correctness;
- adds interaction-readiness;
- adds data-waterfall review;
- strengthens CWV scope limitation;
- rejects global bundle-size/Lighthouse laws;
- adds resource priority and long-session memory;
- strengthens bfcache/lifecycle rule;
- adds authenticated cache privacy;
- adds speculative fetch safety/economics;
- adds client-build secret rule;
- strengthens third-party script governance;
- makes CSP/Trusted Types/Permissions Policy status explicit;
- strengthens service-worker logout/update/recovery;
- separates Baseline from product support;
- requires real-browser evidence for browser semantics;
- raises design-system primitive assurance;
- covers component polymorphism semantics;
- separates input modality from viewport;
- expands i18n/time-zone/RTL testing;
- adds accessible authentication;
- adds source-map and RUM privacy policy;
- adds production-readiness gate;
- preserves `REVIEWED`, not `VALIDATED`.

## 50.2 Claims actively falsified

The V2 process attempted to falsify:

- SPA as default;
- SSR as default;
- CSR as inherently poor for discoverability;
- global state as scale solution;
- one state library for all state;
- accessibility automation sufficiency;
- ARIA as replacement for native behavior;
- CWV/Lighthouse as complete performance;
- fixed JS budget as universal;
- lazy loading/prefetch as universal wins;
- localStorage JWT as universal auth;
- CORS as security/authorization;
- CSP/Trusted Types as complete XSS solution;
- PWA/service worker as default;
- micro-frontends as maturity;
- one CSS architecture as best;
- maximum component reuse;
- test pyramid as law;
- DOM emulation as browser verification;
- i18n as translation only.

None survived as universal prescriptions.

## 50.3 What survived strongly

High-confidence durable principles:

- platform semantics before unnecessary custom behavior;
- explicit state/authority ownership;
- client is not security authority;
- native-first accessibility;
- human accessibility evaluation;
- requirement-driven rendering;
- real-user performance + lab diagnosis;
- status-aware browser/security standards;
- protocol-aware HTTP/cache behavior;
- real-browser verification for browser semantics;
- context-bound micro-frontends/PWA;
- internationalization as correctness;
- AI output independent verification.

---

# 51. Mechanical audit record

The V2 file MUST pass before release:

```text
- source/evidence IDs used have definitions
- no duplicate evidence ID definitions
- Markdown fences balanced
- no unresolved drafting markers
- headings structurally parse
- status remains REVIEWED
- evidence cutoff present
- draft specifications labeled
```

The generated artifact was mechanically checked after composition; see the delivery audit accompanying this file.

---

# 52. Validation debt and next tests

V2 should move from `REVIEWED` → `TESTED` only after representative scenario/non-author testing such as:

## Pilot A — Public content/commercial site
Test:

- semantic baseline;
- static/SSR decision;
- CWV field/lab;
- no-JS/progressive behavior where relevant;
- accessibility;
- third-party scripts;
- bfcache.

## Pilot B — Authenticated SaaS application
Test:

- CSR/hybrid route behavior;
- server-state cache;
- optimistic mutation;
- session/CSRF/authz;
- keyboard/focus SPA navigation;
- long-session memory;
- real-browser E2E.

## Pilot C — Offline-capable application
Test:

- service-worker update;
- offline read/write;
- conflict;
- account/logout cache lifecycle;
- bad-worker recovery;
- browser/platform differences.

## Pilot D — Shared design system
Test:

- native/custom primitive decisions;
- ARIA/keyboard/focus;
- polymorphism;
- RTL;
- cross-browser;
- version migration;
- defect blast radius.

For `VALIDATED`, the parent Master Playbook Standard still requires representative non-author field execution and closure/acceptance of material defects.

---

# Change log

## 2.0 — 2026-09-27
- research-reviewed V1;
- executed 76-item falsification/sanity audit;
- rebuilt rendering/state/accessibility/performance/security/lifecycle decisions;
- added status-aware 2026 source register;
- added production/readiness/test decision systems;
- retained framework neutrality;
- status set to `REVIEWED`.
