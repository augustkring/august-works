# Conversation reservation Run-owned purge attempt R12

The actual-frame known-cost purge test executed with passing snapshot/syntax gates. It still failed with SQLSTATE 23514 and `aw_v5_execution_manifest_immutable`, despite company-purge excluding `agent_execution_manifests` from generic direct deletion and relying on the existing Run foreign-key cascade.

The Stop evidence remains valid: Native run succeeded, PID/group and both legacy controller fields were absent, finalization was committed/unleased, and a real local Stop receipt existed. The PostgreSQL cascade fires while the immutable manifest trigger can still see the parent Run, so a narrowly authorized forward-only trigger exception is needed for the same canonical company-purge transaction after `aw_execution_manifest_payload_erased` proves the original source owner was erased. No financial/offboarding acceptance is claimed.
