# Make the connected-policy acceptance clock deterministic

The current general-server shard stopped at the connected remote MCP policy test:
the second call was allowed where the fixture expected a rate-limit denial.
The Original policy deliberately uses fixed 60-second buckets. Two real calls can
straddle a minute and legitimately consume different buckets; the fixture assumed
that sequential calls necessarily share a bucket. The failure happened at the
run's minute boundary. Do not lengthen or weaken the production policy.

Only the rate-limit subsection now uses a Date-only controlled clock at the final
millisecond of its minute. Keep networking, retries and timeout timers real, retain
the original second-call 429 assertion and add admission after advancing Date one
millisecond into the next fixed bucket. Restore the real Date in finally before
other checks. Every existing policy, approval, retry, privacy and company-boundary
assertion remains. All 73 Tool Gateway cases pass. Retain the first failed general
run; remaining cases were not passed by that failed run. Renew the entire general
partition on the corrected fixture, with separate logs and source identity.

The checkpoint also corrects the earlier migration-count wording: migration 0500
is present, while this repository has 499 SQL migration files/journal entries.
This is documentation/test-only; production source is identical to checkpoint83.
Other ongoing checkpoint83 jobs remain frozen and independent. No PR/push, provider
send or release qualification is performed. R0 and all 70 release gaps remain.
