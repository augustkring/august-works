---
name: web-design-guidelines
description: >
  Review UI code against the Vercel Web Interface Guidelines (accessibility,
  focus states, forms, animation, typography, images, performance, navigation,
  touch, dark mode, localization and copy). Use when asked to review UI or UX
  code, check accessibility, or audit a page or component. Use with the
  design-guide and pb-ui-ux-writing skills.
metadata:
  author: vercel (adapted)
  source: vercel-labs/agent-skills web-design-guidelines; rules from vercel-labs/web-interface-guidelines at commit 434b7f91364665f2f733b310ec54809bf8f37937 (MIT, see LICENSE)
---

# Web Interface Guidelines

Review files for compliance with the Web Interface Guidelines.

The rules are pinned in `guidelines.md` next to this file. The upstream skill fetches them from the
web on each run; this copy is committed so the rules change only through a reviewed pull request.

## How to review

1. Read `guidelines.md` in this directory.
2. Read the files the user named, or ask which files to review.
3. Check each file against every rule and report findings in the terse `file:line` format that
   `guidelines.md` describes.

## Repository rules come first

- `DESIGN.md` and the token layer in `ui/src/index.css` decide colours, spacing, type and motion.
  Fix a finding with an existing token or component, and run `pnpm check:token-gates`.
- Customer copy must pass `pnpm check:customer-brand`, and must exist in both English and Danish.
- Where a guideline conflicts with `DESIGN.md`, follow `DESIGN.md` and note the conflict.

## Updating the pinned rules

Copy the new `command.md` from vercel-labs/web-interface-guidelines into `guidelines.md`, update the
commit in the metadata above, and review the diff in the pull request.
