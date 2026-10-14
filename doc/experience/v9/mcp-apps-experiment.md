# MCP Apps stable-spec review and anonymous C0 host experiment

Status: bounded local prototype; not AW customer hosting or release acceptance.
Backlog V9-050/051/053 are in progress. V9-052 Native Tool Gateway integration
remains unimplemented. `mcp_apps_v9` remains off by default; the product does not
mount this experiment or expose a new third-party capability.

The experiment implements part of the web-host lifecycle and exercises a real
separate-origin proxy/iframe boundary with synthetic content. It deliberately
advertises empty host capabilities and rejects every tool/resource/link/message
operation. An iframe, resource hash or bridge message grants no AW authority.

## Primary evidence and interpretation

The official stable [2026-01-26 specification](https://github.com/modelcontextprotocol/ext-apps/blob/82221c0c8ce7661efa6771c9d461511b1650495f/specification/2026-01-26/apps.mdx)
was inspected at upstream commit `82221c0c8ce7661efa6771c9d461511b1650495f`
(commit date 2026-09-25; repository release bump 2.0.3). The stable source file
SHA-256 is `ee452a7d1b9b7fb900acfeb4d6932d3963375b0f3f37d196a4b93eb80312af0e`.
The draft file was not substituted for the stable contract.

The upstream LICENSE at this commit states an MIT-to-Apache-2.0 transition;
new specification contributions use Apache-2.0 and non-spec documentation uses
CC-BY-4.0. Remaining original contributions may retain MIT. Its file SHA-256 is
`0382b0057770ca05e9c350a50aa3b1c1fea84da0bc81d723bf00b9aa841be58a`.
No upstream source, SDK or runtime dependency is vendored/installed by this slice.
The reviewed source is outside the repository; the links/hashes identify evidence.

The supplied SWE-06 sections 12.4, 13.4 and 13.8 are applied: a boundary drawing
is insufficient; threats need mechanisms, controls and falsifiable verification.
This is a scoped interpretation and executable experiment, not an attestation
that all stable MUST/SHOULD clauses or production threat-model gates are complete.

## Scoped contract and evidence

| Stable requirement | Experiment behavior | Remaining production work |
| --- | --- | --- |
| UI resource scheme and MIME, lines 267–270 | Exact `ui://` identity, connection/revision, `text/html;profile=mcp-app`, bounded HTML5 fixture | Actual authorized MCP resource discovery/read and resource review |
| Integrity review, security implications | Expected resource SHA-256 checked against exact text bytes before mounting | Approved resource/version inventory, revocation and incident evidence |
| Web sandbox proxy, lines 470–488 | Host `127.0.0.1`, separate proxy `127.0.0.2`, nested iframe, restricted sandbox | Dedicated production origin/domain, deployment/CSP verification and review |
| Sandbox permissions | `allow-scripts allow-same-origin`; sensitive Permissions Policy denied; credentialless support required | Supported browser matrix and any explicitly reviewed sensitive capability |
| Restrictive CSP | No network/media/font/frame/object/base/form access in View; proxy cannot connect externally | Reviewed per-connection declarations and controlled allowed-domain policy |
| Message validation and audit | Bounded JSON-RPC, source/window/origin checks, prototype/malformed rejection; fixed audit codes/method allowlist | Native purpose-bound audit, abuse/rate/retention policy and incident correlation |
| Initialization and data order | Proxy-ready → resource-ready → initialize response → initialized → tool-input → tool-result | Actual SDK interoperability and current Native tool results |
| Cleanup | Graceful teardown response, 150ms forced close fallback, focus returns to host Open control | Browser/AT/host recovery matrix and lifecycle callback qualification |
| Tool visibility and ordinary MCP calls | No `serverTools`/`serverResources`/openLinks advertised; all calls refused | Same-connection app visibility plus actual Native Tool Gateway admission |
| Accessibility and containment | Synthetic mobile overflow, main/View automated WCAG smoke, usable host close/reopen | Keyboard/AT/manual/usability and resource-exhaustion qualification |

Metadata equality alone never proves content integrity; the browser hashes the
exact HTML independently. CSP is constructed by host/proxy, not accepted as an
app grant. The proxy sets a restrictive HTTP policy and inserts an additional
View policy. Declared external domains/permissions are unsupported in this C0
resource schema and cannot silently broaden the policy.

## Threats and controls

| Threat mechanism and harm | Control in this experiment | Actual falsification |
| --- | --- | --- |
| A View reads host DOM/cookies and exposes private state | Separate loopback IP origins, credentialless iframe, denied capabilities/CSP | Host canary cookie absent; top DOM access throws |
| A compromised resource substitutes active HTML under old metadata | Exact connection/revision/URI/MIME and independently verified hash | Changed HTML with old hash refuses mounting |
| A different window forges initialization or a late read restores a closed panel | Current frame/window/origin and mount generation | Wrong window cannot initialize; delayed earlier read cannot attach |
| A View requests another connection's tool or tries pre-initialization execution | No tool capability; bounded fixed refusal for every request | Early and post-initialization tool calls refuse; zero business/non-GET requests |
| A View exfiltrates through network or host navigation | `connect-src 'none'`, sandbox without top navigation/popups/downloads | Undeclared fetch blocked; host URL unchanged; forbidden endpoint untouched |
| A View floods bridge work or never finishes cleanup | Forty-message mount budget, bounded payloads, forced teardown | Flood removes iframe; clean independent reopen succeeds |
| RPC method/prose contaminates host logs | Fixed audit code/method allowlist; no params/results/HTML retained | Private method/argument canaries absent from audit |
| Untrusted UI presents invented authority | Trusted host label and no Native connection/capability | Synthetic result explicitly says no business result; no authority receipt |

Untrusted HTML can still mislead users and consume rendering CPU/memory. A web
iframe and message count do not prove process/resource containment. Same-origin
View/proxy access does not give the View the different host origin; however, a
production proxy must be treated as an untrusted isolated security domain. This
experiment does not qualify arbitrary remote HTML, authenticated cookies, public
hosting, permissions, tool forwarding, a real Human or business result.

## Running and validation

From the repository after the normal frozen workspace install:

```sh
pnpm poc:aw-v9-mcp-apps
# Prints a temporary host URL; both listeners bind only their loopback IPs.

PAPERCLIP_PLAYWRIGHT_EXECUTABLE=/usr/bin/chromium pnpm test:aw-v9-mcp-apps-poc
# Omit the override to use Playwright's installed Chromium.
```

The browser tests also use the existing runner workspace's declared axe-core dev
dependency. No new package or lockfile change is needed. The C0 container check
uses headless Chromium with `--no-sandbox`; browser origin/CSP enforcement is
exercised, but Chromium OS sandbox containment is not qualified by that run.
There are five policy and four actual-browser cases. Incoming cloned data is
bounded before serialization; accessor/exotic/deep/oversized values are refused. They test synthetic
software behavior, not representative usability or production acceptance.

A first root screenshot omitted iframe paint while DOM interaction checks
passed. Separate View capture and a subsequent composed capture were inspected;
visual acceptance across browser/host versions remains open. Automated WCAG
smoke is not a substitute for manual keyboard/assistive-technology testing.

## Product admission gates still open

Production hosting requires a reviewed dedicated origin/domain and HTTP/CSP/
credential boundary, actual authorized MCP resources, resource/version evidence,
connection-scoped tool visibility and the ordinary Native Tool Gateway for every
call, with current tenant/Source/grants/policy/approval/budget/audit checks. It
also needs lifecycle/abuse/exfiltration/CPU recovery, deployment, browser, mobile,
keyboard/AT and Human acceptance evidence. No app-side label/token bypasses
those owners. Until qualified, this script remains an anonymous local experiment
and the AW product capability remains closed. All V9 launch rows/R0 stay pending.
