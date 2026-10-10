# Optional protocol presentation experiments

V9-048 maps an already admitted ExperienceModel to one AG-UI `CUSTOM` event named
`august_works.experience.snapshot.v9`. V9-049 maps one admitted ExperienceCard to
the A2UI v0.9 ordered `createSurface` / `updateComponents` pair, using the custom
catalog `blentera.com:aw-experience-v9-readonly` and one root `AWExperienceCard`.
That identifier is an opaque catalog name, not a deployed catalog endpoint.

Both experiments are offline, optional seams. The production application does
not mount a protocol host, stream, remote renderer or callback dispatcher. No
protocol SDK, provider credential, database owner, external transmission,
storage, execution or authorization is added. The experimental renderer uses the
actual ExperienceCard and its existing text and typed navigation links.

The decoder requires a separately read, currently authorized Native snapshot,
its company and, for A2UI, its expected surface. It validates the complete peer
DTO against that snapshot and returns the Native copy. Matching shape alone is
insufficient: changed text, evidence, scope, profile, versions, times or links
refuse the entire view. The caller remains responsible for reading current Native
state, invalidating old epochs and withdrawing private data on denied reads. The
helper cannot establish current authorization itself. Existing canonical owners
and Tool Gateway remain responsible for material actions.

Only `open` actions are admitted; any material operation refuses the whole
experiment. Unknown fields, protocol versions, events, catalogs, components,
extra/duplicate roots, surface changes, dynamic bindings, functions, event
handlers, raw events, metadata and prototype keys are refused. There is no model
HTML, CSS, arbitrary React or data-model update. Input must be JSON text, bounded
to 64 KiB in UTF-8; larger projections refuse without truncating cards or evidence.
Errors contain fixed copy without peer or Native content. This is a spike bound,
not a general product throughput target.

## Upstream conformance and provenance

The byte-preserved upstream schemas/licenses and SHA-256 provenance are in
[upstream/manifest.json](upstream/manifest.json). AG-UI spec 1.0 is pinned to
`2aabfc8cada0b429927e4c256c9cf990a6791e5f` (MIT). A2UI tag v0.9 is pinned to
`19919ef4c8ad3185867f70386fa4669284d7714c` (Apache-2.0). The retrieved A2UI README
describes an early public preview; this experiment does not assert that v0.9.1
is a verified production release or that a v1 candidate has been adopted.

The existing server AJV 2020 validator checks encoded messages against those
official schemas. A2UI's relative `catalog.json` reference resolves to the
experiment's explicit custom catalog, generated from the same strict Zod
component schema. Zod semantic refinements/current Native identity are checked
by the adapter, not inferred from structural JSON-schema conformance. Upstream
allows more event/component behavior than this deliberately restricted subset.

All 25 focused checks pass: 18 shared adversarial cases, three actual upstream
schema/provenance cases and four DOM renderer cases. They include old-source
withdrawal, effect refusal, UTF-8 bounds, fixed-error privacy, escaped text and no
network call. The shared package build also passes. Whole-workspace strict types, built Storybook/browser inspection and full regression
on the combined source remain pending. Software fixtures establish neither
Native execution nor customer acceptance. Full streaming, general A2UI
rendering, multi-channel parity, MCP Apps and production adoption remain open.
