# RT01 C0 runtime heartbeat follow-up (r9)

The run used a fresh source snapshot (`sourceHead` `d41c6dabddbf43928d7782ce08720bde76d4e880`), syntax validation, Runner TypeScript emit, and semantic catalog check. All four gates exited 0.

The full five-case managed Native conversation integration suite executed and exited 1: 0 passed, 5 failed, duration 253.60 seconds. The first case logged a sanitized SQLSTATE `40P01` deadlock and then failed with `native_session_cancelled`. The signed-host relay case had a lease expiry of `2026-10-27T03:26:00.560Z`, 277 host heartbeats, and no recorded host-heartbeat failure; it failed during a `runtime_hosts` `FOR SHARE` read. The remaining cases ended with `native_session_interrupted` / `native_session_cancelled`. See `c0-full5-test.log` for the raw bounded test output.

The OpenShell host-agent unit suite executed separately and passed 23/23. This validates the host-side code paths and tests; it does not establish physical OpenShell host qualification.

The observed deadlock has a plausible lock-order inversion: `assertTaskExecutionContext` locks a runtime cell before its host, while the runtime heartbeat handler locks its host before its cells. Do not treat r9 as a passing C0 qualification.
