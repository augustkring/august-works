---
name: pb-ui-ux-writing
description: >
  Routes interface, experience and copy work to the right chapters of the UI,
  UX, Web Frontend, Universal Design and WR-00 Writing playbooks without loading
  them whole. Use when building or reviewing screens, forms, states (loading,
  empty, error), navigation, accessibility, responsive layout, localization
  (English/Danish), onboarding, help text, error messages or button labels.
  Use alongside the design-guide skill.
---

# UI, UX and writing playbook router

Each playbook is 28k-57k tokens. Never read one whole.

## How to read

1. Open the index under `doc/reference/aw-v9/playbooks/index/` (`ui_master_playbook_v2.md`,
   `ux_master_playbook_v2_double_validated_2026-09-21.md`, `web_frontend_engineering_master_playbook_v2.md`,
   `universal_design_principles_master_playbook_v2.md`, `WR-00_Universal_Writing_Content_Editorial_Standard_v2.0.md`).
2. Read only the line range of the chapter named below.
3. Repo rules come first: `DESIGN.md`, the token-only rule (run `pnpm check:token-gates`),
   `pnpm check:customer-brand`, `AGENTS.md` section 9 (form footers), and the design-guide skill.

## Which chapters, by change type

| Change | Chapters |
|---|---|
| New screen or layout | UI: 5 State architecture, 8 Layout, 9 Density. UX: 5 Outcome model, 9 Information architecture |
| Forms | UI: 14 Forms and data entry. UX: 11 Forms. Frontend: 16 Forms and validation |
| Loading, empty, error, permission-blocked states | UI: 15 Disabled/hidden/read-only, 22 Loading and status. UX: 13 Feedback, 14 Errors, 28 Empty and first-value states. Frontend: 27 Async, empty and failure states |
| Destructive or consequential actions | UI: 23 Undo and destructive actions. UX: 30 Permissions, consent and consequential decisions |
| Keyboard, focus, accessibility | UI: 16 Focus and keyboard, 27 Accessibility floor. Frontend: 21 Accessibility engineering, 38 Accessibility release gate |
| Navigation and search | UI: 11 Navigation, 21 Search/filter/sort. UX: 27 Search and finding |
| Onboarding and first run | UX: 10 Onboarding, 28 First-value states |
| Agent and AI surfaces | UI: 28 AI-native and agentic UI. UX: 25 Probabilistic and agentic UX |
| English and Danish | UI: 26 Localization and content expansion. UX: 22 Localization. Frontend: 26 i18n |
| Performance as felt by users | UX: 15 Perceived speed. Frontend: 20 Performance, 39 Performance gate |
| Copy: labels, errors, help | WR-00: 4 Golden Writing Standards, 7 Wording and precision, 14 Templates and decision aids. UX: 26 UX writing |
| Screen review | UI: 34 UI review checklist. Frontend: 36 Component review, 37 Route/journey review |

## Output

For each finding, report the screen or file:line, the chapter, what a user would experience, and the
fix using existing tokens or components.
