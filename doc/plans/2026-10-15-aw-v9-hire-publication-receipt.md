# Preserve the Original publication receipt across Hire navigation

The current built-host repeat passed six Agent cases and failed the Danish Hire
publication case. After one explicit Original receipt check, the application
navigated from hire_review to hire_receipt, unmounted its publication component
and reloaded the same saved command as unknown. A brief old-view receipt could
make the former assertion timing dependent; the final receipt view asked for
another check. This failure is retained with its browser artifacts.

A routed, deterministic parent/component regression reproduces the final state:
Original publication was recovered, but the receipt page again displayed Check
original publication. Keep one keyed AgentDraftPublication instance in a shared
position across these two steps. Receipt-only mode still reads the exact Original
receipt through current authority and hides it while that read is unresolved.
Do not change stored command identity, Native authorization, version/hash fences,
the two publication confirmations or transport replay behavior.

Clarify English/Danish draft-boundary copy so a saved draft is not mistaken for
an activation, while a confirmed publication is not called unpublished. This
follows the writing references' truthful-state requirement.

The pre-fix regression fails; after the continuity fix the final three focused Hire/publication/locale suites
pass all 29 cases. UI typecheck, token gates, source inventory and both changed
strict Hire contracts pass. A built browser repeat must finish before current-
artifact browser verification is claimed. This
is software evidence only; live provider, manual and Human qualification stay open.
