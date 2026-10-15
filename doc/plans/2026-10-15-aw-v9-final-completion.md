# V9 remaining implementation after PR 38

Baseline: merged master `e5124bd126c5d53ad2de7924687b5a06ed290048`.
PR 38's configured CI passed on source `4a12891d61e3fe1462a6f079091b7110d9cffecd`;
the merge has the same tree. That is software verification, not V9 release
acceptance. This follow-up does not change the R0 declaration.

## Implemented corrections

- **V9-070:** The shared stylesheet applies reduced-motion duration, delay and
  loop limits to shared utilities and pseudo-elements, retaining a finite
  animation lifecycle for presence teardown. Existing static alternatives stay
  in place. The autofill color-flash workaround is exempt from the transition
  override. JavaScript scrolling reads the current preference at dispatch,
  including explicit smooth requests and virtualizer defaults. Existing
  lifecycle-aware TaskMessageScroller and SidePanelTabs guards remain owners.
  The committed codemod is repeatable and preserves already-adapted files.
- **V9-077:** Toast presentation keeps at most five timers and 512 deduplication
  keys, including bursts in one React batch. Eviction may forget an old display
  duplicate; it never changes an Original operation or delivery receipt. The
  virtualized thread retains measurements only for rows in the current
  snapshot, including current offscreen rows; replacement snapshots no longer
  grow its lifetime cache. Returning removed IDs remeasures their content.
- **V9-045–047:** A semantic chat card's plain-text fallback now includes its
  sanitized title and body as well as why/consequence/evidence. Exact duplicate
  sections are collapsed. Original callbacks, authorizers and source bindings
  remain unchanged. All 18 semantic kinds are exercised through both installed
  Slack and Teams renderers. This is transport/software evidence, not a live
  Slack-only journey or provider delivery qualification.

## Verification record

The first broad UI attempt was interrupted after eight IssueChatThread failures:
the new helper had selected static scrolling when `matchMedia` was absent.
The helper now preserves the caller's requested behavior when that API is
unavailable and honors the live preference when it exists. No scrolling assertion
was weakened. The corrected focused UI run passes 92 cases, including the
10,000-event toast burst and row-removal/reintroduction regression.

The first complete card-vocabulary test exposed the missing body in text
fallbacks (36 failures, eight previous cases passed). The production fallback
was corrected; the following adapter/projection run passes 56 cases. An
additional title/body leakage and exact-duplicate regression is included in
the final verification scope.

The standalone Chromium check reads the actual token stylesheet and exercises
normal → reduced → normal preference changes, loops, delays, pseudo-elements,
transitions and finite animation completion. It passes. It does not claim a
built-component or manual assistive-technology audit. CI runs it in the existing
V9 component job with its installed Chromium. Token gates pass.

Final broad verification results must be recorded before PR-ready hand-off.

## Remaining closure boundaries

The 120-row backlog and 70-surface manifest remain authoritative working
inventories. Passing a new focused regression does not complete an entire row.
The outstanding analytics/funnel and legacy convergence work is not reclassified
as external qualification. The brief's §37 requires semantic/accessibility
parity and an observed support/usage window before legacy deletion. §64 explicitly
separates hosted/provider/compute/physical credential qualification from source
work. Optional MCP Apps tool forwarding, PostHog and starter compute cannot be
made launch requirements by enabling their closed capabilities.

No live installation or Slack/Teams qualification targets are configured in the
current managed environment. The user has been asked for existing test-target
URLs/connection names while local implementation continues. No provider send,
customer contact, purchase or production deployment is implied by local tests.
