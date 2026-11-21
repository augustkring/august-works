# Project repository retry claim

An admitted retry previously remained attached to an Agent in `error` until adapter dispatch. Startup source reads correctly rejected that stale principal state, so repository preparation never resumed. The common claim owner now clears the prior failure only for an error-state Agent with that exact running Run. Paused and terminated Agents remain excluded, and the final adapter dispatch still checks invokability atomically.

The complete 13-case repository provisioning suite passes, including temporary scan failures, durable restart, exhausted retries, pause, permanent/cancelled failures and preservation of dirty local work. The retry fixture creates its literal Human Task through the original service with a current authenticated session. The archive contains exact source pins, the reconstruction patch and raw test output. This is scoped verification, not final release qualification.
