# Existing company automation components in Hire packages

Hire preparation can resolve required workflow and routine components to their
exact current local versions. Workflows must be active and published; routines
must be active and retain their latest immutable revision. Missing, paused or
ambiguous local matches block preparation. Workflow source access is checked
through its existing revision owner, including a workflow targeted by a routine.

The existing package installation owner retains the reviewed component pins.
The setup does not create automations, change owners, assign a routine to the
new Agent, change schedules, grant access, or start work. The preparation
confirmation discloses those boundaries in English and Danish.

## Qualified implementation checkpoint

Runtime Source `0e30e6997156920dcdaa56a4cd9509cefb04772e`, SHA-256
`ce32a3965818e8e0489b65ee716cdaaf44093fa3f76440831ad005430b39ac8c`,
passed 360 actual PostgreSQL/Native cases in 15 files. These include the complete
Hire test/setup/publication path with actual workflow and routine pins, local
and other-company equivalent graphs, paused sources, ambiguous local matches,
and unchanged workflow/routine run inventories. Original workflow and routine
service regressions passed with their existing assertions.

Focused checks passed 60 cases in eight files. The current shared/DB builds,
server/UI types and 11 built-browser cases in five suites passed. The browser
review shows exact component names/revisions and the existing-owner/schedule
boundary before confirmation. Source identity stayed unchanged during each
qualification check.

The first Native run stopped before test execution because its checkout was
not mounted into the test container. The corrected run uses the same Source,
actual migrated PostgreSQL and Native artifact sandbox as UID 1004, with network
disabled. No production guard or test assertion was relaxed.

This is component-reference mapping for existing company automations.
Automation creation, execution authority, runtime provisioning, broader Agent
behavior and the remaining V9 implementation and release work remain open.
