# Identified authored instruction definitions

The next V9 publication step uses the Original Agent configuration revision
owner. A reserved, strict authored-definition value carries its exact revision
identity, candidate hash and definition hash. The Original instruction service
and Native run asset materializer resolve that company's exact Agent revision,
check all bytes, and expose a read-only virtual entry file. They never substitute
a mutable host instruction file, an uncommitted draft or another Agent's revision.
Historical snapshots continue to resolve their identified version.

Generic Agent create/update and instruction writes cannot install, remove or
mutate an authored definition. Direct permission changes are also blocked. A
trusted internal publication path supplies the revision identity to the existing
revision writer; this is not a new version table or outcome registry. Credential
redaction remains enforced: content that would be changed by the Original
snapshot redactor is rejected before writing rather than silently changed.
The exact public schema discriminator has a closed redaction allowlist entry;
that same value remains redacted in arbitrary provider fields.

The first compiler accepts only explicitly automatic internal drafting with no
selected knowledge, persistent memory, delegation or external capabilities.
Other choices require their actual native mappings. This instruction bridge does
not itself grant any capability, wake or activate an Agent, or enable publication.
Full publication still needs the C3 admission, current test evidence, live runtime
policy/context boundaries, immutable database guards, audit/replay receipts and
privacy copy propagation. The existing Publish button remains blocked.

Qualification at source `963816487166f0eb3e83e12843b193d376aa714e` passed:

- 75 focused tests in five files, including Original instruction routes/services
  and closed schema-discriminator redaction, plus the token gate.
- 28 Native tests across the six new revision/asset cases, the legacy migration
  case and 21 representative-test cases; all 604 existing regression tests also
  passed. Total: 632 tests in 15 files, with actual PostgreSQL and the restricted
  Native sandbox and no skipped cases.
- Fresh shared/database builds and both server and UI typechecks.

Native and typecheck source snapshots were unchanged before and after execution:
`b3547b11f5756b6d70b5e06fb56e2f56f8d6ade3a0767d74f756bc8d60a70b18`.
The first Native attempt passed 23 cases and failed four because the reserved
field name matched the Original authentication-field redactor. The fix changed
the field name and checks the entire containing configuration before persistence.
Assertions and time limits were retained. A later source review found that the
Native materializer must receive the saved Agent configuration independently of
the adapter's effective execution configuration; a sixth real asset case now
checks that boundary. The subsequent full Native and type checks passed.

These bounded checks exercise the Original database revision writer, instruction
owner and actual content-addressed Native run assets. They do not enable
publication/activation or qualify the full integrated branch, live providers or
GA release evidence. Runtime source policy is being implemented separately.
