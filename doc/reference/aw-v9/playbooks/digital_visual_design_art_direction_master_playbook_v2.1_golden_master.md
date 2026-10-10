# Digital Visual Design & Art Direction Master Playbook — V2.1 Research-Revalidated Golden Master
## Evidence-weighted evergreen standard for visual craft, art direction and the visual systems of websites and apps

```yaml
document_id: DVDAD-01
artifact_type: specialist_design_playbook
version: "2.1"
release_label: "V2.1 Golden Master — Second-Pass Research, Freshness & Falsification Audit"
status: REVIEWED
created: 2026-09-28
last_updated: 2026-09-28
last_reviewed: 2026-09-28
evidence_cutoff: 2026-09-28
supersedes: "2.0"
deep_research_audit: DVDAD-01-AUDIT-2
canonical_language: English
owner: Playbooks
research_rigor: R3_CONTROLLED
volatility: MIXED
review_cadence: 6_months_plus_event_driven
next_scheduled_review: 2027-03-28
inherits:
  - Universal Design Principles Master Playbook V2.0
  - UX Master Playbook V2.0
  - UI Master Playbook V2.0
  - Master Playbook Standard V2.0-RC1
interfaces_with:
  - Brand Strategy & Positioning Master Playbook V2.0
  - Web & Frontend Engineering Master Playbook V2.0
  - Verification, Validation, Testing & Quality Engineering V2
applies_to:
  - marketing websites
  - editorial websites
  - web applications
  - SaaS products
  - mobile applications
  - desktop applications
  - dashboards and data-rich software
  - AI-native products
  - design systems
  - responsive and adaptive digital products
out_of_scope_as_primary_authority:
  - user research and end-to-end journey design
  - interaction semantics, component behavior and system state
  - brand positioning strategy
  - frontend architecture and CSS implementation details
  - accessibility semantics beyond visual presentation requirements
  - illustration craft as a standalone fine-art discipline
  - marketing campaign creative strategy outside product/site/app art direction
status_note: >
  Golden Master denotes the canonical second-pass research- and falsification-audited V2.1 content baseline.
  It is intentionally REVIEWED rather than VALIDATED. Representative non-author field execution,
  cross-product use and closure of defects found in real production work remain required by the
  governing Master Playbook Standard before VALIDATED status is warranted.
```

---

# Executive synthesis

Digital visual design is not the act of making an interface look fashionable, polished, minimal, premium, “on brand,” or impressive in a design file.

It is the discipline of turning **intent, meaning, hierarchy and brand character into a coherent visual system that survives real content, real states, real devices, real users, implementation constraints and change**.

Art direction operates one level above individual screens. It decides the visual world: the governing concept, visual tension, recurring grammar, image language, type voice, color behavior, material logic, pace, contrast strategy and degree of familiarity versus novelty. Visual design then realizes that world in specific compositions, components and assets. Visual craft is the precision with which those decisions are executed. Visual QA tests whether the intended system actually survives implementation.

The durable chain is:

```text
PRODUCT / BRAND INTENT
→ VISUAL PROBLEM
→ ART-DIRECTION THESIS
→ REFERENCE TERRITORY + CATEGORY CODES
→ VISUAL CONCEPTS
→ SELECTED VISUAL GRAMMAR
→ COMPOSITION + GRID + RHYTHM
→ TYPOGRAPHY + COLOR + SPACE + SURFACE
→ IMAGERY + GRAPHIC LANGUAGE
→ MOTION + TEMPORAL LANGUAGE
→ RESPONSIVE / ADAPTIVE RULES
→ TOKENS + REUSABLE VISUAL DECISIONS
→ IMPLEMENTATION
→ SYSTEMATIC VISUAL QA
→ REAL-WORLD EVIDENCE
→ CONTROLLED EVOLUTION
```

The central V2.1 doctrine is:

> **Create a visual system in which every material choice has a job, related choices reinforce one another, hierarchy remains legible, expression fits the intended meaning, novelty does not destroy comprehension, and the design remains recognizably itself across states, content, devices and time. Treat formulas, trends, templates and AI-generated outputs as inputs—not authority—and trust craft only after the rendered product has been systematically reviewed.**

The shortest version:

> **Concept before styling. Hierarchy before decoration. Coherence before novelty. Fit before fashion. Systems before one-off screens. Rendered evidence before taste claims.**

---

# V2.1 deep research and falsification verdict

The inherited design standards already establish several durable facts: visual hierarchy and grouping matter; attention is limited; visual complexity and prototypicality shape rapid aesthetic judgment; aesthetics can affect objective performance on average but with large heterogeneity; familiarity and novelty can both contribute to preference; accessibility is a quality floor; and famous design formulas do not become universal laws merely through repetition `[FND-DESIGN]`.

The companion UI standard explicitly separates visual design from UI behavior: UI owns the operable representation of information, action and state, while visual design owns typography, color, composition, imagery, salience, brand and aesthetics `[FND-UI]`. The UX standard similarly keeps the goal at customer outcome, control, comprehension, recovery and successful use—not visual ideology `[FND-UX]`.

This playbook therefore does **not** create a second UI or UX manual. Its specialist job is the visual-craft and art-direction layer between product/brand intent and rendered interface quality.

V2.1 is a second research pass over the full V2.0 Golden Master. It rechecked every fast-moving source family used by V2.0, searched for contradictory evidence and missing implementation-era constraints, and specifically challenged whether the standard was still too conceptual in areas where the 2025–2026 platform now exposes stronger visual-system primitives. The second pass found **no architecture-breaking defect** in V2.0, but it did find several places where a modern Golden Master should be more precise.

## What the research supports strongly

1. **Hierarchy, grouping, legibility, alignment, contrast and controlled complexity are durable visual foundations.**
2. **Aesthetic quality is performance-relevant, but not deterministically so.** A 2026 preregistered meta-analysis found a small-to-medium average positive effect on objective user performance, with high unexplained heterogeneity `[AES01]`.
3. **First impressions are extremely fast.** Website visual complexity and prototypicality can shape aesthetic judgment within tens of milliseconds `[AES02]`.
4. **There is no universal aesthetic recipe.** Typeface class, palette formula, symmetry, whitespace amount, grid, corner radius or composition rule requires context.
5. **Familiarity and novelty are a tension, not opponents with one universal winner.** MAYA-style evidence and mere-exposure research support an optimum rather than maximum novelty or maximum familiarity `[NOV01][NOV02]`.
6. **Color associations exist but are many-to-many and context-sensitive.** Lightness, saturation and hue all contribute; culture, category and surrounding meaning remain material `[CLR01]`.
7. **Typography is a system, not a serif-versus-sans decision.** Research does not justify a universal screen-legibility winner between serif and sans-serif categories `[TYP01]`.
8. **Responsive visual quality requires adaptation, not shrinking.** Current platform guidance converges on reflow, reveal, presentation change and window-size-aware composition `[ADAPT01][ADAPT02]`.
9. **Motion is communication and continuity, not decoration.** It can provide status, feedback and spatial continuity, but unnecessary or forced motion creates distraction and accessibility risk `[MOT01][ACC01]`.
10. **Automated visual regression is evidence of change, not proof of quality.** Baselines must themselves be correct; visual deltas still require judgment `[QA01][QA02][QA03]`.
11. **Generative AI can increase creative convergence/fixation.** A 2026 meta-analysis found a small homogenization effect across human–AI co-creation studies, while controlled design studies report fixation risks `[AI01][AI02][AI03]`.
12. **Design tokens are now substantially more interoperable as an exchange format, but the DTCG specification is a W3C Community Group Final Report, not a W3C Recommendation.** Tokens standardize decisions; they do not create good decisions `[SYS01]`.

## Material V2.1 refinements

1. **Expressiveness is now an explicit variable, not the opposite of usability.** Google’s Material 3 Expressive research program spans 46 studies and 18,000+ participants and reports gains in salience, preference and task finding for the tested expressive designs, while also reporting a meaningful minority preference for calmer treatments. V2.1 therefore adds an **expressiveness/intensity decision layer** rather than promoting either minimalism or maximal expression `[EXPR01]`.
2. **Variable fonts and optical sizing become first-class typography capabilities.** CSS Fonts 4 and OpenType define optical sizing as a real font capability for adapting glyph design to displayed size. V2.1 treats this as a craft tool that SHOULD be evaluated when supported, not as proof that a variable font is inherently superior `[FONTTECH01][FONTTECH02]`.
3. **Font loading/fallback is promoted from implementation detail to visual correctness.** If hierarchy, wrapping, numerals or brand voice materially change before/after font load or across fallback scripts, the visual system is not robust enough.
4. **Token modes are separated from token values.** The stable DTCG Resolver Module now gives a concrete multi-context model for themes such as light/dark. V2.1 therefore distinguishes semantic token identity, contextual resolution and generated platform output `[SYS02]`.
5. **Color-token interchange is strengthened.** The DTCG Color Module explicitly supports multiple color spaces, alpha and fallback data, and warns that gamut mapping can materially change appearance. V2.1 adds a gamut/fallback contract rather than treating “OKLCH” as sufficient color governance `[SYS03]`.
6. **Wide-gamut and HDR are split.** CSS Color 4’s wide-gamut SDR capabilities are comparatively mature; CSS Color HDR remains a 2026 Working Draft. V2.1 permits wide-gamut enhancement with controlled fallback and classifies HDR as an emerging enhancement that MUST NOT silently become a baseline requirement `[COLORTECH01][COLORHDR01]`.
7. **Translucent materials are treated as compositing systems.** Current Apple material guidance is useful evidence that blur/translucency can establish hierarchy but also becomes content- and accessibility-setting-dependent. V2.1 therefore requires material QA over representative backgrounds and relevant system settings instead of judging a glass surface in isolation `[MAT01]`.
8. **Responsive imagery gets an explicit art-direction contract.** Current web-platform guidance distinguishes resolution switching from art direction and uses `<picture>` for materially different crops. V2.1 defines focal region, safe area, crop variants and meaning preservation as craft requirements, while leaving markup implementation to frontend engineering `[IMGTECH01]`.
9. **Programmatic SVG/CSS graphics become a named visual medium.** They are governed by the same art-direction rules as illustration or 3D: geometry, stroke/fill language, responsiveness, theming, semantic role and accessibility boundary must be intentional.
10. **Accessibility freshness is tightened.** WCAG 2.2 remains the current conformance baseline (and is ISO/IEC 40500:2025), while WCAG 3 remains a September 2026 Working Draft. V2.1 explicitly prevents draft contrast/conformance ideas from silently replacing the current baseline `[ACC01][ACC03][A11YWATCH01]`.

## What V2.1 explicitly rejects as universal doctrine

- every digital product should use an 8-point spacing grid;
- every desktop site should use a 12-column grid;
- every body text block should have the same line length or line-height ratio;
- serif is premium and sans-serif is modern;
- dark mode is a literal inversion of light mode;
- 60-30-10 is an optimal color law;
- golden ratio or rule of thirds creates superior interface composition;
- all premium design should maximize whitespace;
- all premium products should be monochrome;
- glass, blur, gradients, bento grids, neo-brutalism, minimalism or any named style are inherently high craft;
- asymmetric composition is inherently more sophisticated;
- more motion means more delight;
- one “brand color” should dominate every screen;
- every design decision must become a token;
- a design system should eliminate all local visual judgment;
- pixel-perfect similarity to a design file proves a production UI is visually correct;
- screenshot diffs can replace human visual review;
- AI-generated visuals are inherently low quality;
- AI-generated visuals are automatically original because the prompt is original;
- trend avoidance automatically creates timeless design;
- timelessness means visual neutrality;
- copying a category leader is safe because “they must have tested it.”;
- variable fonts are automatically more legible or more premium;
- OKLCH automatically produces accessible or beautiful palettes;
- wide-gamut or HDR color is a premium-quality badge;
- Liquid Glass / translucency is the new universal premium interface style;
- Material 3 Expressive proves that more expression is always better;
- one design-token mode matrix should encode every possible context;
- a single responsive image crop is acceptable if CSS can cover it;
- WCAG 3 draft methods or APCA-style experimental work can silently replace current WCAG 2.2 conformance;
- structured SVG/CSS graphics are “just implementation” and do not need art direction.

## V2.1 falsification result

**PASS_WITH_TARGETED_MATERIAL_REFINEMENTS.**

V1 and V2.0's core direction survived, but the audit forced stronger separation between:

- visual principles and style preferences;
- art direction and implementation;
- density and clutter;
- whitespace and quality;
- tokenization and design quality;
- novelty and distinctiveness;
- trend-awareness and trend-dependence;
- automation and visual judgment;
- visual-regression detection and visual acceptance;
- AI assistance and authorship/originality.

---

# 1. Scope and boundaries

## 1.1 This playbook owns

- art-direction strategy for websites and apps;
- visual concepts and visual theses;
- reference gathering and reference critique;
- composition systems;
- visual hierarchy as craft;
- grids and spatial frameworks;
- spacing rhythm;
- density as visual calibration;
- typographic systems and typographic voice;
- color systems and palette behavior;
- surface, depth, material and border logic;
- imagery, photography, illustration and graphic language;
- brand expression inside digital products;
- visual storytelling and editorial pacing;
- responsive/adaptive art direction;
- motion language and visual transitions;
- premium/editorial/high-craft execution;
- visual design tokens and style-system governance;
- trend adoption and rejection;
- anti-template and anti-AI-slop controls;
- systematic visual QA and visual-regression governance;
- visual consistency and controlled evolution.

## 1.2 UX owns the journey; this playbook does not

UX decides:

- user/customer outcome;
- context of use;
- journey and task sequence;
- effort and friction;
- mental models;
- user research;
- end-to-end service behavior;
- success measurement.

This playbook can **amplify or damage** those decisions visually, but it does not own them.

## 1.3 UI owns behavior; this playbook does not

UI decides:

- which interactive controls exist;
- component semantics;
- system state representation;
- focus and selection behavior;
- feedback/recovery interaction;
- input modality;
- overlays and navigation behavior;
- adaptive control/presentation semantics.

This playbook decides how those things are visually articulated **without contradicting their semantics**.

### Boundary invariant

```text
UI DEFINES THE PROMISE.
VISUAL DESIGN DEFINES HOW THE PROMISE LOOKS.
THE LOOK MUST NEVER LIE ABOUT THE PROMISE.
```

A decorative treatment may not make inactive content look interactive, secondary content look primary, or uncertain state look complete.

## 1.4 Brand strategy owns positioning; this playbook translates it

Brand strategy decides:

- category/frame;
- positioning;
- audience/customer meaning;
- desired associations;
- distinctive assets;
- brand architecture;
- messaging architecture.

Art direction translates those inputs into **visual behavior**. It must not invent a new positioning because a moodboard looks attractive.

## 1.5 Frontend engineering owns implementation correctness

This playbook may define visual acceptance criteria, tokens, rendering targets and QA matrices. It does not prescribe one CSS architecture, framework, rendering system or component library.

---

# 2. Normative language, claim status and evidence architecture

The governing Master Playbook Standard is explicit: source prestige is not evidence class, recommendations must fit the claim, uncertainty must remain visible, and rigor should increase with consequence `[FND-MPS]`.

## 2.1 Normative language

- **MUST / MUST NOT** — house requirement for conformance to this standard; deviation requires explicit rationale where material.
- **SHOULD / SHOULD NOT** — strong default with legitimate contextual exceptions.
- **MAY** — optional technique.
- **JUDGMENT REQUIRED** — no honest universal rule is justified.

## 2.2 Claim labels

| Label | Meaning |
|---|---|
| `REQ` | externally applicable requirement in a stated scope |
| `EST` | strongly established cross-source principle/mechanism |
| `DEF` | recommended default |
| `CTX` | context-dependent rule or technique |
| `EMG` | emerging / fast-moving practice |
| `HOUSE` | deliberate internal synthesis |
| `EXP` | hypothesis/experiment |
| `UNK` | material unresolved uncertainty |

## 2.3 Specialist evidence lanes

| Lane | Strongest use | Misuse to avoid |
|---|---|---|
| normative accessibility/platform requirement | constraints and conformance | treating minimum compliance as visual excellence |
| meta-analysis/systematic review | average effects, heterogeneity, evidence state | converting an average into a style recipe |
| controlled HCI/perception research | mechanisms within tested tasks/populations | universalizing from one stimulus set |
| large usability/industry research | recurring applied patterns | assuming causal proof |
| current platform/design-system guidance | implementation conventions | copying one platform as universal aesthetic truth |
| design philosophy/history | language, craft principles, concept generation | calling philosophy “scientifically proven” |
| local user/brand/product evidence | fit in the actual product | overgeneralizing local taste to all products |
| production render evidence | whether implementation matches intended system | treating visual similarity as proof of usability or brand effect |

## 2.4 Evidence-handling rules

1. Perception evidence is not conversion evidence.
2. Preference evidence is not task-performance evidence.
3. Brand association is not accessibility.
4. An official design system is authoritative about its own conventions, not about universal optimal aesthetics.
5. A fashionable style is not evidence.
6. A famous designer's principle is philosophy unless independently supported.
7. Accessibility requirements can constrain or override aesthetic preference.
8. Product-specific evidence can outweigh general priors when the measurement is trustworthy and the decision is scoped.
9. A design claim should be phrased at the level the evidence can support.
10. Where evidence is weak, preserve judgment rather than manufacture false precision.

---

# PART I — V1 CANDIDATE STANDARD

# 3. V1 research question

> **What visual-design and art-direction principles best help websites and apps become coherent, distinctive, legible, adaptable, brand-expressive and high-craft without turning transient aesthetic conventions into universal rules or duplicating UX/UI responsibilities?**

Subquestions:

1. Which visual mechanisms transfer across product categories and platforms?
2. Which common visual rules are only heuristics?
3. What actually distinguishes high craft from style fashion?
4. How should art direction be created before screen styling?
5. How should a visual system remain coherent across responsive/adaptive states?
6. What belongs in tokens and what must remain contextual?
7. How can AI accelerate visual production without collapsing creative diversity?
8. What evidence establishes that the implemented product is visually ready?

# 4. V1 candidate doctrine

V1 proposed:

> Build one coherent visual language from a small number of intentional rules; prioritize hierarchy and legibility; repeat distinctive cues; use grids, type, color, imagery, surface and motion consistently; systematize recurring values; and verify that the implementation matches the design.

That direction was intentionally broad enough to be stress-tested.

# 5. V1 candidate rules

V1 candidate rules included the following assumptions before falsification:

1. Start from a visual concept, not components.
2. One product should have one recognizable visual grammar.
3. One screen should have one primary focal hierarchy.
4. Use a grid to create alignment and rhythm.
5. An 8-point spacing grid should be the default.
6. Desktop product layouts should begin from 12 columns.
7. Large type should drive clear hierarchy.
8. Body copy should stay near a conventional reading measure.
9. Use no more than two type families.
10. Prefer sans-serif for digital products.
11. Use semantic color roles.
12. Use a restrained palette for premium products.
13. Use whitespace generously.
14. Prefer subtle surfaces over heavy shadows.
15. Avoid excessive cards.
16. Use real photography when trust is important.
17. Use one coherent image grammar.
18. Use motion to preserve spatial continuity.
19. Keep motion short and restrained.
20. Adapt visual composition at breakpoints rather than only scaling it.
21. Encode repeated visual choices as tokens.
22. Use visual regression testing before release.
23. Prefer timeless visual foundations over short-lived trends.
24. Use category codes for comprehension.
25. Break at least one category code for distinctiveness.
26. Treat premium as restraint, coherence and craft.
27. Use AI to generate many directions quickly.
28. Reject obviously generic AI output.
29. Review design in realistic content states.
30. Review the rendered product, not only Figma.

The audit retained many of these at the principle level but rejected several as universal prescriptions.

---

# PART II — ADVERSARIAL / FALSIFICATION AUDIT

# 6. Audit method

The V1 draft was challenged against:

- the inherited Universal Design, UX and UI standards;
- current W3C/WCAG visual accessibility requirements;
- current Apple and Android adaptive/visual guidance;
- current Design Tokens Community Group specifications;
- current CSS color specification status;
- controlled research on aesthetics, complexity, symmetry, prototypicality, color, typography and novelty;
- research on visual preference versus objective performance;
- research on generative-AI fixation and homogenization;
- current screenshot/visual-regression tooling guidance;
- ordinary SaaS, high-density expert software, editorial sites, consumer apps, premium/luxury, high-trust services and AI-native product scenarios.

The audit asked:

```text
Is this principle genuinely cross-context?
Does the evidence support the exact wording?
Is the source current?
Is the rule visual craft, or is it actually UX/UI/brand/engineering?
Does the rule survive mobile, desktop, resizable and localized contexts?
Does it survive both low-density and high-density expert software?
Can it create template sameness when followed mechanically?
Can an AI agent satisfy the wording while producing generic design?
Does automation detect the defect claimed?
Would a competent designer ever need to violate the rule for a good reason?
```

# 7. Material falsification findings

| ID | V1 assumption | Verdict | Severity | V2 correction |
|---|---|---|---|---|
| A01 | 8-point spacing grid is the general default | Overgeneralized implementation heuristic | MAJOR | Require coherent spacing relationships; base unit is contextual. |
| A02 | 12-column desktop grid is the standard | Folklore generalized from common practice | MAJOR | Select grid topology from content, alignment and responsive needs. |
| A03 | Digital products should prefer sans-serif | Unsupported as universal legibility rule | MAJOR | Select typeface by actual letterforms, size, rendering, script, voice and tested reading conditions. |
| A04 | Two type families maximum | Useful complexity control, not law | MINOR | Minimize typographic roles; extra families must earn semantic/brand value. |
| A05 | Conventional line-length range is a hard rule | Contextual reading heuristic | MAJOR | Optimize reading measure by text type, typeface, size, language and task; test long-form reading where material. |
| A06 | More whitespace produces more premium perception | Contextually supported but not monotonic | MAJOR | Premium is controlled complexity, confidence and craft; whitespace is one lever. |
| A07 | Restrained palette is premium | Category-dependent | MAJOR | Premium may be restrained or richly expressive; coherence and material fit matter more. |
| A08 | Subtle shadows are always more sophisticated | Style preference | MINOR | Depth treatment must communicate hierarchy/material logic and fit the visual thesis. |
| A09 | Real photography is inherently more trustworthy | Overbroad | MAJOR | Trust depends on provenance, relevance, honesty and context; photography, illustration or diagrams can each be appropriate. |
| A10 | Motion should always be short | Too simple | MAJOR | Duration follows distance, context, input, continuity, task interruption and accessibility; frequent UI motion should be especially economical. |
| A11 | Breakpoints are the responsive unit | Incomplete | MAJOR | Design for available space/content pressure; breakpoints are implementation thresholds, not art-direction concepts. |
| A12 | Every repeated value should be tokenized | Token inflation risk | MAJOR | Tokenize decisions with semantic/reuse/governance value, not every number. |
| A13 | Visual-regression pass proves visual quality | False assurance | BLOCKER | Regression proves change relative to a baseline; human visual acceptance remains required. |
| A14 | Timeless means trend-neutral | False | MAJOR | Timelessness is resilience of the underlying grammar; an expressive design can endure if its logic is coherent. |
| A15 | Break one category code to become distinctive | Mechanically gameable | MAJOR | Distinctiveness should be strategically relevant and ownable, not novelty for its own sake. |
| A16 | AI should generate many directions first | Fixation can occur from early AI exposure | MAJOR | Establish problem/territories and force independent divergence before converging on AI outputs. |
| A17 | Generic AI output can be removed by taste review | Too weak | MAJOR | Add explicit similarity, cliché, provenance, repetition and reference-diversity checks. |
| A18 | Visual QA is mainly screenshot comparison | Incomplete | BLOCKER | QA must inspect hierarchy, typography, crop, contrast, state coverage, responsive behavior, localization, motion and brand continuity. |
| A19 | Dark mode can reuse the same hierarchy with inverted colors | False | MAJOR | Recompose luminance, elevation, imagery, borders, saturation and contrast for dark appearance. |
| A20 | Symmetry is inherently better | Context-dependent | MAJOR | Symmetry stabilizes; asymmetry can create controlled tension. Use either intentionally. |
| A21 | Low complexity is aesthetically superior | Overgeneralized from first-impression evidence | MAJOR | Reduce irrelevant complexity; preserve useful density and expressive richness. |
| A22 | “Clean” means sparse | False | MAJOR | Clean means coherent hierarchy and low accidental noise; high-density interfaces can be clean. |
| A23 | One visual language means uniformity | False | MAJOR | A system can support multiple modes/contexts when they share invariants. |
| A24 | Pixel-perfect implementation is the ideal | False under dynamic/responsive systems | MAJOR | Target intent-perfect, constraint-correct implementation across states and viewports. |
| A25 | Trends should generally be avoided | Too conservative | MINOR | Adopt trends when they solve a real visual/problem or strengthen brand; isolate volatile signatures. |
| A26 | Distinctive visual design must look novel | False | MAJOR | Distinctiveness can come from consistent ownership of familiar elements. |
| A27 | Design systems reduce need for art direction | False | MAJOR | Systems preserve decisions; art direction still decides what should be preserved. |
| A28 | Consistency should minimize exceptions | Overbroad | MAJOR | Consistency protects meaning; deliberate exceptions can create hierarchy and editorial emphasis. |

# 8. Audit verdict: principles versus prescriptions

The audit produced a hard distinction:

```text
MORE DURABLE / HARDER
---------------------------------
intentional hierarchy
coherence
legibility
semantic congruence
controlled complexity
alignment/grouping
accessible contrast and non-color cues
purposeful imagery
purposeful motion
responsive adaptation
rendered-state QA
brand continuity
systematic reuse of real decisions
human acceptance of visual change

MORE CONTEXTUAL / SOFTER
---------------------------------
8pt / 4pt spacing base
column count
exact max width
exact type scale
serif vs sans
corner radius
shadow recipe
monochrome vs color-rich
symmetry vs asymmetry
light vs dark aesthetic
card vs borderless layout
named design trend
animation duration/easing preset
exact visual-regression thresholds
specific AI model/tool
```

V2 is therefore stricter about **what the visual system must achieve** and more conservative about **the exact style or mechanism used to achieve it**.

---

# PART III — V2 GOLDEN MASTER

# 9. Canonical terminology

## 9.1 Art direction

The governing visual concept and decision logic that determines what kind of visual world a product inhabits and which visual choices belong or do not belong in that world.

Art direction answers:

```text
What should this product feel like visually?
Why this visual world rather than an adjacent one?
Which cues are familiar on purpose?
Which cues are distinctive on purpose?
What is the dominant tension?
What repeats?
What changes?
What must never appear?
```

## 9.2 Visual concept

A coherent idea that can generate multiple executions without collapsing into one screenshot.

A concept is not:

- “minimal”;
- “premium”;
- “blue gradients”;
- “Apple-like”;
- a Pinterest board;
- one hero layout.

A usable concept creates **selection rules**.

## 9.3 Visual grammar

The repeatable relationships among:

- scale;
- alignment;
- spacing;
- typography;
- color;
- shape;
- surface/depth;
- imagery;
- iconography/graphics;
- motion;
- cropping;
- density;
- contrast;
- repetition and exception.

## 9.4 Visual system

The implemented set of reusable visual rules, tokens, assets, patterns and acceptance criteria that makes the visual grammar reproducible across product states.

## 9.5 Craft

The quality of execution visible in proportion, alignment, optical balance, typography, crop, color, states, transitions, responsive behavior, details and consistency.

Craft is not ornament density.

## 9.6 High craft

A level of visual execution where material choices appear deliberate, coherent and refined across both obvious and edge states, with no material dependence on accidental defaults.

## 9.7 Density

The amount and visual concentration of useful information and control relative to available space—not the same as clutter.

## 9.8 Visual noise

Competition for attention that does not earn its cost through information, interaction, meaning, brand, emotion or necessary structure.

## 9.9 Surface/material

A visual model for containment, depth, translucency, elevation, texture and boundary behavior. “Glass,” “paper,” “metal,” “flat,” “layered” and similar terms are art-direction metaphors, not literal materials.

## 9.10 Visual regression

An unintended or unreviewed change in rendered appearance relative to an accepted baseline or visual contract.

## 9.11 AI slop

A non-normative practitioner term used here for a recurring failure pattern: visually plausible but strategically generic output with weak authorship, cliché composition, overused effects, low reference diversity, inconsistent detail, insufficient product specificity, or obvious model defaults.

The term describes a **failure mode**, not a provenance judgment. Human-made work can be slop; AI-assisted work can be excellent.


# 10. Visual quality model

Visual quality is multidimensional. A design can be visually beautiful yet systemically weak, distinctive yet unreadable, polished yet generic, or consistent yet strategically wrong.

Evaluate at least these dimensions:

| Dimension | Core question |
|---|---|
| Intent fit | Does the visual world express the intended product/brand meaning? |
| Hierarchy | Is relative importance immediately legible? |
| Coherence | Do decisions feel like parts of one system rather than accumulated preferences? |
| Legibility | Can content be read and distinguished under real conditions? |
| Controlled complexity | Is richness useful, or merely competitive noise? |
| Distinctiveness | Is the product recognizable without relying only on logo placement? |
| Familiarity | Does the system preserve enough category/platform legibility? |
| Craft | Are alignment, proportion, type, crop, color, edge conditions and states precise? |
| Adaptability | Does the visual system survive real windows, devices, text growth and localization? |
| Accessibility | Do visual decisions meet applicable accessibility requirements? |
| Systemability | Can recurring decisions be reproduced without hand-tuning every screen? |
| Editorial quality | Does pacing create hierarchy and narrative rather than a stack of modules? |
| Brand continuity | Do visual assets accumulate memory rather than reset style per page/feature? |
| Production fidelity | Does the rendered product preserve intended relationships? |
| Evolution resilience | Can the system change without losing identity or accumulating inconsistency? |

## 10.1 Non-averaging rule

A catastrophic visual failure cannot be averaged away.

Examples:

- unreadable critical text;
- key state expressed by color alone;
- core layout unusable at required zoom/reflow;
- primary action visually indistinguishable;
- dark appearance with insufficient contrast;
- localized text clipping in a core flow;
- animation that blocks or harms use;
- brand-critical imagery cropped incorrectly in production.

A screen with excellent “brand feel” and a critical accessibility failure is not an acceptable average score.

## 10.2 Visual quality is relational

No isolated property determines quality.

```text
LARGE TYPE
+ weak hierarchy
= merely large

WHITESPACE
+ weak content structure
= emptiness

COLOR
+ no semantic role
= decoration

GRID
+ no meaningful alignment
= geometry theater

ANIMATION
+ no state continuity
= spectacle

DESIGN TOKENS
+ poor visual decisions
= scalable inconsistency
```

---

# 11. The 100 Golden Visual Design & Art Direction Standards

## 11.1 Intent and art direction

1. `EST / HIGH` **Start from intended meaning and task context, not a preferred aesthetic.**
2. `HOUSE / HIGH` **Write an art-direction thesis before polishing screens when visual differentiation matters.**
3. `DEF / HIGH` **A visual concept SHOULD be generative: it must explain multiple screens/states, not only one hero composition.**
4. `EST / HIGH` **Use hierarchy to express relative importance; do not require users to infer importance from copy alone.**
5. `EST / HIGH` **Make visual, verbal and behavioral meaning congruent unless a deliberate contradiction serves a clear purpose.**
6. `DEF / HIGH` **Preserve enough category/platform familiarity for orientation before spending novelty.**
7. `DEF / HIGH` **Create distinctiveness through a portfolio of recurring cues, not a single overused brand color.**
8. `HOUSE / HIGH` **Define both positive rules and exclusion rules: what this visual world deliberately does not do.**
9. `DEF / MODERATE` **Use references to expand and critique the design space, not to select a site to imitate.**
10. `HOUSE / HIGH` **Separate reference principle from reference artifact: extract why a reference works before borrowing how it looks.**
11. `EST / HIGH` **Treat aesthetics as a performance-relevant amplifier, never as evidence that the product is usable or correct `[AES01]`.**
12. `DEF / HIGH` **When visual decisions materially affect trust, comprehension or brand memory, validate them with relevant people rather than internal taste alone.**

## 11.2 Composition and hierarchy

13. `EST / HIGH` **Every composition SHOULD have a knowable hierarchy.**
14. `DEF / HIGH` **One region may contain several important things, but they should not all compete at the same visual intensity.**
15. `EST / HIGH` **Use scale, contrast, position, spacing, alignment, grouping, depth and motion as a coordinated hierarchy system.**
16. `EST / HIGH` **Reduce irrelevant visual complexity; do not remove useful information merely to make a screen look sparse.**
17. `CTX / HIGH` **Symmetry and asymmetry are both legitimate. Use symmetry for stability and obvious organization; use asymmetry for controlled tension, direction or editorial emphasis.**
18. `DEF / HIGH` **Maintain a small set of strong alignment axes; accidental near-alignment is a craft defect.**
19. `EST / HIGH` **Use proximity and grouping to express relationships before adding borders or containers.**
20. `DEF / MODERATE` **Use interruption intentionally. A break in grid, scale or rhythm should communicate emphasis, transition or meaning.**
21. `DEF / HIGH` **Avoid visual equality between primary, secondary and supporting material.**
22. `CTX / MODERATE` **Centering, leading alignment, split layouts and asymmetric editorial layouts are compositional choices—not quality levels.**
23. `DEF / HIGH` **Design the page/screen as a whole before decorating modules independently.**
24. `HOUSE / HIGH` **If removing a visual element leaves meaning, hierarchy, brand and emotion unchanged, question whether it should exist.**

## 11.3 Grids, spacing and rhythm

25. `DEF / HIGH` **Use a spatial system that creates repeatable relationships, not arbitrary one-off distances.**
26. `CTX / HIGH` **Grid topology MUST follow content structure and responsive pressure; no column count is universally correct.**
27. `CTX / MODERATE` **A base spacing unit MAY improve consistency, but 4px/8px/other units are implementation choices.**
28. `DEF / HIGH` **Prefer a limited spacing scale with meaningful steps over dozens of nearly equivalent values.**
29. `HOUSE / MODERATE` **Optical correction MAY legitimately violate mathematical spacing when the perceptual result is more balanced.**
30. `DEF / HIGH` **Use larger spacing to separate conceptual groups and smaller spacing to bind local relationships.**
31. `DEF / MODERATE` **Vertical rhythm should create pace, not merely repeat one interval.**
32. `CTX / MODERATE` **Editorial compositions MAY intentionally vary rhythm across sections when the variation supports narrative hierarchy.**
33. `DEF / HIGH` **Do not use whitespace as a status symbol. Empty space must earn its opportunity cost.**
34. `DEF / HIGH` **Do not solve structural content problems by shrinking text or reducing target reliability.**

## 11.4 Density

35. `EST / HIGH` **Density and clutter are different constructs. High-density software can remain clear when alignment, grouping and hierarchy are strong.**
36. `CTX / HIGH` **Set density from task expertise, comparison need, frequency, viewport, input precision and consequence—not aesthetic fashion.**
37. `DEF / HIGH` **Use lower density where focus, learning, emotional impact or singular decisions dominate.**
38. `DEF / HIGH` **Use higher density where experts need scanning, comparison, monitoring or rapid manipulation.**
39. `DEF / HIGH` **If density increases, strengthen structure before reducing type size.**
40. `CTX / MODERATE` **Multiple density modes MAY be useful in expert tools if hierarchy and accessibility survive each mode.**

## 11.5 Typography

41. `EST / HIGH` **Typography must first preserve reading and recognition, then express voice.**
42. `EST / HIGH` **Do not treat serif or sans-serif as a universal legibility or prestige switch `[TYP01]`.**
43. `DEF / HIGH` **Choose type by actual letterforms, weights, x-height, spacing, rendering, scripts, variable axes, brand fit and content role.**
44. `DEF / HIGH` **Use a small number of explicit text roles; do not create a unique style for every component.**
45. `DEF / HIGH` **Build hierarchy through coordinated size, weight, spacing, contrast and placement—not size alone.**
46. `DEF / HIGH` **Body typography SHOULD be tested with representative copy lengths, languages, zoom/text scaling and real device rendering.**
47. `CTX / MODERATE` **Reading measure is contextual. Conventional character-per-line ranges are useful priors, not hard acceptance criteria.**
48. `REQ / HIGH` **Web implementations MUST remain functional under applicable WCAG text spacing, resize and reflow requirements `[ACC01]`.**
49. `DEF / HIGH` **Avoid all-caps or extreme letter-spacing for long text where it harms word shape or reading fluency.**
50. `DEF / MODERATE` **Display typography MAY be expressive, compressed, oversized or unconventional when it remains appropriate to its role.**
51. `DEF / HIGH` **Numerals, tables and data-heavy UI require deliberate numeric typography: alignment, tabular figures where useful, signs, decimals and unit hierarchy.**
52. `HOUSE / MODERATE` **Treat text wrapping as composition. Important headlines should be reviewed at real widths rather than left to accidental line breaks.**

## 11.6 Color

53. `EST / HIGH` **Build color as a role system: text, surfaces, accents, interactive states, semantics and data—not a list of favorite swatches.**
54. `EST / HIGH` **Color meaning is contextual; hue, lightness and saturation interact with culture, category and surrounding content `[CLR01]`.**
55. `REQ / HIGH` **Never rely on color alone for critical meaning.**
56. `REQ / HIGH` **Meet applicable text and non-text contrast requirements; visual style does not override accessibility `[ACC01]`.**
57. `DEF / HIGH` **Reserve the strongest chromatic contrast for elements that deserve attention.**
58. `DEF / MODERATE` **Do not saturate every surface with the brand accent; repeated high salience destroys hierarchy.**
59. `CTX / MODERATE` **Monochrome, restrained, vivid and multi-hue systems can all be high craft when role boundaries remain coherent.**
60. `CTX / MODERATE` **Wide-gamut and perceptual color spaces such as OKLCH MAY improve color-system engineering, but they are implementation tools rather than aesthetic laws `[COLORTECH01]`.**
61. `DEF / HIGH` **Dark appearance requires intentional luminance, border, image, saturation and depth decisions; do not simply invert light mode.**
62. `DEF / HIGH` **Test palette behavior with real imagery, states, overlays, disabled content, data visualization and dark/light environments.**

## 11.7 Surfaces, depth and materials

63. `DEF / HIGH` **A surface treatment should communicate containment, hierarchy, interaction or atmosphere—not merely make the UI look designed.**
64. `DEF / HIGH` **Use borders, fills, elevation, blur and translucency according to a consistent depth model.**
65. `CTX / MODERATE` **Flat, layered, glass-like, tactile and highly material interfaces are all style options; none is inherently modern or premium.**
66. `DEF / HIGH` **Do not stack cards inside cards when whitespace and alignment can establish the relationship.**
67. `DEF / HIGH` **Shadows SHOULD have a reason: elevation, separation, focus or material behavior. Decorative shadow accumulation is noise.**
68. `DEF / HIGH` **Translucency must preserve foreground/background legibility across changing content.**
69. `CTX / MODERATE` **Corner radius is a tone and grouping variable, not a maturity score.**
70. `HOUSE / MODERATE` **Define material invariants—e.g., which objects float, which are flush, which can overlap—before polishing isolated components.**

## 11.8 Imagery, illustration and graphics

71. `EST / HIGH` **Every material image needs a job: demonstrate, explain, identify, prove, orient, create emotion or build memory.**
72. `DEF / HIGH` **Define an image grammar: subject, point of view, crop, lighting, color treatment, depth, background, realism and human presence.**
73. `DEF / HIGH` **Use image crops as responsive art-direction decisions; do not assume one crop survives every aspect ratio.**
74. `DEF / HIGH` **Prefer product-specific visual evidence over generic metaphor when the job is explanation or proof.**
75. `CTX / MODERATE` **Photography, illustration, iconography, SVG/CSS graphics, 3D, diagrams, screenshots and generative imagery are mediums, not quality levels.**
76. `DEF / HIGH` **Do not use decorative illustration to compensate for weak information structure.**
77. `DEF / HIGH` **Screenshots shown as proof must remain legible enough to serve their intended proof job; otherwise simplify, crop or annotate intentionally.**
78. `DEF / MODERATE` **Faces and gaze MAY guide social attention but can also steal attention; use them only when their role is explicit.**
79. `CTX / MODERATE` **High-trust or editorial contexts MAY require provenance and authenticity signals for media; C2PA Content Credentials are one current opt-in mechanism, not a universal design requirement `[PROV01]`.**
80. `HOUSE / HIGH` **If AI-generated imagery is used, art direction owns consistency, factual/product accuracy, rights/provenance requirements, cliché rejection and final visual judgment.**

## 11.9 Motion and temporal language

81. `EST / HIGH` **Motion should explain state, continuity, hierarchy, causality or narrative—not merely create activity.**
82. `DEF / HIGH` **Frequent interactions SHOULD use economical motion; repeated delay is a tax.**
83. `DEF / HIGH` **Motion direction, origin and destination should preserve spatial logic where spatial continuity matters.**
84. `CTX / MODERATE` **Duration and easing are contextual; distance, scale, input, frequency and platform conventions matter.**
85. `REQ / HIGH` **Respect applicable motion accessibility requirements and user preferences; essential information must not depend only on motion `[MOT01][ACC01]`.**
86. `DEF / HIGH` **Users SHOULD not be forced to wait for nonessential animation to finish before acting.**
87. `HOUSE / MODERATE` **Define a motion vocabulary—enter, exit, transform, emphasize, confirm—rather than inventing animations per component.**
88. `DEF / MODERATE` **Hero/marketing motion may be more expressive than task UI, but it must not obscure content, harm performance or dominate the product meaning.**

## 11.10 System, AI and QA

89. `DEF / HIGH` **Encode recurring, meaningful visual decisions in a governed system; do not tokenise arbitrary accidents.**
90. `EST / HIGH` **No design is visually complete until the rendered implementation has passed systematic review across representative content, states, viewports and accessibility conditions.**

## 11.11 V2.1 technical-craft additions

91. `CTX / MODERATE` **When a typeface exposes a meaningful optical-size axis, evaluate optical sizing at the actual display roles; a variable font is a capability, not a quality guarantee `[FONTTECH01][FONTTECH02]`.**
92. `DEF / HIGH` **Treat fallback and font-loading states as part of visual correctness when they can change wrapping, hierarchy, numerals, script coverage or layout.**
93. `CTX / HIGH` **Use wide-gamut color only with a defined fallback and QA policy; HDR remains emerging and MUST NOT become a silent baseline dependency `[COLORTECH01][COLORHDR01]`.**
94. `DEF / HIGH` **Evaluate translucent/material surfaces after compositing over representative content and relevant system accessibility settings; token-level contrast alone is insufficient `[MAT01][ACC01]`.**
95. `DEF / HIGH` **Separate semantic token identity from contextual mode resolution and platform output; avoid duplicating whole palettes when aliases/modes can express the real distinction `[SYS02]`.**
96. `DEF / HIGH` **Responsive imagery SHOULD specify art-directed crop variants when one crop cannot preserve subject, proof or composition across materially different aspect ratios `[IMGTECH01]`.**
97. `HOUSE / HIGH` **SVG/CSS/programmatic graphics require a named visual grammar—geometry, stroke/fill, color roles, responsive behavior, theme behavior and semantic/accessibility boundary—just like any other illustration system.**
98. `CTX / HIGH` **Choose an intentional expressiveness level from task, brand, audience and risk; expressive and restrained systems can both be high craft `[EXPR01]`.**
99. `HOUSE / HIGH` **Constrain AI- or code-generated visual output with the product’s visual grammar, but never treat system constraints as a substitute for art-direction acceptance.**
100. `DEF / HIGH` **Design visual enhancements to degrade gracefully: unsupported gamut, HDR, font axes, transparency or platform material effects MUST NOT destroy hierarchy, legibility or brand recognition.**

---

# 12. Art direction as a decision system

Art direction is often weakened into a moodboard. V2 treats it as a decision system.

## 12.1 The Art Direction Brief

Before high-fidelity screen production, record:

```yaml
product_or_experience:
audience_and_context:
primary_visual_job:
  - orient
  - explain
  - build_trust
  - enable_comparison
  - create_desire
  - create_memory
  - support_expert_work
  - other
positioning_inputs:
brand_traits: []
category_codes_to_preserve: []
category_codes_to_question: []
distinctive_assets_available: []
visual_tension:
visual_thesis:
visual_invariants: []
visual_forbidden_moves: []
density_posture:
typography_posture:
color_posture:
imagery_posture:
surface_material_posture:
motion_posture:
responsive_posture:
accessibility_constraints: []
content_realities: []
platform_constraints: []
references: []
reference_principles_extracted: []
known_visual_risks: []
unknowns_to_test: []
```

## 12.2 Visual tension

Strong art direction often contains a deliberate tension rather than a list of adjectives.

Weak:

```text
premium
modern
human
simple
innovative
```

Stronger:

```text
editorial restraint × operational density
institutional trust × unexpected warmth
technical precision × tactile humanity
quiet surfaces × bold typographic interruption
archive/catalog rigor × contemporary motion
```

A tension helps resolve trade-offs. “Modern” does not.

## 12.3 Visual thesis test

A visual thesis is useful if it can answer:

1. Why is this appropriate to the product and audience?
2. How is it different from the nearest category cliché?
3. Which visual decisions does it imply?
4. Which visual decisions does it rule out?
5. Can it generate at least five materially different screens/sections?
6. Can it survive both sparse and dense content?
7. Can it survive small and large windows?
8. Can it survive light/dark or alternate appearance where applicable?
9. Can it be implemented without one-off art direction on every screen?
10. Would the product remain recognizable if the logo disappeared?

If the answer fails repeatedly, the “concept” is likely a styling idea.

## 12.4 Reference protocol

For each reference, extract:

```yaml
reference:
what_is_relevant:
  hierarchy:
  rhythm:
  typography:
  color:
  image_grammar:
  surface_logic:
  motion:
  density:
  editorial_pacing:
why_it_works_here:
what_does_not_transfer:
risk_of_copying:
principle_to_reuse:
artifact_not_to_copy:
```

### Rule

> **Borrow relationships, not fingerprints.**

Do not copy the exact hero composition, gradient, card treatment, radius, font pairing or illustration idiom simply because the reference is admired.

## 12.5 Territory exploration

Before convergence, produce materially different visual territories.

A territory must change more than accent color.

Possible axes:

- editorial ↔ product-native;
- quiet ↔ expressive;
- geometric ↔ organic;
- sparse ↔ information-dense;
- flat ↔ material;
- warm ↔ clinical;
- photographic ↔ illustrative;
- institutional ↔ challenger;
- classic ↔ experimental;
- typographic ↔ image-led.

At least two territories SHOULD differ in underlying visual grammar, not only surface styling, when the art-direction decision is still open.

---

# 13. Composition architecture

## 13.1 Composition precedes component polish

Build macro hierarchy before micro styling:

```text
1. content importance
2. page/screen zones
3. dominant axes
4. primary and secondary focal points
5. reading/scanning path
6. group relationships
7. rhythm
8. responsive transformation
9. surface treatment
10. micro-detail
```

Do not start by perfecting buttons while page-level hierarchy is unresolved.

## 13.2 Focal hierarchy

For each frame, identify:

```yaml
primary_focal_point:
secondary_focal_points: []
quiet_regions: []
visual_entry:
expected_scan_or_read_path:
intentional_interruptions: []
```

A composition can have multiple high-value elements without making them equally loud.

## 13.3 Alignment

Use alignment to create:

- organization;
- continuity;
- comparison;
- visual calm;
- implied relationship.

Misalignment is valid when it creates deliberate editorial tension or hierarchy. Repeated 2–6px accidental offsets are not expressive asymmetry; they are defects.

## 13.4 Symmetry and asymmetry

Use symmetry when you need:

- stability;
- fast organization;
- formal balance;
- calm;
- obvious comparison.

Use asymmetry when you need:

- motion/direction;
- editorial energy;
- hierarchy through imbalance;
- visual surprise;
- stronger negative-space relationships.

Neither is a quality level. Empirical website research shows symmetry can influence aesthetic judgments, but effects vary by context and population `[AES03]`.

## 13.5 Unity in variety

A useful target is neither uniformity nor chaos:

```text
UNITY
shared type system
shared spatial logic
shared image grammar
shared color roles
shared material rules
shared motion rules

+

VARIETY
section emphasis
scale shifts
crop changes
selective color
special editorial compositions
controlled exceptions
```

Research on website aesthetics supports the idea that both unity and variety can contribute to appreciation, while controlled experiments also show that structural and color factors affect different facets of aesthetic perception `[AES04][AES05]`.

---

# 14. Grid systems

A grid is a coordination mechanism, not a visual morality system.

## 14.1 Grid jobs

A grid may support:

- alignment;
- repeated placement;
- comparison;
- responsive transformation;
- editorial rhythm;
- component interoperability;
- edge consistency;
- controlled exceptions.

## 14.2 Grid selection framework

Choose based on content, not fashion:

| Need | Useful starting grid |
|---|---|
| long-form reading | centered/offset reading column + optional marginal grid |
| marketing/editorial storytelling | flexible multi-column editorial grid |
| app shell | stable regions + content subgrid |
| data comparison | tabular/aligned dense grid |
| dashboard | modular content grid with alignment invariants |
| canvas/editor | tool rails + flexible work area |
| mobile | single/few-column flow with strong edge/spacing system |
| list-detail | pane grid/adaptive split |

## 14.3 Columns are not sacred

A 12-column grid is useful because it has many divisors. That convenience does not make it visually superior.

Use 4, 5, 6, 8, 10, 12, fractional, nested, subgrid or no explicit column grid when that better matches the content.

## 14.4 Baseline grids

Baseline alignment can improve typographic rhythm in editorial layouts but becomes brittle when:

- dynamic components change height;
- localization expands content;
- responsive text reflows;
- mixed component types create legitimate vertical variation.

Use baseline relationships where they add coherence; do not force all product UI onto a print-derived baseline ritual.

## 14.5 Grid-breaking

A grid exception should have a named reason:

```text
emphasis
full-bleed image
narrative transition
comparison break
brand signature
spatial continuity
immersive moment
```

If “it looked cooler” is the only rationale, treat it as an experiment, not a system rule.


# 15. Spacing, rhythm and density

## 15.1 Spacing is relational

The question is not:

> “Is this 24px?”

It is:

> **“Does this distance correctly express the relationship between these things relative to the other distances in the system?”**

Spacing communicates:

- belonging;
- separation;
- hierarchy;
- pacing;
- interaction scope;
- editorial pause.

## 15.2 Spacing scale

A useful scale has:

- few enough values to create recognizable rhythm;
- enough range for micro, component, section and macro spacing;
- a rationale for exceptions;
- semantic or compositional names when useful.

Example—not a mandate:

```text
micro      2–4
compact    6–8
local      12–16
group      20–24
section    32–48
macro      64–128+
```

The numbers are contextual. The **relationship** is the standard.

## 15.3 Optical spacing

Mathematical equality can look unequal because glyphs, icons, shapes and visual mass differ.

Allow controlled optical correction for:

- icon-label gaps;
- cap-height alignment;
- circular icons;
- optical centering;
- headline-to-body relationships;
- logos and wordmarks;
- border/shape weight.

If optical exceptions recur, document them as a rule rather than scattering magic offsets.

## 15.4 Density audit

For a dense screen, inspect:

```text
Can experts scan without reading every label?
Are repeated rows aligned?
Can differences be compared vertically/horizontally?
Are interaction targets still reliable?
Is secondary metadata visually quieter without becoming unreadable?
Are groups obvious without excessive boxes?
Can the user distinguish data from controls?
Does selection/focus remain visible?
Can localization and larger text survive?
```

## 15.5 Density anti-patterns

- reducing body text below reasonable legibility to “fit more”;
- using gray-on-gray text as the main hierarchy technique;
- compensating for weak grouping with many borders;
- keeping consumer onboarding density in expert operational software;
- stretching sparse mobile layouts across ultrawide screens;
- treating every 1440px canvas as justification for more columns.

---

# 16. Typography system

Typography is simultaneously language, hierarchy, rhythm, brand and interface infrastructure.

## 16.1 Typeface selection framework

Evaluate candidates on:

```yaml
voice_fit:
category_fit:
distinctiveness:
body_legibility:
display_character:
x_height:
width_and_economy:
weight_range:
variable_axes:
numerals:
punctuation:
symbol_coverage:
language_script_coverage:
diacritics:
italics:
small_text_behavior:
dark_mode_behavior:
rendering_across_platforms:
webfont_cost_and_loading:
license_and_distribution:
```

Do not choose from “serif = editorial” or “grotesk = SaaS” alone.

## 16.2 Type roles

A robust system normally distinguishes roles such as:

- display;
- page title;
- section title;
- body;
- compact body;
- label;
- metadata;
- code/monospace;
- data/numeric;
- annotation/caption.

Not every system needs all roles.

Each role should define enough of:

```yaml
font_family:
font_size:
line_height:
weight:
tracking:
case:
color_role:
max_measure_or_container_behavior:
responsive_behavior:
```

## 16.3 Type scales

A modular scale can generate useful proportion but is not inherently superior.

Build a scale from actual hierarchy needs:

```text
Does a page title clearly outrank a section title?
Can dense UI labels remain compact?
Does display type create personality without forcing every page to shout?
Can mobile display sizes shrink without losing hierarchy?
Do headings wrap acceptably in longer languages?
```

Use optical rather than arithmetic continuity when needed.

## 16.4 Line height

Line height depends on:

- typeface metrics;
- size;
- measure;
- language/script;
- line count;
- density;
- display versus body role.

Avoid turning `1.5` into a universal body-style command. WCAG text-spacing criteria require content to remain functional when users impose specified spacing; they do **not** mandate that every design use those values by default `[ACC01]`.

## 16.5 Reading measure

Long-form prose typically benefits from a constrained measure, but exact CPL ranges remain heuristics.

Review:

- scanning versus continuous reading;
- font width;
- size;
- language;
- viewport;
- column context;
- line spacing;
- audience.

Avoid edge-to-edge desktop prose merely because space exists.

## 16.6 Display typography

Display type may legitimately use:

- extreme scale;
- tight leading;
- unusual width;
- custom alternates;
- variable axes;
- deliberate line breaks;
- kinetic behavior.

The acceptance question is not “is this conventional?” but:

```text
Does it remain intentional?
Does it preserve the intended hierarchy?
Does it express the visual thesis?
Does it survive responsive widths?
Is essential meaning still accessible?
```

## 16.7 Font pairing

Pairing is useful when different families provide a meaningful contrast:

- editorial voice × functional UI;
- display identity × neutral reading;
- humanist text × technical mono;
- serif narrative × sans controls.

Do not add a second family because a template expects one.

## 16.8 Numerals and data

For data-rich products, test:

- tabular vs proportional figures;
- decimal alignment;
- sign visibility;
- percentage symbols;
- currency formatting;
- superscripts/subscripts;
- scientific notation;
- ambiguous glyphs (`0/O`, `1/l/I`);
- code identifiers;
- font-feature support.

## 16.9 Variable fonts and optical sizing

Variable fonts can expose continuous axes such as weight, width, slant and optical size. This can improve system flexibility, but axis count is not craft.

For material typography systems:

```text
prefer registered semantic axes where they match the need
→ evaluate named instances and useful ranges
→ test axis endpoints and combinations actually shipped
→ use optical sizing when the face supports it and the result improves the role
→ avoid decorative axis animation without a communication job
→ preserve a stable fallback if the variable capability is unavailable
```

CSS Fonts Level 4 defines `font-optical-sizing`, and OpenType’s registered `opsz` axis exists specifically to adapt glyph design to displayed text size `[FONTTECH01][FONTTECH02]`. That is a capability contract, not empirical proof that every variable font reads better than every static font.

### Optical-size rule

When `opsz` is present, review at actual text roles instead of assuming one master outline is equally refined at 12px body and 72px display. Preserve manual override where the typeface or context needs it.

## 16.10 Font loading and fallback are visual states

A font system is incomplete if it is only correct after the preferred file has loaded. Review:

- initial fallback;
- final font;
- metric/wrapping change;
- heading orphan/widow changes;
- numeric width changes;
- script fallback;
- missing weight/style synthesis;
- icon/symbol fallback if fonts carry symbols.

Frontend engineering owns loading/performance mechanics. Art direction owns whether the intermediate and fallback visual states remain acceptable.

## 16.11 Typographic QA

Review at minimum:

```text
short / typical / long copy
single-line / multiline headings
numbers / currency / dates
links and emphasis
uppercase labels
small metadata
form controls
errors
empty states
localization expansion
RTL if applicable
200% text resize
400% zoom/reflow where applicable
font loading/fallback
Windows/macOS/iOS/Android/browser rendering as relevant
```

---

# 17. Color architecture

Color quality comes from **roles, relationships and contrast**, not from picking attractive hex values.

## 17.1 Color contract

Define:

```yaml
color_intent:
brand_signature_colors: []
neutral_family:
surface_roles: []
text_roles: []
interactive_roles: []
semantic_roles:
  positive:
  warning:
  danger:
  informational:
selection_focus_roles: []
data_visualization_roles: []
light_appearance:
dark_appearance:
wide_gamut_policy:
contrast_policy:
forced_colors_or_high_contrast_policy:
```

## 17.2 Brand color is not a universal fill

Brand color can be strongest when selectively used.

Overuse creates:

- weak action hierarchy;
- poor separation between brand and semantic states;
- visual fatigue;
- reduced distinctiveness because everything becomes equally branded.

Current Apple brand guidance similarly recommends applying accent color judiciously `[PLAT02]`.

## 17.3 Semantic colors

Semantic meaning should remain stable enough that users do not need to relearn it screen by screen.

But semantic color is not enough. Use labels, icons, shape, placement or other cues where critical meaning requires non-color redundancy.

## 17.4 Perceptual color spaces

Modern CSS supports increasingly capable color spaces and perceptual models. CSS Color 4 is a current Candidate Recommendation Draft and includes Lab/LCH/OKLab/OKLCH and wide-gamut capabilities `[COLORTECH01]`.

Practical use:

- generate more perceptually even scales;
- maintain controlled lightness progression;
- derive states;
- manage gamut more deliberately.

Do not represent OKLCH as proof that a palette is aesthetically better.

## 17.5 Dark appearance

Dark appearance changes perception:

- the same saturation can feel louder;
- fine borders can disappear or glow;
- shadows lose utility on very dark surfaces;
- pure white text can feel harsh;
- imagery can dominate differently;
- translucent layers produce different mixtures.

Re-evaluate:

```text
surface ladder
text contrast
accent saturation
semantic states
images/illustrations
borders
focus indicators
elevation model
data visualization
logos/assets
```

Do not auto-invert raster imagery or brand assets.

## 17.6 Color accessibility is part of art direction

WCAG 2.2 establishes minimum contrast requirements for text and visual information required to identify components/states, and requires that color not be the only communication channel in relevant cases `[ACC01][ACC02]`.

Treat those as floors, not targets for maximum subtlety.

Thin lines, anti-aliasing and overlays can look materially weaker than nominal design-tool contrast values. Review the rendered result.

## 17.7 Gamut, wide color and HDR policy

Treat these as separate decisions:

```text
BASELINE SDR / sRGB-REACHABLE EXPERIENCE
→ OPTIONAL WIDE-GAMUT SDR ENHANCEMENT
→ OPTIONAL HDR ENHANCEMENT
```

CSS Color 4 exposes wide-gamut and perceptual color spaces in the web platform, while CSS Color HDR Level 1 remains a 2026 Working Draft `[COLORTECH01][COLORHDR01]`.

A production color contract SHOULD state:

```yaml
baseline_color_space:
wide_gamut_enabled: true|false
wide_gamut_targets: []
gamut_mapping_policy:
srgb_fallback_required: true|false
hdr_enabled: true|false
hdr_status: emerging|supported_profile
asset_color_profile_policy:
qa_devices_or_environments: []
```

Do not use wider gamut merely because it exists. More chroma can weaken hierarchy, create cross-device mismatch or turn a restrained brand into a different one.

### Fallback invariant

A color enhancement MAY improve richness. It MUST NOT be the only reason text, state, hierarchy or brand recognition works.

## 17.8 Data visualization

Color in data visualization should distinguish the comparison users actually need.

Prefer:

- position/length for precise comparisons when possible;
- color for grouping, category, overview, emphasis or ordered magnitude where appropriate;
- restrained highlight color for the focal series;
- accessible palette separability;
- labels or direct annotation where color legend lookup creates unnecessary effort.

Do not decorate every chart series with unrelated brand colors.

---

# 18. Surfaces, materials and depth

## 18.1 Surface model

A product SHOULD define a small number of surface roles rather than ad hoc rectangles.

Example:

```text
canvas
base surface
raised surface
floating surface
overlay
interactive highlight
selected surface
critical/semantic surface
```

The names are contextual.

## 18.2 Depth model

Depth can be expressed through:

- occlusion;
- shadow;
- border;
- luminance shift;
- blur/translucency;
- scale;
- motion;
- spatial position.

Use the minimum combination needed to communicate the intended relationship.

## 18.3 Glass and translucency

Glass-like treatments can support:

- continuity with underlying content;
- spatial layering;
- immersive visual identity;
- soft separation.

They can also cause:

- low contrast;
- noisy backgrounds;
- excessive GPU/render cost;
- blurred hierarchy;
- trend dependence.

Adopt because the material model helps the product—not because “glassmorphism” is current.

## 18.4 Borders

Borders are strongest when they communicate:

- interactive boundary;
- group containment;
- row/column structure;
- separation between similar surfaces;
- focus/state.

Avoid defaulting every object to `1px solid gray` when whitespace/alignment already resolves the relationship.

## 18.5 Shadows

A shadow system should have few coherent levels. Review:

- direction;
- spread;
- softness;
- color/tint;
- dark-mode behavior;
- overlap with borders;
- whether elevation actually changes.

Random component-specific shadows are a visual-system defect.

## 18.6 Texture

Texture may add tactility, editorial character, warmth or differentiation. It also increases noise and file/render complexity.

Use texture when it supports the thesis. Do not add grain as an automatic “premium” layer.

## 18.7 Dynamic and translucent materials

Translucency is not a static color. The perceived result depends on:

- the foreground content;
- background luminance/chroma/detail;
- blur and opacity;
- motion beneath the surface;
- system contrast/transparency preferences;
- display characteristics.

Current Apple material guidance is a useful platform-specific example: it uses Liquid Glass primarily as a functional control/navigation layer, explicitly warns against overuse, and notes that system accessibility settings can alter material appearance `[MAT01]`. V2.1 generalizes only the durable mechanism:

> **A dynamic material must preserve hierarchy and legibility under the backgrounds and settings it will actually encounter.**

### Composite-material QA

Review a translucent surface over:

```text
light plain background
dark plain background
high-detail image/content
brand-saturated content
motion/scroll behind it
increased contrast / reduced transparency where the platform exposes it
```

Do not certify a material by inspecting its token values on an empty artboard.

---

# 19. Imagery and visual asset direction

## 19.1 Choose the job before the medium

| Job | Often useful media |
|---|---|
| show the product | real screenshots, product renders, focused detail crops |
| explain a system | diagrams, annotated UI, sequences, motion |
| demonstrate use | contextual photography/video, scenario illustration |
| provide proof | real customer/product evidence, data, documentary imagery |
| build emotion | photography, film, illustration, 3D, abstract image-making |
| build memory | recurring character, shape, image grammar, distinctive crop/treatment |
| orient | maps, diagrams, thumbnails, representative imagery |

No medium is universally superior.

## 19.2 Image grammar

Define stable decisions for:

```yaml
subject_matter:
human_presence:
camera_distance:
angle:
lens_feel:
lighting:
contrast:
color_cast:
background:
depth_of_field:
crop:
negative_space:
retouching:
realism_level:
texture:
compositing:
caption_or_annotation_style:
```

A coherent image grammar creates brand continuity more effectively than applying the same color filter to unrelated stock photos.

## 19.3 Photography

Photography is strongest when the real world itself is evidence or emotion.

Avoid:

- generic diverse-team laptop scenes with no product relevance;
- impossible UI composited into devices without perspective/light consistency;
- staged “authenticity” that contradicts the brand's reality;
- repeated stock subjects used by many competitors;
- crops that cut faces, hands, product details or context unintentionally.

## 19.4 Product imagery

For product/software imagery, decide the degree of abstraction:

```text
literal full screenshot
→ crop/detail
→ simplified screenshot
→ annotated screenshot
→ conceptual product diagram
→ abstract metaphor
```

Use the most literal representation that communicates the job without creating irrelevant complexity.

## 19.5 Illustration

Illustration works when it creates something photography/screenshots cannot efficiently provide:

- impossible viewpoint;
- conceptual explanation;
- proprietary character/world;
- consistent metaphor;
- controlled emotional tone;
- simplified process/state.

Avoid generic “floating people + blobs” or decorative scenes that contribute no meaning.

## 19.6 3D

3D may provide:

- product materiality;
- spatial explanation;
- hero distinctiveness;
- controlled lighting;
- impossible camera movement.

But 3D without art direction often becomes generic glossy-object decoration. Define material, light, camera, composition and relation to UI before production.

## 19.7 Iconography and pictographic systems

Icons must succeed at at least one of two jobs:

```text
SEARCH / LOCATE the target quickly
UNDERSTAND / RECOGNIZE the intended meaning
```

Those jobs are related but not identical. A 2026 controlled study found higher icon salience improved visual-search speed/load, while familiarity improved semantic-recognition accuracy and speed in the studied task `[ICON01]`.

Define an icon system by more than stroke width:

```yaml
semantic_strategy:
familiar_conventions_to_preserve: []
metaphor_rules:
viewbox_or_canvas:
optical_size_classes: []
stroke_or_fill_model:
stroke_widths: []
cap_join_rules:
corner_language:
terminal_language:
detail_budget:
negative_space_rules:
color_roles:
selected_active_disabled_behavior:
labeling_policy:
rtl_or_directional_rules:
custom_icon_acceptance:
```

### Icon rule

Use familiar symbols where relearning adds no value. Spend novelty on brand expression only when meaning remains discoverable. An aesthetically distinctive but semantically opaque icon is not high craft.

### Optical consistency beats geometric equality

Different glyphs may require:

- different visual mass;
- optical centering;
- controlled overshoot;
- adjusted detail at small sizes;
- filled versus outlined variants;
- simplified small-size masters.

Do not force every icon to occupy identical geometry if the result looks visually uneven.

## 19.8 Programmatic, SVG and CSS-native graphics

Programmatic graphics can be especially strong for digital products because they can remain crisp, responsive, theme-aware and structurally tied to the product. They still need art direction.

Define:

```yaml
visual_job:
geometry_grammar:
stroke_rules:
fill_rules:
corner_and_join_rules:
color_roles:
layering:
responsive_behavior:
theme_behavior:
motion_behavior:
semantic_or_decorative:
accessible_alternative_if_informational:
implementation_owner:
```

Good uses include:

- product/system diagrams;
- branded abstract motifs;
- data-linked graphics;
- animated process illustrations;
- responsive decorative systems;
- reusable icon/diagram primitives.

Avoid:

- random procedural blobs with no brand logic;
- pseudo-technical grids/particles used as generic “AI” decoration;
- embedding essential text into graphics when live text is appropriate;
- visual complexity that exists only because code can generate it.

The browser/platform implementation belongs to frontend engineering. This playbook owns the visual grammar and acceptance standard.

## 19.9 Generative imagery

AI-generated imagery is acceptable when it meets the same visual standard as any other medium.

Additional checks:

```text
Does it look materially specific to this brand/product?
Are anatomy/object/details coherent at final size?
Are text/logos/product details correct?
Is style consistent across the set?
Does it repeat familiar model aesthetics?
Does it accidentally copy a reference too closely?
Are licensing/provenance requirements satisfied?
Is the image honest about what is real when that distinction matters?
```

Where provenance is a trust requirement, current C2PA 2.4 provides an opt-in technical mechanism for tamper-evident provenance and Content Credentials `[PROV01]`.

## 19.10 Cropping is art direction

Specify focal region and alternate crops where necessary.

A responsive image system may need:

- art-directed source sets;
- different crops per range;
- subject-position metadata;
- safe areas for overlay text;
- mobile-specific compositions;
- dark/light variants.

`object-fit: cover` is not an art director.

## 19.11 Responsive image art-direction contract

When one source composition cannot preserve meaning across materially different containers, specify variants rather than outsourcing the decision to cropping math. Current responsive-image guidance explicitly distinguishes **resolution switching** from **art direction** and uses the `<picture>` model for different crops/layouts `[IMGTECH01]`.

A material image contract SHOULD make this recoverable:

```yaml
asset_id:
meaning_or_job:
primary_subject:
focal_anchor:
safe_region:
text_overlay_safe_region:
required_context:
variants:
  - aspect_or_context:
    crop_intent:
    subject_scale:
    permitted_recomposition:
light_dark_variants:
wide_gamut_or_profile_notes:
alt_meaning_invariant:
fallback_variant:
```

The alternative text/meaning normally remains semantically consistent even when the crop changes; if the visual meaning itself changes, review whether it is actually the same asset/job.

---

# 20. Brand expression in product visual design

## 20.1 Translate, do not decorate

A brand does not become present merely by adding:

- logo;
- accent color;
- branded illustration;
- marketing font.

Brand expression can live in:

- density;
- pace;
- typographic voice;
- crop;
- motion;
- shape;
- iconography;
- surface behavior;
- data visualization;
- empty states;
- microcopy tone;
- treatment of evidence;
- degree of restraint.

## 20.2 Category code matrix

Record:

| Code | Why customers expect it | Keep / reinterpret / break | Risk if broken |
|---|---|---|---|
| visual structure |  |  |  |
| type conventions |  |  |  |
| color conventions |  |  |  |
| imagery conventions |  |  |  |
| interaction chrome |  |  |  |
| trust/proof cues |  |  |  |
| density |  |  |  |

## 20.3 Distinctive asset translation

For each brand asset ask:

```text
Where can it appear naturally?
How often should it appear?
When does repetition strengthen ownership?
When does it become visual noise?
Can it survive dark/light/adaptive contexts?
Does it remain recognizable at small sizes?
Does it compete with semantic UI color or state?
```

## 20.4 Brand intensity by surface

A coherent product can vary intensity:

```text
MARKETING / HERO      high expressive allowance
EDITORIAL / STORY     medium-high
ONBOARDING            medium
CORE TASK UI          calibrated
DENSE OPERATIONS      restrained but recognizable
ERROR / HIGH STAKES   clarity-first
SETTINGS / ADMIN      clarity-first
```

The brand does not disappear in utility screens; its expression becomes quieter.

---

# 21. Visual storytelling and editorial pacing

Visual storytelling is the sequencing of attention and meaning over scroll, navigation or time.

## 21.1 Narrative unit

Each section/screen should answer at least one job:

```text
orient
state claim
show proof
explain mechanism
compare
create emotional context
reduce uncertainty
invite action
transition
```

A page that repeats the same visual job in eight cards is not a story.

## 21.2 Pacing

Pacing can be created through:

- changes in scale;
- density shifts;
- image-led vs text-led sections;
- background/surface changes;
- full-bleed moments;
- narrow reading passages;
- quiet space;
- data/proof clusters;
- controlled motion;
- recurring anchors.

Avoid a monotonous sequence of identical section templates unless repetition itself supports the task.

## 21.3 Editorial composition

Editorial digital design often benefits from:

- stronger typographic hierarchy;
- controlled measure;
- deliberate captioning;
- asymmetric image/text relationships;
- pullouts/annotations;
- meaningful variation in rhythm;
- explicit source/proof treatment.

Editorial does **not** mean using a serif font and large whitespace.

## 21.4 Long pages

For long pages, maintain continuity through:

- consistent section logic;
- repeated visual anchors;
- changing composition without changing visual language;
- progressive proof;
- predictable headings;
- strong ending/CTA architecture.

Do not treat every scroll section as an isolated poster.

---

# 22. Responsive and adaptive art direction

Responsive visual design is the preservation of intent under changing constraints.

## 22.1 Adaptation model

Use four operations:

```text
REFLOW
same content, new spatial arrangement

REVEAL
additional space exposes useful context

PRIORITIZE
relative prominence changes because space/attention changes

TRANSFORM
same purpose adopts a different visual/presentation form
```

Current Android adaptive guidance similarly emphasizes window-size-aware layouts rather than simply stretching one layout `[ADAPT01]`.

## 22.2 Art-direction invariants across sizes

Preserve:

- primary hierarchy;
- brand identity;
- semantic color roles;
- typographic relationships;
- image meaning;
- interaction state legibility;
- focal order;
- accessibility.

Do not preserve:

- exact line breaks;
- exact column count;
- exact pixel gaps;
- exact crop;
- exact absolute size;
- decorative elements that no longer earn space.

## 22.3 Content pressure before breakpoint numbers

Resize until the composition begins to fail.

Failure signals:

- headline wraps into weak orphaned shape;
- columns become too narrow;
- labels collide;
- focal hierarchy inverts;
- image subject is lost;
- reading measure becomes excessive;
- controls become too dense;
- navigation no longer fits;
- whitespace becomes absurdly large;
- proof/data cannot be compared.

Place adaptation around those pressure points. Breakpoint names are implementation details.

## 22.4 Wide screens

Do not stretch content merely because viewport width exists.

Possible strategies:

- maintain readable max measure;
- add contextual pane;
- enlarge imagery selectively;
- increase spatial separation;
- reveal supporting detail;
- use a wider grid while preserving focal hierarchy.

## 22.5 Small screens

Do not respond by only shrinking.

Possible changes:

- stack;
- crop differently;
- reorder by priority;
- collapse supporting detail;
- change type scale ratios;
- convert side-by-side comparison to swipe/stack where semantics permit;
- move persistent secondary chrome;
- reduce decoration before reducing information clarity.

## 22.6 Localization and visual design

Test:

- longer translated headings;
- German/Finnish-style expansion;
- CJK density;
- Arabic/Hebrew RTL;
- mixed-script content;
- localized numerals/dates/currency;
- mirrored directional layouts where appropriate;
- image cultural fit.

A design that only works for short English copy is unfinished.

---

# 23. Motion language

## 23.1 Motion jobs

Classify each animation:

| Job | Question |
|---|---|
| continuity | where did this object/state come from or go? |
| causality | what changed because of my action? |
| hierarchy | what deserves attention now? |
| status | is work ongoing/completed/failed? |
| orientation | did I move between scopes/levels? |
| narrative | how does a story unfold over time? |
| delight | can expression enrich an already clear interaction? |

If an animation has no job, remove or demote it.

## 23.2 Motion grammar

Define:

```yaml
motion_character:
  calm | crisp | elastic | physical | editorial | playful | other
enter_behavior:
exit_behavior:
transform_behavior:
emphasis_behavior:
loading_behavior:
route_transition_behavior:
hover_focus_behavior:
scroll_behavior:
reduced_motion_behavior:
```

## 23.3 Continuity

When an object persists conceptually, motion can help users perceive continuity.

Examples:

- card → detail;
- thumbnail → viewer;
- collapsed → expanded;
- selected object → editor;
- list item → side pane.

Do not animate between unrelated states merely to showcase interpolation.

## 23.4 Frequency matters

A one-time expressive transition can tolerate more character than an animation users trigger 200 times per day.

Rule:

> **Animation cost compounds with interaction frequency.**

## 23.5 Accessibility

W3C guidance requires motion triggered by interaction to be suppressible at AAA unless essential, and documents `prefers-reduced-motion` techniques `[ACC01][MOT02]`. Even when the exact conformance level is not mandated, respecting user motion preferences is a strong design default.

Reduced motion should preserve:

- state change;
- orientation;
- completion feedback;
- hierarchy.

Replace motion with other cues rather than removing meaning.

---

# 24. Premium, editorial and high-craft design

## 24.1 Premium is not a recipe

The inherited design evidence explicitly rejects:

```text
premium = black + serif + whitespace
```

Whitespace and monochrome can influence luxury perception in some categories, but context and interaction effects matter `[LUX01]`.

Use this stronger model:

```text
PREMIUM PERCEPTION
≈ confidence
+ coherence
+ precision
+ material/imagery quality
+ controlled attention
+ appropriate restraint
+ evidence of care
+ category/price-position fit
```

## 24.2 Controlled complexity

Premium can be sparse or dense.

Examples:

- luxury commerce: large image fields + restrained copy;
- institutional finance: dense information + immaculate typography;
- premium productivity: compact expert UI + precision motion;
- editorial fashion: expressive image rhythm + quiet chrome.

The common quality is **control**, not emptiness.

## 24.3 High-craft signals

High craft often appears in details that templates ignore:

- exact text wrapping;
- optical alignment;
- image crops;
- consistent icon weight;
- numeric typography;
- subtle but real hierarchy;
- state completeness;
- meaningful empty states;
- dark-mode retuning;
- responsive edge cases;
- animation interruption;
- loading transitions;
- high-quality source assets;
- no accidental default browser/platform styling where it conflicts with the thesis;
- no unresolved one-off values.

## 24.4 Restraint

Restraint means refusing visual competition that does not improve the experience.

It does not mean:

- beige;
- low contrast;
- tiny typography;
- no color;
- no imagery;
- no personality.

## 24.5 Editorial quality

Editorial quality means the designer controls **sequence, emphasis and reading rhythm**. It can be built with sans-serif, color, motion and dense information just as legitimately as with serif and whitespace.

---



## 24.6 Expressiveness and visual intensity

Do not force every product into a binary choice between “minimal” and “expressive.” Model intensity as a tunable property.

Possible levers:

- color contrast/chroma;
- shape variation;
- scale contrast;
- type personality;
- imagery dominance;
- motion frequency/amplitude;
- containment/material richness;
- composition tension.

Google’s Material 3 Expressive program is useful contemporary evidence that coordinated color, shape, size, motion and containment can improve salience and emotional response in tested interfaces, while its own research also cautions that some users prefer calmer treatments `[EXPR01]`.

### V2.1 rule

```text
TASK + BRAND + AUDIENCE + RISK
→ REQUIRED CALM / ENERGY
→ EXPRESSIVENESS RANGE
→ TESTED EXECUTION
```

High expressiveness is not automatically high craft. Low expressiveness is not automatically mature. The question is whether the chosen intensity improves the intended meaning without increasing interpretation cost or undermining trust.

---

# 25. Design systems: visual decisions as infrastructure

A design system is not the visual design itself. It is infrastructure for preserving and distributing selected decisions.

## 25.1 What belongs in the visual system

Good candidates:

- semantic color roles;
- typography roles;
- spacing scale;
- radius family where meaningful;
- border/elevation/material roles;
- iconography rules;
- grid/edge invariants;
- image aspect/crop conventions;
- motion roles;
- data-visualization palette/annotation rules;
- theme/appearance mappings;
- shared component visual states.

Poor candidates:

- one-off editorial composition;
- arbitrary values with no reuse or semantic meaning;
- every historical pixel value;
- generated aliases no human can explain;
- special-case fixes promoted into permanent global tokens.

## 25.2 Token architecture

A useful hierarchy:

```text
PRIMITIVE / FOUNDATION
raw palette, size, type metrics where useful
        ↓
SEMANTIC
text-primary, surface-raised, space-group, motion-emphasis
        ↓
COMPONENT / PATTERN
button-primary-bg, table-row-selected, hero-display-size
        ↓
INSTANCE
rare local exception with explicit rationale
```

Do not force this exact taxonomy when a simpler model is enough.

## 25.3 Token naming

Prefer names that preserve intent:

```text
color.text.muted
color.surface.raised
space.section.compact
motion.duration.feedback
```

Avoid names that freeze accidental appearance:

```text
gray-423
button-shadow-2
blue-that-we-use-on-cards
```

Primitive numeric/color names can still be useful internally; semantics should exist where product meaning depends on them.

## 25.4 Current interoperability status

The W3C Design Tokens Community Group published final 2025.10 Format, Color and Resolver reports. They provide a current interchange foundation for token tooling but remain Community Group reports, not W3C Recommendations `[SYS01]`.

Therefore:

- use them where interoperability value exists;
- preserve source status accurately;
- do not let file format drive design-system architecture;
- maintain semantic governance above serialization.

## 25.5 Component systems do not replace page art direction

A page built from individually excellent components can still fail because:

- everything has equal prominence;
- spacing rhythm is monotonous;
- section pacing is absent;
- cardification fragments the page;
- image/copy relationships are weak;
- no intentional visual tension exists.

Component quality is necessary infrastructure. Composition still needs design.

## 25.6 Exceptions

A mature system supports explicit exception logic.

Good exception:

> Marketing launch hero intentionally uses a one-off display treatment to create a campaign signature; body/UI typography remains on system roles.

Bad exception:

> This component is 22px because 20 looked small and 24 looked big.

Record recurring exceptions. Repeated exceptions are evidence that the system may be wrong.

## 25.7 Contexts, modes and resolver logic

V2.1 distinguishes four layers:

```text
RAW / PRIMITIVE VALUE
→ SEMANTIC TOKEN IDENTITY
→ CONTEXT / MODE RESOLUTION
→ PLATFORM / RUNTIME OUTPUT
```

The DTCG Resolver Module 2025.10 provides a stable Community Group model for resolving token values across contexts such as light and dark themes `[SYS02]`. This is useful infrastructure guidance, not a command to create a mode for every state.

Use a mode/context when:

- the semantic role is stable;
- the value legitimately changes by a named context;
- consumers need the same resolution rule;
- the context has an owner and test coverage.

Avoid mode explosion such as:

```text
light × dark × compact × spacious × marketing × product × mobile × desktop × campaign
```

when several axes are actually local composition decisions rather than global token contexts.

## 25.8 Color-token interchange and fallback

The DTCG Color Module can represent color spaces, alpha and a hex fallback and explicitly notes that gamut mapping choices can change appearance `[SYS03]`.

Therefore a color-token pipeline SHOULD distinguish:

```text
canonical design intent
≠ interchange representation
≠ platform conversion
≠ rendered device result
```

A token file is not proof that the output color is visually equivalent across platforms.

## 25.9 Contribution gate

Before adding a visual token/style/pattern:

```text
[ ] Is this a recurring decision?
[ ] Does it express a semantic or compositional role?
[ ] Does an existing role already cover it?
[ ] Will this reduce inconsistency rather than encode it?
[ ] Does it work in required appearances/themes?
[ ] Does it meet accessibility constraints?
[ ] Is ownership clear?
[ ] Is migration/deprecation possible?
```

---

# 26. Trends versus timelessness

Trend awareness is useful. Trend obedience is not.

## 26.1 Trend decomposition

For any trend, separate:

```text
VISUAL SIGNATURE
what makes it recognizable as the trend

UNDERLYING MECHANISM
what problem it may solve

PRODUCT FIT
whether that problem exists here

VOLATILITY
how quickly the signature may date

LOCK-IN
how expensive it is to remove
```

Example:

```text
TREND: glass/translucent controls
signature: blur, translucency, specular/highlight feel
mechanism: distinguish chrome while maintaining spatial continuity
fit: maybe useful over rich backgrounds or layered canvases
risk: contrast, rendering cost, fashion dependence
```

## 26.2 Trend adoption matrix

| Strategic fit | Functional benefit | Adoption posture |
|---|---:|---|
| high | high | adopt deliberately; systematize |
| high | low | use selectively as expression |
| low | high | abstract the mechanism; remove trend fingerprint |
| low | low | reject |

## 26.3 Isolate volatile signatures

If using a trend likely to date:

- keep it in replaceable layers;
- avoid coupling semantics to the style;
- avoid encoding it into every component;
- preserve stable type/layout/color roles underneath;
- define a future-removal path.

## 26.4 Timelessness

Timelessness does not mean neutral styling.

A visually expressive system can age well when:

- its concept is tied to product/brand meaning;
- its distinctive assets are owned rather than generic;
- core hierarchy is functional;
- trendy effects are not the only source of identity;
- materials and typography are coherent;
- implementation remains maintained.

## 26.5 Trend audit questions

```text
Would we still choose this if competitors stopped using it tomorrow?
Does it solve a visual/product problem or only signal contemporaneity?
Is the effect becoming a category cliché?
Can we make the mechanism ours rather than copying the signature?
What breaks if the effect is removed?
How expensive will a future restyle be?
```

---

# 27. Anti-template design

Template design is not bad because it uses reusable patterns. It is bad when a pattern dictates meaning instead of serving it.

## 27.1 Common template signatures

Examples—not banned styles:

- generic centered SaaS hero + gradient blob;
- three benefit cards because the template has three slots;
- identical bento grids regardless of content relationship;
- logo cloud inserted without strategic proof logic;
- every section using icon + title + two lines;
- alternating left-right screenshots with no narrative reason;
- giant gradient headline followed by generic floating dashboard mockup;
- stock testimonial portraits detached from actual evidence;
- over-rounded containers across every section;
- generic dark section before CTA because the theme does it;
- “AI” visualized as glowing purple/blue network regardless of product;
- decorative sparkles, grids and noise added as modernity markers.

## 27.2 Anti-template diagnostic

Ask:

1. If all copy and logos disappeared, would this composition be distinguishable from 20 category peers?
2. Does each section format match its content job?
3. Are there recurring visual assets only this brand plausibly owns?
4. Does the page have a narrative rhythm or a module sequence?
5. Are image choices product-specific?
6. Are visual exceptions meaningful?
7. Does the system reveal a point of view?

If the answer is repeatedly “no,” visual polish may be masking generic structure.

## 27.3 Template use is legitimate

Templates/components can be excellent for:

- commodity settings screens;
- admin surfaces;
- low-risk internal tools;
- early prototypes;
- repeatable editorial structures;
- consistency-sensitive operations.

The rule is not “avoid templates.” It is:

> **Do not allow a reusable artifact to make a strategic art-direction decision by default.**

---

# 28. Anti-AI-slop standard

Generative tools create leverage and a new failure mode: fast convergence on plausible averages.

The current evidence does not justify “AI destroys creativity” as a universal claim. It does justify treating fixation and homogenization as real risks. A 2026 systematic review/meta-analysis found a small statistically significant homogenization effect across 19 studies / 61 effect sizes `[AI01]`; CHI 2024 experimental work found image-generator exposure increased fixation and reduced idea variety/originality in its visual ideation task `[AI02]`.

## 28.1 Core rule

> **Use AI to expand capability without outsourcing taste, direction or acceptance.**

## 28.2 AI is strongest in different jobs at different stages

Useful roles:

- reference expansion;
- rapid material exploration;
- alternate compositions;
- image ideation;
- mood/lighting studies;
- asset variants;
- crop extension;
- texture/background generation;
- production cleanup;
- visual QA assistance;
- consistency checking.

Higher-risk roles:

- choosing the core art direction before the problem is framed;
- generating “premium SaaS site” from a generic prompt;
- asking one model for all references, concepts and final execution;
- using generated imagery as factual product evidence;
- accepting first-pass outputs as brand assets;
- reproducing a living artist/studio/client reference too literally.

## 28.3 Divergence protocol

Before convergence:

```text
1. Define the visual problem without asking an image model for the answer.
2. Collect references from multiple eras/categories/media.
3. Write at least 3 materially different visual tensions/territories.
4. Generate or sketch human-origin starting structures.
5. Use AI separately inside each territory.
6. Deliberately change prompt vocabulary, reference families and model/tool where useful.
7. Compare outputs for repeated model defaults.
8. Combine/reject/rebuild instead of selecting the prettiest first result.
```

## 28.4 AI-slop indicators

Potential warning signs:

- unexplained purple/blue glow;
- generic “futuristic” glass;
- over-smoothed 3D objects;
- random isometric devices;
- impossible microtext;
- fake UI detail;
- generic diverse office people;
- vague sci-fi networks for AI;
- atmospheric gradients replacing information;
- identical cinematic lighting across unrelated scenes;
- over-symmetric centered compositions;
- same model-face archetypes;
- incoherent hands/objects/details;
- decorative charts with nonsense data;
- copy-image mismatch;
- visual style changes between generated assets;
- reference fingerprints that feel too close to one source.

The presence of one sign does not prove poor quality. The pattern matters.

## 28.5 Authorship test

Before approving AI-assisted visual work, ask:

```text
What decisions here are genuinely ours?
What would another user of the same model likely receive?
Which recurring cues make this brand-specific?
What did we change after generation?
Can we explain why each major visual decision belongs?
Would the work survive without the fashionable model signature?
```

## 28.6 Provenance and disclosure

Provenance requirements depend on use case, law, policy, trust and brand.

Where provenance matters, preserve:

- source assets;
- prompts/settings where appropriate;
- editing history where useful;
- licenses/rights;
- generation tool/model/version if material;
- human approval;
- Content Credentials/C2PA where the ecosystem and use case benefit `[PROV01]`.

Do not claim C2PA proves that the content is true; it provides provenance/authenticity information under its trust model.

## 28.7 AI visual QA

Generated assets need additional QA for:

- factual correctness;
- embedded text;
- brand/logo accuracy;
- anatomy/object structure;
- perspective;
- lighting/shadows;
- reflections;
- cultural representation;
- prohibited/unsafe content;
- rights/provenance;
- consistency across asset family;
- crops at delivery sizes;
- compression and artifacting.

---

# 29. Systematic Visual QA Standard

Visual QA is not a final “looks good” pass. It is structured verification of the rendered visual system.

## 29.1 Three QA questions

```text
VERIFICATION
Did implementation preserve the intended visual decisions?

VALIDATION
Does the visual system work for the intended product, audience and context?

REGRESSION
Did a later change unintentionally alter an accepted visual property?
```

These are different questions.

## 29.2 Visual QA layers

### Layer 1 — Render integrity

Check:

- missing fonts/assets;
- broken images;
- layout overflow;
- clipping;
- stacking/z-index;
- unexpected browser defaults;
- SVG/icon rendering;
- DPR/raster sharpness;
- loading/fallback behavior.

### Layer 2 — Macro composition

Check:

- page/screen hierarchy;
- focal point;
- alignment axes;
- section rhythm;
- balance;
- unexpected whitespace collapse;
- over-cardification;
- global edge consistency.

### Layer 3 — Typography

Check:

- font loaded;
- correct weights;
- line breaks;
- widows/orphans where material;
- line-height;
- text measure;
- clipping;
- truncation;
- numeric alignment;
- fallback fonts;
- localization growth.

### Layer 4 — Color and contrast

Check:

- text contrast;
- component/state contrast;
- semantic colors;
- color-independent meaning;
- dark/light appearance;
- translucency over variable content;
- wide-gamut fallback if used;
- high-contrast/forced-color behavior where applicable.

### Layer 5 — Surfaces and depth

Check:

- material roles;
- border consistency;
- shadow/elevation logic;
- nested surfaces;
- overlay readability;
- sticky/header edge behavior;
- modal/sheet layering.

### Layer 6 — Imagery

Check:

- source resolution;
- crop;
- art direction per viewport;
- focal subject;
- color treatment;
- captions/attribution;
- lazy-load transition;
- broken-image fallback;
- dark/light variants;
- generated-asset consistency.

### Layer 7 — Interaction states as visual states

Even though UI behavior is owned by the UI standard, visual QA MUST inspect the appearance of:

- default;
- hover;
- focus-visible;
- active/pressed;
- selected;
- disabled;
- loading;
- success;
- warning;
- error;
- empty;
- stale/offline/conflicted where applicable;
- drag/drop states;
- expanded/collapsed;
- modal/overlay;
- optimistic/reverted state.

A beautiful default state is not a complete visual system.

### Layer 8 — Responsive/adaptive

Review continuously across widths, not only named devices.

At minimum sample:

```text
narrow phone
wide phone
small tablet / split view
tablet
small laptop window
standard desktop
large desktop
ultrawide / max-width behavior
```

Also test intermediate widths where content pressure appears.

### Layer 9 — Zoom, text scaling and localization

Check:

- 200% text resize where relevant;
- 400% zoom/reflow where applicable;
- browser font scaling;
- pseudo-localization;
- long labels;
- RTL;
- mixed scripts;
- system text-size accessibility settings for native apps.

### Layer 10 — Motion

Check:

- continuity;
- timing character;
- interruption/cancellation;
- rapid repeated use;
- reduced motion;
- dropped frames/jank where material;
- content available without waiting for nonessential motion.

### Layer 11 — Brand/art-direction continuity

Ask:

- Does this still look like the intended product without the logo?
- Are recurring visual assets consistent?
- Did implementation introduce generic defaults?
- Are exceptions deliberate?
- Does one feature look as if another team/vendor designed it?

### Layer 12 — Content realism

Use:

- real names;
- real data ranges;
- long and short titles;
- empty states;
- error messages;
- real product screenshots;
- realistic list lengths;
- long URLs/files/identifiers;
- actual pricing/currency/date formats where relevant.

Lorem ipsum hides design defects.

## 29.3 Visual regression automation

Tools such as Storybook/Chromatic can snapshot component stories and compare them with baselines `[QA01]`. Playwright can compare page/component screenshots but warns that rendering varies by OS, browser version, hardware/settings and other environmental factors; stable baselines require controlled execution environments `[QA02]`.

Use automation to detect:

- unexpected deltas;
- state omissions;
- layout changes;
- cross-browser rendering differences;
- component drift.

Do **not** use it to decide automatically whether the baseline is good.

## 29.4 Baseline acceptance

Before a snapshot becomes baseline:

```text
[ ] reviewed by a competent designer/reviewer
[ ] representative content used
[ ] key states included
[ ] target viewport/context named
[ ] accessibility visual constraints checked
[ ] known intentional exceptions recorded
[ ] no unresolved critical visual defect
```

## 29.5 Difference thresholds

No universal pixel-diff threshold is safe.

Threshold depends on:

- rendering stability;
- antialiasing noise;
- animation;
- dynamic content;
- type rendering;
- criticality of region;
- screenshot normalization.

A threshold should reduce noise without hiding real change.

## 29.6 Human review remains mandatory for material change

Automated regression answers:

> **“Did pixels differ from the accepted reference?”**

Human visual review must answer:

> **“Is this difference intended, coherent, accessible, brand-correct and good enough?”**

Empirical software-testing research likewise treats automated/augmented GUI testing as support for, not a magical elimination of, human regression work `[QA03]`.

## 29.7 Modern rendering and appearance matrix

When the system uses modern visual capabilities, add only the relevant rows:

| Capability | Minimum visual QA |
|---|---|
| variable/optical font | representative body/display roles, axis endpoints used, fallback and loaded state `[FONTTECH01]` |
| wide-gamut color | sRGB/fallback environment + at least one target wide-gamut environment `[COLORTECH01][SYS03]` |
| HDR | explicit supported profile/device + SDR fallback; treat as emerging `[COLORHDR01]` |
| translucent material | representative light/dark/high-detail backgrounds + relevant accessibility settings `[MAT01]` |
| responsive image art direction | each specified crop/aspect variant at its intended container `[IMGTECH01]` |
| light/dark/token modes | semantic-role continuity and contrast across resolved contexts `[SYS02]` |
| SVG/CSS/programmatic graphic | responsive bounds, theme behavior, zoom, semantics/alternative where informational |

Do not add rows for technologies the product does not use. QA is risk- and capability-driven, not a feature checklist.

## 29.8 Visual defect severity

### `V0 — Blocker`

- core content unreadable/invisible;
- critical state misleading;
- accessibility visual blocker;
- core viewport unusable;
- brand/factual imagery materially wrong;
- release asset broken.

### `V1 — Major`

- hierarchy materially wrong;
- responsive composition broken;
- typography/crop defect affects comprehension;
- dark/light appearance seriously inconsistent;
- missing critical state;
- clear visual-system regression.

### `V2 — Moderate`

- spacing/alignment inconsistency;
- minor state mismatch;
- repeated visual debt;
- small crop/weight inconsistency;
- localized polish issue without task blockage.

### `V3 — Polish`

- optical refinement;
- micro-spacing;
- subtle motion tuning;
- low-impact edge-case aesthetics.

Do not spend V3 effort while known V0/V1 defects remain.

---

# 30. Visual QA matrix

For every material release, choose the smallest matrix that covers plausible visual failure.

| Axis | Minimum examples |
|---|---|
| viewport | narrow, representative, wide, pressure points |
| browser/runtime | supported major rendering engines/platforms |
| pixel density | standard + high-DPR where imagery/icons matter |
| appearance | light/dark/other supported themes |
| text | short, normal, long, localized, zoomed |
| state | default + all material interactive/async/error states |
| data | empty, typical, max realistic, overflow-prone |
| image | loaded, slow, missing, alternate crop |
| motion | normal + reduced motion |
| accessibility visuals | contrast, focus, non-color, reflow |
| platform | supported OS/device classes where rendering differs materially |

High-risk or highly visible launches SHOULD add:

- cross-browser screenshot matrix;
- physical-device review;
- production preview review;
- independent visual reviewer;
- brand owner review where distinctive assets change;
- accessibility specialist review where visual constraints are complex.

---

# 31. Decision framework — choose the visual ambition

Not every surface needs maximum art direction.

## 31.1 Visual ambition levels

### V-A0 — Commodity / utility

Use when:

- internal/low-visibility tool;
- task clarity dominates;
- little brand value from custom expression.

Focus:

- coherent system;
- strong typography;
- accessibility;
- clean density;
- minimal bespoke asset work.

### V-A1 — Branded product

Use when:

- customer-facing product;
- brand recognition matters;
- repeated use needs stable identity.

Adds:

- distinctive visual cues;
- intentional image/icon language;
- branded but restrained surfaces;
- motion grammar;
- stronger responsive craft.

### V-A2 — Signature / premium

Use when:

- visual quality is part of perceived product value;
- launch/marketing/editorial experience matters materially;
- category differentiation is strategic.

Adds:

- dedicated art direction;
- custom compositions;
- proprietary visual assets;
- higher typography/image/motion craft;
- expanded visual QA.

### V-A3 — Flagship / high-expression

Use when:

- design itself is part of brand/product differentiation;
- public visibility is high;
- bespoke art/motion/editorial work is justified.

Adds:

- multiple concept territories;
- specialist art/3D/motion/typography input where relevant;
- extensive device/render review;
- bespoke assets and controlled exceptions;
- stricter authorship/originality review.

## 31.2 Expressiveness scale

Ambition and expressiveness are different axes. A high-ambition product may be visually calm; a lower-complexity consumer product may legitimately be vivid.

Use:

```text
E0 — quiet / utilitarian
E1 — restrained branded
E2 — expressive branded
E3 — highly expressive / flagship
```

Select from audience, task, brand, stakes and evidence—not from current fashion `[EXPR01]`.

### Rule

> **Spend bespoke craft where it creates product/brand value. Do not force flagship visual production onto every administrative screen.**

---

# 32. Decision framework — novelty versus familiarity

Use four quadrants:

| Familiarity | Novelty | Likely effect | Default action |
|---|---|---|---|
| high | low | easy but potentially generic | add owned cues selectively |
| high | high | recognizable + fresh | often desirable when coherent |
| low | high | distinctive but high interpretation cost | reserve for low-risk/expressive areas; test |
| low | low | confusing and undistinctive | redesign |

This operationalizes the evidence that typicality/familiarity and novelty can jointly contribute to preference, while repeated exposure can show diminishing or reversing returns `[NOV01][NOV02][MEM01]`.

Ask:

```text
Which interaction/information conventions must remain familiar?
Where can visual identity be more novel?
How much relearning cost does the novelty impose?
Is the novelty ownable or merely fashionable?
```

---

# 33. Decision framework — composition and grid

```text
START
  ↓
Is the primary job continuous reading?
  ├─ yes → prioritize reading measure + editorial margin/annotation logic
  └─ no
      ↓
Is side-by-side comparison materially important?
  ├─ yes → use stable aligned columns / table / split regions
  └─ no
      ↓
Is the screen an expert operational workspace?
  ├─ yes → prioritize repeatable dense alignment and persistent regions
  └─ no
      ↓
Is expressive storytelling a material goal?
  ├─ yes → use flexible editorial grid + controlled grid breaks
  └─ no → use the simplest alignment framework that preserves hierarchy
```

Then test the chosen grid across responsive pressure and localization.

---

# 34. Decision framework — typography

```text
1. What content dominates: UI labels, reading, data, display, code?
2. Which scripts/languages must work?
3. What brand voice is needed?
4. What density is required?
5. Which platform/browser rendering constraints matter?
6. Is one family sufficient?
7. If adding another family, what job does it uniquely perform?
8. Are variable axes useful or just complexity?
9. Are numerals/symbols strong enough?
10. Can the system load/render/fallback acceptably?
11. Has it been tested with real content and resizing?
```

Selection outcome is a documented type system, not a typeface mood choice.

---

# 35. Decision framework — color

```text
START WITH ROLES
  ↓
What must be readable?
What must be salient?
What is semantic?
What is branded?
What is state?
What is data?
  ↓
BUILD LIGHTNESS / CONTRAST STRUCTURE
  ↓
ADD BRAND HUE / CHROMA
  ↓
TEST SEMANTIC COLLISIONS
  ↓
TEST LIGHT/DARK/APPEARANCE
  ↓
TEST COLOR VISION + NON-COLOR CUES
  ↓
TEST REAL IMAGERY / OVERLAYS
```

Do not start by picking six attractive colors and assigning meaning afterward.

---

# 36. Decision framework — imagery medium

| Primary need | Default candidates | Key risk |
|---|---|---|
| factual proof | real photo/screenshot/data | staging/manipulation |
| product explanation | UI crop/diagram/motion | too much unreadable detail |
| human context | documentary/context photo/video | stock cliché |
| conceptual mechanism | diagram/illustration/3D | metaphor outruns meaning |
| emotional world | photo/film/illustration/3D | mood replaces product relevance |
| distinctive memory | proprietary recurring visual asset | style without strategic ownership |
| rapid exploration | generative imagery | homogenization/fixation/accuracy |

Choose medium after job.

---

# 37. Decision framework — motion

```text
Does state/space change?
  ├─ no → motion probably unnecessary
  └─ yes
      ↓
Would animation improve continuity/causality/orientation?
  ├─ no → instant transition or subtle state change
  └─ yes
      ↓
Is interaction frequent?
  ├─ yes → brief/economical
  └─ no → more expressive may be acceptable
      ↓
Can user act during transition?
  ├─ should be yes where nonessential
      ↓
Does reduced motion preserve meaning?
  ├─ no → redesign fallback
  └─ yes → verify implementation
```

---

# 38. Decision framework — trend adoption

Score qualitatively:

```yaml
problem_fit: low|medium|high
brand_fit: low|medium|high
functional_value: low|medium|high
distinctiveness_value: low|medium|high
accessibility_risk: low|medium|high
performance_cost: low|medium|high
implementation_lock_in: low|medium|high
fashion_volatility: low|medium|high
```

Adopt when benefit is clear and risks are controlled. Otherwise abstract the useful mechanism or skip.

---

# 39. Decision framework — AI in visual work

```text
What job are we using AI for?
  ↓
IDEATION?
  → require independent territories before convergence

PRODUCTION?
  → require art-direction constraints + detail QA

FACTUAL/PRODUCT EVIDENCE?
  → default to real/verified sources unless synthetic nature is explicit and acceptable

BRAND ASSET?
  → require higher originality, rights, consistency and ownership review

HIGH-TRUST MEDIA?
  → consider provenance/disclosure requirements
```

At every branch:

> AI output is candidate material until accepted by a responsible human/design process.

---

# 40. Decision framework — visual release

A material visual change is ready when:

```text
INTENT FIT          pass
HIERARCHY           pass
CORE STATES         pass
RESPONSIVE          pass
TYPOGRAPHY          pass
COLOR/CONTRAST      pass
IMAGERY/CROP        pass
MOTION              pass / n.a.
LOCALIZATION        pass / scoped
ACCESSIBILITY       pass
BRAND CONTINUITY    pass
REGRESSION REVIEW   pass
PRODUCTION PREVIEW  pass
KNOWN DEBT          accepted + owned
```

A release may ship with documented V2/V3 polish debt. V0/V1 defects require explicit risk/exception and normally block release.

---


# PART IV — EXECUTION PLAYS

# 41. PLAY-DV-01 — Establish art direction

## Purpose

Turn product/brand intent into an explicit visual thesis before high-fidelity production.

## Use when

- new product/site;
- major redesign;
- new brand entering a digital product;
- visual identity feels generic/inconsistent;
- a flagship launch requires a stronger signature.

## Inputs

- product intent;
- audience/context;
- UX structure or content architecture;
- UI/system constraints;
- brand positioning/assets where available;
- accessibility/platform constraints;
- competitive/category context.

## Procedure

1. State the primary visual job.
2. Extract 2–4 brand/product qualities that materially affect form.
3. Identify category codes to preserve/question.
4. Map 10–30 references across at least three source categories/eras when scope warrants.
5. Extract principles from references rather than copying artifacts.
6. Write 3 distinct visual tensions/territories.
7. Produce low-cost representative compositions for each territory.
8. Stress each territory against:
   - dense content;
   - sparse content;
   - mobile/narrow view;
   - core app/product UI;
   - marketing/editorial surface;
   - dark/light if required.
9. Evaluate strategic fit, distinctiveness, adaptability and implementation burden.
10. Select or recombine one thesis.
11. Write visual invariants and forbidden moves.
12. Obtain review from product/brand/UI owners as relevant.

## Output

```yaml
selected_visual_thesis:
visual_tension:
visual_invariants: []
visual_forbidden_moves: []
typography_direction:
color_direction:
imagery_direction:
surface_direction:
motion_direction:
density_direction:
responsive_direction:
distinctive_assets: []
open_experiments: []
```

## Acceptance

- not reducible to trend labels;
- can generate multiple states/screens;
- distinguishable from closest category cliché;
- compatible with UI semantics;
- viable at required responsive states;
- no known accessibility blocker;
- implementation complexity proportionate to value.

---

# 42. PLAY-DV-02 — Build the visual grammar

## Purpose

Convert art direction into reproducible rules.

## Procedure

1. Establish composition/grid logic.
2. Establish spacing scale and grouping rules.
3. Establish type roles and responsive type behavior.
4. Establish color roles and appearance mappings.
5. Establish surface/depth/material roles.
6. Establish image grammar and crop policy.
7. Establish icon/graphic language.
8. Establish motion jobs and vocabulary.
9. Define deliberate exceptions.
10. Test on representative archetype screens.
11. Remove redundant visual roles.
12. Encode stable decisions into system/tokens.

## Archetype screen set

Prefer a mix:

- high-attention entry/hero;
- ordinary content page;
- dense product/workspace view;
- form/settings view;
- empty/loading/error state;
- small-screen view;
- large-screen view.

A system tested only on a landing-page hero is not a product visual system.

---

# 43. PLAY-DV-03 — Responsive art-direction pass

## Procedure

1. Remove fixed device assumptions.
2. Resize continuously from minimum to maximum supported context.
3. Mark every content-pressure point.
4. Classify each failure as:
   - reflow;
   - reveal;
   - prioritize;
   - transform;
   - crop/art-direction;
   - type-scale adjustment;
   - decoration removal.
5. Preserve hierarchy/invariants.
6. Re-art-direct images where `cover` loses subject/meaning.
7. Test long text and localization.
8. Test zoom/text scaling.
9. Test small/large windows, not only named device frames.
10. Re-run visual hierarchy review at each structural mode.

## Acceptance

The layout should look **designed for the available space**, not like another layout squeezed into it.

---

# 44. PLAY-DV-04 — Premium/editorial refinement pass

## Purpose

Raise perceived craft without falling into decorative recipes.

## Procedure

1. Identify current visual competition.
2. Clarify primary/secondary hierarchy.
3. Audit copy/asset quality before styling harder.
4. Improve typography:
   - line breaks;
   - weights;
   - measure;
   - tracking where justified;
   - captions/numerals.
5. Improve image source/crop/lighting consistency.
6. Remove unnecessary borders/cards/effects.
7. Strengthen spacing relationships and optical alignment.
8. Review material/depth consistency.
9. Calibrate accent-color frequency.
10. Refine motion to be precise rather than showy.
11. Review sparse and dense areas for controlled complexity.
12. Verify production rendering.

## Rejection test

If “premium” improvement mainly means:

- more whitespace;
- smaller gray text;
- serif headings;
- black backgrounds;
- blur/glass;
- more animation;

without a stronger system, reject the pass.

---

# 45. PLAY-DV-05 — AI-assisted visual ideation

## Purpose

Use generative tools without collapsing direction into model defaults.

## Procedure

1. Complete problem framing and reference decomposition without relying on one generative output stream.
2. Create at least 3 visual territories.
3. For each territory, write its own prompt vocabulary and exclusion rules.
4. Generate independently within territories.
5. Vary references/model/tool when useful.
6. Build a comparison board by **decision dimensions**, not by prettiness:
   - hierarchy;
   - image grammar;
   - material;
   - color;
   - composition;
   - originality;
   - product fit.
7. Detect repeated AI signatures/clichés.
8. Manually recombine/redraw/recompose.
9. Verify product/factual details.
10. Record provenance/rights where material.
11. Submit final assets to normal QA.

## Acceptance

- visual ownership is explainable;
- no material factual/product errors;
- output family is consistent;
- no unresolved reference-copy risk;
- no generic model style is doing the main brand work.

---

# 46. PLAY-DV-06 — Visual QA before release

## Procedure

1. Build the QA matrix from §30.
2. Freeze a release candidate.
3. Run automated visual regression where available.
4. Review deltas; separate intended/unintended.
5. Conduct human pass at representative viewport/state combinations.
6. Inspect accessibility visuals.
7. Inspect typography and localization.
8. Inspect imagery/crops.
9. Inspect motion/reduced motion.
10. Inspect dark/light themes.
11. Inspect real content and data extremes.
12. Classify defects V0–V3.
13. Fix V0/V1; decide V2/V3 debt explicitly.
14. Re-run affected matrix regions.
15. Approve new baselines only after acceptance.

## Evidence retained

```yaml
release_or_build:
reviewer:
viewports_tested: []
platforms_tested: []
states_tested: []
appearances_tested: []
locales_tested: []
automated_regression_result:
manual_findings: []
open_visual_debt: []
accepted_exceptions: []
final_verdict:
```

---

# 47. PLAY-DV-07 — Diagnose “it looks generic”

Genericness is not solved by adding random novelty.

## Diagnostic sequence

### 1. Is the concept generic?

Symptoms:

- adjectives only;
- no visual tension;
- no exclusion rules;
- reference set entirely from direct competitors.

Fix: rebuild art direction.

### 2. Is composition generic?

Symptoms:

- repeated common landing-page templates;
- no narrative variation;
- every section centered/card-based.

Fix: recompose by content job.

### 3. Is brand expression generic?

Symptoms:

- identity = logo + accent color;
- no image/motion/type signature.

Fix: define asset portfolio and visual grammar.

### 4. Are source assets generic?

Symptoms:

- stock office photography;
- generic AI hero image;
- commodity icons.

Fix: build proprietary/product-specific assets.

### 5. Is systemization flattening expression?

Symptoms:

- same component spacing everywhere;
- no controlled editorial exceptions;
- design system dictates page rhythm.

Fix: distinguish system invariants from compositions.

### 6. Is the implementation generic?

Symptoms:

- correct design file, but default shadows/type/crops in production;
- responsive flattening;
- missing custom assets.

Fix: production visual QA.

---

# 48. PLAY-DV-08 — Evolve an established visual system

## Purpose

Improve visual quality without destroying useful memory or producing partial redesign drift.

## Procedure

1. Inventory current visual invariants and distinctive assets.
2. Identify the actual defect:
   - dated implementation;
   - poor accessibility;
   - weak hierarchy;
   - inconsistent components;
   - insufficient distinctiveness;
   - new product density;
   - new platform needs;
   - brand strategy change.
3. Separate assets worth preserving from debt.
4. Define changed invariants and unchanged invariants.
5. Prototype migration on representative archetypes.
6. Check old/new coexistence period.
7. Version tokens/assets where compatibility matters.
8. Deprecate obsolete styles explicitly.
9. Update regression baselines only after accepted migration.
10. Measure recognition/brand impact when major distinctive assets change.

## Rule

> **Redesign only what the problem earns.**

A new trend is not, by itself, a redesign requirement.

---

# PART V — TEMPLATES

# 49. Visual Design Intake

```yaml
project:
owner:
date:
product_surface:
audience:
context_of_use:
primary_business_or_product_outcome:
primary_visual_job:
existing_brand_assets: []
existing_design_system:
required_platforms: []
required_viewports_or_windows: []
required_appearances: []
required_locales: []
content_types: []
data_density:
trust_or_risk_level:
accessibility_target:
performance_constraints:
asset_constraints:
implementation_constraints:
visual_quality_problem_today:
visual_success_evidence:
```

---

# 50. Visual Thesis Record

```yaml
visual_thesis_id:
problem:
visual_tension:
intended_meaning:
category_familiarity_to_keep: []
distinctive_moves: []
visual_invariants: []
forbidden_moves: []
type_strategy:
color_strategy:
spacing_density_strategy:
surface_material_strategy:
imagery_strategy:
motion_strategy:
responsive_strategy:
reference_principles: []
known_tradeoffs: []
experiments: []
review_triggers: []
```

---

# 51. Visual Grammar Record

```yaml
composition:
  alignment_axes: []
  grid_models: []
  focal_rules: []
  exception_rules: []
spacing:
  scale: []
  grouping_rules: []
typography:
  families: []
  roles: []
  numeric_rules: []
color:
  roles: []
  appearances: []
  semantic_rules: []
surfaces:
  roles: []
  depth_rules: []
imagery:
  media: []
  crop_rules: []
  visual_treatment: []
icons_graphics:
  style_rules: []
motion:
  roles: []
  reduced_motion: []
responsive:
  invariants: []
  transformations: []
```

---

# 52. Reference Decomposition Card

```yaml
reference:
source:
reason_selected:
principles:
  hierarchy:
  composition:
  type:
  color:
  imagery:
  material:
  motion:
  density:
what_is_category_specific:
what_is_transferable:
what_must_not_be_copied:
risk_of_fixation:
```

---

# 53. Visual QA Record

```yaml
qa_id:
build_or_release:
review_scope:
reviewers: []
automated_tools: []
platforms: []
viewports: []
appearances: []
locales: []
states: []
findings:
  - id:
    layer:
    severity: V0|V1|V2|V3
    evidence:
    expected:
    actual:
    owner:
    resolution:
exceptions: []
final_verdict: PASS|PASS_WITH_DEBT|FAIL
```

---

# 54. Visual Exception Record

```yaml
exception_id:
visual_rule_or_token:
location:
reason:
why_existing_system_is_insufficient:
intentional_or_temporary:
accessibility_review:
responsive_review:
owner:
expiry_or_review_trigger:
should_system_change: yes|no|unknown
```

---

# 55. AI Visual Asset Record

```yaml
asset_id:
intended_job:
generation_or_editing_tools: []
model_versions_if_material: []
human_sources_or_references: []
prompts_or_instructions_retained: yes|no|partial
human_edits:
rights_or_license_review:
provenance_required:
content_credentials_status:
factual_product_review:
brand_consistency_review:
final_approver:
```

---

# PART VI — ANTI-PATTERN CATALOG

# 56. Art-direction anti-patterns

## 56.1 Moodboard without thesis

A set of attractive references with no decision logic.

**Failure:** taste is visible; direction is not.

## 56.2 Adjective art direction

“Modern, premium, clean, innovative.”

**Failure:** words are too broad to resolve visual decisions.

## 56.3 Competitor average

All references come from the same current category leaders.

**Failure:** produces category regression toward the mean.

## 56.4 Style before product

A visual trend is selected before content/task/brand reality.

**Failure:** the product is forced into an aesthetic costume.

## 56.5 One screenshot as system

A beautiful homepage/hero is treated as art direction.

**Failure:** no evidence the grammar survives app states, dense content or responsive conditions.

---

# 57. Composition anti-patterns

## 57.1 Equal prominence

Everything is large, bright or boxed.

**Failure:** no hierarchy.

## 57.2 Card soup

Every group becomes a card, then cards nest inside cards.

**Failure:** fragmentation, border noise, weak editorial flow.

## 57.3 Bento by default

A bento grid is used because it signals contemporary design, even when content relationships do not fit.

**Failure:** form dictates information architecture.

## 57.4 Grid theater

Perfect mathematical columns with weak content relationships.

**Failure:** geometry without communication.

## 57.5 Accidental asymmetry

Elements are nearly aligned but not intentionally offset.

**Failure:** craft defect disguised as dynamism.

## 57.6 Above-the-fold compression

Hero, proof, features, CTA and screenshots are crammed into one viewport.

**Failure:** attention competition.

## 57.7 Scroll poster syndrome

Every section is designed like an isolated award-site frame.

**Failure:** no continuous narrative or information retrieval.

---

# 58. Typography anti-patterns

## 58.1 Tiny-muted hierarchy

Secondary hierarchy is achieved almost exclusively through tiny light-gray text.

**Failure:** accessibility and reading quality sacrificed for visual quiet.

## 58.2 Huge-title syndrome

Oversized headings become the sole hierarchy technique.

**Failure:** poor density and no subtle hierarchy.

## 58.3 Font personality overload

Each section uses expressive type differently.

**Failure:** identity fragments.

## 58.4 Faux editorial

Serif headline + wide whitespace is assumed to create editorial quality.

**Failure:** style label without pacing, measure or content structure.

## 58.5 Accidental wrapping

Key headlines produce awkward single-word lines across common widths.

**Failure:** composition was not tested responsively.

## 58.6 Default numerals in data products

Numbers are visually ambiguous or misaligned.

**Failure:** typographic voice ignores actual task.

---

## 58.7 Variable-font theater

Adding many axes, animated weights or extreme width variation because the font supports them. Capability is not hierarchy.

## 58.8 Optical-size neglect

Using a face with meaningful optical-size behavior while never reviewing body/display roles at the sizes actually shipped.


# 59. Color anti-patterns

## 59.1 Brand-color flooding

Everything important and unimportant uses the same accent.

**Failure:** salience collapses.

## 59.2 Low-contrast premium

Subtle gray text is used to look sophisticated.

**Failure:** premium cue outranks legibility.

## 59.3 Semantic collision

Brand green is also success; brand red is also danger; roles become ambiguous.

**Failure:** color architecture missing.

## 59.4 Dark-mode inversion

Light palette is automatically reversed.

**Failure:** luminance and material relationships are not re-authored.

## 59.5 Gradient as identity

An interchangeable gradient is doing most of the brand work.

**Failure:** low ownership/distinctiveness.

## 59.6 Color emotion determinism

“Blue = trust,” “red = urgency,” etc. treated as laws.

**Failure:** ignores many-to-many/contextual evidence `[CLR01]`.

---

## 59.7 Wide-gamut/HDR prestige

Treating more gamut or brightness as evidence of a more premium product. Without fallback and hierarchy control, it can merely create inconsistency.

## 59.8 OKLCH = accessible

Perceptual organization can help system construction. It does not establish WCAG contrast, semantic separability or aesthetic quality by itself.


# 60. Surface/material anti-patterns

## 60.1 Glass everywhere

Every region is blurred/translucent.

**Failure:** material hierarchy disappears.

## 60.2 Shadow inflation

More important = bigger shadow.

**Failure:** simplistic hierarchy and visual dirt.

## 60.3 Radius inflation

Every product adopts highly rounded cards because it feels modern.

**Failure:** trend signature replaces brand/form reasoning.

## 60.4 Texture garnish

Noise/grain is added as a generic high-craft cue.

**Failure:** decoration without job.

## 60.5 Border-first grouping

Every relationship is represented through rectangles.

**Failure:** misses spacing/alignment and increases noise.

---

## 60.6 Platform-material cargo cult

Copying Liquid Glass or another platform material outside its hierarchy/function merely because it is current. Platform guidance itself treats material use as semantic and restrained `[MAT01]`.

## 60.7 Isolated-glass approval

Approving translucent surfaces on a blank design canvas without testing the content that will actually pass beneath them.


# 61. Imagery anti-patterns

## 61.1 Generic stock humanity

Friendly teams/laptops/hands used without product relevance.

## 61.2 Fake product proof

Generated or edited UI imagery implies functionality that does not exist.

## 61.3 Unreadable screenshot wall

Tiny product screenshots used as decorative proof.

## 61.4 One-crop-fits-all

The same image is `cover`-cropped across every ratio.

## 61.5 Illustration filler

Illustration occupies empty space but explains/expresses nothing.

## 61.6 AI visual average

Plausible generated imagery with the same lighting, gradients and abstract-tech grammar as the category.

## 61.7 Inconsistent generated family

Each generated asset looks like a different universe.

---

## 61.8 Clever-icon opacity

Creating novel pictograms for familiar actions without labels or established meaning, forcing users to decode brand expression before acting.

## 61.9 Inconsistent icon optical weight

Using mathematically identical stroke/box values while visual mass, detail and centering vary enough to make the set feel unrelated.

## 61.10 `cover` as art direction

Using one source image everywhere and relying on automated crop/cover even when subject, proof or composition is materially lost.

## 61.11 Generic programmatic “AI” graphics

Particles, grids, neural-network lines, glowing orbs and random SVG geometry without a product-specific visual thesis.


# 62. Motion anti-patterns

## 62.1 Animation tax

Frequently repeated interactions include unnecessary delay.

## 62.2 Scroll hijacking

Motion overrides expected scrolling without a compelling information reason.

## 62.3 Parallax reflex

Depth motion is added because the hero felt static.

## 62.4 Easing roulette

Every component uses different spring/ease values.

## 62.5 Transition theater

Route changes use cinematic motion that obscures navigation clarity.

## 62.6 Reduced-motion erasure

Reduced motion removes orientation/state feedback instead of replacing the motion cue.

---

# 63. Design-system anti-patterns

## 63.1 Token inflation

Hundreds of values with no semantic clarity.

## 63.2 Component-first art direction

A page is composed exclusively by dropping system components without page-level hierarchy.

## 63.3 System as law

Designers cannot create deliberate exceptions even for flagship/editorial moments.

## 63.4 Exceptions everywhere

Every feature forks the system.

## 63.5 Figma truth

Design file is treated as canonical despite production drift.

## 63.6 One theme token = accessibility

Theme generation is assumed to guarantee contrast and state legibility.

---

## 63.7 Token-mode Cartesian explosion

Encoding every local variation as a global mode until theme resolution becomes harder to understand than the design itself.

## 63.8 Token-file truth

Assuming a valid interchange file proves the rendered system has the intended visual result.


# 64. AI anti-patterns

## 64.1 Prompt-first art direction

“Make a premium AI SaaS website” becomes the design brief.

## 64.2 Single-stream fixation

One model and one reference family produce all concepts.

## 64.3 First-output anchoring

Later work remains variations of the first generated composition.

## 64.4 AI-polish masking weak concept

High image fidelity makes an ordinary direction feel more resolved than it is.

## 64.5 Synthetic proof

Generated people, products, testimonials or data are presented as evidence.

## 64.6 Model signature as brand

The visual identity depends on a recognizable model aesthetic that many competitors can reproduce.

## 64.7 No provenance judgment

High-trust media is generated/edited without deciding whether provenance or disclosure matters.

---

# 65. Visual-QA anti-patterns

## 65.1 Desktop screenshot approval

One 1440px screenshot is visually approved and considered done.

## 65.2 Baseline worship

Automated diff passes because the current output matches an already-bad baseline.

## 65.3 Pixel-perfect dogma

Dynamic/accessible responsive output is rejected because it differs from static Figma coordinates.

## 65.4 QA on lorem ipsum

Real content defects remain hidden.

## 65.5 No async/error review

Only success/default states are inspected.

## 65.6 Browser singularity

One browser/OS becomes the assumed visual truth.

## 65.7 Diff threshold blindness

Large tolerance hides meaningful changes; tiny tolerance creates noise and reviewer fatigue.

---


# PART VII — CHECKLISTS AND REVIEW GATES

# 66. Art Direction Gate

```text
[ ] primary visual job is explicit
[ ] product/brand intent precedes style selection
[ ] visual thesis exists
[ ] visual tension is more specific than generic adjectives
[ ] category codes to preserve are known
[ ] category codes to question are known
[ ] references have been decomposed into principles
[ ] references are not all direct competitors/current SaaS peers
[ ] at least two materially different territories were considered when direction was genuinely open
[ ] selected concept generates multiple screens/states
[ ] visual invariants are documented
[ ] forbidden/generic moves are documented
[ ] responsive viability has been sampled
[ ] dense and sparse content have been sampled
[ ] no known accessibility blocker is embedded in the concept
```

# 67. Composition Gate

```text
[ ] primary focal point is knowable
[ ] secondary hierarchy is visible
[ ] alignment axes are intentional
[ ] grouping works without unnecessary containers
[ ] grid supports content relationships
[ ] grid exceptions have a reason
[ ] section/screen rhythm is intentional
[ ] whitespace communicates relationships rather than prestige
[ ] no accidental near-alignment
[ ] no uncontrolled card nesting
[ ] dense areas remain scannable
[ ] page-level composition has been reviewed, not only components
```

# 68. Typography Gate

```text
[ ] type choices fit voice and use case
[ ] body reading is legible at target conditions
[ ] type roles are explicit
[ ] hierarchy does not depend on size alone
[ ] weights actually exist/load correctly
[ ] headings wrap acceptably at representative widths
[ ] numeric/data typography is adequate where relevant
[ ] fallback font behavior is acceptable
[ ] long/short content tested
[ ] localization expansion tested where applicable
[ ] resize/text-spacing/reflow requirements verified where applicable
[ ] display expression does not compromise critical meaning
```

# 69. Color and Surface Gate

```text
[ ] color roles are semantic/intentional
[ ] brand accent has controlled frequency
[ ] critical meaning does not depend on color alone
[ ] applicable text contrast passes
[ ] applicable component/state contrast passes
[ ] light/dark appearances are separately reviewed
[ ] semantic colors do not collide with brand roles
[ ] surfaces/depth have a coherent model
[ ] translucency tested on variable backgrounds
[ ] shadows/borders/radii are system decisions rather than arbitrary local styling
[ ] high-contrast/forced-color behavior considered where required
```

# 70. Imagery Gate

```text
[ ] every material image has a named job
[ ] image grammar is coherent
[ ] source quality sufficient for display size
[ ] crop preserves intended subject/focal point
[ ] mobile/alternate crops exist where needed
[ ] real proof is not replaced with synthetic decoration
[ ] screenshots are legible enough for their job
[ ] people/representation are contextually appropriate
[ ] captions/attribution/provenance handled where relevant
[ ] generated assets passed detail/accuracy/consistency review
[ ] missing/slow-load image behavior does not destroy composition
```

# 71. Motion Gate

```text
[ ] each material animation has a job
[ ] transition direction preserves spatial logic where relevant
[ ] repeated interactions are economical
[ ] users are not unnecessarily blocked until animation completes
[ ] reduced-motion behavior exists where required/appropriate
[ ] reduced motion preserves meaning
[ ] animation does not create harmful flashes/motion
[ ] motion vocabulary is coherent across components
[ ] motion performance is acceptable on target devices
[ ] marketing motion does not obscure primary content/action
```

# 72. Responsive / Adaptive Gate

```text
[ ] layout reviewed continuously across width ranges
[ ] pressure points identified from content, not device labels alone
[ ] hierarchy remains stable across modes
[ ] columns reflow meaningfully
[ ] wide screens do not create absurd measures/gaps
[ ] narrow screens do more than shrink
[ ] image crops are art-directed where needed
[ ] long labels/text do not break layout
[ ] zoom/reflow tested where applicable
[ ] platform/window configurations relevant to the product tested
[ ] RTL/mixed direction tested where applicable
```

# 73. Anti-Template / Anti-AI-Slop Gate

```text
[ ] composition is not dictated by a generic template
[ ] sections use forms appropriate to their content job
[ ] visual identity exceeds logo + accent color
[ ] proprietary/product-specific visual evidence exists where possible
[ ] reference set is sufficiently diverse
[ ] recurring category clichés are identified
[ ] any generative assets have been materially art-directed after generation
[ ] AI output family is internally consistent
[ ] model-default aesthetics are not the main source of distinctiveness
[ ] factual/product details are correct
[ ] rights/provenance/disclosure decision made where material
[ ] final work can be explained as intentional human/product decisions
```

# 74. Design-System Gate

```text
[ ] tokens encode recurring decisions with actual value
[ ] semantic layer exists where meaning matters
[ ] no uncontrolled token inflation
[ ] component styles cover material states
[ ] exceptions are explicit
[ ] repeated exceptions trigger system review
[ ] light/dark/theme mappings are complete where required
[ ] token serialization status/version is known where interoperability matters
[ ] page-level art direction remains possible
[ ] deprecated visual roles have migration/removal path
```

# 75. Visual Release Gate

A release SHOULD NOT be approved solely from a design-file review.

```text
[ ] production/staging build reviewed
[ ] real content/data reviewed
[ ] default + material states reviewed
[ ] target responsive matrix reviewed
[ ] typography rendering reviewed
[ ] color/contrast reviewed
[ ] imagery/crops reviewed
[ ] motion/reduced motion reviewed
[ ] localization/text expansion reviewed where applicable
[ ] automated visual regression run where available
[ ] intentional visual deltas approved
[ ] V0/V1 defects closed or explicitly exceptioned by accountable owner
[ ] new baselines approved only after human acceptance
[ ] known V2/V3 debt documented
```

---

# 76. Visual review operating cadence

## Continuous / every material change

- visual regression;
- critical state visibility;
- responsive layout integrity;
- broken assets/fonts;
- accessibility visual blockers.

## Per feature/release

- component/state visual review;
- realistic content review;
- responsive pressure pass;
- dark/light review where relevant;
- image crop review;
- motion review.

## Monthly / design-system cadence

- repeated exceptions;
- visual debt clusters;
- token proliferation;
- component divergence;
- inaccessible color usage;
- unowned visual assets;
- visual-regression flakiness/noise.

## Quarterly / brand-art-direction cadence

- category sameness;
- stale/generic visual trends;
- distinctive-asset consistency;
- image library quality;
- typography drift;
- page-level cardification/module monotony;
- responsive quality across newly important devices/windows;
- AI asset consistency/provenance workflow;
- whether the visual thesis still fits product/brand reality.

## Before flagship launch

- independent art-direction review;
- physical-device/browser matrix;
- accessibility visual review;
- final responsive sweep;
- high-resolution/crop asset pass;
- motion/reduced-motion review;
- production build comparison;
- screenshot/video capture for release evidence.

---

# 77. Visual quality review scorecard

Do **not** collapse this into a single universal design score. Use it to expose blind spots.

Score only with evidence/examples.

| Dimension | Review question |
|---|---|
| Art-direction fit | Does the visual world fit product, audience and positioning? |
| Hierarchy | Is importance visually obvious? |
| Composition | Are balance, alignment, grouping and rhythm intentional? |
| Typography | Is type legible, expressive and systematic? |
| Color | Are roles coherent, accessible and brand-appropriate? |
| Spacing | Do distances express relationships consistently? |
| Density | Is information concentration appropriate to the task? |
| Surfaces | Do containment/depth/material rules make sense? |
| Imagery | Is media purposeful, coherent, correctly cropped and high-quality? |
| Brand distinction | Is identity recognizable beyond the logo? |
| Responsive craft | Does the system adapt rather than merely shrink/stretch? |
| Motion | Is movement purposeful, coherent and accessible? |
| State completeness | Are edge/async/interactive states visually complete? |
| System coherence | Are repeated visual decisions reusable and governed? |
| Anti-template quality | Does the work show a product-specific point of view? |
| Production fidelity | Does rendered output preserve intended relationships? |
| QA evidence | Was visual quality verified across representative conditions? |

### Non-averaging rule

A scorecard cannot turn a critical visual/accessibility defect into an acceptable average.

---

# 78. Visual craft maturity model

## Level 0 — Accidental

- visual decisions emerge from framework defaults and local preference;
- inconsistent spacing/type/color;
- no explicit art direction;
- QA is reactive.

## Level 1 — Consistent

- basic typography/color/spacing roles;
- reusable components;
- accessibility floor improving;
- responsive rules exist;
- limited visual QA.

## Level 2 — Directed

- explicit visual thesis;
- coherent image/material/motion grammar;
- page/screen composition reviewed;
- meaningful design tokens;
- regression workflow.

## Level 3 — High craft

- visual system survives edge states/localization/responsive modes;
- optical/detail quality high;
- brand distinctiveness accumulates consistently;
- automated + human QA;
- controlled exceptions;
- intentional art direction across product and marketing.

## Level 4 — Learning visual system

- local evidence informs changes;
- distinctive assets are measured where material;
- visual debt and exceptions feed system evolution;
- trend adoption is governed;
- AI workflows preserve diversity/provenance;
- source/version freshness is monitored;
- field defects change the standard.

Maturity is diagnostic. Do not turn it into a vanity certification.

---

# PART VIII — RESEARCH, ASSURANCE AND SOURCE REGISTER

# 79. Research protocol used for V2.1

This release used a controlled scoping-and-falsification method rather than claiming to be a formal systematic review.

```text
DEFINE SPECIALIST BOUNDARY
→ RETRIEVE INHERITED DESIGN/UX/UI DOCTRINE
→ MAP MATERIAL VISUAL-CRAFT QUESTIONS
→ PRIORITIZE CURRENT STANDARDS / PRIMARY SOURCES
→ ADD EMPIRICAL AESTHETICS / PERCEPTION RESEARCH
→ ADD CURRENT PLATFORM / DESIGN-SYSTEM IMPLEMENTATION GUIDANCE
→ BUILD V1 CANDIDATE
→ SEARCH FOR COUNTEREXAMPLES / FALSE UNIVERSALS
→ TEST ACROSS PRODUCT ARCHETYPES
→ AUDIT FAST-MOVING 2026 SOURCES
→ CORRECT V1
→ BUILD V2
→ MECHANICAL SOURCE/STRUCTURE QA
```

## 79.1 Inclusion logic

Sources were included when they materially informed:

- visual hierarchy/aesthetics;
- familiarity/novelty;
- color meaning or accessibility;
- typography;
- responsive/adaptive layout;
- motion;
- design tokens;
- visual-regression QA;
- AI creative diversity/fixation;
- provenance;
- premium/luxury visual cues;
- current implementation-status claims.

## 79.2 Source-fit discipline

- W3C/WCAG → accessibility requirements and current specification status;
- W3C Community Group → current design-token interchange status;
- Apple/Android → platform implementation conventions;
- meta-analysis/systematic review → aggregate empirical claims;
- controlled HCI experiments → tested perceptual/aesthetic mechanisms;
- software-testing research/tool docs → regression mechanisms/limitations;
- C2PA → exact provenance specification semantics;
- inherited playbooks → existing doctrine and domain boundary.

## 79.3 Research limitations

This field contains a high proportion of context-sensitive effects.

Material limitations:

1. Aesthetic preference studies often use static screenshots rather than fully interactive systems.
2. Many experiments use constrained tasks and limited samples.
3. Luxury/premium evidence frequently comes from packaging/advertising, not software products.
4. Platform guidance can reflect platform philosophy and constraints rather than universal human-response evidence.
5. AI creativity evidence is recent and model/workflow dependent.
6. Visual quality includes craft judgments that cannot honestly be fully reduced to empirical rules.
7. Local brand/category/user evidence can change the best execution.
8. Production rendering varies by platform, browser, font rasterization and hardware.

Therefore, the playbook deliberately uses `CTX`, `HOUSE` and `JUDGMENT REQUIRED` rather than pretending every visual choice is scientifically settled.

---

# 80. Source register

## Foundation playbooks

### FND-DESIGN — Universal Design Principles Master Playbook V2.0
**Source:** project foundation supplied with this playbook.  
**Evidence role:** inherited evidence synthesis for attention, hierarchy, perception, typography, color, imagery, aesthetics, distinctiveness, premium, motion and visual accessibility.  
**Key inherited doctrine:** clarity before decoration; controlled complexity; familiarity × novelty; semantic congruence; no universal aesthetic formula.  
**Boundary:** broader cross-media design standard; this playbook specializes digital art direction/craft and production visual QA.

### FND-UX — UX Master Playbook V2.0
**Source:** project foundation supplied with this playbook.  
**Evidence role:** user outcome, context, usability, effort, control, familiarity, responsiveness, accessibility and validation boundaries.  
**Boundary:** UX owns journey/task/outcome, not specialist visual craft.

### FND-UI — UI Master Playbook V2.0
**Source:** project foundation supplied with this playbook.  
**Evidence role:** interaction/state/component/adaptation boundary; density; layout semantics; appearance-state-behavior consistency.  
**Boundary:** UI owns operability; this playbook owns the visual grammar/craft layer.

### FND-MPS — Master Playbook Standard V2.0-RC1
**Source:** project foundation supplied with this playbook.  
**Evidence role:** research architecture, claim-fit evidence, falsification, proportional rigor, verification, validation and lifecycle status.  
**Boundary:** governs how this playbook is built, not visual-design subject matter.

## Aesthetics, composition and familiarity

### AES01 — Bader et al. — Attractive Things Do Work Better: A Meta-Analysis on Visual Aesthetics and User Performance
**URL:** https://doi.org/10.1080/10447318.2026.2664081  
**Evidence:** `PREREGISTERED_META_ANALYSIS / 2026`  
**Finding used:** 31 studies, 234 effect sizes, 18,794 participants; small-to-medium positive average effect of aesthetics on objective user performance (`g = 0.29`) with high unexplained heterogeneity.  
**Limitation:** heterogeneous manipulations/tasks; not a license to trade away usability/accessibility or assume a particular style improves performance.

### AES02 — Tuch et al. — The role of visual complexity and prototypicality regarding first impression of websites
**URL:** https://doi.org/10.1016/j.ijhcs.2012.06.003  
**Evidence:** `CONTROLLED_HCI_EXPERIMENT / 2012`  
**Finding used:** visual complexity and prototypicality affected aesthetic judgments at very short exposures, including tens of milliseconds.  
**Limitation:** screenshot aesthetic judgments; not a universal rule that every complex site is worse.

### AES03 — Tuch, Bargas-Avila & Opwis — Symmetry and aesthetics in website design
**URL:** https://doi.org/10.1016/j.chb.2010.07.016  
**Evidence:** `CONTROLLED_HCI_EXPERIMENT / 2010`  
**Finding used:** symmetry can affect website aesthetic ratings.  
**Limitation:** small study and subgroup interaction; explicitly supports contextual rather than universal symmetry guidance.

### AES04 — Post, Nguyen & Hekkert — Unity in Variety in website aesthetics: A systematic inquiry
**URL:** https://doi.org/10.1016/j.ijhcs.2017.02.003  
**Evidence:** `CONTROLLED_HCI_EXPERIMENT / 2017`  
**Finding used:** unity and variety both contributed positively to website aesthetic appreciation in the studied manipulations.  
**Limitation:** operationalizations of unity/variety are specific; do not universalize exact visual recipes.

### AES05 — Seckler, Opwis & Tuch — Linking objective design factors with subjective aesthetics
**URL:** https://doi.org/10.1016/j.chb.2015.02.056  
**Evidence:** `MULTI_EXPERIMENT HCI / 2015`  
**Finding used:** structure and color factors affected different facets of website aesthetics differently; visual complexity had broad effects.  
**Limitation:** specific factor manipulations and screenshot-based evaluation.

### NOV01 — Hekkert, Snelders & van Wieringen — Most Advanced, Yet Acceptable
**URL:** https://doi.org/10.1348/000712603762842147  
**Evidence:** `MULTI_STUDY EXPERIMENT / 2003`  
**Finding used:** novelty and typicality jointly contributed to aesthetic preference in industrial-design stimuli.  
**Limitation:** product-design context; mechanism is used as a prior, not a deterministic website formula.

### NOV02 — Silvennoinen, Kotkajuuri & Kujala — The Effect of Novelty and Typicality on Aesthetic Appeal of Websites
**URL:** https://doi.org/10.1080/10447318.2025.2576633  
**Evidence:** `EMPIRICAL WEBSITE STUDY / published 2025, journal volume 2026`  
**Finding used:** N=108; both novelty and typicality predicted website aesthetic appeal; relative effects varied between commercial/service sites.  
**Limitation:** 12-site stimulus set and aesthetic outcome; not a conversion or task-performance study.

### MEM01 — Montoya et al. — A re-examination of the mere exposure effect
**URL:** https://pubmed.ncbi.nlm.nih.gov/28263645/  
**Evidence:** `META_ANALYSIS / 2017`  
**Finding used:** 268 exposure curves from 81 articles showed positive slope plus negative quadratic pattern consistent with an inverted-U under studied conditions.  
**Limitation:** broad stimulus literature; use as evidence against “more repetition/familiarity is always better,” not as a precise brand-exposure formula.

## Color

### CLR01 — Jonauskaite et al. — Do we feel colours? A systematic review of 128 years of psychological research linking colours and emotions
**URL:** https://doi.org/10.3758/s13423-024-02615-z  
**Evidence:** `SYSTEMATIC_REVIEW / 132 articles / 42,266 participants / 64 countries`  
**Finding used:** systematic color–emotion correspondences exist but are many-to-many and influenced by lightness, saturation and hue.  
**Limitation:** association is not guaranteed experienced emotion, brand trust or behavioral effect in a specific interface.

### COLORTECH01 — W3C CSS Color Module Level 4
**URL:** https://www.w3.org/TR/css-color-4/  
**Evidence:** `W3C CANDIDATE RECOMMENDATION DRAFT / current 2026-09 status`  
**Finding used:** defines modern CSS color syntax/spaces including Lab/LCH/OKLab/OKLCH and wide-gamut handling.  
**Limitation:** specification semantics; not evidence that a color space creates better aesthetics.

## Typography

### TYP01 — Richardson — The Legibility of Serif and Sans Serif Typefaces: Reading from Paper and Reading from Screens
**URL:** https://doi.org/10.1007/978-3-030-90984-0  
**Evidence:** `SYSTEMATIC SCHOLARLY REVIEW / 2022`  
**Finding used:** the accumulated literature does not support a simple universal serif-versus-sans screen-legibility law.  
**Limitation:** legibility depends on specific faces, rendering, size, task and study design.

## Accessibility and visual presentation

### ACC01 — W3C — Web Content Accessibility Guidelines (WCAG) 2.2
**URL:** https://www.w3.org/TR/WCAG22/  
**Evidence:** `W3C RECOMMENDATION / NORMATIVE`  
**Finding used:** applicable requirements for contrast, resize, reflow, text spacing resilience, non-color communication, target size and motion-related criteria.  
**Limitation:** conformance floor; does not define high-craft aesthetic quality.

### ACC02 — W3C — Understanding Success Criterion 1.4.11: Non-text Contrast
**URL:** https://www.w3.org/WAI/WCAG22/understanding/non-text-contrast.html  
**Evidence:** `OFFICIAL WCAG GUIDANCE`  
**Finding used:** visual information required to identify components/states needs sufficient contrast; thin antialiased lines can visually underperform nominal values.  
**Limitation:** scoped to required visual information; does not mean every decorative border must meet the same rule.

### MOT02 — W3C — C39: Using `prefers-reduced-motion` to prevent motion
**URL:** https://www.w3.org/WAI/WCAG22/Techniques/css/C39  
**Evidence:** `OFFICIAL WCAG TECHNIQUE`  
**Finding used:** demonstrates a sufficient technique for honoring reduced-motion preference for interaction-triggered motion.  
**Limitation:** technique is not the only conforming implementation.

## Platform/adaptive/motion guidance

### ADAPT01 — Android Developers — Adaptive Apps / Canonical Layouts
**URL:** https://developer.android.com/develop/adaptive-apps/guides/canonical-layouts  
**Evidence:** `CURRENT PLATFORM GUIDANCE / 2026`  
**Finding used:** adaptive layouts span phones, tablets, foldables and ChromeOS; layout should adapt to available window/form factor rather than merely scale.  
**Limitation:** Android guidance; principles transfer, exact components do not.

### ADAPT02 — Apple Human Interface Guidelines — Layout
**URL:** https://developer.apple.com/design/human-interface-guidelines/layout  
**Evidence:** `CURRENT PLATFORM GUIDANCE / 2026`  
**Finding used:** hierarchy through relative importance, alignment, grouping and adaptation; reading order must respect directionality.  
**Limitation:** Apple-platform convention, not universal causal proof.

### PLAT02 — Apple Human Interface Guidelines — Branding
**URL:** https://developer.apple.com/design/human-interface-guidelines/branding  
**Evidence:** `CURRENT PLATFORM GUIDANCE / updated 2026-09-09`  
**Finding used:** brand identity should coexist with platform consistency; accent color should be used judiciously.  
**Limitation:** Apple-platform implementation guidance.

### MOT01 — Apple Human Interface Guidelines — Motion
**URL:** https://developer.apple.com/design/human-interface-guidelines/motion  
**Evidence:** `CURRENT PLATFORM GUIDANCE`  
**Finding used:** motion should support status, feedback, instruction and continuity; gratuitous/excessive animation can distract; frequent interactions should avoid unnecessary motion; motion should be optional where appropriate.  
**Limitation:** platform guidance and design philosophy, not universal timing science.

## Premium / luxury cue evidence

### LUX01 — Iseki, Mase & Kitagami — Perception of Luxury and Product Quality in Package Design
**URL:** https://doi.org/10.1111/joss.70026  
**Evidence:** `CONTROLLED BETWEEN-PARTICIPANTS STUDY / 2025 / N=1,193`  
**Finding used:** in the studied chocolate-packaging context, larger whitespace increased perceived luxury; typeface/texture showed additional and interacting effects.  
**Limitation:** packaging/category context; explicitly does not justify “more whitespace = more premium” as a software law.

## Design tokens and visual-system interoperability

### SYS01 — W3C Design Tokens Community Group — Design Tokens Format Module 2025.10
**URL:** https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/  
**Evidence:** `FINAL COMMUNITY GROUP REPORT / stable 2025.10`  
**Finding used:** stable vendor-neutral format for exchanging design-token definitions and references; the Format Module was published as a Final Community Group Report on 2025-10-28.  
**Status limitation:** explicitly **not a W3C Standard and not on the W3C Standards Track**.

## Contemporary expressiveness and material systems

### EXPR01 — Google Design — Expressive Design: Google’s UX Research
**URL:** https://design.google/library/expressive-material-design-google-research  
**Evidence:** `CURRENT VENDOR MULTI-STUDY RESEARCH PROGRAM / 46 studies / 18,000+ participants`  
**Finding used:** coordinated use of color, shape, size, motion and containment improved emotional ratings and, in tested designs, salience/task finding; the program explicitly notes a minority preference for calmer designs and recommends starting from user need.  
**Limitation:** Google/Material-specific vendor research; exact improvements and visual tactics are not universal effect sizes or a mandate to use Material styling.

### MAT01 — Apple Human Interface Guidelines — Materials
**URL:** https://developer.apple.com/design/human-interface-guidelines/materials  
**Evidence:** `CURRENT PLATFORM GUIDANCE / 2026`  
**Finding used:** materials are used to create hierarchy/layering; current Liquid Glass guidance distinguishes control/navigation layers from content, recommends sparing use, and notes accessibility/system settings can change material appearance.  
**Limitation:** Apple-platform semantics and visual language; not a cross-platform aesthetic law.

## Modern typography capability

### FONTTECH01 — W3C — CSS Fonts Module Level 4
**URL:** https://www.w3.org/TR/css-fonts-4/  
**Evidence:** `W3C WORKING DRAFT / current September 2026`  
**Finding used:** defines variable-font properties including `font-optical-sizing`; optical sizing allows supported fonts to vary glyph representation for different displayed text sizes.  
**Limitation:** draft platform semantics; does not establish that variable fonts or optical sizing always improve legibility/aesthetics for a given face.

### FONTTECH02 — OpenType 1.9.1 — Registered `opsz` design-variation axis
**URL:** https://learn.microsoft.com/en-us/typography/opentype/spec/dvaraxistag_opsz  
**Evidence:** `CURRENT OPENTYPE SPECIFICATION / 1.9.1`  
**Finding used:** defines optical size as a registered variable-font axis intended to vary glyph design for different text sizes; notes that adaptations can affect proportions, stems, details and legibility/refinement.  
**Limitation:** format/semantics specification; individual typeface quality still requires visual evaluation.

## Iconography and pictographic recognition

### ICON01 — Yuan & Yu — The effects of icon salience, familiarity and concreteness on visual load and behavioral performance
**URL:** https://doi.org/10.1016/j.ergon.2026.103912  
**Evidence:** `CONTROLLED HCI/ERGONOMICS EXPERIMENT / 2026 / N=27`  
**Finding used:** higher icon salience improved visual-search speed/load; familiarity improved semantic-recognition accuracy and speed in the studied tasks; effects differed by task.  
**Limitation:** small controlled VDT sample; use mechanism and task distinction rather than exact universal effect sizes.

## Responsive image art direction

### IMGTECH01 — MDN — Using responsive images in HTML
**URL:** https://developer.mozilla.org/en-US/docs/Web/HTML/Guides/Responsive_images  
**Evidence:** `CURRENT WEB-PLATFORM IMPLEMENTATION GUIDANCE`  
**Finding used:** distinguishes art direction (materially different crops/compositions) from resolution switching and documents `<picture>` as a mechanism for art-directed variants.  
**Limitation:** implementation guidance; this playbook owns the crop/meaning contract, not the HTML recipe.

## Design-token context and color modules

### SYS02 — W3C Design Tokens Community Group — Design Tokens Resolver Module 2025.10
**URL:** https://www.w3.org/community/reports/design-tokens/CG-FINAL-resolver-20251028/  
**Evidence:** `FINAL COMMUNITY GROUP REPORT / stable 2025.10`  
**Finding used:** defines a method for resolving tokens across multiple contexts such as light/dark themes.  
**Status limitation:** not a W3C Standard and not on the W3C Standards Track.

### SYS03 — W3C Design Tokens Community Group — Design Tokens Color Module 2025.10
**URL:** https://www.w3.org/community/reports/design-tokens/CG-FINAL-color-20251028/  
**Evidence:** `FINAL COMMUNITY GROUP REPORT / stable 2025.10`  
**Finding used:** defines color-token representation across multiple color spaces, alpha and fallback data; documents gamut-mapping implications when converting between gamuts.  
**Status limitation:** not a W3C Standard; interchange semantics do not prove cross-platform rendered equivalence.

## Emerging color and accessibility watch items

### COLORHDR01 — W3C — CSS Color HDR Module Level 1
**URL:** https://www.w3.org/TR/css-color-hdr-1/  
**Evidence:** `W3C WORKING DRAFT / 2026`  
**Finding used:** HDR color for CSS is active work built on CSS Color 4/5; useful as an emerging capability/watch item.  
**Limitation:** work in progress; MUST NOT be treated as a stable universal production baseline.

### ACC03 — ISO/IEC 40500:2025 — W3C Web Content Accessibility Guidelines (WCAG) 2.2
**URL:** https://www.iso.org/standard/91029.html  
**Evidence:** `INTERNATIONAL STANDARD / 2025`  
**Finding used:** WCAG 2.2 is also published as ISO/IEC 40500:2025, reinforcing its current normative accessibility status.  
**Limitation:** accessibility conformance standard; not an aesthetic-performance standard.

### A11YWATCH01 — W3C WAI — WCAG 3 Introduction / September 2026 Draft Status
**URL:** https://www.w3.org/WAI/standards-guidelines/wcag/wcag3-intro/  
**Evidence:** `W3C WORKING-DRAFT STATUS GUIDANCE / September 2026`  
**Finding used:** WCAG 3 remains a Working Draft with a changing conformance model and final requirements expected to differ.  
**Limitation:** watch item only; not the current conformance baseline.

## Visual QA and regression

### QA01 — Storybook — Visual tests
**URL:** https://storybook.js.org/docs/writing-tests/visual-testing/  
**Evidence:** `CURRENT OFFICIAL TOOL DOCUMENTATION`  
**Finding used:** snapshots stories and compares them against accepted baselines; supports cross-browser visual testing through its tooling ecosystem.  
**Limitation:** tool mechanics; a baseline can encode a bad design.

### QA02 — Playwright — Visual comparisons
**URL:** https://playwright.dev/docs/test-snapshots  
**Evidence:** `CURRENT OFFICIAL TOOL DOCUMENTATION`  
**Finding used:** screenshot comparisons detect visual changes; rendering can vary by OS, browser version, settings, hardware and other factors, so controlled environments matter.  
**Limitation:** screenshot equality is not visual-quality validation.

### QA03 — Bauer, Frattini & Alégroth — Augmented testing to support manual GUI-based regression testing
**URL:** https://doi.org/10.1007/s10664-024-10522-z  
**Evidence:** `EMPIRICAL SOFTWARE ENGINEERING / 2024`  
**Finding used:** GUI regression testing remains an area where automation can augment practiced manual testing.  
**Limitation:** not evidence for one particular screenshot-diff stack or threshold.

## Generative AI and creative convergence

### AI01 — de Rooij & Biskjaer — Does generative AI make us think alike? A systematic review and meta-analysis of homogenisation effects in human–AI co-creation
**URL:** https://doi.org/10.1080/0144929X.2026.2726451  
**Evidence:** `SYSTEMATIC_REVIEW + META_ANALYSIS / 2026`  
**Finding used:** 19 studies, 61 effect sizes; small statistically significant homogenization effect robust to sensitivity analyses.  
**Limitation:** fast-moving tools/tasks; average effect does not mean every AI workflow reduces diversity.

### AI02 — Anderson et al. — The Effects of Generative AI on Design Fixation and Divergent Thinking
**URL:** https://doi.org/10.1145/3613904.3642919  
**Evidence:** `CHI CONTROLLED EXPERIMENT / 2024 / N=60`  
**Finding used:** exposure/use of AI-generated images in the studied visual ideation task increased fixation and reduced idea count, variety and originality relative to baseline.  
**Limitation:** one ideation task and generation setup; supports workflow safeguards, not an AI ban.

### AI03 — Song et al. — Understanding Design Fixation in Generative Artificial Intelligence
**URL:** https://doi.org/10.1115/DETC2025-168630  
**Evidence:** `ASME EXPERIMENTAL DESIGN STUDY / 2025 / 10 designers`  
**Finding used:** documents design-fixation manifestations in text- and image-generation systems and designers' responses.  
**Limitation:** small experimental sample; use as triangulation rather than population effect estimate.

## Provenance

### PROV01 — C2PA — Content Credentials Technical Specification 2.4
**URL:** https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html  
**Evidence:** `CURRENT TECHNICAL SPECIFICATION / April 2026`  
**Finding used:** current opt-in architecture for cryptographically verifiable provenance/content credentials; version 2.4 adds new formats/assertions and updates.  
**Limitation:** provenance/authenticity signals do not prove semantic truth, quality or desirability of the content.

---

# 81. Source-status audit at the V2.1 cutoff

At **2026-09-28**:

- WCAG 2.2 remains the current W3C Recommendation baseline used here and is also published as ISO/IEC 40500:2025 `[ACC01][ACC03]`.
- WCAG 3 remains a **Working Draft** with an evolving conformance model and does not replace WCAG 2.2 `[A11YWATCH01]`.
- CSS Color 4 is a **Candidate Recommendation Draft**, not a final Recommendation `[COLORTECH01]`.
- CSS Color HDR Level 1 is a **Working Draft** and is treated only as an emerging enhancement/watch item `[COLORHDR01]`.
- CSS Fonts 4 remains a **Working Draft**; OpenType 1.9.1 provides the current `opsz` axis semantics. Variable-font/optical-sizing rules here use them as capability definitions, not causal quality claims `[FONTTECH01][FONTTECH02]`.
- Design Tokens Format/Color/Resolver 2025.10 are stable **Final Community Group Reports**, explicitly not W3C Standards `[SYS01][SYS02][SYS03]`.
- C2PA 2.4 is the current specification version used for provenance guidance `[PROV01]`.
- Apple HIG material/branding/motion pages are current platform guidance; platform-specific visual language remains version-sensitive `[MAT01][PLAT02][MOT01]`.
- Android adaptive-app guidance is current implementation guidance; platform APIs/components can change.
- Material 3 Expressive evidence is a large vendor research program, useful but not an independent universal aesthetic law `[EXPR01]`.
- AI creative-homogenization/fixation evidence is recent and SHOULD be re-reviewed on a short cadence.

No draft/community/vendor status is silently represented as a stronger formal or causal standard than it is.

---

# 82. Claim-to-source assurance map

| Material claim | Evidence | V2.1 treatment |
|---|---|---|
| aesthetics can affect objective performance | AES01 | established average effect with high heterogeneity |
| rapid first impressions depend on complexity/prototypicality | AES02 | contextual perceptual prior |
| novelty + familiarity both matter | NOV01, NOV02, MEM01 | strong contextual principle |
| color meaning is contextual/many-to-many | CLR01 | strong contextual principle |
| serif vs sans has no universal screen winner | TYP01 | reject universal font-class rule |
| responsive design should adapt to window/content | ADAPT01, ADAPT02 | strong platform-supported default |
| motion should be purposeful and reducible | MOT01, ACC01, MOT02 | strong default + accessibility constraint |
| whitespace can cue luxury in some contexts | LUX01 | contextual, explicitly non-universal |
| design tokens have stable interchange spec | SYS01 | implementation standard with exact status |
| screenshot regression detects deltas, not quality | QA01, QA02, QA03 | core QA distinction |
| AI co-creation can homogenize/fixate | AI01, AI02, AI03 | emerging but materially supported risk control |
| C2PA supports provenance/content credentials | PROV01 | contextual provenance mechanism |
| expressive visual systems can improve salience/emotional response in tested designs | EXPR01 | large vendor multi-study evidence; contextual, not universal |
| optical sizing/variable axes are real font capabilities | FONTTECH01, FONTTECH02 | platform capability; craft use remains contextual |
| token modes can be resolved across contexts | SYS02 | stable interchange/resolution mechanism, not design-quality proof |
| color-token interchange can carry color spaces/fallback metadata | SYS03 | stable interchange mechanism with gamut caveats |
| icon search and semantic recognition depend on partly different visual/cognitive properties | ICON01 | contextual HCI mechanism for icon-system design |
| responsive art direction can require alternate crops | IMGTECH01 | current platform mechanism supporting a craft requirement |
| dynamic material appearance depends on background/settings | MAT01 | platform guidance used as mechanism example |
| HDR CSS remains emerging | COLORHDR01 | draft/watch item only |
| WCAG 3 does not replace current WCAG 2.2 baseline | A11YWATCH01, ACC01 | freshness/control rule |

---

# 83. Validation scenarios for future field testing

Before promotion from `REVIEWED` to `VALIDATED`, execute the playbook with non-author designers/operators on representative scenarios.

## Scenario A — Premium B2B SaaS website

Must demonstrate:

- distinctive art direction without generic SaaS template dependence;
- proof-rich marketing composition;
- restrained but non-empty premium execution;
- responsive crops and typography;
- accessible visual hierarchy.

## Scenario B — Dense expert application

Must demonstrate:

- high information density without clutter;
- strong alignment/grouping;
- data typography;
- compact states;
- brand continuity without marketing over-styling.

## Scenario C — Consumer mobile app

Must demonstrate:

- adaptive visual hierarchy;
- expressive brand surface;
- purposeful motion;
- accessibility and reduced motion;
- light/dark appearance.

## Scenario D — Editorial/storytelling website

Must demonstrate:

- pacing;
- reading measure;
- imagery/captions;
- asymmetric composition where useful;
- strong responsive art direction.

## Scenario E — AI-native product using generative imagery

Must demonstrate:

- divergence protocol;
- anti-slop review;
- generated asset consistency;
- provenance/disclosure decision;
- product-specific visual identity.

## Scenario F — Existing design-system redesign

Must demonstrate:

- preservation of useful brand memory;
- token/system migration;
- controlled exceptions;
- visual-regression baseline migration;
- change without partial-style drift.

### Validation evidence

Collect:

- operator completion without author intervention;
- defects/ambiguities;
- time burden;
- reviewer disagreements;
- missed visual failure modes;
- false positives from checklists;
- whether decision frameworks changed real choices;
- whether final outputs improved visual coherence/QA outcomes.

---

# 84. Review triggers

Re-review this playbook when any of the following occurs:

- major WCAG visual-presentation change;
- CSS color/font/rendering status materially changes, including HDR or font-variation semantics;
- Design Tokens Format/Color/Resolver specifications materially change;
- major Apple/Android/Material design-system paradigm shift or material/transparency convention change;
- strong new meta-analysis changes aesthetics/performance conclusions;
- strong new typography or color evidence contradicts a core rule;
- major generative-AI creativity evidence changes homogenization/fixation understanding;
- C2PA/provenance ecosystem materially changes;
- visual-regression tooling/standards materially change;
- repeated field failures reveal missing visual QA controls;
- implementation burden proves a HOUSE rule is not worth its cost;
- this playbook begins to duplicate or conflict with UX/UI standards.

---

# 85. Change governance

A future revision SHOULD record:

```yaml
change_id:
trigger:
source_or_field_evidence:
affected_claims:
affected_rules:
affected_plays:
affected_checklists:
backward_compatibility:
migration_required:
reviewer:
release:
```

Do not silently revise a visual standard because a new style becomes fashionable.

---

# 86. One-page Golden Standard

1. **Start with product/brand meaning, not style.**
2. **Write a visual thesis before high-fidelity styling when art direction matters.**
3. **A visual concept must generate multiple states/screens—not one hero.**
4. **Hierarchy before decoration.**
5. **Controlled complexity, not maximum minimalism.**
6. **Use familiar structure where it reduces interpretation cost; spend novelty deliberately.**
7. **Build distinctiveness from recurring ownable cues, not generic trend signatures.**
8. **Use alignment, proximity and spacing before adding containers.**
9. **Grid count is contextual; the relationship system is what matters.**
10. **Spacing is relational; 4/8-point bases are heuristics.**
11. **High density can be clean; tiny type is not a density strategy.**
12. **Typography must read before it performs personality.**
13. **Serif vs sans is not a universal quality rule.**
14. **Review headline wrapping, numerals and fallback behavior as craft.**
15. **Color is a role system, not a palette board.**
16. **Never rely on color alone for critical meaning.**
17. **Use brand accent with hierarchy, not everywhere.**
18. **Dark mode is re-art-direction, not inversion.**
19. **Surface/depth treatments need a material or hierarchy job.**
20. **Do not make every group a card.**
21. **Every image needs a job.**
22. **Define an image grammar, not a filter.**
23. **Crop responsively; `cover` is not art direction.**
24. **Product-specific evidence beats generic metaphor when explaining/proving.**
25. **Photography, illustration, 3D and AI are mediums, not quality levels.**
26. **Motion must explain state, continuity, hierarchy, causality or narrative.**
27. **Repeated motion should be economical and interruptible.**
28. **Respect reduced motion and preserve meaning without movement.**
29. **Responsive visual design adapts; it does not merely shrink or stretch.**
30. **Design around content pressure, not device labels alone.**
31. **Premium means confidence, coherence, precision, fit and craft—not black/serif/whitespace.**
32. **Editorial means controlled sequence and pacing—not a font genre.**
33. **Design systems encode recurring decisions; they do not create good decisions.**
34. **Tokenize semantics/reuse, not every number.**
35. **A component system does not replace page/screen composition.**
36. **Use trends when they solve a real problem or strengthen brand; isolate volatile signatures.**
37. **Timelessness is resilient visual logic, not visual neutrality.**
38. **Templates are allowed; template-driven strategic art direction is not.**
39. **AI can accelerate production, but art direction, diversity and acceptance remain human/governed responsibilities.**
40. **Diverge before converging on AI outputs.**
41. **Reject generic model signatures that competitors can reproduce cheaply.**
42. **Use provenance/disclosure when trust/context requires it.**
43. **Review real rendered product, not only Figma.**
44. **Visual regression detects change; it does not certify quality.**
45. **Automated baselines require human acceptance.**
46. **Test default, interactive, async, error and edge states visually.**
47. **Test real content, localization, zoom, light/dark and pressure widths.**
48. **Classify visual defects by consequence; fix blockers before polish.**
49. **Allow deliberate system exceptions; repeated exceptions should change the system.**
50. **Evolve the visual language without destroying useful brand memory unless the strategy truly requires it.**
51. **Use variable-font axes only when they improve a real role; review optical sizing when supported.**
52. **Treat font fallback/loading as visible product states, not invisible implementation detail.**
53. **Wide gamut is enhancement; HDR is emerging; both need graceful fallback.**
54. **Judge translucent materials after compositing over real content and relevant system settings.**
55. **Separate token identity from context/mode resolution and rendered output.**
56. **Use art-directed image variants when one crop cannot preserve meaning.**
57. **Give iconography and SVG/CSS/programmatic graphics the same semantic and visual-grammar discipline as other illustration systems.**
58. **Choose expressiveness intentionally; neither calm nor vivid is inherently superior.**
59. **Do not promote vendor research, design-system fashion or draft standards into universal laws.**
60. **A modern visual system must degrade gracefully when advanced visual capabilities are unavailable.**

---

# 87. Final V2.1 assurance verdict

## Research completeness

`PASS_WITH_KNOWN_LIMITATIONS`

The playbook triangulates inherited standards, normative accessibility, current platform guidance, current token/provenance specifications, empirical HCI/aesthetics research, AI-creativity evidence and production QA mechanisms. V2.1 additionally rechecks modern font variation, token resolution/color interchange, wide-gamut/HDR status, responsive image art direction, dynamic materials and contemporary expressive-design evidence.

## Scope integrity

`PASS`

The standard intentionally avoids re-owning UX journey design or UI interaction/state behavior. It owns the specialist visual-craft and art-direction layer.

## False-universality audit

`PASS`

Material design folklore has been downgraded where evidence does not justify universality, including exact grids, spacing units, typeface categories, premium recipes, fixed palette ratios, named trends and visual-regression thresholds.

## Accessibility integrity

`PASS_WITH_SPECIALIST_DEPENDENCY`

Visual accessibility requirements are treated as constraints, while full semantic/interaction accessibility remains delegated to the UI/frontend/accessibility standards.

## AI freshness posture

`PASS_WITH_FAST_REVIEW_REQUIRED`

The anti-AI-slop layer is grounded in 2024–2026 evidence but is explicitly treated as fast-moving and workflow/model dependent.

## Mechanical integrity audit

`PASS`

The final V2.1 artifact was mechanically checked after the research revisions:

- **100/100** Golden Standards are present with no numbering gaps;
- **60/60** one-page Golden Standard rules are present with no numbering gaps;
- **42/42** source IDs are uniquely defined and referenced, including four inherited foundation playbooks and 38 external web sources;
- **0** missing source definitions;
- **0** unused source definitions;
- **0** duplicate source IDs;
- no unresolved authoring markers or placeholder content remain outside the audit record;
- Markdown code fences are balanced;
- major revised subsection sequences are internally coherent.

This is document-integrity evidence, not field-validation evidence.

## Field validation

`PENDING`

Per the Master Playbook Standard, a research-audited artifact is not field validation. Non-author execution across representative digital design projects remains the next lifecycle gate.

---

# 88. Release note

**V2.1 Research-Revalidated Golden Master — 28 September 2026**

V2.1 is a second-pass research/freshness/falsification release over V2.0. It retains the original architecture while materially strengthening:

- expressiveness/intensity as a contextual design variable;
- variable-font and optical-size craft;
- font fallback/loading visual correctness;
- DTCG token resolution and color interchange;
- wide-gamut versus emerging HDR policy;
- dynamic material/transparency compositing QA;
- responsive image art-direction contracts;
- SVG/CSS/programmatic graphic art direction;
- modern-render visual QA;
- WCAG 2.2 versus WCAG 3 draft freshness discipline.

It also adds new anti-patterns specifically targeting variable-font theater, wide-gamut prestige, platform-material cargo cults, `cover`-as-art-direction and token-mode explosion.

This V2.1 release is the canonical second-pass research/falsification synthesis for Digital Visual Design & Art Direction. It should be used together with:

- `Universal Design Principles Master Playbook V2.0` for cross-media perception/aesthetics foundations;
- `UX Master Playbook V2.0` for customer outcome, journeys, research and validation;
- `UI Master Playbook V2.0` for interactive representation, state, controls and adaptation semantics;
- relevant Brand, Frontend and Accessibility/Verification standards where those concerns become material.

The governing principle remains:

> **Visual quality is not a style. It is the demonstrated coherence of intent, hierarchy, expression, accessibility, craft, adaptation and implementation.**

## Previous release

**V2.0 Golden Master — 28 September 2026**

V2.0 established the first canonical specialist architecture. V2.1 supersedes it for new work while preserving V2.0 as the historical baseline for the second-pass audit.

