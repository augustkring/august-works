# Private HTTP purpose for saved conversation proposals

The new conversation authoring route is now classified by the existing private
experience log policy. The logger records its fixed route pattern, not actual
company/conversation/principal references, and omits parser/SDK body copies,
params, error prose and private response headers. This applies to successful
reads and rejected methods, including malformed namespace components; adjacent
non-authoring namespaces keep their original classification.

## Verification

The existing policy, private HTTP canary and general log-redaction suites passed
123 cases. The added GET/POST/malformed-route canaries exercise the actual Pino
HTTP logger with request bodies, failure messages, params and response-header
canaries; none survive. The account query is also absent. Actual private logs
retain only the templated route and fixed private failure text. Diff checks pass.
No first-party telemetry or run-log data path was changed.

The current full default runner completed 1,042 chat-channel cases on parent
`29d7e74bfaa1c14a2b8d0d0a91f44c5f938e9308`, then paused between phases for this
concrete privacy correction. It is partial parent evidence, not full current
qualification. Full V9 completion remains pending. References: supplied privacy,
security, backend and verification playbooks.
