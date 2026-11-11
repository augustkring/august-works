# CI81 read-only failure triage

Run: `43026860631` (head `418927deb40016024ef56c2473761933be6770a9`). Logs fetched with GitHub decoded job-log MCP for the four completed failed jobs. Main repo was not modified.

| Job | Test(s) and observed failure | Triage |
|---|---|---|
| `130552022855` | `native-opencode-managed-progress-conversation.integration.test.ts`: all 5 tests fail. Lines 98 and 235 see `{runStatus:"failed", providerCallCount:0}`; line 356 sees 0 provider calls instead of 1; line 376 Ask catalog exclusion expectation is false; line 413 Human-resolved question marker expectation is false. Sanitized diagnostics report `adapter_failed`, stage `preparing`, Native phase `committed`; provider stub/hook failures are null. | Actual managed Native conversation never reaches provider. This is a source/admission/managed-tool failure, not an assertion-only mismatch. Logs conceal the underlying runner message, so precise guard remains unproven. Note the job's actual failed file differs from the initial shorthand label “chat dispatch boundaries.” |
| `130552022975` | `heartbeat-managed-native-interaction-retry.integration.test.ts`: both bounded-retry and permanent-setup-failure scenarios fail at line 140 because their Native predecessor is `failed`, expected `succeeded` with yielded result. | Fixture fails at predecessor finalization before testing the retry/escalation branch. Not evidence about those downstream oracles yet. |
| `130552023084` | `native-opencode-managed-session-resumption.integration.test.ts`: all three `unchanged`, `newer_active`, and `stale_idle` cases time out at line 54 in `waitForValue`, with `managed_opencode_checkpoint_deadline_exhausted`. | The checkpoint-capture promise never resolves; recovery and accepted-wake assertions are not reached. The timeout is consistent across variants, suggesting an earlier managed OpenCode request/response path stall. |
| `130552023333` | `native-opencode-managed-browser-governed-handoffs.integration.test.ts`: all three browser scenarios time out after 30s waiting for `[contenteditable],textarea` inside the last `task-chat-composer-input` locator (fixture line 385). | Browser scenario setup does not render/find the chat composer; scenario/product assertions are not reached. Need page-level route/render diagnostics before attributing to a product guard. |

All four jobs had dependency/setup steps succeed and failed only in “Run grouped general test suites.” The job-log excerpts contained no unredacted underlying Native runner error for the zero-provider-call failures.

## Bounded structured diagnostics

These are whitelisted fields extracted from decoded logs; prompt, provider payload, raw error, and environment values are omitted.

- `130552022855`: Native diagnostic was `{run:{errorCode:"adapter_failed",executionStage:"preparing",nativePhase:"committed"}, runnerFailures:[{seq:51,payloadKeys:["error","prpSourceInstanceId","prpSourceSeq","status"]},{seq:49,payloadKeys:["prpEvent"]}]}`. The provider-facing run had completed runner startup/bootstrap, process launch, artifact prepare/verify/discover and transport setup; terminal event tail was `run.terminal`, `run.result.accepted`, `turn.failed`, `run.performance.span`, `turn.failed`. Thus logs show failure after process startup during a preparing-stage turn, but do not disclose the error.
- `130552022975`: The managed Native diagnostic stream shows run terminal/result accepted after turn failure; host action ended `settled` with workSettled true. The latest runner progress includes four failed `runner.runtime.stage` spans (59, 19, 19, and 21 ms) despite successful runner session startup/bootstrap and transport/artifact preparation. Assertion then sees the initial predecessor as failed, not succeeded/yielded. No underlying error text is exposed.
- `130552023084`: failure is the explicit checkpoint deadline (`managed_opencode_checkpoint_deadline_exhausted`) from the fixture's `Promise.race`; no checkpoint value reached the callback.
- `130552023333`: failure is Playwright's 30s locator timeout for the chat composer; no browser-level page error or route response diagnostic was emitted in the failure excerpt.

## Progress diagnostic availability

Downloaded the failed Vitest artifacts through GitHub MCP (`130552022855` → artifact `13862530822`, 3,512 bytes; `130552022975` → artifact `13860423848`, 3,281 bytes). The Vitest assertion JSON repeats only the first assertion’s safe failure facts: `runStatus=failed`, `providerCallCount=0`, `providerStubFailure=null`, and `providerHookFailure=null`. It contains no richer frame result, broker facts, or Native error payload.

The job log additionally emits, for affected progress runs:

- software-host admission projection: `unsupportedFeatures=[]`, `modelEndpointPresent=true`, `modelBinaryCount=1`, `appEndpointCount=0`;
- backend apply: `applied=true`, `requiresRecreate=false`, `observedPolicyHashMatches=true`, `unsupportedFeatures=[]`;
- workspace finalization: `phase=committed`, safe failure category `other`, operation `succeeded` with no message/errno/exit code;
- Native terminal summary: `adapter_failed`, execution stage `preparing`, phase `committed`, and sanitized `turn.failed` payload key lists.

No emitted CI JSON/log contains `brokerRequestFacts`, broker status/code/service frames, `providerWireBodyBytes`/maximum, or `providerHookInvoked`; these values stay in the helper's in-memory return object and the failed test's assertion serializes only the four facts above. `providerWireBodyBytes` cannot be inferred as empty from `providerCallCount=0`, since the helper records body bytes before it validates authenticated provider context and increments the call count. The `turn.failed` payload keys include `error`, but `boundedRunnerFailureDiagnostic` only extracts top-level/nested code fields and `message` strings; emitted values are null, with `messageSha256=null`. The `error` value itself is not inspected or serialized, and the uploaded artifact does not preserve it. Therefore this CI run cannot safely distinguish the underlying broker/PRP error category beyond the recorded Native lifecycle fields.
