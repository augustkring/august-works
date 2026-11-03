# Governed Hermes presence profile

The required platform Skill lane uses the local Hermes CLI on a trusted host,
an isolated company/presence home, and the canonical `paperclip-assigned` MCP
gateway. It does not make local Hermes Memory canonical Blentera Memory or
claim an OS sandbox, managed provider budget, or qualified runtime boundary.

The implementation contract is NousResearch/hermes-agent revision
`a382af23f4c067d23463b5781958684c2cda82bc`:

- `hermes_cli/main.py::_apply_profile_override` honors an explicit home without
  global sticky-profile redirection when its immediate parent is `profiles`.
- `hermes_cli/managed_scope.py` reads `HERMES_MANAGED_DIR/config.yaml` and
  expands its `${VAR}` references from the process environment.
- `hermes_cli/config.py::get_config_value` supports
  `hermes config get <key> --json --raw` for the effective configuration.
- `hermes_cli/mcp_startup.py` filters MCP discovery by explicit `-t` names.
  Its early probe reads raw user configuration, so the dedicated profile also
  contains the same nonsecret gateway declaration.
- `agent/skill_utils.py` defines project, local, creation and external Skill
  precedence. This profile selects the reconciled local inventory, disables
  project/external discovery, and rejects unknown local installations, including
  directories declaring the reserved name under another directory name.

The server verifies the immutable platform package before reconciliation. The
adapter supplies only native progressive `skills` tools plus `blentera_run_0`,
which refers to the current server-owned assigned gateway. Per-invocation
managed policy files contain environment references, never the run bearer.
Before model dispatch, the installed CLI must return the exact effective MCP
identity and discovery policy. Probe output is deliberately excluded from
customer and model logs because `--raw` includes the in-memory bearer. Cleanup
removes only that invocation's generated managed policy directory.

The presence's `config.yaml` uses JSON-compatible YAML. Existing foreign YAML,
extra MCP definitions, redirected files, disabled required Skills, extra argv,
and broader toolset settings fail closed for review. Provider settings already
present in a compatible dedicated profile are retained; global/operator files
are not migrated or overwritten. Credentials belong in the scoped presence
environment. Shared trusted profiles and legacy auxiliary gateways require
separate delivery/conformance support; this lane does not silently qualify them.

Session serialization retains the validated presence hash. An older session
without that hash needs a newly admitted session; it cannot resume into another
presence. Result metadata records package identity, profile/policy hashes and
any server-supplied capability snapshot. Delivery remains explicitly
`requires_runtime_conformance` until the supported installed CLI/provider
profile passes the shared canonical journey and negative/revocation cases.
Adapter unit tests are structural/transport evidence, not live vendor or
paid-model qualification.
