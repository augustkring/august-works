# V9 Custom Agent language continuity — 2026-10-11

Status: implemented; scoped tests, strict UI types and built browser passed.

Custom Agent now uses the existing experience locale owner for all thirteen
sections, field labels, action consequences, loading/error/retry states and
saved-version/progress summaries. Fixed Native authoring blocker codes render
localized reasons in both Custom Agent and Hire Agent; an unknown code remains
blocked and receives a localized request to reload its current review. Source
names, instructions, user content, versions and permissions are not translated.

Local Custom Agent schema rejection now announces affected draft fields in the
selected language, focuses the error summary, associates affected controls via
`aria-invalid`/`aria-describedby`, and leaves the editable draft unfrozen. A rejected local
validation creates no request UUID or Native command. Hire validation uses its
localized review-fields instruction rather than showing a raw schema message.

Changing language preserves the mounted unsaved draft and does not send a save,
discard or other authoring command. The original current-session and Native
resource checks, frozen request UUIDs, bounded retries and unavailable promotion
controls remain enforced. The Custom Agent footer groups Save & exit, Back and
Discard on the left and Continue on the right, using existing design tokens.

Qualification covers the existing authoring/access-loss/replay tests, mounted
language changes without mutations, translated Native blockers while publication
stays disabled, strict UI types, locale validation and design-token gates. The
full combined repository checks and complete authoring test/promotion journey
remain outstanding; this slice does not establish V9 release acceptance.

## Scoped verification completed 2026-10-11

All 86 cases in the existing eleven authoring/account/locale/notification files,
strict UI types, design-token and coverage checks passed in
`v9-integrated-custom-locale-focused-v4`. Both actual built Custom/Hire account
browser cases passed in `v9-integrated-custom-locale-browser-v4`, retaining
same-account session/owner recheck, unsaved native fields, EN → DA → EN, zero
commands, narrow reflow and automated main-surface accessibility assertions.
Each supervisor matched its own Source capture before and after. The browser
rerun corrected only Hire's exact existing Danish label from `Agentnavn` to
`Agentens navn`; the qualified production Source was unchanged. Earlier failed
assembly and fixture logs remain retained. These checks are scoped and do not
assert full V9 Source completion, manual language/accessibility acceptance,
Native representative publication or final combined regression readiness.
