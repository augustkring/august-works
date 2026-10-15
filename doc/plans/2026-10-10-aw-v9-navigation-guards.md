# V9 canonical card navigation guard

2026-10-10. Supporting source change for the existing V9 Action Card and optional
protocol/Tool UI validation boundary. This record does not accept a launch surface
or assert production/hosted completion.

The existing root-relative action URL pattern rejected double leading slashes,
backslashes and CR/LF, but accepted literal tabs. The standard browser URL parser
removes tabs before URL interpretation: `/\t/attacker.example` changes origin even
though the unnormalized string starts with one slash. Existing Native projections
construct fixed, encoded resource links; this is defensive schema hardening,
not evidence of an exploited or currently reachable Native owner vulnerability.

The existing action schema now rejects all ASCII controls, raw spaces, DEL and
backslashes while retaining its root-relative and single-leading-slash rules.
Normal Native resource paths and properly encoded query text remain accepted.
No authority, route, external request, writer, dependency or persistence is added.
All clients and optional adapters consuming the original schema share the guard.

Four focused files pass 52 cases: actual browser-standard URL-origin negatives,
existing experience contracts, optional protocol negatives and typed Tool UI
references. No Native gate, schema strictness or assertion was relaxed. Shared
strict types and build pass. Current integration remains pending. The separately frozen
current project/Tool wave must finish before applying this additional schema
change; its evidence cannot qualify changed source automatically.

Broader V9 source, live/human/channel and release qualification remain open. R0,
sourceComplete and all 70 launch acceptance rows remain pending.
