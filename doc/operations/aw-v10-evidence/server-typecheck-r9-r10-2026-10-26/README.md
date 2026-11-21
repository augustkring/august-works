# Server typecheck attempts r9/r10

Both attempts failed on nullable AuthorizationActor fields spread into the new conversation frame fixture Express actor. R9 reported userId; r10 reported agentId after the first correction. These are retained failure evidence, not compiler qualification. The fixture owner is replacing the broad spread with an exact typed session actor before another check.
