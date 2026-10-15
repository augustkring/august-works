# V9 agent monitor session continuity — 2026-10-11

Status: implemented; focused/strict UI and original built Native browser passed.

The agent monitor now uses the existing private-read/session fence around the
original Native metadata reader. Cached private names and run links are hidden
while the original session is unresolved. A same-turn session fetch prevents a
new metadata transport, and a changed session ID for the same person rejects an
old response. A fresh session must be followed by a fresh Native owner read.

The original local-board path remains admitted only through its actual complete
local-implicit session, and the Native route still owns membership/resource
permissions. Retry consults the original session owner when identity is
unresolved. The existing polling/source-event refresh, bounded six-run history,
focus restoration and distinction between run success and verified business
results remain in place. No lifecycle operation or run is created here.

Qualification covers original monitor tests, session pending/same-turn/late old
response cases, strict UI types, token/coverage gates and the original built
Native monitor browser including pause/current local-board admission. Source
checks do not qualify live provider execution or manual accessibility acceptance.

## Scoped verification completed 2026-10-11

`v9-agent-monitor-session-focused-v3` passed the original monitor/API/session
files, strict UI types and token/coverage gates. The original built Native
monitor browser passed in `v9-agent-monitor-session-browser-v3`, including
actual disposable company/agent, original pause, current local-board metadata,
no work, narrow reflow and automated accessibility. Each supervisor matched its
own current public Source capture before and after. No current-session or Native
permission owner was mocked to qualify this browser. Controlled focused session
fixtures remain separate software evidence. The final combined V9 types/tests/
build, manual accessibility and remaining product journeys are still pending.
