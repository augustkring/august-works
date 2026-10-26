# Project foreign workspace source check, attempt 1

The fresh locked snapshot and syntax preflight both exited 0. The focused PG test executed, but the valid private Project setup was denied because the Human-created fixture omitted the agent `projectAccessMember` that the original agent-created private Project route adds. No assertion about foreign workspace validation passed in this attempt. The fixture now uses the existing `ensureProjectAccessMember` owner helper and will be rerun against a fresh snapshot.
