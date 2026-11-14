# Actual conversation usage and canonical purge R24

The pinned-binary, source snapshot, and syntax preflights passed. Vitest executed one real-frame test and confirmed a completed Native conversation reservation, a cheaper usage-priced settlement, one cost event, and idempotent duplicate-settlement rejection before purge. Canonical company purge then completed and removed the payload cost event as expected. The final assertion found that the content-free native conversation funding aggregate was missing from the completed offboarding receipt.

The cause was a return/merge omission: `purgeCompanyContent` wrote the aggregate into the operation row but omitted it from its return DTO; `offboarding.ts` then reconstructed completion evidence from the earlier operation object and dropped it. Both original owner paths now retain the aggregate. This run is diagnostic evidence for the real path only; aggregate preservation must be reverified by R25.

Numeric exit: 1. The raw test log, source pins, qualified binary identity, and preflight logs are preserved here.
