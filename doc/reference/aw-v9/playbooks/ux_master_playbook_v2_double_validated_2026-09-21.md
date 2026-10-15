# UX Master Playbook — V2.0
## Evergreen standards for customer-first products, services and end-to-end journeys

**Version:** 2.0 — Double-Validated Golden Standard  
**Research cutoff:** 21 September 2026  
**Scope:** Apps, websites, onboarding, checkout, account creation, settings, search, support, partner flows, service journeys, omnichannel handoffs and other end-to-end customer experiences.  
**Document type:** Operator-neutral, evergreen UX standard. Not a UI-component manual and not an AI-agent playbook.  
**Core doctrine:** **Customer first. Product second.** The product, process, interface and organization are means to help a person achieve a goal — not the other way around.

---

# Executive synthesis

The strongest cross-disciplinary UX standard is not “make it minimal”, “use fewer screens” or “copy Apple”. It is:

> **Understand what the person is trying to accomplish, make the path predictable and appropriately easy, minimize unnecessary effort and uncertainty, preserve user control, provide clear feedback and recovery, and measure whether people actually succeed in context.**

ISO 9241-11 defines usability in terms of **effectiveness, efficiency and satisfaction in a specified context of use** [ISO11]. ISO 9241-210 defines human-centred design around explicit understanding of users/tasks/environments, continued user involvement, user-centred evaluation, iteration, the whole user experience and multidisciplinary work [ISO210][NIST-HCD]. GOV.UK service guidance extends the same principle across the entire service: solve the whole problem from start to finish and across all channels, with as few unnecessary things for the user to do as possible [GOV-WHOLE][GOV-DESIGN].

Apple’s current design principles converge on the same foundation: purpose, familiarity, simplicity, feedback, recoverability, responsibility and delight — but Apple explicitly warns that simplicity is not minimalism and that guided flows should be skippable where possible [APPLE-PRINCIPLES][APPLE-ONBOARD]. Google’s current Material research likewise finds that stronger visual hierarchy and expressiveness can improve task performance, but only when familiar interaction patterns and basic usability are preserved [GOOGLE-M3E].

The resulting UX model in this playbook is:

```text
CUSTOMER OUTCOME
→ CONTEXT
→ EXPECTATION / MENTAL MODEL
→ FIND / ORIENT
→ UNDERSTAND
→ DECIDE
→ ACT
→ RECEIVE FEEDBACK
→ COMPLETE
→ RECOVER IF NEEDED
→ CONTINUE RELATIONSHIP / SUPPORT
```

Accessibility, trust, privacy, performance and user control apply across the entire chain.

---

# V2 research verdict

V2 treats V1 as a falsifiable research draft, not a finished canon. Every major discipline was rechecked against current standards, systematic reviews/meta-analyses, controlled HCI studies and newer 2026 evidence. The second pass found that V1's core doctrine is strong, but four areas needed material expansion: **authentication/security UX, localization/cultural UX, probabilistic/AI-mediated UX, and experimentation/measurement validity**.

The strongest cross-domain conclusion remains:

> **Customer success is the objective. Product, flow, interface, automation and organizational process are means. Optimize the lowest justified user effort compatible with comprehension, control, safety, accessibility, trust and successful completion.**

V2 also tightens several slogans:

- **Frictionless ≠ zero friction.** Some friction protects against irreversible error, abuse, privacy loss or unsafe delegation.
- **Fewer steps ≠ better UX.** Optimize total cognitive/physical effort and confidence, not click count.
- **Familiarity ≠ copy competitors blindly.** Preserve transferable mental models where they help; innovate only when the benefit exceeds relearning cost.
- **Trust ≠ maximize trust.** Especially in AI systems, optimize **appropriate reliance**: accept good output and challenge/reject bad output [AI-RELIANCE].
- **Explanations ≠ safety.** Explanations can improve performance modestly in some decision-support contexts but can also increase trust in wrong output [AI-XAI-META][AI-XAI-RISK][AI-XAI-BIAS].
- **SUS/NPS ≠ objective usability.** Perceived usability, workload, task performance and loyalty are related but distinct constructs [SUS-META][NPS-LONG].
- **Five users ≠ validation.** Small formative tests can surface issues, but sample needs depend on purpose, heterogeneity and inference [FAULKNER].
- **Localization ≠ translation.** Locale can change date/number/address formats, directionality, symbols, legal expectations, content and even interaction logic [W3C-I18N][APPLE-RTL].

---

# 1. What UX actually is

UX is broader than a screen.

A user experience is the person’s perception and response resulting from the use — or anticipated use — of a product, service or system [ISO115]. That means the experience may begin **before** the person opens an app and continue **after** the transaction is complete.

Examples:

- discovering a service
- understanding whether it is right for them
- signing up
- granting permissions
- learning the basics
- performing the core job
- paying
- getting confirmation
- changing/cancelling
- seeking support
- receiving a delivery
- handling a failure
- renewing or leaving

A beautiful interface can therefore have poor UX if:

- the customer cannot find the right product
- signup is unnecessarily mandatory
- permissions are unexplained
- errors destroy work
- support cannot see context from the digital journey
- cancellation is intentionally difficult
- the product is fast but solves the wrong job

## 1.1 UX vs usability

**Usability** is a subset of UX.

ISO’s usability definition [ISO11]:

```text
specified users
+ specified goals
+ specified context
→ effectiveness
+ efficiency
+ satisfaction
```

A product can be usable but emotionally flat. It can also be delightful but ineffective. Good UX requires the pragmatic and experiential layers to support one another [HEDONIC01].

## 1.2 Customer first does not mean “give users everything they ask for”

Customer-first means:

- optimize for their real goal, not internal product structure
- understand behavior, constraints and context
- distinguish expressed preference from actual need
- avoid forcing organizational complexity onto the user
- measure success by user outcome as well as business outcome

User research should not merely ask what people “like”. GOV.UK explicitly recommends understanding what users are trying to do, how they do it now and whether the service lets them get the right outcome [GOV-RESEARCH]. Behavioral research is essential because what people say and what they do often differ [NN-METHODS].

---

# 2. Evidence hierarchy

UX is full of useful heuristics and folklore. V2 separates them by evidence strength and scope.

| Tier | Evidence | Use |
|---|---|---|
| **A0** | Normative standards + meta-analyses/systematic reviews | Strongest baseline where scope fits; still respect boundary conditions |
| **A1** | Peer-reviewed controlled experiments / robust HCI research | Mechanisms and causal principles |
| **A2** | Large longitudinal usability programs / large multi-site benchmarks | Strong applied evidence within domain |
| **B1** | Official Apple/Google/Microsoft/IBM/GOV design guidance | Operational guidance; not universal causal proof |
| **B2** | Nielsen Norman Group applied research / expert synthesis | Strong heuristics; scope and age matter |
| **C** | Widely used patterns / practitioner heuristics | Default hypotheses, not laws |
| **D** | UX folklore / slogans | Do not use as standard without evidence |

## 2.1 Evidence labels

- `NORMATIVE_STANDARD`
- `META_ANALYSIS`
- `SYSTEMATIC_REVIEW`
- `CONTROLLED_EXPERIMENT`
- `LARGE_USABILITY_PROGRAM`
- `OFFICIAL_PLATFORM_GUIDANCE`
- `APPLIED_UX_RESEARCH`
- `BEHAVIORAL_SCIENCE`
- `HEURISTIC`
- `PHILOSOPHY`
- `FOLKLORE`
- `INTERNAL_CAUSAL_TEST`
- `INTERNAL_ASSOCIATION`

## 2.2 Conflict rule

When two principles conflict:

1. Clarify the **user goal and context**.
2. Prefer direct observed behavior over stated preference for usability questions.
3. Prefer stronger empirical evidence over famous design slogans.
4. Prefer platform conventions where deviation creates learning cost and no meaningful benefit.
5. If both approaches are plausible, test realistic users on realistic tasks.
6. Optimize task outcome, not ideological purity.

## 2.3 V2 evidence re-weighting rules

1. **A standard can be normative without proving performance uplift.** WCAG/NIST/ISO may define minimum quality or security/accessibility constraints rather than conversion effects.
2. **A meta-analysis can still be heterogeneous.** Use average effects as priors, not guarantees.
3. **Vendor/platform guidance is strongest for its own platform mechanics and conventions, weaker as universal human-behavior proof.**
4. **Subjective and objective UX outcomes are separate.** A prettier or higher-SUS design can still be slower or more error-prone [AESTH-META][SUS-META].
5. **Risk changes the optimum.** High-stakes, irreversible, privacy-sensitive and agentic actions need more verification/control than low-stakes exploration.
6. **Probabilistic systems require calibrated reliance, not blanket trust.**

---

# 3. The 70 golden UX standards

1. **Customer outcome is the goal; the product is the means.**
2. **Research the real task before designing the flow.**
3. **Design for context of use, not an abstract “average user”.**
4. **Solve the whole customer problem, not only the screen owned by your team.**
5. **Remove organizational complexity from the customer journey.**
6. **Measure effectiveness, efficiency and satisfaction — not completion rate alone.**
7. **Minimize unnecessary effort, not necessarily the number of clicks.**
8. **Every required step must earn its place.**
9. **Do not collect information before it is needed.**
10. **Prefer recognition over recall.**
11. **Use familiar concepts and interaction patterns unless a new pattern is materially better.**
12. **Things that look the same should behave the same.**
13. **Make state, location and next actions visible.**
14. **Prioritize the primary task; progressively disclose secondary complexity.**
15. **Do not confuse visual minimalism with cognitive simplicity.**
16. **Avoid forcing users to learn your internal terminology.**
17. **Use plain, task-oriented language.**
18. **Give immediate, proportionate feedback after actions.**
19. **Prevent high-cost errors before they happen.**
20. **Prefer undo/recovery over repetitive confirmation for reversible actions.**
21. **Confirm only actions with serious, hard-to-reverse consequences.**
22. **Never destroy user work silently.**
23. **Do not make users enter the same information twice without necessity.**
24. **Make defaults helpful, transparent and easy to change.**
25. **Do not use defaults to exploit inertia against the user’s interest.**
26. **Keep onboarding as short, contextual and optional as possible.**
27. **Teach through doing where feasible; do not front-load memorization.**
28. **Get users to first meaningful value as early as possible.**
29. **Do not require account creation before it creates user value or is genuinely necessary.**
30. **Navigation should reflect user mental models, not organization charts.**
31. **Support both browse and search where both user strategies exist.**
32. **Avoid dead ends; always provide a recovery or next path.**
33. **Do not hide essential information behind unnecessary interaction.**
34. **More choices are not automatically worse; choice overload is context-dependent.**
35. **Group, prioritize and explain options instead of arbitrarily deleting them.**
36. **Responsive systems need fast feedback even when the underlying work takes longer.**
37. **Perceived performance cannot compensate indefinitely for actual slowness.**
38. **Interrupt only when the value or risk justifies breaking the user’s task.**
39. **Notifications require relevance, timing, control and consent.**
40. **Privacy choices must be understandable and reversible.**
41. **Do not manipulate users through deceptive patterns.**
42. **Accessibility is a baseline quality requirement, not an edge case.**
43. **Never rely on one input modality, color or gesture when alternatives are necessary.**
44. **Touch/click targets must be easy to acquire and separated enough to avoid errors.**
45. **Design for novice comprehension without trapping expert users in slow flows.**
46. **Offer accelerators for repeat/expert use while preserving obvious standard paths.**
47. **Preserve context across channel and support handoffs.**
48. **A customer should not have to understand which department owns their problem.**
49. **Recovery quality is part of the core journey, not “support UX”.**
50. **Delight should amplify successful use, never obstruct it.**
51. **Observe users doing realistic tasks before declaring a flow intuitive.**
52. **Combine qualitative and quantitative evidence.**
53. **Test early, iterate, and retest after material changes.**
54. **Track customer effort and downstream outcome, not vanity engagement.**
55. **If a convention is familiar and works, novelty needs to earn its learning cost.**
56. **Internationalize the underlying system before translating the surface.**
57. **Localize dates, numbers, currency, names, addresses, directionality and culturally loaded symbols—not only words.**
58. **Do not use robots, passwords, codes or memory tests as avoidable authentication friction; support password managers, paste and modern authentication.**
59. **Do not infer objective task performance from SUS, NPS or satisfaction alone.**
60. **Notifications are a scheduling problem as well as a relevance problem; batching/delaying can reduce interruption cost when urgency permits.**
61. **For probabilistic/AI systems, disclose capabilities and meaningful limitations before users build the wrong mental model.**
62. **Design AI for appropriate reliance, not maximum trust or maximum automation.**
63. **Every AI recommendation must have a viable correction, rejection, edit or recovery path when the user bears consequences.**
64. **Explanation is not verification; make important outputs independently checkable where possible.**
65. **Scale oversight with consequence, uncertainty, reversibility and action horizon.**
66. **Long-running autonomous actions need checkpoints or review opportunities before error cascades become expensive.**
67. **Protect users from deceptive/manipulative patterns even when they increase short-term conversion.**
68. **Experiment results are not trustworthy until assignment, telemetry and sample-ratio integrity are verified.**
69. **Short-term metric wins must not be assumed to predict long-term customer value.**
70. **Research methods themselves change behavior; choose test method and sample size for the decision, not by ritual.**

---

# 4. Customer-first doctrine

## 4.1 Product teams naturally see the system; customers see the job

Internal view:

```text
Account
→ Workspace
→ Permissions
→ Billing
→ Integration
→ Settings
```

Customer view:

```text
“I need to get my team working.”
```

UX fails when the internal architecture leaks into the external experience.

## 4.2 The core design question

Do not ask first:

> “How should this feature work?”

Ask:

> “What is the customer trying to achieve, what do they know at this moment, and what is the least burdensome reliable path to that outcome?”

## 4.3 User needs are contextual

ISO 9241-210 requires explicit understanding of users, tasks and environments and emphasizes that systems based on incomplete user understanding are a major source of failure [ISO210][NIST-HCD].

Document:

```yaml
user_or_customer:
context:
trigger:
goal:
current_method:
constraints:
knowledge_level:
risk_if_wrong:
frequency:
time_pressure:
accessibility_needs:
device_channel:
expected_convention:
success_state:
```

## 4.4 Customer first vs business reality

Customer-first UX does not mean ignoring:

- fraud
- legal requirements
- business economics
- operational constraints
- safety
- security

It means **satisfy those constraints with minimum avoidable customer cost**.

Example:

```text
Bad: “Compliance requires 15 questions, so the user must understand our compliance process.”
Better: “Which answers are legally required, when are they required, what can be prefilled, and how can we explain the reason at the point of need?”
```

---

# 5. Outcome model: from intent to completion

A robust journey can be evaluated through ten stages.

## 5.1 Discover

Can the person find the right entry point?

Questions:

- Does the label match their language?
- Is the entry point where they expect it?
- Are there misleading alternatives?

## 5.2 Orient

Do they understand where they are and what this experience is for?

Need:

- location/state
- purpose
- scope
- major choices

## 5.3 Understand

Can they understand the information, terminology and consequences?

Reduce:

- jargon
- hidden dependencies
- premature detail
- unexplained acronyms

## 5.4 Decide

Can they compare the relevant options without unnecessary uncertainty?

Support:

- sensible grouping
- recommendation where justified
- transparent defaults
- clear differences

## 5.5 Act

Is the intended action obvious and feasible?

Evaluate:

- control findability
- target size
- form burden
- prerequisites
- latency

## 5.6 Receive feedback

Did the system visibly acknowledge the action?

Apple: feedback should communicate state, success/failure, risk and recovery opportunity, and its intrusiveness should match importance [APPLE-FEEDBACK].

## 5.7 Complete

Is completion unambiguous?

A completion state should answer:

```text
Did it work?
What happened?
What happens next?
Do I need to do anything else?
```

## 5.8 Recover

If something goes wrong:

- preserve entered work
- explain the actual problem
- identify what can be corrected
- provide a direct next action
- avoid blame

## 5.9 Continue

For repeat products, the journey should become faster with familiarity.

Examples:

- remembered preferences
- recent items
- shortcuts
- saved progress
- command/keyboard accelerators

## 5.10 Exit / switch / cancel

A trustworthy experience lets users:

- leave
- go back
- cancel
- change plan
- export where appropriate
- correct decisions

without artificial obstruction.

---

# 6. Friction: remove the wrong friction, keep the right friction

“Frictionless” is a direction, not an absolute law.

Some friction is protective:

- confirming irreversible deletion
- reviewing a large payment
- identity verification
- medical/safety warnings
- high-risk permission

The objective is:

> **Minimum necessary effort + minimum uncertainty + sufficient protection.**

## 6.1 Friction taxonomy

### Interaction friction

Extra taps, clicks, fields, modal transitions, scrolling or navigation.

### Cognitive friction

Having to:

- remember
- infer
- translate terminology
- compare too many poorly structured options
- understand system architecture

### Decision friction

Uncertainty about:

- which option is right
- consequence
- price
- risk
- reversibility

### Waiting friction

- loading
- unclear processing
- delayed support
- handoffs

### Trust friction

- unclear pricing
- unexpected permissions
- hidden terms
- ambiguous ownership

### Recovery friction

- re-entering data
- losing progress
- contacting support for reversible actions

### Organizational friction

The customer has to coordinate departments, suppliers, systems or channels themselves.

## 6.2 Interaction-cost principle

The three-click rule is false [NN-3CLICK]. Users can tolerate more steps when each step is clear, meaningful and predictable. Conversely, one overloaded screen can be harder than five simple ones.

Therefore measure:

```text
total customer effort
not
screen count alone
```

## 6.3 Fewer steps heuristic

Use fewer steps when removing a step also removes:

- waiting
- unnecessary decision
- redundant entry
- context switching
- risk of error

Do **not** merge steps if the result:

- obscures sequence
- overwhelms working memory
- combines unrelated decisions
- hides consequences

GOV.UK’s guidance is useful here: people should do as few things as possible, but the service must still solve the whole problem coherently [GOV-DESIGN].

---

# 7. Cognitive load and working memory

Human working memory is severely limited. Modern reviews commonly place the central capacity around roughly 3–5 meaningful chunks under constrained conditions, not the simplistic “7±2 menu items” rule [WM-COWAN][WM-REVIEW].

## 7.1 The UX implication

Do not use a fixed numerical menu law.

Instead reduce **unnecessary** memory and processing demands.

## 7.2 Three kinds of load for UX

A useful adaptation of cognitive load theory [CLT-HCI]:

### Intrinsic task load

Complexity inherent in the user’s actual problem.

Cannot always be removed.

### Interface-induced load

Complexity created by the product:

- remembering previous values
- cryptic icons
- inconsistent terms
- hidden state
- split information

This is where UX should be aggressive.

### Productive learning load

Some complexity is worthwhile when the person is learning a meaningful domain or skill.

Therefore “zero cognitive load” is not the goal.

## 7.3 Recognition over recall

NN/g’s heuristic is supported by basic memory science: recognition provides retrieval cues and generally demands less memory effort than recall [NN-RECOGNITION][NN-HEURISTICS].

Prefer:

- visible options
- recent items
- examples
- autocomplete
- clear labels
- persistent context

over requiring users to remember:

- command names
- exact codes
- previous screens
- hidden settings

## 7.4 Chunking

Group meaningful items based on the user’s mental model.

Bad chunking:

```text
Personal
Configuration
Management
General
```

Better when user task is billing:

```text
Plan
Payment method
Invoices
Billing contacts
```

Chunking helps only when the groups themselves are meaningful.

## 7.5 Progressive disclosure

Progressive disclosure can reconcile power and simplicity by keeping advanced or rare options secondary while preserving access [NN-PROGRESSIVE].

Use when:

- most users need a small primary set
- advanced options are infrequent
- revealing them later does not change earlier decisions

Do not hide:

- critical terms
- price
- risk
- requirements
- commonly needed controls

## 7.6 Progressive disclosure manages timing, not the intrinsic complexity of the task

Progressive disclosure is useful because it delays secondary complexity until it becomes relevant. It does **not** guarantee lower cognitive load or justify withholding evidence users need to decide.

A 2026 IUI study of training-data explanations (N=32) found detailed explanations increased perceived trust, fairness and understanding and were preferred despite greater cognitive load; progressive disclosure improved perceived learning but did not eliminate the load [PROGDISC-AI].

**V2 rule:**

> Layer information according to decision timing. Show the minimum needed to make the current decision correctly, with deeper detail available where users need verification, learning or expert control.

---

# 8. Mental models, familiarity and conventions

Your intuition here is strongly supported.

Users form mental models from prior experience with the physical world and other products. NN/g notes that users spend most of their time on other sites/products; their expectations therefore come from elsewhere [NN-MENTAL]. Apple explicitly recommends familiar concepts, standard patterns, consistent placement and behaviors [APPLE-PRINCIPLES][APPLE-BRANDING].

## 8.1 Familiarity principle

If a common pattern:

- is understood
- is accessible
- performs well
- has no material downside

then use it by default.

Examples:

- recognizable back navigation
- standard shopping cart behavior
- common search patterns
- platform-native gestures
- expected account/settings locations

## 8.2 When to innovate

Break convention only if:

```text
benefit of new interaction
> learning cost
+ error risk
+ discoverability cost
+ accessibility cost
```

and validate it with users.

## 8.3 Familiarity does not mean visual sameness

Apple’s current guidance is especially useful: use familiar components and behavior while allowing brand expression to happen without changing sizing, placement or behavior in ways that break expectations [APPLE-BRANDING].

Google’s M3 Expressive research makes the same distinction: expressive visual design improved attention/task performance in its tests, but unfamiliar interaction structures and removal of labels hurt usability [GOOGLE-M3E].

## 8.4 Shortcut principle

Apple recommends custom/shortcut gestures as supplements, not replacements, for standard interaction [APPLE-GESTURES].

Generalize:

```text
standard path for discoverability
+ accelerator for expert speed
```

Examples:

- button + keyboard shortcut
- visible search + command palette
- back button + swipe gesture

---

# 9. Information architecture and navigation

Information architecture defines how concepts are organized; navigation is the interface people use to move through that architecture.

## 9.1 User-model architecture

Group by:

- customer goal
- object
- workflow
- lifecycle stage
- frequency

not automatically by:

- department
- database table
- internal product team

## 9.2 Top-level architecture questions

For each category:

```text
Can users predict what is inside?
Are siblings mutually understandable?
Are labels distinct?
Does the hierarchy reflect how users think about the task?
```

Card sorting can help reveal grouping expectations; tree testing can test findability before visual design.

## 9.3 Browse vs search

Some users browse because they do not know exactly what they need. Others search because they know the target.

Large Baymard research shows both strategies matter in ecommerce, and weak navigation/search can block product finding [BAYMARD-NAV][BAYMARD-SEARCH].

Do not force one method on all users.

## 9.4 Depth vs breadth

There is no universal optimum hierarchy depth.

Avoid:

- extremely broad menus with poorly differentiated items
- deep chains where each level adds little information

Optimize:

- decision clarity per level
- predictable categories
- meaningful progress

## 9.5 Scrolling

“Users don’t scroll” is obsolete [NN-SCROLL]. Users do scroll, but the visible region strongly shapes what they perceive as available.

Therefore:

- put crucial orientation/primary action early
- visually signal that more content exists
- do not interpret long pages as automatically bad
- avoid “illusion of completeness” where the screen appears finished while key content lies below [NN-SCROLL-COMPLETE]

## 9.6 F-pattern

The F-pattern is an observed scanning behavior in some content-heavy layouts, not a universal layout template. NN/g explicitly says users scan in many patterns; F-scanning can indicate weak formatting [NN-FPATTERN].

Design to support scanning with:

- descriptive headings
- front-loaded key information
- meaningful visual anchors
- concise paragraphs

not “draw every layout as an F”.

---

# 10. Onboarding and first-run experience

The best onboarding is often the product itself being understandable.

Apple: ideally people understand the app by experiencing it; when onboarding is necessary, keep it fast, focused and optional, teach interactively and use contextual tips [APPLE-ONBOARD].

NN/g research on deck-of-cards mobile tutorials found no task-success/speed improvement in the tested apps and higher perceived difficulty [NN-TUTORIALS].

## 10.1 Onboarding goals

Onboarding should answer only what is necessary to reach first meaningful value:

```text
What is this?
Why does it matter to me?
What do I need to do now?
What can wait?
```

## 10.2 Time-to-value

Prioritize:

```text
first meaningful outcome
before
complete configuration
```

Examples:

Bad:

```text
create profile
choose preferences
invite team
connect 5 integrations
watch tour
→ finally see product
```

Better:

```text
enter product
complete a meaningful action
→ ask for configuration when needed
```

## 10.3 Progressive onboarding

Teach features at the moment of relevance.

Contextual learning usually reduces memory burden versus teaching ten features before the user encounters them.

## 10.4 Required setup

When setup is genuinely necessary:

- explain why
- show scope/progress
- save progress
- use smart defaults
- prefill known data
- permit later editing
- remove optional questions

## 10.5 Permission requests

Do not ask permissions before the user understands why they are useful.

Best sequence:

```text
user intent
→ context/value explanation
→ system permission
→ immediate benefit
```

## 10.6 Tours

Do not automatically use a tour because the product is “complex”. First ask whether the underlying experience can be made more self-descriptive.

Use a tutorial when:

- the interaction is genuinely novel
- safety/accuracy requires learning
- the concept cannot be learned naturally through use

Make it skippable and retrievable later when possible.

---

# 11. Forms, data entry and checkout

Forms are one of the purest expressions of UX friction: every field asks for attention, memory, interpretation and effort.

Baymard’s large-scale checkout research shows that many ecommerce checkouts still perform poorly and that optional/poorly designed fields can meaningfully slow users, cause doubt and create errors [BAYMARD-CHECKOUT]. W3C likewise notes that accessible forms reduce cognitive and motor difficulty through clear structure, labels, instructions and feedback [W3C-FORMS].

## 11.1 Ask only what is needed now

For every field:

```text
Why do we need this?
Why now?
Can we infer/prefill it?
Can we ask later?
Can the user succeed without it?
```

Delete fields that exist because:

- “marketing wants more data”
- “maybe we use it later”
- “the CRM has a column”

unless the value justifies the cost.

## 11.2 Labels

Use persistent, explicit labels.

Avoid placeholders as the sole label because context disappears once typing begins; this increases memory and error-recovery burden. Baymard’s mobile studies document this problem [BAYMARD-MOBILEFORM].

## 11.3 Required vs optional

Be explicit. Baymard found confusion when forms marked only one category or relied on a global note [BAYMARD-CHECKOUT].

The exact visual convention can vary; the principle is **zero ambiguity about obligation**.

## 11.4 Input format

Do not force users to transform familiar data into the system’s preferred format when software can normalize it.

Examples:

- accept reasonable phone-number formatting
- auto-format cards/dates
- support paste
- use autocomplete/autofill
- postcode lookup where appropriate

## 11.5 Field order

Order by the user’s task logic, not backend storage schema.

Group related fields and preserve meaningful context.

## 11.6 Validation

Good validation:

- happens at a useful moment
- identifies the exact field/problem
- uses plain language
- explains how to fix it
- preserves the user’s input

NN/g warns that premature error styling increases cognitive load; errors should appear when there is actually an error, not while the person is still typing [NN-HOSTILEERROR].

## 11.7 Guest checkout / forced accounts

Do not force an account before purchase or task completion unless necessary.

Baymard repeatedly observes users overlooking guest checkout when it is visually subordinate, with measurable abandonment risk [BAYMARD-GUEST].

If an account creates real value:

```text
complete transaction
→ offer account creation from already entered data
```

is often a lower-friction model than:

```text
create account
→ transaction
```

## 11.8 Passwords and authentication

UX standard:

- support password managers
- permit paste
- show requirements before error where possible
- use appropriate platform authentication/passkeys where supported
- avoid unnecessary cognitive tests

WCAG 2.2 includes accessible authentication criteria intended to reduce reliance on cognitive function tests without alternatives [W3C22].

## 11.9 Checkout review

Before a consequential commitment, show the information needed to verify:

- item/service
- total price
- recurring terms
- delivery/timing
- payment method
- critical conditions

Make edit paths obvious.

## 11.10 Payment confidence

The payment step often has elevated user anxiety. Baymard’s current payment UX guidance emphasizes clarity around total, payment state, errors and recovery [BAYMARD-PAYMENT].

Trust should come from factual transparency, not decorative padlocks or vague “secure” badges.

## 11.11 Authentication is a security + cognitive-load problem

Current NIST SP 800-63B guidance makes several UX implications explicit [NIST-AUTH]:

- support password managers and autofill
- permit copy/paste in password/passphrase fields
- allow long passphrases (NIST says maximum supported length should be at least 64 characters)
- do not impose arbitrary character-composition rules
- do not require periodic password changes without evidence of compromise
- avoid knowledge-based security questions

WCAG 2.2 likewise requires an authentication path that avoids unsupported cognitive-function tests and explicitly cites password managers and paste as mechanisms [W3C22].

**V2 rule:** security requirements must be real security requirements. Do not add memory, transcription or formatting difficulty that does not materially improve security.

## 11.12 One-time codes and MFA

Where MFA/verification is required:

- use platform autofill/deep linking where available
- avoid forcing users to memorize and retype codes between contexts
- preserve the underlying task state while authentication happens
- explain why the extra verification is needed when it is not self-evident
- provide recovery alternatives for lost devices/credentials

Security controls that prevent legitimate users from completing the task are still UX failures.

---

# 12. Choices, defaults and decision architecture

Choices are not free. But “always fewer choices” is also false: meta-analytic evidence shows that overload depends materially on decision complexity, task difficulty, preference uncertainty and the decision goal [CHOICE-META].

A meta-analysis of 99 observations / 7,202 participants found choice overload is moderated by:

- complexity of the choice set
- difficulty of the decision
- preference uncertainty
- whether people are motivated to minimize effort [CHOICE-META]

Therefore:

> **Optimize decision structure, not arbitrary option count.**

## 12.1 Reduce choice complexity before reducing useful choice

Before deleting options:

- group them
- explain differences
- recommend based on stated needs
- filter progressively
- show a sensible default
- hide advanced edge cases

## 12.2 Defaults

Defaults are powerful choice architecture, but their effect is neither trivial nor universal. A meta-analysis of 58 datasets with 73,675 participants found a substantial average default effect (d = 0.68) with considerable variation, including null and negative effects in some studies [DEFAULT01]. Classic field evidence also shows that default framing can materially shift consequential choices [DEFAULT02].

### Good defaults

- safe
- common
- reversible
- transparent
- aligned with likely user intent

### Bad defaults

- preselect paid extras deceptively
- opt users into privacy-invasive choices they would not reasonably expect
- exploit inertia
- create financial consequences that are easy to miss

**Rule:** defaults should reduce legitimate effort and support likely intent without exploiting inertia or undermining informed choice.

## 12.3 Recommended option

Recommendations can reduce uncertainty if the system explains why.

Better:

```text
Recommended for teams under 20 people
Includes X and Y
```

than:

```text
MOST POPULAR!!!
```

without basis.

## 12.4 Comparison

When options require comparison, make attributes alignable:

| Criterion | Option A | Option B |
|---|---|---|
| Price | ... | ... |
| Best for | ... | ... |
| Constraint | ... | ... |

Do not make users memorize information across screens.

## 12.5 Decision deferral

Allow “decide later” when the decision is not required now.

Premature choices add friction and often force people to make decisions before understanding the product.

---

# 13. Feedback, system status and state

A system that does not show state forces users to guess.

NN/g’s first heuristic is visibility of system status; Apple likewise treats feedback as central to helping people know what happened and what they can do next [NN-HEURISTICS][APPLE-FEEDBACK].

## 13.1 Every action needs a response

Possible feedback:

- visual state change
- confirmation text
- haptic
- sound
- progress
- updated content

Match the feedback channel to importance and accessibility.

## 13.2 Optimistic UI

Optimistic updates can make reliable actions feel immediate, but must have recovery when the backend fails.

Do not visually declare irreversible success before it is sufficiently certain.

## 13.3 Long operations

Communicate:

- that work is happening
- whether the user can leave
- estimated state if reliable
- completion or failure

Do not trap users staring at a spinner when useful work can happen in the background.

Apple recommends showing content/placeholders as soon as possible and allowing other activity while loading where feasible [APPLE-LOADING].

## 13.4 Progress indicators

Use determinate progress when you know meaningful progress.

Avoid fake progress precision.

For multi-step flows, progress should help the person answer:

```text
Where am I?
How much remains?
Can I go back?
```

---

# 14. Error prevention, error messages and recovery

Great UX is forgiving.

Apple’s 2026 principles explicitly recommend helping people recover and making reversibility easy [APPLE-PRINCIPLES]. W3C cognitive accessibility guidance likewise emphasizes preventing mistakes and easy correction [W3C-ERRORS].

## 14.1 Prevention hierarchy

Prefer:

```text
eliminate error-prone state
> constrain invalid action
> give contextual warning
> confirmation
> post-error explanation
```

where appropriate.

## 14.2 Undo beats “Are you sure?” for reversible actions

Routine confirmations become noise. NN/g recommends confirmation primarily for serious consequences, particularly irreversible ones, and prefers undo where possible [NN-CONFIRM].

Example:

Better for deleting an email:

```text
Deleted — Undo
```

than forcing a modal before every deletion.

For closing an account or sending a large irreversible payment, confirmation may be appropriate.

## 14.3 Error message formula

A good error says:

```text
What happened
+ what needs attention
+ how to fix it
+ what was preserved
```

Bad:

> Error 422. Invalid object.

Better:

> We couldn’t save the invoice because the due date is earlier than the invoice date. Change the due date and try again. Your other fields are saved.

## 14.4 Never blame the user

Avoid:

- “You entered an invalid email”
- “You failed to…”

Prefer neutral descriptions of the state.

## 14.5 Preserve work

A recoverable error should not require the person to repeat valid input.

Save drafts/autosave where the cost of loss is material.

---

# 15. Performance and perceived speed

Performance is UX, not merely engineering.

Chrome’s INP metric exists because delayed visual feedback makes users interpret the interface as unresponsive; current guidance considers ≤200 ms at the 75th percentile a good responsiveness target for the web [WEB-INP].

## 15.1 Response hierarchy

1. acknowledge input quickly
2. show meaningful state
3. perform work
4. show completion/failure

## 15.2 Real speed before theatrical speed

Improve **objective latency first**. Perceived-wait interventions are context-dependent. A controlled smartphone study found a loading animation **increased** estimated duration and lowered satisfaction versus a blank screen [LATENCY01]. By contrast, four 2025 experiments found that some dynamic animations shortened perceived waiting relative to static displays, with effects moderated by task involvement and utilitarian versus hedonic goals [LATENCY02].

Therefore:

> **Do not assume that a spinner, skeleton or animation makes waiting feel shorter. Benchmark real latency first, communicate truthful state, and test perceived-wait treatments in the actual task context.**

## 15.3 Skeletons and placeholders

Use when they:

- preserve layout
- signal progress
- allow progressive rendering

Avoid elaborate loaders that increase perceived waiting or distract.

## 15.4 Latency tolerance is task-dependent

A delay tolerated in:

- uploading a video

may be unacceptable for:

- toggling a setting
- opening a menu
- typing

Measure response by interaction type and user expectation.

## 15.5 Prevent repeated actions

If the system is slow, users may tap/click again.

Use immediate state change such as:

```text
button → loading state
```

and idempotent backend behavior where necessary.

---

# 16. Interruptions and notifications

Attention is a finite resource.

Interrupt only when the value of interruption exceeds the cost of breaking the current task.

## 16.1 Interruption hierarchy

### Interruptive

Use for:

- imminent data loss
- security problem
- critical decision needed now

### Non-interruptive

Use for:

- status
- background completion
- low-priority recommendations

Apple explicitly recommends matching feedback significance to intrusiveness and says marketing notifications must not use time-sensitive interruption mechanisms [APPLE-FEEDBACK][APPLE-NOTIFY].

## 16.2 Notification value test

Before sending:

```text
Is it timely?
Is it specific to this person?
Is there a useful action?
Would it still be useful tomorrow?
Did they consent to this type?
Could it wait inside the product?
```

## 16.3 Batching

Batch low-priority updates when immediacy provides little value.

## 16.4 Control

Users should be able to control:

- categories
- frequency
- channel
- timing

where feasible.

## 16.5 Interruption management is evidence-backed

A systematic review/meta-analysis of 33 laboratory experiments and 49 interventions found that interruption-management interventions improved primary-task accuracy and reduced resumption lag on average, with substantial differences by intervention and task type [INTERRUPT-META].

A randomized field experiment with 237 smartphone users found that batching notifications three times per day improved several reported well-being/control outcomes versus usual notifications, while hourly batching did little and disabling notifications entirely increased anxiety/FoMO in that setting [NOTIFY-BATCH].

**Correct principle:**

> Reduce avoidable task switching and schedule non-urgent information around user intent. Do not universalize a fixed batching cadence.

For work that is easily interrupted, consider:

- digest/batching options
- reminders that preserve resume context
- deferrable notifications
- quiet/focus modes
- explicit urgency levels
- state restoration after interruption

---

# 17. Trust, privacy and user control

Trust is created primarily by predictable, honest behavior.

## 17.1 Responsibility

Apple’s current principle is direct: explain what the product does and why, give rationale when requesting permission, collect only what the product needs and keep data safe [APPLE-PRINCIPLES].

## 17.2 Explain consequential data use at point of need

Privacy policy links are not enough for a surprising permission.

At decision time tell people:

- what is collected
- why
- what happens if declined
- whether it can be changed later

## 17.3 Control and freedom

Users should be able to:

- undo
- cancel
- go back
- correct
- leave
- change settings

without hidden penalties.

## 17.4 Deceptive patterns

FTC, OECD and EU guidance converge: interfaces that obscure, subvert, coerce or manipulate decision-making can harm consumers and create legal risk [FTC-DARK][OECD-DARK][EU-DARK].

Avoid:

- confirmshaming
- hidden costs
- forced continuity
- roach motels / difficult cancellation
- disguised ads
- preselected paid extras
- false urgency
- obstructive privacy choices

## 17.5 Trust cues must be substantive

Strong trust:

- transparent price
- clear company identity
- accurate status
- reversibility
- visible support
- consistent behavior

Weak pseudo-trust:

- decorative “100% secure” icon
- excessive badges
- generic stock photos

---

# 18. Accessibility and inclusive UX

Accessibility is not separate from usability. It extends the range of contexts the experience can support.

WCAG 2.2 adds requirements around focus visibility, dragging alternatives, target size, consistent help, redundant entry and accessible authentication [W3C22].

## 18.1 Interaction principles

- keyboard access
- visible focus
- screen-reader semantics
- multiple input modalities
- sufficient target size/spacing
- no color-only meaning
- captions/transcripts where relevant
- adaptable text/zoom
- avoid unnecessary drag-only interactions

## 18.2 Target size

WCAG 2.2 AA defines a 24×24 CSS px minimum target-size criterion with documented exceptions/spacing alternatives [W3C-TARGET].

Treat this as a minimum compliance threshold, not an ideal target for every context.

## 18.3 Cognitive accessibility

Help by:

- consistent controls
- plain language
- visible labels
- forgiving inputs
- no unnecessary time pressure
- preserving state
- predictable navigation

## 18.4 Inclusive research

Do not merely run an automated accessibility checker.

Include people with different:

- motor ability
- vision
- hearing
- cognitive/learning needs
- age
- technical familiarity

in research when the product serves them. GOV.UK explicitly requires inclusive research rather than assuming accessibility after the fact [GOV-RESEARCH].

## 18.5 Cognitive accessibility beyond minimum conformance

WCAG 2.2 adds concrete requirements around **consistent help**, **redundant entry** and **accessible authentication** [W3C22]. W3C's supplemental cognitive-accessibility guidance goes further: make each step clear, use familiar patterns and language, keep help easy to find and provide human help where possible [W3C-COGA].

Design implications:

- make completed/current/upcoming steps visible when sequence matters
- avoid re-asking information already supplied
- keep support in a predictable place
- offer alternatives to memory/transcription-heavy authentication
- use familiar language, labels and controls
- do not make people navigate complex support trees when they are already struggling

## 18.6 Digital exclusion is part of UX

A service can be technically accessible and still exclude people because of device access, connectivity, digital skill, language, literacy, confidence, trust or support needs.

For essential/high-impact services, design assisted routes:

- phone
- human chat
- in-person/partner support
- save-and-resume
- proxy/delegated assistance where safe

The customer outcome is the standard, not digital-channel completion at any cost.

---

# 19. Delight, enjoyment and emotional UX

Usability is necessary but not always sufficient for a great experience.

Research influenced by Hassenzahl distinguishes **pragmatic quality** (usefulness/usability) from **hedonic quality** (stimulation, identity, enjoyment). Both can contribute to perceived overall goodness, with effects depending on task and context [HEDONIC01][HEDONIC02].

## 19.1 Delight hierarchy

```text
1. Works
2. Understandable
3. Efficient
4. Trustworthy
5. Satisfying
6. Delightful
```

Do not jump to #6 while #1–4 are broken.

## 19.2 Functional delight

Often the strongest delight is relief:

- smart prefill
- instant undo
- unusually clear answer
- effortless import
- fast completion
- recovery that preserves work

## 19.3 Expressive delight

Animation, sound, copy and visual personality can increase emotional quality when aligned with context.

Google’s M3 Expressive research across 46 studies / 18,000+ participants found higher preference and in tested designs faster finding of key actions, but also showed usability loss when familiar patterns were broken [GOOGLE-M3E].

Therefore:

> **Express around the task, not instead of the task.**

## 19.4 Serious contexts

Banking, health, safety and crisis contexts may require calm reassurance rather than playfulness.

“Enjoyable” means emotionally appropriate, not always fun.

## 19.5 Attractive things can work better — but not reliably enough to trade away usability

A preregistered 2026 meta-analysis of 31 studies, 234 effect sizes and 18,794 participants found a small-to-medium positive average effect of visual aesthetics on objective user performance (`g ≈ 0.29`), but with very high unexplained heterogeneity [AESTH-META].

This updates the simplistic “aesthetic-usability effect” slogan:

- aesthetics can improve motivation, fluency and performance in some contexts
- effects vary substantially by task, interface and manipulation
- beauty cannot compensate for inaccessible, confusing or slow interaction
- measure both subjective experience **and** objective task outcomes

**V2 priority:** functional clarity and accessibility are constraints; aesthetic quality is a performance-relevant amplifier, not a substitute.

---

# 20. Novice vs expert UX

Novices need discoverability and explanation. Experts need speed and control.

Do not force one experience to choose exclusively.

## 20.1 Layered capability

Default:

```text
clear primary path
+ progressive advanced controls
+ expert accelerators
```

## 20.2 Power-user accelerators

Examples:

- keyboard shortcuts
- command palettes
- batch operations
- saved filters
- automation
- direct URLs/deep links

But do not remove the standard visible path.

## 20.3 Personalization

Personalization should reduce effort while remaining predictable.

Bad:

- controls move around unexpectedly
- hidden algorithmic changes

Better:

- remembered preferences
- explicit saved views
- transparent recommendations

---

# 21. Mobile vs desktop vs channel context

Do not design “mobile UX” by simply removing information.

A user’s **goal** often remains the same; constraints differ.

Mobile may have:

- smaller viewport
- touch input
- interruption
- poor network
- one-handed use
- camera/location capabilities

Desktop may have:

- larger canvas
- keyboard/mouse
- multiwindow workflows
- dense data tasks

## 21.1 Preserve task parity where appropriate

Do not assume mobile users want fewer capabilities. Prioritize and adapt presentation.

## 21.2 Mobile forms

Use input types, autofill and labels appropriate to small viewports.

## 21.3 Contextual device advantage

Use device capabilities only when they reduce effort:

- scan document
- biometric auth
- camera upload
- location

with clear permission logic.

---

# 22. Localization, culture and international UX

Localization is not translation. W3C notes that locale differences can affect currency, keyboard input, sorting, symbols/colors, laws, address/contact formats, names, scripts and even interaction/business logic [W3C-I18N]. Apple similarly expects interfaces to adapt to language, region and right-to-left direction while preserving familiar behavior [APPLE-RTL].

## 22.1 Internationalize before localizing

Architecture should allow:

- flexible text length
- Unicode
- locale-aware dates/times/numbers/currency
- translated plural/gender forms where needed
- RTL/LTR mirroring rules
- variable address/name/phone structures
- local payment/tax/legal requirements
- local content and imagery

Do not hardcode one country's data model into the UX.

## 22.2 Directionality is interaction, not just alignment

For RTL contexts:

- mirror directional layout where meaningful
- align paragraphs to their language
- preserve numbers/logos/universal marks appropriately
- validate gestures/navigation direction
- test mixed-script content

Do not mechanically flip every icon or image [APPLE-RTL].

## 22.3 Culture can change meaning

Color, imagery, humor, privacy expectations, formality, naming, identity and support expectations can vary.

**Rule:** do not infer cultural UX from stereotypes. Research representative local users.

## 22.4 Localization QA

Test with:

- long/short strings
- pseudo-localization
- RTL
- local keyboards/input methods
- local date/currency/decimal formats
- real names/addresses
- accessibility at localized text sizes
- actual local users for high-value journeys

---

# 23. End-to-end customer journeys and service UX

UX stops being useful if it only optimizes the screen owned by one team.

A customer does not experience:

```text
marketing → product → operations → partner → support
```

as five departments.

The customer experiences **one journey**.

GOV.UK's current service standard is unusually explicit: design the service from beginning to end, front to back, and across every channel; solve the user's whole problem rather than forcing the user to understand organisational boundaries [GOV-DESIGN][GOV-WHOLE]. NN/g similarly defines service blueprints as a way to connect customer touchpoints to the people, processes and systems that produce them [NN-SERVICE].

## 23.1 Journey scope starts with the user's goal

Bad scope:

> “Improve the account-verification screen.”

Better scope:

> “Help a new customer become verified and able to use the service confidently.”

The second scope naturally exposes:

- why verification is needed
- what the customer must prepare
- identity-provider dependencies
- failures and recovery
- waiting states
- confirmation
- support
- what happens after verification

## 23.2 Journey map vs service blueprint

### Journey map

Customer-side view:

```text
stage
→ customer goal
→ action
→ thought/question
→ emotion/confidence
→ friction
→ channel/touchpoint
→ outcome
```

### Service blueprint

Adds the organisation behind the experience:

```text
customer action
↓
frontstage interaction
↓
backstage people/process
↓
systems/data/partners
↓
policy/rules
```

Use journey mapping to understand the experience. Use blueprinting when fixing the experience requires cross-functional or operational change [NN-SERVICE][NN-SERVICE2].

## 23.3 Handoffs are UX

Every handoff creates risk:

- website → app
- app → email
- self-service → support
- business → third-party provider
- online → physical
- sales → onboarding
- onboarding → implementation
- human → automation

For every handoff preserve:

1. **context** — the next touchpoint knows what already happened
2. **state** — progress is not lost
3. **expectation** — user knows what happens next
4. **identity** — no unnecessary reauthentication/re-entry
5. **ownership** — someone/something is clearly responsible
6. **recovery path** — if handoff fails, the user is not stranded

## 23.4 Do not expose the organisation chart

Internal ownership should not become user navigation.

A customer should not need to know:

- which department owns a process
- which vendor runs a subsystem
- which database holds a record
- which team caused a delay

unless that information genuinely helps them act.

## 23.5 Channel consistency

A joined-up journey does **not** require identical interfaces across channels.

It requires consistent:

- terminology
- customer identity
- status
- policy
- promises
- next steps
- service outcomes

Phone, app, email and in-person channels may use different interactions while preserving the same mental model.

## 23.6 Cross-channel resume

Where technically and legally appropriate, let users:

- start on one device/channel
- pause
- resume elsewhere
- preserve previous answers
- see current state

WCAG 2.2's Redundant Entry criterion formalizes a related accessibility principle: information already provided within the same process should generally be auto-populated or selectable rather than requested again [W3C-REDUNDANT].

## 23.7 Service handover is a knowledge-transfer problem

A systematic review of 41 relevant publications on service-design → UX/software handover found that effective transfer depends on communication quality/quantity, reducing unnecessary transfer burden and verifying that knowledge actually transferred; service vision, user stories and prototypes were key boundary objects [SERVICE-HANDOVER].

**V2 implication:** journey maps cannot be throwaway workshop artifacts. Preserve the service intent into implementation through shared artifacts, observed evidence and explicit acceptance criteria.

## 23.8 “Seamless omnichannel” is a goal only when continuity helps the user

Cross-channel UX should preserve:

- identity
- task state
- prior information
- decisions already made
- promises/quotes/reference numbers
- support history

But channel experiences do not have to be identical. A phone agent and mobile interface may legitimately expose different detail. Optimize **continuity of outcome and context**, not pixel-level sameness.

---

# 24. Support, help and service recovery

A product is not frictionless because the happy path is good.

A mature UX standard asks:

> **What happens when the user is confused, blocked, wrong, late, rejected, disconnected or exceptional?**

## 24.1 Help hierarchy

Prefer support in this order when appropriate:

```text
self-explanatory experience
→ contextual clarification
→ searchable self-service help
→ automated assistance
→ human escalation
```

This is not a cost hierarchy that forces people away from humans. It is an effort hierarchy: solve simple problems at the lowest-effort layer, while ensuring high-stakes or ambiguous problems can escalate.

## 24.2 Consistent help

WCAG 2.2 explicitly requires repeated help mechanisms to appear in consistent relative order in covered contexts [W3C-CONSIST]. Consistency matters because a person who is already confused should not also have to rediscover how to get help.

## 24.3 Never create support dead ends

Anti-patterns:

- chatbot with no escape
- “contact us” that loops back to FAQ
- generic error code with no action
- partner issue where each company redirects responsibility
- account locked with no recovery route

## 24.4 Human escalation

Human escalation is especially important when:

- financial consequence is high
- identity/security is involved
- user situation does not fit the model
- repeated automated recovery failed
- accessibility/support needs require accommodation
- emotional stakes are high

When escalating, carry context forward. Do not force the user to repeat the entire story.

## 24.5 Service recovery can restore the relationship — but failure is not a strategy

A failure itself does not have to destroy the relationship, and good recovery can restore satisfaction and trust. But the classic “service recovery paradox” is not a license to create failure: an earlier meta-analysis found a positive paradox for satisfaction but not reliable benefits for repurchase intention, word-of-mouth or corporate image, while a 2026 meta-analysis across 147 online-service studies shows that recovery outcomes depend on attribution, justice and context [RECOVERY-META].

**Rule:** design to prevent failure first; when failure occurs, restore fairness, control and progress quickly.

Good recovery:

1. acknowledge what happened
2. explain relevant impact
3. preserve user work
4. provide the next viable step
5. communicate ownership/timing
6. notify when resolved
7. compensate where appropriate

The principle is **restored control**, not theatrical apology.

## 24.6 Recovery quality: fairness, attribution and emotion matter

A 2026 meta-analysis covering 147 studies and 82,901 people across 24 countries found that online service-recovery outcomes are meaningfully shaped by attribution, justice/fairness perceptions and emotional responses [RECOVERY-2026].

Recovery design should therefore address more than a technical fix:

1. acknowledge what happened
2. take appropriate responsibility
3. explain next steps without defensive jargon
4. restore the user's state/value where possible
5. give realistic timing
6. make escalation visible
7. follow through

Do not use “service recovery paradox” as justification for preventable failure. Prevention remains better than recovery.

## 24.7 Automated support needs an escape hatch

Automated support is useful for fast, well-bounded issues. Human escalation becomes more important when:

- stakes are high
- user is distressed/angry
- ambiguity is high
- the system has already failed repeatedly
- identity/payment/legal exceptions exist
- requested action is outside the automation's authority

Never trap a customer in a bot loop merely because automation is cheaper.

---

# 25. Probabilistic, AI-mediated and agentic UX

Classic UX principles still apply, but AI systems add uncertainty, adaptation, opaque failure modes and sometimes delegated action. The design target is not “make AI feel trustworthy”. It is **appropriate reliance**: users accept useful/correct outputs and challenge or reject bad ones [AI-RELIANCE].

Microsoft's 18 Human-AI Interaction Guidelines synthesize decades of HAI work and were validated through multiple rounds including 49 design practitioners evaluating 20 AI-infused products [AI-HAX]. Google PAIR similarly organizes human-centered AI design around user needs, mental models, explainability/trust, feedback/control and graceful failure [AI-PAIR].

## 25.1 Set capability boundaries before first reliance

Make clear:

- what the system can do
- what it cannot reliably do
- whether output is generated/inferred or deterministic
- important freshness/data boundaries
- what actions it can take
- which actions require user review

Do not over-anthropomorphize capability or imply certainty the system does not possess.

## 25.2 Calibrate trust; do not maximize it

Appropriate reliance requires two abilities:

```text
accept good output
+
reject/correct bad output
```

High trust can be harmful if users follow wrong output; low trust can waste a genuinely useful system [AI-RELIANCE].

Design for verification:

- show underlying source/data/context where material
- distinguish system output from verified facts
- expose meaningful uncertainty when it changes decisions
- let users compare/edit before commitment
- preserve original input/context

## 25.3 Explanations are not a safety feature by themselves

A 2026 meta-analysis found AI decision support improved performance relative to no support, but the incremental performance benefit of explanations over AI-only support was small and heterogeneous [AI-XAI-META]. Other experiments find explanations can fail to reduce automation bias and can even increase reliance on inaccurate recommendations [AI-XAI-BIAS][AI-XAI-RISK].

Therefore:

> Use explanations to close a specific user knowledge gap or enable verification—not to decorate an output with persuasive rationale.

Test whether explanations improve **error detection and decision quality**, not just perceived trust.

## 25.4 Correction must be cheap

When the AI guesses wrong, users should be able to:

- dismiss
- edit
- regenerate/retry where appropriate
- revert
- constrain the request
- correct source data/preferences
- switch to manual flow
- escalate to a human/system owner

Do not punish correction by forcing a full restart.

## 25.5 Oversight should scale with consequence

Low-risk creative exploration can tolerate more autonomy. High-cost, irreversible, legal, financial, privacy or safety actions need stronger review.

For long-running agents, oversight can occur:

- before execution (scope/plan)
- at material checkpoints
- during anomaly/failure
- before irreversible commit
- after completion via audit/review

A CHI 2026 experiment with 48 participants found intermediate confirmations were preferred by 81% and reduced task completion time by 13.54% versus confirm-at-end in the tested multi-step agent tasks [AI-CHECKPOINT]. Treat the specific interval/effect as context-specific; the durable principle is **checkpoint before expected correction cost becomes high**.

## 25.6 Users need control over adaptation

If the system learns/preferences change:

- make material adaptation predictable
- communicate meaningful behavior changes
- support feedback/correction
- expose global controls where needed
- avoid silently redefining high-impact preferences

Microsoft HAI guidance explicitly includes cautious adaptation, granular feedback, global controls and notifying users about changes [AI-HAX].

## 25.7 Agentic UX needs auditability

Research with experienced developers using software agents shows oversight includes a-priori control, co-planning, real-time monitoring and post-hoc review [AI-OVERSIGHT].

For consequential agentic workflows preserve:

- what the user asked
- plan/scope where useful
- actions taken
- external effects
- errors/retries
- approvals
- final outcome
- rollback/recovery path

Audit trails should be comprehensible, not merely raw logs.

## 25.8 AI failure is part of the normal product state

Google PAIR explicitly treats graceful failure as core AI UX [AI-PAIR]. Design expected failstates:

- no answer / insufficient information
- low confidence / ambiguity
- stale/inaccessible source
- partial action completion
- tool/action failure
- unsafe/unsupported request

The UX must explain the **way forward**, not just that “something went wrong”.

---

# 26. UX writing and language

Words are part of the interaction model.

GOV.UK's interface-writing guidance explicitly recommends using users' language, minimizing cognitive load, keeping copy direct and treating a need to explain the interface as a sign the interface may be too complex [GOV-WRITING].

## 26.1 Use the user's vocabulary

Prefer:

```text
customer term
```

over:

```text
internal department term / technical implementation term
```

Unless the technical term is itself what the user needs to learn.

## 26.2 Put the action or information first

Weak:

> “In order to proceed with the continuation of your registration, please provide…”

Better:

> “Enter your company registration number.”

## 26.3 Labels beat placeholders

Persistent labels support:

- comprehension
- recall
- error recovery
- accessibility
- review after entry

A placeholder can provide an example, but should not carry the only label [W3C-FORMS].

## 26.4 Buttons describe outcomes

Prefer:

- `Save changes`
- `Book appointment`
- `Send application`
- `Download report`

rather than vague:

- `Continue`
- `Submit`
- `OK`

when the actual action can be named clearly.

`Continue` is appropriate when the only meaningful outcome truly is progressing to the next step.

## 26.5 Progressive explanation

Do not put every caveat before the user acts.

Layer language:

```text
essential label/action
+ short contextual hint
+ optional deeper explanation
```

## 26.6 Tone follows stakes

Playful copy can work in low-risk contexts.

In:

- payments
- failed applications
- health
- safety
- identity problems
- data loss

clarity and calmness normally outrank personality.

## 26.7 Error copy

Error messages should:

```text
state the problem
+ say how to fix it
+ stay close to the source
+ preserve respectful language
```

NN/g and GOV.UK independently converge on plain, specific and recovery-oriented error language [NN-ERROR][GOV-ERROR].

---

# 27. Search, filtering and finding information

Browse and search serve different mental models.

Browse helps when users:

- do not know the exact term
- want to explore
- need category context

Search helps when users:

- know what they want
- have a specific object/problem
- work with large information spaces

## 27.1 Search must recover from imperfect input

Good search should tolerate where feasible:

- spelling variants
- common synonyms
- singular/plural
- known aliases
- partial queries
- product identifiers

Do not make people learn the database's vocabulary.

## 27.2 No-results states

“No results” should not be a dead end.

Offer contextually relevant recovery such as:

- remove restrictive filters
- correct likely misspelling
- suggest broader term
- show adjacent categories
- explain inventory limitation
- provide contact/help for high-value searches

## 27.3 Filters reduce complexity only if understandable

Filters should:

- reflect dimensions customers understand
- show active state clearly
- be reversible
- update result counts/predictions where useful
- avoid zero-result traps where possible

Baymard's large-scale ecommerce search/filter research shows that search and filtering remain widespread sources of failure even on mature commerce sites [BAYMARD-SEARCH].

## 27.4 Sorting is not filtering

Sorting changes order. Filtering changes the result set.

Do not mix them conceptually or visually if that creates ambiguity.

## 27.5 Preserve search state

When a user opens a result and returns, preserve where appropriate:

- query
- filters
- sort
- scroll/location

Recreating a search is pure interaction cost.

---

# 28. Empty states, zero states and first-value states

An empty screen is not simply an absence of content. It is part of the journey.

## 28.1 Types of empty state

### First-use empty state
Nothing exists yet.

### User-cleared empty state
The user intentionally removed everything.

### Filtered empty state
Content exists, but not under current criteria.

### Error/loading empty state
The system failed or has not completed retrieval.

Do not use one generic “Nothing here” treatment for all four.

## 28.2 First-value principle

A first-use empty state should answer:

```text
What is this space for?
What useful thing can I do now?
What happens after I do it?
```

## 28.3 Sample data

Sample/demo content can help users understand a complex tool, but must be unmistakably distinguishable from real user data.

## 28.4 Do not over-onboard inside empty states

One useful action + relevant explanation normally beats a wall of feature education.

---

# 29. Commitment, progress and abandonment

Completion depends on more than interaction count.

A user abandons when perceived remaining cost becomes larger than expected value/confidence.

A useful conceptual model:

```text
continuation likelihood
≈ expected value
+ confidence
+ sunk progress visibility
− remaining effort
− uncertainty
− perceived risk
```

This is a synthesis, not a literal predictive equation.

## 29.1 Make progress meaningful

Progress indicators help when:

- process actually has stages
- user benefits from understanding remaining scope
- commitment is material

Avoid fake “Step 2 of 3” if each step expands unpredictably.

## 29.2 Save progress

For longer flows:

- autosave
- resume later
- clear draft state
- visible saved confirmation

can reduce abandonment more effectively than shortening the flow artificially.

## 29.3 Ask hard questions at the right time

Sequence should balance:

- early eligibility
- progressive commitment
- dependency order
- privacy/trust
- ease of answering

There is no universal “put easiest questions first” or “ask qualification first” law.

## 29.4 Explain cost before commitment

Unexpected cost near completion is severe trust friction.

Expose consequential:

- money
- time
- obligations
- data use
- cancellation constraints

before irreversible commitment.

---

# 30. Permissions, consent and consequential decisions

Permission prompts are UX decisions, not merely OS/API requirements.

## 30.1 Ask in context

A user understands a request better when it follows an action that explains why the capability is needed.

Bad:

> launch app → request camera, notifications, contacts, location

Better:

> user chooses “Scan receipt” → explain → request camera access

## 30.2 Explain value and consequence

Before consequential consent, answer:

- what is requested
- why
- what changes if accepted
- what happens if declined
- whether it can be changed later

## 30.3 Respect refusal

Declining optional permission should not create punishment patterns or repeated nagging.

## 30.4 Make privacy settings understandable

Do not rely on legal vocabulary alone. Plain-language explanation is part of informed control.

## 30.5 Risk-tier the interaction

For consequential actions, increase safeguards with:

```text
impact × irreversibility × uncertainty × user vulnerability
```

Low-risk reversible changes may need no confirmation. High-risk actions may require review, explicit consequence language, stronger authentication, second-party approval, cooling-off or staged execution.

**Do not optimize safety-critical flows for speed alone.**

## 30.6 Delegation and roles

For shared/multi-user systems:

- use role names that match users' real responsibilities
- expose permission scope clearly
- default toward least privilege appropriate to the task
- make ownership/approval state visible
- preserve who did what for consequential actions
- make revocation/delegation understandable

Organizational authorization models must be translated into user-comprehensible consequences.

---

# 31. Reliability, continuity and degraded experiences

Reliability is UX.

A beautiful flow that unpredictably fails is a poor experience.

## 31.1 Design for degraded states

Consider:

- slow connection
- offline
- partial data
- third-party outage
- expired session
- duplicate submission
- interrupted payment
- device switching

## 31.2 Idempotency is a UX property

If a user presses “Pay” twice because feedback was slow, the system should not charge twice.

Back-end resilience can eliminate front-end anxiety.

## 31.3 Communicate partial availability

Prefer:

> “Reports are temporarily unavailable. Your account and saved work are unaffected.”

rather than:

> “Something went wrong.”

## 31.4 Status pages and recovery communication

For material outages:

- acknowledge quickly
- update status honestly
- provide workaround if available
- close the loop when resolved

---

# 32. Customer effort as a design lens

A useful UX question is:

> **How much unnecessary work does the customer need to do to get the desired outcome?**

Effort can be:

- physical
- cognitive
- emotional
- temporal
- administrative
- social

## 32.1 Effort ledger

For each journey step, record:

```yaml
step:
customer_goal:
required_action:
required_information:
waiting_time:
uncertainty:
risk:
recovery_cost:
why_step_exists:
can_remove_or_automate:
```

## 32.2 Remove organisational effort first

High-value friction reduction often comes from:

- not requesting known data again
- better integration
- eliminating approval handoffs
- auto-filling
- changing policy/rules
- improving back-office process

not from moving a button.

## 32.3 Friction can be protective

Keep deliberate friction when it:

- prevents irreversible mistakes
- confirms high-risk transfer/payment
- protects privacy/security
- ensures informed consent
- allows user to review a consequential decision

Call this **protective friction**, not bad UX.

---

# 33. Measurement: define success from the customer outcome

UX metrics should start with the user's intended outcome and business outcome, then diagnose the experience in between.

Google's HEART framework was created specifically to map product goals to user-centered metrics at scale [GOOGLE-HEART].

## 33.1 Outcome hierarchy

### Level 1 — User outcome

Did the user accomplish the thing?

- task success
- correct outcome
- completion
- resolution

### Level 2 — Effort / efficiency

- time on task
- steps/interactions when meaningful
- repeated entry
- support contacts
- error/retry count
- abandonment

### Level 3 — Confidence / quality

- perceived ease
- confidence
- trust
- comprehension
- satisfaction

### Level 4 — Product/business

- activation
- retained usage
- qualified conversion
- revenue
- service cost
- support load

Do not optimize Level 4 by secretly damaging Levels 1–3.

## 33.2 HEART

HEART is a useful structure, not a mandatory dashboard:

- **Happiness**
- **Engagement**
- **Adoption**
- **Retention**
- **Task success**

For each category:

```text
goal → signal → metric
```

## 33.3 Task success is often the strongest UX anchor

For transactional UX, track:

```text
success rate
+ time/effort
+ errors
+ confidence/satisfaction
```

rather than only clicks or session length.

## 33.4 Engagement is not universally good

A banking transfer, booking or support task should not be designed to maximize “time in product”.

Sometimes the best experience is:

```text
arrive → complete → leave
```

## 33.5 NPS is not a UX truth metric

NPS can be useful as a relationship/attitudinal signal, but it cannot diagnose:

- where a task failed
- why a flow is hard
- which design caused an error

Never use it as the sole UX KPI.

## 33.6 Perceived usability is not task performance

A 2026 meta-analysis of 105 studies (2,570 users) found SUS strongly related to perceived workload, but task time/error rates were partly independent: the system with the higher SUS score still had poorer task time in 24% and poorer error rate in 23% of the compared studies [SUS-META].

Therefore a serious UX scorecard separates:

```text
TASK SUCCESS / ERRORS
EFFICIENCY / TIME / STEPS
WORKLOAD / EFFORT
PERCEIVED USABILITY (e.g. SUS)
CONFIDENCE / TRUST WHERE RELEVANT
ACCESSIBILITY / EXCLUSION
BUSINESS OUTCOME
```

Do not collapse them into one number.

## 33.7 NPS is a relationship metric, not a universal UX KPI

Longitudinal research across 21 firms and 15,500+ interviews failed to reproduce claims that Net Promoter was clearly superior to other customer metrics for predicting revenue growth [NPS-LONG].

NPS can be useful as one relationship signal. It does not diagnose:

- where a flow fails
- why a user is confused
- task completion
- errors
- accessibility
- cognitive effort

Never use it alone to declare UX quality.

---

# 34. User research: observe behavior, don't design from opinion

User-centered does not mean:

> “Ask users what feature they want and build it.”

It means understanding:

- what they are trying to achieve
- current behavior
- constraints/context
- existing workaround
- failure modes
- mental model
- actual response to prototypes/live service

GOV.UK explicitly says research should find what works, not merely what users say they like [GOV-RESEARCH].

## 34.1 Attitudinal vs behavioral

### Attitudinal
What people say/believe/report.

Examples:

- interviews
- surveys
- satisfaction
- preference

### Behavioral
What people actually do.

Examples:

- usability task behavior
- analytics
- A/B experiments
- field observation

Both matter. They answer different questions [NN-METHODS2].

## 34.2 Qualitative vs quantitative

### Qualitative
Best for:

- why is this happening?
- where is the friction?
- what mental model exists?
- how might we fix it?

### Quantitative
Best for:

- how often?
- how much?
- which variant performs better?
- is performance improving?

Do not ask a small qualitative sample to produce market percentages.

Do not ask analytics to explain human motivation by itself.

## 34.3 Discovery research

Before solution design, learn:

- real problem
- frequency/severity
- current journey
- competing solutions/workarounds
- context
- edge cases
- accessibility needs

Turn assumptions into research questions [GOV-RESEARCHPLAN].

## 34.4 Evaluative research

Once a concept exists, test:

- comprehension
- findability
- task success
- recovery
- trust
- accessibility

before engineering hardens the flow.

## 34.5 Continuous research

Research is not a kickoff phase.

GOV.UK explicitly recommends research throughout discovery, alpha, beta and live operation [GOV-RESEARCHLIVE].

## 34.6 Representative inclusion matters more than demographic decoration

Recruit around **behavioral/context differences that can change the experience**:

- novice/expert
- device/connectivity
- language/locale
- disability/access need
- frequency of use
- high/low domain expertise
- support dependency
- consequential/routine task

Averages can hide total failure for a critical subgroup.

## 34.7 Research method is part of the treatment

What people say while using a product can alter how they use it. A 2024 meta-analysis comparing concurrent vs retrospective think-aloud across 29 studies/42 comparisons found systematic tradeoffs: concurrent think-aloud lengthened task time, while retrospective sessions produced more explanations/problem formulations/design recommendations [THINKALOUD-META].

Choose method for the question; do not treat think-aloud as a transparent recording of cognition.

---

# 35. Usability testing

A usability test asks representative users to attempt realistic tasks while the team observes where the experience succeeds or fails.

## 35.1 Test behavior, not a guided demo

Bad task:

> “Click the blue button and create a report.”

Better:

> “You need to send last month's sales performance to your manager. Show me how you would do that.”

## 35.2 Do not rescue too quickly

Silence reveals:

- comprehension
- exploration
- hesitation
- mental model

Intervene for safety or when research protocol requires it, not because watching struggle is uncomfortable.

## 35.3 Five users is a heuristic, not a law

NN/g's famous recommendation of about five users is aimed at **iterative qualitative usability discovery** and explicitly has exceptions [NN-5USERS].

Use more participants when:

- multiple materially different user groups exist
- tasks differ by role
- accessibility needs vary
- failure is high-risk
- quantitative benchmarking is required

Quantitative usability studies generally require much larger samples; NN/g cites roughly 35+ as a common starting point for benchmarking contexts, subject to statistical design [NN-QUANT].

## 35.4 Severity matters more than issue count

Classify findings by:

- impact
- frequency
- recoverability
- business/customer consequence

One catastrophic failure can matter more than 15 cosmetic observations.

## 35.5 Test the real context when it matters

Examples:

- touch device for mobile task
- real lighting/noise for field workers
- assistive technology with relevant participants
- realistic account/data state
- actual time pressure where relevant

External validity matters [NN-QUALQUANT].

## 35.6 “Five users” is a starting heuristic, not evidence of saturation

Faulkner's study of 60 participants showed random groups of five found anywhere from 55% to 99% of the observed usability problems; the worst-case minimum rose to 80% with ten users and 95% with twenty in that study [FAULKNER].

Sample size should grow when:

- user population is heterogeneous
- workflows differ by role/device/locale
- issue prevalence matters
- stakes are high
- comparing variants quantitatively
- accessibility/subgroup coverage matters

Small formative rounds remain useful because they are fast; they are not population validation.

## 35.7 Beware novelty and prototype artifacts

Users may react to “newness”, incomplete prototypes, researcher presence or artificial task framing.

Protect interpretation by:

- counterbalancing comparison order where appropriate
- hiding irrelevant version labels
- using realistic content/data
- distinguishing prototype limitation from concept failure
- retesting in production/field contexts for important claims

---

# 36. Analytics and behavioral data

Analytics can show **where** behavior changes, but often not **why**.

## 36.1 Useful funnel events

For a flow:

```text
start
→ meaningful stage completion
→ validation/error
→ success
→ recovery/support
```

Do not instrument every click and assume more data means more insight.

## 36.2 Drop-off is a symptom

High drop-off can mean:

- flow is hard
- user learned they were ineligible
- task was optional
- information was sufficient without completion
- technical failure
- poor traffic quality

Pair analytics with research.

## 36.3 Rage clicks / repeated actions

Can indicate:

- unresponsive system
- false affordance
- missed feedback
- slow state update

But infer cautiously; instrumentation cannot know intent perfectly.

## 36.4 Support data is UX data

Analyze:

- contact reasons
- repeat contacts
- escalation
- time to resolution
- account recovery
- cancellation complaints

Support teams often see journey failures before dashboards do.

---

# 37. A/B testing and controlled experimentation

A/B testing answers:

> **Which of these specific implementations produces a better measured outcome under these conditions?**

It does not tell you what the fundamental user problem is.

## 37.1 Use A/B tests for mature uncertainties

Good:

- two validated wording approaches
- different sequence after core journey is understood
- optional default setting
- specific interaction treatment

Bad:

- test whether an obviously broken error flow should remain
- use conversion as the only outcome for a dark pattern
- randomize a safety-critical control without proper governance

## 37.2 Define primary outcome before launch

```yaml
hypothesis:
primary_metric:
guardrails:
minimum_material_effect:
segment_scope:
planned_duration:
```

## 37.3 Guardrail metrics

A conversion win is not a UX win if it causes:

- more cancellations
- more support contacts
- worse task accuracy
- privacy surprise
- accidental purchase
- lower trust

## 37.4 Qual before quant when the problem is unknown

A common sequence:

```text
qualitative discovery
→ prototype/usability testing
→ live experiment
→ longitudinal monitoring
```

not:

```text
randomize arbitrary screens until KPI moves
```

## 37.5 Experiment validity checks come before the p-value

A/B tests are only causal if randomization, exposure and telemetry remain trustworthy. Sample Ratio Mismatch (SRM)—observed allocation differing materially from configured allocation—is a known signal of assignment/logging/selection problems; Microsoft explicitly treats analyses with unexplained SRM as untrustworthy [EXP-SRM].

Pre-analysis checklist:

- randomization unit correct?
- sample ratio matches design?
- exposure logging symmetric?
- missing data/lossiness symmetric?
- no treatment-specific instrumentation?
- primary metric defined before reading results?
- guardrails healthy?

## 37.6 Short-term win ≠ long-term win

Microsoft experimentation research documents ways short-term metrics can diverge from long-term customer value through selection, survivorship, cookie instability and behavior adaptation [EXP-LONG].

For changes likely to alter habit/retention:

- use longer observation where justified
- include retention/quality guardrails
- consider persistent holdouts or follow-up cohorts
- avoid declaring victory solely on immediate engagement/revenue

## 37.7 Do not A/B-test an ethical minimum

Accessibility, clear consent, honest pricing, safe defaults and freedom to exit should not require a conversion experiment to justify them. Experiment within ethical constraints, not on whether deception pays.

---

# 38. Prioritization: fix customer harm before polishing preference

UX teams can drown in observations.

Prioritize by expected customer/business impact, not stakeholder volume.

## 38.1 Severity model

For each issue estimate:

```text
severity
≈ affected-user share
× consequence magnitude
× occurrence frequency
× recovery difficulty
× strategic importance
```

This is a prioritization heuristic, not a statistical formula.

## 38.2 Priority order

As a default:

1. **cannot complete / harmful outcome**
2. **wrong outcome / consequential mistake**
3. **cannot recover**
4. **high repeated effort**
5. **major comprehension/findability issue**
6. **low confidence/trust**
7. **efficiency improvement**
8. **delight / polish**

Exceptions depend on product purpose.

## 38.3 Frequency is not enough

A rare error that loses a customer’s money can outrank a common minor annoyance.

## 38.4 Effort vs value matrix

Use four buckets:

```text
high value / low effort → do early
high value / high effort → roadmap deliberately
low value / low effort → batch / opportunistic
low value / high effort → don't do
```

But “effort” includes organisational/policy complexity, not just engineering estimate.

---

# 39. UX decision tree

When designing any experience, move through this sequence.

## Step 1 — What is the user trying to accomplish?

If unclear → research before flow design.

## Step 2 — Is a product/feature required at all?

Could the outcome be achieved by:

- better information
- changing a policy
- integrating systems
- eliminating a step
- using an existing pattern/tool

If yes, do not invent software merely because a team can.

GOV.UK explicitly advises designing around user needs rather than technology or a preselected solution [GOV-WHOLE].

## Step 3 — What does the user already expect?

Identify:

- familiar convention
- analogous mainstream product
- domain-specific norms
- terminology
- previous journey state

Use the familiar model unless a new model creates a material, testable improvement.

## Step 4 — What information/action is truly required now?

Remove or defer:

- optional setup
- repeated data
- internal metadata
- future configuration

## Step 5 — What can go wrong?

Map:

- invalid input
- cancellation
- interruption
- timeout
- duplicate action
- service outage
- third-party failure
- accessibility barrier

Design recovery before launch.

## Step 6 — What feedback restores certainty?

Every consequential action needs state change the user can perceive.

## Step 7 — What must be measured?

Define:

- task success
- effort
- errors
- confidence
- business guardrails

before optimizing live behavior.

---

# 40. Standard for a new product or service

## Phase 0 — Frame the problem

Document:

```yaml
customer:
context:
job_or_outcome:
current_behavior:
current_alternatives:
frustrations:
consequences:
business_goal:
constraints:
unknowns:
```

Do not start with feature list.

## Phase 1 — Research current reality

Methods may include:

- interviews
- contextual inquiry
- field observation
- support-log analysis
- analytics
- journey mapping
- competitor/convention review

Outcome:

> **Evidence about the problem, not validation of the proposed product.**

## Phase 2 — Define success

Define customer metrics before UI:

```text
task success
acceptable effort/time
acceptable error rate
confidence/trust requirement
accessibility requirement
business outcome
```

## Phase 3 — Model the journey

Map:

```text
trigger
→ entry
→ orientation
→ decision
→ action
→ completion
→ recovery
→ continuation/exit
```

Include non-digital and partner touchpoints.

## Phase 4 — Simplify the journey before styling it

Ask of every step:

1. Why does this exist?
2. Who benefits from it?
3. Can it be removed?
4. Can the system infer it?
5. Can it be deferred?
6. Can it use an existing convention?

## Phase 5 — Prototype cheaply

Test flow/comprehension before high-fidelity visual polish.

## Phase 6 — Usability test

Use realistic tasks and representative people.

Iterate until major failure modes are resolved.

## Phase 7 — Accessibility and edge-case validation

Test:

- keyboard/assistive technology where relevant
- low digital confidence
- narrow screens / zoom
- slow/error states
- long/short content/data
- permissions denied
- interrupted sessions

## Phase 8 — Live with measurement

Instrument outcome, effort and recovery, not only conversion.

## Phase 9 — Research in production

Observe:

- support contacts
- failed attempts
- abandonment
- new edge cases
- changed customer expectations

A product is never “finished UX”.

---

# 41. Standard for a new flow or feature

Before building, complete this brief.

```yaml
name:
customer_problem:
customer_outcome:
why_now:
current_workaround:
known_mental_model:
familiar_pattern:
required_inputs:
required_decisions:
required_system_work:
protective_friction:
removable_friction:
error_states:
recovery:
accessibility_risks:
primary_success_metric:
effort_metrics:
guardrail_metrics:
research_needed:
```

## Feature gate

A feature should not ship because:

> “Competitor X has it.”

It should ship because it improves a defined customer/business outcome or satisfies a real constraint.

---

# 42. UX review checklist

## Customer

- [ ] Is the target customer/context explicit?
- [ ] Is the outcome written in user language?
- [ ] Is the design solving a real observed problem?
- [ ] Is this the smallest viable experience that solves the problem?

## Familiarity

- [ ] Does interaction match established conventions where possible?
- [ ] If a convention is broken, is the benefit material and validated?
- [ ] Are labels/terminology familiar?

## Cognitive load

- [ ] Can user recognize rather than recall?
- [ ] Is irrelevant information deferred/removed?
- [ ] Are related items grouped?
- [ ] Are complex decisions supported with criteria/comparison?

## Friction

- [ ] Is every required field/step justified?
- [ ] Is known information reused?
- [ ] Is repeated entry eliminated?
- [ ] Is protective friction intentionally distinguished from waste?

## Feedback

- [ ] Is every action acknowledged?
- [ ] Is loading/state visible when needed?
- [ ] Is progress truthful?
- [ ] Can duplicate actions occur?

## Error/recovery

- [ ] Are preventable errors prevented?
- [ ] Are messages specific and actionable?
- [ ] Is user input preserved?
- [ ] Can reversible actions be undone?
- [ ] Is human help available for exceptional/high-stakes cases?

## Trust/control

- [ ] Are costs/consequences visible before commitment?
- [ ] Are permissions contextual?
- [ ] Can user cancel/exit/change choices?
- [ ] Are defaults transparent and aligned with user interest?

## Accessibility

- [ ] Keyboard/accessibility semantics considered?
- [ ] Target sizes adequate?
- [ ] Color not sole carrier of meaning?
- [ ] Help consistent?
- [ ] Authentication accessible?
- [ ] Motion/dragging alternatives where required?

## End-to-end

- [ ] Does next channel/team preserve context/state?
- [ ] Are offline/partner steps coherent?
- [ ] Does support know what already happened?
- [ ] Can customer complete the whole task?

## Evidence

- [ ] Has it been tested with representative users?
- [ ] Do behavioral data and attitudinal data agree?
- [ ] Is success defined beyond conversion?

---

# 43. UX anti-playbook — what not to do

## 43.1 Product-first solutioning

Do not start with:

> “We need an AI dashboard / mobile app / onboarding wizard.”

Start with user outcome and evidence.

## 43.2 Engineer the customer around the system

Do not force users to learn:

- data-model concepts
- internal statuses
- database constraints
- organisational departments

because implementation is easier that way.

## 43.3 Optimize for fewest clicks as a goal

The three-click rule is not supported by evidence [NN-3CLICK].

A fourth obvious click is better than two ambiguous decisions.

## 43.4 Use Miller's 7±2 as a menu rule

Working memory research does not justify “never show more than seven navigation items”. Modern estimates often place a central working-memory capacity closer to around 3–5 meaningful chunks under controlled conditions [WM-COWAN][WM-REVIEW].

Navigation capacity depends on labels, grouping, familiarity and task.

## 43.5 Hide content because “users don't scroll”

Users scroll. The real risk is false endings and poor information scent [NN-SCROLL][NN-SCROLL-COMPLETE].

## 43.6 Design every page around an F-pattern

F-shaped scanning is one observed pattern, not a universal layout template, and can be associated with poorly formatted text [NN-FPATTERN].

## 43.7 Treat fewer choices as universally better

Choice overload is moderated by task difficulty, preference uncertainty and choice-set complexity [CHOICE-META].

Remove meaningless complexity, not valuable options.

## 43.8 Use dropdowns for everything — or ban them entirely

Dropdown appropriateness depends on option count, familiarity, screen context and selection behavior [NN-DROPDOWN].

## 43.9 Explain a confusing interface with a tutorial

Fix the interface first. Apple and GOV.UK both favor learnability/context over front-loaded explanation [APPLE-ONBOARD][GOV-WRITING].

## 43.10 Force onboarding tours

Card-style mobile tutorials have not reliably improved later task performance and can increase perceived difficulty [NN-TUTORIALS].

## 43.11 Ask permissions on launch

Ask when the value is understandable.

## 43.12 Force account creation before customer value

Where identity is not necessary, premature accounts create avoidable friction. Baymard repeatedly observes guest-checkout discoverability as a major ecommerce issue [BAYMARD-GUEST].

## 43.13 Use placeholder as the only label

It disappears and harms recall/accessibility.

## 43.14 Validate every keystroke aggressively

Premature hostile validation interrupts thought and increases cognitive load [NN-HOSTILEERROR].

## 43.15 Blame users in errors

“You entered an invalid value” is usually less helpful than stating what is needed and how to fix it.

## 43.16 Confirm every action

Routine confirmation dialogs create habituation. Prefer undo for reversible actions and confirmation for serious/irreversible consequences [NN-CONFIRM].

## 43.17 Delete unsaved work after errors/session expiry

Preserve effort wherever technically possible.

## 43.18 Fake progress

Do not use a progress bar that advances theatrically without meaningful relation to process.

## 43.19 Add animation to hide real latency without measuring it

A controlled smartphone experiment found animation could increase perceived duration in its setup [LATENCY01]. Improve real responsiveness first.

## 43.20 Maximize engagement by making exit difficult

UX is not successful when a user stays because cancellation is hidden.

## 43.21 Use dark patterns

Avoid deceptive defaults, forced continuity, obstruction, hidden costs, confirmshaming and privacy manipulation. A 2026 systematic review of user experiments found broad experimental agreement that deceptive/manipulative patterns change behavior, with large variation in effect size and limited success from external mitigations [FTC-DARK][OECD-DARK][EU-DARK][DARK-META].

## 43.22 Change familiar patterns for novelty

Novel interaction must earn its learning cost.

## 43.23 Equate minimalism with simplicity

Removing visible guidance can increase cognitive load. Simplicity = clear path with appropriate information.

## 43.24 Personalize unpredictably

A UI that moves controls or changes rules without clear user agency destroys learnability.

## 43.25 Design the happy path only

Errors, empty states, cancellation, interruption and recovery are part of the product.

## 43.26 Make support a maze

Self-service should reduce effort, not block access to resolution.

## 43.27 Ask users what they want and call it research

People are valuable sources about problems, context and reactions; they are not substitutes for product design or behavioral observation.

## 43.28 Treat preference as usability

A design can be liked but slower, error-prone or confusing.

## 43.29 Treat analytics as explanation

Analytics tells you what happened. It rarely tells you why without additional research.

## 43.30 “Five users proves it works”

Five-user guidance applies to iterative qualitative discovery, not statistical validation or all segments [NN-5USERS].

## 43.31 A/B test ethically questionable friction

Short-term conversion cannot justify deceptive or harmful UX.

## 43.32 Use NPS as the UX score

No single number captures task success, effort, accessibility, trust and recovery.

## 43.33 Optimize time-on-site for task products

Fast successful completion can be better than “engagement”.

## 43.34 Make mobile a stripped desktop

Adapt interaction to context; do not assume mobile users have smaller goals.

## 43.35 Make everything “delightful”

Serious moments need appropriateness, not confetti.

## 43.36 Hide complexity instead of managing it

Some domains are inherently complex. Progressive disclosure, comparison and good defaults are better than silently removing capability.

## 43.37 Use defaults against user interest

Defaults are behaviorally powerful; that creates responsibility, not permission to manipulate [DEFAULT01][DEFAULT02].

## 43.38 Make users repeat information across steps/teams

This increases effort and can violate accessibility principles [W3C-REDUNDANT].

## 43.39 Design each touchpoint locally

A locally optimized sales flow can create a terrible onboarding/support journey.

## 43.40 Ship without recovery

If you cannot answer “what does the user do when this fails?”, the flow is incomplete.

## 43.41 Treat “more trust in AI” as success

Trust should track actual reliability. Optimize appropriate reliance, not maximum trust [AI-RELIANCE].

## 43.42 Use explanations as a shield for bad AI output

Explanations can make wrong outputs more persuasive and do not reliably eliminate automation bias [AI-XAI-BIAS][AI-XAI-RISK].

## 43.43 Let an agent run to the end before the user can inspect anything

Long-horizon, consequential tasks need risk-based checkpoints and recovery opportunities [AI-CHECKPOINT].

## 43.44 Translate text and call the product localized

Localization can change directionality, names, addresses, currency, dates, legal requirements and cultural meaning [W3C-I18N][APPLE-RTL].

## 43.45 Block paste in password/OTP fields “for security”

This adds cognitive friction and conflicts with current NIST/WCAG guidance where assistive mechanisms are appropriate [NIST-AUTH][W3C22].

## 43.46 Treat SUS as task-performance proof

Perceived usability and task performance overlap but can disagree materially [SUS-META].

## 43.47 Trust an experiment with unexplained SRM

An allocation mismatch can indicate selection/telemetry failure and invalidate causal inference [EXP-SRM].

## 43.48 Optimize short-term metrics without long-term guardrails

Immediate engagement or revenue can move opposite to retention and lifetime value [EXP-LONG].

## 43.49 Batch every notification exactly three times per day

One RCT found benefits in that treatment, but cadence is context-dependent. Optimize interruption cost and urgency [NOTIFY-BATCH].

## 43.50 Assume prettier means easier

Aesthetics shows a positive average performance relationship, but effects are heterogeneous and can reverse [AESTH-META].

---

# 44. Contradiction ledger

| Common advice | V2 conclusion |
|---|---|
| **Customer first means business goals don't matter** | False. Sustainable UX aligns customer outcome and business outcome; manipulation is not alignment. |
| **Fewer clicks is always better** | False. Minimize unnecessary effort, not click count [NN-3CLICK]. |
| **Keep menus to seven items because Miller's Law** | False application. Working-memory capacity research does not create a universal navigation number [WM-COWAN]. |
| **More choice is bad** | Context-dependent. Choice overload has moderators [CHOICE-META]. |
| **Users don't scroll** | False as a general rule [NN-SCROLL]. |
| **Use F-pattern layouts** | F is one behavior pattern, not a layout prescription [NN-FPATTERN]. |
| **Onboarding tutorial is necessary** | Usually no; favor self-describing interaction + contextual guidance [APPLE-ONBOARD][NN-TUTORIALS]. |
| **Confirmations prevent mistakes** | Only selectively. Routine confirmation becomes friction/habituation; undo can be better [NN-CONFIRM]. |
| **Minimal is simple** | False. Missing context can make a sparse interface harder. |
| **Familiarity means copying Apple/Google** | No. Use established mental models/conventions; visual identity can differ. |
| **Innovative UX is better UX** | Only if material gain exceeds learning cost. |
| **Mobile users need less content/functionality** | Unsupported as universal rule. Context and presentation differ; user goal may be identical. |
| **Dropdowns are bad** | Context-dependent [NN-DROPDOWN]. |
| **Loading animations make waiting feel shorter** | Context-dependent. One controlled smartphone study found worse perceived wait/satisfaction, while newer experiments found benefits for some dynamic treatments and contexts [LATENCY01][LATENCY02]. |
| **Delight drives UX** | Delight amplifies a usable experience; it should not precede function. |
| **Gamification increases engagement** | Context/motivation-dependent; do not add points/badges without behavioral fit [GAME-META]. |
| **Five users is enough** | Useful qualitative heuristic with exceptions, not a statistical law [NN-5USERS]. |
| **Analytics replaces user research** | No. Behavioral scale and qualitative explanation are complementary [NN-METHODS2]. |
| **User interviews tell you what to build** | They reveal needs/context; design still requires synthesis/prototyping/testing. |
| **Service UX is just digital UX** | No. Whole journeys span channels, operations and partners [GOV-DESIGN][NN-SERVICE]. |
| **Every friction is bad** | No. Protective friction can prevent irreversible harm and enable informed choice. |
| **Engagement means success** | Not for task-focused products. Task completion may correctly reduce time/session depth. |

| Claim | V2 verdict |
|---|---|
| “Frictionless means zero friction” | **False.** Remove unjustified effort; preserve safety/verification where consequence requires it. |
| “Fewer clicks/steps is always better” | **False.** Total cognitive/physical effort and confidence matter more. |
| “Follow conventions no matter what” | **Too strong.** Familiarity is a default; innovation is justified when benefit exceeds relearning cost. |
| “More trust in AI is better” | **False.** Appropriate reliance is the target [AI-RELIANCE]. |
| “Explain the AI and users will know when it is wrong” | **False.** Explanations can help modestly but can also increase reliance on wrong outputs [AI-XAI-META][AI-XAI-RISK]. |
| “Human approval at every AI step is safest” | **Often unusable.** Oversight should be risk/cost-based; intermediate checkpoints can outperform both every-step and end-only review in some agentic tasks [AI-CHECKPOINT]. |
| “Translation = localization” | **False.** Locale affects data formats, layout/direction, culture and sometimes logic [W3C-I18N]. |
| “SUS tells us which design performs better” | **Not reliably.** Perceived usability and objective performance are partly independent [SUS-META]. |
| “Five users validate usability” | **False.** Useful heuristic for formative discovery, not a validation law [FAULKNER]. |
| “Never interrupt” | **False.** Interrupt when urgency/risk outweighs task-switching cost; otherwise defer/batch [INTERRUPT-META]. |
| “A/B result is trustworthy if p < .05” | **False.** Data/assignment integrity and SRM checks come first [EXP-SRM]. |
| “A short-term metric win predicts long-term value” | **Not necessarily.** Long-term experiments have selection/survivorship and behavioral pitfalls [EXP-LONG]. |

---

# 45. Practical UX templates

## 45.1 Customer problem brief

```yaml
customer_segment:
context:
trigger:
job_to_be_done:
desired_outcome:
current_behavior:
current_alternative:
main_frictions:
consequences_of_failure:
frequency:
constraints:
evidence_sources:
unknowns:
```

## 45.2 Journey map

```yaml
journey:
stages:
  - stage:
    customer_goal:
    actions:
    touchpoints:
    questions:
    emotions_confidence:
    friction:
    failure_modes:
    support:
    opportunities:
```

## 45.3 Service blueprint

```yaml
customer_action:
frontstage_interaction:
backstage_process:
people_roles:
systems_data:
partners:
policies_rules:
dependency:
failure_mode:
recovery_owner:
```

## 45.4 Usability test brief

```yaml
research_question:
target_participants:
critical_tasks:
scenario:
prototype_environment:
behavior_to_observe:
success_definition:
followup_questions:
accessibility_needs:
known_bias_risks:
```

## 45.5 UX hypothesis

```yaml
observation:
hypothesis:
change:
expected_customer_effect:
primary_metric:
guardrails:
evidence_needed:
decision_rule:
```

## 45.6 Friction audit

```yaml
step:
interaction_cost:
cognitive_cost:
waiting_cost:
trust_cost:
emotional_cost:
recovery_cost:
protective_or_waste:
remove:
automate:
default:
defer:
explain:
```

## 45.7 Error-state specification

```yaml
trigger:
user_visible_problem:
consequence:
preventable:
message:
recovery_action:
work_preserved:
retry_safe:
human_escalation:
analytics_event:
```

## 45.8 UX metric tree

```yaml
customer_outcome:
task_success_metric:
effort_metrics:
error_metrics:
confidence_metric:
accessibility_guardrail:
business_outcome:
long_term_metric:
```

## 45.9 AI/probabilistic UX risk brief

```yaml
user_outcome:
model_or_system_capability:
known_failure_modes:
stakes: low|medium|high
irreversibility:
what_user_must_verify:
source_or_evidence_shown:
edit_reject_undo_paths:
checkpoints:
escalation:
audit_history:
behavior_change_notification:
```

## 45.10 Localization readiness brief

```yaml
locales:
languages:
rtl_required:
date_time_formats:
number_currency_formats:
address_name_formats:
input_methods:
legal_consent_variants:
cultural_risks:
content_expansion_tested:
pseudo_localization:
local_user_research:
```

## 45.11 Experiment validity checklist

```text
[ ] hypothesis and primary metric preregistered internally
[ ] randomization unit correct
[ ] sample-ratio check passed
[ ] exposure/logging symmetric
[ ] guardrails defined
[ ] minimum practical effect defined
[ ] novelty/learning effects considered
[ ] long-term risk considered
[ ] decision rule defined
```

---

# 46. Operating cadence

## Continuous

- reliability incidents
- critical task failure
- accessibility blockers
- support spikes
- harmful/deceptive behavior

## Weekly

- funnel/task anomalies
- customer/support themes
- active usability findings
- experiment health
- newly observed edge cases

## Biweekly / sprint cadence

- at least one customer-learning loop where product cadence supports it
- prototype/usability evaluation before major implementation
- review unresolved high-severity friction

GOV.UK recommends ongoing research throughout delivery, including regular research sessions rather than one-off studies [GOV-RESEARCHLIVE].

## Monthly

- task-success/effort dashboard
- support/recovery analysis
- journey drop-off
- accessibility issues
- cancellation/reason data

## Quarterly

- end-to-end journey review
- service blueprint/process dependencies
- research coverage by segment
- stale assumptions
- convention/market changes
- customer-effort audit

## Before major launch

Run:

- journey review
- usability test
- accessibility review
- failure/recovery review
- measurement plan
- support readiness

---

# 47. UX quality scorecard

Do not reduce UX to one number, but a multi-dimensional review can expose blind spots.

Score each 1–5 **with evidence**, not opinion.

| Dimension | Question |
|---|---|
| Outcome | Can the customer achieve the right result? |
| Findability | Can they find where/how to begin? |
| Comprehension | Do they understand choices and consequences? |
| Effort | Is unnecessary work removed? |
| Predictability | Does behavior match expectations? |
| Feedback | Is state/action response clear? |
| Recovery | Can they recover without losing work/control? |
| Speed | Is real/perceived response acceptable? |
| Accessibility | Can diverse users complete the task? |
| Trust | Are costs, permissions, data and consequences transparent? |
| Control | Can user undo, exit, cancel and change choices? |
| End-to-end | Do channels/partners/handoffs remain coherent? |
| Emotional quality | Does experience feel appropriate and respectful? |
| Evidence | Is design validated with relevant users/data? |

**Do not average a catastrophic zero away.**

A journey that scores 5 on delight but 1 on task completion is not “3/5 UX”. It is broken.

## Additional V2 dimensions

| Dimension | Question |
|---|---|
| **Localization readiness** | Can the experience adapt without breaking meaning/layout/logic? |
| **Probabilistic transparency** | Do users understand meaningful AI limits and variability? |
| **Reliance calibration** | Can users detect/reject/correct bad automated output? |
| **Oversight/reversibility** | Are consequential automated actions reviewable and recoverable? |
| **Experiment trustworthiness** | Are causal decisions protected by data-quality/SRM/guardrails? |

---

# 48. One-page UX Golden Standard — V2

1. **Customer outcome first; product is a means.**
2. **Research the current problem before designing the solution.**
3. **Design the whole journey, not the team-owned screen.**
4. **Measure usability as effectiveness, efficiency and satisfaction in context [ISO11].**
5. **Optimize task success + effort + confidence, not raw click count.**
6. **Remove unnecessary friction; preserve protective friction.**
7. **Use familiar conventions unless a tested improvement justifies relearning.**
8. **Favor recognition over recall.**
9. **Progressively disclose complexity instead of dumping or hiding it.**
10. **Ask only for information required now.**
11. **Never make customers repeatedly enter information the service already has unless necessary [W3C-REDUNDANT].**
12. **Make onboarding fast, contextual and optional where possible [APPLE-ONBOARD].**
13. **Aim for early value, not early feature education.**
14. **Keep labels visible and language familiar.**
15. **Use defaults responsibly and transparently.**
16. **Support decisions; do not simply remove useful choice.**
17. **Every action should create perceivable feedback.**
18. **Improve real responsiveness before optimizing perceived wait; test loading treatments in context [LATENCY01][LATENCY02].**
19. **Prevent errors before writing error messages.**
20. **When errors occur: explain, preserve work and provide recovery.**
21. **Use undo for reversible mistakes; confirmation for serious irreversible consequences.**
22. **Make exit, cancellation and reversal discoverable.**
23. **Ask permissions at the point of understandable need.**
24. **Never use deception to improve conversion.**
25. **Design accessibility into the flow, not as a post-launch overlay.**
26. **Keep help predictable and provide human escalation for exceptional/high-stakes cases.**
27. **Preserve context across devices, channels, teams and partners.**
28. **Do not expose organisational complexity to the customer.**
29. **Design empty, loading, offline and failure states as first-class states.**
30. **Make progress truthful and preserve long-flow state.**
31. **Do not confuse minimalism with simplicity.**
32. **Do not confuse familiarity with visual sameness.**
33. **Do not assume mobile users have smaller goals.**
34. **Layer the experience so novices can learn and experts can accelerate.**
35. **Use delight only after clarity, control and reliability are secure.**
36. **Observe behavior as well as asking opinions.**
37. **Use qualitative research to learn why; quantitative data to learn how much.**
38. **Five-user usability testing is a qualitative heuristic, not a statistical law.**
39. **Use analytics as a problem detector, not a substitute for explanation.**
40. **A/B-test material uncertainty, not obvious defects.**
41. **Define guardrails so conversion wins cannot hide customer harm.**
42. **Support data, cancellations and recovery failures are UX data.**
43. **Fix high-severity customer harm before polishing low-impact preference.**
44. **Keep research continuous after launch.**
45. **If the customer cannot complete, understand or recover, the experience is not finished.**

---

## V2 additions

- Localize the **experience**, not just the strings.
- Support password managers, paste, accessible authentication and modern security patterns.
- Measure perceived usability and objective performance separately.
- In AI systems, optimize appropriate reliance and cheap correction—not maximum trust.
- Explanation is not verification; show evidence/context or support independent checking where stakes justify it.
- Give long-running automation risk-based checkpoints before errors become expensive.
- Treat user research/test methods as interventions that can influence behavior.
- Reject experiment conclusions when assignment/telemetry integrity fails.
- Protect long-term customer value from short-term metric optimization.

---

# 49. Research evidence map

This map makes the playbook auditable. **Official standards/guidelines define requirements or current platform practice; they do not automatically prove causal performance effects.** Meta-analyses and controlled studies get more weight for behavioral-effect claims, while practitioner research is used as applied evidence with explicit scope limits.

## Standards and human-centred/accessibility guidance

### ISO11 — ISO 9241-11:2018 — Usability: Definitions and concepts
**URL:** https://www.iso.org/standard/63500.html  
**Evidence:** `INTERNATIONAL_STANDARD`  
**Finding:** Defines usability as effectiveness, efficiency and satisfaction for specified users/goals in a specified context of use; frames usability as an outcome of use.  
**Limitation:** A definitional/framework standard, not a list of specific interface patterns or empirical effect sizes.  

### ISO210 — ISO 9241-210:2019 — Human-centred design for interactive systems
**URL:** https://www.iso.org/standard/77520.html  
**Evidence:** `INTERNATIONAL_STANDARD`  
**Finding:** Defines human-centred design principles and lifecycle activities, including explicit context understanding, user involvement, evaluation, iteration, whole UX and multidisciplinary work.  
**Limitation:** Process standard; it does not prescribe detailed UX methods or component patterns.  

### ISO115 — ISO 9241-115:2024 — Guidance on conceptual, interaction, UI and navigation design
**URL:** https://www.iso.org/obp/ui?_escaped_fragment_=iso%3Astd%3Aiso%3A9241%3A-115%3Aed-1%3Av1%3Aen  
**Evidence:** `INTERNATIONAL_STANDARD`  
**Finding:** Includes the current ISO definition of user experience as perceptions and responses resulting from use and/or anticipated use; covers conceptual/interaction/navigation design guidance.  
**Limitation:** Broad standard; many detailed recommendations still require contextual validation.  

### NIST-HCD — NIST — Human Centered Design
**URL:** https://www.nist.gov/itl/iad/human-centered-technologies/human-factors-human-centered-design  
**Evidence:** `OFFICIAL_HCD_GUIDANCE`  
**Finding:** Mirrors ISO HCD principles: understand users/tasks/environments, involve users, evaluate iteratively, address whole UX, use multidisciplinary skills.  
**Limitation:** Guidance/framework rather than controlled evidence for individual design patterns.  

## Apple Human Interface Guidelines

### APPLE-PRINCIPLES — Apple Human Interface Guidelines — Design principles
**URL:** https://developer.apple.com/design/human-interface-guidelines/design-principles  
**Evidence:** `PLATFORM_DESIGN_GUIDANCE`  
**Finding:** Apple’s 2026 principles emphasize purpose, familiarity, simplicity, feedback, recovery, responsibility and delight, while explicitly framing principles as tools for balancing tradeoffs.  
**Limitation:** Apple-platform practice/philosophy, not independent causal evidence.  

### APPLE-ONBOARD — Apple HIG — Onboarding
**URL:** https://developer.apple.com/design/human-interface-guidelines/onboarding  
**Evidence:** `PLATFORM_DESIGN_GUIDANCE`  
**Finding:** Recommends that products ideally teach through use; onboarding, when necessary, should be fast, interactive, focused and optional/contextual where possible.  
**Limitation:** Apple-specific guidance; onboarding needs vary with novelty, risk and domain.  

### APPLE-FEEDBACK — Apple HIG — Feedback
**URL:** https://developer.apple.com/design/human-interface-guidelines/feedback  
**Evidence:** `PLATFORM_DESIGN_GUIDANCE`  
**Finding:** Feedback should reveal state, action results, risk and recovery; interruptiveness should match significance and excessive alerts reduce their impact.  
**Limitation:** Practice guidance, not universal effect-size evidence.  

### APPLE-LOADING — Apple HIG — Loading
**URL:** https://developer.apple.com/design/human-interface-guidelines/loading  
**Evidence:** `PLATFORM_DESIGN_GUIDANCE`  
**Finding:** Recommends showing useful content/state as soon as possible and enabling other work during loading when feasible.  
**Limitation:** Does not imply a specific loader pattern is universally best.  

### APPLE-NOTIFY — Apple HIG — Notifications
**URL:** https://developer.apple.com/design/human-interface-guidelines/notifications  
**Evidence:** `PLATFORM_DESIGN_GUIDANCE`  
**Finding:** Notifications should be useful, timely, user-controlled and proportionate; interruption mechanisms should match importance.  
**Limitation:** Platform conventions and policies change; notification value depends heavily on context.  

### APPLE-GESTURES — Apple HIG — Gestures
**URL:** https://developer.apple.com/design/human-interface-guidelines/gestures  
**Evidence:** `PLATFORM_DESIGN_GUIDANCE`  
**Finding:** Standard gestures should remain predictable; custom/shortcut gestures should supplement rather than obscure core actions.  
**Limitation:** Apple interaction conventions are not identical across all platforms.  

### APPLE-BRANDING — Apple HIG — Branding
**URL:** https://developer.apple.com/design/human-interface-guidelines/branding  
**Evidence:** `PLATFORM_DESIGN_GUIDANCE`  
**Finding:** Encourages distinct brand expression without sacrificing platform familiarity, useful information or predictable behavior.  
**Limitation:** Brand guidance, not empirical proof of conversion/usability effects.  

## Google research and measurement frameworks

### GOOGLE-HEART — Rodden, Hutchinson & Fu — HEART: Measuring UX on a Large Scale, CHI 2010
**URL:** https://research.google/pubs/measuring-the-user-experience-on-a-large-scale-user-centered-metrics-for-web-applications/  
**Evidence:** `PEER_REVIEWED_HCI_FRAMEWORK`  
**Finding:** Introduces HEART and a goals-signals-metrics process to connect product goals with user-centred measures at scale.  
**Limitation:** Framework originates from Google web applications; teams must choose metrics appropriate to their own product and risks.  

### GOOGLE-M3E — Google Design + CHI 2026 — Material 3 Expressive research
**URL:** https://design.google/library/expressive-material-design-google-research  
**Evidence:** `VENDOR_RESEARCH + PEER_REVIEWED_SUBSTUDY`  
**Finding:** Google reports 46 studies/18k+ participants; a CHI 2026 study with 48 participants across 10 apps found faster correct fixation and task completion in tested expressive designs, while Google also documents failures when familiarity/labels were broken.  
**Limitation:** Vendor-led design program; effects are specific to tested designs and should not be generalized into “expressive is always better”.  

## GOV.UK service and research standards

### GOV-RESEARCH — GOV.UK — User research for government services
**URL:** https://www.gov.uk/service-manual/user-research/how-user-research-improves-service-design  
**Evidence:** `PUBLIC_SERVICE_GUIDANCE`  
**Finding:** Recommends understanding who users are, their goals, current behavior/context and including users with support/access needs throughout delivery.  
**Limitation:** Government-service context; methods/principles transfer better than specific operational cadence.  

### GOV-RESEARCHPLAN — GOV.UK — Plan user research for your service
**URL:** https://www.gov.uk/service-manual/user-research/plan-user-research-for-your-service  
**Evidence:** `PUBLIC_SERVICE_GUIDANCE`  
**Finding:** Turns assumptions into research questions, prioritizes learning needs and recommends continuous rounds embedded in product development.  
**Limitation:** Cadence recommendations are operational heuristics, not universal experimental law.  

### GOV-RESEARCHLIVE — GOV.UK — User research in live
**URL:** https://www.gov.uk/service-manual/user-research/user-research-in-live  
**Evidence:** `PUBLIC_SERVICE_GUIDANCE`  
**Finding:** Extends research after launch using analytics, support data, surveys, interviews, usability testing and A/B tests across end-to-end interactions.  
**Limitation:** Public-service environment; adapt cadence to product risk and maturity.  

### GOV-WHOLE — GOV.UK Service Standard — Solve a whole problem for users
**URL:** https://www.gov.uk/service-manual/service-standard/point-2-solve-a-whole-problem  
**Evidence:** `PUBLIC_SERVICE_STANDARD`  
**Finding:** Explicitly says to design around user needs rather than technologies/preselected solutions and coordinate across teams/organizations to solve the whole problem.  
**Limitation:** A service standard, not quantitative effect-size evidence.  

### GOV-DESIGN — GOV.UK Service Standard — Make the service simple to use
**URL:** https://www.gov.uk/service-manual/service-standard/point-4-make-the-service-simple-to-use  
**Evidence:** `PUBLIC_SERVICE_STANDARD`  
**Finding:** Requires simple, intuitive, comprehensible services, usability testing with real users and consistency across online/offline touchpoints.  
**Limitation:** Government standard; “simple” remains context-dependent rather than minimal-step dogma.  

### GOV-WRITING — GOV.UK — Writing for user interfaces
**URL:** https://www.gov.uk/service-manual/design/writing-for-user-interfaces  
**Evidence:** `PUBLIC_SERVICE_GUIDANCE`  
**Finding:** Advocates user language, low cognitive load, direct copy and fixing confusing interaction rather than explaining it with more words.  
**Limitation:** Tone specifics may be inappropriate for some brands/domains; clarity principle is broader.  

### GOV-ERROR — GOV.UK Design System — Error message
**URL:** https://design-system.service.gov.uk/components/error-message/  
**Evidence:** `PUBLIC_DESIGN_SYSTEM_GUIDANCE`  
**Finding:** Recommends visible, specific error messages that explain what went wrong and how to fix it, positioned near the relevant input.  
**Limitation:** Pattern guidance should be adapted to task severity and platform.  

## Standards and human-centred/accessibility guidance

### W3C22 — W3C — Understanding WCAG 2.2
**URL:** https://www.w3.org/WAI/WCAG22/Understanding/  
**Evidence:** `WEB_STANDARD / ACCESSIBILITY`  
**Finding:** Authoritative guidance for WCAG 2.2 success criteria covering perception, operability, predictability, input assistance, accessibility authentication and more.  
**Limitation:** Accessibility conformance is a floor, not a complete UX quality model.  

### W3C-TARGET — WCAG 2.2 — Target Size (Minimum), SC 2.5.8
**URL:** https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum  
**Evidence:** `WEB_STANDARD / ACCESSIBILITY`  
**Finding:** Level AA requires pointer targets to meet 24×24 CSS px or documented spacing/equivalent exceptions; larger targets can still be better.  
**Limitation:** Minimum conformance value is not an optimal target size for every context.  

### W3C-CONSIST — WCAG 2.2 — Consistent Help, SC 3.2.6
**URL:** https://www.w3.org/WAI/WCAG22/Understanding/consistent-help  
**Evidence:** `WEB_STANDARD / ACCESSIBILITY`  
**Finding:** Repeated help mechanisms should maintain consistent relative order, reducing rediscovery cost.  
**Limitation:** Applies to covered sets of web pages and specified help mechanisms.  

### W3C-REDUNDANT — WCAG 2.2 — Redundant Entry, SC 3.3.7
**URL:** https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html  
**Evidence:** `WEB_STANDARD / ACCESSIBILITY`  
**Finding:** Information already entered in the same process should generally be auto-populated or selectable, subject to security/essential exceptions.  
**Limitation:** Criterion is scoped to the same process and contains explicit exceptions.  

### W3C-FORMS — W3C WAI — Forms Tutorial
**URL:** https://www.w3.org/WAI/tutorials/forms/  
**Evidence:** `WEB_STANDARD / ACCESSIBILITY_GUIDANCE`  
**Finding:** Covers labels, instructions, grouping, validation and notifications; notes that shorter relevant forms reduce abandonment and burden.  
**Limitation:** Examples are web-form specific; underlying clarity/access principles generalize more broadly.  

### W3C-ERRORS — W3C WCAG 2.2 — Input Assistance / Error Prevention
**URL:** https://www.w3.org/WAI/WCAG22/Understanding/  
**Evidence:** `WEB_STANDARD / ACCESSIBILITY`  
**Finding:** WCAG input-assistance criteria emphasize identifying errors, suggesting corrections and preventing consequential mistakes where applicable.  
**Limitation:** Conformance criteria are minimum requirements and do not define complete recovery UX.  

## Nielsen Norman Group applied UX research

### NN-HEURISTICS — Nielsen Norman Group — 10 Usability Heuristics
**URL:** https://www.nngroup.com/articles/ten-usability-heuristics/  
**Evidence:** `PRACTITIONER_RESEARCH_SYNTHESIS`  
**Finding:** Long-lived heuristics covering system status, real-world match, user control, consistency, error prevention, recognition over recall and recovery.  
**Limitation:** Heuristics are inspection principles, not causal laws or substitutes for user research.  

### NN-RECOGNITION — NN/g — Memory Recognition and Recall in User Interfaces
**URL:** https://www.nngroup.com/articles/recognition-and-recall/  
**Evidence:** `PRACTITIONER_SYNTHESIS`  
**Finding:** Explains why recognition generally needs fewer memory retrieval demands than unaided recall and applies the distinction to interface design.  
**Limitation:** Design applications remain contextual; some expert workflows intentionally leverage recall for speed.  

### NN-MENTAL — NN/g — Jakob’s Law / mental models
**URL:** https://www.nngroup.com/videos/jakobs-law-internet-ux/  
**Evidence:** `PRACTITIONER_HEURISTIC`  
**Finding:** Users spend most of their time with other products and bring learned expectations to a new experience; familiar conventions reduce relearning.  
**Limitation:** A heuristic, not a prohibition on innovation; conventions can be improved when evidence justifies the cost.  

### NN-PROGRESSIVE — NN/g — Progressive Disclosure
**URL:** https://www.nngroup.com/articles/progressive-disclosure/  
**Evidence:** `PRACTITIONER_HEURISTIC`  
**Finding:** Shows how advanced/rare options can be deferred while preserving power, balancing learnability and capability.  
**Limitation:** Too much hiding can reduce discoverability; requires task/frequency judgment.  

### NN-3CLICK — NN/g — The 3-Click Rule for Navigation Is False
**URL:** https://www.nngroup.com/articles/3-click-rule/  
**Evidence:** `PRACTITIONER_RESEARCH_SYNTHESIS`  
**Finding:** Rejects arbitrary click-count limits; user success depends on information scent, confidence and task progression rather than a magic number.  
**Limitation:** Click count still contributes to effort when steps are unnecessary or costly.  

### NN-FPATTERN — NN/g — F-Shaped Pattern of Reading
**URL:** https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/  
**Evidence:** `EYE_TRACKING / PRACTITIONER_RESEARCH`  
**Finding:** Documents several scanning patterns and explicitly warns that the F-pattern is not universal and can signal weak formatting.  
**Limitation:** Mostly reading/content-layout research; not a universal app layout model.  

### NN-SCROLL — NN/g — Scrolling and Scrollbars
**URL:** https://www.nngroup.com/articles/scrolling-and-scrollbars/  
**Evidence:** `PRACTITIONER_RESEARCH`  
**Finding:** Shows that users do scroll while emphasizing discoverability, standard scrolling behavior and importance of initial viewport cues.  
**Limitation:** Older web study; exact attention distributions are not evergreen constants.  

### NN-SCROLL-COMPLETE — NN/g — Illusion of Completeness
**URL:** https://www.nngroup.com/videos/illusion-completeness/  
**Evidence:** `PRACTITIONER_RESEARCH`  
**Finding:** Shows that visual endings can make users believe no more content exists, suppressing scrolling.  
**Limitation:** Qualitative/usability evidence; exact prevalence depends on layout/context.  

### NN-TUTORIALS — NN/g — Mobile Tutorials: Wasted Effort or Efficiency Boost?
**URL:** https://www.nngroup.com/articles/mobile-tutorials/  
**Evidence:** `QUANTITATIVE_USABILITY_STUDY`  
**Finding:** 70-user study across four apps found card-style tutorials did not improve subsequent task success/speed and increased perceived difficulty in tested contexts.  
**Limitation:** Specific onboarding format and apps; does not mean all instruction is harmful.  

### NN-CONFIRM — NN/g — Confirmation Dialogs Can Prevent User Errors
**URL:** https://www.nngroup.com/articles/confirmation-dialog/  
**Evidence:** `PRACTITIONER_RESEARCH_SYNTHESIS`  
**Finding:** Recommends confirmations for serious/irreversible consequences, not routine actions; specific consequence wording and undo reduce habituation/error risk.  
**Limitation:** Heuristic/practice synthesis rather than broad controlled meta-analysis.  

### NN-DROPDOWN — NN/g — Does Your Form Really Need a Dropdown List?
**URL:** https://www.nngroup.com/articles/dropdown-list/  
**Evidence:** `PRACTITIONER_RESEARCH`  
**Finding:** Shows dropdown appropriateness depends on option count, familiarity, visibility and input task; hidden options add selection friction.  
**Limitation:** Pattern-specific; native/platform implementations and accessibility can change tradeoffs.  

### NN-ERROR — NN/g — Error-Message Guidelines
**URL:** https://www.nngroup.com/articles/error-message-guidelines/  
**Evidence:** `PRACTITIONER_RESEARCH_SYNTHESIS`  
**Finding:** Error messages should be visible, precise, respectful of user effort and recovery-oriented.  
**Limitation:** Examples are mainly digital interfaces; severity/context affect best recovery pattern.  

### NN-HOSTILEERROR — NN/g — Hostile Patterns in Error Messages
**URL:** https://www.nngroup.com/articles/hostile-error-messages/  
**Evidence:** `PRACTITIONER_RESEARCH`  
**Finding:** Documents cognitive/experiential cost of premature, aggressive validation and disruptive status messaging.  
**Limitation:** Qualitative pattern evidence; real-time validation can be beneficial when it detects a genuine committed error.  

### NN-5USERS — NN/g — Why 5 Participants Are Okay in Qualitative, Not Quantitative Studies
**URL:** https://www.nngroup.com/articles/5-test-users-qual-quant/  
**Evidence:** `METHOD_GUIDANCE`  
**Finding:** Clarifies that small iterative samples can uncover qualitative usability problems but do not support population-level quantitative estimates.  
**Limitation:** “Five” is a heuristic dependent on problem prevalence, segments, study goals and iteration strategy.  

### NN-QUANT — NN/g — Quantitative vs qualitative usability sample guidance
**URL:** https://www.nngroup.com/articles/5-test-users-qual-quant/  
**Evidence:** `METHOD_GUIDANCE`  
**Finding:** Explains that quantitative benchmarking needs substantially larger samples and inferential planning than qualitative issue discovery.  
**Limitation:** Sample needs depend on variance, minimum detectable effect and analysis plan; no universal N.  

### NN-QUALQUANT — NN/g — Qualitative vs quantitative research
**URL:** https://www.nngroup.com/articles/5-test-users-qual-quant/  
**Evidence:** `METHOD_GUIDANCE`  
**Finding:** Separates issue discovery from population estimation and warns against treating small qualitative metrics as representative.  
**Limitation:** Same source family as NN-5USERS; included because the playbook uses it for external-validity cautions.  

### NN-METHODS — NN/g — A Guide to Using UX Research Methods
**URL:** https://www.nngroup.com/articles/guide-ux-research-methods/  
**Evidence:** `METHOD_FRAMEWORK`  
**Finding:** Maps research methods across attitudinal/behavioral and qualitative/quantitative dimensions.  
**Limitation:** Taxonomy is practical guidance, not a causal claim about any method’s superiority.  

### NN-METHODS2 — NN/g — When to Use Which UX Research Methods
**URL:** https://www.nngroup.com/articles/which-ux-research-methods/  
**Evidence:** `METHOD_FRAMEWORK`  
**Finding:** Emphasizes “what people say” versus “what people do”, study context and qualitative/quantitative complementarity.  
**Limitation:** Method selection still depends on decision, risk, stage and resources.  

### NN-SERVICE — NN/g — Service Blueprints: Definition
**URL:** https://www.nngroup.com/articles/service-blueprints-definition/  
**Evidence:** `SERVICE_DESIGN_GUIDANCE`  
**Finding:** Defines blueprints as mappings of customer actions to frontstage/backstage people, processes and evidence, useful for exposing organizational causes of UX problems.  
**Limitation:** Blueprinting is a design/research tool; the artifact is only as valid as the underlying research.  

### NN-SERVICE2 — NN/g — UX Mapping Methods Compared
**URL:** https://www.nngroup.com/articles/ux-mapping-cheat-sheet/  
**Evidence:** `SERVICE_DESIGN_GUIDANCE`  
**Finding:** Distinguishes journey maps, experience maps, empathy maps and service blueprints and when each is useful.  
**Limitation:** Mappings can become speculative if not evidence-backed and maintained.  

## Baymard ecommerce usability research

### BAYMARD-CHECKOUT — Baymard — Checkout UX research/benchmark
**URL:** https://baymard.com/learn/checkout-flow-ux-optimization  
**Evidence:** `LARGE_DOMAIN_USABILITY_RESEARCH`  
**Finding:** Large ecommerce research program shows checkout friction often comes from excessive fields, poor hierarchy, unclear progress, account requirements and weak recovery rather than raw step count alone.  
**Limitation:** Ecommerce-specific and primarily observational/usability research; do not generalize exact percentages to every service.  

### BAYMARD-GUEST — Baymard — Guest checkout prominence
**URL:** https://baymard.com/learn/checkout-flow-ux-optimization  
**Evidence:** `LARGE_DOMAIN_USABILITY_RESEARCH`  
**Finding:** Finds users frequently overlook or abandon when guest checkout is absent/subordinate; recommends making it prominent and deferring account creation.  
**Limitation:** Applies where accounts are not genuinely required for the service.  

### BAYMARD-MOBILEFORM — Baymard — Mobile/form usability research
**URL:** https://baymard.com/research/mobile-ecommerce  
**Evidence:** `LARGE_DOMAIN_USABILITY_RESEARCH`  
**Finding:** Documents recurring mobile form issues including label persistence, field formatting, keyboards and data-entry friction.  
**Limitation:** Commerce/mobile context; exact controls differ across platforms.  

### BAYMARD-NAV — Baymard — Homepage & Category Navigation research
**URL:** https://baymard.com/research/homepage-and-category-navigation  
**Evidence:** `LARGE_DOMAIN_USABILITY_RESEARCH`  
**Finding:** Large ecommerce studies show navigation architecture strongly affects product finding and user understanding of available inventory.  
**Limitation:** Domain-specific; navigation patterns differ in productivity/content apps.  

### BAYMARD-SEARCH — Baymard — Ecommerce Search UX
**URL:** https://baymard.com/research-articles/ecommerce-search-query-types  
**Evidence:** `LARGE_DOMAIN_USABILITY_RESEARCH`  
**Finding:** 2026 benchmark reports 10k+ performance ratings across 170+ sites/apps and substantial search-support failures; search is a major product-finding path.  
**Limitation:** Ecommerce search evidence; not a universal argument for search in every small product.  

### BAYMARD-PAYMENT — Baymard — Checkout payment UX research
**URL:** https://baymard.com/learn/checkout-flow-ux-optimization  
**Evidence:** `LARGE_DOMAIN_USABILITY_RESEARCH`  
**Finding:** Supports transparent payment selection, forgiving input, visible totals and recoverable errors at a high-anxiety commitment step.  
**Limitation:** Commerce/payment-specific; regulatory/payment-provider constraints vary.  

## Academic / behavioral / HCI evidence

### CHOICE-META — Chernev, Böckenholt & Goodman — Choice overload meta-analysis, Journal of Consumer Psychology 2015
**URL:** https://doi.org/10.1016/j.jcps.2014.08.002  
**Evidence:** `META_ANALYSIS`  
**Finding:** 99 observations / 7,202 participants: overload depends on choice-set complexity, decision difficulty, preference uncertainty and effort-minimizing goal; option count alone is insufficient.  
**Limitation:** Consumer-choice literature; interface context and consequences can change moderators.  

### DEFAULT01 — Jachimowicz et al. — Defaults meta-analysis, Behavioural Public Policy 2019
**URL:** https://doi.org/10.1017/S2398063X18000268  
**Evidence:** `META_ANALYSIS`  
**Finding:** 58 datasets / 73,675 participants; average default effect d≈0.68 with substantial heterogeneity, including null/negative effects in some studies.  
**Limitation:** Many domains and default types; magnitude does not transfer directly to a specific UX setting.  

### DEFAULT02 — Johnson & Goldstein — Do Defaults Save Lives?, Science 2003
**URL:** https://doi.org/10.1126/science.1091721  
**Evidence:** `FIELD/BEHAVIORAL_EVIDENCE`  
**Finding:** Classic evidence that opt-in/opt-out defaults can materially change consequential decisions.  
**Limitation:** Organ-donation context; ethical and domain considerations limit direct UX generalization.  

### CLT-HCI — Kosch et al. — Survey on Measuring Cognitive Workload in HCI, ACM Computing Surveys 2023
**URL:** https://doi.org/10.1145/3582272  
**Evidence:** `SYSTEMATIC_HCI_SURVEY`  
**Finding:** Reviews how cognitive workload is conceptualized/measured in HCI and cautions that workload metrics and definitions vary.  
**Limitation:** Does not provide a single universal cognitive-load threshold or direct design recipe.  

### WM-COWAN — Cowan — The Magical Mystery Four, Current Directions in Psychological Science 2010
**URL:** https://pmc.ncbi.nlm.nih.gov/articles/PMC2864034/  
**Evidence:** `COGNITIVE_SCIENCE_REVIEW`  
**Finding:** Argues central working-memory storage is commonly around 3–5 meaningful items under conditions controlling rehearsal/chunking.  
**Limitation:** Capacity depends on material, chunking, attention and task; not a rule for menu item counts.  

### WM-REVIEW — Oberauer et al. — What limits working memory capacity?, Psychological Bulletin 2016
**URL:** https://pubmed.ncbi.nlm.nih.gov/26950009/  
**Evidence:** `PSYCHOLOGICAL_REVIEW`  
**Finding:** Reviews competing explanations for working-memory limits and reinforces that capacity is constrained and mechanism/context-dependent.  
**Limitation:** Theory review; does not map directly to a fixed UI element count.  

### HEDONIC01 — Hassenzahl — The Interplay of Beauty, Goodness, and Usability, HCI 2004
**URL:** https://doi.org/10.1207/s15327051hci1904_2  
**Evidence:** `CONTROLLED_HCI_STUDIES`  
**Finding:** Separates pragmatic/usability and hedonic attributes and finds both can shape overall evaluation, with actual use affecting pragmatic judgments.  
**Limitation:** Older, limited product contexts; supports a quality distinction, not a universal “delight” formula.  

### HEDONIC02 — Schrepp, Held & Laugwitz — Hedonic quality in business software, Interacting with Computers 2006
**URL:** https://doi.org/10.1016/j.intcom.2006.01.002  
**Evidence:** `EMPIRICAL_HCI_STUDY`  
**Finding:** Finds pragmatic and hedonic qualities both contribute to attractiveness/preference in the studied business interfaces.  
**Limitation:** Small/domain-specific historical study; emotional quality should not be prioritized over basic task success.  

### GAME-META — Barari et al. — Gamification meta-analytics review, Marketing Intelligence & Planning 2024
**URL:** https://doi.org/10.1108/MIP-10-2023-0569  
**Evidence:** `META_ANALYSIS`  
**Finding:** 62 studies / 71 samples / 20,510 participants; gamification effects operate through different experience dimensions and vary with reward/progression/customization, product benefits, involvement, familiarity and firm type.  
**Limitation:** Mostly mobile-app/consumer contexts; does not justify generic points/badges or addictive engagement design.  

### LATENCY01 — Zhao et al. — Smartphone loading duration perception, Applied Ergonomics 2017
**URL:** https://pubmed.ncbi.nlm.nih.gov/28802442/  
**Evidence:** `RANDOMIZED_CONTROLLED_STUDY`  
**Finding:** 43 participants: longer objective waits reduced satisfaction; the tested animation increased estimated duration and lowered speed/satisfaction versus black loading screen.  
**Limitation:** Specific loading treatment and smartphone tasks; not proof that all animation worsens waiting.  

### LATENCY02 — Website Loading Animation and Perceived Waiting Time, JTAER 2025
**URL:** https://doi.org/10.3390/jtaer20040306  
**Evidence:** `MULTI_EXPERIMENT_STUDY`  
**Finding:** Four experiments found tested dynamic animations reduced perceived wait relative to static displays, mediated by temporal attention and moderated by involvement/goal.  
**Limitation:** Online experiments and specific animation manipulations; should be validated in real tasks and does not replace real performance improvements.  

### RECOVERY-META — de Matos et al. 2007 + Das et al. 2026 — service failure/recovery meta-analyses
**URL:** https://doi.org/10.1177/1094670507303012  
**Evidence:** `META_ANALYSIS_FAMILY`  
**Finding:** Classic meta-analysis found a service-recovery paradox for satisfaction but not reliable downstream repurchase/WOM/image; 2026 meta-analysis integrates 147 online-service studies / 82,901 people using attribution/justice perspectives.  
**Limitation:** Recovery outcomes vary by failure severity, responsibility, fairness and channel; prevention remains preferable.  

## Web performance

### WEB-INP — web.dev — Interaction to Next Paint (INP)
**URL:** https://web.dev/articles/inp  
**Evidence:** `WEB_PERFORMANCE_STANDARD_GUIDANCE`  
**Finding:** Defines INP as responsiveness metric; current Core Web Vitals guidance treats ≤200 ms at the 75th percentile as “good”.  
**Limitation:** Web-specific metric/threshold; does not define acceptable latency for all service interactions.  

## Dark-pattern policy and regulation

### FTC-DARK — U.S. FTC — Bringing Dark Patterns to Light
**URL:** https://www.ftc.gov/reports/bringing-dark-patterns-light  
**Evidence:** `REGULATORY_GUIDANCE`  
**Finding:** Documents interface patterns that trick/trap consumers, including disguised ads, difficult cancellation, buried terms and privacy manipulation.  
**Limitation:** U.S. enforcement context; legal obligations vary by jurisdiction.  

### OECD-DARK — OECD — Dark commercial patterns
**URL:** https://www.oecd.org/en/publications/dark-commercial-patterns_44f5e846-en.html  
**Evidence:** `POLICY_REVIEW`  
**Finding:** Synthesizes evidence on prevalence/effects/harms of interfaces that steer, deceive, coerce or manipulate consumers.  
**Limitation:** Policy synthesis; not a controlled UX experiment and legal definitions vary.  

### EU-DARK — EU Digital Services Act — Article 25 interface design restrictions
**URL:** https://eur-lex.europa.eu/eli/reg/2022/2065  
**Evidence:** `LAW / POLICY`  
**Finding:** DSA restricts online-platform interface practices that deceive/manipulate recipients or materially impair free/informed decisions.  
**Limitation:** Scope applies to covered services/jurisdictions; specific obligations require legal interpretation.

## V2 additional evidence — second validation pass

### NIST-AUTH — NIST SP 800-63B Digital Identity Guidelines
**URL:** https://pages.nist.gov/800-63-4/sp800-63b.html  
**Evidence:** `NORMATIVE_SECURITY_STANDARD + USABILITY_GUIDANCE`  
**Finding:** Supports password managers/autofill and paste; recommends long password support, rejects arbitrary composition rules and forced periodic password changes without compromise evidence.  
**Limitation:** Authentication standard; exact assurance requirements vary by risk/regulatory context.  

### W3C-COGA — W3C Cognitive Accessibility supplemental guidance
**URL:** https://www.w3.org/WAI/WCAG2/supplemental/  
**Evidence:** `ACCESSIBILITY_GUIDANCE`  
**Finding:** Extends WCAG with cognitive-accessibility patterns around clear steps, familiar controls/language, predictable help and human support.  
**Limitation:** Supplemental rather than WCAG conformance requirements.  

### W3C-I18N — W3C Localization vs Internationalization
**URL:** https://www.w3.org/International/questions/qa-i18n  
**Evidence:** `WEB_STANDARD_GUIDANCE`  
**Finding:** Localization extends beyond translation to currency, keyboard, sorting, symbols/colors, legal rules, addresses/names, scripts and sometimes business/interaction logic.  
**Limitation:** General internationalization guidance; local research remains necessary.  

### APPLE-RTL — Apple HIG — Right to left
**URL:** https://developer.apple.com/design/human-interface-guidelines/right-to-left  
**Evidence:** `PLATFORM_DESIGN_GUIDANCE`  
**Finding:** RTL localization affects layout/text alignment/directional controls while some logos, numerals and real-world symbols should not be blindly mirrored.  
**Limitation:** Apple-specific implementation guidance; principles generalize better than component details.  

### NOTIFY-BATCH — Fitz et al. — Batching smartphone notifications can improve well-being
**URL:** https://doi.org/10.1016/j.chb.2019.07.016  
**Evidence:** `RANDOMIZED_FIELD_EXPERIMENT`  
**Finding:** In N=237, three daily notification batches improved several reported attention/productivity/mood/control outcomes vs usual notifications; hourly batching did little and no notifications increased anxiety/FoMO.  
**Limitation:** One smartphone field setting; do not universalize three batches/day.  

### INTERRUPT-META — Effects of interruption-management interventions, Applied Ergonomics 2021
**URL:** https://www.sciencedirect.com/science/article/pii/S0003687021001538  
**Evidence:** `SYSTEMATIC_REVIEW + META_ANALYSIS`  
**Finding:** Across 33 lab experiments/49 interventions, interruption-management interventions improved primary-task accuracy and reduced resumption lag on average, with substantial task/intervention variation.  
**Limitation:** Laboratory-heavy evidence; operational context and urgency matter.  

### AESTH-META — Schlamann, Nestler & Thielsch — Attractive Things Do Work Better, 2026
**URL:** https://doi.org/10.1080/10447318.2026.2664081  
**Evidence:** `PREREGISTERED_META_ANALYSIS`  
**Finding:** 31 studies, 234 effect sizes, N=18,794; visual aesthetics had a small-to-medium positive average effect on objective user performance (g≈.29), with high heterogeneity.  
**Limitation:** Large heterogeneity means aesthetics is not a guaranteed usability/performance uplift.  

### AI-HAX — Amershi et al. — Guidelines for Human-AI Interaction, CHI 2019
**URL:** https://www.microsoft.com/en-us/research/project/guidelines-for-human-ai-interaction/  
**Evidence:** `PEER_REVIEWED_HCI_GUIDELINES`  
**Finding:** 18 guidelines synthesize 20+ years of HAI research and were validated through multiple rounds including 49 design practitioners evaluating 20 AI products.  
**Limitation:** Guidelines require prioritization/tradeoffs; not a checklist or performance guarantee.  

### AI-PAIR — Google People + AI Guidebook
**URL:** https://pair.withgoogle.com/guidebook-v2/chapters  
**Evidence:** `RESEARCH-INFORMED_VENDOR_GUIDANCE`  
**Finding:** Organizes human-centered AI design around user needs, evaluation, mental models, explainability/trust, feedback/control and errors/graceful failure.  
**Limitation:** Applied guidance, not independent causal evidence for every pattern.  

### AI-RELIANCE — Microsoft Research — Appropriate Reliance on Generative AI, 2024
**URL:** https://www.microsoft.com/en-us/research/publication/appropriate-reliance-on-generative-ai-research-synthesis/  
**Evidence:** `RESEARCH_SYNTHESIS`  
**Finding:** Defines appropriate reliance as accepting correct and rejecting incorrect AI output; synthesizes ~50 papers on over/under-reliance and mitigation.  
**Limitation:** Rapidly evolving field; generative-AI tasks vary materially.  

### AI-XAI-META — How explanations from XAI decision support affect task performance, 2026
**URL:** https://doi.org/10.1080/12460125.2026.2616693  
**Evidence:** `META_ANALYSIS`  
**Finding:** AI support improves performance vs no support on average; explanations add only a small incremental gain over AI-only support and effects are heterogeneous.  
**Limitation:** Focuses largely on classification/decision-support tasks; explanation quality/task fit vary.  

### AI-XAI-RISK — Hunsicker et al. — Trust the Explanation or my Expectation?, 2026
**URL:** https://doi.org/10.1016/j.ijhcs.2026.103775  
**Evidence:** `CONTROLLED_EXPERIMENT`  
**Finding:** In N=218, explanations accompanying inaccurate outputs increased trusting behavior toward those wrong outputs in the studied decision task.  
**Limitation:** Specific task/design; shows risk, not that explanations are always harmful.  

### AI-XAI-BIAS — Vered et al. — Effects of explanations on automation bias
**URL:** https://www.sciencedirect.com/science/article/pii/S000437022300098X  
**Evidence:** `CONTROLLED_EXPERIMENTS`  
**Finding:** Explanations did not reduce automation bias and sometimes increased it, even while improving speed/accuracy in some conditions.  
**Limitation:** Context-dependent tasks/explanation forms.  

### AI-CHECKPOINT — When Should Users Check? CHI 2026
**URL:** https://doi.org/10.1145/3772318.3790655  
**Evidence:** `CONTROLLED_HCI_EXPERIMENT`  
**Finding:** In a 48-person within-subject study of multi-step agents, intermediate checkpoints were preferred by 81% and reduced completion time 13.54% vs confirm-at-end.  
**Limitation:** Exact checkpoint timing/effects are task-specific; do not copy the interval universally.  

### AI-OVERSIGHT — Dhanorkar, Passi & Vorvoreanu — Human oversight of agentic systems, FAccT 2026
**URL:** https://www.microsoft.com/en-us/research/publication/human-oversight-of-agentic-systems-in-practice-examining-the-oversight-work-challenges-and-heuristics-of-developers-using-software-agents/  
**Evidence:** `QUALITATIVE_EMPIRICAL_HAI_RESEARCH`  
**Finding:** Interviews with 17 experienced developers found oversight includes a-priori control, co-planning, real-time monitoring and post-hoc review.  
**Limitation:** Developer/software-agent population; exploratory rather than universal causal evidence.  

### SERVICE-HANDOVER — Leinonen & Roto — Service Design Handover to UX, 2023
**URL:** https://doi.org/10.1016/j.infsof.2022.107087  
**Evidence:** `SYSTEMATIC_LITERATURE_REVIEW`  
**Finding:** Review of 41 relevant publications identified communication quality/quantity, reducing transfer needs and verifying knowledge transfer; service vision, user stories and prototypes were key boundary objects.  
**Limitation:** Handover/project-process focus; empirical field validation remains limited.  

### RECOVERY-2026 — Das et al. — Online service failure and recovery meta-analysis, 2026
**URL:** https://doi.org/10.1016/j.jbusres.2025.115752  
**Evidence:** `META_ANALYSIS`  
**Finding:** 147 studies, cumulative N=82,901 across 24 countries; recovery outcomes are shaped by attribution, justice/fairness and emotional processes.  
**Limitation:** Online service-recovery literature; effects differ by failure/context.  

### DARK-META — Schaffner, Heysen & Chetty — Dark patterns experiments review, CHI 2026
**URL:** https://doi.org/10.1145/3772318.3790383  
**Evidence:** `SYSTEMATIC_REVIEW_OF_EXPERIMENTS`  
**Finding:** Experimental literature broadly agrees deceptive/manipulative patterns alter behavior, with large effect-size variation; external mitigation interventions often underperform.  
**Limitation:** Pattern definitions and contexts vary; behavioral effectiveness does not make patterns ethical.  

### SUS-META — Hertzum — SUS, workload and performance meta-analysis, 2026
**URL:** https://doi.org/10.1080/10447318.2026.2625260  
**Evidence:** `META_ANALYSIS`  
**Finding:** Across 105 studies/2,570 users, SUS strongly tracks workload but only partly tracks task time/error; higher-SUS systems were still slower in 24% and more error-prone in 23% of comparisons.  
**Limitation:** Mostly utilitarian/non-safety-critical systems; use SUS with, not instead of, performance measures.  

### NPS-LONG — Keiningham et al. — Net Promoter and firm revenue growth, 2007
**URL:** https://doi.org/10.1509/jmkg.71.3.039  
**Evidence:** `LONGITUDINAL_MARKETING_RESEARCH`  
**Finding:** 21 firms and 15,500+ interviews failed to replicate claims of clear NPS superiority over other satisfaction/loyalty metrics for revenue growth.  
**Limitation:** Firm-level relationship research, not a direct usability experiment.  

### FAULKNER — Beyond the five-user assumption, 2003
**URL:** https://doi.org/10.3758/BF03195514  
**Evidence:** `EMPIRICAL_USABILITY_METHODS_STUDY`  
**Finding:** Random groups of five users found 55–99% of observed problems in one 60-user study; minimum coverage increased with larger samples.  
**Limitation:** One system/study; demonstrates variability rather than a universal required N.  

### THINKALOUD-META — Hertzum — Concurrent vs retrospective thinking aloud, TOCHI 2024
**URL:** https://doi.org/10.1145/3665327  
**Evidence:** `META_ANALYTIC_REVIEW`  
**Finding:** 29 studies/42 comparisons; concurrent think-aloud lengthens task time, while retrospective protocols elicit more explanations/problem formulations/recommendations.  
**Limitation:** Protocol tradeoffs vary; neither method is universally superior.  

### PROGDISC-AI — Anik & Bunt — Training Dataset Explanations and Progressive Disclosure, IUI 2026
**URL:** https://doi.org/10.1145/3742413.3789087  
**Evidence:** `CONTROLLED_HCI_STUDY`  
**Finding:** N=32; more detailed training-data explanations increased perceived trust/fairness/understanding and were preferred despite higher cognitive load; progressive disclosure improved perceived learning but did not remove cognitive load.  
**Limitation:** AI training-data explanation context and small sample; not a universal disclosure-effect estimate.  

### EXP-SRM — Microsoft Research — Diagnosing Sample Ratio Mismatch
**URL:** https://www.microsoft.com/en-us/research/publication/diagnosing-sample-ratio-mismatch-in-online-controlled-experiments-a-taxonomy-and-rules-of-thumb-for-practitioners/  
**Evidence:** `LARGE-SCALE_EXPERIMENTATION_PRACTICE + RESEARCH`  
**Finding:** SRM is a key symptom of assignment/telemetry/selection problems that can invalidate A/B-test conclusions; derived across multiple large products/companies.  
**Limitation:** Online controlled experimentation context.  

### EXP-LONG — Microsoft Research — Pitfalls of Long-Term Online Controlled Experiments
**URL:** https://www.microsoft.com/en-us/research/?p=683337  
**Evidence:** `EXPERIMENTATION_RESEARCH / LARGE-SCALE_PRACTICE`  
**Finding:** Short/long experiment interpretation can be distorted by survivorship, selection, cookie stability and perceived trends; short-term metrics may fail to represent long-term value.  
**Limitation:** Online product experimentation; exact mitigation depends on product/data architecture.

---

# 50. Source-handling rules

1. **Use standards for definitions/minimum requirements, not as universal causal proof.** ISO/WCAG tell us what usability/accessibility constructs or conformance requirements are; they do not tell us that one layout universally converts better.
2. **Prefer meta-analysis and controlled evidence for behavioral claims.** When a UX slogan conflicts with higher-level evidence, downgrade the slogan.
3. **Treat Apple, Google, GOV.UK, NN/g and Baymard as high-value applied guidance with scope.** Their guidance can be excellent, but platform/domain/practitioner evidence is not automatically universal.
4. **Separate usability, preference and business outcome.** “Users prefer it”, “users complete faster” and “conversion rises” are different claims.
5. **Do not promote a heuristic into a law.** Three-click rules, F-pattern layouts, 7±2 menu limits, “fewer choices”, “onboarding tours”, “gamification”, loader animations and similar patterns need context.
6. **Research observable behavior as well as attitude.** Attitudinal and behavioral measures answer different questions; neither replaces the other.
7. **Use quantitative evidence only at a sample size/design appropriate to inference.** Small qualitative studies identify problems; they do not estimate population rates reliably.
8. **Do not average away critical failure.** Accessibility, safety, data loss, deception or inability to complete a core task can invalidate an otherwise attractive aggregate score.
9. **Update volatile platform guidance.** Apple, Google, browser metrics, laws and component conventions can change; the evergreen layer is the human/task principle behind them.
10. **When evidence conflicts, preserve the boundary condition.** The correct rule is often “works when X” rather than a winner-takes-all best practice.
11. **AI/agentic UX evidence is fast-moving.** Treat current HAI syntheses and 2026 studies as strong direction, not timeless fixed component rules.
12. **Do not infer objective performance from subjective preference/usability scores.** Report both when the decision matters [SUS-META].
13. **Experiment validity precedes effect interpretation.** Unexplained assignment/telemetry failures invalidate conclusions [EXP-SRM].
14. **Localization standards describe classes of difference; local user research validates actual cultural effects.**
15. **Security/accessibility standards can override local conversion gains.** Do not experiment users into unsafe or inaccessible minima.
16. **Progressive disclosure is a sequencing heuristic, not proof that less visible information lowers cognitive load.** Preserve critical decision evidence and test complex disclosures [PROGDISC-AI].

---

# 51. Validation note — V2 second research pass, cutoff 21 September 2026

V2 re-validates V1 against current ISO/W3C/NIST standards, Apple/Google/GOV guidance, HCI/behavioral research, service-recovery literature, experimentation research and a substantial new human-AI/agentic-UX evidence layer. It adds explicit standards for localization, modern authentication, cognitive accessibility, interruption management, appropriate AI reliance, agentic oversight, objective-vs-subjective UX measurement and trustworthy experimentation.

The final evidence audit contains **93 source IDs: all 93 are used, all 93 resolve to exactly one source definition, and there are no missing, duplicate or dead source IDs.**

### V2 coverage audit

The second research pass explicitly rechecked:

- human-centred design and customer-first doctrine
- friction, cognitive load, memory and progressive disclosure
- familiarity, mental models, IA and navigation
- onboarding and first-value
- forms, checkout, passwords, authentication and data entry
- choices, defaults and decision architecture
- feedback, errors, confirmations, undo and recovery
- performance, perceived speed, interruptions and notifications
- trust, privacy, control and deceptive patterns
- accessibility, cognitive accessibility and assisted access
- aesthetics/delight versus objective performance
- novice/expert and device/channel context
- localization, internationalization and RTL
- end-to-end journeys, service handoffs and support
- probabilistic AI, explanations, reliance, agents and oversight
- UX writing, search/filtering, empty states and progress
- consent, consequential decisions, roles/delegation and reliability
- customer effort and service recovery
- measurement, SUS, NPS and outcome metrics
- qualitative/quantitative research and usability-test methods
- analytics, A/B experimentation, SRM and long-term effects
- prioritization, rollout standards, review checklists and anti-patterns

The final rule remains deliberately conservative: a principle is written as universal only when its scope justifies that language. Otherwise V2 records the boundary condition.

## V2 validation verdict

> **Design the whole experience around the user's real outcome and context; preserve familiar mental models unless improvement justifies relearning; minimize unjustified effort and uncertainty; keep state, consequences and recovery legible; support inclusive/localized access; and, when systems are probabilistic or act on the user's behalf, calibrate reliance and oversight to risk rather than asking users for blind trust. Validate important claims with observed behavior, objective outcomes and trustworthy experiments.**

---
