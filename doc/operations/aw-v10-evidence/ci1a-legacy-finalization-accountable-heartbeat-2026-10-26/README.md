# Legacy heartbeat finalization regression

The final current-source run (`r5`) passed the focused standalone on-demand legacy heartbeat case. It confirms real legacy adapter execution, byte-stable public run reads, and zero native finalization/result/assessment/status-decision rows. `r1` and `r2` preserve the earlier issue-linked Task fixture failures; `r3` records a zero-test invocation caused by using a repository-root path from the runner's `server/` working directory; `r4` ran the generic heartbeat through completion but its final assertion hit a removed `eq` test import. Only `r5` is the passing qualification result.

Every run contains the source snapshot pins, raw compressed Vitest log, selected command, and exit status where available. No test or product deadline was changed.
