# Canonical Agents, Skills and Costs owners

Baseline: `69066116de79879af9e933df96584d4540e92d5b`.

## Implementation

The classic and current routes now share the existing Native Agents, Skills
and Costs implementations. The `.production` module boundaries remain as
compatibility shims. Classic Agents retains its tree, mobile list fallback and
wrapped narrow titles; current Agents retains its interactive organization chart
and title truncation. Both use the same reader, membership and action owners.
Classic Skills retains All/Installed/Catalog/Bundled, category/folder rails,
Studio and existing detail/install/draft owners. The canonical implementation
already contained most of that behavior; the consolidation restores the visible
Studio action and the old `view=catalog` entry. An explicit tab change removes
that obsolete alias while preserving unrelated query filters. Costs preserves
standalone defaults and the embedded Audit/Budgets variants. Visible company
labels use V9's Company term.

This removes more than 7,500 duplicate implementation lines without deleting
the classic experience, import boundaries, old routes or the instance preference.
The support/usage window required for final flag retirement remains open.
Authenticated SaaS and explicit local onboarding still have distinct purposes;
their presence alone does not authorize removing either workflow.

## Accessibility and composition corrections

Actual built-browser checks exposed a dangling `aria-controls` on Audit/Costs.
Agents and classic Skills used the same incomplete tab/panel pattern. These
owners now render the current content in the corresponding Radix panel, with
its Original trigger/label binding. Routing, query scopes and Native writers
are preserved.

The actual paused Agent chip measured only 2.79:1 in light mode. A Chromium
probe of the real stylesheet also found running/error/review failures in dark
mode. The shared text-tone recipe now derives darker light-mode text and
lighter dark-mode text from the unchanged status hues and fills. The probe
passes all 11 default hues on background/card/popover in both themes. Actual
Agent/Task component-to-token bindings remain covered by their existing tests.
Operator-custom palettes and manual assistive-technology qualification are not
inferred from this default-palette check. CI runs the probe in its existing
Chromium component lane.

Costs now groups its snapshot and ledger metrics as definition lists instead
of nesting metric cards inside cards. All values, qualifications and budget
controls remain. Small muted uppercase labels become readable sentence-case
labels; machine values use the existing monospace token. The semantic group
boundaries remain visible in both themes without eight extra card frames.

The personal observation preference audit records only the purpose of the
change. It does not broadcast the person's choice/version into the company
Activity Log. The private preference receipt and read remain the current
person's source for that state; passive observations are still never audited
as a copied stream.

## Verification boundary

The consolidated owners pass 63 focused cases, including existing Agents,
Skills, Costs, navigation and AuditHub behavior plus the real panel binding.
The first browser attempt found the Audit panel defect; the expanded attempt
found the paused contrast defect. After correcting both, the actual Native
classic/current browser cases pass with Agents/Skills accessibility checks and
light/dark narrow Costs checks. Fixtures create only a paused zero-budget
process Agent and a local Skill; no task, heartbeat, model or provider effect
is produced. Deep-link query/hash values and Native reads remain intact.

The added legacy alias-switch regression, final direct types, updated
PostgreSQL audit check and exact committed-source browser follow-up must finish
before PR-ready claims. These changes advance V9-066/068/069/071/073; they do
not establish representative Human usability, a hosted usage window or GA.
