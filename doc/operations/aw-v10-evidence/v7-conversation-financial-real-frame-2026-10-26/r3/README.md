# Conversation-model financial owner run, attempt R3

The fresh pinned snapshot and syntax checks passed; all six actual route-backed conversation financial tests executed. Four passed: current Human/generation denial, exact-budget boundary, 64th/65th call boundary, and receipt-preemption rollback followed by single settlement.

Two tests reached canonical company offboarding and were rejected by the existing `IDENTITY_REHOME_REQUIRED` precondition because the real `seedV5Presences` fixture includes an active Guest presence for the Agent identity. This is a valid offboarding guard, not a product failure. The fixture setup is being corrected to use the canonical `agentIdentityService.rehome` with the actual session actor and DB-confirmed memberships before testing purge behavior. No purge or financial aggregation assertion passed in this attempt; it does not establish end-to-end acceptance for the known-cost purge or unknown-hold purge case.
