# V9 reviewed attention samples

This implements the offline measurement support for brief §11.4. It does not
collect application telemetry, contact participants/providers, or certify a real
Human study, full-population recall, deployment qualification or release. Every
result remains `descriptive_reviewed_sample_only` and `gaAllowed: false`, including
when the supplied pilot protocol is confirmatory. There is no combined score.

Use the existing reviewed frozen pilot protocol and its declared journey/role/
surface/assistive slices. The source/artifact/configuration/schema/policy/model/
tool hashes bind the result to that protocol. The canonical observation JSON hash
binds the particular annotations. A hash binds bytes/metadata; it does not prove
that the observations, source truth or asserted independent review are genuine.
Keep independently reviewed Native evidence in the existing approved private
study records. Automated fixture tests are software evidence only.

## Input and source discipline

Start from `evals/aw-v9/attention-observations.template.json`. Its null digest/time
are deliberately invalid; no study or observations have been manufactured. After
reviewing the protocol and its sampling/uncertainty/retention decisions, supply
its exact digest and an observation reference time within the approved window.
Review canonical conditions independently of whether the product emitted alerts.
Selecting only emitted alerts cannot establish recall.

Each condition has exactly these fields:

- `conditionLabel`: a study-local `C-` plus six uppercase letters/digits;
- `journeyId`, `role`, `surface`, `assistive`: one exact frozen critical slice;
- `occurredAt`: canonical condition time, after protocol freeze;
- `actionWindowEndsAt`: actual reviewed action-window end or null; never invent
  one to obtain a timely/missed result;
- `resolvedAt`: actual Native resolution time or null;
- `resolutionStatus`: `resolved`, `unresolved` or `unconfirmed`; only resolved
  requires a resolution time, and an unconfirmed result cannot contribute a
  confirmed unresolved-age/overdue count;
- `requiresHumanAction`: independently adjudicated true/false, or null when
  unknown; lack of a click is not this judgment;
- `independentReview`: whether the required independent assessment exists;
- `deliveryInventory`: `reconciled` for reviewed delivery evidence on this slice,
  otherwise `partial`; this is not an assertion of an exhaustive population;
- `deliveries`: at most 32 reviewed attempts.

Each attempt has exactly `deliveryLabel` (`D-` plus six letters/digits),
`decisionValueLabel` (`V-` plus six letters/digits), `outcome`, `deliveredAt`,
`authorized`, `actionable`, `useful`, `warranted`. Labels refer to the private study
mapping; they are not Native IDs, names, URLs or tokens. Condition labels are
unique; delivery labels are unique across the bundle. Reuse a value label only
when the same canonical condition has no new decision value. A genuinely new
value is not a duplicate merely because its condition is unchanged.

`outcome` is `confirmed_delivered`, `confirmed_not_delivered` or `unconfirmed`.
A transport success alone does not establish delivered/actionable state. Read
Original receipts and current scope through the existing approved protocol.
Unconfirmed/not-delivered attempts have null time and null judgments. Confirmed
physical deliveries have an actual delivery time; authority, actionability,
usefulness and warranted-interruption judgments can each remain null. A physical
message outside authorized scope cannot satisfy actionable delivery. Usefulness
means the reviewed action/retention/explicit-useful criterion; it is not inferred
from sending, opening, mark-read or optimistic success copy. `warranted` is the
separate judgment that this should interrupt rather than remain silent/digest.

All timestamps use exact UTC ISO milliseconds. Reversed/future observations,
undeclared slices, duplicate identities, expanded/private fields and bounds fail
closed. Maximum 1000 conditions. Empty input remains `not_executed`.

## Portfolio and uncertainty

Every journey/role/surface/assistive/consequence slice remains separate. A missed
high-consequence condition cannot be averaged away by successful lower-impact
work. Each ratio includes its numerator and denominator; an empty denominator
has a null value, never perfect precision.

| Brief measure | Descriptive receipt |
| --- | --- |
| Actionable Attention Precision | Useful independently judged confirmed deliveries / deliveries with a usefulness judgment |
| Critical Attention Recall | `confirmedRequiredSurfacing`: conditions with confirmed authorized actionable delivery / all reviewed required conditions in this slice |
| Missed Critical Attention Rate | `confirmedMissedRequired`: reconciled, closed-window required conditions with no qualifying delivery / all reviewed required conditions |
| Late Critical Attention Rate | `confirmedLateRequired`: required conditions whose first qualifying delivery is after their actual window, with no unresolved possibly earlier delivery / all reviewed required conditions |
| Duplicate Interruption Rate | Repeated reviewed condition/value deliveries / independently reviewed confirmed deliveries |
| Unnecessary Interruption Rate | Independently judged unwarranted interruptions / confirmed deliveries with a warranted judgment |
| Unresolved Critical Item Age | Duration buckets and actual-window overdue count for reviewed unresolved required conditions |
| Time to Required Human Action | Condition-to-first-confirmed-authorized-actionable-delivery duration buckets; this is delivery, not proof a Human resolved the work |

Unknown attempts, partial inventories, still-open windows, missing windows,
unreviewed conditions, uncertain late timing and unconfirmed resolution have
explicit separate counts.
They never become confirmed misses. Unknown/open cases remain in required
condition denominators, so confirmed fractions are conservative observed
fractions, not population estimates. When earlier delivery evidence is uncertain,
latency is placed in `confirmedLatencyUpperBoundBuckets` rather than the exact
latency buckets; the first confirmed observation cannot establish the first
physical delivery. There are no inferred business deadlines, population confidence
intervals, default acceptance thresholds or a release pass. The reviewed sample's
sampling rationale and uncertainty plan still need independent methodological
assessment before broader claims.

## Data Processing Contract — aw.attention-reviewed-sample.v1

| Field | Decision |
| --- | --- |
| Owner and purpose | Product/research and privacy owners; diagnose attention misses, excess interruptions and actionable delivery in an approved bounded study |
| Allowed input | Closed condition/attempt metadata and explicit review judgments above; exact frozen protocol |
| Prohibited input | Names, participant labels, Native identifiers, emails, prompts, bodies, credentials, URLs, raw provider errors, screenshots, arbitrary properties, replay recordings |
| Identity / tenant scope | Private study-local labels and frozen slices; the approved source procedure defines company scope. The scorer does not enforce Native tenant authorization, detect cross-company samples or discover a population |
| Classification | Confidential study metadata; pseudonymous labels and small-cell aggregates are not claimed anonymous |
| Source | Existing independently reviewed Native truth/delivery evidence and declared Human annotation; the tool does not verify those facts |
| Sink and region | Explicit operator-owned private files on the existing approved study host; no provider, network destination, new region or automatic export |
| Access | Operator read permission; input must be an owned regular file with no group/other access; final symlinks are refused |
| Collection and sampling | Explicit offline invocation only; approved frozen journey slices and reviewed bounded conditions; no client events or session replay |
| Retention | Existing protocol's concrete approved retention key/owner controls inputs, private label mappings and aggregate artifacts; no invented legal period or application dataset |
| Rights / deletion | Apply the existing study's rights/deletion procedure to source/mapping and derived receipts; on withdrawal remove invalid receipts and recompute only from currently permitted evidence |
| Backup / export | Existing study policy must govern any backup or sharing; no new export/backup destination is introduced |
| Redaction / hashing | No raw field/value logging; output omits labels and observation timestamps; canonical observation/protocol and frozen source/configuration/model/tool hashes provide binding |
| Output fields | Contract/schema version, hashes, phase, bounded/descriptive/unexecuted status, false population/GA flags and per-slice counts/ratios/duration buckets only |
| Output safety | New 0600 file with exclusive/no-follow creation; existing inputs/receipts are never overwritten |
| Bounds and tests | Protocol 256 KiB, observations 16 MiB, 1000 conditions, 32 attempts each; strict schema, silence/unknown/critical-slice/duplicate/chronology and real private-file canaries |
| Review triggers | New purpose, input/metric, identity, slice/population claim, provider/sink/region, collection/retention/export, acceptance criterion or session replay |

The CLI requires Unix ownership/mode/no-follow semantics and refuses platforms
that cannot supply them. Run only with actual approved private artifacts:

```sh
pnpm validate:aw-v9-attention /private/protocol.json /private/attention.json PROTOCOL_SHA256 /private/new-attention-receipt.json
```

`pnpm test:aw-v9-pilot` and the existing V9 coverage CI job include the attention
mathematics and private-artifact tests. Those tests deliberately use synthetic
annotations and never stand in for the study or release evidence.
