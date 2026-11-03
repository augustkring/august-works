# GitHub repository access reconciliation

The existing GitHub owner records a completed repository-access snapshot only after bounded full pagination and an unchanged current grant, connection, identity, scope and progress pin. Partial refresh keeps the previous snapshot and marks it required. Feed cursors, content watermarks and provider gap detection remain unreported. No additional collection or migration is introduced.

Controlled checks: 15 lifecycle cases, 6 selected owner cases, and 2 selected event cases passed. Exact unselected counts, source reconstructions and raw logs are in manifest.json and qualification.tar.gz. These checks do not qualify live GitHub or the complete V10 branch.
