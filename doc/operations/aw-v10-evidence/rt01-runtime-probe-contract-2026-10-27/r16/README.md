# RT01/C0 attempt r16

This was a fresh current-source snapshot and Runner TS/catalog emit (both exit 0), followed by the five-test managed OpenCode C0 integration file. The suite executed all five tests and failed all five before the provider boundary because the test harness did not export `PAPERCLIP_API_URL`; heartbeat requires the configured API origin to deliver managed runtime MCP servers. The signed-host case separately recorded an authenticated relay, 11 successful heartbeats, and a live provider-attested lease, but no provider call occurred. This attempt is diagnostic and does not qualify C0.

The source snapshot is `source-pins.json`; the exact failure is retained in `c0-full5-test.log`. The original helper has since been corrected to serve the actual MCP gateway protocol on its local TLS listener and set the API origin to that listener for the run. A rerun must qualify that fix; r16 itself remains a failed attempt.
