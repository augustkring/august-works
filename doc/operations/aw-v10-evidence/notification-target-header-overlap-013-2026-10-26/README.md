# Notification target-size geometry attempt 013

The fresh Playwright list gate found the single notification settings test. Axe still failed the `.saas-row > input[type="checkbox"]` target-size check, so a bounded test-only geometry observer captured the actual element position and occluding elements.

The checkbox had computed dimensions 24×24 at `x=256,y=-6` after the interaction had scrolled the document to `scrollY=1396`. `elementsFromPoint` at its center reported the fixed header's help link and sticky header, explaining the 24×6 visible area. This is an offscreen prior-preference row partially underneath the sticky header at the later interaction scroll position. The temporary observer has been removed. A new rerun audits at the stable top scroll position; this attempt itself is a failure.
