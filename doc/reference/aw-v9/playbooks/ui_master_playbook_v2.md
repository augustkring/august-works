# UI Master Playbook — V2.0
## Evergreen standards for clear, operable, stateful and accessible interactive interfaces

**Version:** 2.0 — Double-Validated Golden Standard  
**Research cutoff:** 21 September 2026  
**Scope:** Web applications, websites, mobile apps, desktop software, productivity tools, enterprise applications, SaaS, dashboards, editors, settings, forms, search, data-heavy interfaces, collaborative products, AI-native products and other interactive digital interfaces.  
**Document type:** Operator-neutral, framework-neutral and platform-neutral UI standard. Not a visual brand manual, not an end-to-end UX methodology, not a component library, and not a platform-specific implementation guide.  
**Companion standards:** `ux_master_playbook_v2_double_validated_2026-09-21.md` and `universal_design_principles_master_playbook_v2.md`.

---

# Executive synthesis

A user interface is the **interactive representation of a system**.

Its job is not merely to look clean, modern, minimal or polished. It must make the product's information, available actions, current state and consequences sufficiently legible that people can operate it without unnecessary interpretation, memory, error or loss of control.

A strong interface makes four questions easy to answer:

```text
WHAT AM I LOOKING AT?
WHAT CAN I DO?
WHAT IS THE SYSTEM DOING?
WHAT HAPPENED?
```

The strongest cross-source conclusion is:

> **Represent information, available action and system state clearly at the point of use. Use familiar semantics and controls, expose the right amount of complexity for the task, preserve context, and make every meaningful interaction perceivable, operable, predictable and recoverable.**

The core UI model is:

```text
ORIENT
→ SCAN
→ UNDERSTAND
→ IDENTIFY AVAILABLE ACTION
→ ACT
→ PERCEIVE STATE CHANGE
→ VERIFY RESULT
→ CONTINUE / RECOVER
```

From the system side:

```text
INFORMATION
→ HIERARCHY
→ AFFORDANCE
→ ACTION
→ STATE
→ FEEDBACK
→ RECOVERY
```

Accessibility, semantics, input modality, responsiveness, localization, performance and reversibility apply across the entire chain.

The shortest version of the playbook is:

> **Make the system legible. Make actions predictable. Make state visible. Make feedback clear. Make recovery possible.**

---

# V2 research verdict

V2 treats V1 as a falsifiable research draft, not as canon. The second pass rechecked the playbook against current W3C/WCAG/WAI-ARIA material, Apple's 2026 HIG, Android adaptive guidance, Microsoft Fluent, IBM Carbon, GOV.UK, USWDS, Atlassian, current NN/g and Baymard research, design-token standards, and current human-AI/agentic HCI research.

The result is **not** “V1 was wrong.” Its central doctrine survives. But V2 changes several rules materially and reorganizes the document around durable UI problems rather than today's component taxonomy.

## What survived strongly

- **Appearance, semantics, state and behavior must agree.** A UI is a behavioral promise, not a static picture [W3C-APG-README].
- **Focus, selection, hover and activation are distinct states** and must not be visually or behaviorally collapsed [W3C-APG-KEYBOARD][APPLE-FOCUS].
- **State visibility and feedback are core UI properties**, not polish [APPLE-FEEDBACK][UX-V2].
- **Familiar conventions reduce relearning**, but familiarity is a default rather than a prohibition on innovation [APPLE-PRINCIPLES][UX-V2].
- **Accessibility is a quality floor**, including keyboard operation, target acquisition, reflow, visible focus, semantics and non-color state cues [W3C-WCAG22].
- **Responsive UI means adaptation, not shrinking.** Reflow, reveal and presentation change are stronger models than “desktop versus mobile” [ANDROID-ADAPT][APPLE-LAYOUT].
- **Hidden UI has a discoverability cost.** Menus, accordions, overflow actions and hidden navigation can be useful, but the space they save is not free [NN-CONTEXT-MENU][NN-HIDDEN-NAV].
- **The right component depends on the task semantics**, not a universal numeric threshold [W3C-APG-COMBOBOX][BAYMARD-DROPDOWN].
- **AI and agentic products need more explicit state, scope, correction and oversight**, not less UI [MS-HAI][MS-OVERSIGHT][CHI-CHECKPOINT].

## Material V2 corrections

### 1. “Disabled controls should not be focusable” was too strong

Native HTML disabled controls leave the tab sequence, but WAI-ARIA explicitly documents cases where a disabled control may remain focusable so its existence stays discoverable, especially inside composite widgets such as menus, tabs, trees and toolbars [W3C-APG-KEYBOARD].

**V2 rule:**

> Disabled-state focusability is a pattern decision. Prefer native disabled behavior when discoverability is obvious from context; keep disabled elements keyboard-discoverable only when the pattern and task justify it, and implement the expected semantics consistently.

### 2. “Never nest modals” was too absolute

Fluent and Apple strongly discourage stacked modality because it increases cognitive and focus-management complexity [FLUENT-DIALOG][APPLE-MODALITY]. WAI-ARIA, however, defines a dialog as capable of overlaying another dialog and provides patterns that technically support modal layers [W3C-APG-DIALOG].

**V2 rule:**

> Avoid stacked modality as the default. Prefer closing, replacing or advancing the existing modal. Allow a higher-priority alert or constrained second modal only when the workflow genuinely requires it and focus/context remain unambiguous.

### 3. “Switch = immediate effect” is a convention, not the semantic definition

WAI-ARIA defines a switch primarily as a binary on/off input and notes functional overlap with checkboxes and toggle buttons [W3C-APG-SWITCH]. Fluent and Carbon add the strong product convention that switches apply immediately, while checkboxes often participate in a submitted form [FLUENT-SWITCH][CARBON-TOGGLE].

**V2 rule:**

> Treat immediate application as the default convention for switches, not a universal accessibility law. Use the control whose visible representation, semantics and transaction model are coherent.

### 4. Option-count rules for dropdowns are contextual

Baymard's “fewer than 5 / more than 10” finding is a strong ecommerce heuristic, not a cross-domain law [BAYMARD-DROPDOWN].

**V2 rule:**

> Choose between visible options, select, listbox and combobox using comparison need, familiarity, vocabulary, searchability, frequency and space. Treat numeric thresholds as context-specific priors.

### 5. Target-size numbers needed a clearer hierarchy

WCAG 2.2 AA defines 24×24 CSS px or spacing/equivalent exceptions; WCAG AAA defines 44×44 CSS px; Android recommends 48dp comfortable targets for touch [W3C-TARGET][ANDROID-TARGET].

**V2 rule:**

> Compliance floors, platform comfort guidance and context-specific ideal sizes are different concepts. Do not promote any single number into a universal UI law.

### 6. Tooltip guidance needed stronger caveats

WAI-ARIA's tooltip pattern is explicitly still work in progress and lacks task-force consensus [W3C-APG-TOOLTIP]. Atlassian and Fluent converge on tooltips as supplemental rather than critical content [ATLAS-TOOLTIP][FLUENT-TOOLTIP].

**V2 rule:**

> Tooltips are a conservative supplemental pattern, not a repair mechanism for missing labels, essential instructions or poor information architecture.

### 7. Tabs need a latency boundary condition

WAI-ARIA recommends automatic activation on focus only when the corresponding panel can appear without noticeable latency; otherwise automatic activation harms keyboard navigation efficiency [W3C-APG-TABS].

### 8. Skeleton/spinner timing thresholds are vendor heuristics

Fluent gives specific timing guidance for skeletons/spinners, while Apple frames loading more generally around truthful state and real task duration [FLUENT-SKELETON][FLUENT-SPINNER][APPLE-LOADING].

**V2 rule:**

> Use vendor timing thresholds as implementation heuristics, not human-perception laws. Optimize real latency first; choose feedback according to whether content structure and progress are actually known.

### 9. WCAG 3 is not the current conformance baseline

As of 10 September 2026, WCAG 3 remains a Working Draft and explicitly says its final requirements will differ [W3C-WCAG3]. V2 therefore keeps WCAG 2.2 as the normative web accessibility baseline and treats WCAG 3 only as emerging direction.

## Major V2 additions

V2 adds dedicated standards for:

- scope and mode visibility
- dirty/saved/stale/synced/conflicted data states
- undo/redo and reversible action UI
- optimistic UI and rollback
- autosave and save-state communication
- offline/degraded UI and synchronization
- collaboration/shared/private state
- dynamic/virtualized lists and grids
- safe areas, software keyboards, multiwindow and resizable app contexts
- focus persistence after deletion/loading
- composite widget keyboard models
- permission/ownership state
- system-status scope and severity
- design-system maturity, component lifecycle and deprecation
- AI plan/progress/action/audit surfaces
- risk-based agent checkpoints and takeover

## V2 structural correction

V1 became component-oriented too early. V2 therefore follows this order:

```text
SYSTEM REPRESENTATION
→ INFORMATION + HIERARCHY
→ AFFORDANCE
→ STATE
→ INPUT + FOCUS
→ ACTION + COMMANDS
→ FEEDBACK + RECOVERY
→ NAVIGATION + COLLECTIONS
→ ADAPTATION + ACCESSIBILITY
→ COMPONENT CHOICE
```

Components are implementations of interaction problems, not the organizing philosophy of UI.

---

# 1. Scope: UI vs UX vs visual design vs design system

The four layers overlap but answer different questions.

| Layer | Primary question | Owns |
|---|---|---|
| **UX** | What is the person trying to accomplish, and what is the least burdensome reliable journey? | customer outcome, journey, task sequence, friction, mental models, decision architecture, research, measurement |
| **UI** | How should the interactive surface represent information, action and state so the system can be operated? | layout behavior, component choice, states, focus, controls, selection, feedback, overlays, density, input modalities, adaptive presentation |
| **Universal visual design** | How should form allocate attention, improve comprehension, express meaning and create appropriate trust/brand perception? | typography, color, composition, imagery, salience, brand, aesthetics |
| **Design system** | Which UI decisions become reusable, governed product infrastructure? | tokens, component contracts, implementation assets, lifecycle, documentation, versioning, contribution |

The companion UX standard explicitly defines UX as broader than the interface [UX-V2]. The companion Universal Design Principles standard covers perception, aesthetics, brand and cross-media communication [DESIGN-V2].

## 1.1 UI is not styling

UI is not synonymous with:

- Figma
- CSS
- components
- screen layouts
- visual polish
- design systems

A UI is the **human-operable representation of system capability and state**.

When an object looks like a button, it makes a promise about action.

When something looks selected, it makes a promise about persistent state.

When a menu item is disabled, it communicates that the action exists but cannot currently occur.

When a spinner appears, it communicates ongoing work.

When a row looks editable, it promises that editing is available.

WAI-ARIA states this directly in accessibility terms: assigning a role is a promise that the corresponding expected behavior has also been implemented [W3C-APG-README].

## 1.2 Core doctrine

> **Appearance, semantics, state and behavior must agree.**

If they disagree, the interface is lying.

## 1.3 UI is not required to expose the system's internal architecture

The system may internally contain:

```text
API
→ job
→ database
→ permissions
→ queue
→ service
→ agent
```

The UI should expose only the concepts necessary for:

- understanding
- decision
- action
- verification
- recovery

Implementation detail is not automatically user value.

---

# 2. Evidence hierarchy

UI guidance mixes accessibility standards, platform convention, experimental HCI, large usability programs and designer folklore. V2 separates them.

| Tier | Evidence type | Use |
|---|---|---|
| **A0** | Normative standards / formal accessibility requirements | Hard constraints where scope applies |
| **A1** | Meta-analysis, systematic review, controlled HCI / behavioral research | Strongest behavioral mechanisms and causal priors |
| **A2** | Large usability programs / multi-site benchmarks | Strong applied evidence within domain |
| **B1** | Current official platform/design-system guidance | Operational conventions and implementation-quality guidance |
| **B2** | Practitioner research / expert synthesis | Useful applied defaults with scope limits |
| **C** | Widely established interface convention | Default hypothesis when familiarity matters |
| **D** | Style trend / rule of thumb / folklore | Never treat as universal without evidence |

## 2.1 Evidence labels

- `NORMATIVE_STANDARD`
- `WORKING_DRAFT`
- `OFFICIAL_ACCESSIBILITY_GUIDANCE`
- `CONTROLLED_HCI_STUDY`
- `META_ANALYSIS`
- `SYSTEMATIC_REVIEW`
- `LARGE_USABILITY_PROGRAM`
- `PLATFORM_GUIDANCE`
- `DESIGN_SYSTEM_GUIDANCE`
- `PRACTITIONER_RESEARCH`
- `CONVENTION`
- `HEURISTIC`
- `STYLE_CHOICE`
- `FOLKLORE`

## 2.2 Rule classes

### `CORE_STANDARD`
Strong cross-context basis. Use by default.

### `CONTEXTUAL_STANDARD`
Strong principle with meaningful boundary conditions.

### `PLATFORM_CONVENTION`
Use inside the relevant ecosystem unless a material benefit justifies deviation.

### `HEURISTIC`
Useful starting point, not a law.

### `STYLE_CHOICE`
Primarily expressive.

### `ANTI_PATTERN`
Usually harmful in normal conditions.

### `FOLKLORE`
Repeated advice without sufficient evidence to act as a standard.

## 2.3 Conflict rule

When two valid guidelines conflict:

1. Preserve normative safety/accessibility requirements.
2. Identify the user's actual task.
3. Identify platform conventions and transferred expectations.
4. Identify input modalities.
5. Identify action frequency.
6. Identify consequence and reversibility.
7. Identify available space and information density.
8. Identify novice/expert differences.
9. Prefer observed task behavior over aesthetic preference for usability questions.
10. If both remain plausible, test the unresolved decision with realistic content and tasks.

## 2.4 Evidence re-weighting rules

1. **A design system is strongest about its own components, not universal human behavior.**
2. **A WCAG minimum is not necessarily an ideal product target.**
3. **A platform number is not automatically a cross-platform law.**
4. **ARIA patterns document expected semantics and keyboard models; they are not permission to replace native HTML without reason.**
5. **A component's popularity is not evidence of suitability.**
6. **A neat screenshot cannot validate state behavior, keyboard use or recovery.**
7. **A/B conversion gains do not override accessibility, safety or honest state communication.**
8. **AI/agentic evidence remains fast-moving; encode durable oversight principles rather than today's chat layouts.**
9. **WCAG 3 is informative future direction in 2026, not the current replacement for WCAG 2.2 [W3C-WCAG3].**

---

# 3. The UI performance model

A robust interface can be evaluated through nine layers.

## 3.1 Orient

Can the person determine:

- where they are
- which object/context is active
- which workspace/account/document they are in
- whether they are editing, viewing, selecting or reviewing
- whether the state is private/shared/live/draft

## 3.2 Scan

Can they quickly locate:

- primary content
- primary action
- current state
- exceptional conditions
- navigation
- local tools

## 3.3 Understand

Can they understand:

- labels
- relationships
- data
- scope
- consequences
- availability

## 3.4 Identify affordance

Can they tell:

- what can be clicked/tapped
- what can be selected
- what can be edited
- what can expand
- what can move
- what is currently unavailable

## 3.5 Act

Can they efficiently perform the intended operation with relevant input modalities?

## 3.6 Perceive state

Can they perceive:

- focus
- hover
- pressed/active state
- selection
- loading
- save/sync state
- success/failure
- disabled/read-only state
- permission boundaries

## 3.7 Verify result

Can they answer:

```text
Did it work?
What changed?
Where did the change happen?
Is it saved / synced / complete?
What happens next?
```

## 3.8 Recover

Can they:

- undo
- retry
- edit
- cancel
- go back
- revert
- switch path
- restore work

without unnecessary loss?

## 3.9 Continue

Does the interface preserve useful context for the next action instead of forcing reorientation?

---

# 4. The 110 golden UI standards

## Foundation and representation

1. **UI represents system reality; do not let appearance and behavior contradict each other.**
2. **Make current context, available action and meaningful system state legible.**
3. **Use familiar interaction semantics unless a material improvement justifies relearning.**
4. **Optimize for task performance and confidence, not screenshot cleanliness.**
5. **Do not equate visual minimalism with interaction simplicity.**
6. **Expose the user's conceptual model, not the implementation architecture.**
7. **Every visible control must justify its informational, operational or orienting value.**
8. **Every hidden control pays a discoverability cost.**
9. **Routine controls should not require documentation to discover or decode.**
10. **Equivalent things should look and behave equivalently.**
11. **Different things should not be made visually identical when the difference affects action.**
12. **Preserve platform/browser conventions unless the alternative produces a meaningful benefit.**

## Hierarchy, layout and scope

13. **Make the primary task structurally and visually clear.**
14. **Use spatial proximity to show action/object relationships.**
15. **Use a small number of strong alignment systems.**
16. **Choose density from task, expertise and comparison needs; sparse is not inherently superior.**
17. **Keep persistent information persistent when repeated use depends on it.**
18. **Use progressive disclosure for secondary complexity, not essential evidence.**
19. **Containers should communicate meaningful grouping, not merely decorate sections.**
20. **Do not cardify every information block.**
21. **Make action scope explicit: what object, selection, account or document will change?**
22. **Make modes visible when the same input behaves differently by mode.**
23. **Large screens should add useful simultaneous context before they simply enlarge controls.**
24. **Small screens should adapt presentation before removing capability.**

## Affordance and controls

25. **Interactive elements should be identifiable before activation.**
26. **Buttons perform actions; links navigate.**
27. **Visible text labels are safer than requiring icon interpretation.**
28. **Icon-only controls require familiar meaning, strong context and an accessible name.**
29. **Do not require hover to discover essential functionality.**
30. **Do not require drag when an equivalent simpler pointer path is feasible [W3C-DRAG].**
31. **Touch, pointer and keyboard are parallel modalities, not separate products.**
32. **Make important targets easy to acquire through size, spacing and hit area.**
33. **Destructive actions must be distinguishable before activation.**
34. **Use direct manipulation when the object-action relationship is obvious; retain explicit alternatives when discoverability or accessibility requires them.**

## Action hierarchy and commands

35. **Use one visually dominant action when one action genuinely dominates the decision.**
36. **Secondary actions may exist without competing equally.**
37. **Do not hide frequent or critical actions in overflow menus.**
38. **Context menus are for contextual secondary commands, not the only route to essential work [NN-CONTEXT-MENU].**
39. **Action labels should describe the outcome when ambiguity exists.**
40. **Keep destructive commands structurally separated from routine commands when accidental activation is plausible.**
41. **Preserve standard edit commands and shortcuts where platform conventions are strong.**
42. **Commands should act on an unambiguous scope.**

## State

43. **Default, hover, focus, pressed, selected, checked and disabled are different states.**
44. **Never use hover as the only indication of interactivity.**
45. **Focus and selection must remain distinguishable [W3C-APG-KEYBOARD].**
46. **Selected state should remain legible after the pointer leaves.**
47. **Focus should remain visible and logically persistent.**
48. **Do not move focus unexpectedly after loading, deletion or state change.**
49. **Disabled, read-only, hidden and permission-blocked are different product states.**
50. **If an unavailable action remains visible, the reason should be discoverable when it matters.**
51. **A disabled control may remain focusable only when discoverability and the interaction pattern justify it [W3C-APG-KEYBOARD].**
52. **Loading, empty, no-results, permission-blocked and error states must not be collapsed into one generic blank state.**
53. **Dirty, saved, syncing, synced, stale and conflicted are distinct data states when user work can diverge from server state.**
54. **Private, selected-for-sharing and shared are distinct collaboration states.**

## Feedback, responsiveness and progress

55. **Every consequential interaction needs perceivable feedback.**
56. **Acknowledge input before long-running work finishes.**
57. **Do not visually declare irreversible success before it is sufficiently certain.**
58. **Use determinate progress only when meaningful progress can actually be estimated.**
59. **Do not use fake progress precision.**
60. **Loading UI should communicate work, not decorate latency.**
61. **Skeletons should represent genuinely unloaded dynamic content, not fixed interface chrome [FLUENT-SKELETON].**
62. **Background loading should not unnecessarily block unrelated interaction [APPLE-LOADING].**
63. **Async completion should not steal keyboard focus merely to announce success.**
64. **Optimistic UI requires an explicit failure/rollback path.**
65. **Status feedback should be located near the object or scope it describes where feasible [APPLE-FEEDBACK].**

## Overlays and interruption

66. **Use modal interfaces only when blocking the parent context creates a real benefit.**
67. **Keep modal tasks bounded; move complex or prolonged work to a larger dedicated surface [APPLE-MODALITY].**
68. **Avoid stacked modality; allow it only for genuinely higher-priority or constrained cases with correct focus/context.**
69. **A modal needs a clear dismissal route and deliberate focus management [W3C-APG-DIALOG].**
70. **Use popovers for lightweight contextual interaction that benefits from preserved surrounding context.**
71. **Use tooltips only for brief supplemental information; never hide task-critical content there [ATLAS-TOOLTIP].**
72. **Interactive content does not belong in a classic tooltip [W3C-APG-TOOLTIP].**
73. **Use toasts for transient noncritical information, not critical recovery [FLUENT-TOAST].**
74. **Match message persistence and interruptiveness to consequence.**

## Navigation and finding

75. **High-frequency destinations deserve sufficient persistent information scent where space permits.**
76. **Hidden navigation should earn the space it saves [NN-HIDDEN-NAV].**
77. **Top-level, local and contextual navigation are different layers.**
78. **Tabs represent peer panels/views, not arbitrary navigation or required sequences.**
79. **Automatic tab activation is appropriate only when panel display has negligible latency [W3C-APG-TABS].**
80. **Breadcrumbs should represent meaningful hierarchy, not merely browsing history.**
81. **Preserve search, filter, sort, selection and scroll context when returning to a collection where refinding matters.**
82. **Navigation labels should predict destinations.**
83. **Do not make an inline state change look like route navigation or vice versa.**
84. **Back behavior should preserve the user's mental model of location and task state.**

## Data, collections and productivity

85. **Choose list, table, grid, card, tree or board according to the operation users need to perform.**
86. **Use tables when aligned columns materially support comparison or retrieval.**
87. **Use an interactive grid only when grid-style keyboard navigation/editing provides real value [W3C-APG-GRID].**
88. **Use lists when record identity and scanning matter more than cross-column comparison.**
89. **Use cards when each item is a meaningful composite object, not as a default rectangle.**
90. **Use trees only when hierarchy itself is part of the task.**
91. **Selection must remain visually distinct from focus and hover.**
92. **Batch actions should stay visibly related to the selected set.**
93. **Virtualized collections must preserve position/count semantics and focus behavior where relevant [W3C-GRID-PROPS].**
94. **Dense expert interfaces still require hierarchy, readable labels and reliable target acquisition.**

## Adaptive, accessible and system UI

95. **Design for available window/context, not named devices alone [ANDROID-ADAPT].**
96. **Support reflow, resizing and text growth without destroying core functionality [W3C-WCAG22].**
97. **Do not lock display orientation without an essential reason [W3C-ORIENTATION].**
98. **Respect safe areas, system bars, cutouts and software-keyboard occlusion.**
99. **Prefer native semantic controls before reimplementing them without a functional reason.**
100. **A custom control inherits responsibility for keyboard, focus, state and assistive semantics [W3C-APG-README].**
101. **Do not use color alone to indicate interaction state.**
102. **Required non-text UI cues must remain sufficiently distinguishable [W3C-NON-TEXT].**
103. **Design-system components must encode behavior and state, not only visual styling.**
104. **Design tokens represent reusable design decisions; tokens alone do not constitute a design system [DTCG-2025].**

## Reversibility, collaboration and AI

105. **Prefer undo/reversal over repetitive confirmation for reversible operations [APPLE-UNDO][UX-V2].**
106. **Autosave must not make save/sync/conflict state unknowable when loss or divergence is material.**
107. **Offline and synchronization states should preserve user work and expose conflicts when automatic resolution is unsafe.**
108. **Collaborative UI should distinguish private/shared state and make consequential permission scope visible [APPLE-COLLAB].**
109. **AI/agentic interfaces must expose meaningful capability, progress, action scope, correction and outcome state [MS-HAI][MS-OVERSIGHT].**
110. **Long-running consequential agents need risk-based checkpoints before error-correction cost becomes high [CHI-CHECKPOINT].**

---
# 5. State architecture — the grammar of UI

Many UI failures are state failures rather than layout failures.

A mature interface should explicitly model at least six state layers.

## 5.1 Interaction state

```text
DEFAULT
HOVER
FOCUS
PRESSED / ACTIVE
SELECTED
CHECKED / TOGGLED
EXPANDED
DISABLED
READ-ONLY
INVALID
WARNING
SUCCESS
```

These are not visual synonyms.

### Hover

Means:

> A pointing device is currently over this target.

Hover is transient and may not exist on the current device.

### Focus

Means:

> This is the current keyboard/input target.

Focus is not necessarily activation or selection. WAI-ARIA explicitly warns that focus and selection need to remain distinguishable [W3C-APG-KEYBOARD].

### Pressed / active

May mean:

- a button is currently being activated
- a toggle button is in a persistent pressed state

Do not use the same visual language for both without semantic support.

### Selected

Means:

> This item is the current selected member of a set or one member of a multi-selection.

Selection often persists after pointer movement and after focus leaves.

### Disabled

Means:

> The control exists but is not currently operable.

It does **not** necessarily mean invisible, unimportant or impossible forever.

### Read-only

Means:

> The value remains meaningful and perceivable but cannot currently be modified.

Read-only content can often remain selectable, focusable or copyable when disabled controls cannot.

## 5.2 Content/data state

```text
UNKNOWN
LOADING
AVAILABLE
EMPTY
NO RESULTS
PARTIAL
STALE
UNAVAILABLE
ERROR
OFFLINE
PERMISSION BLOCKED
```

These states answer different questions.

### Empty

The request succeeded; no content exists.

### No results

Content may exist; current search/filter criteria match none.

### Error

Expected content could not be retrieved or processed.

### Stale

Content exists, but the system knows it may no longer reflect the authoritative source.

### Permission blocked

Content exists, but this person cannot access it.

Do not render all five as:

> Nothing here.

## 5.3 Process state

```text
NOT STARTED
READY
IN PROGRESS
WAITING ON SYSTEM
WAITING ON USER
PAUSED
COMPLETED
PARTIALLY COMPLETED
FAILED
CANCELLED
ROLLING BACK
```

Long-running operations, imports, exports, uploads and agents need explicit process states.

## 5.4 Persistence/synchronization state

```text
CLEAN / SAVED
DIRTY / UNSAVED
SAVING
SAVED LOCALLY
SYNCING
SYNCED
STALE
CONFLICTED
FAILED TO SAVE
FAILED TO SYNC
```

These distinctions matter when user-generated work can diverge across local/server/collaborative sources.

## 5.5 Permission/ownership state

```text
OWNER
EDITOR
COMMENTER
VIEWER
REQUESTED
PENDING APPROVAL
REVOKED
LOCKED BY POLICY
```

The UI should translate permission systems into user-comprehensible capability, not expose raw ACL terminology unless the audience needs it.

## 5.6 Collaboration state

```text
PRIVATE
SELECTED FOR SHARING
SHARED
LIVE COLLABORATION
OTHER USER EDITING
CHANGE CONFLICT
DISCONNECTED
RECONNECTING
```

Apple's collaboration guidance explicitly treats private/shared state and permission scope as interface concepts rather than hidden infrastructure [APPLE-COLLAB].

## 5.7 AI/agent state

```text
IDLE
UNDERSTANDING / PLANNING
WAITING FOR USER INPUT
READY TO ACT
RUNNING
USING TOOL
WAITING FOR APPROVAL
PAUSED
PARTIAL SUCCESS
RETRYING
BLOCKED
COMPLETED
FAILED
CANCELLED
```

Avoid collapsing all long-running agent state into:

> Working…

---

# 6. UI semantics and the component contract

A mature component has four aligned layers:

```text
SEMANTICS
+ VISUAL REPRESENTATION
+ INTERACTION BEHAVIOR
+ STATE MODEL
```

## 6.1 A role is a promise

WAI-ARIA's formulation is unusually useful beyond accessibility:

> assigning a role promises that the corresponding behavior exists [W3C-APG-README].

Examples:

```text
looks like button
→ should activate like button

looks selected
→ selected state should persist appropriately

looks editable
→ editing should be possible or the affordance must change

looks draggable
→ drag should work and an accessible alternative should exist when required
```

## 6.2 Native-first principle

Use native semantic controls where the native behavior matches the task.

Benefits can include:

- built-in keyboard behavior
- platform semantics
- assistive-technology support
- familiar browser behavior
- lower implementation risk

A custom `<div role="button">` does not inherit native keyboard behavior [W3C-APG-README].

### Custom UI accessibility tax

The more novel the control:

```text
more keyboard code
+ more focus management
+ more state semantics
+ more assistive-technology risk
+ more testing
+ more documentation
```

Novel interaction must earn this cost.

## 6.3 Component contract

Every reusable component should define:

```yaml
purpose:
user_task:
when_to_use:
when_not_to_use:
anatomy:
semantics:
accessible_name:
states:
keyboard_behavior:
pointer_behavior:
touch_behavior:
focus_behavior:
responsive_behavior:
localization_behavior:
loading_behavior:
error_behavior:
recovery_behavior:
content_rules:
```

If a component specification documents only:

- radius
- color
- spacing
- typography

it is a visual asset, not a complete UI component contract.

---

# 7. Affordance, discoverability and information scent

UI has to show enough of itself to be operated.

## 7.1 Affordance vs signifier

An **affordance** is what can be done.

A **signifier** communicates that it can be done.

Good UI aligns them.

Examples:

- a button-like surface signifies activation
- a drag handle signifies movement
- a chevron can signify expansion or navigation depending context
- a text caret signifies editing
- a selected row treatment signifies persistent selection

## 7.2 Interaction should be plausible before trial-and-error

Avoid “mystery meat” behavior where users need to:

- click random surfaces
- hover every icon
- remember training
- infer hidden gestures

just to discover routine capability.

## 7.3 Hidden capability costs information scent

Hiding UI can reduce clutter, but it changes the problem from:

```text
Which visible action should I use?
```

to:

```text
Does this action exist?
Where might it be hidden?
What opens it?
```

Contextual menus are therefore best for secondary actions rather than primary/high-frequency operations [NN-CONTEXT-MENU].

## 7.4 Icon-only controls

Icons compress UI only when meaning remains sufficiently familiar.

Use icon-only controls when:

- convention is highly established
- context strongly disambiguates meaning
- repetition makes visible text excessively noisy
- an accessible name remains available
- target size remains adequate

The companion visual-design playbook also records 2026 icon research separating visual-search salience from semantic familiarity [DESIGN-V2].

### Default

```text
UNFAMILIAR OR IMPORTANT ACTION
→ visible text label
```

### Avoid

```text
custom clever pictogram
+ no label
+ tooltip on hover only
```

## 7.5 Truncation

Truncation can preserve layout but removes information.

Use only when:

- layout genuinely cannot expand
- full content remains accessible another way
- the missing tail is not the only differentiating information

Do not systematically truncate:

- critical action labels
- error messages
- values users must compare
- distinguishing identifiers

Atlassian permits tooltips for unavoidable truncated text while still recommending that truncation itself be avoided where possible [ATLAS-TOOLTIP].

---

# 8. Layout and spatial architecture

UI layout establishes more than composition. It communicates:

- scope
- containment
- persistence
- ownership
- hierarchy
- relationship
- available action

## 8.1 Place actions near their scope

Prefer:

```text
row action ↔ row
filter ↔ result set
editor controls ↔ editor
selected set ↔ batch toolbar
status ↔ affected object
```

Spatial distance between cause and effect increases the chance that feedback goes unnoticed.

## 8.2 Alignment

Use a small number of strong axes.

Misalignment should communicate something deliberately, not emerge from accumulated one-off offsets.

## 8.3 Containers

Use cards, panels, borders and surfaces when the region itself communicates meaning.

Good container reasons:

- independent object
- interactive region
- persistent tool region
- grouped settings
- isolated status/problem

Weak reason:

> We needed the page to look more designed.

## 8.4 Over-cardification

Symptoms:

- every section has a card
- cards inside cards
- every row has its own background/border
- the whole page becomes disconnected boxes

Consequences:

- weaker global hierarchy
- more visual borders
- poorer scanning continuity
- loss of editorial flow

Try first:

- whitespace
- headings
- alignment
- proximity

## 8.5 Persistent UI

Persistence is useful when:

- orientation benefit is high
- interaction frequency is high
- repeated scrolling cost is material

Examples:

- primary navigation
- editing toolbar
- data-table header
- selected-set action bar

Persistent UI must not obscure focused elements [W3C-FOCUS-OBSCURED].

## 8.6 Modes and mode visibility

A mode changes what the same input does.

Examples:

```text
view mode
edit mode
select mode
draw mode
comment mode
presentation mode
```

Modes are dangerous when invisible.

When mode affects expected behavior:

- show the mode
- show how to exit
- avoid subtle color-only indication
- reset/exit predictably
- avoid carrying modes across contexts where users would not expect them

## 8.7 Scope visibility

Before a consequential action, users should be able to tell:

```text
WHAT OBJECT(S)?
WHICH ACCOUNT / WORKSPACE?
WHICH RANGE / FILTER?
LOCAL OR GLOBAL?
PRIVATE OR SHARED?
```

This matters particularly for batch actions, admin tools and agents.

---

# 9. Density and complexity

There is no universal “clean UI” density.

## 9.1 High density can be correct

Examples:

- financial analysis
- operations
- monitoring
- code editors
- spreadsheets
- admin tools
- data comparison
- expert productivity software

High density works when:

- alignment is strong
- groups are meaningful
- labels remain readable
- interaction targets remain reliable
- hierarchy still exists

## 9.2 Low density can be correct

Examples:

- onboarding
- singular decisions
- consumer creation flows
- unfamiliar high-stakes tasks
- emotional/immersive contexts

## 9.3 Density is not screen-size alone

A wide monitor does not automatically justify maximal information density.

A mobile screen does not automatically imply fewer capabilities.

Consider:

```text
task expertise
× comparison need
× frequency
× viewport
× input precision
× consequence
```

## 9.4 Density modes

Expert products may legitimately support:

```text
comfortable
default
compact
```

if each mode preserves accessibility and target reliability.

Carbon's data-table system explicitly provides multiple density variants, illustrating density as contextual rather than universally fixed [CARBON-TABLE].

## 9.5 Do not create density through tiny text

When content does not fit:

1. remove redundancy
2. restructure
3. group
4. allow responsive presentation
5. hide genuinely secondary detail

before reducing legibility.

---

# 10. Responsive, adaptive, resizable and multiwindow UI

Responsive UI is not “mobile version” plus “desktop version.”

Modern windows resize continuously across:

- phones
- tablets
- foldables
- split screen
- floating windows
- desktop windowing
- external displays
- zoom/text scaling

Android's current guidance explicitly recommends thinking in available window size and panes, with **reflow, reveal and presentation change** as adaptation strategies [ANDROID-ADAPT].

## 10.1 Reflow

Same information; new arrangement.

```text
two columns
→ stacked columns
```

## 10.2 Reveal

Additional space exposes useful context.

```text
list
→ list + detail pane
```

## 10.3 Presentation change

Same purpose; different control/surface.

```text
persistent sidebar
→ temporary drawer

bottom sheet
→ side panel
```

## 10.4 Do not simply stretch

Large screens should not become:

```text
phone UI × 1.8
```

Use space for:

- simultaneous panes
- comparison
- persistent context
- more visible tools
- fewer navigation switches

Android explicitly recommends constraining content and changing presentation rather than stretching controls indefinitely [ANDROID-ADAPT].

## 10.5 Preserve state across layout changes

Window resizing/orientation change should not unnecessarily destroy:

- form input
- selection
- editor state
- scroll location
- unsaved work

Android's adaptive guidance explicitly calls out state preservation during window-size changes [ANDROID-RESIZE].

## 10.6 Orientation

Do not lock portrait/landscape unless orientation is essential [W3C-ORIENTATION].

## 10.7 System UI and safe areas

Account for:

- browser chrome
- software keyboard
- system navigation bars
- display cutouts
- fold hinges
- safe areas
- picture-in-picture / split view

A control that exists visually but is covered by system UI is functionally unavailable.

## 10.8 Software keyboard

When virtual keyboards appear:

- keep active input visible
- keep required next actions reachable
- avoid fixed elements that collide with the keyboard
- restore layout predictably when keyboard closes

## 10.9 Reflow on the web

WCAG 2.2 retains the reflow requirement at a 320 CSS-px effective width for vertically scrolling content, with explicit exceptions for inherently two-dimensional content such as data tables, diagrams and some tool interfaces [W3C-WCAG22].

---

# 11. Navigation architecture

Navigation UI is the representation of information architecture and location.

## 11.1 Three navigation layers

### Global / primary

Moves among major product areas.

### Local / secondary

Moves within the current area/object.

### Contextual

Moves among state, views or related content tied to the current object.

Do not flatten all three into one crowded navigation component.

## 11.2 Persistent vs hidden navigation

Hidden navigation saves space but adds:

```text
extra interaction
+ lower information scent
+ memory/discovery burden
```

NN/g's original quantitative work found worse discoverability/task outcomes for hidden navigation, and its 2025 recheck concludes that hamburger-icon familiarity has improved without removing the underlying hidden-navigation tradeoff [NN-HIDDEN-NAV].

### Default

Use persistent navigation when:

- repeated navigation is common
- orientation matters
- space permits

Use temporary/hidden navigation when:

- space pressure is real
- content should dominate
- navigation frequency is lower
- alternative visible cues preserve orientation

## 11.3 Sidebars

Sidebars are useful for:

- broad information hierarchy
- persistent locations
- workspace navigation
- folder/project structures

Apple notes that sidebars require substantial horizontal/vertical space and suggests more compact navigation when space is constrained [APPLE-SIDEBAR].

## 11.4 Adaptive primary navigation

Android recommends changing navigation representation with available space, for example compact navigation bar → navigation rail rather than forcing the same compact component on large screens [ANDROID-NAV].

## 11.5 Tabs

Tabs selectively expose one peer panel among a set.

Use when:

- panels are siblings
- switching is frequent
- only one needs visibility at once
- labels can be concise/predictive

Avoid when:

- information needs simultaneous comparison
- order is mandatory
- most tabs overflow out of sight
- labels are ambiguous

NN/g's currently reviewed guidance continues to treat tabs as a specific UI structure rather than generic navigation [NN-TABS].

### Automatic activation

WAI-ARIA recommends automatic tab activation on focus only when panel display has no noticeable latency [W3C-APG-TABS].

If activation causes a network wait, expensive render or context jump:

```text
focus tab
→ user activates intentionally
```

is usually safer.

## 11.6 Breadcrumbs

Breadcrumbs represent meaningful hierarchy.

They are useful when:

- users enter deep content directly
- hierarchical location matters
- moving upward is useful

They are not a replacement for browser/app history.

## 11.7 Back behavior

Back should map to the user's mental model of returning.

Common expectations:

- detail → prior list state
- nested settings → parent settings
- modal → prior context

Do not silently redefine “Back” as “Cancel and discard” without explicit consequence handling.

## 11.8 Preserve context on return

Where comparison/refinding matters, preserve:

- query
- filters
- sort
- selected state when appropriate
- scroll location
- expanded groups
- table column state when user-configured

Resetting state turns navigation into repeated setup work.

---

# 12. Actions, buttons, links and commands

## 12.1 Button vs link

### Button

Performs an action in the current product context.

Examples:

- Save changes
- Add member
- Send message
- Delete file

### Link

Moves to a destination/resource.

Examples:

- View invoice
- Account settings
- Help article

The distinction affects browser behavior, keyboard semantics, context menus and assistive technology. USWDS explicitly preserves the same action-vs-navigation distinction [USWDS-BUTTON].

## 12.2 Primary action

“One primary action” means:

> one dominant action when the decision itself has a dominant next step.

It does **not** mean:

> only one button may exist.

## 12.3 Secondary and tertiary actions

Secondary actions can remain visible when:

- legitimate alternatives exist
- comparison is part of the task
- users often need them

Visual hierarchy should communicate priority without pretending alternatives do not exist.

## 12.4 Destructive actions

Destructive treatment should reflect consequence, not simply the verb “Delete.”

Consider:

```text
reversibility
+ scope
+ value at risk
+ recoverability
```

A reversible “remove from list” can often use undo.

An irreversible account closure may justify confirmation.

## 12.5 Toolbars

A toolbar provides convenient access to frequent commands for the current view/object [APPLE-TOOLBAR].

Use for:

- editors
- creation tools
- tables
- selected objects

Toolbar items should be:

- task-relevant
- clearly grouped
- not overcrowded
- predictable across equivalent contexts

## 12.6 Overflow

When space contracts:

1. preserve high-frequency/high-importance commands
2. move secondary commands into overflow
3. preserve logical ordering
4. keep the overflow discoverable

Do not overflow the primary command just because it is visually awkward.

## 12.7 Menus

A menu exposes commands or destinations.

Use for:

- secondary actions
- contextual actions
- grouped commands

Do not confuse a command menu with a value-selection listbox/select.

WAI-ARIA distinguishes menu commands from listbox choices and combobox values [W3C-APG-LISTBOX][W3C-APG-COMBOBOX].

## 12.8 Context menus

Context menus can reduce clutter but have low information scent [NN-CONTEXT-MENU].

Good fit:

- Duplicate
- Rename
- Archive
- Inspect
- Share

Poor fit:

- Finish task
- Submit required workflow
- Safety-critical stop
- the only route to a frequent operation

## 12.9 Edit commands

Preserve familiar platform behavior for:

- copy
- cut
- paste
- undo
- redo
- select all

when the underlying task supports them.

Apple explicitly recommends supporting standard undo/redo and edit conventions [APPLE-UNDO].

---

# 13. Selection controls — choose by semantics, not fashion

Before choosing a selection control, ask:

```text
single or multiple?
immediate or staged transaction?
must choices be simultaneously visible?
does comparison matter?
does user know the vocabulary?
can typing/filtering help?
how long are labels?
how often is the control used?
```

## 13.1 Checkbox

Use for:

- independent multiple selection
- binary inclusion/exclusion
- optional tri-state parent/child selection when appropriate

WAI-ARIA supports checked, unchecked and mixed checkbox state [W3C-APG-CHECKBOX].

## 13.2 Radio group

Use when:

- one choice from a set is required
- simultaneous visibility improves comparison
- choices can be represented clearly

Radio buttons can start with no choice when forcing an explicit decision is meaningful [W3C-APG-RADIO].

## 13.3 Switch / toggle

WAI-ARIA defines switch as binary on/off input and notes overlap with checkbox/toggle-button semantics [W3C-APG-SWITCH].

Fluent and Carbon use a strong convention:

```text
SWITCH
→ binary state changes immediately

CHECKBOX
→ often selection in a larger transaction
```

[FLUENT-SWITCH][CARBON-TOGGLE]

Treat this as a strong interaction convention, not a universal accessibility law.

## 13.4 Select/dropdown

Useful when:

- one value must be chosen
- simultaneous visibility is not essential
- option labels are understandable once revealed
- native platform behavior provides value

Weak when:

- users must compare options
- option set is tiny and visible controls would be faster
- option set is huge and typing/search is expected

Baymard's thresholds are useful ecommerce priors but not universal laws [BAYMARD-DROPDOWN].

## 13.5 Listbox

A listbox presents options for single/multiple selection.

Important accessibility boundary:

A listbox option is exposed primarily as a selectable option name; WAI-ARIA warns that it is not a good pattern for embedding arbitrary interactive controls such as buttons and links inside options [W3C-APG-LISTBOX].

## 13.6 Combobox

Use when a compact selection benefits from an associated popup, often with:

- typing
- filtering
- autocomplete
- large option sets
- copying/editing the text value

WAI-ARIA distinguishes editable/select-only comboboxes and notes differences from menu buttons and listboxes [W3C-APG-COMBOBOX].

## 13.7 Segmented control

Useful for:

- small mutually exclusive local state/view set
- short labels
- immediate switching

Avoid when:

- labels are long
- choices need explanation
- many options exist

## 13.8 Slider

Use when:

- range is continuous/ordinal
- approximate direct manipulation is useful
- visual relationship to range matters

Use explicit numeric input/stepper when exactness matters more than continuous manipulation.

## 13.9 “Recommended” choice

Recommendation is a decision aid, not a control type.

Make recommendation basis understandable where material.

---

# 14. Forms and data-entry UI

The UX standard owns whether a field belongs in the flow. UI owns how required input is represented and operated.

## 14.1 Persistent labels

Use visible persistent labels.

Placeholder-only labels:

- disappear during typing
- increase recall burden
- make review harder
- create accessibility problems

WAI-ARIA recommends visible text labels and native labeling mechanisms where possible [W3C-APG-NAMES].

## 14.2 Group labels

Related inputs should share a group label when their meaning depends on the group.

Examples:

- address
- date fields
- radio choice
- checkbox group

## 14.3 Helper text

Use helper text for information needed **before** entry.

Examples:

- expected format
- consequence
- constraint
- why data is needed

Do not use helper text to rescue a fundamentally unclear field name.

## 14.4 Required/optional state

Obligation should be unambiguous.

Do not rely on:

- a global note users may miss
- color alone
- inconsistent use of asterisks

## 14.5 Input format

Accept human-compatible formatting when the software can normalize it.

Support relevant platform capabilities:

- autofill
- autocomplete
- password managers
- paste
- correct virtual keyboard/input type

The companion UX standard includes the stronger authentication and data-entry rules [UX-V2].

## 14.6 Validation timing

Do not declare an error while the user is still creating a potentially valid value.

Useful validation moments:

- blur / committed field change
- form submit
- after enough input exists to know the value is invalid
- immediate only when the feedback is genuinely helpful and non-hostile

## 14.7 Error UI

A field error should communicate:

```text
WHAT IS WRONG
+ HOW TO FIX IT
```

Place it near the field and preserve valid input.

GOV.UK requires both an error summary and inline errors for its service pattern and links the summary directly to failing fields [GOV-ERROR]. Treat the exact dual presentation as a strong public-service pattern, not a universal requirement for every tiny form.

## 14.8 Error summary

Use a summary when:

- form is long
- multiple errors can occur
- fields may be offscreen
- users need a quick overview/re-entry point

## 14.9 File upload

File upload UI should expose:

- accepted type/size before selection where material
- file identity after selection
- upload progress
- failure/retry
- remove/replace
- whether upload completion equals final submission

Do not make selected file presence visually ambiguous.

## 14.10 Date/time input

Choose control according to task:

- known date entry may favor direct text/segmented fields
- relative visual date choice may favor calendar
- large historical date jumps should not require month-by-month navigation

Do not assume a calendar picker is the right input for every date.

---

# 15. Disabled, hidden, read-only and permission-blocked

This is a semantic decision, not merely a styling state.

## 15.1 Disabled

Means:

> the control exists but cannot currently be operated.

Use when visibility helps explain:

- current workflow
- temporary dependency
- future capability
- state constraints

### Focusability nuance

Native disabled HTML controls leave the tab sequence.

WAI-ARIA's keyboard guidance says this is often useful because it reduces unnecessary key presses, but it also documents cases where `aria-disabled="true"` may remain focusable so a feature stays discoverable in composite widgets [W3C-APG-KEYBOARD].

Default:

```text
context already makes disabled capability obvious
→ native non-focusable disabled

feature discoverability is important inside established composite pattern
→ focusable aria-disabled may be appropriate
```

Do not invent focusable-disabled behavior inconsistently from component to component.

## 15.2 Hidden

Means:

> the capability/content is currently irrelevant enough that showing it adds more cost than value.

Good examples:

- control for a feature permanently unavailable to current role
- mode-specific action that has no meaning outside the mode

Risk:

Users cannot discover capability they cannot see.

## 15.3 Read-only

Means:

> the value is relevant and inspectable, but not editable.

Prefer read-only over disabled when people should still:

- read
- select
- copy
- focus
- inspect

Carbon explicitly distinguishes read-only and disabled in this way [CARBON-INPUT].

## 15.4 Permission-blocked

Permission state answers:

- why unavailable
- who can change access
- whether access can be requested

Do not render every permission boundary as generic disabled state.

## 15.5 Disabled form-submit debate

Atlassian explicitly recommends avoiding disabled submit buttons because they can obscure what remains invalid and are not keyboard focusable [ATLAS-DISABLED]. Other systems use disabled submit patterns.

V2 conclusion:

> There is no universal “submit buttons must never be disabled” rule. If disabling is used, the form itself must make unmet requirements unmistakable without relying on the disabled button for explanation. In high-complexity forms, allowing submission to trigger clear validation can be more informative.

---


# 16. Focus, keyboard and composite widgets

Focus is not decorative emphasis. It is the interface's current input location.

A keyboard-operable interface needs to answer:

```text
Where am I?
What can I operate here?
What will the next key do?
How do I leave this region?
```

WCAG requires keyboard operation for applicable functionality, while WAI-ARIA APG provides interaction models for richer custom widgets [W3C-WCAG22][W3C-APG-KEYBOARD].

## 16.1 Focus vs selection

Keep these concepts separate unless the pattern intentionally couples them:

```text
FOCUS
= current input target

SELECTION
= item/value currently chosen

ACTIVATION
= action is executed / view is opened
```

A list item can be focused without being selected.

A selected tab can remain selected while focus moves elsewhere.

In some widgets selection follows focus; in others it should not. The deciding question is whether selection causes a meaningful side effect or latency [APPLE-FOCUS][W3C-APG-TABS].

## 16.2 Visible focus

Focus must remain visually trackable.

Avoid:

- removing native focus indication without a replacement
- focus styles indistinguishable from selected state
- focus hidden behind sticky headers/footers
- focus indicators that disappear against one theme/background

WCAG 2.2 adds Focus Not Obscured at AA and Focus Appearance at AAA [W3C-FOCUS-OBSCURED][W3C-WCAG22].

## 16.3 Focus order

Focus order should preserve meaning and operability.

Default:

```text
visual/task structure
≈
DOM/semantic structure
≈
keyboard order
```

Do not use positive `tabindex` values to patch a structurally incoherent DOM as a routine technique.

## 16.4 Focus movement after UI change

Move focus deliberately when:

- a modal opens
- a modal closes
- the focused element is removed
- a route/view transition requires a new orientation point
- the user's explicit action creates a new interaction context

Avoid moving focus merely because:

- data loaded
- a toast appeared
- a list refreshed
- a background process completed

Use status semantics for status; use focus for interaction location [W3C-STATUS][FLUENT-SKELETON].

## 16.5 Composite widgets

Menus, listboxes, tabs, trees, toolbars and grids often use one Tab stop plus internal arrow-key navigation rather than placing every descendant in the page Tab sequence [W3C-APG-KEYBOARD].

Typical model:

```text
TAB
→ enter composite

ARROWS / HOME / END
→ navigate inside

TAB
→ leave composite
```

Do not improvise a new keyboard grammar when an established accessible pattern already fits.

## 16.6 Roving tabindex vs aria-activedescendant

Both can be valid for composite widgets.

Choose based on:

- DOM structure
- virtualization
- focus styling
- assistive-technology behavior
- need to keep DOM focus on an input, e.g. editable combobox

The implementation technique is secondary to the user-visible invariant:

> One predictable active location, understandable navigation and no keyboard trap.

## 16.7 Tab activation latency

Automatic tab activation can make keyboard navigation efficient **only when the associated panel can appear without noticeable delay** [W3C-APG-TABS].

If changing focus triggers slow network work or expensive rendering:

```text
arrow → focus tab
Enter/Space → activate
```

can be superior to activation-on-focus.

This is an important V2 correction: interaction conventions must include performance as a boundary condition.

## 16.8 Shortcut layer

Expert shortcuts should supplement, not replace, discoverable controls.

Good:

```text
visible command
+ menu label shows shortcut
+ shortcut executes same command
```

Avoid redefining well-established platform shortcuts for unrelated functions.

Character-key shortcuts need special care because they can conflict with speech input and unintended keystrokes; follow applicable WCAG requirements.

---

# 17. Pointer, touch, targets, gestures and drag

A modern interface may be operated by:

- mouse
- trackpad
- touch
- stylus
- keyboard
- switch device
- speech
- assistive pointer

Do not design the fundamental interaction contract around one assumed device.

## 17.1 Hover is enhancement

Hover can provide:

- preview
- optional explanation
- secondary affordance reinforcement

It must not be the only way to:

- discover essential action
- read required information
- access recovery
- expose critical state

For hover/focus-triggered additional web content covered by WCAG 1.4.13, the content must be dismissible, hoverable and persistent under the criterion's conditions [W3C-HOVER].

## 17.2 Pointer cancellation

For ordinary single-pointer controls, completing on pointer-up is generally safer than executing irreversibly on pointer-down.

WCAG Pointer Cancellation explicitly recognizes:

- no down-event execution
- abort before completion
- undo after completion
- up-event reversal
- essential exceptions [W3C-POINTER-CANCEL].

Design implication:

> Give users a chance to abort accidental activation whenever the interaction permits it.

## 17.3 Target size

There is no single cross-platform optimum.

Current baselines include:

- WCAG 2.2 AA: 24×24 CSS px minimum criterion with specified exceptions/spacing alternatives [W3C-TARGET]
- WCAG AAA: larger enhanced target criterion
- Android platform guidance: larger comfortable touch targets, commonly 48dp [ANDROID-TARGET]

V2 rule:

> Treat normative minima as floors, not desired target sizes. Increase acquisition area for frequent, consequential or isolated touch actions according to input context.

## 17.4 Visual size vs hit area

A 20–24px icon can have a much larger interactive target.

Do not enlarge the glyph simply to enlarge the hit target if visual hierarchy would suffer.

## 17.5 Target separation

Separation matters especially when:

- actions are destructive
- controls are small
- one-handed touch is common
- motor precision may be reduced

Avoid placing `Delete` directly against a routine `Open`/`Edit` target with identical visual weight.

## 17.6 Gestures

Gestures are strongest when they are:

- platform-familiar
- reversible
- supplementary
- accompanied by visible paths for important actions

Do not require users to know invisible custom gestures for core functionality.

## 17.7 Drag and drop

Drag can be efficient and direct, but it creates discoverability, motor and accessibility costs.

For web experiences, WCAG 2.2 requires an alternative single-pointer method when dragging is used and dragging is not essential [W3C-DRAG]. Atlassian's current guidance likewise requires accessible alternatives to pointer-based drag outcomes [ATLAS-DRAG].

Robust model:

```text
VISIBLE DRAG AFFORDANCE WHERE NEEDED
+
POINTER DRAG
+
ACCESSIBLE COMMAND / MENU / FORM ALTERNATIVE
+
CLEAR DROP PREVIEW
+
RESULT FEEDBACK
+
UNDO WHERE FEASIBLE
```

## 17.8 Drag feedback

During drag, clarify:

- what is being moved
- where it can go
- what the drop will do
- invalid destinations

After drop:

- reflect the new state immediately when safe
- announce/communicate the result
- preserve or restore usable focus
- support undo where the consequence is reversible [APPLE-DRAG][ATLAS-DRAG]

## 17.9 Resize handles and spatial manipulation

When resizing/repositioning is central:

- expose current size/position where useful
- make handles acquireable
- provide non-pointer alternatives for consequential/precision tasks where feasible
- preserve constraints visibly

Do not infer accessibility from the presence of a visible handle alone.

---

# 18. Modality, overlays and interruption

Overlays are not interchangeable rectangles.

They differ in:

- whether background remains usable
- whether focus moves
- whether dismissal is expected
- whether the task blocks continuation
- whether information must persist

## 18.1 Interruption ladder

A useful default hierarchy is:

```text
INLINE
→ PASSIVE STATUS / BANNER
→ POPOVER / NONMODAL PANEL
→ MODAL DIALOG
→ FULL BLOCKING STATE
```

Escalate only when the consequence or required decision justifies interruption.

## 18.2 Modal dialog

Use a modal when the user must resolve a bounded decision/task before safely continuing.

Strong cases:

- irreversible/high-cost confirmation
- blocking error requiring action
- short focused data entry
- explicit permission/approval

Weak cases:

- long reading
- ordinary navigation
- persistent reference information
- complex multi-stage work
- passive success feedback

WAI-ARIA requires modal behavior to be real rather than merely labeled: background interaction becomes inert, focus is contained, Escape normally closes and focus returns logically [W3C-APG-DIALOG].

## 18.3 Nested modality — V2 correction

V1's “never nest modals” was too absolute.

Fluent and Apple strongly discourage nested/multiple modality because it increases context and focus complexity [FLUENT-DIALOG][APPLE-MODALITY]. WAI-ARIA nevertheless acknowledges cases where a dialog can appear over another dialog [W3C-APG-DIALOG].

V2 standard:

> Do not design nested dialogs as a normal workflow. Prefer closing/replacing the current modal or using an inline subflow. A rare higher-priority alert or unavoidable bounded subdialog can be acceptable if focus, escape, state and return behavior remain unambiguous.

## 18.4 Sheet / drawer / inspector

Use a side/bottom sheet or drawer when secondary work benefits from preserving context with the primary surface.

Good:

- inspect details
- edit properties
- filters
- lightweight creation
- contextual settings

Prefer a full view when the task becomes:

- long
- multi-stage
- dominant
- navigation-heavy
- difficult to complete in constrained width

## 18.5 Popover

Use for lightweight contextual interaction that remains anchored to a trigger/object.

Good:

- short menus
- compact selectors
- mini inspectors
- quick actions

Poor:

- lengthy forms
- legal/critical content
- persistent reference material
- complex nested navigation

## 18.6 Tooltip

Tooltips are supplemental.

Use for:

- unfamiliar icon label
- short clarification
- keyboard shortcut hint

Do not use for:

- essential instruction
- primary error recovery
- interactive forms
- critical status
- long explanations

WAI-ARIA's tooltip pattern remains work-in-progress rather than mature consensus guidance, reinforcing a conservative stance [W3C-APG-TOOLTIP]. Atlassian and Fluent likewise frame tooltips as nonessential supplemental content [ATLAS-TOOLTIP][FLUENT-TOOLTIP].

## 18.7 Toast / snackbar

Use transient notices for noncritical updates that do not require the message to remain discoverable.

Good:

- saved
- copied
- background export complete
- deleted — undo

Poor:

- blocking validation error
- account/security problem
- data loss
- legal change requiring review
- instructions needed later

Fluent similarly treats toasts as temporary/noncritical [FLUENT-TOAST].

## 18.8 Banner / message bar

Use when state applies to a page, workspace or system and should remain visible until resolved or no longer relevant.

Examples:

- offline mode
- billing problem
- maintenance/degraded service
- permission restriction
- stale data

## 18.9 Inline feedback

When a message belongs to one control/object, keep it close to that scope.

Examples:

- field validation
- row failure
- upload failure
- sync problem on one document

## 18.10 Status messages and assistive technology

When visible status changes do not receive focus, web interfaces may need status/live-region semantics so assistive technologies can announce the change without moving the user's focus [W3C-STATUS].

Do not solve status announcement by automatically focusing every message.

---

# 19. Disclosure, expansion and progressive complexity

Disclosure controls manage **when** information appears.

They do not make intrinsic complexity disappear.

## 19.1 Disclosure button

Use to show/hide a bounded region while preserving the current page context [W3C-APG-DISCLOSURE].

The trigger must communicate expanded/collapsed state.

## 19.2 Accordion

An accordion is a set of disclosures, usually organized as sections.

Use when:

- users commonly need only subsets
- sections are independently meaningful
- scrolling/visual overload would otherwise be material

Avoid when:

- most users need most content
- sections must be compared side by side
- sequence is mandatory
- opening one section changes the meaning of another

GOV.UK explicitly recommends considering ordinary headings/pages first and discourages accordions for sequential questions and nested accordion structures [GOV-ACCORDION].

## 19.3 Progressive disclosure

Good progressive disclosure delays:

- rare controls
- advanced settings
- secondary metadata
- expert capability

Do not hide:

- price/cost
- important risk
- critical state
- commonly used action
- information needed for the current decision

## 19.4 Details vs action menu

Do not hide actions inside a disclosure region merely because both create a chevron.

Information disclosure and command menus have different semantics.

## 19.5 Expansion state persistence

Preserve expanded/collapsed state when it materially supports repeated work.

Do not persist it across contexts when stale expansion would confuse orientation.

---

# 20. Collections and data-heavy interfaces

The correct representation depends on the operation, not on visual fashion.

Ask:

```text
Do users scan objects?
Compare aligned values?
Inspect details?
Reorder?
Group by hierarchy?
Edit cells?
Select many?
Monitor changing state?
```

## 20.1 List

Use when object identity and sequential scanning dominate.

Good for:

- messages
- tasks
- search results
- files
- activity

## 20.2 Table

Use when aligned columns materially improve:

- comparison
- lookup
- sorting
- scanning repeated schema

A standard semantic table is preferable when users primarily read tabular information [W3C-APG-TABLE].

## 20.3 Interactive grid

Use grid semantics when users must interact within cells/rows using a composite keyboard model.

A grid is not “a table with nicer styling.” It changes keyboard and focus responsibilities [W3C-APG-GRID].

Do not turn a static data table into an ARIA grid merely because rows are clickable.

## 20.4 Card collection

Use cards when each object is a meaningful composite that benefits from:

- image/preview
- variable metadata
- independent action set
- non-tabular scanning

Do not cardify structured comparison data.

## 20.5 Tree

Use when parent/child hierarchy is itself important.

Do not use nested tree navigation to expose implementation taxonomy that users do not understand.

## 20.6 Board / kanban

Useful when spatial columns represent meaningful workflow state and moving objects among states is a core task.

Requirements include:

- explicit column meaning
- non-drag alternatives
- clear item state
- accessible move commands
- result feedback

## 20.7 Selection

Selection state should make clear:

- which items are selected
- count
- range/scope
- whether selection persists across pages/filters
- what batch actions now apply

Do not use hover styling as selected styling.

## 20.8 Batch actions

Show batch actions in direct relationship to the selected set.

Avoid presenting an enabled destructive bulk action without making the selection scope obvious.

## 20.9 “Select all” scope

For large datasets distinguish:

```text
all visible rows
vs
all matching rows
vs
all rows in dataset
```

Ambiguity here can create consequential errors.

## 20.10 Virtualization

Virtualization can be necessary for very large collections but changes accessibility and state assumptions.

If only part of a table/grid is present in the DOM, ARIA properties such as `aria-rowcount` and `aria-rowindex` can communicate total set size and current positions when correctly implemented [W3C-GRID-PROPS].

Do not assume a visually seamless virtual list is semantically seamless.

Test:

- screen-reader navigation
- keyboard focus as rows mount/unmount
- scroll restoration
- selection persistence
- position/total announcements
- search-in-page expectations

## 20.11 Frozen/sticky columns and headers

Use when persistent labels materially reduce lookup/comparison effort.

Do not freeze so much content that the remaining data viewport becomes unusable at zoom/narrow widths.

## 20.12 Inline editing

Inline editing is strong when:

- object context matters
- changes are small/repetitive
- users need to compare while editing

Use dedicated edit surfaces when:

- validation is complex
- multiple fields depend on one another
- risk is high
- audit/review before commit is necessary

## 20.13 Table density

Compact rows can be correct in expert workflows.

Do not obtain compactness through:

- illegible text
- ambiguous target hitboxes
- invisible focus
- insufficient grouping

Carbon's current table system explicitly supports density variants, reinforcing density as contextual rather than ideological [CARBON-TABLE].

---

# 21. Search, filter, sort and result navigation

Finding interfaces need a coherent state model.

## 21.1 Search states

At minimum consider:

```text
EMPTY QUERY
TYPING
SUGGESTIONS
SEARCHING
RESULTS
NO RESULTS
PARTIAL RESULTS
ERROR
CORRECTED QUERY
FILTERS ACTIVE
STALE RESULTS
```

Do not let “No results” represent technical failure.

## 21.2 Search prominence

Make search proportionate to its importance.

If search is the dominant way experts reach objects, burying it inside secondary menus adds needless navigation.

## 21.3 Suggestions/autocomplete

Suggestions should clarify whether they are:

- query suggestions
- direct destinations
- existing objects
- recent searches
- commands

Do not visually combine unlike result types without category cues.

## 21.4 Filters

Filters change the set.

Expose:

- active filters
- clear/remove paths
- filter scope
- meaningful result count where useful

Do not hide active constraints so completely that users misinterpret why results disappeared.

## 21.5 Sort

Sort changes order, not membership.

Keep sort semantically separate from filters even when both live in one toolbar.

## 21.6 Search state preservation

When users inspect a result and return, preserve where appropriate:

- query
- filters
- sort
- current page/load state
- selection
- scroll position

## 21.7 Pagination

Use when explicit boundaries, position, bookmarking or deterministic chunks help the task.

Strengths:

- stable location
- bounded set
- page URLs
- known progress

Costs:

- repeated transitions
- cross-page comparison friction

## 21.8 Load more

Use when users benefit from continuous scanning while retaining already-loaded results, but an intentional checkpoint is useful.

## 21.9 Infinite/dynamic loading

Useful for some exploration/feed contexts.

Risky when users need:

- bounded completion
- footer access
- stable location
- exact refinding
- deterministic selection scope
- comparison across a known set

WAI-ARIA's feed pattern demonstrates that dynamic infinite loading has accessibility/state requirements including item position and `aria-busy`; it is not simply “append DOM nodes on scroll” [W3C-APG-FEED].

## 21.10 Dynamic-feed caveat

The accessibility architecture must account for how assistive technologies navigate/read newly loaded content.

Do not cite an APG example as proof that every infinite-scroll implementation is accessible; examples are instructional patterns and must be tested in production contexts.

---

# 22. Loading, progress, status and optimistic UI

Latency becomes a UI problem the moment the user cannot distinguish “working” from “ignored.”

## 22.1 Response sequence

```text
INPUT
→ acknowledge promptly
→ show truthful pending state when needed
→ allow unrelated work where safe
→ show completion/failure
```

The UX playbook already establishes real performance before theatrical loading treatments [UX-V2].

## 22.2 Loading scope

Scope the loading treatment to the region that is unavailable.

Bad:

```text
one sidebar count refreshes
→ block entire workspace
```

Better:

```text
sidebar count pending
→ rest of workspace remains usable
```

## 22.3 Indeterminate progress

Use when work is occurring but meaningful completion percentage is unknown.

## 22.4 Determinate progress

Use when meaningful progress can be estimated with sufficient truthfulness.

Apple recommends determinate indicators when duration/progress is known and stresses accurate progress; a bar racing to 90% and stalling can feel deceptive [APPLE-PROGRESS].

## 22.5 Fake precision

Do not display exact percentages or time estimates unsupported by system state.

If only stages are known, show stages.

If only busy/not-busy is known, show that.

## 22.6 Skeletons

Skeletons can:

- preserve layout
- show expected content structure
- reduce layout jumps

Use mainly when dynamic content shape is known.

Do not skeletonize fixed UI chrome or controls already usable [FLUENT-SKELETON].

## 22.7 Spinner timing

Vendor systems sometimes publish thresholds for when to show spinners. Treat those numbers as product/system heuristics, not universal perceptual law.

## 22.8 Background operations

For work that can continue after navigation:

- let user leave
- retain job state
- expose a place to find progress/result
- notify on completion when valuable

Do not trap users watching a spinner merely because implementation is synchronous-looking.

## 22.9 Optimistic UI

Optimistic updates can remove visible latency when:

- action usually succeeds
- failure is recoverable
- rollback/reconciliation is safe

Pattern:

```text
user action
→ immediate local state
→ async persistence
→ confirm OR reconcile/rollback
```

Do not optimistically claim irreversible external success (e.g. money transfer) before sufficient confirmation.

## 22.10 Optimistic failure

If persistence fails:

- communicate what did not save
- preserve user work
- expose retry
- reconcile visual state honestly

Never leave the screen in a success-looking state after known failure.

---

# 23. Undo, destructive actions, autosave and reversibility

Recovery belongs in the UI contract.

## 23.1 Undo as exploration infrastructure

Undo reduces the cost of trying and learning.

Apple's HIG emphasizes predictable undo/redo, visible results and multiple undo where appropriate [APPLE-UNDO].

Use undo for reversible actions such as:

- delete/move item
- formatting/edit
- reorder
- bulk state change
- drag-and-drop

## 23.2 Confirmation vs undo

Default heuristic:

```text
low-cost + reversible
→ execute + undo

high-cost + hard to reverse
→ review / confirmation before commit
```

Do not confirm every routine action; repeated confirmations become noise.

## 23.3 Destructive confirmation

When confirmation is justified, make the consequence concrete:

- what will be changed/deleted
- scope/count
- whether recovery exists
- downstream effect

Avoid generic:

> Are you sure?

## 23.4 Autosave

Autosave can reduce loss and explicit save burden, but creates new state questions.

Represent meaningful states:

```text
Saved
Saving…
Unsaved changes
Save failed
Offline — changes stored locally
Conflict
```

Do not show a permanent `Saved` badge that provides no information.

## 23.5 Dirty state

If leaving can lose work, the interface must know and communicate that state.

Do not warn about unsaved changes when nothing changed.

## 23.6 Version/revision recovery

For high-value editable artifacts, consider:

- history
- restore previous version
- audit trail
- named checkpoints

This can be superior to relying on one linear undo stack across long sessions.

## 23.7 Drag/drop reversibility

Apple explicitly recommends undo for drag/drop where feasible and confirmation for non-undoable drops with serious consequence [APPLE-DRAG].

---

# 24. Offline, synchronization, conflict and collaboration

Distributed state is UI state.

A product that syncs across devices/people cannot hide all synchronization semantics and still remain trustworthy when conflicts occur.

## 24.1 Connectivity state

Distinguish:

```text
ONLINE
OFFLINE
RECONNECTING
DEGRADED
```

Do not use a generic error toast every time the network disappears.

## 24.2 Local vs remote persistence

Where users can continue offline, make it clear whether work is:

- stored locally
- queued for sync
- synchronized remotely
- failed to sync

Android's offline-first architecture guidance explicitly notes that offline writes can create conflicts requiring reconciliation [ANDROID-OFFLINE].

## 24.3 Sync state

Useful states include:

```text
Synced
Syncing
Pending changes
Sync failed
Stale remote data
Conflict
```

Show them only when they change user decisions or confidence; do not turn normal invisible sync into constant noise.

## 24.4 Conflict

When two valid versions diverge, the UI may need to show:

- what changed
- who/what changed it
- versions/timestamps
- automatic merge result
- manual resolution where necessary

“Something went wrong” is inadequate for a true data conflict.

## 24.5 Collaboration state

Collaborative products may need to represent:

- who has access
- permission level
- shared vs private scope
- active presence
- edit ownership/locks where relevant
- mentions/comments
- recent changes

Apple's collaboration guidance emphasizes convenient sharing and permission management within the collaborative context [APPLE-COLLAB].

## 24.6 Presence

Do not use presence indicators as decoration.

Presence is useful when it helps users coordinate:

- who is viewing
- who is editing
- where conflict might arise

## 24.7 Permission changes

When access changes during a session:

- explain the new state
- preserve unsent work where possible
- stop unauthorized external effects
- offer request/escalation path when appropriate

## 24.8 Shared AI/agent work

If an automated agent can modify shared artifacts, show whether actions were:

- user-authored
- collaborator-authored
- agent-authored
- pending approval

Provenance becomes part of collaboration UI.

---

# 25. Motion and transitions

UI motion is strongest when it explains state or spatial relationship.

Use motion to communicate:

- where something came from
- where it went
- what changed
- causal relationship
- hierarchy
- continuity between states

Do not animate because motion itself signals “modern.”

## 25.1 Motion hierarchy

Prefer:

```text
STATE-EXPLAINING MOTION
>
ORIENTATION MOTION
>
SUBTLE POLISH
>
DECORATIVE LOOPING MOTION
```

where the task supports it.

## 25.2 Continuity

When a user opens an item into a detail view, transition can help preserve object continuity if it does not delay operation.

When a panel appears from a button, spatial origin can clarify scope.

## 25.3 Motion timing

There is no universal perfect duration/easing curve.

Choose according to:

- travel distance
- complexity
- input immediacy
- platform conventions
- need for comprehension

The interface should never feel as if animation is withholding control.

## 25.4 Reduced motion

Respect reduced-motion preferences and ensure the meaning of a state change survives without animation.

The Design Principles playbook already treats motion as a semantic/perceptual tool rather than decoration [DESIGN-V2].

## 25.5 Avoid motion-only confirmation

If an item silently flies away after deletion, users may miss the outcome.

Use persistent enough visual/state feedback, and assistive status where needed.

---

# 26. Localization, content expansion and RTL UI

Localization changes interface geometry and interaction, not only strings.

## 26.1 Content expansion

Design components to survive:

- longer labels
- shorter labels
- multiline labels
- languages with different word-break behavior
- larger text settings

Do not encode product meaning into a component width that only fits English.

## 26.2 Truncation

Truncate only when:

- preserving layout is materially valuable
- full value remains accessible elsewhere
- users can still distinguish items

Do not truncate the differentiating end of strings if that destroys recognition.

## 26.3 RTL

RTL can affect:

- navigation direction
- pane order
- text alignment
- directional arrows
- progress flow
- back/forward semantics
- disclosure icons

But do not mechanically mirror:

- logos
- numbers where conventions differ
- media transport symbols where universal direction should remain
- real-world objects that have inherent orientation

Use current platform localization guidance and test actual mixed-script content [APPLE-RTL].

## 26.4 Data formats

Account for:

- decimal separators
- currency
- dates/times
- names
- addresses
- phone numbers
- sorting/collation

These can change field width and data alignment.

## 26.5 Pseudo-localization

Use pseudo-localization before translation to expose:

- hardcoded strings
- clipping
- concatenation
- unexpandable controls
- RTL assumptions

## 26.6 Localization vs platform familiarity

Preserve local platform conventions where they affect comprehension, but do not redesign the entire information architecture from stereotypes about a culture.

---

# 27. Accessibility as a UI quality floor

Accessibility is not a variant of the interface.

It constrains the default interaction contract.

## 27.1 Current normative baseline

For web products, WCAG 2.2 remains the current Recommendation-level baseline in this playbook [W3C-WCAG22].

The September 2026 WCAG 3 material is explicitly an in-progress Working Draft whose final requirements and conformance model will change [W3C-WCAG3].

V2 rule:

> Monitor WCAG 3, but do not replace WCAG 2.2 compliance decisions with draft requirements.

## 27.2 Accessibility dimensions

A UI review should include:

```text
SEMANTICS
KEYBOARD
FOCUS
TARGETS
CONTRAST
TEXT SCALING / REFLOW
NON-COLOR MEANING
MOTION
STATUS ANNOUNCEMENT
INPUT MODALITY
DRAG/GESTURE ALTERNATIVES
LOCALIZATION
```

## 27.3 Name, role, value/state

Interactive controls need meaningful semantics that assistive technologies can determine.

Prefer native controls where possible; custom ARIA controls inherit full behavior responsibility [W3C-APG-README][W3C-APG-NAMES].

## 27.4 Visible labels

When visible text can label a control, WAI-ARIA APG recommends preferring it because it improves maintainability and comprehension beyond screen-reader use [W3C-APG-NAMES].

## 27.5 Non-text contrast

Required visual information used to identify components and states needs sufficient contrast under applicable WCAG criteria; decorative or inactive elements have different scope/exceptions [W3C-NON-TEXT].

Do not turn this into:

> Every border must be 3:1.

The criterion applies to visual information required to identify the component/state.

## 27.6 Color independence

State should not depend on color alone.

Examples:

- error = red + icon/text
- selected = color + shape/check/position
- status = color + label/icon

## 27.7 Zoom and reflow

Test real components at increased text size and zoom.

A responsive screenshot at one narrow breakpoint is not evidence of accessible reflow.

## 27.8 Manual testing

Automated tooling cannot prove:

- sensible focus movement
- understandable labels
- correct keyboard grammar
- usable screen-reader workflow
- cognitive clarity

Use automated checks to find classes of defect, then test representative interactions manually.

## 27.9 Accessibility evaluation methodology

For formal evaluation, use current W3C methodology/guidance appropriate to the product and conformance goal rather than inventing an internal “accessibility score.”

## 27.10 Catastrophic failure cannot be averaged away

A core task inaccessible to keyboard users is not balanced out by high scores on aesthetics or consistency.

This follows the same non-averaging principle used in the companion UX and Design playbooks [UX-V2][DESIGN-V2].

---

# 28. AI-native and agentic UI

AI creates UI problems because capability and state are probabilistic, adaptive and sometimes delegated.

Classic UI rules still apply.

Additional requirements concern:

- uncertainty
- provenance
- action scope
- oversight
- correction
- autonomy
- auditability

## 28.1 Chat is one interface pattern

Do not assume:

```text
AI capability
=
chat box
```

Use conversation when intent is open-ended or hard to parameterize.

Use structured/direct UI when:

- objects already exist
- state is known
- exact selection matters
- comparison matters
- repetitive actions benefit from controls

Often use hybrid interaction:

```text
CONVERSATION
+
STRUCTURED GENERATED UI
+
DIRECT MANIPULATION
```

## 28.2 Capability boundary

Before consequential use, expose enough for users to understand:

- what the system can access
- what it can modify
- what it can send/publish
- what requires approval
- whether data/output is generated or verified

Microsoft's Human-AI Interaction Guidelines explicitly address expectation setting, feedback, correction and behavior over time [MS-HAI].

## 28.3 Appropriate reliance

The goal is not maximum trust.

Microsoft's research synthesis defines appropriate reliance as accepting correct output and rejecting incorrect output [MS-RELIANCE].

UI implications:

- show evidence/source/context when decision-relevant
- make correction cheap
- avoid confidence theater
- separate generated suggestion from committed system state

## 28.4 Suggestion vs action

Make a clear visual/behavioral distinction between:

```text
AI proposes
vs
AI has executed
```

Do not render a draft email as if it has been sent.

Do not render a planned calendar edit as if it already changed the calendar.

## 28.5 Agent state model

Long-running agents may need states such as:

```text
PLANNING
WAITING FOR INPUT
WAITING FOR APPROVAL
EXECUTING
USING TOOL / EXTERNAL SYSTEM
BLOCKED
RETRYING
PARTIALLY COMPLETE
COMPLETE
FAILED
CANCELLED
```

A single animated “Working…” surface is inadequate when the agent can produce external effects.

## 28.6 Oversight model

2026 empirical research with experienced developers found oversight work can include:

- a priori control
- co-planning
- real-time monitoring
- post-hoc review [MS-OVERSIGHT]

Design the interface to support the oversight form appropriate to the task.

## 28.7 Checkpoints

Do not require approval at every micro-step by default.

Do not wait until the end of a long consequential workflow by default either.

A CHI 2026 study of 48 participants found an intermediate-checkpoint strategy was preferred over confirm-at-end by 81% and reduced completion time in the tested multi-step tasks [CHI-CHECKPOINT].

The effect size/timing is context-specific.

Evergreen rule:

> Place checkpoints before expected correction cost becomes unacceptably high.

## 28.8 Approval UI

Before approval, show:

```text
WHAT WILL HAPPEN
WHAT OBJECTS ARE AFFECTED
WHICH EXTERNAL SYSTEMS ARE INVOLVED
WHO WILL SEE THE RESULT
WHETHER IT CAN BE UNDONE
```

Do not ask users to approve raw tool-call syntax when a human-readable consequence can be shown.

## 28.9 Action history / audit

Consequential agent work should preserve a comprehensible history of:

- request
- relevant plan/scope
- actions
- approvals
- failures/retries
- external effects
- final result

Raw logs are not automatically usable audit UI.

## 28.10 Takeover and manual override

Users should be able to take control when:

- the model is wrong
- the task becomes ambiguous
- repeated retries fail
- stakes increase

Do not make manual control feel like exiting the product into a hidden expert mode.

## 28.11 Correction

Support where appropriate:

- edit
- reject
- retry
- regenerate
- revert
- change source/context
- constrain
- switch to deterministic/manual flow

## 28.12 AI visual treatment

An “AI sparkle” or gradient is not transparency.

Use visual distinction only if it communicates a meaningful state such as:

- generated content
- AI-assisted value
- unreviewed suggestion

Carbon's AI guidance similarly treats AI presence/explainability/manual control as product meaning rather than decoration [CARBON-AI].

---

# 29. Design systems, tokens, governance and lifecycle

A design system is an operational system for reusable interface decisions.

It is not just:

- Figma components
- CSS variables
- React components
- a brand library

## 29.1 Four layers

```text
PRINCIPLES
→ TOKENS / FOUNDATIONS
→ COMPONENTS
→ PATTERNS
→ PRODUCT COMPOSITIONS
```

The playbook governs the decision logic above individual implementations.

## 29.2 Component definition of done

A production component should define:

```yaml
purpose:
when_to_use:
when_not_to_use:
anatomy:
variants:
states:
behavior:
keyboard:
focus:
semantics:
responsive_behavior:
localization:
content_rules:
loading_error_empty:
tokens:
tests:
accessibility:
version_status:
```

Carbon's contribution checklist likewise treats stable components as requiring design/code/documentation quality rather than mere existence [CARBON-COMPONENT].

## 29.3 Tokens

Design tokens represent reusable design decisions.

Prefer semantic intent:

```text
text-primary
surface-raised
action-primary
border-critical
focus-ring
```

rather than making product code depend on raw palette/spacing values.

## 29.4 DTCG status

The Design Tokens Community Group's 2025.10 format is the first stable vendor-neutral specification [DTCG-2025].

Important status distinction:

> It is a stable Final Community Group Report, not a W3C Recommendation.

Use it for interoperability where it fits; do not present it as a normative web standard.

## 29.5 Token architecture

Separate where useful:

```text
PRIMITIVE / BASE
→ SEMANTIC
→ COMPONENT
```

Do not force every system into exactly three layers if simpler architecture is sufficient.

## 29.6 Token governance

Define:

- naming
- ownership
- allowed alias depth
- deprecation
- theme behavior
- migration
- fallback
- documentation

Without governance, tokens can multiply into a second form of hardcoding.

## 29.7 Component lifecycle

Use explicit maturity states such as:

```text
EXPERIMENTAL / EARLY ACCESS
→ BETA
→ STABLE / GENERAL AVAILABILITY
→ DEPRECATION NOTICE
→ DEPRECATED
→ REMOVED
```

Atlassian currently documents this style of release/deprecation lifecycle [ATLAS-RELEASE].

## 29.8 Deprecation

Do not silently remove a widely used component.

A mature deprecation should provide:

- reason
- replacement
- migration path
- timeline
- compatibility notes

## 29.9 Forking a component

Create a new variant/component only when the semantic/behavioral need differs materially.

Do not fork because:

- one page needs 2px different padding
- a local designer dislikes the default
- a campaign wants novelty

Local one-off forks are design debt.

## 29.10 Escape hatches

A good system needs controlled flexibility.

If teams cannot solve legitimate edge cases without breaking the system, they will bypass it.

Define:

- extension points
- composition patterns
- contribution route
- documented exceptions

## 29.11 Consistency vs stagnation

Consistency reduces relearning.

It does not mean old patterns may never be replaced.

Change when:

```text
measured/product benefit
>
relearning + migration + fragmentation cost
```

## 29.12 System metrics

Useful internal measures can include:

- adoption
- duplicate components
- accessibility defect rate
- migration lag
- design/code parity
- deprecated usage

Do not treat component adoption percentage as proof of user value.

---

# 30. UI testing and measurement

UI quality is not proven by a design review.

Test the interaction model.

## 30.1 What to test

### Findability

Can users identify:

- primary action
- navigation destination
- interactive control

### State comprehension

Can users tell:

- selected vs focused
- saved vs unsaved
- online vs offline
- loading vs failed
- draft vs committed

### Operation

Can they successfully:

- activate
- enter data
- navigate keyboard
- select
- recover

### Error rate

Measure:

- wrong targets
- accidental destructive actions
- repeated activation
- invalid input
- failed recovery

### Efficiency

For repeated tasks:

- time to locate control
- interaction count
- keyboard/pointer path
- repeated context switching

### Accessibility

- keyboard completion
- focus order
- screen-reader workflow
- zoom/reflow
- target/contrast checks

## 30.2 Test states, not only happy screens

A component review that only inspects default state is incomplete.

Test:

```text
EMPTY
LOADING
LONG CONTENT
ERROR
DISABLED
READ-ONLY
OFFLINE
PERMISSION DENIED
LOCALIZED
ZOOMED
KEYBOARD FOCUS
MULTISELECT
```

## 30.3 Component lab testing

Before product rollout, component-level tests can catch:

- focus bugs
- keyboard bugs
- theme contrast
- state inconsistencies
- truncation
- RTL

But component isolation cannot prove product-level usability.

## 30.4 Task-level usability

Evaluate components inside realistic tasks, because component quality depends on composition/context.

A perfect select component can still be the wrong component for the decision.

## 30.5 Preference vs performance

Do not equate:

> “This looks cleaner.”

with:

> “Users find and operate it more successfully.”

The companion design/UX playbooks already separate visual preference, perceived usability and objective performance [DESIGN-V2][UX-V2].

## 30.6 Instrumentation

Useful event/state telemetry may include:

- open/close
- invalid submission
- repeated click/tap
- undo
- retry
- filter clear
- overflow-menu use
- shortcut vs visible path

Interpret behavior cautiously; telemetry cannot always infer intent.

## 30.7 Experiment meaningful uncertainty

Good candidates:

- persistent vs collapsed secondary navigation
- alternative information density
- two plausible filtering structures
- two validated action hierarchies

Poor candidates:

- inaccessible vs accessible focus
- deceptive vs transparent consent
- random icon spacing

## 30.8 Cross-input testing

Material interfaces should be tested with the actual relevant inputs:

- keyboard only
- mouse/trackpad
- touch
- screen reader
- zoom/text scaling

Do not assume one input proves all.

---

# 31. UI decision tree

Use this sequence before choosing a component.

## Step 1 — What is the user trying to do at this exact surface?

Choose the dominant operation:

```text
ORIENT
NAVIGATE
FIND
READ
COMPARE
SELECT
EDIT
CREATE
MOVE
APPROVE
MONITOR
RECOVER
```

## Step 2 — What object/state does the operation affect?

Make scope explicit.

## Step 3 — What must be visible simultaneously?

If comparison/context matters, do not hide it merely to save space.

## Step 4 — What state transitions exist?

List them before styling.

## Step 5 — What is the frequency?

```text
rare
occasional
frequent
continuous
```

Frequent actions justify more direct access/accelerators.

## Step 6 — What is the consequence?

```text
low + reversible
material
high + hard to reverse
```

Increase review/friction with consequence.

## Step 7 — What input modalities matter?

Do not choose a pattern that only works for the designer's mouse.

## Step 8 — What convention already exists?

Use familiar semantics unless the improvement is material.

## Step 9 — What space/context exists?

Adapt presentation while preserving meaning.

## Step 10 — What happens under latency/failure/offline?

If undefined, the UI is incomplete.

## Step 11 — What happens with long/localized content and zoom?

If unknown, the component is not ready.

## Step 12 — What evidence is needed?

If two plausible patterns remain, test the material uncertainty.

---

# 32. Pattern selection matrices

## 32.1 Action surface

| Need | Strong candidate |
|---|---|
| Important immediate action | Button |
| Navigate to destination | Link |
| Repeated related commands | Toolbar |
| Secondary contextual commands | Menu / context menu |
| Keyboard-heavy broad command set | Command palette as accelerator |
| Destructive high-consequence commit | Review/confirmation surface |

## 32.2 Selection

| Need | Strong candidate |
|---|---|
| Independent multiple choices | Checkbox |
| One choice with visible comparison | Radio group |
| Binary setting whose state changes immediately | Switch/toggle convention |
| One value from compact hidden set | Select |
| Search/filter a large option set | Combobox |
| Browse/select one from structured visible list | Listbox |
| Very small peer-state switch | Segmented control |
| Approximate continuous value | Slider |
| Exact numeric value | Numeric/text input, possibly with step controls |

These are starting points; semantics outrank numeric option-count folklore.

## 32.3 Overlay

| Need | Strong candidate |
|---|---|
| Tiny supplemental explanation | Tooltip |
| Small contextual interaction | Popover |
| Secondary inspect/edit while preserving context | Drawer / sheet / inspector |
| Bounded blocking decision | Modal dialog |
| Temporary noncritical status | Toast |
| Persistent page/system status | Banner/message bar |
| Complex dominant workflow | Full view/page |

## 32.4 Collection representation

| User task | Strong candidate |
|---|---|
| Sequential scan | List |
| Aligned comparison | Table |
| Interactive cell navigation/edit | Grid |
| Composite visual objects | Cards |
| Parent/child hierarchy | Tree |
| Workflow-state movement | Board |
| Continuous editorial/social content | Feed |

## 32.5 Navigation

| Need | Strong candidate |
|---|---|
| Frequent top-level destinations | Persistent nav / sidebar / platform equivalent |
| Compact-space primary nav | Adaptive compact navigation |
| Peer views within one context | Tabs |
| Hierarchical location | Breadcrumb / hierarchical nav |
| Known direct target | Search |
| Expert known command/destination | Command palette accelerator |
| Mandatory sequence | Step/progress flow, not peer tabs |

---

# 33. Practical UI templates

## 33.1 Component brief

```yaml
component:
purpose:
user_task:
frequency:
consequence:
platforms:
input_modalities:

anatomy:
variants:
primary_action:
secondary_actions:

states:
  - default
  - hover
  - focus
  - pressed
  - selected
  - disabled
  - read_only
  - loading
  - error
  - empty

keyboard_model:
focus_model:
accessible_name:
role_semantics:

responsive_behavior:
localization_behavior:
rtl_behavior:
content_limits:

failure_behavior:
recovery:
undo:

when_to_use:
when_not_to_use:
alternatives:

tokens:
tests:
evidence:
```

## 33.2 State brief

```yaml
state:
trigger:
object_scope:
what_changed:
visual_signal:
semantic_signal:
available_actions:
unavailable_actions:
focus_behavior:
persistence:
exit_condition:
failure_path:
recovery:
```

## 33.3 Responsive/adaptive brief

```yaml
surface:
minimum_viable_width:
preferred_width:
reflow:
reveal:
presentation_change:
overflow:
large_window_behavior:
small_window_behavior:
software_keyboard:
safe_areas:
text_growth:
zoom:
rtl:
```

## 33.4 Data-interface brief

```yaml
dataset:
primary_task:
record_count:
schema:
comparison_need:
lookup_need:
editing_need:
selection:
select_all_scope:
bulk_actions:
sort:
filter:
search:
virtualization:
pagination_model:
state_preservation:
density_modes:
keyboard_model:
loading:
empty:
error:
```

## 33.5 Overlay brief

```yaml
trigger:
reason_overlay_is_needed:
modal: true|false
scope:
primary_decision:
dismissal:
focus_entry:
focus_trap:
focus_return:
background_behavior:
mobile_adaptation:
error_state:
recovery:
```

## 33.6 Agentic UI brief

```yaml
user_goal:
agent_capability:
actions_allowed:
external_systems:
consequence:
uncertainty:
plan_visibility:
agent_states:
approval_points:
checkpoint_logic:
source_evidence:
manual_takeover:
edit_reject_retry:
undo_or_rollback:
audit_history:
failure_and_partial_completion:
```

## 33.7 Design-system component lifecycle brief

```yaml
component:
owner:
status: experimental|beta|stable|deprecated
problem_solved:
alternatives_reviewed:
behavior_contract:
accessibility:
platforms:
tokens:
tests:
adoption:
breaking_changes:
deprecation_plan:
replacement:
migration_path:
```

---

# 34. UI review checklist

Use this for feature/component/product reviews. A checked box should mean **observed/verified**, not “designer believes so.”

## Purpose and scope

- [ ] The primary user task at this surface is explicit.
- [ ] The object/context affected by each action is clear.
- [ ] Product/backend architecture is not unnecessarily exposed.
- [ ] The interface is the smallest coherent representation of the task, not merely the sparsest.

## Hierarchy

- [ ] The most important current information/action is findable.
- [ ] Secondary actions are visibly subordinate.
- [ ] Related information is grouped.
- [ ] Containers express real grouping rather than decoration.
- [ ] Dense information remains scannable.
- [ ] No decorative element competes with operational state.

## Affordance

- [ ] Interactive elements look plausibly interactive.
- [ ] Editable values are distinguishable from static values.
- [ ] Expandable regions signal expansion.
- [ ] Drag affordance is discoverable when drag is important.
- [ ] Icon-only controls are familiar enough or visibly labeled.
- [ ] Essential functionality is discoverable without hover.

## Semantics

- [ ] Button/link/control semantics match behavior.
- [ ] Custom widgets have an explicit keyboard model.
- [ ] Accessible names are present and meaningful.
- [ ] Visible labels are used where practical.
- [ ] State/role/value is programmatically available where required.

## State

- [ ] Default state defined.
- [ ] Hover defined where relevant.
- [ ] Focus defined.
- [ ] Pressed/active defined.
- [ ] Selected/checked defined where relevant.
- [ ] Disabled/read-only/hidden choices are intentional.
- [ ] Loading defined.
- [ ] Empty/no-results distinguished.
- [ ] Error defined.
- [ ] Offline/degraded defined where relevant.
- [ ] Dirty/saved/sync/conflict defined for persisted work.
- [ ] Permission/ownership state defined.
- [ ] AI/agent state defined where relevant.

## Actions

- [ ] Primary action represents actual task priority.
- [ ] Frequent actions are not buried unnecessarily.
- [ ] Overflow contains genuinely secondary actions.
- [ ] Destructive actions are distinguishable.
- [ ] Consequence/scope is visible before high-risk commit.
- [ ] Undo exists for reasonably reversible actions.
- [ ] Standard platform shortcuts are preserved.

## Focus and keyboard

- [ ] Core tasks can be completed by keyboard where required.
- [ ] Focus is visible.
- [ ] Focus order follows task/semantic order.
- [ ] Focus is not confused with selection.
- [ ] Composite widgets use a coherent internal navigation model.
- [ ] Opening/closing overlays restores focus logically.
- [ ] Async loading does not steal focus.
- [ ] No accidental focus traps exist.

## Touch/pointer/input

- [ ] Targets are sufficiently easy to acquire for the context.
- [ ] Small adjacent targets do not create avoidable error risk.
- [ ] Essential functionality does not require hover.
- [ ] Pointer activation can be cancelled/undone where applicable.
- [ ] Drag has an alternative where required/feasible.
- [ ] Gestures supplement rather than conceal critical controls.

## Forms

- [ ] Labels persist.
- [ ] Group purpose is clear.
- [ ] Helper text appears before the decision/input it supports.
- [ ] Required/optional status is unambiguous.
- [ ] Input format is forgiving where possible.
- [ ] Validation timing is not prematurely hostile.
- [ ] Error messages are adjacent/associated and actionable.
- [ ] Valid input survives errors.
- [ ] Error summary is used where a long/complex form needs it.

## Overlays

- [ ] The overlay type matches interruption need.
- [ ] Modal use is justified.
- [ ] Dialog focus is managed.
- [ ] Escape/dismissal is predictable.
- [ ] Nested modality is avoided unless genuinely justified.
- [ ] Tooltip contains only supplemental nonessential content.
- [ ] Toast is not the sole carrier of critical information.
- [ ] Persistent system status uses a persistent enough surface.

## Navigation

- [ ] Global, local and contextual navigation are distinguishable.
- [ ] High-frequency destinations have sufficient information scent.
- [ ] Hidden navigation is justified by context/space.
- [ ] Tabs represent peer content, not a mandatory sequence.
- [ ] Automatic tab activation has negligible latency.
- [ ] Back behavior matches platform/web expectations.
- [ ] Search/filter/sort/scroll state is preserved where refinding matters.

## Collections and data

- [ ] Representation matches task (list/table/grid/card/tree/board/feed).
- [ ] Table is used for aligned data rather than “enterprise look.”
- [ ] ARIA grid is used only when its interaction model is needed.
- [ ] Selection is visibly distinct from hover/focus.
- [ ] Select-all scope is unambiguous.
- [ ] Batch actions clearly reference selected items.
- [ ] Virtualized data exposes correct position/size semantics where needed.
- [ ] Sticky/frozen regions leave enough usable viewport.

## Loading and persistence

- [ ] Input receives prompt feedback.
- [ ] Loading scope matches affected region.
- [ ] Progress is truthful.
- [ ] Determinate progress is based on real progress.
- [ ] Skeletons represent dynamic loading, not static chrome.
- [ ] Background work can continue without blocking where safe.
- [ ] Optimistic UI has a failure/reconciliation path.
- [ ] Autosave exposes failure/conflict where it matters.

## Responsive/adaptive

- [ ] Narrow window tested.
- [ ] Wide window tested.
- [ ] Resizing tested live, not just at screenshots.
- [ ] State survives layout transformation.
- [ ] Additional large-screen space is used intentionally.
- [ ] Software keyboard does not hide critical controls.
- [ ] Safe-area/system overlays considered.
- [ ] Orientation is not unnecessarily locked.
- [ ] Zoom/text expansion tested.

## Localization

- [ ] Long strings tested.
- [ ] Variable date/number/currency formats tested.
- [ ] RTL behavior defined where relevant.
- [ ] Directional icons reviewed rather than blindly mirrored.
- [ ] Truncation preserves distinguishing information.
- [ ] Pseudo-localization has been run on major components.

## Accessibility

- [ ] WCAG 2.2 scope/relevant success criteria reviewed.
- [ ] Keyboard test completed.
- [ ] Screen-reader/assistive semantics tested where material.
- [ ] Non-text contrast checked.
- [ ] Color is not the sole carrier of meaning.
- [ ] Target size/spacing checked.
- [ ] Reflow/zoom checked.
- [ ] Motion can be reduced.
- [ ] Status changes can be announced without focus stealing.
- [ ] Critical failure is not hidden by an aggregate quality score.

## AI/agentic

- [ ] Generated suggestion vs executed action is clear.
- [ ] Agent capability/scope is understandable.
- [ ] External effects are visible before approval.
- [ ] Agent state is more informative than generic “working.”
- [ ] Checkpoints scale with correction cost.
- [ ] User can edit/reject/retry/take over where appropriate.
- [ ] Important provenance/audit history exists.
- [ ] Partial completion/failure is represented honestly.

## Design system

- [ ] Existing component was reviewed before creating a new one.
- [ ] New variant has semantic/behavioral justification.
- [ ] Component contract includes behavior, states and accessibility.
- [ ] Tokens represent reusable decisions.
- [ ] Experimental/beta/stable status is explicit.
- [ ] Deprecated components have replacement/migration guidance.
- [ ] Product overrides are tracked instead of silently forking the system.

---

# 35. UI anti-playbook — what not to do

## 35.1 Treat “clean” as the primary UI objective

Removing useful labels, state and controls can increase discovery and memory cost.

## 35.2 Equate fewer visible controls with simpler interaction

Hidden actions still exist; the user now has to find/remember them.

## 35.3 Make every control equally prominent

No hierarchy means every decision becomes work.

## 35.4 Hide all secondary actions in `…`

Overflow lowers information scent [NN-CONTEXT-MENU].

## 35.5 Hide frequent actions in context menus

Context menus are strongest for secondary/contextual commands.

## 35.6 Require right-click as the only path

Many users/devices will never discover it.

## 35.7 Use icon-only navigation because text looks cluttered

Labels often provide critical semantics.

## 35.8 Assume an icon is universal because the product team recognizes it

Internal familiarity is not user familiarity.

## 35.9 Reveal the label only on hover

Touch/keyboard users and first-time scanning pay the cost.

## 35.10 Make static text look like a link/button

False affordance encourages trial-and-error.

## 35.11 Make links and buttons interchangeable

Navigation and action have different semantics/behavior [USWDS-BUTTON].

## 35.12 Style a generic element as a button and add `role=button`

ARIA does not create native keyboard behavior [W3C-APG-README].

## 35.13 Add ARIA without understanding the pattern

Bad ARIA can make an interface less accessible [W3C-APG-README].

## 35.14 Remove the focus ring because it looks ugly

Replace it with a deliberate focus treatment; do not remove operability.

## 35.15 Make selected state and focus state identical

They represent different concepts.

## 35.16 Let hover look like selection

Hover disappears; selection persists.

## 35.17 Change selection automatically whenever focus moves when selection has a costly side effect

Separate focus and activation in those cases [W3C-APG-TABS].

## 35.18 Use automatic tab activation when each panel is slow

Keyboard navigation becomes a chain of latency [W3C-APG-TABS].

## 35.19 Put every descendant of a complex widget in the global Tab sequence

Established composites often need one Tab stop plus internal navigation [W3C-APG-KEYBOARD].

## 35.20 Invent a unique keyboard grammar for a standard widget

Transferred knowledge is valuable.

## 35.21 Move focus because data finished loading

Status update does not equal interaction relocation.

## 35.22 Focus a toast to make sure screen readers hear it

Use appropriate status semantics rather than stealing focus [W3C-STATUS].

## 35.23 Trap focus accidentally

Every focus entry needs a predictable exit unless a true modal deliberately contains focus.

## 35.24 Hide focused controls beneath sticky UI

WCAG 2.2 addresses focus obscuration [W3C-FOCUS-OBSCURED].

## 35.25 Execute destructive actions on pointer-down

Give users a chance to abort unless down-event execution is essential [W3C-POINTER-CANCEL].

## 35.26 Assume mouse hover exists because the screen is large

Hybrid laptops/tablets invalidate device stereotypes.

## 35.27 Make drag the only way to reorder

Provide an alternative [W3C-DRAG][ATLAS-DRAG].

## 35.28 Hide all drag affordance even when reordering is a primary task

Users cannot infer invisible manipulation reliably.

## 35.29 Put multiple tiny destructive targets shoulder-to-shoulder

Target acquisition error is predictable.

## 35.30 Treat 24×24 CSS px as the ideal target

WCAG's value is an AA minimum criterion with exceptions, not a universal optimum [W3C-TARGET].

## 35.31 Treat Android's 48dp target convention as universal web science

Platform guidance has scope [ANDROID-TARGET].

## 35.32 Disable every action until the form is valid without showing why

Unavailable action becomes a mystery.

## 35.33 Ban disabled submit buttons universally

Context matters; the actual standard is understandable requirements and recovery.

## 35.34 Put the only explanation in a tooltip on a native disabled control

Native disabled controls may not receive focus/events [ATLAS-DISABLED].

## 35.35 Make every disabled item keyboard-focusable

This can create excessive key presses; discoverability tradeoffs differ [W3C-APG-KEYBOARD].

## 35.36 Make no disabled items focusable ever

Composite patterns sometimes preserve focusability for discoverability [W3C-APG-KEYBOARD].

## 35.37 Use disabled styling for information users still need to read

Use a read-only treatment where appropriate [CARBON-INPUT].

## 35.38 Hide temporarily unavailable functionality when users need to understand the workflow

They may conclude the capability does not exist.

## 35.39 Show actions a role can never use merely to demonstrate features

Permanent irrelevant controls can be noise.

## 35.40 Use placeholder text as the only label

Visible/persistent labels are more robust [W3C-APG-NAMES].

## 35.41 Validate as error on the first keystroke

Do not call incomplete in-progress entry “wrong.”

## 35.42 Clear valid form fields because another field failed

Preserve effort.

## 35.43 Use a switch just because it looks modern

Choose by binary-setting semantics, not style.

## 35.44 Claim switches normatively mean “instant server save”

Immediate-effect behavior is a strong design-system convention, not the ARIA semantic definition [W3C-APG-SWITCH][FLUENT-SWITCH].

## 35.45 Use a checkbox for one mutually exclusive choice

Use a single-choice pattern.

## 35.46 Use radio buttons for independent multiple choices

Use checkboxes.

## 35.47 Use dropdowns for everything to save space

Compactness hides options and adds interaction [BAYMARD-DROPDOWN].

## 35.48 Treat “five options” or “ten options” as universal control thresholds

Those numbers are contextual findings/heuristics, not laws.

## 35.49 Use a listbox as a container for arbitrary buttons, links and complex controls

The pattern has defined option semantics [W3C-APG-LISTBOX].

## 35.50 Use a combobox when users do not benefit from typing/filtering or popup selection

Complex controls should earn complexity.

## 35.51 Use tabs as a multi-step wizard

Peer views are not mandatory sequence.

## 35.52 Use tabs when users must compare all panels simultaneously

Hidden peer content raises memory cost.

## 35.53 Let tab labels overflow into an undiscoverable hidden strip

Change pattern or provide an explicit overflow strategy.

## 35.54 Use accordions because scrolling feels “too long”

Scrolling itself is not a problem if most content is needed.

## 35.55 Nest accordions as an information architecture

Progressive disclosure becomes progressive disorientation [GOV-ACCORDION].

## 35.56 Put critical decision evidence behind “Learn more”

Disclosure cannot justify withholding information needed now.

## 35.57 Use tooltips for essential instructions

Tooltips are supplemental [ATLAS-TOOLTIP][FLUENT-TOOLTIP].

## 35.58 Put forms/buttons inside a classic tooltip

Use a popover/dialog pattern.

## 35.59 Show hover content that cannot be hovered or dismissed

Applicable WCAG hover/focus requirements address this [W3C-HOVER].

## 35.60 Use a toast for a blocking error

Transient feedback is the wrong persistence/severity.

## 35.61 Use a modal for passive success feedback

Do not interrupt when passive feedback is enough.

## 35.62 Put long multi-stage workflows inside narrow modal dialogs

Use a full task surface when work becomes dominant.

## 35.63 Nest modals as a routine navigation hierarchy

It multiplies focus/context complexity [APPLE-MODALITY][FLUENT-DIALOG].

## 35.64 Ban every possible nested modal as an absolute law

Rare higher-priority subdialogs/alerts can exist; design them carefully [W3C-APG-DIALOG].

## 35.65 Make drawers the dumping ground for anything that should not be a page

Secondary surfaces need bounded scope.

## 35.66 Cardify every section

Borders/containers are grouping tools, not a universal style.

## 35.67 Use cards for aligned numerical comparison

Tables often provide better shared alignment.

## 35.68 Use tables because the product should look “enterprise”

Choose from the task.

## 35.69 Use ARIA grid for a read-only table

Grid adds keyboard/focus responsibilities [W3C-APG-GRID][W3C-APG-TABLE].

## 35.70 Turn every table into a spreadsheet

Not every data task needs cell-level editing/navigation.

## 35.71 Use hover as row selection

Selection needs persistent state.

## 35.72 Make “Select all” ambiguous in a paginated/filterable dataset

Scope mistakes can affect thousands of records.

## 35.73 Virtualize huge tables without accessibility semantics

Partial DOM can misrepresent position/total [W3C-GRID-PROPS].

## 35.74 Let virtualization unmount the keyboard-focused row without a focus strategy

Visual performance cannot destroy operability.

## 35.75 Freeze so many table columns that no data space remains at zoom

Persistent context can become obstruction.

## 35.76 Reset search filters when a user returns from detail view

Refinding work is pure cost in many retrieval tasks.

## 35.77 Call technical load failure “No results”

Different states require different recovery.

## 35.78 Merge sort and filter into one ambiguous concept

Order and membership are different.

## 35.79 Use infinite scroll for a bounded audit/retrieval task

Users may need stable position and completion.

## 35.80 Ban infinite scroll for all content

Continuous discovery can legitimately benefit from dynamic feeds.

## 35.81 Implement infinite loading without assistive position/loading semantics

Dynamic feeds need explicit accessibility/state design [W3C-APG-FEED].

## 35.82 Paginate solely because it is familiar

Pagination also has transition/comparison costs.

## 35.83 Use a full-screen spinner for one loading widget

Scope waiting state to the unavailable region.

## 35.84 Skeletonize permanent navigation and already-available controls

Skeletons are primarily for dynamic content placeholders [FLUENT-SKELETON].

## 35.85 Fake exact progress

False precision is worse than honest indeterminate state [APPLE-PROGRESS].

## 35.86 Leave progress at 95% for minutes after racing there

Users infer stall or deception [APPLE-PROGRESS].

## 35.87 Optimistically show irreversible external success before confirmation

Optimism must be safely reconcilable.

## 35.88 Roll back optimistic UI silently

Users need to know their action failed.

## 35.89 Use confirmations for every reversible action

Prefer undo where it provides safer, faster recovery [APPLE-UNDO].

## 35.90 Use undo without showing what changed

Invisible undo results encourage repeated mistakes [APPLE-UNDO].

## 35.91 Autosave without a failure/conflict model

“Autosave” is not a magic guarantee.

## 35.92 Show “Saved” when only a local queue accepted the change

Local persistence and remote sync are different states.

## 35.93 Treat offline as generic error state

Offline can be a supported operating mode.

## 35.94 Silently overwrite collaborative conflicts whenever stakes are material

Conflict policy needs product/domain justification.

## 35.95 Display collaborator avatars when they have no coordination value

Presence is state, not decoration.

## 35.96 Lock the interface to portrait without an essential reason

Responsive products should adapt [W3C-ORIENTATION][ANDROID-ADAPT].

## 35.97 Design responsiveness as “desktop, tablet, mobile screenshots” only

Real windows resize and multitask.

## 35.98 Scale a phone layout wider without revealing useful context

Large space should improve simultaneous understanding where useful.

## 35.99 Remove core mobile capability before attempting a different presentation

Adapt representation first.

## 35.100 Hardcode English button widths

Localization will expose brittle geometry.

## 35.101 Mirror every icon in RTL

Directionality depends on meaning [APPLE-RTL].

## 35.102 Truncate identifiers so different items become visually identical

Preserve distinguishing information.

## 35.103 Use animation as the only evidence of a state change

Motion can be reduced/missed.

## 35.104 Make users wait for decorative transitions before acting

Motion should clarify, not gate.

## 35.105 Treat WCAG conformance as proof of excellent UI

Accessibility is a floor/constraint, not complete usability.

## 35.106 Treat an automated accessibility score as proof of keyboard/screen-reader usability

Manual interaction testing remains necessary.

## 35.107 Treat the September 2026 WCAG 3 draft as the current replacement standard

It remains in-progress and subject to material change [W3C-WCAG3].

## 35.108 Make all AI features look magical but hide capability boundaries

Trust requires state/scope, not sparkle graphics.

## 35.109 Make chat the only UI for deterministic structured work

Direct UI can be faster, clearer and more inspectable.

## 35.110 Show an AI plan and an executed result with identical styling

Proposal and committed state must differ.

## 35.111 Let an agent perform consequential multi-step work with no useful checkpoints

Correction cost can cascade [CHI-CHECKPOINT].

## 35.112 Ask for approval at every trivial agent step

Excessive confirmation becomes oversight fatigue.

## 35.113 Ask users to approve opaque tool-call syntax

Translate to consequences whenever possible.

## 35.114 Hide partial completion after an agent fails

The user needs to know what already changed externally.

## 35.115 Make agent logs the only audit interface

Raw logs are not a human-centered review model.

## 35.116 Use AI explanations as proof that output is correct

Appropriate reliance requires correction/verification, not persuasive prose [MS-RELIANCE].

## 35.117 Create a new design-system component for every local exception

Uncontrolled variants create system entropy.

## 35.118 Treat tokens as a collection of hex values and spacing numbers

Tokens should encode reusable decisions.

## 35.119 Call the DTCG report a W3C Recommendation

The stable 2025.10 format is a Final Community Group Report [DTCG-2025].

## 35.120 Remove stable components without a deprecation path

Mature systems need migration semantics [ATLAS-RELEASE].

---

# 36. Contradiction ledger

| Common advice | V2 conclusion |
|---|---|
| **Minimal UI is simpler** | False as a universal claim. Missing signifiers/state can increase effort. |
| **Show every available action** | Too strong. Rare/secondary actions can be disclosed progressively. |
| **Hide secondary actions for cleanliness** | Too strong. Frequency/discoverability determine visibility. |
| **One primary CTA = one button** | False. It means one dominant action hierarchy at a decision point. |
| **Buttons and links are visual variants of the same thing** | False. Action and navigation semantics differ. |
| **Icon-only is more efficient** | Only when recognition is sufficiently reliable and space/repetition justifies it. |
| **Hover can teach hidden UI on desktop** | Weak default. Essential UI must survive touch/keyboard and first-look scanning. |
| **Disabled controls should never receive focus** | Too strong. Composite-widget discoverability can justify focusable `aria-disabled` [W3C-APG-KEYBOARD]. |
| **Disabled controls should always remain focusable** | Also false. Extra tab stops can make keyboard navigation inefficient. |
| **Never disable submit** | Too strong. The actual requirement is clear unmet conditions and accessible recovery. |
| **Always disable invalid submit** | Also too strong; submitting can be a useful validation trigger in some forms. |
| **Switches = immediate server updates** | Convention, not semantic law. A switch represents binary on/off state; product behavior still needs clarity [W3C-APG-SWITCH]. |
| **Dropdown below/above N options** | Numeric thresholds are contextual heuristics, not universal component laws. |
| **Tooltips solve ambiguous icons** | Sometimes; visible labels are more robust for important/novel controls. |
| **Never nest modals** | Strong default, not absolute impossibility. Rare bounded higher-priority dialogs can exist. |
| **Modals are bad UX** | False. They are appropriate for bounded blocking tasks. |
| **Accordions reduce cognitive load** | They reduce simultaneous visibility but add discovery/interaction cost. |
| **Tabs reduce complexity** | They organize peers but also hide panels. |
| **Tables are best for enterprise products** | Style claim. Use when aligned comparison/schema matters. |
| **Cards are easier to scan** | Context-dependent; cards can harm dense comparison. |
| **Dense UI is bad** | False. Expert/data work may benefit from high controlled density. |
| **More whitespace is always more premium/better** | Visual-design heuristic, not UI-task law. |
| **24×24 is the touch target standard** | WCAG AA minimum criterion, not a cross-platform ideal [W3C-TARGET]. |
| **48dp is the universal touch target** | Android platform convention/guidance, not universal web science [ANDROID-TARGET]. |
| **Drag is intuitive** | Often direct, but can be undiscoverable/inaccessible without signifiers and alternatives. |
| **Infinite scroll is bad** | Depends on exploration vs bounded retrieval/refinding. |
| **Pagination is old-fashioned** | Style judgment; explicit boundaries can be useful. |
| **Load More is universally best** | No. Choose by retrieval model and state continuity. |
| **Skeletons improve perceived speed** | Not established as universal; use for meaningful structure and test context. |
| **Spinner after exactly X ms** | Vendor/product heuristic, not universal human threshold. |
| **Optimistic UI is always faster/better** | Only when failure/reconciliation is safe. |
| **Confirmations make dangerous actions safe** | Sometimes; undo/review/prevention can be stronger depending reversibility. |
| **Autosave removes need for save state** | False. Failure/offline/conflict can make persistence state more important. |
| **Offline = error** | Not if offline operation is supported. |
| **Responsive = breakpoints** | Incomplete. Window, text, orientation, system UI and input context matter. |
| **Mobile needs fewer features** | Unsupported as a universal rule. Adapt presentation first. |
| **WCAG compliance = good usability** | No. Accessibility conformance and overall task usability overlap but differ. |
| **WCAG 3 is the new standard in 2026** | No. September 2026 is still an in-progress Working Draft [W3C-WCAG3]. |
| **ARIA makes custom controls accessible** | False. Role is a behavioral promise; keyboard/focus/state must be implemented [W3C-APG-README]. |
| **Chat is the natural AI UI** | Sometimes. Structured/direct manipulation often fits structured tasks better. |
| **More AI trust is better** | False. Appropriate reliance is the objective [MS-RELIANCE]. |
| **Agents should confirm every step** | Often too interruptive. Oversight should scale with consequence/correction cost. |
| **Agents should only ask at the end** | Can allow error cascades; intermediate checkpoints can help in some tasks [CHI-CHECKPOINT]. |
| **Design system = component library** | Incomplete. Governance, behavior, tokens, lifecycle and contribution matter. |
| **Tokens = variables** | Incomplete. Tokens are a methodology/format for reusable design decisions; governance still matters. |
| **Stable DTCG = W3C Recommendation** | False. It is a stable Community Group specification [DTCG-2025]. |

---

# 37. One-page UI Golden Standard — V2

If only one page of this playbook survives:

1. **Make the system legible: what exists, what can be done, what state it is in and what happened.**
2. **Appearance, semantics and behavior must agree.**
3. **Use familiar interaction semantics unless improvement justifies relearning.**
4. **Optimize task performance, not screenshot cleanliness.**
5. **Do not equate minimalism with simplicity.**
6. **Make hierarchy reflect the current task.**
7. **Keep action close to the object/scope it affects.**
8. **Reveal secondary complexity deliberately; do not hide essential evidence.**
9. **Visible labels normally beat memory and icon decoding.**
10. **Buttons act; links navigate.**
11. **Choose controls from semantics/task, not arbitrary option-count laws.**
12. **Focus, hover, pressed and selected are different states.**
13. **Keep focus visible, predictable and unobscured.**
14. **Use established keyboard models for composite widgets.**
15. **Automatic tab activation requires effectively immediate panels.**
16. **Disabled, hidden, read-only and permission-blocked are different product states.**
17. **Do not make unavailable capability mysterious.**
18. **Hover is enhancement, never the sole path to essential information/action.**
19. **Design targets for real input context; WCAG minima are floors, not ideals.**
20. **Provide alternatives to drag/complex gestures where applicable.**
21. **Use modality only when interruption is justified.**
22. **Avoid nested dialogs as normal workflow; rare exceptions need rigorous focus/state handling.**
23. **Tooltips are supplemental, not a storage place for essential UI.**
24. **Transient messages are for transient noncritical information.**
25. **Use list/table/grid/card/tree/board/feed according to the operation users perform.**
26. **A grid is an interaction model, not a visual table style.**
27. **Virtualized interfaces must preserve semantic position, focus and selection.**
28. **Make search/filter/sort state visible and preserve it where refinding matters.**
29. **Choose pagination/Load More/infinite loading by retrieval model, not fashion.**
30. **Every consequential action needs perceivable feedback.**
31. **Scope loading UI to what is actually unavailable.**
32. **Progress must be truthful; do not fake percentages or certainty.**
33. **Use optimistic UI only when failure can be reconciled safely.**
34. **Prefer undo for reversible mistakes; use pre-commit review for hard-to-reverse consequences.**
35. **Autosave still needs saved/dirty/failure/offline/conflict states.**
36. **Treat offline, sync and collaboration as first-class interface states where relevant.**
37. **Adapt to available window/context rather than named device alone.**
38. **Use additional space to reveal useful context, not merely scale components.**
39. **Preserve state across resize/orientation/presentation changes.**
40. **Design for software keyboards, safe areas, zoom and text growth.**
41. **Localize the interaction geometry as well as strings.**
42. **RTL is semantic directionality, not blind mirroring.**
43. **Use WCAG 2.2 as the current web accessibility baseline; treat WCAG 3 as draft in 2026.**
44. **Prefer native semantic controls before rebuilding standard behavior.**
45. **Custom controls inherit keyboard, focus, semantics and assistive-technology responsibility.**
46. **Do not average away a core accessibility failure.**
47. **AI suggestion, plan, execution and result must be distinguishable states.**
48. **Design AI for appropriate reliance, correction and takeover — not maximum trust.**
49. **Agent checkpoints should scale with consequence and expected correction cost.**
50. **Approval UI must describe human consequences, not opaque tool syntax.**
51. **Consequential agent work needs comprehensible audit/provenance.**
52. **A design system encodes behavior and governance, not only visual components.**
53. **Tokens should represent semantic reusable decisions.**
54. **Component maturity and deprecation need explicit lifecycle rules.**
55. **Test state, failure, keyboard, zoom, localization and real tasks — not only default screenshots.**
56. **Preference and visual cleanliness are not proof of task performance.**
57. **When two patterns remain plausible, test the material uncertainty.**
58. **If users cannot tell what they can do, what the system is doing, what changed or how to recover, the UI is unfinished.**

---

# 38. Research evidence map

This appendix makes the playbook auditable. A source may provide a normative requirement, a platform convention, applied usability evidence or research evidence; those are not treated as interchangeable.

## W3C accessibility standards and WAI-ARIA practices

### W3C-WCAG22 — Web Content Accessibility Guidelines (WCAG) 2.2
**URL:** https://www.w3.org/TR/WCAG22/  
**Evidence:** `W3C_RECOMMENDATION / NORMATIVE_ACCESSIBILITY_STANDARD`  
**Finding:** Current web accessibility baseline used here for keyboard, focus, input modalities, reflow, target size, error assistance, name/role/value, status messages and related requirements.  
**Limitation:** Conformance is a quality floor, not a complete UI/usability model.

### W3C-WCAG3 — WCAG 3 Introduction / September 2026 Working Draft status
**URL:** https://www.w3.org/WAI/standards-guidelines/wcag/wcag3-intro/  
**Evidence:** `W3C_WORKING_DRAFT_STATUS`  
**Finding:** WCAG 3 remains in-progress; W3C explicitly says final requirements and conformance model will differ from current drafts.  
**Limitation:** Do not treat draft material as the current conformance replacement for WCAG 2.2.

### W3C-TARGET — WCAG 2.2 Target Size (Minimum), SC 2.5.8
**URL:** https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum  
**Evidence:** `NORMATIVE_ACCESSIBILITY`  
**Finding:** AA criterion uses a 24×24 CSS-pixel minimum with specified spacing/equivalent/other exceptions.  
**Limitation:** Minimum conformance threshold, not a universal ideal target size.

### W3C-DRAG — WCAG 2.2 Dragging Movements, SC 2.5.7
**URL:** https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements  
**Evidence:** `NORMATIVE_ACCESSIBILITY`  
**Finding:** Functionality using dragging must have a single-pointer alternative unless dragging is essential.  
**Limitation:** Does not prescribe the exact alternative control.

### W3C-FOCUS-OBSCURED — WCAG 2.2 Focus Not Obscured (Minimum), SC 2.4.11
**URL:** https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum  
**Evidence:** `NORMATIVE_ACCESSIBILITY`  
**Finding:** Author-created content must not entirely hide the focused component at AA.  
**Limitation:** Stronger focus-appearance requirements exist at higher conformance levels.

### W3C-HOVER — WCAG Content on Hover or Focus, SC 1.4.13
**URL:** https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus  
**Evidence:** `NORMATIVE_ACCESSIBILITY`  
**Finding:** Applicable hover/focus-triggered additional content must be dismissible, hoverable and persistent.  
**Limitation:** Scope excludes some user-agent content and modal dialogs.

### W3C-NON-TEXT — WCAG Non-text Contrast, SC 1.4.11
**URL:** https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast  
**Evidence:** `NORMATIVE_ACCESSIBILITY`  
**Finding:** Visual information required to identify UI components/states must meet applicable contrast requirements.  
**Limitation:** Not every decorative border/pixel is in scope; inactive components have exceptions.

### W3C-ORIENTATION — WCAG Orientation, SC 1.3.4
**URL:** https://www.w3.org/WAI/WCAG22/Understanding/orientation  
**Evidence:** `NORMATIVE_ACCESSIBILITY`  
**Finding:** Content should not restrict display orientation unless a specific orientation is essential.  
**Limitation:** Essential-orientation use cases remain legitimate.

### W3C-POINTER-CANCEL — WCAG Pointer Cancellation, SC 2.5.2
**URL:** https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation  
**Evidence:** `NORMATIVE_ACCESSIBILITY`  
**Finding:** Supports up-event completion, abort/undo and other mechanisms to reduce accidental pointer activation.  
**Limitation:** Essential down-event actions are excepted.

### W3C-STATUS — WCAG Status Messages, SC 4.1.3
**URL:** https://www.w3.org/WAI/WCAG22/Understanding/status-messages  
**Evidence:** `NORMATIVE_ACCESSIBILITY`  
**Finding:** Applicable status messages can be programmatically exposed without receiving focus.  
**Limitation:** Does not mean every dynamic change should become a live-region announcement.

### W3C-APG-README — WAI-ARIA APG Read Me First
**URL:** https://www.w3.org/WAI/ARIA/apg/practices/read-me-first/  
**Evidence:** `OFFICIAL_ACCESSIBLE_PATTERN_GUIDANCE`  
**Finding:** “A role is a promise”; ARIA semantics do not implement expected keyboard/interaction behavior automatically, and bad ARIA can reduce accessibility.  
**Limitation:** APG examples are pattern guidance and still require production/browser/AT testing.

### W3C-APG-KEYBOARD — WAI-ARIA APG Keyboard Interface
**URL:** https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/  
**Evidence:** `OFFICIAL_ACCESSIBLE_PATTERN_GUIDANCE`  
**Finding:** Defines focus/navigation conventions for composites and documents nuanced disabled-focusability tradeoffs.  
**Limitation:** Specific widgets still need their pattern-specific guidance.

### W3C-APG-NAMES — WAI-ARIA APG Providing Accessible Names and Descriptions
**URL:** https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/  
**Evidence:** `OFFICIAL_ACCESSIBILITY_GUIDANCE`  
**Finding:** Interactive elements need meaningful accessible names; visible text/native naming techniques are preferred where practical.  
**Limitation:** Exact naming technique depends on native element/role and content model.

### W3C-APG-DIALOG — WAI-ARIA APG Modal Dialog Pattern
**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/  
**Evidence:** `OFFICIAL_ACCESSIBLE_PATTERN_GUIDANCE`  
**Finding:** Defines modal focus containment, Escape behavior, inert background and logical focus return; allows dialog-over-dialog cases.  
**Limitation:** Technical possibility does not make stacked modality a preferred product pattern.

### W3C-APG-TOOLTIP — WAI-ARIA APG Tooltip Pattern
**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/  
**Evidence:** `WORK_IN_PROGRESS_APG_PATTERN`  
**Finding:** Classic tooltip is supplemental and noninteractive; focus remains on trigger and Escape dismisses.  
**Limitation:** APG explicitly flags the tooltip pattern as work in progress without full consensus.

### W3C-APG-TABS — WAI-ARIA APG Tabs Pattern
**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/tabs/  
**Evidence:** `OFFICIAL_ACCESSIBLE_PATTERN_GUIDANCE`  
**Finding:** Defines tablist/tab/tabpanel semantics and recommends automatic activation only when panel display has no noticeable latency.  
**Limitation:** Does not decide whether tabs are the correct information architecture.

### W3C-APG-SWITCH — WAI-ARIA APG Switch Pattern
**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/switch/  
**Evidence:** `OFFICIAL_ACCESSIBLE_PATTERN_GUIDANCE`  
**Finding:** A switch represents a binary on/off input and can be functionally related to checkbox/toggle-button patterns.  
**Limitation:** Does not normatively require immediate remote persistence.

### W3C-APG-CHECKBOX — WAI-ARIA APG Checkbox Pattern
**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/  
**Evidence:** `OFFICIAL_ACCESSIBLE_PATTERN_GUIDANCE`  
**Finding:** Supports binary and mixed/indeterminate checked state.  
**Limitation:** Product transaction timing is outside the semantic definition.

### W3C-APG-RADIO — WAI-ARIA APG Radio Group Pattern
**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/radio/  
**Evidence:** `OFFICIAL_ACCESSIBLE_PATTERN_GUIDANCE`  
**Finding:** Radio groups represent mutually exclusive selection and define keyboard behavior.  
**Limitation:** Whether options should be radios vs another single-select control is contextual.

### W3C-APG-COMBOBOX — WAI-ARIA APG Combobox Pattern
**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/combobox/  
**Evidence:** `OFFICIAL_ACCESSIBLE_PATTERN_GUIDANCE`  
**Finding:** Distinguishes editable/select-only combobox structures and popup behavior.  
**Limitation:** Semantic implementation guidance is not a universal option-count rule.

### W3C-APG-LISTBOX — WAI-ARIA APG Listbox Pattern
**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/listbox/  
**Evidence:** `OFFICIAL_ACCESSIBLE_PATTERN_GUIDANCE`  
**Finding:** Defines single/multi-selection option lists and their keyboard model; options are not arbitrary interactive containers.  
**Limitation:** Large/complex option sets may need another pattern.

### W3C-APG-DISCLOSURE — WAI-ARIA APG Disclosure Pattern
**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/  
**Evidence:** `OFFICIAL_ACCESSIBLE_PATTERN_GUIDANCE`  
**Finding:** A disclosure control shows/hides a section and exposes expanded/collapsed state.  
**Limitation:** Does not prove disclosure is appropriate for the content.

### W3C-APG-TABLE — WAI-ARIA APG Table Pattern
**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/table/  
**Evidence:** `OFFICIAL_ACCESSIBLE_PATTERN_GUIDANCE`  
**Finding:** Table is for static tabular relationships; cells are not given grid-style focus/navigation behavior.  
**Limitation:** Rich editing/navigation may require grid semantics or native application patterns.

### W3C-APG-GRID — WAI-ARIA APG Grid Pattern
**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/grid/  
**Evidence:** `OFFICIAL_ACCESSIBLE_PATTERN_GUIDANCE`  
**Finding:** Grid is a composite interactive widget with deliberate internal keyboard navigation.  
**Limitation:** Using grid semantics adds implementation responsibility; it is not a styling choice.

### W3C-GRID-PROPS — WAI-ARIA APG Grid and Table Properties
**URL:** https://www.w3.org/WAI/ARIA/apg/practices/grid-and-table-properties/  
**Evidence:** `OFFICIAL_ACCESSIBILITY_GUIDANCE`  
**Finding:** `aria-rowcount`, `aria-rowindex`, column equivalents and sort properties can describe partial/virtualized tabular sets.  
**Limitation:** Incorrect indices/counts can be more harmful than omitting unsupported semantics.

### W3C-APG-FEED — WAI-ARIA APG Feed Pattern
**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/feed/  
**Evidence:** `OFFICIAL_ACCESSIBLE_PATTERN_GUIDANCE`  
**Finding:** Dynamic feeds/infinite article lists need explicit item position/set-size/loading interoperability such as `aria-busy`.  
**Limitation:** Feed semantics are for a specific reading structure, not every infinite-scroll collection.

---

## Apple Human Interface Guidelines

### APPLE-PRINCIPLES — Apple HIG Design Principles (2026)
**URL:** https://developer.apple.com/design/human-interface-guidelines/design-principles  
**Evidence:** `PLATFORM_DESIGN_GUIDANCE`  
**Finding:** 2026 principles emphasize purpose, agency, responsibility, familiarity, flexibility, simplicity, craft and delight; principles are tools for tradeoffs, not rigid recipes.  
**Limitation:** Apple-platform philosophy/practice, not independent causal science.

### APPLE-FOCUS — Apple HIG Focus and Selection
**URL:** https://developer.apple.com/design/human-interface-guidelines/focus-and-selection  
**Evidence:** `PLATFORM_INTERACTION_GUIDANCE`  
**Finding:** Distinguishes interaction focus/selection and cautions against context changes that make focus navigation unpredictable.  
**Limitation:** Platform input systems differ.

### APPLE-FEEDBACK — Apple HIG Feedback
**URL:** https://developer.apple.com/design/human-interface-guidelines/feedback  
**Evidence:** `PLATFORM_INTERACTION_GUIDANCE`  
**Finding:** Feedback communicates status, success/failure, warning and correction; delivery should match significance.  
**Limitation:** Does not prescribe one feedback component for every product.

### APPLE-LAYOUT — Apple HIG Layout
**URL:** https://developer.apple.com/design/human-interface-guidelines/layout  
**Evidence:** `PLATFORM_LAYOUT_GUIDANCE`  
**Finding:** Interfaces should adapt to windows, orientation, text size, locale and platform context rather than simply scale.  
**Limitation:** Apple-specific implementation conventions.

### APPLE-LOADING — Apple HIG Loading
**URL:** https://developer.apple.com/design/human-interface-guidelines/loading  
**Evidence:** `PLATFORM_INTERACTION_GUIDANCE`  
**Finding:** Communicate loading honestly, show useful content as soon as possible and use determinate/indeterminate treatment according to what is known.  
**Limitation:** Perceived-wait effects remain context dependent.

### APPLE-PROGRESS — Apple HIG Progress Indicators
**URL:** https://developer.apple.com/design/human-interface-guidelines/progress-indicators  
**Evidence:** `PLATFORM_INTERACTION_GUIDANCE`  
**Finding:** Prefer determinate progress when real advancement can be known; report it accurately and provide cancel where feasible.  
**Limitation:** Visual styles/timing are platform-specific.

### APPLE-MODALITY — Apple HIG Modality
**URL:** https://developer.apple.com/design/human-interface-guidelines/modality  
**Evidence:** `PLATFORM_INTERACTION_GUIDANCE`  
**Finding:** Modality interrupts the current context; keep modal tasks bounded and avoid unnecessary layered modality.  
**Limitation:** Exact sheet/full-screen conventions vary by Apple platform.

### APPLE-SIDEBAR — Apple HIG Sidebars
**URL:** https://developer.apple.com/design/human-interface-guidelines/sidebars  
**Evidence:** `PLATFORM_NAVIGATION_GUIDANCE`  
**Finding:** Sidebars provide persistent navigation/context but require sufficient space; compact alternatives may be appropriate when constrained.  
**Limitation:** Apple product/navigation conventions are not universal layouts.

### APPLE-TOOLBAR — Apple HIG Toolbars
**URL:** https://developer.apple.com/design/human-interface-guidelines/toolbars  
**Evidence:** `PLATFORM_COMPONENT_GUIDANCE`  
**Finding:** Toolbars prioritize frequent commands, logical grouping and controlled overflow.  
**Limitation:** Platform placement/icon conventions vary.

### APPLE-UNDO — Apple HIG Undo and Redo
**URL:** https://developer.apple.com/design/human-interface-guidelines/undo-and-redo  
**Evidence:** `PLATFORM_INTERACTION_GUIDANCE`  
**Finding:** Undo/redo enables safe exploration; make the target/result predictable and visible, and support repeated undo where appropriate.  
**Limitation:** Undo granularity/history depends on domain and architecture.

### APPLE-DRAG — Apple HIG Drag and Drop
**URL:** https://developer.apple.com/design/human-interface-guidelines/drag-and-drop  
**Evidence:** `PLATFORM_INTERACTION_GUIDANCE`  
**Finding:** Drag should provide clear destination/outcome and preferably support undo; irreversible drops may justify confirmation.  
**Limitation:** Specific drag affordances differ by platform/input device.

### APPLE-COLLAB — Apple HIG Collaboration and Sharing
**URL:** https://developer.apple.com/design/human-interface-guidelines/collaboration-and-sharing  
**Evidence:** `PLATFORM_COLLABORATION_GUIDANCE`  
**Finding:** Collaboration UI should make sharing, permissions and collaboration management convenient and contextual.  
**Limitation:** CloudKit/Messages-specific examples do not define universal collaboration architecture.

### APPLE-RTL — Apple HIG Right to Left
**URL:** https://developer.apple.com/design/human-interface-guidelines/right-to-left  
**Evidence:** `PLATFORM_LOCALIZATION_GUIDANCE`  
**Finding:** RTL affects layout/direction/controls while some logos, numbers and real-world symbols should not be blindly mirrored.  
**Limitation:** Apple-specific details; local language/culture testing remains necessary.

---

## Android / Google guidance

### ANDROID-ADAPT — Android Adaptive Layout Guidance
**URL:** https://developer.android.com/design/ui/mobile/guides/layout-and-content/adapt-layout  
**Evidence:** `PLATFORM_ADAPTIVE_GUIDANCE`  
**Finding:** Think in available window space; use reflow, reveal and presentation changes rather than phone/tablet assumptions.  
**Limitation:** Android-specific APIs/breakpoints are not universal UI laws.

### ANDROID-NAV — Android Layout and Navigation Patterns
**URL:** https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-and-nav-patterns  
**Evidence:** `PLATFORM_NAVIGATION_GUIDANCE`  
**Finding:** Primary navigation representation can change with available window size, e.g. compact navigation to rail/drawer.  
**Limitation:** Pattern names/placements are Android-specific.

### ANDROID-RESIZE — Android adaptive/resizable app guidance
**URL:** https://developer.android.com/design/ui/mobile/guides/layout-and-content/adapt-layout  
**Evidence:** `PLATFORM_ADAPTIVE_GUIDANCE`  
**Finding:** Adaptive apps should preserve usable state while windows/orientation/layout change.  
**Limitation:** Exact state architecture is application-specific.

### ANDROID-TARGET — Android Accessibility Help — Touch Target Size
**URL:** https://support.google.com/accessibility/android/answer/7101858  
**Evidence:** `PLATFORM_ACCESSIBILITY_GUIDANCE`  
**Finding:** Recommends at least 48dp touch regions and notes visual glyphs can be smaller than their hit targets.  
**Limitation:** Android comfort guidance, not a universal cross-platform compliance law.

### ANDROID-OFFLINE — Android Developers — Build an Offline-first App
**URL:** https://developer.android.com/topic/architecture/data-layer/offline-first  
**Evidence:** `PLATFORM_ARCHITECTURE_GUIDANCE`  
**Finding:** Offline writes can be queued/persisted locally and create network/local conflicts requiring reconciliation.  
**Limitation:** Architecture guidance rather than direct UI evidence; UI implications are derived from the resulting system states.

---

## Microsoft Fluent and Human-AI research

### FLUENT-DIALOG — Fluent 2 Dialog Usage
**URL:** https://fluent2.microsoft.design/components/web/react/core/dialog/usage  
**Evidence:** `OFFICIAL_DESIGN_SYSTEM_GUIDANCE`  
**Finding:** Dialogs are interruptions; keep tasks bounded, manage focus and avoid nested dialogs as normal design.  
**Limitation:** Fluent implementation guidance, not universal causal proof.

### FLUENT-TOOLTIP — Fluent 2 Tooltip Usage
**URL:** https://fluent2.microsoft.design/components/web/react/core/tooltip/usage  
**Evidence:** `OFFICIAL_DESIGN_SYSTEM_GUIDANCE`  
**Finding:** Tooltip content should be supplemental/nonessential plaintext; richer interaction needs another surface.  
**Limitation:** Implementation details are system-specific.

### FLUENT-SKELETON — Fluent 2 Skeleton Usage
**URL:** https://fluent2.microsoft.design/components/web/react/core/skeleton/usage  
**Evidence:** `OFFICIAL_DESIGN_SYSTEM_GUIDANCE`  
**Finding:** Skeletons are for predictable dynamic content structure; avoid disrupting keyboard focus as real content arrives.  
**Limitation:** Does not prove skeletons universally improve perceived speed.

### FLUENT-SPINNER — Fluent 2 Spinner Usage
**URL:** https://fluent2.microsoft.design/components/web/react/core/spinner/usage  
**Evidence:** `OFFICIAL_DESIGN_SYSTEM_GUIDANCE`  
**Finding:** Spinner communicates indeterminate activity and should be scoped appropriately.  
**Limitation:** Specific timing thresholds are vendor heuristics.

### FLUENT-TOAST — Fluent 2 Toast Usage
**URL:** https://fluent2.microsoft.design/components/web/react/core/toast/usage  
**Evidence:** `OFFICIAL_DESIGN_SYSTEM_GUIDANCE`  
**Finding:** Toasts suit temporary useful noncritical messages; stronger persistent/blocking patterns fit critical information.  
**Limitation:** Exact toast duration/layout is implementation-specific.

### FLUENT-SWITCH — Fluent 2 Switch Usage
**URL:** https://fluent2.microsoft.design/components/web/react/core/switch/usage  
**Evidence:** `OFFICIAL_DESIGN_SYSTEM_GUIDANCE`  
**Finding:** Uses switch convention for immediate binary settings and distinguishes it from checkbox/form selection.  
**Limitation:** Immediate application is a convention, not the ARIA semantic definition.

### MS-HAI — Microsoft Guidelines for Human-AI Interaction
**URL:** https://www.microsoft.com/en-us/research/project/guidelines-for-human-ai-interaction/  
**Evidence:** `PEER_REVIEWED_HCI_GUIDELINES`  
**Finding:** 18 guidelines synthesize 20+ years of HAI work and address expectations, interaction, correction and adaptation over time.  
**Limitation:** Guidelines need prioritization according to product/task/risk.

### MS-RELIANCE — Microsoft Research — Appropriate Reliance on Generative AI
**URL:** https://www.microsoft.com/en-us/research/publication/appropriate-reliance-on-generative-ai-research-synthesis/  
**Evidence:** `RESEARCH_SYNTHESIS`  
**Finding:** Appropriate reliance means accepting correct output and rejecting incorrect output; synthesizes roughly 50 papers.  
**Limitation:** GenAI tasks/reliability vary rapidly; not a component recipe.

### MS-OVERSIGHT — Human Oversight of Agentic Systems in Practice
**URL:** https://www.microsoft.com/en-us/research/publication/human-oversight-of-agentic-systems-in-practice-examining-the-oversight-work-challenges-and-heuristics-of-developers-using-software-agents/  
**Evidence:** `QUALITATIVE_EMPIRICAL_HAI_RESEARCH / 2026`  
**Finding:** Interviews with 17 experienced developers found a-priori control, co-planning, real-time monitoring and post-hoc review forms of oversight.  
**Limitation:** Developer/software-agent sample; exploratory rather than universal causal evidence.

---

## IBM Carbon Design System

### CARBON-INPUT — Carbon Text Input / Read-only and Disabled State Guidance
**URL:** https://carbondesignsystem.com/components/text-input/usage/  
**Evidence:** `OFFICIAL_DESIGN_SYSTEM_GUIDANCE`  
**Finding:** Distinguishes disabled from read-only: read-only remains readable/focusable/assistive-readable where needed; disabled removes interaction.  
**Limitation:** HTML/framework behavior and exact styling can differ.

### CARBON-TOGGLE — Carbon Toggle Usage
**URL:** https://carbondesignsystem.com/components/toggle/usage/  
**Evidence:** `OFFICIAL_DESIGN_SYSTEM_GUIDANCE`  
**Finding:** Uses toggle for binary immediate state and distinguishes related checkbox/radio patterns.  
**Limitation:** Transaction timing is a convention rather than universal semantic law.

### CARBON-TABLE — Carbon Data Table Usage
**URL:** https://carbondesignsystem.com/components/data-table/usage/  
**Evidence:** `OFFICIAL_DESIGN_SYSTEM_GUIDANCE`  
**Finding:** Supports sorting, selection, expansion, batch actions and multiple density variants while distinguishing data tables from spreadsheet applications.  
**Limitation:** Carbon-specific component model; task determines suitability.

### CARBON-AI — Carbon for AI Guidelines
**URL:** https://carbondesignsystem.com/guidelines/carbon-for-ai/  
**Evidence:** `OFFICIAL_AI_DESIGN_GUIDANCE`  
**Finding:** AI presence should communicate meaningful provenance/explainability/control rather than decorative treatment alone.  
**Limitation:** Vendor design language is not a universal visual prescription.

### CARBON-COMPONENT — Carbon Component Checklist
**URL:** https://carbondesignsystem.com/contributing/component-checklist/  
**Evidence:** `DESIGN_SYSTEM_GOVERNANCE_GUIDANCE`  
**Finding:** Stable components require a multi-disciplinary definition of done across design, implementation, documentation and quality.  
**Limitation:** Carbon's lifecycle names/process are organization-specific.

---

## Atlassian Design System

### ATLAS-DISABLED — Atlassian Button / Disabled-state Guidance
**URL:** https://atlassian.design/components/button/button-legacy/usage  
**Evidence:** `OFFICIAL_DESIGN_SYSTEM_GUIDANCE`  
**Finding:** Warns about disabled submit-button discoverability and attaching tooltip-only explanation to non-focusable disabled controls.  
**Limitation:** Atlassian's recommendation against disabled submission is not a universal law.

### ATLAS-TOOLTIP — Atlassian Tooltip Usage
**URL:** https://atlassian.design/components/tooltip/  
**Evidence:** `OFFICIAL_DESIGN_SYSTEM_GUIDANCE`  
**Finding:** Tooltips are for useful nonessential information; critical information should be visible.  
**Limitation:** Product-specific exceptions such as truncation still require judgment.

### ATLAS-DRAG — Atlassian Pragmatic Drag and Drop Accessibility Guidelines
**URL:** https://atlassian.design/components/pragmatic-drag-and-drop/accessibility-guidelines  
**Evidence:** `OFFICIAL_ACCESSIBILITY_PATTERN_GUIDANCE`  
**Finding:** Always provide accessible alternatives to pointer drag outcomes and communicate resulting state/focus.  
**Limitation:** Specific menu/action patterns are Atlassian implementation choices.

### ATLAS-RELEASE — Atlassian Design System Release Phases
**URL:** https://atlassian.design/release-phases  
**Evidence:** `DESIGN_SYSTEM_GOVERNANCE_GUIDANCE`  
**Finding:** Documents Early Access, Beta, General Availability, Intent to Deprecate and Deprecated phases with explicit migration expectations.  
**Limitation:** Lifecycle labels are organizational conventions, not a universal standard.

---

## GOV.UK and USWDS

### GOV-ERROR — GOV.UK Design System Error Summary
**URL:** https://design-system.service.gov.uk/components/error-summary/  
**Evidence:** `PUBLIC_DESIGN_SYSTEM_GUIDANCE`  
**Finding:** Pair a page-level error summary with specific inline errors and links to affected inputs for complex forms.  
**Limitation:** Pattern density/formality should adapt to product context.

### GOV-ACCORDION — GOV.UK Design System Accordion
**URL:** https://design-system.service.gov.uk/components/accordion/  
**Evidence:** `PUBLIC_DESIGN_SYSTEM_GUIDANCE`  
**Finding:** Consider simpler headings/pages first; avoid for sequential questions and nested accordion structures.  
**Limitation:** Government-content context; other products may have different disclosure needs.

### USWDS-BUTTON — U.S. Web Design System Button / Link Guidance
**URL:** https://designsystem.digital.gov/components/button/  
**Evidence:** `PUBLIC_DESIGN_SYSTEM_GUIDANCE`  
**Finding:** Buttons represent important actions; regular links are recommended for navigation between pages.  
**Limitation:** Visual variants and examples are system-specific.

---

## Nielsen Norman Group and Baymard applied research

### NN-CONTEXT-MENU — NN/g Contextual Menus: Guidelines
**URL:** https://www.nngroup.com/articles/contextual-menus-guidelines/  
**Evidence:** `APPLIED_USABILITY_RESEARCH / 2025`  
**Finding:** Contextual menus reduce clutter but have low information scent; favor secondary/contextual rather than frequent primary actions.  
**Limitation:** Frequency/device/audience materially affect discoverability.

### NN-HIDDEN-NAV — NN/g Hamburger Menus / Hidden Navigation Research
**URL:** https://www.nngroup.com/articles/hamburger-menus/  
**Evidence:** `QUANTITATIVE + APPLIED_USABILITY_RESEARCH`  
**Finding:** Hidden navigation adds interaction/discoverability cost; hamburger recognition has improved but concealment remains a tradeoff.  
**Limitation:** Some underlying experiments are older and modern familiarity is higher.

### NN-TABS — NN/g Tabs, Used Right
**URL:** https://www.nngroup.com/articles/tabs-used-right/  
**Evidence:** `APPLIED_USABILITY_GUIDANCE / reviewed 2026`  
**Finding:** Tabs are a specific peer-content structure requiring clear labels, state and appropriate content relationships.  
**Limitation:** Practitioner synthesis rather than controlled causal evidence.

### BAYMARD-DROPDOWN — Baymard Drop-down Usability
**URL:** https://baymard.com/research-articles/drop-down-usability  
**Evidence:** `LARGE_DOMAIN_USABILITY_RESEARCH`  
**Finding:** Ecommerce testing finds recurring costs from inappropriate dropdown use and provides option-count heuristics for specific contexts.  
**Limitation:** Ecommerce thresholds should not be exported as universal control laws.

---

## Human-agent experiment

### CHI-CHECKPOINT — When Should Users Check? CHI 2026
**URL:** https://doi.org/10.1145/3772318.3790655  
**Evidence:** `CONTROLLED_HCI_EXPERIMENT`  
**Finding:** In a 48-person within-subject study, an intermediate confirmation strategy was preferred by 81% and reduced completion time 13.54% vs confirm-at-end in tested multi-step agent tasks.  
**Limitation:** Domains/checkpoint model were specific; do not copy exact timing universally.

---

## Design Tokens Community Group

### DTCG-2025 — Design Tokens Format Module 2025.10
**URL:** https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/  
**Evidence:** `STABLE_FINAL_COMMUNITY_GROUP_REPORT`  
**Finding:** First stable vendor-neutral design-token format; supports platform-agnostic expression/interchange of design decisions.  
**Limitation:** Explicitly not a W3C Recommendation/standards-track Recommendation.

---

## Companion master standards

### UX-V2 — UX Master Playbook — V2.0
**Source:** `ux_master_playbook_v2_double_validated_2026-09-21.md`  
**Evidence:** `COMPANION_EVIDENCE_WEIGHTED_PLAYBOOK`  
**Finding:** Supplies the end-to-end customer-first UX layer, including friction, feedback, recovery, accessibility, AI reliance, research and measurement.  
**Limitation:** Explicitly not a UI-component manual.

### DESIGN-V2 — Universal Design Principles Master Playbook — V2.0
**Source:** `universal_design_principles_master_playbook_v2.md`  
**Evidence:** `COMPANION_EVIDENCE_WEIGHTED_PLAYBOOK`  
**Finding:** Supplies cross-media perceptual/visual principles for hierarchy, typography, color, imagery, brand, attention and aesthetics.  
**Limitation:** Explicitly not a platform UI manual or component library.

---

# 39. Source-handling rules

1. **Use normative standards for normative claims.** WCAG requirements are not interchangeable with vendor recommendations.
2. **Treat WAI-ARIA APG as interaction/semantic guidance, not a guarantee of browser/assistive-technology interoperability.** Test real implementations.
3. **Prefer native semantics before ARIA reconstruction.** A custom role creates behavioral obligations.
4. **Treat Apple, Android, Fluent, Carbon, Atlassian, GOV.UK and USWDS as high-value operational guidance with ecosystem/context boundaries.**
5. **Do not convert vendor timing or size values into universal human-performance laws.**
6. **Treat WCAG minimum values as conformance floors, not ideal UI targets.**
7. **Do not promote ecommerce-specific Baymard thresholds to all products.** Domain/task boundaries matter.
8. **Do not promote older hidden-navigation/icon studies into timeless effect sizes.** Preserve the enduring mechanism — concealment/discovery cost — while acknowledging changing familiarity.
9. **Separate semantics from transaction behavior.** Example: switch means binary on/off semantically; “save immediately” is a convention/product contract.
10. **Separate accessibility from usability while requiring both.** Passing WCAG does not prove the task is understandable or efficient.
11. **Do not infer task performance from visual preference.** Cleaner-looking is not automatically faster, safer or more findable.
12. **Do not infer discoverability from designer familiarity.** Internal teams know hidden controls/icons better than new users.
13. **Treat component choice as a contextual decision.** Option count alone rarely settles it.
14. **Preserve boundary conditions in the written rule.** “Use X when Y” is stronger than a false universal.
15. **Keep WCAG 3 status explicit.** As of the research cutoff it is an in-progress draft, not the replacement baseline.
16. **Treat AI/agentic HCI as fast-moving.** Current guidelines and 2026 studies are strong direction, not timeless fixed component rules.
17. **Do not generalize one developer-agent study to every consumer agent.** Use mechanism and boundary conditions.
18. **Treat design-token format maturity separately from design-system governance maturity.** A standardized file format does not create a good system.
19. **Do not treat design-system consensus as causal proof.** Multiple systems agreeing increases confidence in convention, not necessarily in effect size.
20. **When a platform convention conflicts with a stronger accessibility requirement, satisfy the accessibility requirement.**
21. **When two accessible patterns remain plausible, choose according to task frequency, risk, space, input modality, performance and user expectation — then test material uncertainty.**
22. **Do not average away catastrophic UI failure.** Inability to operate, understand state, recover or access a core task can invalidate an otherwise polished surface.

---

# 40. Validation note — V2 second research pass, cutoff 21 September 2026

V2 is a second-pass falsification and evidence-reweighting of the V1 UI playbook.

The research pass explicitly rechecked:

- UI vs UX vs visual-design scope
- interaction semantics and native-first UI
- accessible names/roles/states
- affordance and discoverability
- icon-only and hidden UI
- layout, grouping and scope
- density and expert interfaces
- responsive/adaptive/resizable UI
- orientation, safe areas and software keyboards
- persistent/hidden navigation
- sidebars, tabs and automatic activation
- buttons, links, toolbars, overflow/context menus
- checkboxes, radios, switches, selects, listboxes, comboboxes, sliders
- forms, validation and error summaries
- disabled/read-only/hidden/permission states
- focus, keyboard composites and shortcuts
- targets, pointer cancellation, touch, gestures and drag
- modality, dialogs, drawers, popovers, tooltips, toasts and banners
- disclosure/accordions
- lists, tables, grids, cards, trees, boards and feeds
- selection, batch actions and virtualized data
- search, filters, sorting, pagination, Load More and infinite loading
- loading, progress, skeletons, spinners and optimistic updates
- undo/redo, destructive actions, autosave and dirty state
- offline, sync, conflict and collaboration state
- motion and reduced motion
- localization, content expansion and RTL
- WCAG 2.2 and September 2026 WCAG 3 status
- AI-native UI, appropriate reliance, agent states, checkpoints and auditability
- design tokens, component definition of done, lifecycle and deprecation
- UI testing, telemetry and evidence interpretation

## 40.1 Major changes from V1

V2 materially changed rather than merely expanded V1 in the following areas:

1. **Reorganized the playbook around system representation/state before component taxonomy.**
2. **Corrected disabled-state focusability from an absolute rule to a pattern-specific tradeoff.**
3. **Corrected “never nest modals” to a strong default with rare, explicit exceptions.**
4. **Separated switch semantics from the immediate-save convention.**
5. **Removed universal dropdown option-count rules.**
6. **Separated WCAG target minimums from platform comfort recommendations.**
7. **Strengthened tooltip caveats because the APG tooltip pattern remains work in progress.**
8. **Added latency as a condition for automatic tab activation.**
9. **Downgraded spinner/skeleton timing numbers to vendor heuristics.**
10. **Explicitly preserved WCAG 2.2 as the current baseline while marking WCAG 3 as draft.**
11. **Added persistence/sync/conflict/collaboration states.**
12. **Added virtualized collection accessibility.**
13. **Added pointer cancellation and deeper drag/drop alternatives.**
14. **Added optimistic UI, autosave, dirty state and reconciliation.**
15. **Added component lifecycle, maturity and deprecation governance.**
16. **Expanded agentic UI from generic AI guidance into state, plan, approval, checkpoint, provenance and takeover patterns.**
17. **Reduced duplicated UX/visual-design material and pointed those concerns back to companion standards.**

## 40.2 Final doctrine

The final V2 standard is:

> **Represent the system so people can tell what exists, what they can do, what state it is in, what changed and how to recover. Preserve familiar semantics unless a meaningful improvement justifies relearning; expose capability according to relevance and frequency rather than visual minimalism; adapt presentation without losing task meaning; and treat focus, state, accessibility, responsiveness, reversibility and recovery as fundamental interface behavior rather than polish.**

In short:

```text
MAKE THE SYSTEM LEGIBLE.
MAKE ACTIONS PREDICTABLE.
MAKE STATE VISIBLE.
MAKE FEEDBACK TRUTHFUL.
MAKE RECOVERY POSSIBLE.
MAKE THE INTERFACE OPERABLE ACROSS RELEVANT INPUTS AND CONTEXTS.
```

---
