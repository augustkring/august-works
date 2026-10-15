# Digital Graphics, Illustration & Generative Visual Production Master Playbook — V2.1 Research-Audited Golden Master
## Evidence-weighted evergreen standard for visual communication and production across websites and applications

```yaml
document_id: DGV-01
title: Digital Graphics, Illustration & Generative Visual Production Master Playbook
version: 2.1-GOLDEN-MASTER
status: REVIEWED
release_label: Second-Pass Research & Falsification-Audited Golden Master
created: 2026-09-28
last_updated: 2026-09-28
evidence_cutoff: 2026-09-28
canonical_language: English
artifact_type: design_capability_playbook
primary_archetype:
  - capability
  - decision
  - execution
  - operating
  - assurance
research_rigor: R3_CONTROLLED
assurance_pass: SECOND_DEEP_RESEARCH_SANITY_AUDIT_2026-09-28
volatility:
  visual_communication_principles: MODERATE
  web_graphics_platform: FAST
  generative_image_models: VERY_FAST
  provenance_and_AI_transparency: FAST
  copyright_and_licensing: JURISDICTIONAL_FAST
  3d_asset_delivery: FAST
  image_codec_and_HDR: FAST
  asset_security_privacy: MODERATE_FAST
review_cadence: quarterly_plus_event_driven
next_scheduled_review: 2026-12-28
inherits:
  - Universal Design Principles Master Playbook V2.0
  - UX Master Playbook V2.0
  - UI Master Playbook V2.0
adjacent_standards:
  - Web & Frontend Engineering Master Playbook V2.0
  - Verification, Validation, Testing & Quality Engineering V2
  - Privacy & Data Protection Engineering V2
  - Universal Software & AI Engineering Master Playbook V2.0
requested_but_unavailable_foundation:
  - Digital Visual Design & Art Direction Master Playbook
source_gap_note: >
  The requested Digital Visual Design & Art Direction Master Playbook could not be retrieved from
  the current project uploads or personal Library during either the V2.0 construction pass or the
  V2.1 second-pass audit. No claims are attributed to that unavailable source. The Golden Master is
  structured so that source can be added later as an inherited art-direction overlay without changing
  the production architecture.
review_triggers:
  - WCAG successor becomes a final W3C Recommendation
  - material SVG, Canvas, CSS Color, WebGPU or browser graphics change
  - C2PA major/minor specification change
  - material EU AI Act Article 50 guidance or other applicable transparency change
  - material copyright/licensing precedent or statutory change affecting AI-assisted visuals
  - major GPT Image, Gemini/Nano Banana or other production-model generation change
  - representative field use reveals a recurring visual-production failure
  - glTF 2.1 becomes a final/stable baseline or KTX/glTF delivery semantics materially change
  - SVG 2 / SVG Accessibility API Mapping status materially changes
  - browser image-codec, wide-gamut or HDR support materially changes
  - material SVG/media-upload security guidance or exploit class changes
```

> **Lifecycle status.** `GOLDEN_MASTER` means this is the canonical research/falsification synthesis for this release. It is `REVIEWED`, not `VALIDATED`: representative non-author execution across real visual-production jobs and closure of material defects are still required before field validation.

---

# Executive standard

Digital graphics are not decoration added after product design. They are **designed representations of meaning, evidence, state, structure, process, identity or atmosphere** delivered through a technical medium.

A trustworthy visual-production system preserves this chain:

```text
VISUAL INTENT
→ COMMUNICATION JOB
→ TRUTH / MEANING CONTRACT
→ MEDIUM CHOICE
→ ART DIRECTION + REPRESENTATION DESIGN
→ GENERATION / CONSTRUCTION / CAPTURE
→ EDITING + COMPOSITING
→ IMPLEMENTATION
→ RESPONSIVE / LOCALIZED TRANSFORMATION
→ DELIVERY / PERFORMANCE
→ ACCESSIBILITY
→ SECURITY / PRIVACY / METADATA
→ PROVENANCE / RIGHTS
→ VISUAL QA
→ RELEASE
→ FIELD OBSERVATION + LEARNING
```

The governing doctrine is:

> **Choose the least complex visual medium that can faithfully express the intended meaning and required interaction; keep factual, semantic, brand, privacy, security and legal invariants deterministic when consequence demands it; use generative systems as probabilistic production tools rather than authorities; transform visuals for context instead of merely scaling them; and require evidence that the exact released artifact remains understandable, accessible, performant, safely handled, correctly licensed, traceable and visually intact in the real interface.**

The strongest durable conclusions are:

1. **Intent precedes medium.** A diagram, illustration, 3D scene, SVG, Canvas, generated image or screenshot is an implementation choice, not the problem definition.
2. **Representation quality is task-relative.** Visual beauty does not establish comprehension, truth, usability or trustworthiness.
3. **Clarity and hierarchy are production requirements.** Attention should be spent on the information and action that matter.
4. **Visual form and semantic meaning must agree.** Decorative resemblance is not explanatory accuracy.
5. **Facts, product UI, logos, legal copy, data and exact labels deserve deterministic treatment when correctness matters.**
6. **AI image systems are powerful generators/editors, not reliable databases, typesetters, brand guardians or rights authorities.**
7. **Editing is often superior to regeneration.** Once composition, identity or product geometry is correct, preserve it and modify only the failed dimension.
8. **Responsive graphics require art direction.** Reframing, simplification, reflow, re-labeling and alternate topology may be required; shrinking is not a responsive strategy.
9. **Accessibility is representation design.** Text alternatives alone cannot repair a visually ambiguous, color-dependent or motion-dependent graphic.
10. **The web platform has multiple graphics layers.** HTML/CSS, SVG, raster, Canvas, WebGL and WebGPU solve different jobs; there is no universal quality ladder.
11. **Vector is not automatically better than raster.** Pixel fidelity, complexity, runtime cost, interactivity, scale, editing workflow and semantics decide.
12. **A screenshot is evidence only with context.** Version, state, crop, data freshness and manipulation history matter.
13. **A generated product screenshot is not product proof.** Use real UI or explicitly mark a concept visualization.
14. **Data visuals optimize comparison and interpretation, not spectacle.** Exact values, uncertainty and honest scales remain first-class.
15. **Icons compress meaning only when the audience can decode them.** Ambiguous icons need labels or surrounding context.
16. **Motion must have a job.** Orientation, causality, continuity, hierarchy and state change are stronger reasons than decorative activity.
17. **Performance includes download, decode, rasterization, layout, paint, GPU, memory and battery—not file size alone.**
18. **Color is managed, not assumed.** sRGB, Display P3, profiles, gamut mapping and device variation can change the delivered result.
19. **Provenance is evidence about origin/history, not proof of truth, ownership or correctness.**
20. **Rights are an input constraint.** Source license, derivatives, commercial use, attribution, likeness, trademark, model/provider terms and jurisdiction must be known before release when material.
21. **Visual QA is multi-method.** Automated regression and linting catch drift; humans must still judge meaning, factual accuracy, crop, generated anomalies, brand fit and legal/contextual risk.
22. **Fast-changing tools belong in versioned implementation profiles, not the evergreen core.**
23. **The final rendered asset is a release artifact.** Regenerating from the same prompt is not a reproducible build; retain the accepted bytes/hash and transformation record.
24. **Asset pipelines are security and privacy boundaries.** SVG, uploaded media, screenshots, reference images and embedded metadata can carry active content, secrets or personal data.
25. **Metadata has competing duties.** Privacy-sensitive metadata may need minimization while rights, provenance, orientation and color metadata may need preservation; “strip all” and “preserve all” are both weak defaults.
26. **3D authoring assets and runtime delivery assets are different products.** Geometry, textures, materials, LOD, compression, scene composition and fallbacks require an explicit delivery contract.
27. **Wide gamut and HDR are separate maturity decisions.** Display P3 can be a progressive enhancement; web HDR remains a fast-moving implementation layer and needs brightness/accessibility/fallback QA.
28. **Complex graphics need structured alternatives, not a single prose blob.** Tables, headings, lists or equivalent structured HTML often preserve relationships better than long unstructured descriptions.
29. **Generated human/social imagery needs representation QA proportional to consequence.** Evaluate the deployed prompt/model/revision workflow, not only the base model.
30. **Machine-readable equivalents are valuable when a visual carries durable facts.** Preserve underlying text/data/relationships separately from pixels so search, assistive technology, automation and future transformations do not depend on visual inference alone.

---

# V2.1 second-pass research & falsification verdict

V2.1 is a **deep audit of V2.0**, not a rewrite for novelty. The review re-read the complete Golden Master, re-searched the unavailable requested art-direction foundation, and challenged the document against current browser/platform specifications, accessibility guidance, security guidance, 3D delivery standards, image-format status, provenance specifications, generative-image platform documentation, 2026 AI transparency material and newer empirical visual/HCI evidence.

The result is:

> **`PASS_WITH_MATERIAL_REVISIONS`**

No architecture-breaking defect was found. The V2.0 chain — intent → medium → construction → implementation → delivery → QA — remains strong. The audit did, however, find places where the standard could create false assurance because a production boundary was named without enough implementation depth.

## V2.1 audit method

The second pass tried to falsify V2.0 using these questions:

1. Can a team follow the rule and still ship a misleading or inaccessible visual?
2. Can a team follow the rule and still leak sensitive data through capture, reference input or metadata?
3. Can a team select the right runtime but ship the wrong/heavy 3D asset architecture?
4. Does the standard distinguish stable web baselines from drafts and emerging formats?
5. Does “AI provenance” survive ordinary redistribution and editing assumptions?
6. Does model/prompt recording actually reproduce the released image?
7. Are diagram rules adequate for dense networks rather than only small explanatory diagrams?
8. Does the accessibility layer preserve structure for complex charts/diagrams?
9. Does the color layer distinguish wide gamut from HDR maturity?
10. Does the AI visual workflow evaluate representation risk at the **system-as-deployed** level?
11. Can rights metadata be accidentally destroyed by a blanket privacy optimization?
12. Are current EU transparency and provider implementation profiles represented with correct status boundaries?

## Material findings and V2.1 disposition

| ID | Severity | V2.0 weakness | Why it matters | V2.1 correction |
|---|---|---|---|---|
| `V21-01` | MAJOR | 3D runtime guidance existed without a full 3D asset-delivery contract | Geometry/textures/materials/compression often dominate payload, memory and visual correctness | Add master-vs-delivery separation, glTF/KTX guidance, LOD/compression budgets, scene validation and fallback rules |
| `V21-02` | MAJOR | SVG sanitization was correct but too compact | SVG can contain active/scripted/external-resource behavior depending on context | Add explicit trusted/untrusted SVG threat boundary and upload rewrite/sanitization requirements [SVG-SEC-MDN][OWASP-IMG-VALIDATION] |
| `V21-03` | MAJOR | Screenshot guidance emphasized rights/accuracy more than privacy/security | Captures can expose personal data, credentials, tenant data, internal URLs and notification content | Add capture/redaction/sanitization gate before external sharing or model upload [OWASP-SCREENSHOT] |
| `V21-04` | MAJOR | Metadata handling lacked a conflict model | Removing all metadata can destroy rights/provenance/color; keeping all can leak location/device/private data | Add four-lane metadata policy: privacy/security, rights/credit, provenance, rendering/color [GOOGLE-IMG-META] |
| `V21-05` | MAJOR | Prompt/model records could be mistaken for reproducibility | Probabilistic generation and provider-side prompt revision mean the same request need not reproduce identical bytes | Treat accepted output bytes/hash as the release artifact; record provider-revised prompt when exposed |
| `V21-06` | MAJOR | Representation-bias review was checklist-level | Current research documents stereotype and representation differences across text-to-image systems/workflows | Add risk-proportional slice/system evaluation for human/social imagery [T2I-BIAS-2026A][T2I-BIAS-2026B][NIST-GENAI] |
| `V21-07` | MAJOR | Complex-image accessibility could be read as “write a longer alt” | WAI guidance supports short + structured long alternatives; unstructured `aria-describedby` can lose table/heading navigation | Require structured HTML/table equivalents when structure matters [WAI-COMPLEX] |
| `V21-08` | MAJOR | SVG accessibility could imply a mature mapping baseline | SVG AAM is a 24 Sep 2026 Working Draft and explicitly warns it contains outdated information/errors | Treat direct SVG accessibility mappings as implementation-sensitive and test real browser/AT combinations [SVG-AAM-2026] |
| `V21-09` | MODERATE | Dense system/network maps lacked topology/task selection guidance | Node-link readability degrades with density for many tasks; matrix/tabular alternatives can outperform it contextually | Add density/task gate and alternate representations; do not universalize numeric thresholds [GRAPH-MATRIX-2004] |
| `V21-10` | MODERATE | Wide-gamut/HDR were too close conceptually | CSS Color HDR is still Working Draft; HDR brightness adds distinct compatibility/accessibility concerns | Keep sRGB baseline, treat P3 as progressive enhancement and HDR as emerging/version-sensitive [CSS-HDR-2026] |
| `V21-11` | MODERATE | Raster profile omitted JPEG XL maturity status | JXL has valuable capabilities but non-universal browser support | Add contextual JXL option with fallback; preserve asset-specific measurement [MDN-IMAGE-FORMATS] |
| `V21-12` | MODERATE | Resource priority language did not clearly separate discovery from priority | `preload` and `fetchpriority` solve different problems and overuse can compete with critical resources | Add explicit discovery-vs-priority decision [WEBDEV-FETCHPRI] |
| `V21-13` | MODERATE | C2PA was framed primarily as embedded metadata | Distribution/editing can strip manifests; C2PA 2.4 also supports durable-content-credential patterns/soft binding | Add preservation/re-sign/recovery strategy; never claim persistence without verification [C2PA-DURABLE-2.4] |
| `V21-14` | MODERATE | EU Article 50 overlay did not distinguish the final June 2026 Code of Practice status | Current compliance implementation context changed after V2.0 source synthesis | Record final Code publication separately from binding law and Commission guidelines [EU-AI-CODE-2026] |
| `V21-15` | MODERATE | Motion section could be read as a maturity ladder toward animation | Recent synthesis reinforces strong benefits of text+diagram/signaling while richer animation effects remain context-dependent | Add “static first when time is not the encoded variable” and signaling evidence [MULTIMEDIA-META-2025][SIGNAL-META-2018] |
| `V21-16` | MODERATE | Search/automation extractability was implicit | Pixels alone are weak durable carriers of facts for AT, search, localization, analytics and future agents | Add structured-data/text equivalence for durable informational graphics |

## What V2.0 got right and V2.1 retains unchanged

- intent before medium;
- truth contract before visual polish;
- deterministic treatment of consequential facts/UI/logos/data;
- edit/composite over regeneration when invariants are already correct;
- responsive transformation rather than shrinking;
- HTML/CSS/SVG/raster/Canvas/GPU as contextual layers rather than a prestige ladder;
- accessibility as representation architecture;
- performance beyond byte size;
- provenance as origin/history evidence rather than truth;
- rights as an input constraint;
- automated + human visual QA;
- volatile provider/model facts isolated in implementation profiles.

## New V2.1 doctrine

The second pass adds one production principle above all others:

> **The governed object is not the source prompt, Figma frame, SVG source, Blender scene or generator session. It is the exact delivered visual system — its bytes/assets, semantic alternative, runtime behavior, metadata/provenance, rights state and observed behavior in context.**

# PART I — V1 CANDIDATE STANDARD

# 1. V1 research question

**Primary question**

> What production system best turns a visual communication need into a high-quality, accessible, performant and maintainable digital graphic or illustration across modern websites and apps, including AI-generated and code-native media, without turning one style, tool or rendering technology into dogma?

**Subquestions**

1. What makes a digital visual correct relative to its communication job?
2. How should teams choose among HTML/CSS, SVG, raster, Canvas, WebGL/WebGPU, 3D, video and generative imagery?
3. Which visual types require different representation rules?
4. How should generative-image systems be art-directed, edited and quality-controlled?
5. What information should a production prompt/art-direction specification contain?
6. How should graphics transform across responsive layouts and locales?
7. What accessibility obligations change for diagrams, charts, icons, images, motion and interactive graphics?
8. How should image format, compression, decoding, rendering and runtime cost be engineered?
9. How should color, provenance, content credentials, rights and licensing be governed?
10. Which common graphics “best practices” fail when challenged across real production contexts?

# 2. V1 evidence model

V1 used six evidence lanes:

- **Inherited design standards** — visual hierarchy, attention, comprehension, usability, UI state and accessibility.
- **Normative web/accessibility standards** — WCAG, WHATWG HTML, W3C graphics/CSS specifications.
- **Empirical visual/HCI research** — graphical perception, signaling, aesthetics and comprehension.
- **Official platform/model documentation** — exact current capabilities and limitations of image-generation and browser graphics technologies.
- **Provenance/licensing authorities** — C2PA, ICC, Creative Commons, applicable legal/regulatory sources.
- **Production synthesis** — contextual implementation patterns tested against failure modes.

No model vendor, design tool, illustration style or frontend library is treated as a universal authority.

# 3. V1 candidate doctrine

V1 proposed:

```text
BRIEF
→ PICK MEDIUM
→ MAKE VISUAL
→ EXPORT
→ PLACE IN PRODUCT
→ TEST
```

It also proposed 36 candidate rules:

1. Start with the message, not the medium.
2. Use visual hierarchy to create one dominant reading path.
3. Prefer SVG for scalable illustrations and diagrams.
4. Prefer raster for photography and painterly detail.
5. Prefer HTML/CSS for UI-adjacent graphics.
6. Prefer Canvas for dynamic 2D graphics.
7. Prefer WebGL/WebGPU for real-time 3D and GPU-heavy visuals.
8. Use AI image generation for ideation and illustration where exact factual fidelity is not required.
9. Keep exact text, brand marks and product UI outside generative pixels when practical.
10. Use image editing/reference workflows to preserve approved compositions.
11. Use reference images to maintain subject, style and brand consistency.
12. Separate art direction from prompt syntax.
13. Generate multiple candidates before convergence.
14. Use low-cost/fast modes for drafts and higher-quality modes for finalists.
15. Build diagrams around relationships, not decoration.
16. Use explicit directionality for processes.
17. Use data encodings that support the comparison task.
18. Label unfamiliar icons.
19. Use real screenshots for product proof.
20. Transform rather than simply shrink complex visuals on mobile.
21. Provide text alternatives for meaningful non-text content.
22. Do not rely on color alone.
23. Respect reduced-motion preferences for non-essential motion.
24. Localize graphics, not only surrounding text.
25. Use responsive image selection and art direction for raster assets.
26. Avoid lazy-loading the critical LCP image.
27. Control intrinsic dimensions to avoid layout shift.
28. Select image format from content and delivery constraints.
29. Define a color-management baseline.
30. Preserve provenance metadata where it carries product, legal or trust value.
31. Track source rights and model/provider terms.
32. Run visual regression for important UI graphics.
33. Run human visual QA at representative sizes and devices.
34. Treat generated visuals as untrusted until reviewed.
35. Keep volatile model/tool guidance outside the evergreen core.
36. Revalidate visuals when content, product UI, data, brand or delivery technology materially changes.

---

# PART II — ADVERSARIAL / FALSIFICATION AUDIT OF V1

# 4. Audit method

V1 was challenged against:

- low-content marketing sites;
- dense SaaS applications;
- product documentation;
- high-trust enterprise/financial/health contexts;
- localized/RTL interfaces;
- low-end mobile devices and slow networks;
- accessibility with screen readers, low vision and motion sensitivity;
- high-density data visualization;
- live dashboards;
- 2D/3D interactive experiences;
- AI-generated editorial/brand illustration;
- AI-edited product photography;
- product screenshots and concept mockups;
- content provenance/transparency requirements;
- commercial licensing and derivative-work constraints.

The audit asked:

1. Is the rule truly universal?
2. Can the source establish that exact claim?
3. Does the rule confuse a format with a quality outcome?
4. Does it survive mobile, localization and accessibility constraints?
5. Can it create false factual/brand/legal confidence?
6. Does it account for runtime performance, not only exported bytes?
7. Can an AI system satisfy the wording while defeating the intent?
8. Does it remain valid if the named vendor/model changes next quarter?

# 5. Falsification findings

| ID | V1 assumption / common claim | Finding | Severity | V2 correction |
|---|---|---|---|---|
| A01 | “SVG is the best format for illustrations.” | False as a universal claim. Highly detailed/painterly vectors can be heavier and slower to render than a well-compressed raster. | MAJOR | Choose from semantics, fidelity, complexity, runtime and editing requirements. |
| A02 | “Vector means responsive.” | False. A vector can still have unreadable labels, excessive density or a topology that collapses on narrow screens. | BLOCKER | Responsive art direction is a separate design obligation. |
| A03 | “Canvas is inaccessible.” | Too absolute. Canvas can expose fallback/parallel semantic content and mapped controls, but the burden is higher. | MAJOR | Treat Canvas as semantics-poor by default; require an accessibility architecture. |
| A04 | “WebGPU is the modern default for advanced graphics.” | Premature. At the cutoff WebGPU remains a W3C Candidate Recommendation Draft. | MAJOR | Treat WebGPU as capability-driven and compatibility-sensitive; preserve fallback/feature detection. |
| A05 | “CSS graphics are always lighter/faster.” | False. Complex filters, masks, many DOM nodes or repeated effects can increase paint/compositing cost. | MAJOR | Measure total runtime cost; use CSS for simple declarative form. |
| A06 | “Inline every SVG for performance.” | False. Large inline SVG increases HTML/DOM cost and loses independent caching. | MODERATE | Inline when styling/interaction/critical-path benefit justifies it; externalize otherwise. |
| A07 | “Raster always means photo.” | False. Raster may be optimal for generated illustration, texture, complex painting, flattened compositing or stable diagram snapshots. | MINOR | Format follows required behavior and fidelity. |
| A08 | “AVIF is always the best web format.” | False. Compression, encode cost, decode behavior, transparency, tooling and content type matter. | MAJOR | Test AVIF/WebP/JPEG/PNG against actual assets and target browsers. |
| A09 | “Higher resolution is always better.” | False. Oversized sources cost bandwidth/memory/decode and may not improve rendered output. | MAJOR | Deliver enough pixels for the rendered density, not the largest available file. |
| A10 | “One master image can be cropped everywhere.” | False when crop changes subject salience, proof, text safety or narrative. | MAJOR | Produce breakpoint/aspect-ratio art-direction variants where needed. |
| A11 | “Prompt engineering can lock brand consistency.” | False as an assurance mechanism. Probabilistic outputs drift. | BLOCKER | Use references, edit workflows, deterministic overlays, QA and reusable style constraints. |
| A12 | “More prompt adjectives create more control.” | Often false. Overloaded prompts can create conflicting constraints and make failures hard to diagnose. | MODERATE | Use a structured visual specification and iterate one axis at a time. |
| A13 | “Regenerate until it looks right.” | Wasteful and can destroy already-correct geometry/identity. | MAJOR | Prefer local edits/masks/reference-preserving changes after convergence. |
| A14 | “AI-generated text is production-ready if legible.” | False for consequential copy. Spelling, punctuation, brand names, localization and updates still require verification. | BLOCKER | Keep essential text deterministic unless generation is specifically validated. |
| A15 | “Generated screenshots are acceptable product proof.” | False and potentially deceptive. | BLOCKER | Use real UI capture/live HTML for proof; label conceptual mockups. |
| A16 | “Photorealism increases credibility.” | Not universally. Realism can intensify deception, uncanny cues or false evidentiary interpretation. | MAJOR | Match realism to the communication and truth contract. |
| A17 | “Generated people make a brand more human.” | Unsupported as a universal rule and introduces representation/stereotype/likeness risk. | MODERATE | Use people only when the communication job benefits; control representation and rights. |
| A18 | “3D makes complex systems easier to understand.” | False as a default. Perspective/occlusion can reduce comparison and structural clarity. | MAJOR | Use depth only when depth carries meaning or experience value. |
| A19 | “Every diagram should be interactive.” | False. Interaction can hide information and add accessibility/cognitive cost. | MODERATE | Use interaction only when it enables a real task such as inspection, filtering or navigation. |
| A20 | “Minimal diagrams are always clearer.” | False when simplification removes causal, boundary or exception information. | BLOCKER | Minimize irrelevant detail, not necessary semantics. |
| A21 | “Color coding is enough to distinguish series/states.” | Fails accessibility and can fail printing/display conditions. | BLOCKER | Add labels, shapes, patterns, position or other redundant cues as needed. |
| A22 | “Alt text fixes graphic accessibility.” | False. Complex data/process graphics often require structural text, tables or long descriptions; interactive graphics need operable alternatives. | BLOCKER | Design accessible representation and alternatives from the brief. |
| A23 | “No text should ever appear inside images.” | Too absolute. Screenshots, diagrams and essential visual text can be legitimate. | MODERATE | Prefer real text where feasible; where visual text is essential, provide equivalent accessible/localized treatment. |
| A24 | “Motion makes interfaces feel premium.” | Style claim, not a reliability principle; can distract or harm motion-sensitive users. | MAJOR | Motion requires a communication/state job and reduced-motion behavior. |
| A25 | “GIF is the safe universal animated-graphics format.” | Outdated as a general default; file efficiency, color and control limitations can be severe. | MODERATE | Choose CSS/Web Animations, video, animated WebP/AVIF or other mechanisms from the job and support matrix. |
| A26 | “Lottie is the standard solution for UI motion.” | Tool-specific and runtime-dependent. | MODERATE | Treat vector animation runtimes as contextual implementation choices. |
| A27 | “Hex colors define brand color.” | Incomplete across sRGB/P3/print/display pipelines. | MAJOR | Define color space/profile and fallbacks, not only numeric triples. |
| A28 | “Wide gamut is always more premium.” | False. It can create clipping, inconsistency and QA complexity. | MODERATE | Use wide gamut when the visual benefit and delivery pipeline justify it. |
| A29 | “C2PA/Content Credentials prove an image is true.” | False. They describe provenance/history claims and verification status, not semantic truth or legal ownership. | BLOCKER | Treat provenance as one evidence layer. |
| A30 | “Machine-readable provenance satisfies disclosure.” | False in contexts requiring human-perceivable disclosure; EU Article 50 guidance explicitly distinguishes the deployer disclosure duty. | BLOCKER | Maintain separate machine-readable provenance and visible/contextual disclosure controls. |
| A31 | “If the generator lets you make it, you can use it commercially.” | False. Service capability is not a rights opinion. | BLOCKER | Run a rights/license/likeness/trademark gate. |
| A32 | “AI output is automatically copyrightable.” | Not universally and jurisdiction varies; U.S. guidance requires sufficient human authorship. | BLOCKER | Do not assume exclusivity; record human contribution and jurisdictional advice where material. |
| A33 | “Visual regression equals visual QA.” | False. Pixel diffs do not assess meaning, accuracy, aesthetics, crop quality or generated anomalies. | BLOCKER | Combine automated and human QA. |
| A34 | “Screenshots are objective truth.” | False without version/state/crop context; they may contain stale or sensitive data. | MAJOR | Record source build/version/state and sanitize intentionally. |
| A35 | “Seed + prompt guarantees reproducibility.” | Vendor/model dependent and often false across model/runtime updates. | MAJOR | Treat generated assets as versioned outputs; store the accepted artifact, inputs and generation context. |
| A36 | “The source file is the deliverable.” | False. Final quality is what ships through CDN/browser/device/localization/runtime. | BLOCKER | QA the delivered artifact in the actual product surface. |

# 6. Audit verdict

V1's core direction survived, but the audit forced a stricter separation between:

```text
DURABLE PRINCIPLE
  intent, truth, hierarchy, semantics, accessibility, performance, rights, QA

CONTEXTUAL MEDIUM
  HTML/CSS, SVG, raster, Canvas, WebGL, WebGPU, video, 3D

VOLATILE TOOL
  generator/model name, editor, plugin, image CDN, browser feature, provenance implementation
```

The central correction is:

> **A visual asset is not correct because the source file looks good. It is correct only when the delivered representation preserves its intended meaning, truth, usability, accessibility, brand, performance and rights constraints in the actual context of use.**

---

# PART III — V2.1 GOLDEN MASTER

# 7. Scope and boundaries

## 7.1 In scope

This playbook governs:

- visual communication for websites and applications;
- diagrams and explanatory graphics;
- system maps and architecture/product maps for external or internal use;
- process, workflow and lifecycle graphics;
- conceptual and editorial illustration;
- product visuals and product-story graphics;
- screenshots, UI captures and device/browser mockups;
- icons, symbols and visual signifiers;
- data visualization and informational graphics;
- AI-generated and AI-edited still images;
- text-to-image, image-to-image, compositing, inpainting, outpainting and reference-based workflows;
- prompt and art-direction specifications;
- SVG;
- CSS-native graphics;
- HTML-native graphics;
- Canvas and OffscreenCanvas;
- WebGL/WebGPU and browser 3D graphics;
- 3D runtime asset delivery, scene packaging, geometry/texture/material budgets, compression and LOD;
- motion graphics at the visual-production layer;
- raster image formats, export and compression;
- hybrid visual workflows;
- responsive visual transformation;
- accessibility of meaningful graphics;
- localization and RTL/cultural adaptation;
- visual performance and resource cost;
- color management and wide-gamut decisions;
- asset capture/redaction, media-upload/SVG minimum security controls and metadata hygiene;
- provenance, Content Credentials and synthetic-content labelling interfaces;
- rights, licensing, likeness and asset-governance controls;
- visual QA, regression and release.

## 7.2 Out of scope as primary authority

This playbook does not replace:

- end-to-end UX research/process;
- general UI component behavior;
- full visual brand identity strategy;
- photography production and cinematography manuals;
- video production as a full discipline;
- game graphics/engine architecture;
- 3D modeling/sculpting/rigging specialist manuals;
- legal advice about copyright, publicity, trademark or AI regulation;
- full application-security engineering for untrusted media pipelines beyond the minimum asset controls defined here;
- full frontend engineering;
- a vendor-specific image-generation manual.

It defines the production boundary and routes to those specialist domains when deeper authority is required.

# 8. Inherited design principles

This playbook directly inherits three accessible foundations.

## 8.1 Universal Design Principles V2

The parent standard establishes:

```text
NOTICE
→ ORIENT
→ UNDERSTAND
→ BELIEVE
→ REMEMBER
→ WANT / CARE
→ KNOW WHAT TO DO
→ ACT
```

It also establishes that hierarchy, grouping, legibility, contrast, relevance and controlled complexity are stronger foundations than aesthetic folklore, and that data graphics should optimize interpretation/comparison rather than visual spectacle.

## 8.2 UX Master Playbook V2

The UX parent requires graphics to support the customer's real outcome and context, minimize unnecessary interpretation, preserve control, and localize beyond literal translation.

## 8.3 UI Master Playbook V2

The UI parent requires appearance, semantics, state and behavior to agree, and treats responsiveness, localization, accessibility and performance as concerns across the entire system representation.

## 8.4 Unavailable requested foundation

`Digital Visual Design & Art Direction Master Playbook` was explicitly requested but could not be retrieved in either the V2.0 construction pass or the V2.1 second-pass search. V2.1 therefore **does not infer its contents**. The sections on art direction below are a fresh research/production synthesis and should be reconciled against that playbook if it is later supplied.

---

# 9. Evidence, rule and confidence model

## 9.1 Claim classes

| Label | Meaning |
|---|---|
| `REQ` | Applicable external requirement in the stated scope |
| `EST` | Well-established cross-source principle/mechanism |
| `DEF` | Recommended default |
| `CTX` | Context-dependent practice |
| `EMG` | Emerging / fast-moving practice |
| `HOUSE` | Deliberate production standard synthesized here |
| `EXP` | Hypothesis to validate locally |
| `UNK` | Material unresolved question |

## 9.2 Evidence lanes

| Lane | Strongest legitimate use |
|---|---|
| Formal accessibility/web standard | conformance, semantics, exact platform contract |
| Peer-reviewed/meta evidence | perception, comprehension, performance mechanisms |
| Official browser/platform/model docs | exact current capability and constraints |
| Provenance/color technical standard | interoperability and metadata semantics |
| Law/regulator guidance | scoped legal obligation |
| Mature production evidence | implementation mechanism and failure modes |
| Local product evidence | whether a visual works for this audience/product |

## 9.3 Normative language

- **MUST / MUST NOT** — mandatory within this house standard unless explicitly marked external `REQ`.
- **SHOULD / SHOULD NOT** — strong default with contextual exceptions.
- **MAY** — optional/contextual mechanism.
- **JUDGMENT REQUIRED** — the correct choice depends on context and must not be faked as a universal rule.

## 9.4 Source-fit rule

Use the source that can answer the claim:

```text
accessibility conformance → WCAG / WAI / platform semantics
web rendering semantics  → WHATWG / W3C / Khronos
model behavior            → current official model docs + local evals
visual perception         → controlled / replicated HCI & perception research
color profile semantics   → ICC / CSS Color
provenance                → C2PA + implementation docs
legal obligation          → applicable law / regulator / qualified counsel
production fit            → local QA, telemetry, user evidence
```

A model vendor is authoritative about its current API, not about universal visual-design quality. A design study can support a perception mechanism, not a browser implementation detail.

---

# 10. The Visual Production Contract

Every material visual SHOULD have a recoverable production contract before medium/tool selection.

```yaml
visual_id:
owner:
product_surface:
release_or_campaign:

intent:
  communication_job: notice|orient|explain|compare|prove|persuade|remember|navigate|show_state|delight
  audience:
  audience_state:
  question_the_visual_must_answer:
  desired_takeaway:
  desired_next_action:
  unacceptable_misinterpretations: []

truth_contract:
  factual_claims: []
  data_source:
  product_state_source:
  exact_text_required: []
  exact_brand_assets_required: []
  visual_metaphor_limitations: []
  concept_or_real: real|representative|concept|editorial
  structured_source_of_truth:
  machine_readable_equivalent:

art_direction:
  concept:
  dominant_subject:
  hierarchy:
  composition:
  spatial_model: flat|layered|isometric|perspective|3d
  form_language:
  palette:
  lighting:
  texture_material:
  image_style:
  typography_role:
  motion_role:
  brand_invariants: []
  anti_references: []

medium_constraints:
  responsive_contexts: []
  interaction:
  update_frequency:
  runtime_data:
  localization_locales: []
  rtl_required: false
  dark_mode: false
  print_or_export: false
  untrusted_asset_input: false
  third_party_model_upload: false

accessibility:
  decorative_or_meaningful:
  short_text_alternative:
  long_description_or_table:
  non_color_redundancy:
  reduced_motion_behavior:
  keyboard_or_AT_model:

security_privacy_metadata:
  data_classification:
  screenshot_or_reference_redaction_required: false
  secrets_or_internal_identifiers_reviewed: false
  svg_or_media_sanitization:
  privacy_metadata_policy:
  rights_credit_metadata_policy:
  technical_color_orientation_metadata_policy:

performance:
  role: critical|supporting|decorative
  target_render_sizes: []
  byte_budget:
  cpu_gpu_budget:
  lcp_candidate: false

provenance_and_rights:
  source_assets: []
  generated_or_edited_by_AI: false
  model_tool_version:
  references_and_licenses: []
  likeness_or_trademark_review:
  C2PA_or_other_provenance:
  manifest_preservation_or_recovery:
  visible_AI_disclosure_required:
  accepted_artifact_sha256:
  provider_revised_prompt_if_exposed:

acceptance:
  semantic_tests: []
  visual_tests: []
  responsive_tests: []
  accessibility_tests: []
  performance_tests: []
  rights_approval:
  security_privacy_approval:
  exact_delivered_artifact_hash:
```

For low-risk decorative graphics, use a compact subset. For product proof, data, security/compliance diagrams, regulated material, or synthetic depictions of real people/events, use the full contract.

---

# 11. V2.1 Golden Visual Production Standards

## 11.1 Intent, truth and representation

1. `EST / HIGH` **Define the communication job before selecting a medium or visual style.**
2. `EST / HIGH` **Every material visual MUST answer a named user/viewer question.**
3. `EST / HIGH` **Separate factual representation, conceptual metaphor and decorative atmosphere.** Do not let one silently pose as another.
4. `HOUSE / HIGH` **Record unacceptable interpretations for high-consequence visuals.**
5. `EST / HIGH` **Do not use decorative complexity to simulate explanatory depth.**
6. `EST / HIGH` **Preserve necessary semantic detail even when simplifying.** Minimalism is not permission to remove causality, exception, boundary, uncertainty or state.
7. `DEF / HIGH` **Use visual-verbal signaling to connect labels and graphic elements when mapping would otherwise consume attention.**
8. `EST / HIGH` **For data/product evidence, truth outranks visual drama.**
9. `HOUSE / HIGH` **A generated, composited or stylized asset MUST NOT be presented as direct product/documentary evidence unless the truth contract permits that interpretation.**
10. `DEF / MODERATE` **Use one dominant idea or comparison per graphic unless the task explicitly requires a system overview.**

## 11.2 Medium selection

11. `EST / HIGH` **Choose the least complex medium that satisfies semantics, fidelity, interaction, update, responsiveness and performance.**
12. `DEF / HIGH` **Prefer HTML/CSS when the visual is fundamentally structured content, text, layout or simple state.**
13. `DEF / HIGH` **Prefer SVG when scalable vector geometry, crisp paths, accessible labels or DOM-level styling/interactivity materially help.**
14. `CTX / HIGH` **Prefer raster when pixel-rich visual detail, photography, generated artwork, texture or flattened compositing dominates.**
15. `CTX / HIGH` **Use Canvas when a bitmap drawing surface, high-frequency dynamic 2D rendering or many transient primitives justify losing native DOM semantics.**
16. `CTX / HIGH` **Use WebGL/WebGPU/3D only when GPU/3D capability buys a named outcome that simpler media cannot provide adequately.**
17. `CTX / HIGH` **Use video for temporally authored, cinematic or continuous-frame visuals when interactive state is not required.**
18. `DEF / HIGH` **Hybrid solutions MAY combine semantic HTML with SVG/Canvas/WebGL presentation; do not force one layer to do every job.**

## 11.3 Art direction

19. `EST / HIGH` **Art direction begins with meaning, audience and category context—not adjectives like “premium,” “futuristic” or “clean.”**
20. `HOUSE / HIGH` **Translate abstract traits into observable visual decisions and known risks.**
21. `DEF / HIGH` **Specify hierarchy, composition and subject placement before surface texture and micro-style.**
22. `DEF / MODERATE` **Use references by role—content, composition, style, color, subject identity, material—not as an undifferentiated moodboard.**
23. `DEF / MODERATE` **Include anti-references or prohibited interpretations when drift risk is high.**
24. `EST / HIGH` **Keep category comprehension and brand distinctiveness in productive tension; novelty is not value by itself.**

## 11.4 Generative visual production

25. `EST / HIGH` **Treat generative output as candidate production material until reviewed.**
26. `HOUSE / HIGH` **Keep consequential facts, exact UI, logos, data, legal copy and critical typography deterministic unless generation has been explicitly validated for the exact use.**
27. `DEF / HIGH` **Use generative systems strongly for ideation, conceptual illustration, environment/texture development, art-direction exploration, reference-preserving edits and compositing.**
28. `DEF / HIGH` **Prefer edit/inpaint/composite over full regeneration once important invariants are correct.**
29. `DEF / HIGH` **Make one-axis edits when diagnosing drift: composition, subject, palette, lighting, texture, copy or detail—not everything at once.**
30. `DEF / HIGH` **Generate variants deliberately against distinct hypotheses, not ten near-duplicates.**
31. `HOUSE / HIGH` **Record accepted output artifact, prompt/spec, model/tool version and reference inputs for material production assets.**
32. `CTX / MODERATE` **Seeds and sampling parameters MAY support local repeatability but MUST NOT be treated as durable cross-version reproducibility guarantees.**
33. `HOUSE / HIGH` **AI-generated images containing real-person likeness, factual event depiction or high-trust evidence require elevated review and disclosure analysis.**

## 11.5 Diagrams, maps and process graphics

34. `EST / HIGH` **Encode relationships explicitly: direction, containment, sequence, ownership, dependency, feedback or hierarchy must be distinguishable.**
35. `EST / HIGH` **Do not draw a connection that does not mean something.**
36. `DEF / HIGH` **Use visual channels consistently: one shape/color/line grammar should not change meaning mid-graphic.**
37. `DEF / HIGH` **Label boundaries and exceptional paths when they change understanding.**
38. `DEF / HIGH` **Use whitespace as separation and grouping, not as a substitute for labels when ambiguity remains.**
39. `HOUSE / HIGH` **System maps MUST distinguish canonical truth from conceptual grouping when the graphic could be mistaken for architecture documentation.**

## 11.6 Product visuals and screenshots

40. `EST / HIGH` **Use real product UI for proof.**
41. `HOUSE / HIGH` **Record product/build/version/state for screenshots used as durable documentation or evidence.**
42. `DEF / HIGH` **Remove or anonymize sensitive/customer data before distribution.**
43. `DEF / MODERATE` **Use device/browser chrome only when it adds useful context; do not spend visual area on decorative mockup frames by default.**
44. `HOUSE / HIGH` **Concept UI MUST be labeled internally and, when audience interpretation requires, externally as concept/representative rather than live product.**
45. `DEF / HIGH` **Use HTML-native product demos instead of raster screenshots when responsiveness, localization or interaction materially improves comprehension and the maintenance cost is justified.**

## 11.7 Icons and symbols

46. `EST / HIGH` **Icons are semantic compression, not decoration.**
47. `DEF / HIGH` **Label unfamiliar or high-consequence icons.**
48. `DEF / HIGH` **Maintain a coherent icon grammar: stroke/fill, optical size, corners, perspective and detail.**
49. `EST / HIGH` **Do not rely on culturally ambiguous symbols without locale review.**
50. `HOUSE / HIGH` **Functional icon assets MUST expose an accessible name through the surrounding control/markup; the glyph itself is not the accessible contract.**

## 11.8 Data visualization

51. `EST / HIGH` **Choose encodings from the comparison/analysis task, not from novelty.**
52. `EST / HIGH` **Position on a common scale and length are generally stronger for precise quantitative comparison than angle/area/volume.**
53. `EST / HIGH` **Do not use 3D perspective when it distorts quantitative reading unless depth is data.**
54. `EST / HIGH` **Color alone MUST NOT carry a required distinction.**
55. `HOUSE / HIGH` **Material charts SHOULD expose underlying values through labels, accessible table/data view or equivalent structured alternative.**
56. `EST / HIGH` **Disclose or design carefully around truncated axes, non-linear scales, normalization and missing data when they affect interpretation.**
57. `DEF / HIGH` **Show uncertainty when it is decision-relevant rather than presenting point estimates as certainty.**
58. `DEF / HIGH` **Use tables for exact lookup, charts for pattern/comparison, and both when users need both jobs.**

## 11.9 Responsive, localization and accessibility

59. `EST / HIGH` **Responsive visuals adapt; they do not merely shrink.**
60. `HOUSE / HIGH` **Preserve semantic invariants across breakpoints even when layout/topology changes.**
61. `EST / HIGH` **Design localization capacity into text-bearing visuals; translation is not the whole localization problem.**
62. `EST / HIGH` **Meaningful non-text content requires a text-equivalent strategy appropriate to complexity.**
63. `REQ / HIGH` **Meaningful graphical objects in web content must satisfy applicable WCAG non-text contrast unless an exception applies.**
64. `REQ / HIGH` **Do not use images of text when real text can provide the same presentation, subject to WCAG exceptions.**
65. `EST / HIGH` **Do not rely on hue/color alone for meaning.**
66. `REQ/DEF / HIGH` **Non-essential interaction-triggered motion SHOULD respect reduced-motion preferences; applicable conformance requirements govern the target level.**
67. `HOUSE / HIGH` **Interactive graphics MUST have a keyboard/assistive-technology model or an equivalent accessible interaction path.**

## 11.10 Delivery, performance and color

68. `EST / HIGH` **Performance budgets cover bytes, decode, DOM/path complexity, paint/composite, GPU, memory and battery as applicable.**
69. `DEF / HIGH` **Provide intrinsic dimensions/aspect ratio to prevent avoidable layout shifts.**
70. `DEF / HIGH` **Use responsive image selection (`srcset`/`sizes`/`picture` or equivalent framework output) for materially variable raster display sizes.**
71. `DEF / HIGH` **Do not lazy-load the critical above-the-fold image solely by convention.**
72. `DEF / MODERATE` **Use fetch priority/preload only for resources that truly need it; competing high-priority resources can cancel the benefit.**
73. `CTX / HIGH` **Choose AVIF, WebP, JPEG or PNG from image characteristics, support, transparency, encode/decode and quality—not from format fashion.**
74. `HOUSE / HIGH` **Define the working/output color space for brand-critical or wide-gamut assets.**
75. `DEF / HIGH` **Use sRGB as the conservative broad-compatibility baseline unless a wider-gamut pipeline is intentionally managed.**
76. `CTX / MODERATE` **Use Display P3/wide gamut when the target devices and visual benefit justify the testing and fallback burden.**

## 11.11 Provenance, rights and release

77. `EST / HIGH` **Track source provenance for material external/generated assets.**
78. `EST / HIGH` **C2PA/Content Credentials are provenance mechanisms, not truth or ownership proofs.**
79. `REQ/CTX / HIGH` **Where applicable law requires synthetic/deepfake disclosure, machine-readable provenance does not automatically replace human-perceivable disclosure.**
80. `EST / HIGH` **Do not assume AI-generated output is exclusively copyrightable or commercially safe.**
81. `HOUSE / HIGH` **Production approval requires known rights for source references, stock, fonts, logos, likenesses and derivative use where material.**
82. `EST / HIGH` **A Creative Commons label MUST be interpreted by its actual license terms—commercial use, derivatives, attribution and share-alike differ materially.**
83. `HOUSE / HIGH` **Do not strip provenance metadata blindly during optimization when it is part of the trust/compliance design.**
84. `EST / HIGH` **Visual release requires both automated evidence and competent human review.**

---

## 11.12 V2.1 strengthening controls

85. `HOUSE / HIGH` **The accepted rendered file(s), semantic alternative and runtime configuration form the releasable visual artifact.** Prompt/spec/model identity alone is not artifact identity.
86. `HOUSE / HIGH` **For material generated visuals, store a cryptographic hash of the accepted output and retain the exact released derivative when practical.**
87. `HOUSE / HIGH` **If a provider exposes a revised/expanded prompt, record it separately from the user's art-direction specification.** Do not silently treat provider rewriting as equivalent to the human instruction.
88. `EST / HIGH` **Treat uploaded or third-party SVG as active/untrusted content unless it passes a defined sanitization/rewrite boundary.** Embedding context changes risk [SVG-SEC-MDN][OWASP-IMG-VALIDATION].
89. `EST / HIGH` **Before screenshots/reference media leave the trusted boundary or enter a third-party model, inspect and redact personal data, secrets, customer data and internal-only identifiers according to classification.** [OWASP-SCREENSHOT]
90. `HOUSE / HIGH` **Classify metadata before transformation: privacy/security metadata; rights/credit metadata; provenance metadata; rendering/color/orientation metadata.** Apply different retention rules to each class.
91. `HOUSE / HIGH` **Do not strip all metadata by default and do not preserve all metadata by default.** Both can create harm.
92. `DEF / HIGH` **For durable factual diagrams/charts, keep the source facts/relationships separately machine-readable.** Pixels are a view, not the canonical data model.
93. `DEF / HIGH` **For complex images, prefer structured visible HTML/table/list equivalents when the relationship structure matters.** A single long prose description is often an inferior accessibility representation [WAI-COMPLEX].
94. `HOUSE / HIGH` **Treat SVG accessibility semantics as implementation-sensitive until the target browser/AT combination is verified.** SVG AAM remains a Working Draft at the cutoff [SVG-AAM-2026].
95. `CTX / HIGH` **For dense networks, choose node-link, matrix, grouped summary, table or interactive drill-down from the actual task and density.** A small-graph visual convention is not a universal system-map law [GRAPH-MATRIX-2004].
96. `HOUSE / HIGH` **Separate 3D master/source assets from runtime delivery assets.** Delivery must define scene structure, mesh/texture/material formats, compression, LOD, fallback and measurable runtime budgets.
97. `DEF / HIGH` **Use glTF 2.0/GLB as a strong interoperable runtime-delivery candidate when its semantics fit; treat glTF 2.1 as watch material until its stable status changes.** [GLTF2][GLTF21-WATCH]
98. `CTX / HIGH` **Use KTX2/Basis-style GPU texture delivery when it materially reduces texture transfer/memory cost and the target renderer/toolchain supports it.** [KTX2]
99. `CTX / HIGH` **Treat JPEG XL as a contextual web-delivery option with explicit fallback/support validation, not the universal successor to AVIF/WebP/JPEG/PNG.** [MDN-IMAGE-FORMATS]
100. `EMG / HIGH` **Treat web HDR as a version-sensitive enhancement.** CSS Color HDR Level 1 is a Working Draft; test SDR fallback, luminance behavior and accessibility before use [CSS-HDR-2026].
101. `HOUSE / HIGH` **Representation QA for generated people/social roles scales with consequence and audience.** Evaluate slices and stereotypes in the deployed model + prompt + reference + provider-revision workflow [NIST-GENAI][T2I-BIAS-2026A][T2I-BIAS-2026B].
102. `DEF / MODERATE` **Prefer static text+diagram/signaling when time/change is not itself the message; add animation only when temporal representation earns its cognitive/runtime cost.** [MULTIMEDIA-META-2025][SIGNAL-META-2018]

# 12. Medium-selection framework

## 12.1 First decision: what kind of thing is this?

```text
Is the primary value semantic text / layout / state?
  → HTML + CSS first

Is it scalable vector geometry, an icon, diagram or line illustration?
  → SVG first

Is it pixel-rich art, photography, generated imagery or texture?
  → Raster first

Is it dynamically drawn 2D with many/high-frequency elements?
  → Canvas candidate

Is it genuinely 3D, shader-heavy or massively GPU-rendered?
  → WebGL/WebGPU candidate

Is time itself the authored medium with little interaction?
  → Video / motion asset candidate

Does it need both semantics and high-performance rendering?
  → Hybrid DOM + SVG/Canvas/WebGL
```

“First” means candidate, not automatic choice.

## 12.2 Decision matrix

| Requirement | HTML/CSS | SVG | Raster | Canvas | WebGL/WebGPU | Video |
|---|---:|---:|---:|---:|---:|---:|
| Real/selectable/localizable text | Excellent | Good | Poor | Poor | Poor | Poor |
| Native semantics/accessibility | Excellent | Good with design | Weak | Weak without parallel DOM | Weak without parallel DOM | Needs transcript/description |
| Simple geometric illustration | Good | Excellent | Good | Good | Overkill | Poor |
| Photo/painterly/generated detail | Poor | Poor | Excellent | Good | Good | Good |
| Crisp arbitrary scaling | Good | Excellent | Limited by resolution | Re-rendered | Re-rendered | Limited by stream/source |
| Many dynamic 2D primitives | Poor | Moderate | Poor | Excellent | Excellent | N/A |
| Interactive 3D | Poor | Poor | Poor | Limited | Excellent | No |
| CSS theming/currentColor | Excellent | Excellent | Poor | Manual | Manual | No |
| CDN cache as standalone asset | N/A | Excellent external | Excellent | Code/data dependent | Code/data dependent | Excellent |
| SEO/text extraction | Excellent | Moderate | Alt/adjacent text only | Parallel content | Parallel content | Metadata/transcript |
| Authoring simplicity | High for simple | High for vector | High | Medium | Low | Medium |
| Runtime complexity | Low | Low–medium | Low | Medium | High | Medium |
| Best for exact product UI | Live HTML | Some UI illustrations | Screenshot only | Rare | Rare | Demo recording |

## 12.3 Medium escalation rule

Escalate only when the lower layer cannot adequately satisfy a named requirement:

```text
HTML/CSS
  ↓ if geometry is awkward / reusable vector asset needed
SVG
  ↓ if per-pixel dynamic rendering / huge object counts are required
Canvas
  ↓ if GPU pipelines / 3D / shaders / extreme rendering throughput are required
WebGL / WebGPU
```

This is not a maturity ladder. A static `img` can be the most sophisticated correct solution.

---

# 13. Art direction as a production specification

Art direction converts communication intent into controllable visual choices.

## 13.1 Art-direction stack

```text
COMMUNICATION JOB
→ CONCEPT / METAPHOR
→ SUBJECT
→ COMPOSITION
→ HIERARCHY
→ SPATIAL MODEL
→ FORM LANGUAGE
→ COLOR + LIGHT
→ MATERIAL / TEXTURE
→ TYPE / LABEL STRATEGY
→ BRAND CUES
→ MOTION (if any)
→ OUTPUT / CROP / CONTEXT
```

## 13.2 Translate vague traits

Bad brief:

> “Make it premium, futuristic and human.”

Operationalized brief:

```yaml
premium:
  restraint: high
  material_quality: high
  visual_noise: low
  spacing: generous
  proof_visibility: high
  risk: "can become empty/aloof"

futuristic:
  use:
    - precise geometry
    - restrained unfamiliarity
    - subtle dimensional layering
  avoid:
    - neon cyberpunk cliché
    - random AI sparkles
    - meaningless grids

human:
  use:
    - understandable scale
    - warm material/light cues
    - real workflow context
  avoid:
    - generic stock smiles
    - synthetic empathy theater
```

## 13.3 Reference roles

Each reference SHOULD be labeled:

- `CONTENT_REFERENCE` — exact object/person/product that should appear;
- `COMPOSITION_REFERENCE` — spatial arrangement only;
- `STYLE_REFERENCE` — stroke, material, illustration grammar;
- `COLOR_REFERENCE` — palette/tonality;
- `LIGHT_REFERENCE` — illumination and mood;
- `CHARACTER_IDENTITY_REFERENCE` — identity/appearance continuity;
- `BRAND_REFERENCE` — protected brand language;
- `ANTI_REFERENCE` — what not to imitate.

Conflicting references create ambiguous output. Resolve precedence explicitly.

## 13.4 Anti-cliché gate

Reject visual shorthand that adds category cliché without explanatory value:

- generic AI brains;
- glowing neural nodes;
- floating sparkles;
- random glass blobs;
- network lines without semantic meaning;
- robots used only to signify “AI”;
- stock people pointing at dashboards;
- 3D cubes used only to imply technology;
- fake terminal code;
- arbitrary blueprint grids;
- gradients used to simulate innovation.

These elements are not banned. They must earn their role.

---

## 13.7 Representation envelope and production invariants — V2.1

For visuals depicting people, roles, cultures, workplaces, places or consequential social contexts, art direction SHOULD define a **representation envelope**, not merely a look:

```yaml
representation_envelope:
  populations_or_roles_material_to_the_message: []
  attributes_that_must_not_be_inferred_or_exaggerated: []
  stereotype_risks: []
  historical_or_cultural_context: []
  required_diversity_or_sampling_logic:
  review_slices: []
  prohibited_caricatures_or_false_documentary_cues: []
```

The aim is not quota-driven decoration. It is to prevent a probabilistic image system from silently converting an underspecified art direction into a social claim.

Where the graphic is factual or high-trust, also define **production invariants**:

- what must remain exact;
- what can be stylized;
- what may be hallucinated because it is purely atmospheric;
- what must come from a controlled source asset;
- which downstream edits invalidate the acceptance record.

# 14. Visual communication by artifact type

# 14.1 Diagrams

A diagram exists to externalize a structure or relationship.

### Diagram contract

```yaml
entities:
relationships:
relationship_types:
directionality:
boundaries:
sequence_or_time:
source_of_truth:
exceptions:
legend_needed:
interaction_needed:
```

### Rules

- one line style = one relationship meaning;
- arrows imply direction and must not be decorative;
- proximity implies grouping, so group intentionally;
- containment implies scope/ownership, so use it intentionally;
- label crossings, branches and loops when ambiguity is plausible;
- avoid edge spaghetti; restructure topology before styling harder;
- do not hide material exceptions solely to make the diagram symmetrical;
- if layout is illustrative rather than literal, say so when readers may infer architecture.

# 14.2 System maps

System maps commonly need at least three layers:

```text
ACTORS / USERS
↓
CAPABILITIES / SYSTEMS / AGENTS
↓
DATA / KNOWLEDGE / EXTERNAL SERVICES
```

Choose additional layers only when they answer the audience's question.

Distinguish:

- ownership;
- data flow;
- control flow;
- trust boundary;
- dependency;
- organizational grouping;
- sequence.

Do not encode all six through the same generic connector.

# 14.3 Process graphics

Use a process graphic when order, transition or decision matters.

Minimum semantics:

```text
START / TRIGGER
→ STAGE / ACTION
→ DECISION / BRANCH
→ HANDOFF / STATE CHANGE
→ LOOP / RETRY if applicable
→ OUTCOME
```

Show parallel paths as parallel. Show optional paths as optional. Do not make a branching process look linear for aesthetic symmetry.

# 14.4 Conceptual/editorial illustration

Editorial illustration may deliberately compress reality through metaphor.

A good conceptual visual has:

1. one central idea;
2. a legible mapping from visual device to concept;
3. enough novelty to create interest;
4. enough familiarity to decode the metaphor;
5. no accidental factual claim beyond the intended metaphor.

**Metaphor test:** If a viewer describes the illustration literally, what false conclusion could they draw? Remove or constrain that risk.

# 14.5 Product visuals

Choose among:

```text
LIVE PRODUCT UI
→ strongest product truth; highest implementation/maintenance cost

REAL SCREENSHOT
→ strong proof; static/stale/localization limitations

RECONSTRUCTED HTML DEMO
→ responsive/localizable; can drift from product truth

COMPOSITED SCREENSHOT
→ useful for focus/cleanup; provenance must remain clear

CONCEPT MOCKUP
→ future/idea communication; never present as shipped proof

AI-GENERATED PRODUCT-LIKE IMAGE
→ concept/editorial only unless exact fidelity is independently established
```

# 14.6 Screenshots and mockups

Before capture:

- set known build/version;
- set representative state;
- remove personal/sensitive data;
- decide light/dark/locale;
- remove debugging/dev artifacts;
- verify timestamps, names, amounts and sample data.

After capture:

- crop for the communication job, not merely the viewport;
- keep enough chrome/context to orient;
- do not distort aspect ratio;
- do not fabricate outcomes;
- annotate edits that change evidentiary meaning;
- store source build/state reference for durable docs.

# 14.7 Icons

### Icon decision

```text
Is the symbol highly familiar in this exact context?
  yes → icon-only may be acceptable if accessible name exists
  no  → visible label or stronger contextual cue

Is the action destructive / irreversible / rare?
  → favor explicit text even if icon is familiar
```

### Icon grammar

Standardize:

- viewBox / optical canvas;
- stroke width;
- line caps/joins;
- fill-vs-outline policy;
- corner radius language;
- optical weight;
- baseline alignment;
- default and compact sizes;
- color inheritance;
- RTL mirroring policy.

# 14.8 Data visuals

## Encoding priority for precise comparison

Use as a strong prior, not a universal theorem:

```text
position on common scale
≈ aligned length
> unaligned length
> angle / slope for precise magnitude
> area
> volume
> color saturation / hue for exact quantity
```

Color remains excellent for category/highlight/heat when precision comes from another channel.

## Data integrity checklist

- [ ] source and time range known
- [ ] units visible
- [ ] denominator/context known
- [ ] axis treatment justified
- [ ] missing data distinguished from zero
- [ ] uncertainty shown if decision-relevant
- [ ] categories/colors consistent
- [ ] no 3D distortion of magnitude
- [ ] values/data table accessible when needed
- [ ] annotations do not obscure contrary patterns

---

# 14.9 Dense networks and machine-extractable informational visuals — V2.1

A node-link diagram is not the default representation for every network.

Before choosing topology, classify the task:

```text
trace a path / dependency        → node-link may be strong
compare many pairwise relations  → matrix/table may be stronger
find groups/communities          → clustered summary or interactive drill-down
lookup exact relation            → table/searchable list may be stronger
understand architecture story    → simplified semantic diagram
operate/debug real system        → interactive/queryable system view + raw data
```

Controlled graph-visualization research found task- and density-dependent differences between node-link and matrix representations; its numeric thresholds are contextual, not universal rules [GRAPH-MATRIX-2004].

For material system/data visuals, maintain a structured equivalent such as:

- HTML table/list;
- JSON/CSV/data source;
- accessible node/edge list;
- searchable dependency view;
- documented diagram semantics.

This benefits accessibility, localization, automated checking, search/indexing and future machine interpretation without making an AI model's vision performance a design target.

# 15. Generative visual production system

Generative image systems are best treated as **probabilistic renderers/editors inside a controlled production pipeline**.

# 15.1 Best-fit jobs

Strong candidates:

- art-direction exploration;
- conceptual/editorial illustration;
- visual metaphors;
- scene/environment generation;
- texture/material development;
- mood/reference exploration;
- product-photo cleanup under strict preservation rules;
- background replacement;
- object removal/addition;
- compositing;
- sketch-to-render;
- style transfer where rights/policy permit;
- transparent cutouts;
- variant production with controlled review.

Weak candidates unless heavily controlled:

- exact product UI screenshots;
- legal/compliance diagrams;
- factual technical schematics;
- maps where geography must be exact;
- scientific/medical anatomy requiring accuracy;
- charts where every mark must encode real data;
- exact logos/brand marks;
- long or frequently updated copy;
- tables;
- QR codes/barcodes;
- documentary depictions that viewers may treat as authentic evidence.

# 15.2 Generation vs edit vs construct

```text
Need a new visual concept?
  → GENERATE

Have a mostly-correct image and one localized defect/change?
  → EDIT / INPAINT

Need exact structure/data/text/brand geometry?
  → CONSTRUCT deterministically, optionally using generated layers

Need exact structure + organic atmosphere/detail?
  → HYBRID: construct structure, generate/edit texture/scene, composite
```

# 15.3 The controlled generative loop

```text
1. Visual Production Contract
2. Separate deterministic vs generative elements
3. Choose generator/editor by task
4. Build low-cost composition candidates
5. Select against explicit criteria
6. Lock invariants
7. Edit one dimension at a time
8. Composite deterministic text/logo/data/UI
9. Technical cleanup
10. Accessibility/localization treatment
11. Provenance + rights record
12. Responsive exports
13. Human + automated QA
14. Release accepted artifact, not “the prompt”
```

# 15.4 Invariant locking

Once correct, record `PRESERVE` constraints:

```yaml
preserve:
  - subject identity
  - product geometry
  - camera angle
  - composition
  - background architecture
  - logo placement
  - approved color family
  - transparent alpha

change:
  - remove extra object
  - make light softer
  - reduce texture

must_not_change:
  - labels
  - perspective
  - proportions
  - crop safety area
```

If an edit keeps breaking preserved invariants, move to deterministic retouching/compositing rather than infinite regeneration.

# 15.5 Reference discipline

For each input image:

```yaml
reference_id:
role:
allowed_to_copy:
must_preserve:
may_interpret:
license_or_source:
```

Do not use references you lack the right to use in the intended workflow.

# 15.6 Model-selection dimensions

Evaluate the actual model/version on:

- prompt adherence;
- editing precision;
- reference fidelity;
- subject/character consistency;
- product geometry preservation;
- text rendering;
- transparent alpha quality;
- resolution/aspect-ratio support;
- latency;
- cost;
- multi-turn behavior;
- safety/policy constraints;
- provenance signals;
- API/tool stability;
- commercial terms;
- local acceptance rate / retries.

No benchmark substitutes for a task-specific evaluation set.

# 15.7 Build an image-model eval set

Before production scale, retain 10–50 representative jobs spanning:

- hero composition;
- transparent cutout;
- brand color family;
- product preservation;
- text-heavy infographic if relevant;
- difficult hands/faces/objects if relevant;
- multi-reference composition;
- localized language text if relevant;
- surgical edit;
- wide/narrow crop;
- negative-space layout.

Score:

```text
semantic correctness
+ composition
+ preservation
+ artifact rate
+ text accuracy
+ brand fit
+ number of retries
+ edit controllability
+ latency/cost
```

Do not optimize only for first-image “wow”.

---

# 15.8 V2.1 system-as-deployed evaluation and artifact identity

A text-to-image model is not the complete production system. Evaluate:

```text
HUMAN ART-DIRECTION SPEC
→ provider/model
→ provider-side prompt transformation if any
→ reference-image handling
→ sampling/generation
→ edit/inpaint/composite passes
→ deterministic overlays
→ export/transcode
→ final delivered asset
```

For consequential human/social imagery, evaluate representation on the **whole chain**. Current 2026 research continues to find gender/social stereotype differences across text-to-image systems and workflows; the correct response is scoped evaluation, not assuming every model or every prompt has the same bias profile [T2I-BIAS-2026A][T2I-BIAS-2026B]. NIST's GenAI profile remains the risk-management anchor rather than a model-quality certification [NIST-GENAI].

For reproducibility:

- keep the human production spec;
- record the current provider/model/version;
- record provider-revised prompt when exposed;
- record reference inputs and their identities;
- preserve the **accepted rendered output**;
- hash the accepted output;
- record manual/compositing changes;
- regenerate only as a new candidate, never as proof that the old asset can be reconstructed exactly.

A deterministic build can reproduce an SVG from source code. A probabilistic generator normally cannot promise byte-identical regeneration across model/provider/runtime change.

# 16. Prompt & Art-Direction Specification

Prompting is an interface to the production spec, not the production spec itself.

# 16.1 Canonical generation spec

```yaml
job:
  asset_role:
  communication_goal:
  audience:
  final_surface:

canvas:
  aspect_ratio:
  target_resolution:
  safe_areas:
  background: opaque|transparent|contextual

subject:
  primary:
  secondary: []
  pose_or_action:
  exact_attributes: []

composition:
  framing:
  subject_position:
  camera_angle:
  lens_or_projection:
  depth:
  negative_space:
  reading_order:

visual_language:
  medium:
  rendering_style:
  form_language:
  line_quality:
  materials:
  texture:
  palette:
  lighting:
  contrast:

brand:
  traits: []
  protected_assets: []
  allowed_interpretation:
  forbidden_cliches: []

text:
  exact_strings: []
  generated_text_allowed: false
  deterministic_overlay_planned: true

references:
  - id:
    role:
    precedence:

constraints:
  preserve: []
  change: []
  must_not_add: []
  must_not_change: []
  factual_constraints: []
  safety_or_representation_constraints: []
  sensitive_input_constraints: []
  metadata_constraints: []

representation_review:
  material_people_or_roles: []
  stereotype_risks: []
  review_slices: []

provenance_capture:
  human_spec_id:
  provider_revised_prompt_if_exposed:
  model_snapshot_or_version:
  reference_hashes: []
  accepted_output_sha256:

output:
  candidate_count:
  transparent_alpha_required:
  downstream_format:
```

# 16.2 Prompt construction order

A strong natural-language prompt usually maps this order:

```text
ACTION
+ SUBJECT
+ COMMUNICATION/SCENE CONTEXT
+ COMPOSITION
+ CAMERA / PROJECTION
+ LIGHT
+ MEDIUM / STYLE
+ COLOR / MATERIAL
+ EXACT CONSTRAINTS
+ OUTPUT / BACKGROUND / ASPECT
+ PRESERVE / DO-NOT-CHANGE
```

Example:

> Draw a wide editorial illustration of a small team coordinating work through one shared operating layer. Keep the team on the upper third, with the shared layer spanning the center and source systems below. Flat orthographic perspective, minimal technical linework, off-white background, restrained blue-gray palette, one warm accent only. Leave the left 35% visually quiet for HTML headline overlay. No readable text, no robot, no brain, no random network nodes. The three source icons must remain visually distinct and connected only to the shared layer. Landscape 16:9.

The useful property is not prose length; it is explicit constraints.

# 16.3 Edit prompt pattern

> Edit the supplied image. Preserve **[locked invariants]** exactly. Change only **[target change]**. Match the existing **[light/perspective/style/material]**. Do not alter **[protected elements]**. Return **[output requirements]**.

# 16.4 Deterministic typography overlay

For production hero/editorial assets, prefer:

```text
GENERATED IMAGE LAYER
+ SVG/HTML/CSS TEXT
+ REAL LOGO ASSET
+ REAL DATA / LABELS
```

over asking the image model to repeatedly reproduce critical copy.

Generated text may still be appropriate when the text itself is part of the depicted world or stylistic concept and exactness is not consequential.

---

# 17. Current generative-image implementation profiles — volatile

**This section is intentionally versioned to the 2026-09-28 cutoff. It is not evergreen doctrine.**

# 17.1 OpenAI GPT Image profile

Current OpenAI documentation at the cutoff lists:

- `gpt-image-2.5-sunburst` — positioned for higher editing precision;
- `gpt-image-2.5-flare` — positioned for fast high-quality everyday generation;
- Image API for single generation/edit jobs;
- Responses API image-generation tool for conversational/multi-turn generation and editing;
- multiple image references;
- mask-guided edits;
- PNG/JPEG/WebP output;
- transparent PNG/WebP output on supported models;
- configurable quality, dimensions and compression;
- prompt revision in the Responses workflow;
- masks as **guidance rather than a pixel-perfect invariant guarantee** in current documentation.

Production rule:

> Use current model names only in a versioned implementation profile. Keep the workflow contract model-agnostic so model retirement does not invalidate the art-direction system. When the API exposes a revised prompt, retain it as execution provenance while keeping the human art-direction specification as the authoritative intent. Never treat a mask alone as proof that protected pixels/geometry remained invariant.

# 17.2 Google Gemini / Nano Banana profile

Current Google documentation at the cutoff describes Nano Banana as Gemini's native image-generation family and lists:

- Nano Banana 2 Lite / Gemini 3.1 Flash Lite Image for low-latency/cost work;
- Nano Banana 2 / Gemini 3.1 Flash Image as a broad generalist;
- Nano Banana Pro / Gemini 3 Pro Image for complex professional asset production;
- multi-turn editing as the recommended iteration path;
- multiple reference images with model-dependent limits;
- 1K/2K/4K generation on supported models;
- aspect-ratio controls;
- text rendering;
- all generated images carrying a SynthID watermark according to current docs.

Production rule:

> Treat vendor claims such as “professional,” “reliable text,” or “brand consistency” as capability hypotheses. Validate the exact production tasks before making them release controls. Record the exact model identifier used because the Nano Banana family is a volatile implementation layer.

# 17.3 Cross-vendor workflow rule

Do not encode production logic as:

```text
if asset == premium: use Vendor X
```

Encode:

```text
required editing precision
+ reference fidelity
+ cost/latency
+ output control
+ provenance
+ local acceptance evidence
→ select current model profile
```

---

# 18. SVG engineering standard

SVG is an XML-based vector graphics system and can combine geometry, text, paint, gradients, masks, filters, links, scripting and accessibility semantics. Its flexibility is why it needs discipline.

# 18.1 Use SVG when

- geometry should scale crisply;
- icons/line illustration dominate;
- paths need theme colors;
- vector parts need interaction;
- labels/relationships benefit from DOM-like structure;
- external asset caching is useful;
- asset recoloring/dark-mode adaptation matters.

# 18.2 Avoid or reconsider SVG when

- the visual is essentially a complex painting/photo;
- exported path count is extreme;
- filters create expensive rasterization/compositing;
- a flat raster is smaller and visually equivalent;
- text layout/localization is easier in surrounding HTML;
- the source is untrusted and sanitization is not robust.

# 18.3 Canonical SVG contract

```yaml
viewBox:
intrinsic_aspect_ratio:
decorative_or_meaningful:
accessible_name_source:
text_strategy: svg_text|html_overlay|paths_only_for_art
color_strategy: currentColor|css_variables|fixed
rtl_behavior:
dark_mode_behavior:
responsive_behavior:
interaction:
focusable_elements:
external_resources:
security_sanitization:
optimization_pipeline:
```

# 18.4 SVG rules

1. Always define a deliberate `viewBox` for scalable assets.
2. Do not convert meaningful/localizable text to paths merely to preserve typography unless the loss is accepted and an accessible/localized equivalent exists.
3. Use `currentColor`/semantic CSS variables for reusable UI icons where appropriate.
4. Avoid internal IDs that collide when the same inline SVG is repeated.
5. Optimize path precision and metadata, but do not remove semantics/provenance blindly.
6. For decorative SVG, remove it from the accessibility tree appropriately.
7. For meaningful SVG, provide an accessible name/description through a tested markup strategy.
8. For interactive SVG, provide focus, keyboard behavior and visible focus equivalent to the function.
9. Test SVG semantics with actual target browser/assistive-technology combinations; authoring syntax is not enough.
10. Sanitize untrusted SVG because SVG may contain scripts, external references and active content depending on embedding context.

# 18.5 Inline vs external SVG

**Inline** when:

- CSS state/theme interaction is required;
- individual nodes must be manipulated;
- avoiding another request is material for a small critical asset.

**External file** when:

- it is reused across pages;
- independent caching matters;
- DOM weight matters;
- no per-node interaction is needed.

No universal winner exists.

---

# 18.6 V2.1 SVG trust-boundary and security profile

SVG deserves two different treatment paths:

## Trusted build-time SVG

Examples: icons/illustrations produced inside the controlled repository/toolchain.

Controls:

- optimize through a pinned/controlled pipeline;
- prohibit unexpected scripts/external references by policy where they are not needed;
- review URL references, filters and embedded content when material;
- preserve intended accessibility and IDs after optimization.

## Untrusted/uploaded/third-party SVG

Treat as active content until proven otherwise. Depending on embedding/context, SVG can carry script or external-resource behavior; OWASP also recommends allowlisting types and rewriting/validating uploaded images rather than trusting extension/MIME alone [SVG-SEC-MDN][OWASP-IMG-VALIDATION].

Minimum posture:

1. do not inject untrusted SVG markup directly into the DOM;
2. use a proven sanitization/rewrite policy appropriate to allowed SVG features;
3. remove disallowed scripts/events/foreign content/external-resource references;
4. bound complexity to prevent pathological path/filter/resource cost;
5. serve with deliberate content type/security headers and embedding mode;
6. rasterize untrusted decorative SVG when semantic/vector behavior is unnecessary and doing so reduces risk;
7. test the exact embedding context — `<img>`, inline DOM, object/document contexts do not have identical behavior.

SVG 2 itself remains a 2018 Candidate Recommendation Snapshot, while the SVG Accessibility API Mappings document is a 24 September 2026 Working Draft that explicitly warns it is an early draft with outdated information/errors [SVG2-STATUS][SVG-AAM-2026]. Therefore production accessibility is established by real target testing, not spec-status inference.

# 19. CSS-native graphics

CSS is excellent for **presentation primitives**, not for hiding semantic content.

Good CSS-native jobs:

- backgrounds;
- gradients;
- borders;
- separators;
- simple arrows/chevrons;
- badges;
- geometric decoration;
- skeletons/placeholders;
- simple status indicators;
- clipping/masking where supported and tested;
- transform-based state motion;
- responsive layout-dependent decoration.

Avoid CSS art when:

- dozens of pseudo-elements simulate an illustration that could be one maintainable asset;
- essential information only exists in generated content/backgrounds;
- complexity makes accessibility or localization brittle;
- filter/blur/mask cost is material;
- the result cannot be reliably tested across browsers.

**Rule:** semantic content lives in semantic markup; CSS expresses its visual form.

---

# 20. HTML-native graphics

HTML-native graphics are underused for product/system explanation.

Use HTML when a visual is fundamentally:

- labeled cards/nodes;
- text-rich process steps;
- responsive comparison;
- status matrix;
- timeline;
- feature map;
- product demo;
- knowledge/system layers.

Benefits:

- real text;
- localization;
- selectable/searchable content;
- native layout/reflow;
- accessibility tree;
- dark mode/theme;
- live data;
- easier responsive transformation.

A strong hybrid pattern:

```text
HTML nodes / labels
+ CSS layout
+ SVG overlay for connectors
```

This often outperforms a giant static SVG for responsive system diagrams with substantial text.

---

# 21. Canvas engineering standard

WHATWG defines Canvas as a resolution-dependent bitmap drawing surface and explicitly requires equivalent fallback content/function where used.

# 21.1 Use Canvas when

- large numbers of transient 2D primitives update frequently;
- pixel operations matter;
- custom drawing is central;
- real-time charts/maps/editors need a raster drawing surface;
- SVG DOM overhead would be excessive.

# 21.2 Canvas accessibility architecture

Canvas pixels do not become semantic objects by themselves.

For meaningful/interactive Canvas:

- maintain a parallel semantic object model;
- expose text/data alternatives;
- provide keyboard-operable controls when interaction exists;
- synchronize focus/selection with the visual surface;
- provide a non-Canvas path when the full interaction cannot be made accessible;
- ensure fallback content conveys the same essential purpose.

# 21.3 Canvas quality rules

- scale the backing bitmap for actual device pixel density only as much as needed;
- avoid rendering a huge bitmap and CSS-scaling it down;
- use OffscreenCanvas/workers only when profiling shows main-thread benefit;
- minimize expensive readbacks (`getImageData`) in performance-critical loops;
- separate scene/data state from rendering commands;
- handle resize and DPR changes;
- test memory pressure on mobile;
- provide export behavior intentionally if users need saved images.

---

# 22. WebGL, WebGPU and 3D

3D/GPU graphics are justified by **capability**, not by visual prestige.

# 22.1 Use cases that can justify GPU graphics

- true interactive 3D product exploration;
- spatial data where depth is information;
- large dynamic point/particle/mesh rendering;
- custom shader effects central to the experience;
- simulation;
- high-performance image processing;
- creative experiences where GPU rendering is the product value.

# 22.2 Do not use GPU graphics merely for

- a static gradient;
- a background blob;
- a simple icon;
- a three-node system diagram;
- a hero image that could be a compressed raster;
- fake technological sophistication.

# 22.3 WebGPU status rule

At the 2026-09-28 cutoff, W3C WebGPU is a **Candidate Recommendation Draft**, not a final Recommendation. Therefore:

- feature-detect;
- maintain a compatibility/support policy;
- provide fallback when the visual is required for product use;
- do not make critical content depend solely on WebGPU unless the target environment is explicitly controlled and validated.

# 22.4 3D accessibility and UX

For meaningful 3D:

- provide equivalent names/labels/details outside the scene;
- provide keyboard navigation or alternate controls if interaction matters;
- avoid spatial precision as the only input mechanism;
- respect reduced motion;
- avoid forced camera motion;
- preserve a static/2D summary when 3D is supplementary;
- expose product measurements/data as text, not only perspective.

# 22.5 3D performance

Budget:

- model geometry;
- texture resolution;
- shader complexity;
- draw calls/bind groups;
- overdraw;
- animation rigs;
- memory;
- initialization latency;
- CPU↔GPU transfer;
- battery/thermal load;
- background-tab behavior.

Progressively load high detail only when it improves the actual experience.

---

# 22.6 V2.1 3D asset-delivery architecture

Do not ship the authoring scene directly merely because it renders locally.

Use this separation:

```text
AUTHORING MASTER
  DCC scene / CAD / source textures / editable rigs
        ↓
CONTROLLED EXPORT
        ↓
RUNTIME SCENE / ASSET
  geometry + nodes + materials + animation + cameras
        ↓
DELIVERY OPTIMIZATION
  mesh simplification / compression
  texture resize / transcode
  LOD / variants
  scene splitting if justified
        ↓
RUNTIME VALIDATION
        ↓
WEBGL / WEBGPU RENDERER
        ↓
STATIC / 2D FALLBACK OR EQUIVALENT CONTENT
```

The source master optimizes editability. The runtime asset optimizes interoperability, startup, memory, quality and delivery.

# 22.7 glTF / GLB baseline

At the V2.1 cutoff, glTF **2.0** remains the current registered core baseline and is a strong candidate for interoperable runtime asset delivery where its model fits [GLTF2]. It is designed as a runtime delivery format, not a complete authoring format.

Rules:

- prefer `.glb` when single-file packaging materially simplifies delivery/caching;
- preserve `.gltf` + external resources when independent asset lifecycle/caching is useful;
- validate references, extensions and required features;
- do not embed large resources as base64 merely for convenience when byte overhead/lifecycle is material;
- record required/optional extensions in the asset contract;
- validate exported visual parity against the approved master.

Khronos announced plans for **glTF 2.1** in June 2026 for more complex/composed scenes. Treat it as a watch item, not the stable baseline until its formal status changes [GLTF21-WATCH].

# 22.8 Textures and KTX2

Texture cost often dominates 3D transfer and GPU memory.

For each texture set, define:

```yaml
semantic_role: base_color|normal|roughness|metallic|emissive|environment|other
source_resolution:
delivery_resolution:
color_space:
alpha_required:
compression:
mipmaps:
max_runtime_memory:
```

KTX 2.0 is a Khronos container for GPU texture delivery and can be combined with Basis Universal-style supercompression/transcoding where supported [KTX2]. Use it when measurement shows a material delivery/runtime benefit; do not force it into a stack that cannot reliably transcode/cache/test it.

# 22.9 Geometry, LOD and scene budgets

Budget by **view and task**, not one global polygon prestige target:

- visible triangles/points at representative camera distances;
- draw calls/material switches;
- skinning/morph cost;
- texture residency;
- shader variants;
- transparency/overdraw;
- environment maps;
- animation clips/rig complexity;
- acceleration structures where relevant;
- initialization and first-interaction time.

Use LOD only when transitions do not materially harm product interpretation. For a product configurator, silhouette, dimensions and material identity can be correctness properties.

# 22.10 3D fallback and acceptance

A material 3D experience MUST define what happens when:

- WebGPU/WebGL capability is unavailable;
- reduced motion is requested;
- low memory/thermal constraints make the full scene inappropriate;
- a model/texture fails to load;
- the user cannot operate spatial controls;
- localization requires external labels/details;
- the static representation is actually sufficient for the user's goal.

Acceptance includes **visual parity, geometry/material truth, accessible equivalent, startup time, interaction latency, memory/GPU cost, fallback behavior and device/browser coverage**.

# 23. Motion graphics standard

Motion has five strong functional jobs:

1. **orientation** — where did an object/view go?;
2. **causality** — what action caused what result?;
3. **continuity** — this is the same object/state across change;
4. **hierarchy/attention** — what changed and matters now?;
5. **progress/state** — work is ongoing, completed or changed.

Brand expression is a sixth contextual job, not a license for constant motion.

# 23.1 Motion decision

```text
Does motion communicate state/relationship/time better than static change?
  no → use static
  yes → continue

Is the motion essential?
  no → provide reduced-motion alternative

Does it autoplay or repeat?
  → apply relevant pause/stop/control requirements

Can it trigger vestibular issues or obscure content?
  → redesign amplitude/path/depth or remove
```

# 23.2 Motion implementation choices

- CSS transitions/animations — simple UI state/presentation;
- Web Animations API — programmatic timeline control;
- SVG animation — contextual for vector graphics, browser-support/test required;
- Canvas/WebGL/WebGPU — procedural/high-volume graphics;
- video — authored cinematic sequence;
- vector animation runtimes — contextual, with bundle/accessibility/runtime costs.

Do not animate a static layout just because a library makes it easy. A 2025 meta-analysis of Mayer's multimedia-learning corpus found strong benefits from several static multimedia design principles while richer media effects were heterogeneous; a separate signaling meta-analysis across 103 studies found benefits for retention/transfer and lower cognitive load. Treat animation as contextual, not as a maturity upgrade [MULTIMEDIA-META-2025][SIGNAL-META-2018].

---

# 24. Raster image production

# 24.1 Format selection

| Asset | Strong candidates | Notes |
|---|---|---|
| Photographic hero | AVIF / WebP / JPEG; JPEG XL contextual | Compare quality, decode, support and CDN/tooling; JXL still needs explicit fallback/support policy |
| Generated editorial art | AVIF / WebP / JPEG; JPEG XL contextual | Preserve enough detail; inspect texture/banding; use JXL only with validated fallback/support |
| Transparency | WebP / PNG / AVIF where supported | Alpha quality + tooling decides |
| Crisp UI screenshot | PNG / WebP lossless or visually lossless | Check text/rules after compression |
| Small decorative texture | WebP / AVIF / PNG | Measure actual bytes/render |
| Animated raster | Animated WebP/AVIF or video, contextual | Control/accessibility/performance matter |
| Source/master | high-quality lossless/working format | Delivery format can differ from master |

JPEG XL supports strong modern image capabilities but browser support is not universal at the cutoff; it is a contextual option, not a new universal default [MDN-IMAGE-FORMATS]. For screenshots, diagrams, logos and line art, use lossless or visually lossless settings because edge/text artifacts are unusually visible.

# 24.2 Responsive images

Use width-density candidates so the browser does not fetch a giant image for a small slot.

```html
<img
  src="hero-1280.webp"
  srcset="hero-640.webp 640w, hero-960.webp 960w, hero-1280.webp 1280w, hero-1920.webp 1920w"
  sizes="(max-width: 768px) 100vw, 60vw"
  width="1280"
  height="800"
  alt="..."
/>
```

Use `<picture>` when the **composition/crop itself** changes.

# 24.3 Art direction vs resolution switching

```text
same composition, different pixels
→ srcset/sizes

different crop/composition/subject emphasis
→ picture / source art direction
```

# 24.4 Loading priorities

- critical hero/LCP image: generally do not lazy-load;
- below-the-fold media: lazy loading is a strong default;
- `fetchpriority="high"`: reserve for truly critical images;
- define intrinsic dimensions/aspect-ratio to avoid layout shift;
- test on real routes because multiple “high priority” assets compete.

# 24.5 Compression QA

Do not optimize only by percentage.

Inspect:

- faces;
- thin lines;
- small text;
- gradients/banding;
- noise/texture;
- transparency edges;
- product labels;
- dark-mode backgrounds;
- high-DPR screens.

The acceptable compression threshold is artifact-specific.

---

# 24.6 Discovery vs priority — V2.1

Do not conflate **when the browser discovers an image** with **how highly it prioritizes that fetch**.

```text
resource not discovered early enough
→ preload / markup / parser-discoverable strategy may help

resource discovered but wrong relative priority
→ fetchpriority may help
```

`fetchpriority` is a hint; preload triggers a fetch and can itself create competition. Use both only for a measured critical-resource problem [WEBDEV-FETCHPRI]. Avoid preloading every responsive format/candidate.

# 24.7 Metadata hygiene pipeline

Before encoding/distribution, classify metadata:

| Metadata lane | Typical examples | Default treatment |
|---|---|---|
| Privacy/security | GPS, device/user identifiers, internal comments, hidden paths | minimize/remove unless justified |
| Rights/credit | creator, credit, copyright, license | preserve or move to durable structured record as required |
| Provenance | C2PA manifest/linkage, origin history | preserve/re-sign/recover according to provenance policy |
| Rendering/technical | ICC profile, orientation, color-space data | preserve/normalize to maintain correct rendering |
| Search/distribution | IPTC/licensable metadata | preserve when it supports the intended publishing/rights workflow |

Google's image guidance recognizes structured/IPTC rights metadata as useful publishing information, illustrating why “strip all metadata” is not an evergreen optimization rule [GOOGLE-IMG-META].

# 25. Hybrid production workflows

Hybrid workflows are often the highest-quality production path.

## 25.1 Generated base + deterministic overlay

```text
AI / rendered atmosphere
+ real product cutout
+ real logo
+ HTML/SVG typography
+ real data
```

Use for hero/editorial visuals where organic imagery benefits from generation but brand/factual elements must be exact.

## 25.2 HTML/SVG diagram hybrid

```text
semantic HTML labels/nodes
+ SVG connectors
+ CSS responsive layout
```

Use for text-heavy responsive system maps.

## 25.3 Real screenshot + stylized framing

```text
real UI screenshot
+ vector mask/frame
+ annotation layer
+ contextual background
```

Preserve screenshot truth; make framing clearly separate from product UI.

## 25.4 3D render + raster delivery

Build in 3D when lighting/form/angle exploration needs it, then deliver a static raster if end-user interaction gains nothing from a live 3D runtime.

## 25.5 Data + illustration

Keep data layer deterministic and overlay illustrative narrative elements only if they do not distort reading.

---

# 26. Responsive visual transformation

Responsive visual design has four operations:

```text
REFLOW
RE-CROP
SIMPLIFY
RE-REPRESENT
```

# 26.1 Reflow

Change topology without changing meaning:

```text
desktop: A → B → C horizontally
mobile:  A
         ↓
         B
         ↓
         C
```

# 26.2 Re-crop

Change framing while preserving the focal subject and safe area.

# 26.3 Simplify

Remove **redundant decoration/detail**, not required semantic information.

Possible mobile simplifications:

- fewer minor gridlines;
- shorter labels with accessible full text;
- collapsed secondary annotations;
- fewer simultaneous comparison series with user selection;
- reduced texture;
- smaller decorative layers.

# 26.4 Re-represent

Sometimes the correct mobile representation is a different visual:

```text
complex network map → grouped list + drill-in
wide comparison → stacked comparison cards
multi-series chart → small multiples / selectable series
timeline → vertical sequence
3D preview → static turntable frames / key views
```

# 26.5 Responsive invariants

Never lose without explicit product decision:

- required facts;
- required states;
- required labels;
- relationship meaning;
- accessible alternative;
- brand identity;
- action path.

---

# 27. Accessibility standard for graphics

Accessibility is not one `alt` attribute. It is a representation strategy.

# 27.1 Classify the graphic

```text
DECORATIVE
FUNCTIONAL
INFORMATIVE SIMPLE
INFORMATIVE COMPLEX
TEXT-IN-IMAGE
INTERACTIVE
ANIMATED / TIME-BASED
```

# 27.2 Decorative

If it adds no information/function:

- use empty alt or appropriate presentation semantics;
- avoid polluting the accessibility tree;
- do not hide meaningful content merely because the design calls it decorative.

# 27.3 Functional

For an image/icon used as a control/link, the accessible name should communicate the **function/destination**, not merely describe its pixels.

# 27.4 Simple informative image

Provide a short text alternative that conveys the same purpose/information.

# 27.5 Complex diagram/chart

Use:

- short identifying alternative;
- adjacent explanation or long description;
- data table/structured values when applicable;
- headings/list structure for process steps when helpful.

The text alternative should let a non-visual user reach the same essential conclusion, not narrate every decorative mark.

# 27.6 Non-text contrast

WCAG 2.2 SC 1.4.11 requires 3:1 contrast for parts of graphical objects required to understand content, subject to its exceptions.

Therefore:

- meaningful chart lines need sufficient contrast or an equivalent presentation;
- icon boundaries/state indicators need sufficient contrast;
- redundant text/value presentation can sometimes remove the graphic from being required for understanding;
- decorative or essential-presentation exceptions must not be abused as style escape hatches.

# 27.7 Images of text

Prefer real text for content that can be expressed with web technologies. Exceptions exist for essential presentation such as logos and other scoped cases.

Production implication:

> Do not turn a localized headline into pixels because it was convenient in the image generator.

# 27.8 Color independence

Red/green or brand-color series need another distinction:

- labels;
- markers;
- line patterns;
- position;
- shape;
- texture;
- direct annotation.

# 27.9 Motion

For non-essential motion triggered by interaction, support reduced-motion behavior. Avoid parallax, large spatial movement or forced camera travel where a simpler state change communicates the same thing.

# 27.10 Interactive Canvas/WebGL

Provide:

- keyboard path;
- focus/selection model;
- labels/details in DOM;
- alternative table/list/2D view when necessary;
- instructions that do not rely only on hover/drag/gesture.

---

# 27.11 V2.1 complex-image structure and SVG accessibility status

For a complex chart/diagram, a strong pattern is:

```text
short alternative
→ explains the graphic's purpose / headline conclusion

visible structured equivalent nearby
→ headings / paragraphs / lists / table / data
→ preserves the relationships users may need to navigate

optional detailed visual annotation
→ supports sighted interpretation
```

W3C's complex-image tutorial supports short + long descriptions and notes that an `aria-describedby` reference is exposed as a continuous string, so structural navigation such as table cells/headings can be lost [WAI-COMPLEX]. Therefore use real structured HTML when structure is part of the information.

Do not use the 2026 SVG AAM Working Draft as proof that every inline SVG semantic pattern is interoperable. The draft itself warns that it contains outdated information/errors while being updated for SVG 2 [SVG-AAM-2026]. Test target browser + assistive technology combinations for material SVG interaction/semantics.

For high-value charts, representative disabled-user testing may reveal barriers automation cannot. A 2024 low-vision user study found accessible chart versions generally improved efficiency/effectiveness/satisfaction and highlighted legends, axes, data tables, safe colors, contrast, legibility, resize and focus/navigation as important factors [CHART-A11Y-2024].

# 28. Localization and cultural adaptation

Localization can change visual design, symbols, layout and logic—not only strings.

# 28.1 Text expansion

Design label containers for:

- longer translated strings;
- different line breaking;
- non-Latin scripts;
- font fallback;
- different capitalization behavior.

Avoid rasterizing labels if a visual will support many locales.

# 28.2 RTL

Mirror only what is semantically directional.

Potentially mirror:

- interface flow arrows representing reading/progression;
- back/forward directional affordances according to platform convention;
- layout alignment.

Do **not** automatically mirror:

- logos;
- maps;
- clocks;
- real-world diagrams;
- charts where axis meaning should remain mathematically consistent;
- direction-specific icons with physical meaning.

# 28.3 Cultural symbolism

Review:

- hand gestures;
- animals;
- flags;
- religious/civic imagery;
- colors;
- clothing;
- family/social roles;
- icon metaphors;
- directionality;
- number/date/currency formatting inside graphics.

# 28.4 AI generation localization

Generated cultural imagery requires human review by someone competent in the locale. “Model knows world culture” is not an acceptance criterion.

For exact translated text, prefer deterministic overlay and professional localization rather than trusting generated pixels.

---

# 29. Performance & resource engineering for visuals

Visual performance has at least seven costs:

```text
NETWORK BYTES
DECODE
PARSE / DOM / PATHS
LAYOUT
PAINT / RASTER
COMPOSITE / GPU
MEMORY + BATTERY
```

# 29.1 Performance budget by role

```yaml
hero_lcp:
  byte_budget:
  max_candidates:
  no_lazy_load: true

supporting_illustration:
  byte_budget:
  lazy_load: true

interactive_graphic:
  js_budget:
  memory_budget:
  fps_or_interaction_target:
  low_end_device_test:

3d:
  initial_bundle:
  model_texture_budget:
  time_to_first_useful_frame:
  fallback:
```

# 29.2 SVG performance traps

- thousands of paths/nodes;
- heavy filters/blurs;
- huge path precision;
- hidden offscreen detail;
- repeated inline duplicates;
- large embedded base64 images.

# 29.3 Raster traps

- source dimensions far above rendered need;
- PNG for large photographic imagery;
- no responsive sources;
- lazy-loading the LCP candidate;
- decoding many large images simultaneously;
- animation encoded inefficiently;
- unbounded retina asset duplication.

# 29.4 Canvas/GPU traps

- full-screen render loops when nothing changes;
- excessive DPR;
- uploading textures every frame;
- huge offscreen buffers;
- GPU context initialization for decorative effect;
- keeping animation alive offscreen/background;
- no lower-quality mode.

# 29.5 Measurement

Use:

- browser performance traces;
- Core Web Vitals where relevant;
- real-device/network tests;
- memory/GPU profiling for advanced graphics;
- image transfer/decode timing;
- RUM for field behavior;
- energy/thermal checks for sustained mobile graphics where material.

Do not infer production cost from source-file size alone.

---

# 30. Color management

Color values are meaningful only inside a color space and rendering pipeline.

# 30.1 Default web posture

For broad compatibility:

- treat sRGB as the conservative baseline;
- make brand tokens explicit;
- test dark/light backgrounds;
- preserve profiles where raster color matters;
- do not assume a designer's wide-gamut display matches the user's display.

# 30.2 Wide gamut / Display P3

Use when:

- the brand/art materially benefits;
- target devices support it sufficiently;
- the CSS/image pipeline supports correct color management;
- sRGB fallback/clipping is acceptable;
- QA includes non-P3 displays.

At the cutoff, CSS Color Level 4 remains a Candidate Recommendation Draft while defining color spaces including `display-p3`; browser implementation evidence therefore matters in addition to specification status.

# 30.3 ICC profiles

ICC v4 is the current profile architecture baseline listed by ICC; Display P3 has a registered encoding/profile.

For color-critical assets:

- know the working profile;
- preserve/convert intentionally;
- avoid double conversion;
- verify export strips or embeds profiles as intended;
- validate colors after CDN/image-pipeline transformation.

# 30.4 Brand color contract

Record more than hex:

```yaml
brand_color:
  semantic_name: action-primary
  srgb:
  display_p3_optional:
  dark_mode_variant:
  minimum_contrast_contexts:
  print_reference_if_needed:
```

No display color can be guaranteed physically identical across uncontrolled devices.

---

# 30.5 HDR — emerging web profile

Wide gamut and HDR are different dimensions:

```text
WIDE GAMUT
→ more chromatic range (e.g. Display P3)

HDR
→ higher/lower luminance range + HDR transfer/display behavior
```

At the cutoff, CSS Color HDR Level 1 is a **Working Draft dated 7 September 2026** [CSS-HDR-2026]. Treat HDR as `EMG`, not as the ordinary web color baseline.

If using HDR:

- maintain a deliberate SDR rendering/fallback;
- verify that highlights do not overwhelm adjacent UI/text;
- test brightness in real ambient/device conditions;
- avoid using extreme luminance as the sole required attention/state cue;
- verify screenshots/export/social/CDN transformations because the HDR chain may collapse to SDR;
- test performance/file-size implications of the chosen encoded format;
- recheck current browser/display support before consequential release.

Default production posture remains **sRGB first**, with Display P3 as a controlled progressive enhancement when the value is real.

# 31. Provenance and Content Credentials

# 31.1 Provenance ledger

Every material visual SHOULD be able to answer:

```yaml
asset_id:
created_by:
created_at:
source_files: []
source_urls: []
source_licenses: []
AI_generated: false
AI_edited: false
generator_or_editor:
model_version:
prompt_or_spec_hash:
reference_assets: []
manual_edits: []
content_credentials_status:
visible_disclosure_status:
approved_by:
release_locations: []
```

# 31.2 C2PA rule

C2PA Content Credentials provide a standardized tamper-evident framework for provenance/history assertions. The current C2PA technical specification at the research cutoff is **2.4 (April 2026)**.

Do not claim that C2PA means:

- the depicted event is true;
- the creator owns every right;
- the content is unbiased;
- the image has never been misleadingly cropped/contextualized;
- the model output is factually correct.

It is provenance evidence, not epistemic proof.

# 31.3 Transformation chain

Image CDNs, social networks, screenshots, exports and recompression may strip metadata.

Therefore:

- test whether your actual delivery chain preserves credentials;
- retain an internal provenance record even when external metadata is lost;
- re-sign/update provenance when your process legitimately transforms assets and your implementation supports it;
- do not preserve obsolete provenance that falsely describes a materially transformed asset.

# 31.4 AI-origin signals

Tool-specific signals such as SynthID or provider-specific verification can complement C2PA but remain implementation-specific. Treat them as one layer in a provenance stack.

---

# 31.5 Durable provenance and released-artifact identity — V2.1

Embedded provenance can be removed by platforms, editors and transcodes. C2PA 2.4 includes mechanisms for Content Credentials beyond a simplistic “metadata stays inside the file forever” mental model, including hard/soft binding patterns used to associate or recover provenance [C2PA-DURABLE-2.4].

A material provenance strategy SHOULD therefore define:

```yaml
accepted_artifact_sha256:
embedded_manifest_expected: true|false
platforms_known_to_strip_or_transform: []
soft_binding_or_recovery_used:
repository_or_external_manifest_record:
re_sign_after_authorized_edit: true|false
visible_disclosure_separate_from_machine_provenance: true|false
verification_test:
```

Do not claim “provenance preserved” because the source file originally contained a C2PA manifest. Verify the distributed derivative. OpenAI likewise documents that C2PA metadata can be removed by platforms/editing while watermark-style signals trade richer context for transformation robustness [OAI-PROVENANCE].

The internal asset ledger remains the canonical production evidence when external distribution strips public signals.

# 32. Synthetic-content transparency

Transparency obligations are jurisdiction/context dependent.

For EU deployments, Article 50 of Regulation (EU) 2024/1689 applies from 2 August 2026 to specified AI-transparency cases. Current Commission guidance states, among other things, that deployers of qualifying deepfake content must make disclosure clear/perceivable and cannot rely only on machine-readable marking to fulfill the deployer disclosure obligation.

Production controls SHOULD therefore separate:

```text
MACHINE-READABLE ORIGIN
  C2PA / watermark / metadata

VISIBLE / AUDIBLE DISCLOSURE
  label or context shown to people where required

EDITORIAL CONTEXT
  caption, concept label, method note where useful
```

Do not over-label obviously illustrative creative work where the applicable rule does not require it, but do not hide material synthetic/documentary ambiguity behind metadata.

---

## 32.4 V2.1 EU status clarification

The compliance layers are distinct:

```text
EU AI ACT ARTICLE 50
→ binding legal requirement where scope applies

EUROPEAN COMMISSION ARTICLE 50 GUIDELINES
→ official interpretive/implementation guidance

FINAL CODE OF PRACTICE ON TRANSPARENCY OF AI-GENERATED CONTENT
→ voluntary implementation code published 10 June 2026; useful compliance overlay, not the statute itself
```

The final Code of Practice was published on 10 June 2026 [EU-AI-CODE-2026]. Keep this status separate from the binding regulation and obtain qualified legal interpretation for applicability, exceptions, artistic/creative content and jurisdictional edge cases.

# 33. Rights, licensing and likeness

**This section is an engineering governance standard, not legal advice.**

# 33.1 Rights gate

Before public/commercial release, answer when material:

1. Who created each source component?
2. What license applies?
3. Is commercial use allowed?
4. Are derivatives/edits allowed?
5. Is attribution required?
6. Is share-alike triggered?
7. Is redistribution as a template/asset allowed?
8. Are logos/trademarks depicted and in what context?
9. Are identifiable people depicted?
10. Are model/property releases relevant?
11. Were AI reference images lawfully sourced for this use?
12. What do current generator/service terms say about output and input rights?
13. Could the output substantially reproduce protected third-party material?
14. Does the target jurisdiction recognize copyright/related rights in the resulting AI-assisted work?
15. Does the release need synthetic/deepfake disclosure?

# 33.2 Creative Commons

Do not treat “Creative Commons” as one permission set.

Examples:

- `CC BY` — attribution required;
- `CC BY-SA` — attribution + share-alike;
- `CC BY-ND` — distribution of adapted material prohibited;
- `CC BY-NC` — noncommercial limitation;
- combinations add restrictions.

Always inspect the actual license version and terms.

# 33.3 AI copyrightability

U.S. Copyright Office guidance is one jurisdictional example: current Part 2 guidance states that AI-assisted work can be protected where sufficient human-authored expression exists, while mere prompting alone does not by itself supply the required human authorship for generated output.

Evergreen rule:

> **Do not assume exclusive copyright in a purely generated asset. Record human creative contribution and obtain jurisdiction-specific advice when exclusivity matters commercially.**

# 33.4 Likeness and identity

High-risk uses include:

- a real person's face/body/voice;
- implied endorsement;
- employee/customer likeness;
- political/public-interest depictions;
- minors;
- sensitive context;
- realistic fabricated events.

Use consent, contractual rights and disclosure as applicable. Generation capability is not permission.

---

# 33.5 Rights metadata, digital replicas and transformation

Rights do not disappear when the visual is cropped, generated around, upscaled, inpainted or converted to another format.

V2.1 adds two explicit checks:

1. **Rights/credit metadata is not disposable optimization data.** If IPTC/embedded metadata carries creator/license obligations, preserve it or migrate the same information into a durable publishing/asset record before stripping the file metadata [GOOGLE-IMG-META].
2. **Real-person likeness can create a separate digital-replica/publicity problem from copyright.** The U.S. Copyright Office's AI study has a dedicated Part 1 on digital replicas; this is U.S.-specific evidence, not a global likeness law [USCO-AI].

A transformation pipeline MUST NOT claim new ownership merely because it used AI, compression, style transfer or compositing.

# 34. Rigorous visual QA system

Visual QA is a release discipline.

# 34.1 Twelve QA dimensions

1. **Intent QA** — does the visual answer the intended question?
2. **Semantic QA** — are relationships/states/data represented correctly?
3. **Factual QA** — are claims, labels, product screens and numbers correct?
4. **Art-direction QA** — hierarchy, composition, brand, emotion and craft.
5. **Generative QA** — anatomy, geometry, text, impossible objects, artifacts, hidden drift.
6. **Responsive QA** — crops, reflow, simplification, dense labels, safe areas.
7. **Accessibility QA** — alternatives, contrast, color independence, motion, interaction.
8. **Localization QA** — translation capacity, RTL, symbols, locale-specific screenshots.
9. **Technical/performance QA** — format, bytes, decode, paint/GPU, dimensions, alpha, color.
10. **Security/privacy/metadata QA** — capture, upload, active content, secrets and metadata handled safely.
11. **Representation/extractability QA** — consequential people/roles reviewed; durable facts also available in structured form.
12. **Provenance/rights QA** — source, license, model/tool record, disclosure, artifact identity, metadata and lineage.

# 34.2 Automated checks

Automate what is deterministic:

- missing dimensions/alt attributes where applicable;
- byte-budget violations;
- file-type/format checks;
- SVG lint/optimization/security rules;
- contrast calculations for controlled colors;
- broken image URLs;
- visual regression snapshots;
- responsive screenshot matrices;
- image aspect-ratio tests;
- C2PA/provenance presence where required;
- forbidden active SVG/script/external-resource patterns where policy can be statically checked;
- embedded metadata policy checks for known sensitive/right/provenance fields;
- 3D format/extension validation and asset-budget checks where applicable;
- duplicate/oversized assets;
- raster intrinsic-vs-rendered dimension ratio;
- animation/reduced-motion CSS tests where possible.

# 34.3 Human checks

Humans must still inspect:

- visual hierarchy;
- semantic correctness;
- generated artifacts;
- crop/focal point;
- cultural meaning;
- data honesty;
- brand congruence;
- screenshot truth;
- nuanced accessibility;
- screenshot/reference privacy or secret leakage;
- representation/systematic stereotype risk where material;
- metadata/rights/provenance conflicts;
- rights/context ambiguity;
- whether the visual actually helps.

# 34.4 QA viewing matrix

At minimum for material web/app assets:

```text
small mobile
large mobile
compact desktop/tablet
wide desktop
light mode
dark mode if supported
100% zoom
200–400% zoom/reflow context as relevant
reduced motion if motion exists
one low-end / throttled profile for heavy graphics
```

Add target locales, browsers, AT and devices based on product support policy.

# 34.5 Generated-image defect checklist

Inspect at 100% and final rendered size:

- [ ] subject count correct
- [ ] hands/fingers/limbs correct where visible
- [ ] eye/glasses/jewelry consistency
- [ ] reflections/shadows physically coherent enough
- [ ] product geometry preserved
- [ ] labels/logos not mutated
- [ ] no accidental text/gibberish
- [ ] no duplicate/merged objects
- [ ] perspective coherent
- [ ] crop safe at all targets
- [ ] no halo/fringe on transparency
- [ ] no embedded watermark or imitation mark not intended
- [ ] background artifacts absent
- [ ] representation/stereotype review passed

# 34.6 Release gate

A material visual is release-ready only when:

```text
INTENT PASS
+ TRUTH PASS
+ ART DIRECTION PASS
+ ACCESSIBILITY PASS
+ RESPONSIVE/LOCALE PASS
+ TECHNICAL/PERFORMANCE PASS
+ SECURITY/PRIVACY/METADATA PASS
+ REPRESENTATION/EXTRACTABILITY PASS
+ RIGHTS/PROVENANCE PASS
```

A beautiful asset with one blocker is not release-ready.

---

# 35. Decision frameworks

# 35.1 Should this be a graphic at all?

```text
Can clear text express it faster with less ambiguity?
  yes → text may be better
  no  → continue

Does spatial/visual structure materially improve understanding, proof, memory or emotion?
  no → avoid decorative production cost
  yes → build visual
```

# 35.2 Diagram vs illustration

```text
Need the viewer to infer exact relationships/sequence/state?
  → DIAGRAM

Need a concept, analogy, emotional framing or editorial viewpoint?
  → ILLUSTRATION

Need both?
  → diagrammatic illustration, but keep semantic layer explicit
```

# 35.3 Real screenshot vs rebuilt UI

```text
Need proof of what product actually ships?
  → REAL SCREENSHOT / LIVE UI

Need responsive/localizable explanation of a stable product pattern?
  → HTML RECONSTRUCTION may be justified

Need future concept?
  → MOCKUP clearly classified as concept
```

# 35.4 Generate vs draw/code vs stock/license

Score 0–3:

| Dimension | Generated | Custom draw/code | Stock/licensed |
|---|---:|---:|---:|
| Uniqueness required | 3 | 3 | 1 |
| Exact geometry | 1–2 | 3 | 1–2 |
| Speed to first draft | 3 | 1–2 | 3 |
| Exact editability | 2 | 3 | 1–2 |
| Brand consistency at scale | 2 with system | 3 | 1 |
| Rights certainty | contextual | 3 if original | often strong if license fits |
| Factual fidelity | 1–2 | 3 | 2–3 depending source |
| High-volume variation | 3 | 1–2 | 1–2 |

Do not sum mechanically. Identify the dimension that can fail the release.

# 35.5 Static vs interactive

Use interaction when it enables:

- filtering;
- zoom/detail-on-demand;
- exploration of dense data;
- direct manipulation;
- product demonstration;
- task completion.

Do not add interaction merely to create engagement. Hidden information has a discovery cost.

---

# 35.6 3D master vs runtime delivery

```text
Is 3D actually required for the user task?
  no → static / video / HTML/SVG
  yes → continue

Does an authoring master already exist?
  yes → create a runtime export contract; do not ship the master by default

Need interoperable web delivery?
  → evaluate glTF 2.0 / GLB + compatible extensions

Textures dominate payload/memory?
  → evaluate resolution budgets + KTX2/Basis-style delivery

Scene/detail exceeds representative device budget?
  → simplify / split / LOD / progressive load

3D is supplementary?
  → provide static/2D equivalent and avoid gating content on renderer success
```

# 35.7 Metadata policy decision

```text
For each metadata field/category ask:

Does it create privacy/security exposure?
  → minimize/remove unless justified

Does it establish creator/license/credit obligations?
  → preserve or migrate to durable rights record

Does it support provenance?
  → preserve/re-sign/recover according to provenance policy

Does rendering depend on it (ICC/orientation)?
  → preserve/normalize and visually verify

Unknown/unowned metadata?
  → inspect before release; do not blindly preserve or strip
```

# 36. Production Plays

## PLAY-GFX-01 — Select the medium

**Trigger:** new visual asset or major redesign.

**Inputs:** Visual Production Contract.

**Steps:**

1. classify communication job;
2. classify semantic/text/localization needs;
3. classify static vs dynamic/interactive;
4. classify factual fidelity;
5. classify pixel vs vector detail;
6. estimate responsive transformations;
7. estimate accessibility burden;
8. estimate runtime performance burden;
9. shortlist 1–2 media;
10. prototype the riskiest assumption;
11. choose the least complex adequate medium;
12. record why rejected alternatives were not needed if the decision is material.

**Output:** medium decision + acceptance criteria.

## PLAY-GFX-02 — Build a system/process diagram

1. write entities/steps in plain text;
2. define relationships and relationship types;
3. define boundaries/owners;
4. remove relationships that are merely decorative;
5. choose reading direction;
6. draft in grayscale;
7. validate with a non-author: “what does each line/shape mean?”;
8. add labels/signaling;
9. apply brand/art direction;
10. build responsive representations;
11. add accessible text equivalent;
12. QA final implementation.

**Fail condition:** a reviewer infers a relationship that the model does not intend.

## PLAY-GFX-03 — AI-generated editorial/concept illustration

1. define metaphor and unacceptable interpretation;
2. split deterministic vs generative elements;
3. build art-direction spec;
4. choose model profile;
5. generate materially different composition concepts;
6. select on intent, not prettiness alone;
7. lock composition/subject;
8. edit failures one axis at a time;
9. composite exact logo/text/UI outside generated pixels;
10. run artifact/representation review;
11. build responsive crops;
12. add provenance/rights record;
13. accessibility/localization treatment;
14. release QA.

## PLAY-GFX-04 — AI image edit / product preservation

1. start from the real source image;
2. list protected invariants;
3. state one targeted change;
4. use mask/local edit when available;
5. compare before/after at high zoom;
6. verify labels, geometry, color and identity;
7. reject if non-target areas drift materially;
8. use deterministic retouching when surgical control is insufficient;
9. update provenance record.

## PLAY-GFX-05 — Product screenshot / mockup

1. identify proof vs concept purpose;
2. capture known product version/state;
3. sanitize data;
4. capture at intended locale/theme;
5. choose crop and annotation;
6. preserve UI proportions;
7. create responsive variants;
8. add alt/description if meaningful;
9. record version/state;
10. replace when product changes materially.

## PLAY-GFX-06 — Responsive visual transformation

For each breakpoint/context:

1. identify semantic invariants;
2. test current asset at final rendered size;
3. reflow if topology is wrong;
4. re-crop if focal point is wrong;
5. simplify redundant detail;
6. re-represent if interaction/space changes the correct medium;
7. validate labels and touch targets;
8. re-run accessibility and performance checks.

## PLAY-GFX-07 — Web raster delivery

1. identify rendered size distribution;
2. choose candidate formats;
3. encode quality ladder;
4. visually inspect;
5. generate responsive widths/crops;
6. configure intrinsic dimensions;
7. configure loading/priority;
8. test LCP/transfer/decode;
9. verify color profile;
10. verify provenance retention if required;
11. ship through CDN pipeline;
12. inspect the delivered—not source—asset.

## PLAY-GFX-08 — Rights/provenance gate

1. inventory source inputs/references;
2. classify license/ownership;
3. verify derivative/commercial/attribution constraints;
4. review trademark/likeness/property issues;
5. record AI model/tool and current terms where material;
6. determine C2PA/origin-signal handling;
7. determine visible synthetic-content disclosure;
8. obtain qualified legal review for unresolved high-consequence issues;
9. release only when rights state is known enough for the intended use.

## PLAY-GFX-09 — Final visual QA

Run in order:

```text
TRUTH
→ MEANING
→ HIERARCHY
→ ARTIFACTS
→ RESPONSIVE
→ ACCESSIBILITY
→ LOCALIZATION
→ PERFORMANCE
→ COLOR
→ SECURITY / PRIVACY / METADATA
→ REPRESENTATION / EXTRACTABILITY
→ PROVENANCE / RIGHTS
→ DELIVERY
```

Do not polish a graphic whose truth/meaning gate is still failing.

---

## PLAY-GFX-10 — Sanitize a screenshot or reference image before external/AI use

1. classify the source and audience;
2. duplicate from the controlled source — never destructively edit the only evidence copy;
3. inspect visible PII/customer data, emails, names, avatars, messages, IDs, URLs, tenant/workspace names, auth/session/debug information;
4. inspect hidden metadata where relevant;
5. replace with approved synthetic/sample data or irreversibly redact at the pixel layer;
6. crop only after deciding what contextual truth must remain;
7. verify redaction at 100% and after export/transcode;
8. record whether the file may be uploaded to the chosen third-party model/provider;
9. retain the sanitized derivative identity/hash;
10. do not use blur as the only redaction for high-consequence secrets if reconstruction remains plausible.

## PLAY-GFX-11 — Ship an untrusted SVG safely

1. classify whether vector semantics are actually needed;
2. if not, consider trusted rasterization;
3. parse/rewrite through the approved SVG sanitizer/allowlist;
4. reject scripts, event handlers and disallowed external/foreign resources;
5. bound dimensions/path/filter/resource complexity;
6. emit a clean controlled derivative rather than serving the original bytes as trusted markup;
7. choose embedding context deliberately;
8. set content/security policy appropriate to the application;
9. verify rendering and accessibility;
10. retain original and sanitized identities for audit if required.

## PLAY-GFX-12 — Deliver a 3D web asset

1. define the 3D user job and fallback;
2. retain the authoring master separately;
3. export an explicit runtime scene contract;
4. validate node/mesh/material/animation semantics;
5. simplify geometry based on representative camera/task;
6. resize/transcode textures; evaluate KTX2/Basis-style delivery where useful;
7. define LOD/progressive-loading behavior if justified;
8. validate glTF/GLB/extensions or other chosen runtime format;
9. profile bytes, startup, memory, draw calls, GPU/CPU and thermal/battery where relevant;
10. verify low-capability/reduced-motion/renderer-failure fallback;
11. verify accessibility/external labels/data;
12. release the exact validated derivatives and hashes.

## PLAY-GFX-13 — Representation audit for generated human/social imagery

1. state the communication job and intended population/roles;
2. identify attributes the visual must not infer or stereotype;
3. define meaningful review slices before generation when consequence warrants it;
4. generate a representative candidate/eval set using the production prompt/reference/revision path;
5. review presence/absence, role assignment, framing, clothing/context, age/body/disability/cultural cues and other material axes;
6. separate deliberate art direction from model default;
7. inspect whether provider-side prompt revision changes representation when visible/observable;
8. correct the art direction/model/reference workflow rather than manually fixing only the final single image when a systemic pattern matters;
9. obtain domain/cultural review when consequences justify it;
10. retain scoped findings; do not claim the model/workflow is globally “unbiased.”

# 37. Anti-pattern catalog

## AP-01 — Medium-first design

> “Let's make a 3D hero.”

Failure: solution chosen before communication job.

## AP-02 — AI slop

Symptoms:

- generic neon/glass/gradient styling;
- meaningless nodes/sparkles;
- pseudo-technical detail;
- excessive depth;
- image says “technology” but explains nothing.

Fix: return to the question the visual must answer.

## AP-03 — Prompt soup

Hundreds of adjectives, conflicting styles and no hierarchy.

Fix: structured spec + one-axis iteration.

## AP-04 — Regeneration roulette

A correct composition is repeatedly discarded to fix one local detail.

Fix: lock invariants; edit/mask/composite.

## AP-05 — Generated product fiction

Beautiful fake dashboards presented as current product.

Fix: real UI proof or explicit concept label.

## AP-06 — Decorative connectors

Lines imply relationships nobody can define.

Fix: delete or assign semantics.

## AP-07 — Mobile postage stamp

Desktop diagram scaled to 320px.

Fix: reflow/re-represent.

## AP-08 — Icon cryptography

Unfamiliar glyphs with no labels because “clean design.”

Fix: labels/context.

## AP-09 — Data sculpture

3D/gradients/areas chosen because they look impressive, making values harder to compare.

Fix: comparison-first encoding.

## AP-10 — Alt-text aftercare

Complex chart is inaccessible; team adds `alt="chart"` at release.

Fix: design text/table/interaction alternatives from the start.

## AP-11 — Pixelized typography system

Headlines/labels baked into artwork, blocking localization, accessibility and updates.

Fix: deterministic real text overlay.

## AP-12 — Asset gigantism

4K/8K source served to every viewport.

Fix: responsive derivatives.

## AP-13 — Format cargo cult

“All images must be AVIF” or “all illustrations must be SVG.”

Fix: content-specific encoding tests.

## AP-14 — Provenance theatre

C2PA badge presented as “verified true.”

Fix: describe what provenance does and does not establish.

## AP-15 — License laundering

A web-found image is passed through AI editing and treated as newly owned.

Fix: rights follow source and applicable law/terms; editing is not a rights reset button.

## AP-16 — Visual regression absolutism

Pixel diff passes, but diagram meaning is wrong or generated hand has six fingers.

Fix: human semantic/craft QA.

## AP-17 — Wide-gamut surprise

P3 source looks great on one designer monitor and clipped/dull elsewhere.

Fix: managed profile + fallback QA.

## AP-18 — Heavy background runtime

WebGL scene consumes battery/GPU for decorative hero motion.

Fix: static/video/raster fallback unless interactivity earns runtime.

---

## AP-19 — Prompt-as-build artifact

The team stores a prompt and assumes it can recreate the released image later.

Fix: retain exact accepted output + hash + execution provenance.

## AP-20 — Metadata vacuum cleaner

“Optimize” means strip every metadata field.

Failure: rights/provenance/color/orientation data can disappear along with privacy-sensitive metadata.

Fix: classify metadata lanes and transform intentionally.

## AP-21 — Metadata hoarding

Every EXIF/IPTC/internal field is preserved forever “for provenance.”

Failure: location/device/internal data can leak.

Fix: minimize privacy/security metadata while separately preserving justified rights/provenance/rendering data.

## AP-22 — Trusted-by-extension SVG

An `.svg` upload is treated as a harmless image and injected inline.

Fix: active-content threat boundary + sanitize/rewrite or rasterize.

## AP-23 — 3D authoring dump

A Blender/CAD/export scene with source-resolution textures ships directly to the browser.

Fix: runtime asset pipeline, format/extension validation, geometry/texture budgets and fallback.

## AP-24 — HDR prestige mode

HDR brightness is added because it looks “next-gen.”

Fix: SDR baseline, task/value reason, luminance/accessibility/fallback QA; treat HDR as emerging.

## AP-25 — Bias-by-single-image review

One generated team image looks acceptable, so the workflow is declared fair.

Fix: use risk-proportional system/slice evaluation when representation consequences matter.

## AP-26 — Diagram as database

Important relationships exist only as pixels/paths in a diagram.

Fix: keep canonical structured relationships separately and render views from/against them where practical.

# 38. Checklists

# 38.1 Visual brief checklist

- [ ] communication job named
- [ ] audience/context named
- [ ] one primary question named
- [ ] desired takeaway named
- [ ] factual constraints known
- [ ] concept vs real classification known
- [ ] brand invariants known
- [ ] accessibility class known
- [ ] responsive contexts known
- [ ] localization/RTL known
- [ ] performance role known
- [ ] source/rights constraints known

# 38.2 Generative visual checklist

- [ ] deterministic vs generative layers separated
- [ ] references have explicit roles
- [ ] references are permitted for intended use
- [ ] prompt/spec states composition and invariants
- [ ] candidates represent distinct hypotheses
- [ ] approved elements locked before refinement
- [ ] local edits used instead of unnecessary regeneration
- [ ] exact text/logo/data verified or deterministic
- [ ] artifacts reviewed at 100%
- [ ] representation bias/likeness reviewed
- [ ] accepted artifact stored
- [ ] model/tool/version recorded
- [ ] provenance/disclosure state recorded

# 38.3 Diagram checklist

- [ ] every node means something
- [ ] every connector means something
- [ ] directionality explicit
- [ ] groups/boundaries meaningful
- [ ] no false architectural implication
- [ ] loops/branches/exceptions shown when material
- [ ] labels readable at final size
- [ ] mobile representation works
- [ ] accessible alternative exists
- [ ] non-color cues sufficient

# 38.4 Screenshot checklist

- [ ] real vs concept classification clear
- [ ] product version/state known
- [ ] sensitive/customer/secret data removed or replaced
- [ ] hidden metadata reviewed before external/model upload
- [ ] sample data credible and non-deceptive
- [ ] locale/theme appropriate
- [ ] no dev/debug residue
- [ ] crop preserves context
- [ ] annotations separate from UI truth
- [ ] output crisp at target size
- [ ] update trigger assigned

# 38.5 SVG checklist

- [ ] deliberate viewBox
- [ ] accessible name strategy
- [ ] decorative SVG hidden appropriately
- [ ] meaningful text not unnecessarily path-converted
- [ ] IDs safe for repeated inline use
- [ ] CSS/currentColor strategy works
- [ ] dark/RTL states tested if relevant
- [ ] path/filter complexity reasonable
- [ ] untrusted SVG sanitized/re-written under explicit allowlist
- [ ] scripts/events/external/foreign resources reviewed or prohibited
- [ ] embedding context and security headers/policy reviewed
- [ ] responsive scaling/reflow verified

# 38.6 Raster delivery checklist

- [ ] correct source master
- [ ] format tested
- [ ] compression visually accepted
- [ ] responsive widths/crops generated
- [ ] intrinsic dimensions set
- [ ] LCP loading strategy correct
- [ ] alpha edges clean
- [ ] color profile intentional
- [ ] CDN transformation tested
- [ ] metadata lanes classified (privacy / rights / provenance / rendering)
- [ ] provenance metadata strategy intentional
- [ ] JPEG XL used only with explicit compatibility/fallback validation when applicable

# 38.7 Accessibility checklist

- [ ] decorative vs informative classification
- [ ] short alternative
- [ ] long description/table for complex content when needed
- [ ] required graphic contrast
- [ ] no color-only meaning
- [ ] images-of-text decision justified
- [ ] reduced-motion behavior
- [ ] keyboard model for interactive graphic
- [ ] focus visible where interactive
- [ ] zoom/reflow behavior
- [ ] tested with relevant AT/browser combinations for material graphics

# 38.8 Rights/provenance checklist

- [ ] creator/source known
- [ ] license known
- [ ] commercial use permitted
- [ ] derivative rights permitted
- [ ] attribution obligations satisfied
- [ ] likeness/property/trademark reviewed
- [ ] AI input/output terms checked when material
- [ ] human authorship/exclusivity assumption reviewed
- [ ] accepted delivered artifact hash recorded for material assets
- [ ] C2PA/origin signals checked where required
- [ ] provenance preservation/recovery after transform/distribution tested when claimed
- [ ] visible disclosure requirement checked
- [ ] internal provenance record retained

# 38.9 Final QA checklist

- [ ] intent pass
- [ ] factual pass
- [ ] semantic pass
- [ ] hierarchy pass
- [ ] craft/artifact pass
- [ ] brand pass
- [ ] mobile pass
- [ ] desktop pass
- [ ] locale/RTL pass where applicable
- [ ] accessibility pass
- [ ] performance pass
- [ ] color pass
- [ ] security/privacy/metadata pass
- [ ] representation/extractability pass
- [ ] provenance/rights pass
- [ ] delivered asset inspected in production-like surface

---

# 38.10 3D delivery checklist — V2.1

- [ ] 3D capability has a named user job
- [ ] authoring master separated from runtime derivative
- [ ] runtime format/extensions documented
- [ ] glTF 2.0/GLB evaluated where interoperable delivery is desired
- [ ] glTF 2.1 treated as watch material unless status changed
- [ ] geometry budget validated
- [ ] texture resolution/memory budget validated
- [ ] KTX2/Basis-style texture delivery evaluated where useful
- [ ] LOD/progressive strategy justified and visually checked
- [ ] startup / interaction / memory / GPU cost measured
- [ ] renderer-failure/low-capability fallback works
- [ ] accessible textual/static equivalent exists when needed
- [ ] exact released derivatives/hashes retained

# 38.11 Sensitive capture/reference checklist — V2.1

- [ ] data classification known
- [ ] PII/customer/tenant data reviewed
- [ ] secrets/tokens/URLs/debug residue reviewed
- [ ] notification/background-window leakage reviewed
- [ ] irreversible pixel redaction verified
- [ ] hidden metadata reviewed
- [ ] provider/model upload permission acceptable
- [ ] sanitized derivative retained separately from evidence master

# 38.12 Metadata checklist — V2.1

- [ ] privacy/security metadata classified
- [ ] rights/credit metadata classified
- [ ] provenance metadata classified
- [ ] rendering/color/orientation metadata classified
- [ ] each lane has preserve/remove/migrate rule
- [ ] transformation/CDN/export behavior verified
- [ ] public derivative inspected after final delivery

# 39. Templates

# 39.1 Visual acceptance record

```yaml
visual_id:
release:
owner:

claims:
  - id:
    claim:
    evidence_source:
    verification:

visual_acceptance:
  intent: pass|fail
  semantics: pass|fail
  factual: pass|fail
  art_direction: pass|fail
  generated_artifacts: pass|fail|na
  responsive: pass|fail
  accessibility: pass|fail
  localization: pass|fail|na
  performance: pass|fail
  color: pass|fail
  provenance: pass|fail
  rights: pass|fail

exceptions: []
residual_risk:
approved_by:
accepted_artifact_hash:
```

# 39.2 AI visual generation record

```yaml
asset_id:
provider:
model:
model_snapshot_or_version:
created_at:
workflow: generation|edit|composite|inpaint|outpaint
prompt_spec_version:
input_references:
  - id:
    role:
    source:
    license:
provider_revised_prompt_if_exposed:
reference_hashes: []
accepted_output:
accepted_output_sha256:
manual_edits:
exact_elements_overlaid:
provenance_signal:
visible_disclosure:
reviewers:
```

# 39.3 Diagram semantics legend

```yaml
node_types:
  - type:
    meaning:
    visual_encoding:
edge_types:
  - type:
    meaning:
    visual_encoding:
boundaries:
  - type:
    meaning:
state_colors:
  - token:
    meaning:
    non_color_redundancy:
```

---

# 39.4 Runtime visual asset manifest — V2.1

```yaml
asset_id:
source_master:
  path_or_id:
  source_hash:
  owner:

release_derivatives:
  - role:
    path_or_url:
    sha256:
    mime_or_format:
    width_height_or_scene_bounds:
    color_profile:
    byte_size:

runtime_3d:
  core_format:
  format_version:
  required_extensions: []
  optional_extensions: []
  geometry_budget:
  texture_delivery:
  lod_policy:
  fallback_asset:

metadata_policy:
  privacy_security:
  rights_credit:
  provenance:
  rendering_color_orientation:

accessibility_equivalent:
security_sanitization:
rights_record:
provenance_record:
release_version:
```

# 40. One-page Golden Standard

```text
1. Start with the viewer question, not the format.
2. State whether the visual is factual, conceptual, representative or decorative.
3. Select the least complex medium that preserves meaning and required behavior.
4. Build hierarchy before style.
5. Keep exact facts, UI, logos, data and critical text deterministic when consequence warrants it.
6. Use generative AI as a controlled renderer/editor, not an authority.
7. Prefer edits over regeneration once important invariants are correct.
8. Label reference images by role and rights.
9. Make every diagram connection semantic.
10. Use data encodings for comparison, not spectacle.
11. Use real screenshots for real product proof.
12. Label ambiguous icons.
13. Transform visuals across breakpoints; do not just shrink.
14. Use real/localizable text whenever feasible.
15. Design text alternatives, non-color cues, contrast and motion behavior from the start.
16. Deliver responsive images at appropriate dimensions/quality.
17. Measure network + decode + render + GPU/memory cost where applicable.
18. Manage color spaces deliberately; do not assume hex = appearance.
19. Preserve provenance records; understand that provenance is not truth.
20. Clear rights, licenses, likeness and disclosure before release.
21. Combine automated regression with human semantic/craft QA.
22. Inspect the asset as delivered in the real interface.
23. Treat screenshots, SVG uploads, references and metadata as security/privacy inputs.
24. Retain the exact accepted generated/output asset; prompt/model history is not reproducibility.
25. Separate 3D authoring masters from runtime delivery assets and budgets.
26. Keep durable facts/relationships machine-readable outside the pixels.
27. Treat P3 as progressive enhancement and HDR as emerging/version-sensitive.
28. Evaluate generated human/social representation at the deployed-system level when consequence warrants it.
```

---

# 41. V2.1 validation scenarios

The Golden Master SHOULD be field-tested on at least these scenarios before promotion to `VALIDATED`:

1. **B2B SaaS system diagram** — HTML/SVG responsive hybrid, localized to a long-string locale.
2. **Sensitive enterprise screenshot** — sanitize PII/tenant/debug data and metadata before external model editing.
3. **Third-party SVG upload** — sanitize/rewrite/rasterize under the defined trust-boundary policy.
4. **Interactive 3D product visual** — glTF/KTX-style runtime delivery, constrained mobile device, renderer fallback and accessible product details.
5. **AI-generated editorial hero** — generated base + real product screenshot + HTML headline.
6. **Product workflow graphic** — desktop horizontal → mobile vertical transformation.
7. **Data dashboard visualization** — accessible chart + table + color-blind-safe redundant encodings.
8. **High-density interactive visualization** — SVG vs Canvas benchmark and accessibility comparison plus matrix/table alternative.
9. **3D product viewer** — WebGL/WebGPU capability/fallback/performance/reduced-motion test.
10. **Screenshot documentation set** — version tracking, privacy sanitization, metadata review and update workflow.
11. **Global icon set** — ambiguity test, RTL policy and accessible naming.
12. **AI-edited product photography** — geometry/label preservation, accepted-output hash and provenance.
13. **Synthetic realistic person/event visual** — disclosure, likeness, representation, provenance and rights review.

Validation must include at least one non-author operator executing the relevant Plays without oral guidance.

---

# 42. Research/source audit register

## 42.1 Internal foundation sources

### BASE-DESIGN — Universal Design Principles Master Playbook V2.0
**Role:** inherited visual hierarchy, attention, comprehension, aesthetics, imagery, data visualization, icons and design testing.
**Status:** project source, Double-Validated Golden Standard, research cutoff 2026-09-21.
**Key inherited rule:** clarity/hierarchy/grouping/legibility before folklore; task-specific visual communication.

### BASE-UX — UX Master Playbook V2.0
**Role:** user outcome, context, accessibility, localization, performance, control, research and validation.
**Status:** project source, Double-Validated Golden Standard, research cutoff 2026-09-21.

### BASE-UI — UI Master Playbook V2.0
**Role:** system legibility, semantics/state/behavior agreement, responsive adaptation, accessibility and design-system discipline.
**Status:** project source, Double-Validated Golden Standard, research cutoff 2026-09-21.

### BASE-ARTDIR — Digital Visual Design & Art Direction Master Playbook
**Status:** `REQUESTED_BUT_NOT_RETRIEVABLE` during both V2.0 construction and V2.1 second-pass audit.
**Use:** none; no claims were silently attributed to it.

### BASE-WEB — Web & Frontend Engineering Master Playbook V2.0
**Role:** adjacent engineering constraints for browser semantics, accessibility, performance and progressive platform use.

---

## 42.2 Accessibility and web-platform sources

### W3C-WCAG22 — Web Content Accessibility Guidelines (WCAG) 2.2
URL: https://www.w3.org/TR/WCAG22/
Evidence: `W3C_RECOMMENDATION / NORMATIVE`
Use: text alternatives, non-text contrast, images of text, reflow, animation/accessibility baseline.
Limitation: conformance standard, not proof that a visual is usable or comprehensible.

### W3C-NONTEXT — Understanding SC 1.1.1 Non-text Content
URL: https://www.w3.org/WAI/WCAG22/Understanding/non-text-content
Evidence: `W3C_NORMATIVE_SUPPORTING_GUIDANCE`
Use: simple vs complex image alternatives, charts/diagrams.

### W3C-NONTEXT-CONTRAST — Understanding SC 1.4.11 Non-text Contrast
URL: https://www.w3.org/WAI/WCAG22/understanding/non-text-contrast.html
Evidence: `W3C_NORMATIVE_SUPPORTING_GUIDANCE`
Use: 3:1 requirement for meaningful graphical objects, exceptions and chart examples.

### W3C-IMAGES-OF-TEXT — Understanding SC 1.4.5 Images of Text
URL: https://www.w3.org/WAI/WCAG22/Understanding/images-of-text
Evidence: `W3C_NORMATIVE_SUPPORTING_GUIDANCE`
Use: prefer real text when technology can achieve the presentation, scoped exceptions.

### W3C-ALT-TREE — WAI Images Alt Decision Tree
URL: https://www.w3.org/WAI/tutorials/images/decision-tree/
Evidence: `W3C_AUTHORING_GUIDANCE`
Use: functional/decorative/informative image alternative decisions.

### W3C-REDUCED-MOTION — Technique C39, prefers-reduced-motion
URL: https://www.w3.org/WAI/WCAG22/Techniques/css/C39
Evidence: `W3C_TECHNIQUE`
Use: one sufficient technique for reducing interaction-triggered motion.
Limitation: technique, not the only valid implementation.

### WHATWG-CANVAS — HTML Living Standard: Canvas
URL: https://html.spec.whatwg.org/multipage/canvas.html
Evidence: `LIVING_STANDARD`
Use: Canvas semantics, resolution-dependent bitmap nature, fallback content/accessibility obligations.

### WHATWG-IMAGES — HTML Living Standard: Images/Embedded Content
URL: https://html.spec.whatwg.org/multipage/images.html
Evidence: `LIVING_STANDARD`
Use: image decoding and responsive-image semantics.

### WHATWG-LOADING — HTML `loading` / `fetchpriority`
URL: https://html.spec.whatwg.org/multipage/embedded-content.html
Evidence: `LIVING_STANDARD`
Use: native image loading and fetch-priority behavior.

### W3C-SVG2 — Scalable Vector Graphics (SVG) 2
URL: https://www.w3.org/TR/SVG2/
Evidence: `W3C_GRAPHICS_SPEC / STATUS_VERSION_SENSITIVE`
Use: SVG platform semantics.
Limitation: specification status/implementation detail must be checked against actual browser support.

### W3C-CSS-COLOR4 — CSS Color Module Level 4
URL: https://www.w3.org/TR/css-color-4/
Evidence: `CANDIDATE_RECOMMENDATION_DRAFT at 2026-09-28`
Use: modern color-space semantics including Display P3 and gamut mapping.
Limitation: CRD status; implementation/support must be verified.

### W3C-WEBGPU — WebGPU
URL: https://www.w3.org/TR/webgpu/
Evidence: `CANDIDATE_RECOMMENDATION_DRAFT / 2026-09-15`
Use: GPU API status and semantics.
Limitation: not a final W3C Recommendation at cutoff.

### W3C-WGSL — WebGPU Shading Language
URL: https://www.w3.org/TR/WGSL/
Evidence: `CANDIDATE_RECOMMENDATION_DRAFT / 2026-09-21`
Use: WebGPU shader-language status.

### KHRONOS-WEBGL — WebGL API Registry
URL: https://registry.khronos.org/webgl/
Evidence: `OFFICIAL_API_REGISTRY`
Use: official WebGL 1/2 specs and extension registry.

### W3C-I18N — Localization vs Internationalization
URL: https://www.w3.org/International/questions/qa-i18n
Evidence: `W3C_I18N_GUIDANCE`
Use: localization can affect symbols, colors, graphics, logic and presentation—not merely translation.

---

## 42.3 Visual perception and HCI evidence

### VIZ-CLEVELAND-MCGILL — Cleveland & McGill, Graphical Perception
URL: https://doi.org/10.1080/01621459.1984.10478080
Evidence: `FOUNDATIONAL_PEER_REVIEWED_GRAPHICAL_PERCEPTION`
Use: quantitative encoding/perceptual comparison foundations.
Limitation: foundational rather than modern UI-context study; triangulated with later replication.

### VIZ-HEER-BOSTOCK — Heer & Bostock, Crowdsourcing Graphical Perception
URL: https://doi.org/10.1145/1753326.1753357
Evidence: `CHI_EMPIRICAL_REPLICATION_EXTENSION`
Use: replication/extension of graphical-perception findings and visualization evaluation method.

### SIGNAL-META-2017 — Schneider et al., A meta-analysis of how signaling affects learning with media
URL: https://www.sciencedirect.com/science/article/pii/S1747938X17300581
Evidence: `META_ANALYSIS / 103 studies / N=12,201`
Use: signals/cues can improve retention/transfer and reduce cognitive load on average.
Limitation: learning-media context; do not generalize exact effect sizes to every marketing/product graphic.

### SIGNAL-TEXT-PICTURE — Richter, Scheiter & Eitel, Signaling text-picture relations
URL: https://doi.org/10.1016/j.edurev.2015.12.003
Evidence: `META_ANALYSIS / 27 studies / N=2,464`
Use: text-picture correspondence signaling and boundary conditions.

### HCI-AESTH-2026 — Schlamann, Nestler & Thielsch, Attractive Things Do Work Better
URL: https://doi.org/10.1080/10447318.2026.2664081
Evidence: `PREREGISTERED_META_ANALYSIS / 31 studies / 234 effects / N=18,794`
Use: visual aesthetics had a small-to-medium positive mean association/effect on objective performance under included manipulations, with high heterogeneity.
Limitation: broad prediction interval; does not justify sacrificing usability or treating one style as optimal.

---

## 42.4 Image delivery and color sources

### WEBDEV-IMAGE-PERF — web.dev Image Performance
URL: https://web.dev/learn/performance/image-performance
Evidence: `OFFICIAL_WEB_PERFORMANCE_GUIDANCE`
Use: modern formats, compression and image/LCP performance.
Limitation: implementation guidance; local asset/browser measurements decide.

### MDN-RESPONSIVE-IMAGES — Responsive Images
URL: https://developer.mozilla.org/en-US/docs/Web/HTML/Guides/Responsive_images
Evidence: `PLATFORM_DOCUMENTATION`
Use: `srcset`, `sizes`, `<picture>` patterns.

### ICC-V4 — ICC.1:2022 Profile v4.4
URL: https://www.color.org/icc-1_specification/
Evidence: `FORMAL_COLOR_MANAGEMENT_SPECIFICATION`
Use: current ICC v4 profile architecture at cutoff.

### ICC-DISPLAY-P3 — Display P3 Registry
URL: https://registry.color.org/rgb-registry/displayp3
Evidence: `OFFICIAL_COLOR_ENCODING_REGISTRY`
Use: Display P3 encoding/profile reference.

---

## 42.5 Provenance and AI transparency sources

### C2PA-2.4 — C2PA Technical Specification 2.4
URL: https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html
Evidence: `OPEN_TECHNICAL_SPECIFICATION / APRIL 2026`
Use: provenance/Content Credentials architecture and current version status.
Limitation: provenance is not truth, copyright or contextual-integrity proof.

### EU-AI-ACT-50 — Regulation (EU) 2024/1689, Article 50
URL: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02024R1689-20260727
Evidence: `BINDING_EU_REGULATION / SCOPED`
Use: applicable transparency duties including specified deepfake disclosures.
Limitation: legal applicability/interpretation requires qualified jurisdictional analysis.

### EU-AI-TRANSPARENCY-GUIDANCE — European Commission Article 50 guidance
URL: https://digital-strategy.ec.europa.eu/en/policies/guidelines-ai-transparency-obligations
Evidence: `OFFICIAL_COMMISSION_GUIDANCE / CURRENT 2026`
Use: implementation interpretation including provider marking and deployer disclosure distinction.

### EU-AI-TRANSPARENCY-FAQ — Commission FAQ on Article 50
URL: https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act
Evidence: `OFFICIAL_COMMISSION_GUIDANCE`
Use: visible/perceivable disclosure should not rely solely on machine-readable marking for applicable deployer obligations.

---

## 42.6 Rights and licensing sources

### CC-LICENSES — Creative Commons License Overview
URL: https://creativecommons.org/share-your-work/use-remix/cc-licenses/
Evidence: `LICENSE_AUTHORITY`
Use: commercial/derivative/attribution/share-alike differences among CC licenses.

### USCO-AI — U.S. Copyright Office: Copyright and Artificial Intelligence
URL: https://copyright.gov/AI/
Evidence: `OFFICIAL_COPYRIGHT_AUTHORITY / US_JURISDICTION`
Use: current report status and U.S. policy/legal analysis.

### USCO-AI-P2 — Copyright Office Part 2: Copyrightability
URL: https://copyright.gov/newsnet/2025/1060.html
Evidence: `OFFICIAL_US_GUIDANCE / 2025`
Use: human-authorship principle; prompts alone not sufficient for copyrightability in U.S. guidance.
Limitation: U.S.-specific and fact-dependent.

---

## 42.7 Current generative-image platform sources

### OAI-IMAGE-GEN — OpenAI Image Generation Guide
URL: https://developers.openai.com/api/docs/guides/image-generation
Evidence: `OFFICIAL_PLATFORM_DOCUMENTATION / CURRENT 2026-09-28`
Use: current GPT Image model/API capabilities, generation/editing, multi-turn, references, masks, output controls.
Volatility: `VERY_FAST`.

### OAI-IMAGE-PROMPT — OpenAI Image Prompting Guide
URL: https://developers.openai.com/api/docs/guides/image-prompting
Evidence: `OFFICIAL_PLATFORM_GUIDANCE / CURRENT 2026-09-28`
Use: model parameters, editing/preservation patterns, transparent assets and production prompting.
Volatility: `VERY_FAST`.

### OAI-PROVENANCE — OpenAI provenance signals / Content Credentials / SynthID
URL: https://help.openai.com/da-dk/articles/8912793-provenance-signals-content-credentials-synthid-in-openai-generated-content
Evidence: `OFFICIAL_PROVIDER_DOCUMENTATION / CURRENT 2026`
Use: current origin-signal behavior and explicit limitation that signals do not establish correctness, ownership or context.

### GOOGLE-NANO-BANANA — Gemini API Image Generation / Nano Banana
URL: https://ai.google.dev/gemini-api/docs/image-generation
Evidence: `OFFICIAL_PLATFORM_DOCUMENTATION / CURRENT 2026-09-28`
Use: current model family, multi-turn editing, reference-image handling, aspect ratios, resolution and SynthID statement.
Volatility: `VERY_FAST`.

---

## 42.8 V2.1 second-pass audit sources

### SVG2-STATUS — W3C SVG 2 status
URL: https://www.w3.org/TR/SVG/all/
Evidence: `W3C_SPEC_STATUS`
Use: SVG 2 remains a Candidate Recommendation Snapshot dated 4 October 2018 at the cutoff.

### SVG-AAM-2026 — SVG Accessibility API Mappings
URL: https://www.w3.org/TR/2026/WD-svg-aam-1.0-20260924/
Evidence: `W3C_WORKING_DRAFT / 24 SEPTEMBER 2026`
Use: current SVG accessibility-mapping direction and explicit status warning.
Limitation: the draft itself states it contains outdated information/errors and should not be implemented as a stable baseline.

### SVG-SEC-MDN — SVGScriptElement / active SVG behavior
URL: https://developer.mozilla.org/en-US/docs/Web/API/SVGScriptElement/href
Evidence: `PLATFORM_DOCUMENTATION`
Use: establishes that SVG can contain script references/active behavior; embedding context matters.

### OWASP-IMG-VALIDATION — OWASP Input Validation Cheat Sheet
URL: https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
Evidence: `OPEN_SECURITY_CONSENSUS`
Use: image-upload allowlisting, actual content validation and image rewriting/normalization as defense.

### OWASP-SCREENSHOT — MASWE-0038 screenshot/recording exposure
URL: https://mas.owasp.org/MASWE/MASVS-PLATFORM/MASWE-0038/
Evidence: `OPEN_SECURITY_STANDARD/GUIDANCE`
Use: sensitive information can leak through screenshots/screen recordings; supports capture/redaction controls.

### WAI-COMPLEX — W3C WAI Complex Images tutorial
URL: https://www.w3.org/WAI/tutorials/images/complex/
Evidence: `OFFICIAL_ACCESSIBILITY_GUIDANCE`
Use: short + long descriptions and structured alternatives for complex charts/diagrams; warns about structural loss in continuous description strings.

### GLTF2 — Khronos glTF Registry
URL: https://registry.khronos.org/glTF/
Evidence: `OPEN_INDUSTRY_SPECIFICATION_REGISTRY`
Use: current glTF 2.0 runtime-delivery baseline and extension ecosystem.

### GLTF21-WATCH — Khronos glTF 2.1 plans
URL: https://www.khronos.org/blog/introducing-gltf-2.1-with-complex-scenes
Evidence: `STANDARDS_BODY_WATCH / JUNE 2026`
Use: glTF 2.1 direction for complex scenes.
Limitation: announcement/planned revision; not silently treated as the current stable core.

### KTX2 — Khronos KTX 2.0 Specification
URL: https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html
Evidence: `OPEN_INDUSTRY_SPECIFICATION`
Use: GPU texture container/delivery baseline and texture-pipeline reasoning.

### MDN-IMAGE-FORMATS — Image file type and format guide
URL: https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types
Evidence: `CURRENT_PLATFORM_DOCUMENTATION`
Use: current AVIF/WebP/JPEG/PNG/JPEG XL capability/support context; lossless guidance for screenshots/diagrams/line art.
Limitation: browser status is volatile and must be rechecked.

### WEBDEV-FETCHPRI — Fetch Priority API guidance
URL: https://web.dev/articles/fetch-priority
Evidence: `OFFICIAL_WEB_PERFORMANCE_GUIDANCE`
Use: distinguishes resource discovery/preload from relative fetch priority and documents overuse caveats.

### CSS-HDR-2026 — CSS Color HDR Module Level 1
URL: https://www.w3.org/TR/css-color-hdr/
Evidence: `W3C_WORKING_DRAFT / 7 SEPTEMBER 2026`
Use: current emerging HDR web-color model and dynamic-range controls.

### C2PA-DURABLE-2.4 — C2PA Content Credentials 2.4
URL: https://spec.c2pa.org/specifications/specifications/2.4/specs/ContentCredentials.html
Evidence: `OPEN_TECHNICAL_SPECIFICATION / 2026`
Use: hard/soft binding and durable Content Credentials concepts beyond embedded-manifest assumptions.

### GOOGLE-IMG-META — Google Image Metadata guidance
URL: https://developers.google.com/search/docs/appearance/structured-data/image-license-metadata
Evidence: `OFFICIAL_PUBLISHING/SEARCH_DOCUMENTATION`
Use: IPTC/structured rights metadata can be valuable publishing information; supports metadata classification rather than blanket stripping.

### NIST-GENAI — NIST AI 600-1 GenAI Profile
URL: https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence
Evidence: `GOVERNMENT_RISK_FRAMEWORK`
Use: system-level generative-AI risk-management baseline.

### T2I-BIAS-2026A — Social stereotypes in AI text-to-image generation
URL: https://link.springer.com/article/10.1007/s43681-026-01146-8
Evidence: `PEER_REVIEWED_2026_RESEARCH`
Use: evidence that text-to-image generation can reproduce/amplify social stereotypes; supports scoped representation evaluation.
Limitation: model/prompt/version-specific findings must not be generalized as one global bias score.

### T2I-BIAS-2026B — Gender bias across three text-to-image platforms
URL: https://journals.sagepub.com/doi/full/10.1177/14614448261435197
Evidence: `PEER_REVIEWED_2026_CONTENT_ANALYSIS`
Use: cross-platform evidence of representational/presentational differences and measurement caveats.

### MULTIMEDIA-META-2025 — Meta-analysis of Mayer's multimedia-learning research
URL: https://doi.org/10.1016/j.edurev.2025.100730
Evidence: `META_ANALYSIS / 181 studies / 591 effects`
Use: boundary conditions across multimedia design/media types; supports contextual rather than prestige-driven use of richer media.

### SIGNAL-META-2018 — A meta-analysis of how signaling affects learning with media
URL: https://www.sciencedirect.com/science/article/pii/S1747938X17300581
Evidence: `META_ANALYSIS / 103 studies / N=12,201`
Use: signaling benefits for retention/transfer and cognitive-load mechanisms.

### GRAPH-MATRIX-2004 — Node-link vs matrix readability experiment
URL: https://doi.org/10.1109/INFVIS.2004.1
Evidence: `CONTROLLED_VISUALIZATION_EXPERIMENT`
Use: task/density-sensitive graph representation; supports choosing matrix/table alternatives for some dense-network jobs.
Limitation: old study and specific task sets; numeric thresholds are contextual priors, not modern universal cutoffs.

### CHART-A11Y-2024 — Low-vision chart accessibility user test
URL: https://doi.org/10.1007/s10209-024-01111-4
Evidence: `USER_TEST / LOW-VISION PARTICIPANTS`
Use: practical barriers/preferences for accessible statistical charts including data tables, contrast, legends, axes, resize and focus/navigation.

### EU-AI-CODE-2026 — Code of Practice on Transparency of AI-generated Content
URL: https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content
Evidence: `OFFICIAL_EU_VOLUNTARY_CODE / FINAL 10 JUNE 2026`
Use: current implementation overlay for AI-generated-content transparency.
Limitation: not the binding regulation itself; legal applicability remains scoped.

# 43. Source-status and freshness controls

At the evidence cutoff:

- WCAG 2.2 is the current W3C Recommendation baseline used here.
- SVG 2 remains a Candidate Recommendation Snapshot dated 4 October 2018; SVG 1.1 remains a Recommendation.
- SVG Accessibility API Mappings is a Working Draft dated 24 September 2026 and explicitly warns it contains outdated information/errors.
- WebGPU is a Candidate Recommendation Draft dated 15 September 2026.
- WGSL is a Candidate Recommendation Draft dated 21 September 2026.
- CSS Color Level 4 is a Candidate Recommendation Draft in September 2026.
- CSS Color HDR Level 1 is a Working Draft dated 7 September 2026 and is treated as emerging implementation material.
- C2PA Technical Specification 2.4 is the current version identified in the source review; durable provenance may require more than preserving embedded metadata.
- glTF 2.0 remains the current registered core runtime-delivery baseline; glTF 2.1 is watch material announced/planned in 2026.
- KTX 2.0 remains the current Khronos texture-container baseline used here.
- JPEG XL is a contextual web format with non-universal browser support; AVIF/WebP/JPEG/PNG remain part of the delivery decision space.
- EU AI Act Article 50 transparency obligations apply from 2 August 2026 in scope; Commission guidelines are official implementation guidance and the Transparency Code of Practice was published final on 10 June 2026 as a voluntary overlay.
- Current OpenAI GPT Image and Google Nano Banana model names/capabilities are **volatile implementation facts** and MUST be refreshed before consequential workflow decisions.
- Copyright and licensing conclusions remain jurisdictional; the playbook supplies a review gate, not a legal opinion.

---

# 44. Change triggers and maintenance

Re-review the playbook when:

1. WCAG 3 or another successor becomes a final replacement baseline;
2. WebGPU reaches W3C Recommendation or its support model changes materially;
3. SVG/SVG-AAM/CSS Color/HTML image semantics materially change;
4. browser AVIF/WebP/JPEG XL/HDR/decode support changes enough to alter format defaults;
5. C2PA publishes a new material revision or major distribution platforms materially change Content Credentials preservation/recovery behavior;
6. major CDN/social platforms change provenance preservation behavior;
7. EU/other AI synthetic-content rules or guidance materially change;
8. copyright law/case law materially changes AI-output rights assumptions;
9. OpenAI/Google/other adopted image models materially change editing, provenance or licensing behavior;
10. repeated field defects show the medium-selection or QA controls are insufficient;
11. glTF 2.1 or another material 3D delivery baseline becomes stable/final;
12. new media/SVG upload exploit classes or privacy guidance invalidate the minimum asset-security controls;
13. strong new evidence materially changes generative-visual representation/bias controls.

Volatile implementation profiles SHOULD be updated without rewriting the evergreen core.

---

# 45. Final falsification statement

This V2.1 deliberately rejects the idea that there is a single “best” visual technology, prompt structure, image format, AI model, chart type, illustration style, 3D format or art-direction aesthetic.

The invariant is stricter:

> **The exact delivered visual system must do the intended communication job without materially misleading the viewer, excluding users, leaking sensitive information, introducing unsafe active content, wasting delivery/runtime resources, breaking across contexts, losing justified metadata/rights/provenance, or becoming impossible to reproduce operationally and maintain.**

The production system is therefore optimized for **meaning and control preserved through delivery**, not for source-file elegance, format prestige or generator novelty.

---

# 46. Release note

**V2.1 Research-Audited Golden Master — 2026-09-28**

V2.1 is a second-pass research/falsification release over the complete V2.0 artifact.

Material V2.1 additions:

- 16-finding second-pass falsification record;
- exact rendered/output artifact identity and SHA-256 release trace;
- provider-revised-prompt provenance where exposed;
- screenshot/reference privacy and secret-redaction gate;
- trusted vs untrusted SVG security profile;
- metadata-lane classification instead of blanket strip/preserve rules;
- structured complex-image accessibility alternative and SVG AAM status correction;
- dense-network representation/task decision layer;
- machine-readable equivalent for durable informational graphics;
- system-as-deployed representation/bias evaluation for generated human/social imagery;
- full 3D asset-delivery architecture;
- glTF 2.0 runtime baseline + glTF 2.1 watch status;
- KTX2/texture delivery, geometry/LOD/runtime budgets and 3D fallback controls;
- JPEG XL contextual delivery status;
- explicit resource-discovery vs fetch-priority distinction;
- Display P3 vs HDR separation; CSS HDR kept emerging;
- durable C2PA/provenance preservation/recovery model;
- final 10 June 2026 EU transparency Code of Practice status;
- new security/privacy/metadata and representation/extractability QA dimensions;
- four new production Plays and three new specialist checklists;
- expanded current source register and freshness triggers.

**V2.0 Golden Master — 2026-09-28 (superseded by V2.1)**

Material additions after the V1 falsification pass:

- explicit Visual Production Contract;
- truth classification: real / representative / concept / editorial;
- formal medium-selection matrix;
- HTML-native and hybrid graphics as first-class options;
- responsive re-representation, not only scaling;
- structured generative-image production and invariant locking;
- current GPT Image / Gemini Nano Banana volatile profiles;
- prompt/art-direction specification template;
- SVG/CSS/HTML/Canvas/WebGL/WebGPU standards;
- motion job taxonomy;
- raster delivery and responsive-image rules;
- accessibility architecture for complex/interactive graphics;
- localization/RTL graphic rules;
- performance model beyond byte size;
- ICC/sRGB/Display P3 color-management layer;
- C2PA 2.4 provenance layer;
- EU Article 50 synthetic-content transparency overlay;
- rights/licensing/likeness gate;
- ten-dimensional visual QA system;
- production Plays, anti-pattern catalog and release checklists;
- explicit source-gap disclosure for the unavailable requested Art Direction playbook.

**Status:** `REVIEWED`. V2.1 has completed the second deep research/falsification audit but is not field-validated. Promotion to `VALIDATED` still requires representative non-author execution of the expanded validation scenarios and closure of material findings.
