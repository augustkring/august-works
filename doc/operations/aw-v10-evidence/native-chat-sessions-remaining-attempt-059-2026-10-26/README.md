# Authenticated Native chat session cases 5–7 attempt 059

Fresh pinned-source Playwright run of three focused cases using system Chromium: owner recovery after source visibility loss, feature-flag send/reset controls, and Stop followed by queued `/new`. Tests were listed before launch, the same-snapshot native failure-log privacy regression passed, and all assertions/timeouts were retained.

All three tests failed. Owner recovery timed out on its first idle check with the task `blocked` despite one agent reply and no live run, before source setup. The feature-flag case timed out on its initial idle check with the task `blocked`, no reply, and no live run. Stop/queued `/new` reached a first reply but did not complete the fresh-session predicate; the task ended `blocked` with one reply and no live run. The provider trace contains no tool payload text.

The run exited 1. Numeric exit, full log, source pins, and browser artifacts are retained here. These outcomes are diagnostic failures, not a pass.
