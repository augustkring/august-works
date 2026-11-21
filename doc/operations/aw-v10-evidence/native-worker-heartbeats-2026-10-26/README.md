# Native draft heartbeat source closure

The Native draft path revalidates the captured Task at the backend boundary against a current issue row locked `FOR SHARE`. It accepts only the canonical current owner body hash or the existing legacy projection hash, requires the server-built Task projection to equal the current issue projection, and checks the source-closure envelope digest against the canonical execution Task digest. This closes the later text-backend comparison that previously compared a canonical owner hash with a separately JSON-stringified tool projection.

Focused proof: both real-heartbeat cases passed, including one successful draft publication and the human-Pause case with one call and no document publication. The complete 66-case `v7-worker-model-gateway.integration.test.ts` file passed on a fresh source snapshot. Exact source pins, parser results, exits, and test logs are included. The focused log was run with temporary boolean diagnostics to identify the closure boundary; those diagnostics were removed before the full-file run.

This is software integration evidence only; no live provider, deployment, or customer qualification is claimed. See `receipt.json` for source pins, commands, numeric results, and limitations.
