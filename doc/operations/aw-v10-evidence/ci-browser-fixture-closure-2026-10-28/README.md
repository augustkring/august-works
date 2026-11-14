# Current account browser fixture closure

The existing account-security (two cases), first-task and retained process-finding browser tests passed **4/4** together on the r5 source snapshot, with the actual built UI, API and disposable PostgreSQL. There were no server500/error records in that run. This is scoped software verification, not external identity/provider/Human qualification or final whole-head acceptance.

The fixes retain the existing safety assertions. Account password locators now select the deletion region, distinguishing its password from the authenticator password. Existing account-locale isolation restores the shared account preference after each fixture, including the EN/DA focus test that previously left Danish selected. First-task cleanup preserves an earlier failure rather than replacing it with a closed-context error. Process evidence is created with the real current session and current company owner, so the browser can read it; hidden Source evidence is still refused after access changes. No production privacy guard was relaxed.

The r4 attempt remains here: three tests passed, the process fixture failed, and that mixed snapshot caught schema mode fields before their0559 migration had been generated. The later r5 includes the coherent mode migration and passes all four. Exact snapshots and raw logs/exits are retained separately.
