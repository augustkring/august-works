# Operator-owned announcement publications

The instance fetches a feed only when announcements are explicitly enabled and an HTTPS feed URL is configured. `schemaVersion: 1` contains a nullable `announcement` and up to 32 `history` entries. The publisher and shared announcement schema remain the publication authority. This file does not publish a release or change instance configuration.

For customer release notes, set `kind: "release"`, `publishedAt` and a `releaseNote` object:

- `releaseId`: stable release identifier, 1–64 ASCII letters, digits, periods, underscores or hyphens; begin with a letter or digit.
- `locale`: `en` or `da`. Use a different announcement ID for each translation of the same release. Each release/locale pair must be unique in the manifest.
- `changes`: 1–12 customer-relevant changes, up to 600 characters each. Do not substitute a raw commit list.
- `affectedAudience`: who benefits or is affected, up to 600 characters.
- `actionRequired`: boolean; `requiredAction` must be a nonempty instruction when true, and `null` otherwise.
- `documentation`: 1–8 HTTPS links with `label` and `url`.
- `rollback`: applicable rollback guidance, or `null` when no guidance is provided.
- `knownLimitations`: up to 12 stated limitations; an empty array is displayed as no limitations stated in this note, not a claim that none exist.

Existing title, description and primary action fields remain required by the announcement contract. All shared bounds, HTTPS validation and fetch controls apply. Company- or deployment-profile-scoped notices are excluded from the customer changelog; mandatory actions continue through their canonical owner.

Help reads `GET /api/announcements/releases?locale=en|da` with board authentication and `private, no-store`. Personal news dismissals do not hide release history. Expired news cards remain eligible as historical release notes; future or incompatible releases are excluded. The preferred translation is selected, with an explicitly labeled fallback when only the other language is published.

History is a bounded configured publication window, not a complete archive. Legacy release entries without complete customer metadata produce `incomplete` coverage. An unconfigured destination and a failed fetch produce distinct empty states. The operator must maintain and review actual release facts and documentation before publishing; the application does not synthesize release history or post it externally.
