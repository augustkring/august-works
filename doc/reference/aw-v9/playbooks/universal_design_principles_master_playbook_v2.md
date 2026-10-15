# Universal Design Principles Master Playbook — V2.0
## Evergreen standard for media artifacts, attention, comprehension, trust, brand perception and action

**Version:** 2.0 — Double-Validated Golden Standard  
**Research cutoff:** 21. september 2026  
**Scope:** Websites, landing pages, still images, ads, social media posts, carousels, video, presentations, product marketing, editorial/SEO assets and other visual media artifacts.  
**Document type:** Evergreen, operator-neutral design standard. Not a platform manual, component library or trend forecast.

---

# Executive synthesis

Good design is not the art of making something look “beautiful”. In a commercial or communicative context, design has to perform a sequence of jobs:

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

A design can fail at any one of these stages. An attention-grabbing artifact that is hard to understand is weak design. A beautiful page that feels untrustworthy is weak design. A persuasive message with no obvious next action is weak design. A conversion-optimized interface that erodes the brand is also weak design.

The strongest cross-disciplinary evidence in this playbook points to seven recurring principles:

1. **Clarity before decoration.** Processing fluency, perceptual grouping and strong hierarchy generally make information easier and more pleasant to process [PSY01][PSY02].
2. **Attention is selective, not infinite.** Salience can attract the eye, but irrelevant novelty, clutter and competing focal points can reduce comprehension or redirect attention away from the actual message [ATT01][COG01].
3. **First impressions form very quickly.** Visual complexity and familiarity/prototypicality influence aesthetic judgment within tens of milliseconds in website experiments [PSY03][PSY04].
4. **Meaning must be congruent across elements.** Typeface, shape, image, color, copy and category cues can influence brand perception; the more robust rule is semantic fit rather than a universal style label [TYP01][TYP05][SHP03][BRD01].
5. **Distinctiveness and familiarity must coexist.** Familiar structure helps people orient; novelty can attract, and distinctive brand assets create brand linkage. Evidence on typicality/novelty and mere exposure argues for an optimum rather than either extreme [NOV01][MEM01][BRD04].
6. **Accessibility improves the design floor for everyone.** Contrast, legibility, target size, non-color cues and controllable motion are not optional polish [ACC01][ACC02][ACC03].
7. **There is no universal aesthetic formula.** Golden ratio, rule of thirds, 60-30-10, serif/sans rules and CTA-color folklore can be useful scaffolds, but the second-pass evidence does not support them as universal performance laws [CMP01][CMP02][TYP03][TYP04].

The practical doctrine is therefore:

> **Make the intended thing easiest to notice, easiest to understand, easiest to trust and easiest to act on — while expressing a distinctive brand meaning with as little unnecessary visual competition as the task allows.**

---

# V2 sanity-check verdict

V2 is a **falsification and evidence-reweighting pass** over V1. The question was not “can we find a source that supports this design belief?” but:

> **Does the strongest available evidence justify treating this as a universal principle, a contextual effect, a heuristic, a style choice or a myth?**

The second research pass deliberately favored meta-analyses, systematic reviews, peer-reviewed controlled work and current accessibility/official design standards over design-blog repetition, famous quotes or single case studies.

## What survived strongly

- **Hierarchy, grouping, legibility, contrast, relevance and controlled complexity** remain the most defensible cross-media design foundations [PSY02][COG02][PSY04].
- **First impressions are fast**, but first-look appeal is not the same as trust, comprehension or conversion [PSY03][PSY04].
- **Aesthetics matter more than V1 stated, but less deterministically than design folklore suggests.** A preregistered 2026 meta-analysis covering 31 studies, 234 effect sizes and 18,794 participants found a small-to-medium positive average effect of interface aesthetics on objective user performance (`g = 0.29`), with very high heterogeneity and a prediction interval spanning negative through strongly positive effects [HCI01].
- **Meaning/congruence is generally more robust than broad style labels.** Specific typefaces, shapes, imagery and colors can influence brand perceptions when their associations fit the product/positioning [TYP01][TYP05][SHP03].
- **Accessibility remains a hard floor**, not a preference. W3C requirements around contrast, color independence, target size and controllable movement are stronger design constraints than aesthetic ideology [ACC01][ACC02][ACC03].
- **Distinctive assets should be measured with consumers.** Large academic datasets show substantial differences between asset types, and newer work shows marketers often misjudge fame/uniqueness [BRD02][BRD04][BRD05].

## What V2 downgrades

1. **Golden ratio:** useful proportional exploration only; universal aesthetic preference remains unsupported [CMP01].
2. **Rule of thirds:** a photographic composition convention with weak evidence as a universal aesthetic law; one large image analysis found only a minor role in high-quality photographs/paintings [CMP02].
3. **60-30-10:** practical palette scaffold, but the second pass found no strong peer-reviewed evidence for the exact ratio as an optimal human-response rule. Keep as `HEURISTIC`, not science [CLR05].
4. **F- and Z-patterns:** F-pattern is an observed scanning behavior under certain page conditions; Z-pattern remains primarily practitioner shorthand, not a general eye-movement law [SCAN01][SCAN02].
5. **Serif vs sans:** V2 further rejects universal legibility claims. Controlled reading studies equalizing size/layout often find negligible differences [TYP03][TYP04].
6. **Faces:** social cues can attract and redirect attention, but literal human presence is not universally better; in some product-photo experiments, implied presence outperformed explicit human presence on diagnosticity/purchase intention [IMG03][FACE01].
7. **Premium recipes:** whitespace, angularity, black-and-white and certain typography can signal luxury in specific studies, but all show category/goal/interactions. “Premium = black + serif + whitespace” remains false [LUX01][LUX02][SHP02].
8. **Aesthetic-usability halo:** aesthetics can support performance and perceived quality on average, but the effect is heterogeneous; icon-specific 2026 work shows familiarity/concreteness can explain more than beauty itself [HCI01][ICON01].

## What V2 adds

- a formal **aesthetics-performance evidence layer** [HCI01]
- a stronger **novelty × familiarity** principle based on the MAYA literature and mere-exposure meta-analysis [NOV01][MEM01]
- updated **color-emotion systematic evidence** across 42,266 participants / 64 countries [CLR04]
- a stronger **distinctive-assets benchmark** from 1,162 assets across 21 categories and four countries [BRD04]
- explicit **consumer validation of brand assets** rather than marketer intuition [BRD05]
- empirical **data-visualization perception hierarchy** rather than “chart junk” tradition alone [DV01]
- an evidence-backed **icon design layer** separating salience, familiarity, concreteness and aesthetics [ICON01][ICON02]
- a **scarcity evidence layer** distinguishing legitimate scarcity effects from deceptive urgency [SCARC01]

## V2 doctrine

The most durable design principle is not a ratio, font family, palette or layout template.

It is:

> **Preserve the viewer’s limited attention for the information, meaning and action that matter; use visual form to make that path easier, more credible, more memorable and more distinctive without creating avoidable interpretation cost.**

---

# 1. Evidence hierarchy

This playbook distinguishes scientific evidence from design tradition.

| Tier | Evidence type | How it is used |
|---|---|---|
| **A0** | Meta-analyses and systematic reviews with broad evidence bases | Highest weight for average effects and boundary conditions; heterogeneity still matters |
| **A1** | Peer-reviewed controlled experiments / replicated perception and consumer research | Strong causal or mechanistic support within the tested scope |
| **A2** | W3C/accessibility standards and current official design-system guidance | Strong normative/operational constraints; not automatically causal marketing evidence |
| **B1** | Large multi-market observational/benchmark datasets and eye-tracking programs | Strong pattern evidence; correlation/external validity must be considered |
| **B2** | Single-domain/category peer-reviewed studies | Useful contextual evidence; never generalized beyond tested boundary without caution |
| **C** | Repeated practitioner/UX heuristics | Good starting points when low-risk; validate material decisions |
| **D** | Design philosophy / tradition / folklore | Inspiration or compositional scaffolding only |

## 1.1 Evidence labels

- `META_ANALYSIS`
- `SYSTEMATIC_REVIEW`
- `CONTROLLED_EXPERIMENT`
- `EYE_TRACKING_EXPERIMENT`
- `OBSERVATIONAL_RESEARCH`
- `OFFICIAL_DESIGN_STANDARD`
- `ACCESSIBILITY_STANDARD`
- `INDUSTRY_RESEARCH`
- `DESIGN_PHILOSOPHY`
- `HEURISTIC`
- `FOLKLORE`

## 1.2 Tactic classification

Every rule belongs to one of five classes:

| Class | Meaning | Default |
|---|---|---|
| **A — Core principle** | Strong cross-context evidence / accessibility / perception foundation | Use by default |
| **B — Strong contextual principle** | Good evidence but depends on task/category/brand | Use when context fits |
| **C — Useful heuristic** | Practical organizing rule without universal empirical proof | Use as starting point, not dogma |
| **D — Style choice** | Primarily expressive/brand-driven | Choose intentionally |
| **E — Myth / harmful shortcut** | Overgeneralized, unsupported or actively damaging | Avoid as a rule |

---

# 2. The universal design performance model

A media artifact should be evaluated through six layers.

## 2.1 Attention

**Question:** Does the relevant audience notice the right thing?

Drivers can include:

- contrast
- position
- size
- motion
- faces / gaze
- novelty
- color salience
- whitespace/isolation
- semantic relevance

But attention is not success. Motion can capture the eye while lowering comprehension. A face can capture attention while stealing it from the product. High complexity can create stimulation while weakening the message [FACE01][ATT01].

## 2.2 Orientation and hierarchy

**Question:** Can the viewer immediately tell what matters first, second and third?

Hierarchy comes from the combined effect of:

- scale
- contrast
- position
- spacing
- grouping
- type weight
- color roles
- depth
- motion
- sequence

Apple's 2026 design principles describe clarity as being built through order, spacing and contrast; IBM and Material likewise treat typography and color as hierarchical systems rather than decoration [OFF01][OFF04][OFF05].

## 2.3 Comprehension

**Question:** Can the viewer form the intended mental model with low effort?

Strong comprehension usually means:

- one coherent idea at a time
- meaningful grouping
- direct language
- visual-verbal congruence
- enough context
- appropriate information density
- signals that show where to look

Research on multimedia learning consistently finds benefits from signaling and coherence, and costs from unnecessary “seductive details” that consume attention without supporting the task [COG01][COG02].

## 2.4 Trust and meaning

**Question:** Does the artifact feel credible, appropriate and consistent with the promised brand/product?

Trust can be influenced by:

- visual polish
- consistency
- relevant proof
- legibility
- familiar interaction patterns
- real people / reviews / evidence
- congruence between brand promise and visual language

Visual quality can influence perceived credibility, and a 2026 meta-analysis finds a small-to-medium positive average effect of aesthetics on objective interface performance. But the effect is highly heterogeneous; beauty cannot substitute for correctness, transparency, accessibility or actual usability [TRUST01][HCI01].

## 2.5 Memory and brand linkage

**Question:** If the person remembers the message, will they remember who it came from?

Distinctive assets can include:

- logo / logotype
- color combinations
- shapes
- mascots/characters
- sonic cues
- typography
- recurring photography style
- verbal devices

Empirical brand-asset research shows these cues differ substantially in uniqueness/ownership potential; consistency helps build recognition over time [BRD02][BRD03].

## 2.6 Action

**Question:** Is the intended next step obvious, relevant and low-friction?

Action depends on more than button styling:

- motivation / value
- clarity
- trust
- effort
- choice complexity
- CTA salience
- perceived risk
- information sufficiency

There is no universally best CTA color. Salience and contextual contrast matter more than hue folklore [CTA01].

---

# 3. The 45 golden standards

1. **Design for a task, not for decoration.** Every element should justify its existence through meaning, hierarchy, emotion, branding or action.
2. **The viewer should be able to identify the primary focal point quickly.** Competing focal points dilute hierarchy.
3. **Attention must point toward the message, not merely toward spectacle.** Salience without relevance is noise.
4. **Use contrast intentionally:** size, luminance, color, weight, motion, density and whitespace are all contrast variables.
5. **Make the most important thing visually strongest — unless deliberate subtlety is the brand strategy.**
6. **Use proximity to express relationships.** Elements that belong together should look grouped [PSY02].
7. **Use similarity consistently.** Same-looking objects imply related meaning/function [PSY02].
8. **Use whitespace as structure, not as leftover emptiness.** It can separate groups, increase focus and sometimes signal premium restraint [WSP01][WSP02].
9. **Prefer sufficient simplicity over maximum minimalism.** Apple explicitly distinguishes simplicity from minimalism: remove friction, not necessary context [OFF01].
10. **Reduce visual complexity until remaining complexity serves the task.** Very high complexity often hurts first impressions; too little can also feel empty or uninformative depending on context [PSY04][CMPX01].
11. **Start from familiar conventions, then add distinctiveness.** Prototypicality improves rapid orientation; distinct brand assets create memory [PSY04][BRD02].
12. **Do not rely on one rigid scan pattern.** F-patterns appear in text-heavy weakly formatted pages; strong hierarchy can produce more effective layer-cake scanning [SCAN01][SCAN02].
13. **Design headings and first lines as information-carrying surfaces.** People scan before committing to reading.
14. **Color must have a role.** Use it for brand, hierarchy, state, grouping or emphasis — not arbitrary decoration [OFF03][OFF04].
15. **Never use color alone to communicate critical meaning** [ACC01].
16. **Hue associations are contextual.** “Blue = trust” and “green = sustainability” are tendencies/conventions, not laws [CLR01][CLR02][CLR03].
17. **Saturation and value matter as much as hue.** Bright/vivid accents attract attention; neutral surfaces reduce competition [OFF04].
18. **A CTA should contrast with its immediate visual environment.** There is no universal red/green winner [CTA01].
19. **60-30-10 is a palette heuristic, not a scientific ratio.** Use it when it helps establish dominant/support/accent hierarchy [CLR05].
20. **The golden ratio is optional, not optimal by default.** Research does not support a universal automatic preference [CMP01].
21. **Rule of thirds is a compositional starting point, not a human-perception law** [CMP02].
22. **Typography first has to be readable.** Brand expression comes after legibility [OFF02][TYP03].
23. **Serif vs sans serif is not a universal readability decision.** Font-specific form, size, x-height, spacing and context matter more [TYP03][TYP04].
24. **Typography carries semantic meaning.** Choose a typeface that fits the category, positioning and desired personality [TYP01][TYP02].
25. **Use type scale, weight and spacing to build hierarchy; don't add typefaces to solve hierarchy.**
26. **Minimize unnecessary typeface variety.** Too many styles weaken coherence and hierarchy [OFF02].
27. **Avoid ultra-light weights for small or critical text.** Legibility declines in difficult viewing conditions [OFF02].
28. **Use imagery that helps the viewer understand use, outcome or meaning.** Context can improve mental imagery when it fits the product [IMG01].
29. **Background complexity should support, not compete with, the focal subject.** Moderate complexity can outperform both sterile and cluttered extremes in some product contexts [IMG02].
30. **Faces are powerful attention cues; direct the gaze deliberately.** A face looking toward product/copy can transfer attention; direct gaze may trap attention on the face [FACE01][FACE02].
31. **Do not use people as generic decoration.** Human presence should communicate context, emotion, identity, proof or direction.
32. **Shape communicates.** Rounded forms can cue softness; angular forms hardness/premiumness in certain contexts [SHP03][SHP02].
33. **Congruence beats random symbolism.** Shape, typeface, color, photography and copy should reinforce the same brand meaning [TYP02][SHP03].
34. **Build distinctive brand assets consistently.** Constant aesthetic reinvention destroys recognition [BRD02][BRD03].
35. **Novelty is for attention; consistency is for memory.** Balance both rather than maximizing either.
36. **Motion should communicate change, hierarchy, causality or narrative.** Decorative movement that competes with reading is often harmful [ACC03].
37. **Audio and visual cues should reinforce each other when both are available.** Multisensory brand cues can strengthen active attention and memory [VID01].
38. **Brand cues should not arrive after the audience has already left.** Integrate brand/product naturally into the experience.
39. **Reduce equal-prominence choices at key decision moments.** Choice overload depends on complexity, uncertainty and task difficulty, not just raw option count [CHOICE01][CHOICE02].
40. **Use one dominant action hierarchy, not necessarily one action total.** Secondary options can exist without visually competing with the primary action.
41. **Aesthetics can increase perceived credibility, but cannot rescue deception, errors or poor utility** [TRUST01].
42. **Accessibility is a quality floor.** Meet contrast, target-size, readable typography and motion-control standards [ACC01][ACC02][ACC03].
43. **Premium perception comes from coherence, restraint, craft and category congruence — not from adding black, serif type or whitespace mechanically** [WSP02][LUX01].
44. **Test material uncertainty in the actual audience/context.** A universal principle tells you what to protect; experimentation tells you which execution wins.
45. **Design should feel inevitable only after the underlying purpose is solved.** Jony Ive's philosophy of “simple, coherent and inevitable” is a useful craft aspiration, not experimental evidence [PHI01].

---

# 4. Attention: how visual artifacts earn the first look

## 4.1 Attention is competition

A visual artifact competes against:

- surrounding content
- prior expectations
- the viewer's task
- time pressure
- device/context
- competing visual objects inside the artifact

The designer's job is therefore not “make everything noticeable”, but **allocate attention**.

## 4.2 Salience variables

An element becomes more salient when it differs from its context in one or more dimensions:

- size
- luminance
- hue/chroma
- shape
- orientation
- motion
- spatial isolation
- sharpness
- depth
- semantic relevance

But salience is relational. A bright red button on a red page is not salient. A black button on an almost-white page may be highly salient.

### Rule

```text
salience = difference from local context
not = absolute intensity
```

This is why “red CTA converts better” is a weak rule and “the primary CTA should be visually distinct from surrounding elements” is a robust rule [CTA01].

## 4.3 Novelty vs relevance

Novelty can trigger orientation. But novelty that lacks relevance can cause:

- distraction
- misattribution
- confusion
- low brand linkage
- annoyance

Use novelty to make the **value** surprising, not merely the styling strange.

## 4.4 First impression window

Website experiments show people can form stable aesthetic reactions in around 50 ms, and visual complexity/prototypicality effects can appear even faster [PSY03][PSY04].

This does **not** mean the entire conversion decision happens in 50 ms.

It means the artifact rapidly communicates:

- familiar vs strange
- orderly vs chaotic
- polished vs sloppy
- dense vs sparse
- category fit
- possible trustworthiness

So visual craft affects whether deeper processing ever begins.

## 4.5 Motion

Motion onset is naturally attention-grabbing. Use it for:

- state changes
- transition explanation
- hierarchy
- progressive disclosure
- story progression
- demonstrating mechanism

Avoid:

- looping ambient motion near long-form reading
- multiple independent moving objects
- autoplay movement with no control where it interferes with use
- flashing

W3C accessibility guidance explicitly requires controls for certain moving/blinking/auto-updating content and restricts flashing because it can distract or harm users [ACC03].

## 4.6 Faces

Human faces are strong social stimuli.

Research in banner advertising found:

- faces can attract attention
- a face looking toward product/text can guide gaze there
- direct gaze can hold attention on the face itself
- guided gaze can improve memory for ad content in some experiments [FACE01][FACE02]

### Design rule

Use gaze direction like an arrow.

```text
face → gaze → product / headline / CTA
```

Do not assume “add a face” improves conversion. If the face becomes the dominant endpoint, it can reduce attention to the actual commercial information.

---

# 5. Visual hierarchy

Hierarchy answers:

> What should I look at first, second and third?

## 5.1 Primary hierarchy levers

Approximate strength depends on context, but common levers include:

1. scale
2. contrast
3. position
4. whitespace/isolation
5. color saturation/luminance
6. weight
7. motion
8. depth
9. repetition

Use multiple aligned cues for the most important elements rather than forcing one cue to do all the work.

## 5.2 Three-level default

A useful artifact often benefits from:

- **Primary:** core promise, subject or action
- **Secondary:** explanation/proof
- **Tertiary:** supporting metadata/details

This is not a rigid “three objects” rule. It is a clarity principle.

## 5.3 Hierarchy conflict

Common failure:

- huge headline
- huge image
- bright banner
- bright CTA
- multiple badges
- animated icon

Everything screams; nothing leads.

### Repair

Choose one dominant signal. Reduce contrast elsewhere.

## 5.4 Information scent

The next element in a sequence should clearly indicate what happens next.

A “Learn more” CTA may be fine when context is obvious, but specific action labels generally reduce ambiguity:

- See pricing
- Compare plans
- Watch demo
- Download benchmark
- Book consultation

Apple's HIG similarly recommends action labels that communicate purpose and limiting the number of simultaneously prominent actions [OFF06].

---

# 6. Gestalt principles — the perceptual grammar of grouping

Modern vision research supports several classical Gestalt grouping principles, though they are not magical “UX laws” [PSY02].

## 6.1 Proximity

Elements close together are perceived as related.

### Use

- label + input
- image + caption
- price + product
- headline + supporting copy

### Failure

Equal spacing everywhere makes unrelated elements appear related and related elements appear separate.

## 6.2 Similarity

Objects sharing color, shape, size or style are likely to be grouped mentally.

Use consistent style for:

- interactive elements
- status types
- content categories
- card families

Don't make two different actions look identical unless their meaning is equivalent.

## 6.3 Common region

A border/background/container can strongly group elements.

Use cards/sections only when the region itself communicates a meaningful relationship. Over-cardification creates fragmentation.

## 6.4 Continuity

Eyes tend to follow continuous visual paths.

Useful for:

- timelines
- flows
- diagrams
- progressive sequences

## 6.5 Common fate

Objects moving together are perceived as related.

Useful in animation to show:

- grouping
- state transition
- cause/effect

## 6.6 Figure-ground

People need to separate focal content from background.

Increase figure-ground clarity through:

- luminance contrast
- depth
- borders
- whitespace
- focus
- blur only where appropriate

Avoid weak foreground/background separation, especially for text.

---

# 7. Composition: balance, grids and spatial structure

Composition is the allocation of visual weight inside a frame.

## 7.1 Balance is not the same as symmetry

### Symmetrical balance

Can signal:

- stability
- formality
- calm
- control

Useful when the brand/task benefits from predictability or monumentality.

### Asymmetrical balance

Can signal:

- movement
- energy
- editorial sophistication
- contemporary character

An asymmetrical composition is still balanced when visual weights counteract each other.

Visual weight grows through:

- size
- darkness
- saturation
- detail
- isolation
- faces
- text density
- motion

## 7.2 Grid systems

Grids are not aesthetic goals. They create:

- alignment
- repeatability
- rhythm
- scalable consistency
- easier comparison

Break a grid only when the violation creates useful emphasis.

A grid that is never visible as a principle has probably become visual noise.

## 7.3 Alignment

Alignment creates invisible connections between elements.

Bad alignment is one of the fastest ways to make an artifact feel careless because it creates weak visual relationships without adding meaning.

### Standard

Prefer a small number of strong alignment axes over many almost-aligned positions.

## 7.4 Rule of thirds

The rule of thirds is a useful **composition generator**, especially for creating asymmetry, negative space and off-center subject placement.

But V2 explicitly downgrades the common claim that placing the focal point on third-lines/intersections is inherently more beautiful or effective. Empirical analysis of high-quality photographs and paintings found the rule played only a minor — if any — role across those large image sets [CMP02].

### Use it for

- generating alternatives quickly
- reserving text space beside a subject
- avoiding accidental dead-center compositions
- creating directional tension

### Do not use it as

- an aesthetic law
- a conversion rule
- a reason to ignore gaze, negative space, message placement or actual medium constraints

**Evidence class:** `C — useful heuristic / mixed empirical support`.

## 7.5 Golden ratio

The golden ratio is historically influential and can produce pleasing proportional systems, but the universal preference claim does not survive the evidence review. Controlled work using both explicit and implicit evaluations did not find a clear automatic preference for golden-ratio placement over alternatives [CMP01].

Use φ as:

- a proportional exploration tool
- a grid-generation option
- a way to create related scales

Do not retrofit a working composition merely to satisfy φ.

**Evidence class:** `C/D — heuristic / universal claim rejected`.

## 7.6 60-30-10

The familiar 60–30–10 rule is best interpreted as a **dominant / supporting / accent** heuristic, not a scientifically optimized proportion.

The second research pass did not identify strong peer-reviewed evidence showing that exactly 60%, 30% and 10% produces superior attention, aesthetics or conversion across media.

The valuable principle underneath it is:

```text
one dominant visual field
+ one supporting field
+ a scarce accent with semantic/emphasis value
```

Actual proportions can be 70/20/10, 80/15/5, 50/40/10 or something else entirely depending on content, brand and medium.

**Evidence class:** `C — practitioner heuristic; exact ratio unsupported`.

## 7.7 Edge tension and breathing room

Elements too close to borders can create accidental tension. Elements with deliberate edge bleed can create energy and scale.

Use intentionality:

- either give a subject enough breathing room
- or crop it decisively

Avoid almost-touching edges and almost-aligned crops.

## 7.8 Crop

A strong crop:

- preserves the important subject
- avoids cutting at awkward joints/facial features
- supports gaze direction
- gives text enough space
- remains recognizable at final display size

Crop for the **final medium**, not the source image.

---

# 8. Scanning patterns and reading flow

## 8.1 F-pattern is a symptom, not a layout template

Nielsen Norman Group's eye-tracking research found F-shaped scanning in text-heavy pages, but later clarified that it is often the result of weak formatting and users minimizing effort [SCAN01].

Therefore:

> Do not design an F shape. Design information so people do not need to hunt in one.

## 8.2 Layer-cake scanning

When headings/subheadings are visually distinct and informative, people can scan them efficiently and selectively read supporting paragraphs [SCAN02].

### Practical rule

A person reading only headings should still understand the page's story.

## 8.3 Scan paths are interface-dependent

A 2026 eye-tracking preprint found that assumptions derived from classic vertical web-search layouts did not transfer cleanly to horizontal carousel interfaces [SCAN03]. This is not strong enough evidence to prescribe a new “carousel pattern”; its value is the boundary condition:

> **Do not export an observed scan pattern from one interface geometry and treat it as a universal human reading law.**

## 8.4 Spotted scanning

Users may hunt for:

- numbers
- prices
- familiar words
- links
- names
- bold labels

Make task-critical information visually findable.

## 8.5 Commitment reading

If motivation is high, people will read much more deeply. Long-form content is not inherently bad.

The design job is to make the transition from scanning to committed reading easy:

- clear opening
- strong information scent
- meaningful headings
- readable measure
- credible evidence
- no needless interruptions

## 8.6 Z-pattern

The “Z-pattern” is popular design folklore for sparse layouts, but unlike the F-pattern, it lacks a comparable robust empirical foundation as a universal scanning law.

**Classification: D — composition idea, not behavioral law.**

Use it if the composition works; do not assume viewers literally trace a Z.

---

# 9. Color system

Color has four different jobs that should not be confused:

1. **Brand expression**
2. **Hierarchy / attention**
3. **Semantic meaning / state**
4. **Atmosphere / emotion**

## 9.1 Hue, chroma/saturation and tone/value

Hue alone does not define a color experience.

### Hue

The family: red, blue, green, etc.

### Chroma / saturation

How colorful/intense the color appears.

Higher chroma often creates more salience and energy, but too much saturation across many elements destroys hierarchy.

### Tone / value

Lightness/darkness.

Tone is central to legibility because luminance contrast often matters more than hue difference [OFF04][ACC01].

Google Material uses hue/chroma/tone explicitly and maps tones to semantic roles rather than treating a raw brand color as appropriate everywhere [OFF04].

## 9.2 Color hierarchy

A robust palette usually contains:

- dominant surface/background system
- primary text/foreground system
- primary accent
- optional secondary/tertiary accents
- semantic states

If every element uses a saturated brand color, the brand color loses its signaling power.

Apple and Material both emphasize sparing, purposeful accent use and adequate contrast [OFF03][OFF04].

## 9.3 Complementary colors

Opposite colors on a color wheel can create strong contrast.

Useful for:

- focal accents
- energetic campaigns
- high figure-ground separation

But complementary hue is not automatically accessible. Two colors can be opposite in hue and still have inadequate luminance contrast.

### Rule

Test luminance contrast separately from color-wheel harmony.

## 9.4 Analogous colors

Nearby hues can create harmony and lower visual tension.

Useful for:

- calm systems
- editorial backgrounds
- category tonal worlds

Risk: weak hierarchy if tones/chromas are too similar.

## 9.5 Monochromatic systems

One hue across many tones/chromas can create:

- cohesion
- premium restraint
- strong brand consistency

Risk: semantic ambiguity and weak differentiation.

Use neutral surfaces and tonal contrast.

## 9.6 Warm vs cool

Warm colors often feel more advancing/energetic; cool colors often feel calmer/receding. But these are broad perceptual/cultural tendencies rather than conversion laws.

## 9.7 Color associations

Color–emotion correspondences are real enough to matter, but they are **many-to-many, not a dictionary**.

A 2025 systematic review synthesized 132 peer-reviewed articles, 42,266 participants and 64 countries. It found recurring associations driven by lightness, saturation and hue — for example, lighter colors tending more positive, red tending high-arousal, and blue/green/white tending more positive-low-arousal on average — while also emphasizing that most evidence concerns **associations**, not guaranteed experienced emotion or consumer behavior in a specific context [CLR04].

This upgrades the evidence for using color semantically while downgrading simplistic statements such as:

```text
blue = trust
red = urgency
black = luxury
green = sustainability
```

The correct model is:

```text
base color association
× lightness/saturation
× category convention
× surrounding colors
× culture
× product/message context
× brand history
= perceived meaning
```

Use color as a probabilistic cue, not a deterministic psychological command.

## 9.8 Color and brand personality

Labrecque & Milne found that hue, saturation and value influence brand personality perceptions, supporting the idea that color choice participates in positioning rather than merely decoration [CLR02].

### Strategic sequence

```text
Desired brand meaning
→ category conventions
→ differentiation opportunity
→ color family
→ chroma/tone system
→ accessibility test
→ real-market validation
```

Not:

```text
“Blue means trust” → choose blue
```

## 9.9 Cross-cultural color

A large multi-country study found substantial cross-cultural similarity in color-emotion associations, but also geographic/language/cultural variation [CLR03].

For international brands:

- preserve brand recognizability
- test market-specific interpretations
- treat semantic colors (error, success, warning) especially carefully

## 9.10 CTA color

There is no reliable universal “best converting color” [CTA01].

The correct question:

> Which treatment gives the primary action sufficient salience, accessibility and brand congruence in this context?

Test:

- contrast against local surface
- label clarity
- button size/shape
- whitespace
- location
- nearby competing actions
- copy

before attributing performance to hue.

## 9.11 Color anti-patterns

Avoid:

- low-contrast text
- relying on red/green alone for status
- too many semantic colors
- every CTA using equal bright emphasis
- arbitrary accent colors not in system
- oversaturated surfaces behind long-form text
- encoding brand personality through color stereotypes alone

---

# 10. Typography system

Typography performs four jobs:

1. **Legibility**
2. **Hierarchy**
3. **Tone/personality**
4. **Rhythm/density**

## 10.1 Legibility before style

Apple recommends readable sizes, avoiding very light weights at small sizes and using weight/size/color to establish hierarchy [OFF02]. IBM similarly emphasizes controlled type sets and discourages semibold for long text [OFF05].

### Core

- adequate size
- adequate contrast
- stable letterforms
- sufficient spacing
- suitable line length
- appropriate line height
- avoid thin display fonts for dense body copy

## 10.2 Serif vs sans serif

There is no robust universal winner for readability.

Controlled studies comparing well-designed serif and sans faces under equivalent size/layout conditions often find very small or no meaningful differences in reading speed, errors or legibility [TYP03][TYP04]. A 2022 controlled paragraph-reading study, for example, found Helvetica and Times New Roman similar when layout was equivalent [TYP07].

### Correct rule

Prioritize:

- actual letterform quality
- x-height and apparent size
- stroke contrast/weight
- rendering quality
- spacing
- final viewing distance/medium
- reader needs
- language/script

Then choose serif/sans primarily for **semantic fit, brand character and system behavior**, not because one category is inherently more readable.

## 10.3 Typeface communicates meaning

Fonts carry semantic associations independent of word content [TYP02]. Doyle & Bottomley found brands were chosen more often when presented in category-appropriate typefaces [TYP01].

Potential connotations:

### Serif

Can cue:

- editorial
- heritage
- authority
- sophistication
- literary/cultural tradition

But a slab serif, Didone and old-style serif communicate very different things.

### Sans serif

Can cue:

- modernity
- neutrality
- technical clarity
- accessibility
- functionalism

But geometric, grotesk and humanist sans styles differ considerably.

### Monospace

Can cue:

- code
- systems
- data
- technicality
- mechanical precision

### Script / handwritten

Can cue:

- human touch
- personal expression
- craft
- luxury in specific contexts

Risk: poor legibility, cliché or artificial informality.

### Display / highly stylized

Useful for:

- short expressive moments
- identity
- campaign impact

Not ideal as default for long body text.

## 10.4 Typeface congruence

Visual features should “speak the same language”. Shape–typeface congruence has been shown to influence brand credibility, aesthetics and price expectations [TYP05].

Example:

```text
precision engineering brand
+ rigid geometric identity
+ highly playful bubbly script
= possible semantic conflict
```

Incongruence can sometimes create attention, but should be deliberate.

## 10.5 Type hierarchy

Create hierarchy through a small number of variables:

- size
- weight
- line height
- spacing
- color

Don't solve every hierarchy level with a new font.

### Practical scale

A typical artifact may need:

- display/hero
- heading
- subheading/title
- body
- label/caption

Not every project needs all five.

## 10.6 Line length

There is no single scientifically optimal character count. UX heuristics often recommend roughly 50–75 characters for comfortable long-form web reading, while controlled studies show wider measures can sometimes be read faster.

**Classification: C — readability heuristic.**

Optimize for:

- scanning
- font size
- content density
- viewport
- audience

rather than a magic character count.

## 10.7 Line height

More line height can improve separation and readability up to the point where lines stop feeling like a paragraph.

Use higher line-height for:

- long reading
- smaller text
- low-contrast contexts

Use tighter line-height for:

- large display type
- short headings

## 10.8 Letter spacing

Don't “track out” body text to look premium.

Spacing changes can influence readability, especially for certain readers, but special dyslexia-friendly letterforms have not consistently improved reading performance; spacing effects are more nuanced [TYP06].

## 10.9 Uppercase

All caps can be useful for:

- short labels
- visual identity
- navigation categories

Long passages in all caps generally reduce word-shape cues and visual comfort.

## 10.10 Typography and premium perception

Premium typography is not “serif + wide tracking”.

Premium perception is more likely to emerge from:

- typeface quality
- spacing discipline
- hierarchy
- restraint
- proportional fit
- strong print/digital rendering
- congruence with category/brand

Recent packaging research found “luxurious” typeface treatment and whitespace could affect luxury/quality perceptions, but effects interact with other visual features [LUX01].

---

# 11. Whitespace, density and visual complexity

Whitespace means unused visual space, regardless of background color.

## 11.1 Functional whitespace

Whitespace can:

- group/separate
- increase focus
- clarify hierarchy
- improve scanning
- provide rhythm
- make key objects feel intentional

## 11.2 Whitespace and premium signals

Consumer research has found that extended whitespace can communicate culturally learned meanings and, in particular contexts, increase perceived luxury/aesthetic pleasure [WSP01][WSP02].

But the effect is not universal across cultures or categories.

### Premium principle

Whitespace signals confidence when the remaining information is strong enough to justify the empty space.

Empty space around weak content feels empty, not premium.

## 11.3 Complexity is not binary

Research has found:

- very high visual complexity can reduce first-impression aesthetics [PSY04]
- some commercial webpage/product contexts show an inverted-U pattern, where moderate complexity performs better than both low and high complexity [CMPX01]
- product backgrounds with moderate context can improve product processing and purchase intention compared with overly plain or complex backgrounds [IMG02]

### Golden standard

> Minimize **unhelpful complexity**, not information itself.

## 11.4 Information density

High density can be correct when:

- audience is expert
- comparison is the task
- information is scannable
- visual grouping is strong

Low density can be correct when:

- emotional impact matters
- one idea should dominate
- premium/editorial expression is desired
- cognitive load must remain low

## 11.5 Clutter test

Ask for every object:

- Does this add information?
- Does it add emotion?
- Does it add trust?
- Does it add brand memory?
- Does it guide action?

If no: remove or reduce it.

---

# 12. Imagery system

An image should do a job. Common jobs include:

- show the product
- show use
- show outcome
- show emotion
- show identity
- demonstrate evidence
- create atmosphere
- guide attention
- explain a mechanism

## 12.1 Product-only vs contextual imagery

A plain background maximizes object isolation and comparison.

Contextual imagery can help viewers imagine:

- scale
- use
- environment
- social context
- outcome

Experimental ecommerce research found contextually fitting backgrounds can increase mental imagery, product liking and purchase intention for certain products; the effect depends on fit and product type [IMG01].

### Use isolated product imagery when

- detail/comparison is key
- shape/material needs inspection
- catalog consistency matters
- context could mislead

### Use contextual imagery when

- usage is ambiguous
- experience matters
- emotional projection matters
- scale/environment matters

Often the strongest system includes **both**.

## 12.2 Background complexity

More background detail can increase raw attention while taking attention away from the focal product. Eye-tracking research found moderate complexity performed best for information processing/purchase intention in the studied product context [IMG02].

### Rule

Background should answer “where/why/how” without becoming the subject.

## 12.3 Human presence

Humans are powerful social cues, but “add a face” is not a universal performance rule.

Human presence can provide:

- scale
- identification
- emotion
- use-case context
- social proof
- gaze direction

But it can also dominate visual attention or reduce product diagnosticity. Product-photo research has found that **implied social presence** can sometimes outperform literal physical human presence, depending on the product and task [IMG03].

### Use human presence when it performs a job

- shows use
- creates credible identification
- communicates emotion
- adds scale
- directs gaze
- supplies proof/testimonial context

### Avoid

- generic “smiling person” decoration
- face imagery that steals attention from the message/product
- demographic tokenism
- people whose expression/context conflicts with the actual brand promise

## 12.4 Gaze direction

Use gaze strategically:

- **toward viewer:** connection, confrontation, social presence
- **toward product/copy:** visual directional cue
- **off-frame:** can imply narrative/space but may pull attention away

Studies have found gaze directed toward advertised content can increase viewing and, in some settings, purchase intention [FACE01][FACE02].

## 12.5 Camera angle and distance

### Close-up

Signals:

- intimacy
- detail
- emotion
- material quality

### Medium

Signals:

- relationship
- use context
- human-product interaction

### Wide

Signals:

- environment
- scale
- status
- atmosphere

Match framing to the information job.

## 12.6 Depth of field

Shallow depth of field isolates focus and can feel cinematic/premium.

Deep focus supports:

- comparison
- context
- information-rich environments

Don't blur context if context is the proof.

## 12.7 Direction and implied motion

Objects/people pointing or moving toward another element can create visual flow.

Leave “lead room” in the direction of:

- movement
- gaze
- progression

unless tension is deliberately desired.

## 12.8 Authenticity

Authenticity is not synonymous with low production quality.

A polished image can feel authentic if:

- scenario is plausible
- details are accurate
- people behave naturally
- product use is real
- lighting/retouching does not erase reality

Likewise, “UGC-looking” content can feel fake if staged badly.

## 12.9 Image–message congruence

Visual and verbal cues should normally reinforce the same interpretation. Advertising research finds congruence between product type, appeal and visual/verbal cues can improve response and processing fluency [BRD01][IMG04].

Incongruence is useful when it creates an intentional “second look” without obscuring the intended meaning.

---

# 13. Shapes, corners and visual form

Shapes carry associations, but context and congruence matter.

## 13.1 Rounded and circular forms

Rounded/circular forms can cue softness, approachability or gentleness in some contexts, but the association is inferential rather than universal. Controlled consumer research finds circular vs angular logo shapes can activate softness vs hardness concepts, which then influence product/company judgments **when people have enough cognitive resources and when other message cues do not conflict** [SHP03].

## 13.2 Angular forms

Angular forms can cue hardness, confrontation, technical precision or distance depending on context. A separate four-study program found angular logos increased perceived premiumness via psychological distance, especially when status expression mattered [SHP02].

### Boundary condition is the rule

Do not translate this into:

```text
rounded = friendly
angular = premium
```

Instead ask:

```text
What association does this form activate?
Does that association fit the product attribute / category / positioning?
Do copy, imagery and context reinforce or contradict it?
```

Shape meaning is a **semantic cue with moderators**, not a personality switch.

## 13.3 Corner radius

Corner radius influences tone:

- small/zero radius → sharper, technical, editorial, severe
- medium radius → neutral contemporary
- highly rounded → soft, approachable, consumer-friendly

The best radius is the one congruent with brand, content density and component function.

## 13.4 Containers

Use containers when they clarify grouping.

Don't make every section a card. Excessive cards create:

- fragmentation
- nested boxes
- visual noise
- reduced editorial flow

Use whitespace before borders when enough.

---

# 14. Brand positioning and visual congruence

Design should express **who the brand is for and what kind of value it promises**.

## 14.1 Start with positioning, not moodboard

Define:

```yaml
category:
audience:
primary_value:
price_position:
brand_traits:
desired_emotion:
proof_style:
competitive_visual_codes:
codes_to_use:
codes_to_break:
```

Then translate into design choices.

## 14.2 Category codes

Every category has visual conventions.

Examples:

- banking: blue, grids, restrained confidence
- sustainability: greens, natural textures
- luxury: restraint, whitespace, high craft
- developer tools: monospace/code cues, dark surfaces
- wellness: soft palettes, human/natural imagery

These codes aid recognition, but overuse creates sameness.

### Strategy

```text
Enough category familiarity to be understood
+ enough distinctive assets to be remembered
```

This is the same prototypicality/distinctiveness tension seen in rapid aesthetic processing [PSY04].

## 14.3 Distinctive brand assets

Distinctive assets reduce the effort required to identify who the communication comes from.

Potential assets include:

- logo/logotype
- packaging/product shape
- character/mascot
- color combination
- sonic cue
- slogan/verbal device
- recurring image grammar
- typography treatment

But asset types are not equally easy to “own”. A 2020 academic dataset covering 1,281 in-market assets across 13 categories and 19 countries found characters, logos and logotypes had stronger uniqueness potential than color alone [BRD02]. A larger 2026 benchmark of 1,162 assets across 21 categories, four countries and nine years found shape-based assets such as logos and packaging strongest on average (40% Fame, 71% Uniqueness), while color-only assets were weakest in that dataset (12% Fame, 39% Uniqueness) [BRD04].

### V2 rule

**Build a portfolio of assets; do not bet the identity on one generic hue.**

And do not trust internal intuition alone. A 2025/26 study comparing marketer judgments with consumer data across 405 brand elements found marketers were often inaccurate — typically overestimating fame and underestimating uniqueness [BRD05].

Therefore:

```text
DESIGN the asset
→ USE it consistently
→ MEASURE fame + uniqueness with consumers
→ PROTECT strong assets
→ RETIRE/change only with evidence
```

## 14.4 Consistency vs sameness

Consistency means stable principles.

Sameness means identical execution.

A strong system can be flexible while preserving:

- recognizable typography
- brand cues
- spacing rhythm
- visual tone
- color logic
- image grammar

## 14.5 Brand congruence

Research on font appropriateness and shape–typeface congruence suggests coherent symbolic cues can influence choice, credibility, aesthetics and expected price [TYP01][TYP05].

### Congruence audit

Ask:

- Does the typography tell the same story as the photography?
- Does the shape language support the brand trait?
- Does the color palette support the category/position?
- Does copy tone fit the visual sophistication?
- Does production quality fit price positioning?

## 14.6 Deliberate incongruence

Sometimes breaking a category code is strategically valuable.

Use when:

- category is visually homogeneous
- brand genuinely offers a different experience
- contrast can be understood quickly

Don't break conventions that people need for usability or comprehension merely to look original.

---

# 15. Trust and credibility design

Trust is not a visual style. But visual design can create or destroy the conditions for trust.

## 15.1 Aesthetics, credibility and actual performance

The old shorthand “what is beautiful is usable” is directionally useful but scientifically too simple.

Visual aesthetics can improve first impressions and perceived credibility [TRUST01]. More importantly, a preregistered 2026 meta-analysis of 31 studies (234 effect sizes; 18,794 participants) found a **small-to-medium positive average effect** of attractive interface aesthetics on objective user performance (`g = 0.29`) [HCI01].

But the same meta-analysis found very high heterogeneity (`I² ≈ 90%`) and a wide prediction interval that included negative effects. Earlier experimental work has also found reverse pathways, where poor usability lowers perceived aesthetics [HCI02].

### Interpretation

Aesthetics is not superficial, but neither is it a substitute for usability.

Use aesthetics to support:

- orientation
- confidence
- positive affect
- perceived care/craft
- willingness to engage

Then verify that actual task performance, comprehension and accessibility remain strong.

## 15.2 Trust cues

Use only real cues:

- recognizable client/customer logos with permission
- genuine reviews
- certifications
- transparent pricing/policies
- named authors/experts
- source citations
- physical address/company details where relevant
- security/payment cues at point of need
- guarantees with actual terms

Stanford's web-credibility research program similarly emphasized verifiability, real organization/person cues, expertise, contactability and professional presentation as contributors to perceived credibility [TRUST02]. Treat that work as a useful trust-mechanism reference, not a timeless visual recipe: interface conventions have evolved substantially since the original program.

Avoid “trust badge wallpaper”.

## 15.3 Reviews/social proof

A 2024 meta-analysis covering 156 studies / 69,006 observations found online review variables meaningfully influence purchase intention, with review valence especially strong and effects moderated by context/culture [TRUST03].

### Strong review design

Include enough context:

- who
- what product/service
- what outcome
- when
- source/verification where appropriate

A wall of anonymous 5-star cards is visually impressive but evidentially weak.

## 15.4 Error-free craft

Trust erodes through:

- typos
- inconsistent spacing
- broken images
- misaligned grids
- low-resolution assets
- fake urgency
- inconsistent pricing
- inaccessible UI

Jony Ive's “craft/care” philosophy aligns with this practical truth: people infer care from details, even if philosophy is not causal evidence [PHI01].

---

# 16. Copy and visual integration

Words are part of design.

## 16.1 Visual hierarchy must match message hierarchy

If the most visually prominent line is not the most important idea, the design creates cognitive conflict.

### Map

```text
Primary message → strongest type/placement
Proof → secondary
Detail → tertiary
Action → clear salience
```

## 16.2 Information density

Don't solve weak copy with smaller text.

Edit:

- remove redundancy
- replace jargon
- shorten labels
- split complex concepts
- use visual evidence

before reducing readability.

## 16.3 Specificity beats decorative language

In conversion contexts:

Weak:

> Transform your future.

Stronger:

> Cut weekly reporting from 6 hours to 45 minutes.

The design can then amplify a concrete value instead of trying to make vague copy feel meaningful.

## 16.4 Text on image

Ensure:

- sufficient contrast
- stable quiet area
- mobile crop survival
- no important text over faces/details
- readable size

If the image is too busy, create a gradient/surface rather than relying on outline/shadow hacks.

---

# 17. Persuasion and conversion design

Design cannot create value that does not exist, but it can reduce or increase friction in perceiving that value.

## 17.1 Persuasion sequence

A robust commercial artifact often supports:

```text
RELEVANCE
→ VALUE
→ BELIEVABILITY
→ RISK REDUCTION
→ ACTION
```

The design should visually support that order.

## 17.2 CTA prominence

A primary CTA needs:

- clear label
- sufficient size
- contrast
- adequate whitespace
- predictable affordance
- location after enough motivation/information

### No universal hue

Button color effects are confounded by surrounding palette. Contrast/salience is the more defensible principle [CTA01].

## 17.3 Primary and secondary actions

Apple recommends limiting simultaneously prominent buttons, and choice research shows overload depends on decision complexity, uncertainty and goal — not merely option count [OFF06][CHOICE01][CHOICE02].

### Standard

- one dominant action at a decision point
- secondary actions visually subordinate
- more choices allowed when comparison itself is the task

## 17.4 Friction

Reduce:

- unnecessary fields
- unclear steps
- ambiguous labels
- unexpected navigation
- hidden costs
- visual distraction near conversion

Don't remove information needed for confidence simply to shorten the screen.

## 17.5 Urgency/scarcity

Scarcity is not merely a dark-pattern trick; **real scarcity can influence purchase intention**. A meta-analysis of 131 studies / 416 effect sizes found positive average scarcity effects with important moderators: demand-, supply- and time-based scarcity worked differently across product type, involvement and consumption context [SCARC01].

The design standard is therefore:

### Legitimate

- “Only 3 left” when inventory truly is 3
- a real deadline
- actual limited capacity
- genuine event/launch window

### Illegitimate

- fake countdowns
- resetting timers
- invented “20 people viewing” indicators
- false stock pressure

Design should make **real constraints clear**, not manufacture false anxiety. Short-term click pressure that destroys trust is not good conversion design.

## 17.6 Visual proof

Strong proof can be:

- demonstration
- before/after when truthful/comparable
- quantified case
- review
- real interface/product
- benchmark
- third-party evidence

Make proof easy to connect to the claim it supports.

---

# 18. Choice architecture

“Fewer choices convert better” is not universally true.

A 2010 meta-analysis found near-zero mean choice-overload effect with large heterogeneity [CHOICE02]. A later meta-analysis identified conditions that make overload more likely: high complexity, task difficulty, preference uncertainty and effort-minimizing goals [CHOICE01].

## 18.1 Reduce choice when

- audience is uncertain
- options are hard to compare
- decision is high-friction
- user wants a quick recommendation
- differences are small

## 18.2 Preserve choice when

- audience is expert
- comparison is expected
- preferences vary strongly
- options are easily categorized
- filtering is strong

## 18.3 Design implication

The target is not minimum choice.

It is **minimum decision difficulty**.

Use:

- recommended/default option
- clear comparison dimensions
- progressive disclosure
- filters
- grouping
- explanation of differences

---

# 19. Motion, video and temporal design

Static composition controls space. Video controls space **and time**.

## 19.1 Temporal hierarchy

A video must decide:

- what appears first
- how long it remains
- what changes
- where attention moves
- what the viewer needs to remember

## 19.2 Opening

The first seconds need to establish enough of:

- relevance
- subject
- tension/question
- visual interest

for the intended audience to continue.

Avoid long decorative brand intros before value.

## 19.3 Motion with purpose

Motion is strongest when it communicates:

- transformation
- causality
- navigation/state
- direction
- scale
- sequence
- demonstration

Weak motion is movement whose only job is “look modern”.

## 19.4 Pace

Fast pacing increases stimulation but can lower comprehension.

Slow pacing can communicate:

- confidence
- premium character
- emotional weight

but risks abandonment when information value is low.

Match pace to:

- audience familiarity
- information complexity
- emotional goal
- platform viewing context

## 19.5 Audio + visual

Research on video advertising found audio-visual brand cues can elicit active attention and strengthen memory compared with visual cues alone in the studied context [VID01].

### Use sound for

- voice clarity
- emotional tone
- rhythm
- sonic branding
- event emphasis

### But design for silent comprehension where silence is common

- captions
- visible product/message
- visual story coherence

## 19.6 Music

Music changes arousal, pacing and interpretation.

Do not choose background music by “trending sound” alone. Research suggests tempo effectiveness can interact with message/regulatory focus [VID02].

## 19.7 Animation and accessibility

Respect reduced-motion preferences and provide control for distracting continuous motion [ACC03].

## 19.8 Brand linkage in video

Attention that does not link to the brand has limited commercial memory value.

Integrate brand through:

- product
- distinctive color/shape
- verbal name
- recurring sonic cue
- branded environment

rather than relying solely on end-card exposure.

---

# 20. Premium design principles

“Premium” is a perception, not a visual style preset.

It often emerges when the artifact communicates:

- confidence
- control
- scarcity of visual noise
- attention to detail
- high-quality materials/assets
- coherence
- intentionality
- reduced desperation to persuade

## 20.1 Restraint

Premium brands often use fewer competing signals because they can afford to let one strong object/message carry the frame.

Whitespace research supports that empty space can convey learned rhetorical meanings associated with prestige in some contexts [WSP01][WSP02].

But restraint works only when:

- content is strong
- production quality is high
- information needs are still met

## 20.2 Craft

Apple's current design principles include **Craft**: attention to details signals care and builds trust [OFF01].

Craft appears in:

- typography
- image quality
- alignment
- transitions
- copy
- performance
- spacing
- edge cases

Premium design is often the absence of small mistakes.

## 20.3 Simplicity ≠ minimalism

Apple's 2026 WWDC design principles explicitly state this distinction [OFF01].

Minimalism asks:

> How little can remain?

Simplicity asks:

> How little effort should the user need?

Sometimes a label, explanation or extra control makes a design visually less minimal but functionally simpler.

## 20.4 Jony Ive: effortless, coherent, inevitable

In Apple's “Designed by Apple in California” archive, Jony Ive described the aspiration to create objects that appear **effortless, simple, coherent and inevitable** [PHI01].

This is philosophy, not experimental evidence.

But it maps usefully onto evidence-backed principles:

| Ive aspiration | Evidence-based translation |
|---|---|
| Effortless | processing fluency, low friction [PSY01] |
| Simple | reduced irrelevant complexity [COG01][PSY04] |
| Coherent | Gestalt grouping + semantic congruence [PSY02][TYP05] |
| Inevitable | familiar mental models + internally consistent system [PSY04] |
| Care | craft, trust and error-free execution [TRUST01][OFF01] |

## 20.5 Dieter Rams

Rams' “as little design as possible” is also a design philosophy, not an empirical universal law [PHI02].

Useful interpretations:

- remove arbitrary styling
- make function legible
- avoid fashion dependence
- make details coherent
- do not over-promise through design

Do not turn Rams into “everything must be beige and minimal”.

## 20.6 Whitespace

Whitespace can communicate restraint, scarcity of information and visual confidence. In a 2025 chocolate-packaging experiment (`N = 1,193`), larger whitespace increased perceived luxury, while typeface/texture effects interacted with quality judgments [LUX01].

### Correct takeaway

Whitespace can be a premium cue when the category, content volume and brand promise support restraint.

### Wrong takeaway

“Luxury brands should maximize empty space.”

Too much whitespace can weaken information density, wayfinding, product understanding or perceived substance.

## 20.7 Black and white / monochrome

Black-and-white design can increase luxury evaluations in some settings. Three studies on luxury advertising found black-and-white treatments could enhance perceived luxuriousness/evaluation, especially with hedonic rather than utilitarian appeals [LUX02].

Again, the moderator is the point.

Monochrome may signal:

- distance
- timelessness
- editorial restraint
- seriousness
- nostalgia

But it can also suppress useful product information, accessibility or category cues.

**No universal “premium palette” exists.**

## 20.8 Detail density

Premium does not always mean sparse.

Examples:

- luxury watch page: detailed macro photography + refined specs
- institutional finance: dense data + immaculate hierarchy
- couture editorial: expressive imagery + restrained typography

The premium characteristic is **controlled complexity**, not emptiness.

---

# 21. Accessibility as a design-quality floor

Accessibility is not a separate “compliance layer”. It protects legibility, clarity and control.

## 21.1 Color contrast

WCAG and platform design systems specify minimum contrast thresholds for text/non-text contexts [ACC01][OFF04].

Practical web default:

- normal text: at least 4.5:1 for WCAG AA
- large text: at least 3:1
- important non-text graphical/UI distinctions: typically at least 3:1 where criterion applies

Meet the current WCAG specification for the exact medium/product.

## 21.2 Color independence

Don't communicate:

```text
red = error
blue = normal
```

without another cue.

Add:

- icon
- text
- shape
- pattern
- label

## 21.3 Target size

Interactive targets need sufficient size/spacing. WCAG 2.2 includes target-size requirements, and platform guidelines often recommend larger comfortable targets [ACC02].

## 21.4 Typography

Support:

- zoom/scaling
- readable body size
- adequate contrast
- spacing adaptation
- sufficient line height

Avoid critical information in tiny low-contrast captions.

## 21.5 Motion

Provide pause/stop/hide where required and respect reduced motion [ACC03].

Avoid:

- rapid flashes
- constant parallax interfering with reading
- essential information available only via animation

## 21.6 Alternative representation

Images carrying information need meaningful alternatives in accessible digital contexts.

Videos may require:

- captions
- transcripts
- audio description depending on content/context

## 21.7 Accessibility and aesthetics

Accessible design does not require bland design.

Constraints can improve the system by forcing:

- stronger hierarchy
- more robust contrast
- clearer states
- more thoughtful color roles
- semantic structure

---

# 22. Design systems and consistency

A design system is not primarily a Figma library.

It is a **set of reusable decisions**.

Google Material defines design systems as collections of reusable design decisions expressed as guidance, components and patterns [OFF04].

## 22.1 Tokenize decisions

Useful design primitives:

- color roles
- typography roles
- spacing scale
- radii
- shadows/depth
- icon grammar
- motion durations/easing
- layout grid
- image style

## 22.2 Semantic tokens > raw values

Prefer:

```text
text-primary
surface-muted
action-primary
status-error
```

rather than:

```text
#121212
#E9E9E9
#4B70FF
```

because semantic roles preserve meaning across themes and mediums.

## 22.3 Consistency reduces learning cost

If the same visual pattern means different things across an experience, people must relearn it.

Consistency matters for:

- interaction
- hierarchy
- state
- brand
- content structure

## 22.4 System flexibility

A system should allow:

- marketing expression
- editorial density
- product utility
- campaign variation

without losing identity.

Create **controlled ranges**, not one fixed layout.

---

# 23. Designing across media without becoming platform-specific

The artifact changes; the principles remain.

## 23.1 Static image

Primary constraints:

- one frame
- no interaction
- limited reading time

Prioritize:

- one dominant idea
- visual hierarchy
- brand recognition
- minimal copy
- crop at final size

## 23.2 Carousel / sequence

Primary opportunity:

- progressive disclosure

Each card/frame should:

- advance the argument
- offer a meaningful alternative
- create curiosity for next step

Do not split one weak idea into eight slides solely to create engagement.

## 23.3 Landing page / website

Primary opportunities:

- nonlinear scanning
- progressive depth
- interaction
- proof
- conversion

Prioritize:

- clear opening
- scannable hierarchy
- information scent
- trust
- action hierarchy

## 23.4 Social feed asset

Primary constraint:

- competitive attention environment

Prioritize:

- rapid relevance
- distinctive visual identity
- platform-compatible crop
- message comprehension without extensive context

## 23.5 Presentation

Primary constraint:

- speaker + screen compete/cooperate

Slides should not duplicate a spoken paragraph.

Use visual support for:

- structure
- data
- proof
- imagery
- memory

## 23.6 Video

Primary constraint:

- time

Design a temporal information hierarchy rather than a static page animated into existence.

## 23.7 SEO/editorial media

Primary constraint:

- users scan for answers

Use:

- meaningful headings
- readable body
- diagrams/tables
- strong source attribution
- restrained promotion

The visual design should improve information retrieval, not turn a reference asset into a campaign landing page.

---

# 24. Designing for concept, positioning and ICP

A design is “good” only relative to the intended audience and promise.

## 24.1 ICP dimensions that affect design

- category literacy
- age/access needs
- professional vs consumer
- risk sensitivity
- price sensitivity
- aspiration/status
- urgency
- device/context
- trust requirements
- visual culture

## 24.2 Expert audience

Can often tolerate:

- higher density
- technical typography
- data
- specialized language

But expertise is not an excuse for clutter.

## 24.3 Broad consumer audience

Usually benefits from:

- faster recognition
- fewer jargon terms
- clearer proof
- more context
- stronger action hierarchy

## 24.4 High-trust/high-risk categories

Finance, health, security, legal etc. generally require:

- restraint
- transparency
- proof
- traceable source identity
- fewer manipulative persuasion cues

## 24.5 Premium positioning

Often benefits from:

- disciplined restraint
- controlled pace
- high-quality material imagery
- confidence
- fewer hard-sell signals

## 24.6 Challenger/disruptor

Can break category codes in:

- color
- typography
- tone
- imagery

while retaining enough category comprehension to avoid becoming ambiguous.

## 24.7 Brand-design translation matrix

| Desired trait | Possible visual levers | Risk |
|---|---|---|
| Competent | structure, restrained color, precision, evidence | sterile/corporate |
| Human | people, warm materials, conversational type/copy | generic “friendly startup” |
| Premium | restraint, space, craft, controlled contrast | empty/aloof |
| Bold | high scale contrast, saturated accent, strong crop | aggressive/noisy |
| Technical | grids, mono accents, data, diagrams | cliché/hacker aesthetic |
| Natural | organic palette/forms, material imagery | greenwashing cliché |
| Playful | expressive color/shape/motion | low trust if category is high-risk |

These are hypothesis generators, not deterministic mappings.

---

# 25. Design decision tree

Use this sequence before styling.

## Step 1 — What is the task?

Choose one primary:

- notice
- understand
- compare
- trust
- remember
- feel
- act

Others can be secondary.

## Step 2 — What is the single most important message/object?

If there are three “most important” things, hierarchy is unresolved.

## Step 3 — What is the audience state?

- unaware
- exploring
- evaluating
- high intent
- expert
- returning customer

## Step 4 — What meaning should the brand convey?

Choose 2–4 traits, not 12.

## Step 5 — What category codes must be preserved?

Identify familiarity needed for comprehension/trust.

## Step 6 — What can be distinct?

Choose 1–3 owned or ownable cues.

## Step 7 — What information is essential?

Separate:

- essential
- supporting
- optional

## Step 8 — Build hierarchy before decoration

Use grayscale/wireframe first when helpful:

- scale
- placement
- spacing

Then layer:

- color
- image
- type personality
- texture
- motion

## Step 9 — Accessibility check

Before subjective aesthetic polish:

- contrast
- legibility
- target size
- motion
- color independence

## Step 10 — Congruence check

Does every major visual cue reinforce the intended meaning?

## Step 11 — Remove competition

What can be reduced by 20–50% in visual prominence?

## Step 12 — Test uncertainty

Test the uncertain **decision**, not random pixels.

---

# 26. Testing design scientifically

A design principle is a default. An execution is a hypothesis.

## 26.1 What to test first

High-value variables:

1. message/value proposition
2. visual concept
3. product/person/context imagery
4. proof strategy
5. hierarchy
6. action structure
7. format
8. micro styling

Avoid starting with button color if the whole concept is unvalidated.

## 26.2 Attention tests

Possible methods:

- eye tracking
- first-click
- five-second test
- recall
- visual saliency models as a heuristic

Attention tests answer:

> Did people see it?

not:

> Did it persuade them?

## 26.3 Comprehension tests

Ask:

- What is this?
- What is being offered?
- Who is it for?
- What should you do next?

## 26.4 Brand tests

Measure:

- unaided brand recognition
- asset recognition
- intended personality associations
- premium/trust perceptions
- competitor confusion

## 26.5 Conversion tests

Use controlled A/B testing for material decisions where volume allows.

Predefine:

```yaml
hypothesis:
primary_metric:
expected_mechanism:
minimum_material_effect:
stopping_rule:
segments:
```

## 26.6 Qualitative + quantitative

A/B testing tells you **which** performs better.

User research can help explain **why**.

Use both.

---

# 27. Design quality scorecard

Score 1–5 for each dimension.

| Dimension | Question |
|---|---|
| Purpose | Is the artifact's job obvious? |
| Focal point | Is the most important thing visually dominant? |
| Hierarchy | Is sequence clear? |
| Comprehension | Can audience understand quickly? |
| Relevance | Does it speak to intended audience/state? |
| Congruence | Do visual cues tell same brand/message story? |
| Legibility | Is text readable at final size/context? |
| Accessibility | Contrast, color, targets, motion robust? |
| Trust | Does design support credibility without fake cues? |
| Distinctiveness | Could this be recognized without logo? |
| Craft | Are details precise? |
| Restraint | Is anything competing unnecessarily? |
| Emotional fit | Does it evoke the intended emotional tone? |
| Action clarity | Is next step obvious where required? |
| Medium fit | Does it work in the actual viewing environment? |

Do not collapse the score into a fake universal “design quality” number. Use it to locate weaknesses.

---

# 28. Anti-playbook: what to actively avoid

## 28.1 “Make the logo bigger” as default

A bigger logo can increase brand visibility, but it can also:

- compete with product/value
- feel insecure/promotional
- reduce usable hierarchy

Brand integration > logo dominance.

## 28.2 Every element shouting

Symptoms:

- bold everywhere
- bright colors everywhere
- shadows everywhere
- huge text everywhere
- animation everywhere

Result: no hierarchy.

**Rule:** emphasis requires something else to be quiet.

## 28.3 Red always converts

False as universal rule.

Hue does not act independently from context. Test salience/contrast and action clarity [CTA01].

## 28.4 Blue always means trust

Overgeneralized.

Color associations exist, but category, tone/chroma, culture and execution moderate them [CLR01][CLR03].

## 28.5 Green means sustainable

It can cue nature/sustainability, but mechanically using green can make weak sustainability claims look like greenwashing.

Meaning requires evidence + visual congruence.

## 28.6 Golden ratio worship

No universal automatic aesthetic preference is established [CMP01].

Use φ if it generates a good system. Do not retrofit designs to satisfy it.

## 28.7 Rule of thirds worship

Use as a composition prompt, not a universal performance rule [CMP02].

## 28.8 60-30-10 as mathematics

The ratio is a heuristic. The principle is dominant/support/accent.

Don't measure screenshots to hit 60.0%.

## 28.9 F-pattern layout

F-pattern is an observed scan behavior, often in poorly formatted text, not a blueprint [SCAN01].

Good hierarchy can promote more effective layer-cake scanning [SCAN02].

## 28.10 Z-pattern “law”

There is no comparable evidence for a universal Z scan pattern.

Use if composition works; don't justify layout with pseudo-neuroscience.

## 28.11 Serif = luxury / sans = modern

Too crude.

Typeface meaning depends on the specific form, history and congruence [TYP01][TYP05]. Controlled reading research also fails to support a universal serif/sans legibility winner when size/layout are controlled [TYP03][TYP04][TYP07].

## 28.12 Tiny type = premium

Small/light text can signal restraint in a mockup while failing in real use.

Premium that cannot be read is bad design.

## 28.13 Low contrast = sophisticated

A muted palette can be elegant; inadequate text contrast is an accessibility/usability failure.

## 28.14 All-caps body copy

Use caps as a short label/display device, not long reading default.

## 28.15 Too many fonts

More fonts rarely create more sophistication. They usually weaken coherence [OFF02].

## 28.16 Decorative motion

If movement does not explain, direct, reveal or delight without interfering, remove it.

## 28.17 Parallax everywhere

Can add depth but can impair reading, performance and comfort. It is an effect, not a design principle.

## 28.18 Generic stock people

If the person communicates no real context, identity, proof, scale or emotion, the face may be pure distraction.

## 28.19 Face looking away from the message

Gaze cues can move attention. If the product/copy matters, orient the scene deliberately [FACE01].

## 28.20 Busy background = attention

Complex backgrounds can attract attention **to the background**, reducing product processing [IMG02].

## 28.21 White background always sells products better

Not universal. Contextually fitting backgrounds can improve mental imagery for experience products [IMG01].

## 28.22 More whitespace always = premium

Contextual effect, not law. A 2025 `N=1,193` packaging experiment supports a luxury effect for larger whitespace in that context, not a universal premium formula [LUX01].

## 28.23 Dark mode = premium

Dark palettes can cue drama/sophistication, but can also reduce readability, create glare/halation issues or feel generic.

## 28.24 Black + gold = luxury

A category cliché, not a premium guarantee.

## 28.25 Glassmorphism / trend effects as identity

A trend can be a surface treatment. If it becomes the only identity asset, it dates quickly.

## 28.26 Minimalism that hides functionality

Apple explicitly distinguishes simplicity from minimalism [OFF01].

Hiding controls in the name of clean visuals can make the experience harder.

## 28.27 Icons without labels everywhere

Use unlabeled icons only where meaning is highly conventional and accessible. Novel icons create interpretation cost.

## 28.28 Cards for everything

Cards are grouping devices. Overuse fragments information.

## 28.29 Multiple equally primary CTAs

Creates decision conflict. Use hierarchy even when multiple actions are legitimate.

## 28.30 “Fewer choices always convert better”

Choice-overload effects are context-dependent [CHOICE01][CHOICE02]. Optimize decision difficulty.

## 28.31 Trust badge wallpaper

Ten badges do not equal trust. Place the strongest relevant evidence where doubt occurs.

## 28.32 Fake scarcity / fake counters

Do not confuse **scarcity** with **fake scarcity**. A meta-analysis across 131 studies finds real scarcity cues can increase purchase intention with strong moderators [SCARC01]. The anti-pattern is inventing the constraint: resetting countdowns, fake stock numbers or fabricated social pressure. Real scarcity may persuade; fake scarcity is deception.

## 28.33 Decorative data visualization

Charts must make data easier to understand, not merely make slides look analytical.

## 28.34 3D/depth for no reason

Depth should establish hierarchy/spatial relationship. Apple warns overuse can add complexity [OFF07].

## 28.35 Brand color on everything

Overuse dilutes brand-color impact and removes hierarchy [OFF03].

## 28.36 Copy made tiny to fit design

Edit or restructure. Do not sacrifice legibility to protect an arbitrary layout.

## 28.37 “Above the fold contains everything”

Top-of-frame content matters, but cramming all proof/actions above the fold increases complexity.

Use the opening to establish sufficient relevance and information scent to continue.

## 28.38 Attention = conversion

False.

Shock, motion, faces, taboo and unusual styling can increase visual attention without improving brand memory, trust or purchase [ATT01][FACE03].

## 28.39 “Beautiful means usable”

Too simplistic.

Aesthetics has a positive average relationship with objective performance in a 2026 meta-analysis, but effects vary enormously by study/context [HCI01]. Some experimental work shows the reverse path too: bad usability can reduce perceived aesthetics [HCI02].

Design for beauty **and** performance; do not use one as evidence for the other.

## 28.40 A/B test every pixel

Test meaningful hypotheses. Micro-tests without strategic relevance waste traffic and create false certainty.

## 28.41 Copy competitors because they “must have tested it”

You do not know:

- their objective
- their audience
- their performance
- their constraints

Learn patterns, not artifacts.

---

# 29. Contradiction ledger

| Debate | Evidence-based conclusion |
|---|---|
| Minimalism vs information | Simplicity means reduced friction, not minimum content. Enough information must remain [OFF01]. |
| Low complexity vs rich design | High complexity often hurts first impression; moderate complexity can outperform extremes in some tasks [PSY04][CMPX01]. |
| Familiar vs novel | Both can increase preference under conditions. MAYA and mere-exposure evidence support a balance/optimum rather than maximum novelty or maximum familiarity [NOV01][MEM01]. |
| Symmetry vs asymmetry | Both can work. Symmetry stabilizes; asymmetry can create movement. No universal winner. |
| Golden ratio vs free composition | Golden ratio is an optional heuristic; universal preference unsupported [CMP01]. |
| Rule of thirds vs centered subject | Treat thirds as an option generator; empirical image analysis found only a minor role in large sets of high-quality photos/paintings [CMP02]. |
| More whitespace vs less | Whitespace structures and can signal premium, but too much can reduce information density or feel empty [WSP01][LUX01]. |
| Serif vs sans | Specific font design/context dominates; no universal legibility winner [TYP03][TYP04]. |
| Big type vs small type | Size is hierarchy/legibility tool, not aesthetic ideology. |
| Red CTA vs green CTA | No universal winner; local contrast/salience and copy matter [CTA01]. |
| More color vs restrained palette | More expressive color can aid hierarchy/brand; too many competing colors weaken semantics [OFF04]. |
| Human face vs product-only | Faces can attract social attention; use when they support context/gaze/proof. They can also distract from the product or message [FACE01]. |
| White product background vs lifestyle | Isolated imagery aids inspection; fitting context aids mental imagery for some products [IMG01]. |
| Static vs animation | Motion captures attention and explains temporal change; unnecessary motion distracts/accessibility [ACC03]. |
| One CTA vs multiple | One visually dominant action often helps; multiple options are valid when decision task requires them [CHOICE01]. |
| Dense vs sparse page | Match expertise/task. Control complexity; don't assume sparse = better. |
| Strong brand presence vs content-first | Brand must be linked to value without overwhelming content. |
| Consistency vs novelty | Consistency builds recognition; novelty renews attention. Preserve brand assets while varying executions [BRD02]. |
| Aesthetic vs usability | Aesthetics shows a small-to-medium positive average effect on objective performance, but with extreme heterogeneity; usability can also influence perceived aesthetics. Treat them as interacting, not interchangeable [HCI01][HCI02]. |
| Premium vs approachable | Some premium cues (angularity, whitespace, B&W) work through distance/restraint in specific studies; each has moderators. Decide whether psychological distance actually supports the category and customer goal [SHP02][LUX01][LUX02]. |
| Direct gaze vs averted gaze | Direct gaze captures face attention; gaze toward product/copy can transfer attention [FACE01][FACE02]. |

---

# 30. Heuristics: useful but not laws

## 30.1 60-30-10

Use when it helps create dominant/support/accent hierarchy.

No strong peer-reviewed support was identified in the V2 research pass for **the exact percentages** as a universal optimum.

Evidence class: `HEURISTIC / exact ratio unsupported`.

## 30.2 Rule of thirds

Use to generate asymmetrical composition and text space. Do not assume thirds-placement improves beauty or conversion.

Evidence class: `HEURISTIC / WEAK-MIXED EMPIRICAL`.

## 30.3 Golden ratio

Use for proportional exploration.

Evidence class: `HEURISTIC / UNIVERSAL CLAIM REJECTED`.

## 30.4 8-point spacing grids

Useful system convention for consistency and implementation.

Not a human-perception law.

## 30.5 50–75 character line length

Practical editorial/web-reading heuristic for many Latin-script text contexts.

Not a universal scientifically optimal interval; type size, font, device, language and reading task all change comfortable measure.

## 30.6 One primary CTA

Useful decision-hierarchy heuristic.

Not “only one button allowed”.

## 30.7 Three levels of hierarchy

Useful simplification tool.

Not a requirement that every artifact have exactly three levels.

## 30.8 “Squint test”

Blur/squint at design. If focal point disappears, hierarchy may be weak.

Useful designer test, not scientific measurement.

## 30.9 Grayscale test

Remove hue. If hierarchy collapses, design may rely too much on color.

Especially useful for accessibility and value contrast.

---

# 31. Practical design workflows

## 31.1 Concept-to-design brief

```yaml
artifact:
medium:
business_goal:
primary_user_action:
audience:
audience_state:
primary_message:
secondary_message:
proof:
brand_traits:
emotion_to_create:
category_codes:
distinctive_assets:
primary_focal_point:
visual_concept:
image_job:
type_job:
color_job:
motion_job:
accessibility_constraints:
measurement_plan:
```

## 31.2 Color brief

```yaml
brand_meaning:
primary_hue:
primary_reason:
primary_tone_range:
secondary_palette:
neutral_surfaces:
accent_role:
semantic_colors:
local_contrast_checks:
cultural_risk:
competitor_palette_overlap:
```

## 31.3 Typography brief

```yaml
body_typeface:
display_typeface:
reason_for_fit:
body_size_range:
heading_scale:
weights:
line_height:
measure_target:
small_text_rules:
accessibility_notes:
brand_semantics:
```

## 31.4 Image brief

```yaml
image_job:
subject:
context:
human_presence:
gaze_direction:
framing:
depth_of_field:
background_complexity:
lighting:
emotional_tone:
brand_cues:
text_safe_area:
crop_variants:
authenticity_requirements:
rights:
```

## 31.5 Video brief

```yaml
viewer_context:
first_2_seconds:
core_story:
visual_hook:
brand_linkage:
product_visibility:
audio_role:
silent_comprehension:
pace:
key_moments:
cta:
end_state:
reduced_motion_alternative_if_needed:
```

## 31.6 Landing-page visual brief

```yaml
hero_goal:
hero_focal_point:
value_proposition:
primary_action:
secondary_action:
proof_sequence:
visual_evidence:
information_hierarchy:
trust_moments:
comparison_need:
long_form_reading_need:
brand_expression_level:
```

---

# 32. Review checklists

## 32.1 Five-second check

After five seconds can a viewer answer:

- What is this?
- Who is it for?
- What matters most?
- How does it make me feel?
- What brand/product is it?

Not every artifact needs all five, but failure should be intentional.

## 32.2 Hierarchy check

- [ ] One primary focal point
- [ ] Supporting elements clearly subordinate
- [ ] Important content not hidden by decorative salience
- [ ] CTA hierarchy clear
- [ ] Alignment intentional
- [ ] Spacing groups related content

## 32.3 Color check

- [ ] Palette supports desired brand meaning
- [ ] Accent is scarce enough to mean something
- [ ] Contrast passes accessibility
- [ ] Color is not sole semantic indicator
- [ ] Dark/light contexts considered
- [ ] No accidental competitor mimicry

## 32.4 Typography check

- [ ] Body text readable at actual output size
- [ ] No ultra-light small copy
- [ ] Hierarchy visible without extra fonts
- [ ] Typeface semantics fit brand/category
- [ ] Line length/height comfortable
- [ ] Important text survives mobile/small output

## 32.5 Image check

- [ ] Image has a job
- [ ] Subject is clear
- [ ] Background doesn't steal attention
- [ ] Crop works at final aspect ratio
- [ ] Human presence is meaningful
- [ ] Gaze supports visual path if relevant
- [ ] Image and message are congruent
- [ ] Authenticity/rights are valid

## 32.6 Premium check

- [ ] Visual restraint is intentional
- [ ] Whitespace supports hierarchy
- [ ] Asset quality is high
- [ ] No cheap effects used as luxury shorthand
- [ ] Details are aligned/consistent
- [ ] Copy tone fits price positioning
- [ ] Usability not sacrificed for minimalism

## 32.7 Conversion check

- [ ] Value visible before action request
- [ ] Primary action easy to identify
- [ ] CTA label specific
- [ ] Secondary actions subordinate
- [ ] Proof near relevant uncertainty
- [ ] No fake scarcity/trust cues
- [ ] Decision complexity appropriate

## 32.8 Accessibility check

- [ ] Color contrast
- [ ] Non-color status cues
- [ ] Target sizes
- [ ] Text scaling
- [ ] Motion controls
- [ ] Alt text/captions where required
- [ ] Focus/keyboard semantics for interactive media

---

# 33. One-page golden standard

If only one page of this playbook may be used:

1. **Start with the task and audience, not the visual style.**
2. **Choose one primary focal point.**
3. **Make visual hierarchy reflect message hierarchy.**
4. **Use salience to direct attention toward value, not decoration.**
5. **Reduce irrelevant complexity; preserve useful information.**
6. **Balance familiarity and novelty: familiar structure reduces interpretation cost; distinctive assets create memory.**
7. **Group related things with proximity/similarity/common region.**
8. **Use whitespace to structure, separate and focus.**
9. **Treat 60-30-10, golden ratio and rule of thirds as heuristics, never laws.**
10. **Build color around roles: surface, text, accent, semantic state.**
11. **Hue associations are contextual; saturation/value and culture matter.**
12. **No universal CTA color exists; contrast and context matter.**
13. **Never rely on color alone for critical meaning.**
14. **Typography must be readable before it is expressive.**
15. **Serif/sans is a brand/context choice, not a universal readability rule.**
16. **Use typeface semantics that fit positioning and category.**
17. **Use few typefaces and clear scale/weight hierarchy.**
18. **Every image needs a job: product, use, emotion, proof, identity or explanation.**
19. **Contextual imagery can improve mental imagery when the context actually fits.**
20. **Faces can attract social attention; gaze can redirect it, but the face can also compete with the intended focal point — use deliberately.**
21. **Shapes carry associations; treat them as cues, not deterministic psychology.**
22. **Keep visual, verbal and brand cues semantically congruent unless breaking congruence is deliberate.**
23. **Build stable distinctive brand assets rather than redesigning identity every campaign.**
24. **Craft and aesthetics can improve confidence and even average task performance, but never substitute for actual usability or proof.**
25. **Measure brand assets with consumers; internal teams frequently misjudge what is actually distinctive.**
26. **Primary action should be visually dominant at decision moments.**
27. **Optimize decision difficulty, not raw number of choices.**
28. **Motion should explain, direct or narrate — not merely move.**
29. **Design video as a temporal hierarchy, not a static layout with animation.**
30. **Use sound to reinforce meaning/brand; preserve comprehension without sound where relevant.**
31. **Premium = restraint + coherence + craft + fit, not black/serif/whitespace recipes.**
32. **Simplicity is reduced friction, not maximum minimalism.**
33. **Accessibility is a quality floor, not a late compliance task.**
34. **Design systems should encode reusable decisions, not just components.**
35. **Adapt execution to medium while preserving the same underlying hierarchy/brand principles.**
36. **Never optimize attention without checking comprehension, trust, memory and action.**
37. **Use qualitative research to explain behavior and controlled experiments to validate material uncertainty.**
38. **Do not A/B test random pixels before message, concept and hierarchy are right.**
39. **For quantitative graphics, prefer perceptual encodings that make the needed comparison accurate; use color/area for overview, not false precision.**
40. **For icons, optimize search salience and semantic familiarity before decorative novelty.**
41. **Remove anything that has no information, emotion, trust, brand or action role.**
42. **Aim for design that feels intentional enough that there is no obvious arbitrary alternative.**

---

# 34. Memory, familiarity and distinctiveness

Design that performs once but leaves no brand linkage creates weak long-term value.

## 34.1 Familiarity helps — until it does not

Processing fluency and mere exposure both support a role for familiarity, but neither implies “repeat forever”. A meta-analysis of 81 articles / 268 exposure curves found the mere-exposure effect generally follows a positive slope with a negative quadratic component — an **inverted-U** pattern rather than unlimited liking growth [MEM01].

So:

```text
too novel → interpretation cost / uncertainty
semi-familiar → fluent + interesting
too familiar → habituation / wearout / invisibility
```

This aligns with the “Most Advanced Yet Acceptable” (MAYA) product-design research: typicality and novelty can both contribute to preference, even though they oppose one another perceptually [NOV01].

## 34.2 Familiar structure, distinctive identity

A durable pattern is:

- familiar navigation / interaction / information logic
- distinctive brand surface and cues

Example:

A checkout should not reinvent what “Pay” means, but the brand can still feel unmistakable through type, image grammar, shape, color combinations, motion, sound or language.

## 34.3 Repeat assets, vary executions

Repeat:

- distinctive assets
- core promise
- recognizable visual grammar
- sonic/verbal cues

Vary:

- scenes
- headlines
- composition
- examples
- formats

The objective is **memory reinforcement without creative habituation**.

## 34.4 Distinctive asset portfolio

Current evidence is stronger than V1 assumed. In a 2026 benchmark of 1,162 assets across 21 categories, shape-based assets such as logos and packaging were strongest on average, while color assets were weakest in that dataset [BRD04]. Earlier 19-country work similarly found logos/logotypes/characters easier to uniquely own than color alone [BRD02].

This does not mean “never own a color”. It means colors are heavily shared category resources and often require combinations/context to become uniquely diagnostic.

## 34.5 Test memory with consumers

Do not call an asset distinctive because the brand team recognizes it.

Measure:

- unaided brand attribution
- fame / proportion associating asset with the brand
- uniqueness / competitor confusion
- recognition over time
- performance without logo/name

Marketers have been shown to misestimate these properties, supporting consumer measurement rather than internal intuition [BRD05].

# 35. Designing emotional response

Emotion is not a color swatch. It emerges from the combination of:

- subject
- narrative
- color
- light
- pace
- music
- typography
- space
- facial expression
- language
- category expectations

## 35.1 Define the intended emotion

Avoid vague goals like:

> “Make it emotional.”

Choose:

- confidence
- relief
- urgency
- delight
- aspiration
- curiosity
- calm
- belonging
- excitement
- seriousness

Then decide whether that emotion actually helps the task.

## 35.2 Arousal vs valence

A useful conceptual model:

- **valence:** positive ↔ negative
- **arousal:** calm ↔ activated

Design choices can shift both.

These dimensions are more defensible than one-to-one color psychology. A 2025 systematic review finds recurring color–emotion correspondences across cultures, but also emphasizes many-to-many relationships and the role of lightness/saturation/hue [CLR04].

Examples **as directional combinations, not formulas**:

### Positive + higher arousal

- more vivid/warm color treatment
- faster motion
- energetic sound/music
- expressive imagery

### Positive + lower arousal

- lower-arousal/cooler or lighter treatment where culturally appropriate
- greater spatial calm
- slower pace
- calm imagery

### Negative + high arousal

- warning semantics
- strong contrast
- culturally understood danger cues

The whole system determines interpretation. Never use one color as the emotional strategy.

## 35.3 Emotion and category fit

A cyber-security warning and a luxury watch ad can both use black, but the intended emotion differs completely.

The whole system determines interpretation.

## 35.4 Delight

Apple's design principles define delight as a human emotional outcome that should emerge after purpose, familiarity, flexibility, simplicity and craft are solved — not as random confetti [OFF01].

That is a useful priority order.

---

# 36. Data visualization and informational graphics

Data design should optimize **accurate comparison and interpretation**, not visual spectacle.

## 36.1 Prefer encodings humans judge accurately

Classic controlled graphical-perception research by Cleveland & McGill established an empirical ordering of elementary quantitative judgments [DV01]. For precise comparison, position along a common scale is generally easier/more accurate than less direct encodings such as area, volume or color intensity.

A practical hierarchy is:

```text
POSITION ON COMMON SCALE
→ POSITION ON NON-ALIGNED SCALE
→ LENGTH / DIRECTION / ANGLE
→ AREA
→ VOLUME / CURVATURE
→ COLOR SATURATION (for precise magnitude)
```

This is not a ban on pie charts/maps/heatmaps. It means **choose encoding according to the precision the decision requires**.

## 36.2 Position on common scale

Strong for accurate comparison.

Examples:

- bars with aligned baseline
- dot plots
- lines on shared axes

## 36.3 Area, volume and color

Useful for overview/pattern or when geography/category is the message; weaker for precise quantitative judgment.

If exact values matter, provide labels/table/tooltips or a more precise encoding.

## 36.4 Reduce non-informative decoration

Remove or justify:

- unnecessary 3D
- perspective that distorts magnitude
- decorative gradients that imply false quantitative variation
- redundant labels
- excessive gridlines

But do not remove context needed for honest interpretation.

## 36.5 Highlight with hierarchy

Default:

- supporting series quieter
- focal series emphasized

This applies the same salience principle as the rest of design — without changing the data itself.

## 36.6 Axes and honesty

Do not choose scales solely to dramatize a difference.

If an axis/truncation/transformation materially affects interpretation, disclose it. Quantitative graphics are persuasive artifacts and therefore carry a higher honesty burden.

## 36.7 Table vs chart

Use a table when exact lookup matters.

Use a chart when pattern/comparison matters.

Use both when the task needs overview + exact values.

# 37. Symbols and icons

Icons compress meaning only when people can **find** and **interpret** them.

## 37.1 Separate search salience from semantic recognition

2026 research strengthens a useful distinction:

- **salience** helps an icon get found faster in visual search
- **familiarity and semantic fit** help a person understand what it means
- **aesthetic appeal** is not the same as usability

One 2026 experiment found icon salience reduced visual search time/load, while familiarity improved semantic-recognition accuracy/speed [ICON02]. Another found the aesthetic-usability relationship for icons became very weak after controlling familiarity/concreteness, with style familiarity a stronger predictor of aesthetic appeal [ICON01].

## 37.2 Familiar icons

Common conventions can reduce interpretation cost:

- magnifying glass → search
- trash can → delete
- play triangle → play
- gear → settings

But convention is audience/context specific. “Universal icon” should be treated cautiously.

## 37.3 Novel/ambiguous icons

If meaning is not immediately obvious:

- add a text label
- teach through repeated consistent use
- test comprehension

Do not force users to decode visual cleverness to complete a task.

## 37.4 Concreteness vs abstraction

More concrete icons can help recognition in some tasks, but the relationship is moderated by familiarity and context [ICON01][ICON02]. Extremely literal pictograms can also become visually noisy.

Aim for the **least detail needed for reliable recognition**.

## 37.5 Icon-set coherence

Keep consistent:

- stroke weight
- fill/outline logic
- optical size
- corner character
- perspective
- visual density

Coherence reduces visual noise; it does not justify making functionally different icons indistinguishable.

## 37.6 Cultural meaning

Check symbols, gestures, directionality, animals/religious symbols and metaphors in international contexts.

# 38. Design debt and longevity

Evergreen design requires resisting short-term novelty addiction.

## 38.1 Trend vs principle

Trends:

- glass effects
- neo-brutalism
- gradients
- 3D blobs
- oversized type
- grain
- skeuomorphism

Principles:

- hierarchy
- contrast
- grouping
- legibility
- congruence
- accessibility
- distinctiveness

Trends can express the principles. They are not the principles.

Novelty can be useful, but novelty without recognizability raises interpretation cost. MAYA research provides a durable framing: designs can benefit from being **advanced enough to feel new, familiar enough to remain acceptable** [NOV01].

## 38.2 When to use trends

Use when:

- culturally relevant to audience
- congruent with brand
- replaceable without changing core identity
- not harmful to usability/accessibility

## 38.3 Timelessness

Timeless design is not absence of style.

It often means:

- fewer arbitrary effects
- durable proportions
- strong typography
- high-quality imagery
- stable brand assets
- clear functional logic

Rams' emphasis on longevity and “as little design as possible” is a useful philosophical reference here [PHI02].

---

---

# 39. Research evidence map

This appendix makes the playbook auditable. Each ID used in the body maps to one source or evidence family and records both the useful finding and its limitation. The map deliberately separates empirical evidence from official design systems, practitioner heuristics and design philosophy.

## Accessibility and official systems

### ACC01 — W3C WCAG 2.2 — Understanding Success Criteria
**URL:** https://www.w3.org/WAI/WCAG22/Understanding/  
**Evidence:** `WEB_STANDARD / ACCESSIBILITY`  
**Finding:** WCAG provides normative/interpretive guidance for contrast, use of color, text spacing, motion and other accessibility requirements that also protect clarity and legibility.  
**Limitation:** Accessibility compliance is not a persuasion formula; context and jurisdiction can impose additional requirements.  

### ACC02 — W3C WCAG 2.2 — Target Size (Minimum)
**URL:** https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum  
**Evidence:** `WEB_STANDARD / ACCESSIBILITY`  
**Finding:** WCAG 2.2 introduces a 24×24 CSS pixel minimum target-size criterion with documented exceptions/spacing alternatives.  
**Limitation:** It is a minimum accessibility criterion, not a recommendation that every control should be exactly 24 px.  

### ACC03 — W3C WCAG 2.2 — Pause, Stop, Hide
**URL:** https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide  
**Evidence:** `WEB_STANDARD / ACCESSIBILITY`  
**Finding:** Moving, blinking, scrolling or auto-updating information can require pause/stop/hide controls when it starts automatically and persists under defined conditions.  
**Limitation:** Does not mean all motion is bad; purposeful, controllable motion can aid comprehension.  

### OFF01 — Apple Human Interface Guidelines — Design principles
**URL:** https://developer.apple.com/design/human-interface-guidelines/design-principles  
**Evidence:** `OFFICIAL_DESIGN_SYSTEM / PRACTICE`  
**Finding:** Apple's reintroduced June 2026 principles frame design around purpose, agency, responsibility, familiarity, flexibility, simplicity, craft and delight; Apple explicitly states “simplicity isn't minimalism” and builds clarity through hierarchy, order, spacing and contrast.  
**Limitation:** Company design philosophy/guidance, not controlled causal evidence for marketing performance.  

### OFF02 — Apple Human Interface Guidelines — Typography
**URL:** https://developer.apple.com/design/human-interface-guidelines/typography  
**Evidence:** `OFFICIAL_DESIGN_SYSTEM / PRACTICE`  
**Finding:** Apple emphasizes legibility, readable sizing, hierarchy via weight/size/color and restraint in typeface usage.  
**Limitation:** Platform guidance; exact sizes/styles are not universal cross-media laws.  

### OFF03 — Apple Human Interface Guidelines — Color / Branding
**URL:** https://developer.apple.com/design/human-interface-guidelines/color  
**Evidence:** `OFFICIAL_DESIGN_SYSTEM / PRACTICE`  
**Finding:** Color should communicate hierarchy/state/brand, be used consistently, respect cultural meaning and never be the sole carrier of critical information.  
**Limitation:** Apple ecosystem guidance; brand/category contexts can justify different palette choices.  

### OFF04 — Google/Android Material — Color
**URL:** https://developer.android.com/design/ui/mobile/guides/styles/color  
**Evidence:** `OFFICIAL_DESIGN_SYSTEM / PRACTICE`  
**Finding:** Material uses role-based color, hue/chroma/tone and accents to express hierarchy, semantic state and emphasis rather than arbitrary color choice.  
**Limitation:** Interface-system guidance; not direct evidence that a given color improves marketing conversion.  

### OFF05 — IBM Carbon Design System — Typography
**URL:** https://carbondesignsystem.com/elements/typography/overview/  
**Evidence:** `OFFICIAL_DESIGN_SYSTEM / PRACTICE`  
**Finding:** Carbon defines constrained type roles/scale to create hierarchy, rhythm, legibility and consistency; expressive vs productive contexts can differ.  
**Limitation:** System-specific implementation guidance; not a universal typeface prescription.  

### OFF06 — Apple Human Interface Guidelines — Buttons
**URL:** https://developer.apple.com/design/human-interface-guidelines/buttons  
**Evidence:** `OFFICIAL_DESIGN_SYSTEM / PRACTICE`  
**Finding:** Prominent actions should be clear, sufficiently sized/spaced and limited enough that visual priority remains understandable.  
**Limitation:** UI-action guidance; physical/social ads without interactive controls require adaptation.  

### OFF07 — Apple Human Interface Guidelines — Materials
**URL:** https://developer.apple.com/design/human-interface-guidelines/materials  
**Evidence:** `OFFICIAL_DESIGN_SYSTEM / PRACTICE`  
**Finding:** Materials/depth can establish hierarchy and relationships but overuse can add complexity and reduce clarity.  
**Limitation:** Apple-specific rendering language; principle generalizes more than visual style.  

## Psychology, cognition and attention

### ATT01 — Geissler, Zinkhan & Watson — The Influence of Home Page Complexity on Consumer Attention, Attitudes, and Purchase Intent
**URL:** https://doi.org/10.1080/00913367.2006.10639232  
**Evidence:** `PEER_REVIEWED / EXPERIMENTAL_MARKETING`  
**Finding:** Website/homepage visual complexity shows non-linear effects; moderate complexity can balance stimulation and evaluation better than either extreme.  
**Limitation:** Historical web context and particular stimuli; do not infer one universal visual-complexity target.  

### CHOICE01 — Chernev, Böckenholt & Goodman — Choice Overload: A Conceptual Review and Meta-Analysis
**URL:** https://doi.org/10.1016/j.jcps.2014.08.002  
**Evidence:** `META_ANALYSIS / CONSUMER_PSYCHOLOGY`  
**Finding:** Choice overload is moderated by decision-task difficulty, preference uncertainty, choice-set complexity and decision goals.  
**Limitation:** Does not justify a fixed maximum number of choices.  

### CHOICE02 — Scheibehenne, Greifeneder & Todd — Can There Ever Be Too Many Options? A Meta-Analytic Review of Choice Overload
**URL:** https://doi.org/10.1086/651235  
**Evidence:** `META_ANALYSIS / CONSUMER_RESEARCH`  
**Finding:** Average choice-overload effect was near zero with substantial heterogeneity across contexts.  
**Limitation:** “More choices always hurt conversion” and “more choices never hurt” are both overclaims.  

### COG01 — Seductive details effect — systematic review/meta-analysis
**URL:** https://doi.org/10.1007/s10648-025-10099-z  
**Evidence:** `META_ANALYSIS / LEARNING_SCIENCE`  
**Finding:** Irrelevant but interesting details can impose extraneous cognitive load and modestly reduce learning/retention.  
**Limitation:** Marketing artifacts are not identical to instructional materials; decorative details can still serve brand/emotion when purposeful.  

### COG02 — The signaling principle in multimedia learning — meta-analysis
**URL:** https://www.sciencedirect.com/science/article/pii/S1747938X15000664  
**Evidence:** `META_ANALYSIS / LEARNING_SCIENCE`  
**Finding:** Visual/verbal cues that signal important information can improve retention/transfer and reduce cognitive burden.  
**Limitation:** Effects depend on content, audience and signal design; excessive highlighting can itself become noise.  

### PSY01 — Reber, Schwarz & Winkielman — Processing Fluency and Aesthetic Pleasure
**URL:** https://pubmed.ncbi.nlm.nih.gov/15582859/  
**Evidence:** `ACADEMIC_REVIEW / PSYCHOLOGY`  
**Finding:** Stimuli that are easier to process can feel more pleasant; contrast, symmetry, repetition and prototypicality can influence aesthetic response partly via fluency.  
**Limitation:** Fluency can conflict with novelty/distinctiveness; maximum familiarity is not always desirable.  

### PSY02 — Wagemans et al. — A Century of Gestalt Psychology in Visual Perception
**URL:** https://pmc.ncbi.nlm.nih.gov/articles/PMC3482144/  
**Evidence:** `SCIENTIFIC_REVIEW / PERCEPTION`  
**Finding:** Reviews grouping principles including proximity, similarity, closure, continuation, common fate, symmetry and related organization cues.  
**Limitation:** Gestalt principles predict perceptual organization, not guaranteed marketing outcomes.  

### PSY03 — Lindgaard et al. — Attention web designers: You have 50 milliseconds to make a good first impression!
**URL:** https://doi.org/10.1080/01449290500330448  
**Evidence:** `EXPERIMENTAL_HCI`  
**Finding:** Users formed rapid visual-appeal judgments at very short exposures, and ratings were relatively stable across longer exposures.  
**Limitation:** Aesthetic first impression is not identical to credibility, task success or conversion.  

### PSY04 — Tuch et al. — Visual complexity and prototypicality in first impressions of websites
**URL:** https://research.google/pubs/the-role-of-visual-complexity-and-prototypicality-regarding-first-impression-of-websites-working-towards-understanding-aesthetic-judgments/  
**Evidence:** `EXPERIMENTAL_HCI`  
**Finding:** Low visual complexity and high prototypicality were generally associated with more positive rapid aesthetic judgments in the experiments.  
**Limitation:** Does not imply every site should look generic/minimal; task/category and differentiation matter.  

### SCAN01 — Nielsen Norman Group — F-Shaped Pattern of Reading on the Web
**URL:** https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/  
**Evidence:** `EYE_TRACKING / UX_SYNTHESIS`  
**Finding:** F-shaped scanning is a common behavior on text-heavy/poorly formatted pages as users seek efficiency.  
**Limitation:** It is an observed behavior, not a recommended layout template; better formatting can change scanning.  

### SCAN02 — Nielsen Norman Group — Layer-Cake Pattern of Scanning
**URL:** https://www.nngroup.com/articles/layer-cake-pattern-scanning/  
**Evidence:** `EYE_TRACKING / UX_SYNTHESIS`  
**Finding:** Strong headings/subheadings support layer-cake scanning and help users locate relevant sections efficiently.  
**Limitation:** NN/g synthesis rather than randomized conversion evidence.  

### SCAN03 — Following the Eye-Tracking Evidence: Established Web-Search Assumptions Fail in Carousel Interfaces
**URL:** https://arxiv.org/abs/2604.21019  
**Evidence:** `ACADEMIC_PREPRINT / EYE_TRACKING`  
**Finding:** Classic vertical list/F-pattern assumptions did not transfer cleanly to horizontal carousel interfaces in the study.  
**Limitation:** Preprint and interface-specific; useful mainly to reject universal scan-pattern dogma.  

## Color, composition and whitespace

### CLR01 — Elliot & Maier — Color Psychology: Effects of Perceiving Color on Psychological Functioning in Humans
**URL:** https://www.annualreviews.org/content/journals/10.1146/annurev-psych-010213-115035  
**Evidence:** `ACADEMIC_REVIEW / PSYCHOLOGY`  
**Finding:** Color can influence affect, cognition and behavior, but effects depend heavily on context, meaning and boundary conditions.  
**Limitation:** Does not support fixed universal mappings such as “red converts” or “blue creates trust” in every setting.  

### CLR02 — Labrecque & Milne — Exciting red and competent blue: the importance of color in marketing
**URL:** https://doi.org/10.1007/s11747-010-0245-y  
**Evidence:** `PEER_REVIEWED / MARKETING_EXPERIMENTS`  
**Finding:** Hue, saturation and value can influence perceived brand personality and purchase-related judgments.  
**Limitation:** Associations are probabilistic/contextual and interact with category/brand positioning.  

### CLR03 — Jonauskaite et al. — Universal Patterns in Color-Emotion Associations Are Further Shaped by Linguistic and Geographic Proximity
**URL:** https://pubmed.ncbi.nlm.nih.gov/32900287/  
**Evidence:** `LARGE_CROSS_CULTURAL_STUDY`  
**Finding:** Across thousands of participants and many countries/languages, color-emotion associations show both shared patterns and systematic cultural/geographic variation.  
**Limitation:** No one-to-one global color dictionary; local meaning and culture remain relevant.  

### CLR05 — Adobe — Color theory / palette heuristics
**URL:** https://www.adobe.com/uk/creativecloud/design/discover/color-theory.html  
**Evidence:** `PRACTITIONER_EDUCATION / HEURISTIC`  
**Finding:** Complementary, analogous and proportional palette approaches such as 60-30-10 can be useful starting heuristics for creating hierarchy and balance.  
**Limitation:** Not controlled evidence for conversion or universal aesthetic superiority; use as a compositional scaffold.  

### CMP01 — Stieger & Swami — Time to let go? No automatic aesthetic preference for the golden ratio
**URL:** https://kris.kl.ac.at/en/publications/time-to-let-go-no-automatic-aesthetic-preference-for-the-golden-r/  
**Evidence:** `PEER_REVIEWED / EXPERIMENTAL_AESTHETICS`  
**Finding:** Experiments did not support a robust automatic universal preference for golden-ratio rectangles/compositions.  
**Limitation:** The ratio may still be a usable design heuristic; lack of universal preference does not prohibit its use.  

### CMP02 — Amirshahi et al. — Evaluating the Rule of Thirds in high-quality photographs
**URL:** https://doi.org/10.1163/22134913-00002024  
**Evidence:** `EMPIRICAL_COMPOSITION_RESEARCH`  
**Finding:** Rule-of-thirds alignment showed weak or inconsistent relationships with aesthetic quality in large/high-quality image sets.  
**Limitation:** Composition matters; this finding only rejects treating one grid rule as a universal law.  

### CMPX01 — Beyond visual clutter: the interplay among products, advertisements, and the overall webpage
**URL:** https://www.sciencedirect.com/org/science/article/pii/S2040712221000451  
**Evidence:** `TWO_EXPERIMENTS / EYE_TRACKING + ONLINE_EXPERIMENT`  
**Finding:** In the tested shopping-page context, overall webpage complexity showed inverted-U relationships with attitudes toward the page, products and advertisements; global complexity also spilled over to local evaluations.  
**Limitation:** Specific ecommerce/webpage context and student samples; it supports “complexity has nonlinear/contextual effects”, not a universal optimum.  

### WSP01 — Pracejus, O’Guinn & Olsen — How Nothing Became Something: White Space, Rhetoric, History, and Meaning
**URL:** https://academic.oup.com/jcr/article-abstract/33/1/82/1822622  
**Evidence:** `PEER_REVIEWED / CONSUMER_RESEARCH`  
**Finding:** Whitespace carries learned rhetorical/cultural meaning and can signal sophistication, restraint or status in certain contexts.  
**Limitation:** Meaning is historically/culturally conditioned; whitespace can also feel sparse or under-informative.  

### WSP02 — Pracejus, O’Guinn & Olsen — When white space is more than “burning money”
**URL:** https://www.sciencedirect.com/science/article/pii/S0167811613000396  
**Evidence:** `THREE_STUDIES / PEER_REVIEWED_MARKETING`  
**Finding:** White space communicates meaning in advertising, but the studies favored a culturally learned visual-rhetoric explanation over a simple universal “expensive ad space = quality” signal.  
**Limitation:** Meanings differed across cultures; white space is not a universal luxury, quality or conversion cue.  

## Typography, imagery, faces and shape

### FACE01 — Sajjacholapunt & Ball — The influence of banner gaze direction and face orientation on visual attention
**URL:** https://pmc.ncbi.nlm.nih.gov/articles/PMC3941030/  
**Evidence:** `EYE_TRACKING / ADVERTISING`  
**Finding:** Faces attract attention; gaze direction can redirect visual attention toward adjacent ad information.  
**Limitation:** Attention transfer does not guarantee persuasion or conversion.  

### FACE02 — Gaze cueing / joint-attention research in advertising/visual attention
**URL:** https://pmc.ncbi.nlm.nih.gov/articles/PMC5454066/  
**Evidence:** `EXPERIMENTAL_ATTENTION_RESEARCH`  
**Finding:** Observed gaze can cue attention toward looked-at objects/regions and influence processing.  
**Limitation:** Magnitude depends on stimulus/task; direct gaze can sometimes hold attention on the face instead.  

### FACE03 — Myers et al. — An eye-tracking study of attention to brand-identifying content and recall of taboo advertising
**URL:** https://www.sciencedirect.com/science/article/pii/S0148296319304795  
**Evidence:** `EYE_TRACKING / ADVERTISING`  
**Finding:** Attention to product/brand-identifying information related to recall; ad complexity moderated attention effects.  
**Limitation:** Taboo/shock advertising is a special context and should not be generalized as a recommended attention tactic.  

### IMG01 — Maier & Dost — Contextual backgrounds in product presentation
**URL:** https://www.sciencedirect.com/science/article/pii/S0969698918300547  
**Evidence:** `PEER_REVIEWED / RETAIL_MARKETING`  
**Finding:** Contextually fitting backgrounds can increase mental imagery, liking and purchase intentions for certain products.  
**Limitation:** Effects depend on product type, fit and background; contextual imagery is not always superior to clean product presentation.  

### IMG02 — Wang et al. — Effects of background complexity on consumer visual processing
**URL:** https://www.sciencedirect.com/science/article/pii/S0148296319304357  
**Evidence:** `EYE_TRACKING / CONSUMER_RESEARCH`  
**Finding:** More complex backgrounds attract attention but can divert it from the focal product; moderate complexity performed best in the studied context.  
**Limitation:** Specific product/stimulus conditions; “moderate” is not a universal numerical target.  

### IMG03 — Poirier et al. — Social presence cues in social media product photos
**URL:** https://doi.org/10.1016/j.jbusres.2024.114932  
**Evidence:** `PEER_REVIEWED / SOCIAL_COMMERCE`  
**Finding:** Human/implied-social-presence cues can increase positive affect, diagnosticity and purchase intentions in product-photo contexts.  
**Limitation:** Human presence can also distract; effect depends on cue form and background/product fit.  

### IMG04 — Cross-cultural verbal/visual congruency in advertising
**URL:** https://www.sciencedirect.com/science/article/pii/S014829631300204X  
**Evidence:** `PEER_REVIEWED / CROSS_CULTURAL_ADVERTISING`  
**Finding:** Visual-verbal congruence interacts with cultural processing styles and can change advertising response.  
**Limitation:** Cultural groups are heterogeneous; do not convert country-level effects into rigid stereotypes.  

### SHP02 — Li, Wang & Zhang — The shape of premiumness
**URL:** https://www.sciencedirect.com/science/article/pii/S0969698923002631  
**Evidence:** `PEER_REVIEWED / BRAND_DESIGN`  
**Finding:** Across archival analysis and experiments, angular logos were perceived as more premium than circular logos in the studied settings via psychological distance.  
**Limitation:** Effect was moderated by consumer/status goals; angular ≠ universally premium.  

### TYP01 — Doyle & Bottomley — Font appropriateness and brand choice
**URL:** https://www.sciencedirect.com/science/article/abs/pii/S0148296302004873  
**Evidence:** `PEER_REVIEWED / BRAND_TYPOGRAPHY`  
**Finding:** Typefaces judged congruent/appropriate for a product/brand improved choice and evaluation in studies.  
**Limitation:** Does not identify one universally “best” font style.  

### TYP02 — Childers & Jass — All Dressed Up With Something to Say
**URL:** https://www.sciencedirect.com/science/article/pii/S1057740802702271  
**Evidence:** `PEER_REVIEWED / CONSUMER_PSYCHOLOGY`  
**Finding:** Typeface semantic cues affected brand perceptions, and memory for advertised benefit claims improved when typeface associations were more consistent with visual and copy cues.  
**Limitation:** Specific typeface/cue manipulations; do not convert the result into universal serif/sans personality rules.  

### TYP03 — Reading performance: Helvetica versus Times New Roman
**URL:** https://pubmed.ncbi.nlm.nih.gov/35972034/  
**Evidence:** `CONTROLLED_READING_STUDY`  
**Finding:** Controlled comparison found no meaningful universal reading-speed advantage for the tested sans-serif versus serif fonts.  
**Limitation:** Only specific fonts/settings were tested; individual typefaces and rendering quality matter.  

### TYP04 — Arditi & Cho — Serifs and font legibility
**URL:** https://pmc.ncbi.nlm.nih.gov/articles/PMC4612630/  
**Evidence:** `CONTROLLED_VISION / TYPOGRAPHY`  
**Finding:** Serif effects on legibility were small/conditional and intertwined with spacing/stroke factors.  
**Limitation:** Does not prove serif and sans are identical in every medium, size or impairment context.  

### TYP05 — van Rompay & Pruyn — Typeface/product shape congruence
**URL:** https://onlinelibrary.wiley.com/doi/10.1111/j.1540-5885.2011.00828.x  
**Evidence:** `PEER_REVIEWED / DESIGN_CONGRUENCE`  
**Finding:** Congruence between typeface/form and product/brand cues can improve credibility/aesthetic and price-related judgments.  
**Limitation:** Specific stimuli/categories; use as congruence principle, not a literal font recipe.  

### TYP06 — Typography, spacing and reading in dyslexia
**URL:** https://pmc.ncbi.nlm.nih.gov/articles/PMC7188700/  
**Evidence:** `REVIEW / ACCESSIBLE_TYPOGRAPHY`  
**Finding:** Evidence for special “dyslexia fonts” or one universal spacing solution is weak/mixed; spacing and layout effects are nuanced.  
**Limitation:** Individual needs vary; accessibility settings/user control may be more robust than a branded font prescription.  

## Brand, trust, premium and audiovisual

### BRD01 — Seo, Sung & Yoon — Visual/content congruence and brand responses on Instagram
**URL:** https://doi.org/10.1016/j.jbusres.2024.114910  
**Evidence:** `PEER_REVIEWED / SOCIAL_MEDIA_MARKETING`  
**Finding:** Congruence between brand/content cues can improve evaluations and responses in social-media contexts.  
**Limitation:** Platform- and stimulus-dependent; congruence should not become sameness or suppress distinctiveness.  

### BRD02 — Ward et al. — Building a unique brand identity: measuring relative ownership potential
**URL:** https://doi.org/10.1057/s41262-020-00187-6  
**Evidence:** `LARGE_MULTI_MARKET_BRAND_ASSET_BENCHMARK`  
**Finding:** Across 1,281 in-market elements, 13 CPG categories and 19 countries, characters, logos and logotypes had the greatest average potential for unique brand ownership; color was harder to own because of competitive sharing.  
**Limitation:** Ownership potential differs even within an asset type; execution, prior investment and category competition matter.  

### BRD03 — Kantar — Distinctive assets research
**URL:** https://www.kantar.com/north-america/Inspiration/Advertising-Media/What-are-distinctive-assets-and-why-are-they-important  
**Evidence:** `LARGE_INDUSTRY_RESEARCH`  
**Finding:** Across large multi-market studies, clear and consistently used brand assets can build recognition; logos/logotypes/characters often have stronger ownership potential than generic color alone.  
**Limitation:** Vendor/industry research, not a universal causal ranking of asset types; category and market matter.  

### CTA01 — CXL — Which CTA/button color converts best?
**URL:** https://cxl.com/blog/which-color-converts-the-best/  
**Evidence:** `PRACTITIONER_SYNTHESIS / CRO`  
**Finding:** Across practical tests and evidence reviews, there is no universal winning CTA hue; local salience/contrast and hierarchy are more defensible design variables.  
**Limitation:** Practitioner synthesis, not peer-reviewed meta-analysis; actual conversion effects require testing in context.  

### LUX01 — Iseki et al. — Whitespace and perceived luxury in packaging
**URL:** https://onlinelibrary.wiley.com/doi/10.1111/joss.70026  
**Evidence:** `PEER_REVIEWED / LUXURY_DESIGN`  
**Finding:** Greater whitespace increased perceived luxury in the studied package contexts, with interactions involving typography/texture.  
**Limitation:** Category/culture/packaging context matters; whitespace is not a universal premium switch.  

### LUX02 — Black-and-white advertising and luxury perception
**URL:** https://onlinelibrary.wiley.com/doi/full/10.1002/cb.2030  
**Evidence:** `PEER_REVIEWED / CONSUMER_BEHAVIOR`  
**Finding:** Black-and-white visual treatment can elevate luxury perceptions in certain hedonic/luxury contexts.  
**Limitation:** Not general evidence that monochrome design is more premium for all brands or functional products.  

### TRUST01 — Robins, Holmes & Stansbury — Consumer health information on the Web: visual design and credibility
**URL:** https://doi.org/10.1002/asi.21224  
**Evidence:** `PEER_REVIEWED / WEB_CREDIBILITY`  
**Finding:** Visual-design judgments were significantly associated with perceived credibility of health-information websites after brief viewing.  
**Limitation:** Health-information context and perceived credibility; visual polish cannot substitute for factual trustworthiness.  

### TRUST02 — Stanford Web Credibility Research — Guidelines
**URL:** https://credibility.stanford.edu/guidelines/index.html  
**Evidence:** `ACADEMIC_RESEARCH_PROGRAM / GUIDELINES`  
**Finding:** Stanford credibility research emphasizes verifiability, real organization/person cues, expertise, contactability and professional design as credibility contributors.  
**Limitation:** Older web-era research; core trust mechanisms remain useful but interface conventions evolve.  

### TRUST03 — Meta-analysis of online review effects on purchase intention
**URL:** https://www.sciencedirect.com/science/article/pii/S2543925123000323  
**Evidence:** `META_ANALYSIS / CONSUMER_RESEARCH`  
**Finding:** Across a large set of studies, online review information materially influences purchase intention; valence is a strong driver with meaningful moderators.  
**Limitation:** Effects depend on product, platform, source credibility and review characteristics.  

### VID01 — Simmonds et al. — Audiovisual sensory cues, attention and brand memory
**URL:** https://onlinelibrary.wiley.com/doi/full/10.1002/mar.21357  
**Evidence:** `PEER_REVIEWED / AUDIOVISUAL_MARKETING`  
**Finding:** Coordinated audiovisual cues can influence attention, affect and memory for brands.  
**Limitation:** Content/brand congruence and execution matter; adding sound is not automatically beneficial.  

### VID02 — Music tempo and advertising response / regulatory focus
**URL:** https://www.tandfonline.com/doi/full/10.1080/00218499.2025.2464277  
**Evidence:** `PEER_REVIEWED / ADVERTISING`  
**Finding:** Music tempo can interact with psychological orientation/context to change advertising responses.  
**Limitation:** No universal “fast music sells” or “slow music feels premium” rule.  

## V2 second-pass evidence additions

### HCI01 — Schlamann, Nestler & Thielsch — Attractive Things Do Work Better: A Meta-Analysis on Visual Aesthetics and User Performance
**URL:** https://www.tandfonline.com/doi/full/10.1080/10447318.2026.2664081  
**Evidence:** `PREREGISTERED_META_ANALYSIS / HCI`  
**Finding:** Across 31 studies, 234 effect sizes and 18,794 participants, aesthetically appealing interfaces showed a small-to-medium positive average effect on objective user performance (`g = 0.29`, 95% CI `[0.08, 0.51]`).  
**Limitation:** Very high heterogeneity (`I² ≈ 89.7%`) and broad prediction interval (`−1.07` to `1.66`) mean aesthetics can have weak, null or even negative performance effects in particular contexts.  

### HCI02 — Tuch et al. / aesthetics–usability reversal evidence
**URL:** https://www.sciencedirect.com/science/article/pii/S0747563212000908  
**Evidence:** `CONTROLLED_HCI_EXPERIMENT`  
**Finding:** In the tested online-shop setting, aesthetics did not increase perceived usability, while poor usability reduced perceived aesthetics through affect/frustration.  
**Limitation:** One experimental context; use primarily as a boundary-condition counterexample to a simplistic aesthetic-usability halo.  

### CLR04 — Jonauskaite & Mohr — Do we feel colours? A systematic review of 128 years of psychological research
**URL:** https://link.springer.com/article/10.3758/s13423-024-02615-z  
**Evidence:** `SYSTEMATIC_REVIEW / COLOR_EMOTION`  
**Finding:** Synthesized 132 peer-reviewed articles, 42,266 participants and 64 countries. Found systematic many-to-many color–emotion correspondences shaped by lightness, saturation and hue.  
**Limitation:** Much of the literature measures associations rather than experienced emotion or commercial behavior in a specific design context.  

### TYP07 — Daxer et al. — Helvetica versus Times New Roman controlled paragraph reading
**URL:** https://link.springer.com/article/10.1111/opo.13039  
**Evidence:** `CONTROLLED_READING_EXPERIMENT`  
**Finding:** With equivalent paragraph layout, no significant difference in reading time, speed or errors between Helvetica and Times New Roman.  
**Limitation:** Two specific high-quality typefaces in print-like paragraph layouts; does not prove all serif/sans faces are interchangeable.  

### SHP03 — Jiang et al. — Circular- and angular-logo shapes influence brand attribute judgments
**URL:** https://academic.oup.com/jcr/article-abstract/42/5/709/1855577  
**Evidence:** `MULTI_EXPERIMENT / CONSUMER_RESEARCH`  
**Finding:** Circular vs angular forms activated softness vs hardness associations that influenced product/company judgments. Effects disappeared when working-memory imagery was constrained or when ad headlines conflicted with shape-implied attributes.  
**Limitation:** Shape meaning is inferential and strongly moderated; never translate to a universal personality map.  

### BRD04 — Phua et al. — Shape-based assets are strongest: benchmarking distinctive brand asset performance across industries
**URL:** https://www.tandfonline.com/doi/abs/10.1080/02650487.2026.2637295  
**Evidence:** `LARGE_MULTI_MARKET_ACADEMIC_BENCHMARK`  
**Finding:** 1,162 distinctive assets across 21 categories, four countries and nine years. Shape-based assets (logos/packaging) were strongest on average (40% Fame, 71% Uniqueness); color assets weakest in the reported benchmark (12% Fame, 39% Uniqueness).  
**Limitation:** Average benchmark, not a law for every category/brand; underlying commercial data were not publicly released.  

### BRD05 — Brus et al. — Assessing branding strength: comparing marketer judgement and consumer data
**URL:** https://link.springer.com/article/10.1057/s41262-025-00395-y  
**Evidence:** `PEER_REVIEWED / BRAND_MANAGEMENT`  
**Finding:** Across 405 brand elements / 50 brands / five categories, marketer judgments were often inaccurate, commonly overestimating fame and underestimating uniqueness.  
**Limitation:** Specific brand/category sample; implication is to validate with consumers, not that marketers have no useful expertise.  

### MEM01 — Montoya et al. — A re-examination of the mere exposure effect
**URL:** https://pubmed.ncbi.nlm.nih.gov/28263645/  
**Evidence:** `META_ANALYSIS / PSYCHOLOGY`  
**Finding:** 268 exposure curves from 81 articles showed a general positive exposure effect with a negative quadratic component consistent with an inverted-U pattern.  
**Limitation:** General stimulus-preference literature, not a direct advertising-frequency rule; brand wearout depends on creative/context.  

### NOV01 — Hekkert, Snelders & van Wieringen — Most Advanced Yet Acceptable
**URL:** https://research.tudelft.nl/en/publications/most-advanced-yet-acceptable-typicality-and-novelty-as-joint-pred/  
**Evidence:** `PEER_REVIEWED / EXPERIMENTAL_AESTHETICS`  
**Finding:** Typicality and novelty can jointly predict aesthetic preference, providing empirical support for balancing recognizability and newness rather than maximizing either.  
**Limitation:** Industrial product-design stimuli; the exact optimum varies by category and medium.  

### DV01 — Cleveland & McGill — Graphical Perception
**URL:** https://www.tandfonline.com/doi/abs/10.1080/01621459.1984.10478080  
**Evidence:** `FOUNDATIONAL_CONTROLLED_GRAPHICAL_PERCEPTION`  
**Finding:** Established and experimentally tested an ordering of elementary graphical judgments; position on common scales is generally decoded more accurately than less direct encodings such as area/volume/color saturation.  
**Limitation:** Foundational older work; exact chart-choice decisions still depend on user task, modern interaction and qualitative goals.  

### ICON01 — Zheng, Silvennoinen & Kujala — aesthetic appeal and semantic distance of icons
**URL:** https://www.sciencedirect.com/science/article/pii/S1071581926000741  
**Evidence:** `CONTROLLED_HCI_EXPERIMENT / 2026`  
**Finding:** When icon concreteness/familiarity were controlled, aesthetic appeal had only a tiny inverse association with semantic distance; style familiarity was a stronger predictor of aesthetic appeal.  
**Limitation:** Icon-specific study with `N=46`; do not generalize the weak icon halo to all interface aesthetics.  

### ICON02 — Yuan & Yu — icon salience, familiarity and concreteness
**URL:** https://www.sciencedirect.com/science/article/pii/S0169814126000351  
**Evidence:** `CONTROLLED_HCI_EXPERIMENT / 2026`  
**Finding:** High icon salience improved visual-search speed/load; familiarity improved semantic-recognition accuracy and speed; concreteness effects depended on task/interactions.  
**Limitation:** Small controlled sample and VDT task; use mechanism, not exact effect size, as general design guidance.  

### SCARC01 — Barton, Zlatevska & Oppewal — Scarcity tactics in marketing: meta-analysis
**URL:** https://www.sciencedirect.com/science/article/pii/S0022435922000434  
**Evidence:** `META_ANALYSIS / CONSUMER_RESEARCH`  
**Finding:** 416 effect sizes from 131 studies show scarcity cues can increase purchase intention; demand-, supply- and time-based scarcity effects vary by product type, involvement and context.  
**Limitation:** Persuasion effect does not justify deceptive scarcity; long-term trust/reputation and regulation remain separate considerations.  

## Design philosophy

### PHI01 — Apple — Designed by Apple in California / Jony Ive
**URL:** https://www.apple.com/newsroom/2016/11/designed-by-apple-in-california-chronicles-20-years-of-apple-design/  
**Evidence:** `PRIMARY_DESIGN_PHILOSOPHY`  
**Finding:** Jony Ive describes pursuit of objects that feel coherent, inevitable and apparently effortless, with obsessive care in execution and detail.  
**Limitation:** Philosophy/craft reference, not empirical proof that Apple aesthetics maximize conversion.  

### PHI02 — Vitra Design Museum — Interview with Dieter Rams
**URL:** https://www.design-museum.de/en/ueber-design/interviews/detailseiten/interview-dieter-rams.html  
**Evidence:** `PRIMARY_DESIGN_PHILOSOPHY`  
**Finding:** Rams emphasizes usefulness, honesty, longevity and “as little design as possible.”  
**Limitation:** Normative philosophy, not a controlled performance study.  

---

# 40. Evidence handling rules

1. **Empirical evidence outranks folklore.** Controlled studies, meta-analyses and broad reviews are stronger support than famous rules or design-blog repetition.
2. **Human perception evidence is not the same as conversion evidence.** A cue can attract the eye without improving comprehension, trust, memory or action.
3. **Official design systems are high-quality implementation guidance, not universal causal science.** Apple, Material and Carbon are used to operationalize principles, not to prove that their visual language is globally optimal.
4. **Design philosophy is inspiration, not proof.** Jony Ive and Dieter Rams are included because their principles are influential and coherent, but their statements are not treated as experimental findings.
5. **Context is part of the effect.** Color, typography, shape, imagery, whitespace and motion interact with category, brand promise, culture, audience and task.
6. **Avoid broad-category overgeneralization.** “Serif”, “blue”, “rounded”, “minimal”, “premium” and “human image” are too coarse to function as guaranteed performance variables.
7. **Heuristics are scaffolds.** Rule of thirds, 60-30-10, grids and scan patterns can help designers create order, but a heuristic earns no special authority over a better context-specific composition.
8. **Accessibility constraints are non-negotiable design inputs.** Marketing performance never justifies hiding meaning behind color alone, inaccessible contrast or harmful motion.
9. **Measure downstream outcomes.** For conversion-critical work, validate attention, comprehension, trust and action rather than rewarding visual novelty by itself.
10. **When evidence conflicts, preserve uncertainty.** Write the boundary condition into the design rule instead of choosing whichever source sounds most confident.
11. **Meta-analysis averages are not universal laws.** Inspect heterogeneity and prediction intervals; an average positive effect can hide null or negative contexts [HCI01].
12. **Association is not experienced emotion or behavior.** Color-emotion, shape and typography research often measures semantic association; do not silently convert that into conversion claims [CLR04][SHP03].
13. **Measure brand memory externally.** The brand team is not the consumer; distinctive-asset judgments should be validated with target/category buyers where material [BRD05].
14. **Do not average away preference heterogeneity.** “Moderate complexity is optimal” is a contextual hypothesis, not a universal observer law; test audience/task-specific complexity when material [CMPX01].

---

# 41. V2 validation note — second research pass, cutoff 21 September 2026

V2 has been re-audited against current W3C accessibility guidance, Apple's 2026 Human Interface Guidelines, peer-reviewed consumer/marketing psychology, HCI, visual perception, controlled typography research, eye-tracking, meta-analyses, systematic reviews and large multi-market brand datasets. The final source map is mechanically audited: 71 evidence IDs are used, all 71 resolve to exactly one definition, with no missing, duplicate or dead source IDs.

The second pass specifically attempted to falsify or bound the playbook's most repeated design claims: color psychology, serif/sans legibility, rule of thirds, golden ratio, 60-30-10, faces/gaze, whitespace/luxury, angularity/premium, aesthetic-usability, distinctiveness, scarcity, icon usability and graphical perception.

The final standard deliberately keeps **higher-order principles** harder than surface prescriptions:

```text
PURPOSE
→ RELEVANT ATTENTION
→ HIERARCHY / ORIENTATION
→ COMPREHENSION
→ SEMANTIC + BRAND FIT
→ TRUST / EVIDENCE
→ MEMORY / DISTINCTIVENESS
→ ACTION
→ ACCESSIBILITY THROUGHOUT
```

No source reviewed justifies a universal “best” color, typeface category, composition ratio, amount of whitespace, image treatment or CTA style.

Where research supports an average association but shows strong moderators, V2 encodes the moderator into the rule rather than presenting the average as a law.

Where a famous design rule has weak empirical support but remains operationally useful, V2 preserves it as a **heuristic** instead of deleting it.

Where official systems such as Apple, Material, Carbon or W3C provide practice guidance, V2 preserves their proper status: **normative/operational guidance, not causal proof of commercial performance.**

The playbook should therefore be used as an evidence-weighted decision system and testing framework — not as a recipe book.
