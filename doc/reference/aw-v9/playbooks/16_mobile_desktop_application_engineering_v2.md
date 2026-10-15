# 16 — Mobile & Desktop Application Engineering — V2

> **Evergreen engineering standard for native and cross-platform application clients**

```yaml
document_id: ENG-16-MDAE
title: 16 — Mobile & Desktop Application Engineering
artifact_type: domain_playbook
primary_archetype:
  - Operating
  - Capability
  - Execution
  - Decision
version: 2.0-RC1
status: REVIEWED
created: 2026-09-27
last_updated: 2026-09-27
last_reviewed: 2026-09-27
evidence_cutoff: 2026-09-27
canonical_language: English
owner_role: Playbooks / Engineering Standards
parent_standard: 00 — Universal Software & AI Engineering Master Playbook V2.0
playbook_standard: Master Playbook Standard v2.0-RC1
default_rigor: R3 / CONTROLLED for production applications
critical_overlay: R4 where safety, severe security/privacy, regulated or irreversible consequences apply
volatility:
  core_principles: MODERATE
  platform_apis: FAST
  store_policies: FAST
  security_advisories: REAL_TIME
review_cadence: quarterly plus event-triggered
next_scheduled_review: 2026-12-27
supersedes: ENG-16-MDAE 1.0-DRAFT
```

---

# Executive standard

A mobile or desktop application is not merely a UI binary. It is a
**stateful, partially trusted software system living inside an operating system
that owns important parts of its lifecycle, permissions, resource budget,
installation identity and update authority**.

The durable chain is:

```text
INTENT
→ PLATFORM / DISTRIBUTION CONSTRAINTS
→ LIFECYCLE + INTERRUPTION MODEL
→ STATE OWNERSHIP + PERSISTENCE
→ OFFLINE / NETWORK / SYNCHRONIZATION SEMANTICS
→ PERMISSIONS + NATIVE CAPABILITIES
→ SECURITY + PRIVACY + ACCESSIBILITY
→ PACKAGE + SIGN
→ DISTRIBUTE + UPDATE + MIGRATE
→ OBSERVE REAL DEVICES / REAL VERSIONS
→ MAINTAIN + DEPRECATE + RETIRE
```

The central engineering doctrine is:

> **Assume the process can disappear, the network can lie by omission, the
> user can revoke access, multiple versions can coexist, local state can
> outlive code, and the distribution/update channel is part of the security
> boundary. Design recovery, compatibility and evidence accordingly.**

This playbook inherits the parent standards' risk-proportionate assurance,
state/invariant, security/privacy, supply-chain, release, verification and
maintenance requirements. It adds application-client-specific implementation
depth. [P00-MPS] [P00-SWE]

---

# 1. Purpose, outcomes and scope

## 1.1 Intended outcome

Enable engineering teams to build and evolve application clients that:

- preserve user intent through lifecycle interruption and process death;
- remain coherent under unreliable or absent connectivity;
- synchronize state without silent corruption or unjustified lost updates;
- request and use OS capabilities with least privilege;
- protect local credentials, data and privileged bridges;
- behave accessibly across native input and assistive-technology models;
- install, sign, update and migrate safely;
- coexist with old/new client and backend versions;
- expose enough field evidence to detect version/device-specific failure;
- remain maintainable as OS, store policy, signing and framework requirements change.

## 1.2 In scope

- iOS and iPadOS application engineering;
- Android application engineering;
- macOS desktop applications;
- Windows desktop applications;
- Linux desktop applications;
- fully native applications;
- shared-domain/native-UI applications;
- shared-runtime/shared-UI cross-platform applications;
- WebView/web-runtime desktop shells such as Electron/Tauri-like architectures;
- local state, storage, offline modes and synchronization;
- permissions, entitlements, capabilities and native integrations;
- packaging, signing, notarization/store submission and direct distribution;
- staged updates, self-updaters, schema migrations and minimum-version policy;
- accessibility, resource/battery quality and client observability.

## 1.3 Out of scope

These require their own specialist standards or regulatory overlays:

- web/PWA engineering as the primary delivery model;
- backend/API implementation;
- cryptographic primitive design;
- MDM/enterprise endpoint-management administration;
- app-store commercial strategy/ASO;
- medical/automotive/aviation functional-safety certification;
- anti-cheat, DRM or malware-resistance programs beyond the ordinary app threat model;
- game-engine-specific rendering/real-time architecture;
- OS kernel drivers and privileged system software.

---

# 2. How to use this playbook

Use the smallest relevant path:

| Need | Start here |
|---|---|
| Choose native vs cross-platform | §6 + PLAY-MDAE-01 |
| Make state survive lifecycle/process death | §§7–8 + PLAY-MDAE-02 |
| Build offline/sync | §9 + PLAY-MDAE-03 |
| Add camera/location/files/notifications/etc. | §11 + PLAY-MDAE-04 |
| Protect tokens/keys/local sensitive data | §12 + PLAY-MDAE-05 |
| Package/sign/distribute | §16 + PLAY-MDAE-06 |
| Release/update safely | §17 + PLAY-MDAE-07 |
| Migrate local DB/state | §18 + PLAY-MDAE-08 |
| Diagnose missing/duplicate/stale local data | PLAY-MDAE-09 |
| Halt a harmful release | PLAY-MDAE-10 |
| Verify production readiness | §§20–23 + checklists |

The exact framework, language, database and packaging tool remain implementation
choices. The invariants in this playbook survive those choices.

---

# 3. Evidence and rule model

This playbook inherits the parent claim model:

- `REQ` — externally required in the stated context;
- `EST` — strongly established engineering practice;
- `DEF` — recommended default;
- `CTX` — context-dependent;
- `EMG` — emerging practice;
- `HOUSE` — deliberate internal standard;
- `EXP` — experiment/hypothesis;
- `UNK` — important unresolved question.

It also inherits the parent evidence lanes. Official platform documentation is
authoritative for platform semantics and policy, but not proof that the
platform vendor's architectural preference is universally optimal.

**Freshness rule:** store policies, target SDK/API requirements, SDK behavior,
signing/notarization rules and updater/framework releases MUST be rechecked
before a consequential release.

---

# 4. Domain model

```text
┌──────────────────────────────────────────────────────────────┐
│ PRODUCT INTENT / USERS / UNACCEPTABLE FAILURE               │
└──────────────────────────────────────────────────────────────┘
          ↓
PLATFORM TARGETS + SUPPORT WINDOW + DISTRIBUTION CHANNELS
          ↓
PROCESS / WINDOW / SCENE / TASK LIFECYCLE
          ↓
STATE CLASSIFICATION + SOURCE OF TRUTH + LOCAL STORAGE
          ↓
NETWORK / OFFLINE MODE / SYNC / CONFLICT / DELETE
          ↓
PERMISSIONS / ENTITLEMENTS / FILES / DEEP LINKS / IPC
          ↓
SECURITY / PRIVACY / ACCESSIBILITY / RESOURCE BUDGET
          ↓
PACKAGE IDENTITY / SIGNING / NOTARIZATION / STORE POLICY
          ↓
UPDATE CHANNEL / STAGING / MIGRATION / COMPATIBILITY
          ↓
FIELD TELEMETRY BY VERSION / OS / DEVICE / ARCHITECTURE
          ↓
MAINTENANCE / DEPRECATION / MINIMUM VERSION / RETIREMENT
```

## 4.1 Application truth is distributed across layers

For any material feature, identify:

```yaml
domain_source_of_truth:
local_durable_replica:
ui_projection:
pending_local_intent:
remote_revision_or_version:
permission_dependency:
background_execution_dependency:
package_or_os_capability:
minimum_supported_client:
minimum_supported_os:
recovery_if_process_dies:
recovery_if_update_fails:
```

Do not let the same fact become independently authoritative in UI memory,
local database and server state.

---

# 5. Golden application engineering standards

1. **Lifecycle is part of correctness.** Every platform can stop, throttle, suspend, terminate, restart or otherwise interrupt work under conditions the app does not fully control. Treat interruption as normal.
2. **Memory is a cache unless the platform contract says otherwise.** Important user/domain state MUST survive the lifecycle events relevant to the product.
3. **Design for restartability.** Long-running or externally consequential operations SHOULD be resumable, idempotent or safely reconcilable after interruption.
4. **Separate UI state from durable domain state.** Transient presentation, restorable navigation, durable data, sync metadata, secrets and caches have different lifetimes and storage requirements.
5. **Give every logical fact one authoritative owner.** Avoid two independently writable sources of truth unless a conflict protocol is explicitly designed.
6. **Offline capability is a product decision, not a badge.** Choose online-required, cache-assisted, offline-readable or offline-writable behavior from real user/workflow requirements.
7. **Connectivity is a hint, not proof that an operation will succeed.** Only the actual request establishes reachability, authorization and freshness.
8. **Offline writes require durable intent.** Persist a mutation/outbox before telling the user it will be synchronized later.
9. **Network mutations must tolerate duplicates where retries are plausible.** Use idempotency keys, operation IDs, version guards or equivalent domain mechanisms.
10. **Conflict semantics must be domain-defined.** State what happens under concurrent edits, deletes, stale versions and reordered delivery.
11. **Last-write-wins is contextual, never a universal default.** It is acceptable only when overwrite semantics are safe and ordering/timestamp assumptions are justified.
12. **Device wall clocks are not a universal conflict oracle.** Prefer server revisions, compare-and-set versions, causal/domain merge rules or other explicit ordering where correctness matters.
13. **Deletion is a synchronization event.** Use tombstones/versioned deletion or an equivalent protocol when deleted state can reappear from stale peers.
14. **Permissions are capabilities, not onboarding boxes.** Request only what is needed for an understandable feature and only when the user reaches that feature.
15. **Denied, restricted and revoked permissions are normal states.** The app MUST remain coherent, explain impact and offer a safe fallback/recovery path.
16. **Re-check permission state at use time when the platform can revoke access.** Do not rely on a one-time cached grant.
17. **Store small secrets in platform-protected secret/key facilities.** Credentials and cryptographic keys do not belong in ordinary preferences, source code, logs or general local databases.
18. **A client application cannot safely hold a server secret.** Anything shipped to a user-controlled device can ultimately be inspected or invoked.
19. **Deep links, files, intents, URLs and IPC are untrusted inputs.** Validate syntax, semantics, identity/authorization and side effects at the receiving boundary.
20. **Prefer verified website-app links over ambiguous custom schemes when they fit.** Verification reduces hijacking/ambiguity but does not authorize the requested action.
21. **Background execution is OS-governed.** Use the platform scheduler appropriate to the requirement; do not assume exact timing or unlimited runtime unless the API explicitly guarantees it.
22. **Persist the job, not only the callback.** Required background work SHOULD have durable state, retry bounds and observable completion.
23. **Battery, memory, storage, thermal and radio use are quality attributes.** A mobile app that drains battery or is repeatedly killed for resource pressure is not production-quality.
24. **Accessibility uses platform semantics.** Expose native roles/names/states, support platform assistive technologies and input modes, and test real flows.
25. **Desktop interaction is multi-modal.** Keyboard, pointer, focus, window resizing, DPI/scaling, multiple monitors and assistive technologies are first-class where applicable.
26. **Cross-platform means shared policy with explicit platform seams.** Do not hide lifecycle, permission, packaging or native capability differences behind a fake universal abstraction.
27. **Share code where semantics are actually shared.** Domain rules and data contracts are often better sharing candidates than lifecycle, permissions, navigation, notifications or platform chrome.
28. **Framework choice does not remove platform responsibility.** The team still owns store policy, signing, lifecycle, native integrations, accessibility and release behavior.
29. **Package identity and signing are lifecycle assets.** Treat certificates, entitlements/capabilities, package IDs and signing keys as controlled production state.
30. **Signing keys need rotation/recovery thinking.** Protect private keys, separate upload/build identities where supported, and document compromise/loss recovery.
31. **Distribution channel determines update authority.** Store, enterprise, package-manager and self-hosted channels have different signing, review, rollback and update semantics.
32. **Every update path needs authenticity and integrity.** Do not execute/install artifacts that cannot be verified as intended releases.
33. **Self-updaters need more than a signature.** Where threat/risk justifies it, protect freshness, rollback, mix-and-match, key compromise, size/resource abuse and recovery.
34. **App rollback is not data rollback.** A previous binary may be unable to understand state written by a newer version.
35. **Migrations are version-coexistence problems.** Design old/new application and backend versions to overlap safely during staged rollout.
36. **Prefer expand → migrate → verify → contract for durable schemas.** Destructive cleanup follows evidence that old readers/writers are gone.
37. **Updates should be progressively exposed when the channel supports it.** Define cohort, health signals, stop criteria, owner and rollback/roll-forward path.
38. **Forced updates require a compatibility or safety reason.** Do not convert ordinary release preference into user lockout.
39. **Runtime-delivered code is a policy and security boundary.** Verify platform/store rules before using hot-update, plugins, scripts or downloadable executable code.
40. **Store review/notarization is not a security proof.** Threat modeling, secure development and verification remain product responsibilities.
41. **Sandboxing is containment, not absolution.** Least privilege, input validation, secure IPC and update integrity are still required.
42. **Web-runtime desktop apps have two trust domains.** Renderer/WebView content MUST NOT receive broad native capability simply because it is packaged as a desktop app.
43. **Validate privileged IPC at the native/core boundary.** Check sender/origin, schema, authorization, allowed paths/resources and requested action.
44. **Use OS-standard data/config/cache locations.** Respect backup, roaming, uninstall, sandbox and enterprise-management semantics rather than inventing ad-hoc locations.
45. **Desktop multi-instance behavior must be explicit.** If multiple processes/windows can write the same state, define locking/versioning/transaction semantics.
46. **Files chosen by users remain external input.** Validate type/content/size, preserve user ownership, and avoid destructive mutation without explicit intent.
47. **Local writes need crash consistency.** Use transactional databases, atomic-replace patterns or equivalent mechanisms for state that must not be half-written.
48. **Caches are disposable by definition.** If losing an item would violate user expectations, it is not merely a cache.
49. **Local databases have migration and corruption policies.** Version schemas, test upgrade paths, detect incompatible/corrupt state and define recovery without silent data loss.
50. **Compatibility must include old client ↔ new server.** Mobile and desktop clients can remain in the wild long after a server deploy.
51. **Minimum supported versions are product contracts.** Set OS/runtime/backend support windows intentionally and communicate deprecation before enforcement.
52. **Measure by released version and platform segment.** Averages can hide device-, OS-, architecture- or release-specific regressions.
53. **Crashes are only one failure mode.** Track hangs/ANRs, startup failures, rendering stalls, sync backlog/conflicts, migration failures and update failures where relevant.
54. **Real-device evidence is required for material platform behavior.** Emulators/simulators are useful but cannot reproduce every permission, performance, hardware, power, signing or store behavior.
55. **Test process death and restart explicitly.** Kill the process during navigation, write, sync, upload/download, migration and background work.
56. **Test upgrade paths, not only clean installs.** Exercise N-1/N-2 or the supported source versions through real migrations and package/update mechanisms.
57. **Test interrupted updates and low-resource conditions.** Low disk, network loss, device restart and partial download/install must not corrupt durable state.
58. **Accessibility needs assistive-technology testing.** Automated checks are useful but do not replace representative screen-reader/keyboard/switch/scale interaction tests.
59. **Release telemetry must support a stop decision.** If the team cannot know that a staged release is harmful, the staging mechanism is false confidence.
60. **Privacy applies to local telemetry and crash artifacts.** Redact secrets and unnecessary personal data from logs, diagnostics, databases, notifications and backups.
61. **Notifications are externally visible side effects.** Respect user permission, privacy, rate/priority semantics and stale/deep-link behavior.
62. **Clipboard and screenshots can cross trust boundaries.** Avoid placing sensitive data there by default; use platform protections when justified.
63. **Biometrics authenticate a local user gesture/context, not a remote business entitlement.** Server authorization and account policy remain separate.
64. **Device integrity/attestation is a risk signal, not a universal authorization oracle.** Treat it as one input within a threat model, with fallbacks and false-positive/availability considerations.
65. **Third-party SDKs expand the app’s data and supply-chain boundary.** Inventory, minimize, permission-scope, update and monitor analytics/ad/identity/native SDKs.
66. **Native extensions/plugins need their own lifecycle and permission review.** Widgets, services, extensions, background agents and shell integrations can have different execution/entitlement boundaries.
67. **Build reproducibility and provenance matter more when distribution is privileged.** Know source revision, dependencies, builder, signing path and artifact digest for material releases.
68. **Emergency release paths must be pre-designed.** Define who can halt rollout, revoke/sign again, disable a feature, require a minimum version or ship a safe hotfix.
69. **Retirement includes client state.** Disable credentials/endpoints safely, export/delete user data as required, remove update channels and retire backend compatibility deliberately.


---

# 6. Native vs cross-platform architecture

## 6.1 Do not choose from labels

“Native” and “cross-platform” hide several materially different architectures.

```text
A. FULLY NATIVE
   platform language/runtime + platform UI + platform data/integration

B. SHARED DOMAIN / DATA + NATIVE UI
   common business rules/network/storage abstractions
   + platform lifecycle/UI/integration

C. SHARED DOMAIN + SHARED UI RUNTIME
   common business/UI layer
   + explicit platform entry points and capability adapters

D. WEB-RUNTIME / WEBVIEW DESKTOP
   web renderer
   ↔ constrained native IPC bridge
   ↔ OS capabilities

E. REMOTE WEB CONTENT WITH NATIVE CAPABILITY
   highest trust-boundary sensitivity; must be justified and tightly scoped
```

Framework documentation itself confirms that code sharing is a spectrum and
platform-specific APIs/entry points remain necessary. [KMP] [MAUI]

## 6.2 Decision criteria

| Criterion | Engineering implication |
|---|---|
| **Single-platform scope** | Favors native/single-platform stack when no credible second platform exists. |
| **Platform-specific UX depth** | Favors native UI or thinner sharing boundary when platform idioms are strategic. |
| **Hardware / privileged APIs** | Favors direct native access or a proven bridge with platform-owned implementation. |
| **Shared domain complexity** | Favors shared business/domain/data modules when rules must stay identical. |
| **UI similarity across platforms** | Favors shared UI only when product intentionally wants common interaction semantics. |
| **Lifecycle/background complexity** | Favors explicit platform seams; never hide platform schedulers/lifecycle behind weak abstractions. |
| **Existing team capability** | Affects delivery and incident risk; do not choose a stack the team cannot operate. |
| **Plugin/dependency maturity** | Cross-platform value depends on critical native integrations being maintained and auditable. |
| **Performance/startup/binary constraints** | Measure representative builds; vendor claims are not evidence. |
| **Accessibility requirements** | Verify framework-native semantic mappings and escape hatches for platform AT. |
| **Release independence** | Native/platform modules may need independent OS/store release timing. |
| **Long-term support horizon** | Prefer stacks with viable OS-version support, migration path and dependency health. |


## 6.3 Decision rules

**DEF:** For one platform with deep platform-specific UX/hardware requirements,
prefer the least complex native path unless a shared layer solves a demonstrated
cross-platform need.

**DEF:** For two or more platforms with substantial stable domain logic, first
consider sharing domain/data/contracts while keeping lifecycle and permissions
platform-owned.

**CTX:** Share UI when the product intentionally values interaction consistency
and the chosen framework demonstrates acceptable accessibility, native
integration, performance and support behavior on every target.

**CTX:** Use a WebView/web-runtime shell when web-team leverage and UI sharing
outweigh the enlarged native-bridge/security/update/runtime footprint.

**MUST:** Preserve a platform escape hatch for capabilities that cannot be
safely or correctly expressed through the shared abstraction.

## 6.4 Cross-platform abstraction test

Before adding a shared abstraction, ask:

1. Are the semantics actually the same on all targets?
2. Is failure behavior equivalent?
3. Are permission/lifecycle guarantees equivalent?
4. Can the abstraction expose platform differences without fake booleans/modes?
5. Does it make testing easier rather than hiding the real platform?
6. Can a platform specialist still reason from the code to native behavior?

If not, keep the seam platform-specific.

---

# 7. Lifecycle and interruption engineering

## 7.1 Universal lifecycle invariant

The app never owns the assumption that its process will remain alive long enough
to finish important work.

Android explicitly allows the system to kill the process and does not guarantee
`onDestroy()` on process kill. [ANDROID-LIFE] Apple assigns different resource
expectations to foreground/background states and system-schedules background
tasks. [APPLE-LIFE] [APPLE-BG] Windows desktop apps usually keep running rather
than entering the UWP suspension model, but still face unexpected shutdown,
sleep/standby, OS updates and forced termination. [WIN-LIFE]

Therefore:

- persist user intent before acknowledging deferred completion;
- make in-progress durable work discoverable after restart;
- treat callbacks such as “close”, “destroy” or “background” as optimization
  opportunities, not the sole persistence mechanism;
- define cancellation and compensation where work can be partially completed.

## 7.2 Mobile profile

Mobile designs SHOULD explicitly model:

```text
FOREGROUND / ACTIVE
→ INACTIVE / TRANSITIONING
→ BACKGROUND
→ PROCESS MAY BE TERMINATED
→ LATER COLD/WARM RECONSTRUCTION
```

Do not make correctness depend on a final callback.

## 7.3 Desktop profile

Desktop designs SHOULD explicitly model:

```text
NOT RUNNING
→ START / ACTIVATION
→ 1..N WINDOWS / OPTIONAL BACKGROUND PRESENCE
→ SLEEP / LOCK / THROTTLING / NETWORK CHANGE
→ WINDOW CLOSE OR PROCESS EXIT
→ UNEXPECTED KILL / POWER LOSS / OS UPDATE
→ RESTART / RE-ACTIVATION
```

A desktop app MAY intentionally run without a visible window. That does not
remove resource, persistence or shutdown obligations.

## 7.4 Lifecycle survival matrix

For each critical state or operation record:

| Item | Survive UI recreation? | Survive process death? | Survive reboot? | Survive app update? | Survive account logout? |
|---|---:|---:|---:|---:|---:|
| navigation selection | product-specific | usually yes if continuity matters | optional | optional | usually no |
| unsaved user draft | yes | **yes if loss is material** | product-specific | yes | policy-specific |
| committed local domain record | yes | yes | yes | yes via migration | policy-specific |
| sync outbox | yes | yes | yes | yes | explicit |
| cache | optional | no requirement | no requirement | no requirement | usually clear |
| credential/token | yes | yes per policy | yes per policy | yes | usually clear/revoke |

---

# 8. State and local persistence

## 8.1 Canonical state taxonomy

| State class | Examples | Default home | Must survive process death? | Recovery |
|---|---|---|---|---|
| Ephemeral render state | Selection hover, animation phase, in-flight composition. | Memory | No | Reconstruct. |
| Restorable UI/session state | Current screen, selected tab, draft cursor, navigation location. | Saved-state/session mechanism; small durable references | Usually | Rehydrate from durable data. |
| Durable local domain state | User-created records, downloaded working set, offline edits. | Transactional DB/files | Yes | Migration + backup/export policy as applicable. |
| Sync intent/metadata | Outbox operations, remote revision, sync cursor, tombstones, retry metadata. | Transactional durable store | Yes | Idempotent/reconcilable. |
| Credentials/secrets | Refresh token, private key, credential. | Platform secret/key store | Yes, per policy | Re-auth/re-provision if unavailable. |
| Cache/derived data | Images, compiled artifacts, derived search index. | Cache directory/store | No | Delete/rebuild safely. |
| User-owned documents | Files intentionally created/opened by user. | User-selected/document location | Yes | Respect ownership, file coordination, permissions. |
| Configuration/preferences | Theme, non-sensitive settings. | Platform preferences/config store | Usually | Default + migration. |


Apple’s `SceneStorage` is explicitly lightweight and does not guarantee when or
how often persistence occurs; Android similarly separates saved UI state from
durable local storage. [APPLE-STATE] [ANDROID-STATE]

## 8.2 State inventory template

```yaml
state_id:
meaning:
authoritative_owner:
writers:
readers:
classification:
persistence_home:
lifetime:
process_death_behavior:
reboot_behavior:
backup_or_roaming_behavior:
encryption_or_secret_store:
schema_version:
migration_owner:
sync_role:
deletion_semantics:
corruption_detection:
recovery:
```

## 8.3 Durable local write rules

For material state:

- use transactions or atomic-replace semantics;
- fsync/durability guarantees SHOULD be understood when power loss matters;
- never expose a “saved” success state before the required durability boundary;
- keep migrations restart-safe where feasible;
- use checksums/invariants/reconciliation when silent corruption is material;
- separate cache deletion from user-data deletion.

## 8.4 User preferences vs secrets

Preferences stores are appropriate for non-sensitive, small configuration.
Secrets belong in OS-protected credential/key facilities such as Apple
Keychain, Android Keystore or Windows Credential Locker. [APPLE-KEYCHAIN]
[ANDROID-KEYSTORE] [WIN-CRED]

**MUST NOT:** treat a platform secret store as the general solution for a large
application database.

---

# 9. Offline, synchronization and conflict engineering

## 9.1 Choose the offline mode

| Mode | Use when | Typical examples | Required semantics |
|---|---|---|---|
| Online-required | Operation is impossible/unsafe without authoritative live service. | Payments, highly contested inventory, privileged live action. | Clear unavailable state; no fake success. |
| Cache-assisted | Read performance/continuity matters but writes remain online. | Reference data, feeds. | Staleness semantics; explicit refresh. |
| Offline-readable | Users must inspect previously available data without network. | Travel/reference/field lookup. | Local durable subset; freshness indicator. |
| Offline-writable / local-first | User work must continue offline and sync later. | Notes, field data, task editing. | Durable outbox, IDs, conflict/delete protocol, reconciliation. |


Android’s official architecture guide is useful evidence for local readable
sources, queues, lazy writes and synchronization, but this playbook rejects any
interpretation that makes offline-first or LWW universal. [ANDROID-OFFLINE]

## 9.2 Offline-writable reference model

```text
USER ACTION
→ VALIDATE LOCALLY
→ ATOMICALLY COMMIT DOMAIN CHANGE + OUTBOX OPERATION
→ RENDER FROM LOCAL DURABLE STATE
→ SCHEDULER / FOREGROUND TRIGGER
→ SEND IDEMPOTENT OPERATION
→ SERVER AUTHORIZATION + VERSION CHECK
→ RECEIVE AUTHORITATIVE RESULT / CONFLICT
→ ATOMICALLY APPLY RESULT + ADVANCE SYNC METADATA
→ REMOVE/ACK OUTBOX ENTRY
```

The local database can be the immediate read model while the server remains the
business authority. Those concepts are not contradictory.

## 9.3 Every sync protocol MUST define

```yaml
identity:
  entity_id:
  operation_id_or_idempotency_key:
versioning:
  remote_revision:
  local_base_revision:
delivery:
  duplicate_behavior:
  out_of_order_behavior:
  retry_policy:
  timeout_budget:
conflict:
  detection:
  policy:
  user_visible_resolution:
deletion:
  tombstone_or_equivalent:
  retention:
pagination:
  snapshot_or_cursor_semantics:
auth:
  expiry_mid_sync:
  account_switch:
recovery:
  partial_batch:
  client_crash:
  server_failure:
observability:
  outbox_age:
  conflict_rate:
  sync_lag:
```

## 9.4 Conflict policy decision table

| Situation | Strong default |
|---|---|
| Single authoritative writer | Server revision; reject stale client mutation |
| Independent fields can merge | Field/domain merge with explicit base revision |
| Collaborative structured data | Domain-specific CRDT/OT/merge only when complexity is justified |
| Whole-value overwrite is acceptable | LWW MAY be used with justified ordering source |
| Financial/inventory/security state | Do not silently LWW; use transactions/version guards/authoritative reconciliation |
| Concurrent delete vs edit | Define delete precedence/tombstone semantics explicitly |

### Why LWW is conditional

The Android guide calls LWW common for mobile conflict resolution.
[ANDROID-OFFLINE] The parent engineering standard correctly warns that physical
timestamps do not establish causal order in distributed systems. [P00-SWE]

Therefore `updated_at >` based on device clocks is **not** a universal conflict
protocol.

## 9.5 Connectivity handling

A connectivity API MAY trigger an attempt. It MUST NOT be treated as proof that:

- DNS works;
- TLS succeeds;
- captive-portal interception is absent;
- authentication remains valid;
- the backend is healthy;
- the response is fresh.

The request itself remains the evidence.

---

# 10. Networking and remote dependencies

Inherit the parent failure-engineering rules and apply them at the client edge:

- finite total deadlines;
- cancellation propagated when supported;
- retry only plausibly transient failures;
- bounded exponential backoff + jitter where synchronization can herd clients;
- idempotency/deduplication for repeated mutations;
- explicit cache freshness/staleness;
- pagination/resume for large transfers;
- resumable upload/download where interruption cost justifies it;
- TLS and platform transport-security defaults;
- server certificate/public-key pinning only with an operational rotation and
  recovery plan; do not add brittle pinning by ritual.

A mobile fleet can become a retry-amplification system after an outage. Server
capacity and retry policy MUST be designed together.

---

# 11. Permissions, entitlements and OS capabilities

## 11.1 Permission lifecycle

```text
FEATURE DISCOVERED
→ EXPLAIN USER VALUE
→ REQUEST MINIMUM CAPABILITY AT POINT OF NEED
→ GRANTED / LIMITED / DENIED / RESTRICTED
→ FEATURE ADAPTS
→ PERMISSION MAY LATER CHANGE
→ RE-CHECK AT USE BOUNDARY
```

Apple recommends requesting protected access at the time it is needed and
providing fallback when it is not granted. [APPLE-PRIV] Android documents
one-time permission revocation and automatic permission reset. [ANDROID-PERM]

## 11.2 Permission introduction checklist

Before adding a capability:

- What user-visible outcome requires it?
- Can a narrower permission or system picker/portal solve the need?
- Is continuous/background access truly required?
- What happens when denied?
- What happens when partially/temporarily granted?
- What happens when later revoked?
- Does the permission expand store-review/privacy disclosure obligations?
- Does it expose data to extensions/widgets/background services?
- Is telemetry collecting permission state or protected data unnecessarily?

## 11.3 Filesystem capability

Prefer user-mediated file/folder pickers, bookmarks/tokens/portals or scoped
directories over broad permanent filesystem access when the platform supports
it.

Linux sandbox models such as Flatpak demonstrate the same least-privilege
principle through narrow filesystem/device/bus grants. [FLATPAK]

---

# 12. Security and privacy

## 12.1 Client threat model

At minimum consider:

```yaml
assets:
  - credentials / refresh tokens / private keys
  - user local data
  - pending offline intent
  - update signing identity
  - privileged OS capabilities
  - native bridge / IPC
entry_points:
  - deep links / protocol activation
  - files / drag-and-drop / share intents
  - network responses / web content
  - push notifications
  - IPC / extension messages
  - update metadata/artifacts
  - imported backups
adversaries:
  - malicious local process/user
  - compromised renderer/web content
  - network attacker
  - compromised backend/update repository
  - stolen/lost device
  - malicious dependency/SDK
  - compromised build/signing path
```

## 12.2 Mobile verification baseline

For R3/R4 mobile releases, use OWASP MASVS as a concrete verification reference
for storage, crypto, auth, network, platform, code, resilience and privacy,
while retaining the product-specific threat model. [OWASP-MASVS]

## 12.3 Secrets and local key material

- Apple: Keychain is designed for small secrets/keys/certificates.
  [APPLE-KEYCHAIN]
- Android: Keystore can keep key material non-exportable and may bind keys to
  secure hardware. [ANDROID-KEYSTORE]
- Windows: Credential Locker is a platform credential facility available to
  modern and classic desktop app models. [WIN-CRED]

Do not log these materials. Do not ship backend master secrets in the client.

## 12.4 Deep links and external activation

Apple explicitly warns that Universal Links are a potential attack vector and
requires parameter validation. [APPLE-LINKS] Android App Links establish a
verified website↔app association through `assetlinks.json` and the signing
certificate. [ANDROID-LINKS]

**MUST:** verified association answers “which app/domain?”; authorization still
answers “may this user perform this action on this resource?”

## 12.5 Web-runtime desktop boundary

Electron’s security guidance requires context isolation, sandboxing, a
restrictive CSP, navigation restrictions and IPC-sender validation.
[ELECTRON-SEC] Tauri likewise distinguishes WebView and native-core trust
domains and capability-scoped IPC. [TAURI-SEC]

Treat:

```text
WEB CONTENT / RENDERER
    ↓ untrusted or lower-trust request
SCHEMA + ORIGIN/SENDER + AUTHORIZATION + SCOPE VALIDATION
    ↓
NATIVE CORE
    ↓
OS FILE / PROCESS / KEYCHAIN / NETWORK / UPDATE CAPABILITY
```

Never expose “run arbitrary shell”, “read arbitrary file” or equivalent broad
bridges merely for developer convenience.

## 12.6 Sandbox rule

A sandbox reduces blast radius only to the extent that granted capabilities are
narrow. Apple App Sandbox and Linux sandbox/package models support this
containment principle. [APPLE-SANDBOX] [FLATPAK]

**MUST NOT:** treat sandbox presence as proof of application security.

## 12.7 Privacy at the client

Classify:

- crash reports;
- device/OS identifiers;
- notification content;
- local search indexes;
- clipboard content;
- screenshots/previews;
- backup/roaming data;
- analytics SDK data;
- push tokens;
- offline records;
- model/AI prompts if local AI is used.

Retention, consent/notice, access and deletion remain privacy engineering
questions even when data never reaches the primary backend.

---

# 13. Accessibility and platform interaction

WCAG remains useful for shared content and interaction principles, but native
applications require platform semantics and assistive-technology behavior.

## 13.1 Baseline

Every applicable app SHOULD support:

- programmatic names/roles/states/relationships;
- logical focus and reading order;
- keyboard operation on desktop;
- touch target/input alternatives on mobile;
- text/display scaling;
- contrast/high-contrast/system appearance;
- reduced motion where animation is non-essential;
- screen readers and platform assistive technologies;
- error identification and recovery that is not color-only;
- captions/alternatives for media where applicable.

Apple recommends auditing real flows with VoiceOver. [APPLE-A11Y] Android
provides platform design/develop/test guidance. [ANDROID-A11Y] Windows uses UI
Automation and explicitly recommends keyboard, screen-reader, scaling and
high-contrast support plus accessibility regression checks. [WIN-A11Y]

## 13.2 Cross-platform accessibility gate

A shared component is not accepted merely because it renders visually on all
platforms. Verify:

1. native semantic role mapping;
2. focus traversal;
3. screen-reader announcements;
4. dynamic text/scaling;
5. keyboard/pointer/touch behavior;
6. high-contrast/system-theme behavior;
7. platform accessibility actions;
8. escape hatch for a native implementation when the shared primitive fails.

---

# 14. Background work, notifications and resource discipline

## 14.1 Background work

Apple’s background task framework lets the system decide suitable execution
time, and `BGProcessingTask` may be interrupted. [APPLE-BG] Android WorkManager
persists scheduled work across app restarts/device reboots and uses constraints
and flexible scheduling. [ANDROID-WORK]

Therefore general background work SHOULD be:

- deferrable where product semantics permit;
- represented by durable state;
- idempotent or deduplicated;
- bounded by time/data/battery constraints;
- cancelable;
- safe if interrupted halfway;
- observable after restart.

## 14.2 Exact-time work

Use exact wake/alarm mechanisms only when the user/product requirement is
actually exact and the platform permits it. Do not use exact scheduling to
avoid designing resumability.

## 14.3 Battery/resource quality

Android vitals now includes stability, memory and excessive partial wake locks
among core technical quality signals. [ANDROID-VITALS]

For material mobile workloads measure:

- CPU and wall time;
- background execution;
- wake locks/wakeups;
- network transfer frequency/size;
- memory pressure;
- disk/cache growth;
- startup work;
- thermal-sensitive processing where relevant.

The app must remain correct when the OS throttles, delays or kills it.

## 14.4 Notifications

Notifications are durable-ish external UI controlled by the OS, not an
extension of the current screen.

Define:

```yaml
permission_state:
content_sensitivity:
deduplication_key:
expiry_or_staleness:
tap_deep_link:
authorization_on_open:
grouping_priority:
user_controls:
```

Never assume the target entity still exists or the user is still authorized
when an old notification is opened.

---

# 15. Platform integration and activation

Model each activation path:

- ordinary launch;
- deep link / universal link / App Link;
- file open;
- share target;
- notification tap/action;
- protocol activation;
- widget/extension handoff;
- background push/task;
- login item / startup agent;
- second-instance activation.

For each path define:

```yaml
input_trust:
required_authentication:
required_permission:
state_restoration:
single_or_multi_instance:
idempotency:
failure_user_experience:
telemetry:
```

Activation MUST NOT bypass the same authorization/business rules as in-app
navigation.

---

# 16. Packaging, signing and distribution

## 16.1 Distribution decision precedes updater design

| Platform/channel | Typical authority | Engineering implication |
|---|---|---|
| Apple App Store | Apple-hosted store | Store controls install/update channel; app remains responsible for schema/backend compatibility |
| macOS direct | Developer ID + notarization + developer-hosted distribution/update | Publisher owns hosting/update system and its security |
| Google Play | AAB + Play App Signing | Play generates/distributes signed APKs; publisher owns upload identity and compatibility |
| Windows Store/MSIX | Store/Windows package infrastructure | Package identity/signing/update can be platform-managed |
| Windows direct MSIX | Developer + App Installer/feed | Publisher owns feed/channel while Windows verifies package semantics |
| Linux package ecosystem | distro/Flatpak/etc. | Prefer selected ecosystem’s repository/update mechanism |
| Custom desktop updater | publisher | Treat updater as privileged security subsystem |

Apple documents App Store vs direct macOS distribution and requires
Developer-ID signing/notarization for the direct path. [APPLE-DIST]
[APPLE-NOTARY] Android requires APK signatures and Play App Signing for modern
new Play apps, with separate upload/app-signing key roles. [ANDROID-SIGN]
Windows MSIX packages are signed and include cryptographic block hashes.
[WIN-MSIX]

## 16.2 Signing-key governance

For every release identity record:

```yaml
platform:
application_or_package_id:
distribution_channel:
signing_identity:
private_key_location_or_managed_service:
upload_identity:
who_can_request_signing:
who_can_approve_release:
rotation_or_upgrade_mechanism:
compromise_response:
loss_recovery:
expiry:
audit_evidence:
```

**MUST:** signing credentials are not developer-laptop convenience secrets.

## 16.3 Linux note

Linux desktop distribution is heterogeneous. If using Flatpak or a distro
package manager, prefer its repository/sandbox/update model rather than layering
an unnecessary parallel updater. Electron similarly recommends Linux users be
updated through the distribution’s package manager because its built-in
autoUpdater covers macOS/Windows, not Linux. [ELECTRON-UPD]

---

# 17. Updates, staged rollout and self-update security

## 17.1 Update architecture

```text
SOURCE REVISION
→ REPRODUCIBLE / CONTROLLED BUILD
→ IDENTIFIED ARTIFACT + DIGEST
→ SIGN / NOTARIZE AS PLATFORM REQUIRES
→ PUBLISH TO SELECTED CHANNEL
→ STAGED EXPOSURE
→ INSTALL / MIGRATE
→ VERIFY FIELD HEALTH
→ EXPAND OR HALT
```

## 17.2 Store/package-manager path

Use channel-native capabilities for:

- signature/identity verification;
- distribution;
- staged/flighted rollout when available;
- halt/pause controls;
- update adoption telemetry.

Do not assume that store rollback restores local/server state.

## 17.3 Custom desktop updater

A custom updater MUST at minimum verify:

- intended application/product identity;
- artifact integrity;
- trusted release authorization/signature;
- transport security;
- bounded metadata/artifact size;
- atomic or recoverable installation;
- platform code-signing requirements.

For material-risk updaters, additionally protect against:

- rollback to known-vulnerable releases;
- freeze/stale-metadata attacks;
- mix-and-match metadata/artifacts;
- signing-key compromise/rotation;
- mirror/repository compromise;
- wrong-target architecture/product;
- indefinite partial download/resource exhaustion.

TUF explicitly models these attack classes and is the preferred reference for a
high-assurance custom updater. [TUF]

Framework updaters are useful mechanisms, not complete threat models. Tauri,
for example, requires signed updater artifacts and production TLS.
[TAURI-UPD]

## 17.4 Runtime executable-code updates

Before adopting OTA/hot-code/plugin delivery, pass two gates:

**Gate A — platform policy:** is this allowed in the target distribution
channel? Apple App Review 2.5.2 currently restricts downloading/installing/
executing code that changes app functionality. [APPLE-REVIEW] Android warns
that many remote dynamic-code-loading patterns violate Play policy.
[ANDROID-DCL]

**Gate B — security:** who authorizes the code, how is integrity/freshness
verified, what capabilities does it receive, and how is it revoked/recovered?

Content/config updates are not automatically equivalent to executable-code
updates.

## 17.5 Forced/minimum version

A forced update MAY be justified by:

- exploitable security defect;
- incompatible backend contract;
- corruption/safety issue;
- binding platform/regulatory change.

It SHOULD NOT be the default substitute for backward compatibility.

Provide:

- reason;
- grace/emergency behavior where safe;
- supported update path;
- offline behavior;
- user data preservation;
- accessibility of the blocking experience.

---

# 18. Local schema, data and compatibility migrations

## 18.1 Binary and data are separate version axes

```text
APP VERSION ≠ LOCAL SCHEMA VERSION ≠ SYNC PROTOCOL VERSION ≠ SERVER VERSION
```

Compatibility must be reasoned over all four.

## 18.2 Expand / migrate / contract

For durable local or remote state:

```text
1. INTRODUCE COMPATIBLE NEW FORM
2. NEW CODE READS OLD + NEW AS NEEDED
3. MIGRATE / BACKFILL IN BOUNDED, RESTARTABLE STEPS
4. VERIFY INVARIANTS / COUNTS / CHECKSUMS
5. STOP OLD WRITERS/READERS
6. CONTRACT / DELETE OLD FORM LATER
```

## 18.3 Local migration requirements

- source versions supported are explicit;
- migration is deterministic and tested with representative real datasets;
- interruption midway is safe or recoverable;
- free disk requirements are known where copy/rewrite occurs;
- credentials/keys remain accessible after package/signing changes;
- backup/export/repair policy is explicit;
- failure never silently initializes an empty store over recoverable user data.

## 18.4 Rollback decision

Rollback is safe only if the older binary can interpret every durable state and
external side effect produced by the newer version.

Otherwise prefer:

- forward fix;
- compatibility shim;
- data repair;
- feature kill;
- server-side mitigation.

---

# 19. Version and support compatibility

Maintain a matrix:

| Dimension | Minimum | Current | Test obligation | Retirement trigger |
|---|---|---|---|---|
| OS version | defined | defined | oldest + current + representative intermediates | usage/risk/platform support |
| CPU architecture | defined | defined | production artifacts | channel/platform support |
| client version | defined | latest | oldest supported ↔ current backend | compatibility/security |
| local schema | defined | latest | every supported migration path | client adoption |
| sync protocol | defined | latest | old/new coexistence | fleet adoption |
| backend API | defined | current | backward compatibility | client adoption window |

Do not remove server behavior merely because a new client was submitted to a
store.

---

# 20. Verification and testing strategy

## 20.1 Test from failure modes, not framework layers

Required portfolio is risk-dependent and MAY include:

- pure domain/unit/property tests;
- database migration tests;
- repository/offline/sync integration tests;
- contract tests against backend API;
- lifecycle/process-death tests;
- native permission/capability tests;
- UI/assistive-technology tests;
- packaging/signing/install/update tests;
- real-device performance/resource tests;
- security tests for deep links/files/IPC/WebView/update channels;
- staged production verification.

## 20.2 Canonical scenario matrix

- [ ] Fresh install on every supported OS family/architecture.
- [ ] Upgrade from every supported source version (at minimum N-1 plus oldest still-supported migration path).
- [ ] Interrupted package download/install and device/process restart during update.
- [ ] Process death during idle, navigation, edit, save, upload/download, sync, migration and background work.
- [ ] Cold start with missing/corrupt cache, stale sync metadata and partially completed outbox.
- [ ] Offline launch, offline read, offline write (if supported), reconnect and conflict.
- [ ] Slow/flaky network, timeout, TLS/DNS/service failure, duplicate response and reordered delivery.
- [ ] Authentication expiry during foreground and background work; re-auth without corrupting local intent.
- [ ] Permission denied, denied permanently/restricted, one-time grant, revocation while app is installed.
- [ ] Low disk, low memory/process pressure, battery saver, sleep/standby and thermal/resource throttling where testable.
- [ ] Clock/timezone/locale/calendar and daylight-saving changes.
- [ ] Screen rotation/size-class/window resize; desktop multiple windows/monitors/DPI/scaling.
- [ ] Keyboard-only, screen reader/VoiceOver/Narrator/TalkBack, text scaling/high contrast/reduced motion as applicable.
- [ ] Malformed and hostile deep links, file inputs, protocol activation and IPC messages.
- [ ] Multiple app instances/processes touching shared state where supported.
- [ ] Backend rollout while old client remains installed; new client against backward-compatible service.
- [ ] Staged release stop condition and rollback/roll-forward rehearsal.
- [ ] Signing/notarization/store submission path using production-equivalent artifacts.


## 20.3 Real devices vs simulators

Simulators/emulators are strong for fast deterministic development feedback.
They are insufficient as the sole evidence for:

- process/resource pressure;
- camera/sensor/hardware behavior;
- power/background scheduling;
- secure hardware/credential storage;
- real push notifications;
- store/package signing;
- device-specific rendering/performance;
- some assistive technologies;
- enterprise/security policy interactions.

Material platform behavior requires representative physical-device evidence.

## 20.4 Process-death test pattern

For each durable workflow:

1. start action;
2. terminate process at each meaningful state boundary;
3. relaunch;
4. reconstruct durable intent/state;
5. resume or safely surface required user action;
6. verify no duplicate external side effect;
7. verify UI reflects authoritative state;
8. verify telemetry can explain the recovery.

---

# 21. Observability and field quality

## 21.1 Segment first

Every material client signal SHOULD be queryable by:

- app version/build;
- OS version;
- platform;
- device/model class;
- CPU architecture;
- release channel/cohort;
- account/tenant segment only when privacy-safe and decision-relevant.

## 21.2 Core client signals

Select what matters:

```text
STABILITY
- crash-free users/sessions
- startup crash
- ANR/hang/watchdog termination

PERFORMANCE
- cold/warm startup distribution
- frame/render stalls where UI-critical
- memory / low-memory termination
- disk/cache growth

RESOURCE
- battery / wake locks / wakeups
- background network volume
- thermal-sensitive work

STATE / SYNC
- outbox depth + age
- sync latency
- conflict rate
- duplicate/reconciliation repair
- corrupt/migration-failed stores

RELEASE
- install/update success
- adoption by version
- migration failure
- rollback/halt trigger
- minimum-version blocked population

PERMISSIONS / NATIVE
- denied/revoked feature attempts
- capability initialization failure
- deep-link/activation failure
```

Android vitals provides direct field evidence for crash, ANR, memory and
wake-lock behavior and demonstrates why client quality is broader than crash
count alone. [ANDROID-VITALS]

## 21.3 Alerting

A release alert SHOULD answer:

- which version/platform/cohort is affected?;
- which user journey is degraded?;
- is the signal statistically/operationally meaningful?;
- should rollout halt?;
- can a feature be disabled?;
- is binary rollback state-compatible?;
- who owns the decision?

---

# 22. Release and production-readiness gates

## Gate 0 — Scope / criticality

- [ ] platform targets and distribution channels are explicit
- [ ] critical user journeys are defined
- [ ] data/security/privacy consequence is classified
- [ ] offline mode is intentionally selected
- [ ] OS/support horizon is defined

## Gate 1 — Lifecycle / state

- [ ] state inventory exists
- [ ] process death behavior is defined
- [ ] durable user intent survives relevant lifecycle interruption
- [ ] multi-instance semantics are defined where applicable
- [ ] cache can be deleted without violating correctness

## Gate 2 — Network / offline / sync

- [ ] retries are bounded and safe
- [ ] mutations are idempotent/deduplicated where required
- [ ] conflict and delete semantics are explicit
- [ ] auth expiry/account switch during sync is handled
- [ ] offline UX does not claim success that is not durably represented

## Gate 3 — Permissions / security / privacy

- [ ] least-privilege capabilities
- [ ] denied/restricted/revoked states tested
- [ ] local secrets use approved platform protection
- [ ] deep links/files/IPC validated as untrusted input
- [ ] renderer/WebView boundary hardened where applicable
- [ ] telemetry/logs exclude unjustified sensitive data

## Gate 4 — Packaging / signing / update

- [ ] package/application identity correct
- [ ] production signing path controlled
- [ ] notarization/store policy satisfied
- [ ] update artifact/channel integrity verified
- [ ] custom updater threat model completed if applicable
- [ ] binary rollback/data compatibility understood

## Gate 5 — Verification

- [ ] upgrade migrations tested
- [ ] process-death scenarios tested
- [ ] real-device evidence obtained
- [ ] accessibility tested with relevant AT
- [ ] low-resource/network failure tested
- [ ] old-client/new-backend compatibility tested

## Gate 6 — Release

- [ ] staged exposure/cohort defined where available
- [ ] health signals and halt thresholds defined
- [ ] rollout owner named
- [ ] feature kill / roll-forward / rollback path defined
- [ ] support/runbook ready

## Gate 7 — Field learning

- [ ] version adoption observable
- [ ] crash/hang/resource/sync signals monitored
- [ ] user-reported state-loss/permission/update defects triaged
- [ ] review trigger fires on OS/store/framework policy change

---

# 23. Plays

## PLAY-MDAE-01 — Select native vs cross-platform boundary

**Objective:** Execute the recurring decision/workflow without hiding platform
semantics.

**Use when:** A new app or major platform expansion is proposed.

**Output:** A documented sharing boundary and platform-specific seams.

**Method:**
1. State the user/system outcome and unacceptable failure.
2. Identify platform/distribution constraints.
3. Classify state, trust boundaries and irreversible side effects.
4. Select the least complex platform-specific/shared mechanism that preserves
   the required invariant.
5. Define failure/restart/denial/old-version behavior.
6. Attach verification evidence proportionate to risk.
7. Record owner, release/rollback implication and revisit trigger.

**Acceptance criteria:**
- [ ] no hidden lifecycle assumption
- [ ] no unowned durable state
- [ ] no unjustified permission or privileged bridge
- [ ] failure/recovery path is observable
- [ ] current platform policy checked where applicable

## PLAY-MDAE-02 — Design lifecycle and state ownership

**Objective:** Execute the recurring decision/workflow without hiding platform
semantics.

**Use when:** A feature owns non-trivial local state or long-running work.

**Output:** State inventory, lifecycle survival matrix and restart behavior.

**Method:**
1. State the user/system outcome and unacceptable failure.
2. Identify platform/distribution constraints.
3. Classify state, trust boundaries and irreversible side effects.
4. Select the least complex platform-specific/shared mechanism that preserves
   the required invariant.
5. Define failure/restart/denial/old-version behavior.
6. Attach verification evidence proportionate to risk.
7. Record owner, release/rollback implication and revisit trigger.

**Acceptance criteria:**
- [ ] no hidden lifecycle assumption
- [ ] no unowned durable state
- [ ] no unjustified permission or privileged bridge
- [ ] failure/recovery path is observable
- [ ] current platform policy checked where applicable

## PLAY-MDAE-03 — Design offline and synchronization behavior

**Objective:** Execute the recurring decision/workflow without hiding platform
semantics.

**Use when:** Users may read/write while connectivity is unreliable.

**Output:** Offline mode, source-of-truth model, outbox, conflict/delete and reconciliation protocol.

**Method:**
1. State the user/system outcome and unacceptable failure.
2. Identify platform/distribution constraints.
3. Classify state, trust boundaries and irreversible side effects.
4. Select the least complex platform-specific/shared mechanism that preserves
   the required invariant.
5. Define failure/restart/denial/old-version behavior.
6. Attach verification evidence proportionate to risk.
7. Record owner, release/rollback implication and revisit trigger.

**Acceptance criteria:**
- [ ] no hidden lifecycle assumption
- [ ] no unowned durable state
- [ ] no unjustified permission or privileged bridge
- [ ] failure/recovery path is observable
- [ ] current platform policy checked where applicable

## PLAY-MDAE-04 — Introduce a permission or OS capability

**Objective:** Execute the recurring decision/workflow without hiding platform
semantics.

**Use when:** A feature needs camera/location/mic/files/notifications/background/etc.

**Output:** Just-in-time request, denial/revocation behavior, least privilege and policy evidence.

**Method:**
1. State the user/system outcome and unacceptable failure.
2. Identify platform/distribution constraints.
3. Classify state, trust boundaries and irreversible side effects.
4. Select the least complex platform-specific/shared mechanism that preserves
   the required invariant.
5. Define failure/restart/denial/old-version behavior.
6. Attach verification evidence proportionate to risk.
7. Record owner, release/rollback implication and revisit trigger.

**Acceptance criteria:**
- [ ] no hidden lifecycle assumption
- [ ] no unowned durable state
- [ ] no unjustified permission or privileged bridge
- [ ] failure/recovery path is observable
- [ ] current platform policy checked where applicable

## PLAY-MDAE-05 — Protect local secrets and sensitive data

**Objective:** Execute the recurring decision/workflow without hiding platform
semantics.

**Use when:** Credentials/keys/sensitive records are stored locally.

**Output:** Data classification, platform secret store, file/DB controls, backup/log policy.

**Method:**
1. State the user/system outcome and unacceptable failure.
2. Identify platform/distribution constraints.
3. Classify state, trust boundaries and irreversible side effects.
4. Select the least complex platform-specific/shared mechanism that preserves
   the required invariant.
5. Define failure/restart/denial/old-version behavior.
6. Attach verification evidence proportionate to risk.
7. Record owner, release/rollback implication and revisit trigger.

**Acceptance criteria:**
- [ ] no hidden lifecycle assumption
- [ ] no unowned durable state
- [ ] no unjustified permission or privileged bridge
- [ ] failure/recovery path is observable
- [ ] current platform policy checked where applicable

## PLAY-MDAE-06 — Package, sign and distribute

**Objective:** Execute the recurring decision/workflow without hiding platform
semantics.

**Use when:** A new channel/platform or signing identity is introduced.

**Output:** Controlled artifact, signing chain, package identity, channel and recovery record.

**Method:**
1. State the user/system outcome and unacceptable failure.
2. Identify platform/distribution constraints.
3. Classify state, trust boundaries and irreversible side effects.
4. Select the least complex platform-specific/shared mechanism that preserves
   the required invariant.
5. Define failure/restart/denial/old-version behavior.
6. Attach verification evidence proportionate to risk.
7. Record owner, release/rollback implication and revisit trigger.

**Acceptance criteria:**
- [ ] no hidden lifecycle assumption
- [ ] no unowned durable state
- [ ] no unjustified permission or privileged bridge
- [ ] failure/recovery path is observable
- [ ] current platform policy checked where applicable

## PLAY-MDAE-07 — Release an application update

**Objective:** Execute the recurring decision/workflow without hiding platform
semantics.

**Use when:** A production binary will be exposed to users.

**Output:** Compatibility check, migration evidence, staged rollout, health gates and halt/recovery path.

**Method:**
1. State the user/system outcome and unacceptable failure.
2. Identify platform/distribution constraints.
3. Classify state, trust boundaries and irreversible side effects.
4. Select the least complex platform-specific/shared mechanism that preserves
   the required invariant.
5. Define failure/restart/denial/old-version behavior.
6. Attach verification evidence proportionate to risk.
7. Record owner, release/rollback implication and revisit trigger.

**Acceptance criteria:**
- [ ] no hidden lifecycle assumption
- [ ] no unowned durable state
- [ ] no unjustified permission or privileged bridge
- [ ] failure/recovery path is observable
- [ ] current platform policy checked where applicable

## PLAY-MDAE-08 — Migrate local schema/state

**Objective:** Execute the recurring decision/workflow without hiding platform
semantics.

**Use when:** Durable local format changes.

**Output:** Forward path, coexistence assumptions, crash-safe migration, validation and recovery.

**Method:**
1. State the user/system outcome and unacceptable failure.
2. Identify platform/distribution constraints.
3. Classify state, trust boundaries and irreversible side effects.
4. Select the least complex platform-specific/shared mechanism that preserves
   the required invariant.
5. Define failure/restart/denial/old-version behavior.
6. Attach verification evidence proportionate to risk.
7. Record owner, release/rollback implication and revisit trigger.

**Acceptance criteria:**
- [ ] no hidden lifecycle assumption
- [ ] no unowned durable state
- [ ] no unjustified permission or privileged bridge
- [ ] failure/recovery path is observable
- [ ] current platform policy checked where applicable

## PLAY-MDAE-09 — Diagnose lifecycle/sync corruption

**Objective:** Execute the recurring decision/workflow without hiding platform
semantics.

**Use when:** Users report missing, duplicated, stale or reverted local data.

**Output:** Reconstructed state transitions, root mechanism, repair and regression test.

**Method:**
1. State the user/system outcome and unacceptable failure.
2. Identify platform/distribution constraints.
3. Classify state, trust boundaries and irreversible side effects.
4. Select the least complex platform-specific/shared mechanism that preserves
   the required invariant.
5. Define failure/restart/denial/old-version behavior.
6. Attach verification evidence proportionate to risk.
7. Record owner, release/rollback implication and revisit trigger.

**Acceptance criteria:**
- [ ] no hidden lifecycle assumption
- [ ] no unowned durable state
- [ ] no unjustified permission or privileged bridge
- [ ] failure/recovery path is observable
- [ ] current platform policy checked where applicable

## PLAY-MDAE-10 — Emergency halt / minimum-version response

**Objective:** Execute the recurring decision/workflow without hiding platform
semantics.

**Use when:** A released version is unsafe or materially broken.

**Output:** Distribution halt, feature kill/compatibility response, communication and verified safe successor.

**Method:**
1. State the user/system outcome and unacceptable failure.
2. Identify platform/distribution constraints.
3. Classify state, trust boundaries and irreversible side effects.
4. Select the least complex platform-specific/shared mechanism that preserves
   the required invariant.
5. Define failure/restart/denial/old-version behavior.
6. Attach verification evidence proportionate to risk.
7. Record owner, release/rollback implication and revisit trigger.

**Acceptance criteria:**
- [ ] no hidden lifecycle assumption
- [ ] no unowned durable state
- [ ] no unjustified permission or privileged bridge
- [ ] failure/recovery path is observable
- [ ] current platform policy checked where applicable


---

# 24. Canonical checklists and templates

## 24.1 Application architecture review

- [ ] User outcome and unacceptable failure explicit
- [ ] Native/cross-platform sharing boundary justified
- [ ] Platform-specific seams named
- [ ] App/process/window lifecycle modeled
- [ ] State taxonomy/source of truth documented
- [ ] Offline mode selected
- [ ] Sync/conflict/delete semantics documented
- [ ] Permission/capability boundaries documented
- [ ] Deep-link/file/IPC trust boundaries documented
- [ ] Accessibility model verified
- [ ] Package/signing/distribution channel explicit
- [ ] Update/migration/rollback compatibility designed
- [ ] Field quality signals defined
- [ ] Minimum OS/client/backend support policy defined

## 24.2 Offline/sync review

- [ ] Local durable source/read model identified
- [ ] Unsynced user intent is durably represented
- [ ] Operation IDs/idempotency defined
- [ ] Remote revision/version model defined
- [ ] Duplicate delivery safe
- [ ] Reordering safe
- [ ] Delete/tombstone semantics explicit
- [ ] Conflict policy appropriate to domain
- [ ] Device clock not assumed authoritative without justification
- [ ] Retry budget/backoff defined
- [ ] Auth expiry/account switch handled
- [ ] Outbox age/sync lag/conflicts observable
- [ ] Repair/reconciliation path exists

## 24.3 Permission/capability review

- [ ] Capability is necessary for a user-visible outcome
- [ ] Narrower system picker/portal/permission considered
- [ ] Requested in context
- [ ] Purpose explanation accurate
- [ ] Denied/restricted/partial state usable
- [ ] Revocation after grant handled
- [ ] Background/continuous access justified separately
- [ ] Store/privacy disclosure impact checked
- [ ] Telemetry does not expose protected data unnecessarily

## 24.4 Packaging/signing record

```yaml
app:
platform:
package_or_bundle_id:
channel:
artifact_format:
artifact_digest:
build_revision:
builder_identity:
signing_identity:
notarization_or_store_submission:
entitlements_or_capabilities:
upload_identity:
release_approver:
key_compromise_runbook:
```

## 24.5 State inventory

```yaml
- id:
  meaning:
  source_of_truth:
  writers:
  readers:
  lifetime:
  storage:
  process_death:
  reboot:
  update:
  account_logout:
  sync:
  secret_or_sensitive:
  migration:
  deletion:
  recovery:
```

## 24.6 Compatibility matrix

```markdown
| Client | OS | Local schema | Sync/API protocol | Backend range | Upgrade path | Status |
|---|---|---|---|---|---|---|
```

## 24.7 Release/update checklist

- [ ] Correct source revision/artifact identified
- [ ] Production signature/notarization/store identity verified
- [ ] Store/platform policy freshness checked
- [ ] Local migration tested from supported source versions
- [ ] Old-client/new-backend compatibility verified
- [ ] Runtime-delivered code policy checked if applicable
- [ ] Custom updater authenticity/freshness/rollback controls verified
- [ ] Staged cohort defined
- [ ] Crash/hang/sync/migration/update health signals defined
- [ ] Halt threshold and owner defined
- [ ] Rollback state compatibility verified or roll-forward chosen
- [ ] Release notes/support path ready
- [ ] Post-release verification performed

---

# 25. Anti-patterns to actively resist

## “Mobile is just a responsive web app in a wrapper.”

**Why it fails:** Wrappers inherit OS lifecycle, permissions, signing, store, deep-link, background and native-bridge obligations.

## “Native is always better.”

**Why it fails:** Native can maximize platform fidelity but duplicates implementation and skills; share when shared semantics are real.

## “Cross-platform is always cheaper.”

**Why it fails:** Shared code can reduce duplication while creating bridge, plugin, debugging, release and platform-tail complexity.

## “One codebase means one behavior.”

**Why it fails:** OS, hardware, accessibility, lifecycle and distribution semantics remain different.

## “If the app is not visible, it can keep working normally.”

**Why it fails:** Mobile systems restrict/terminate background work; desktop systems can be throttled, slept or killed.

## “The background job runs at 03:00.”

**Why it fails:** General background schedulers are opportunistic; exact alarms are specialized and costly.

## “Network connected = server reachable.”

**Why it fails:** Captive portals, DNS, auth, TLS, route and service failures remain.

## “Last write wins solves sync.”

**Why it fails:** It silently loses concurrent edits and assumes a meaningful ordering; use only when domain semantics permit.

## “We use secure storage, so all local data is secure.”

**Why it fails:** Secret stores protect keys/credentials; app databases/files need separate classification and protection.

## “A signed update is a secure updater.”

**Why it fails:** Signatures do not alone prevent rollback/freeze/mix-and-match or compromised-key abuse.

## “Rolling back the app rolls back the release.”

**Why it fails:** Newer code may already have changed local/server state incompatibly.

## “Permissions are requested once during onboarding.”

**Why it fails:** Context, denial, revocation and policy changes make permissions dynamic product state.

## “A universal/deep link is trusted because the domain is ours.”

**Why it fails:** Parameters remain external input; authorization still applies.

## “Store review/notarization means our app is secure.”

**Why it fails:** Those are scoped distribution controls, not product assurance.

## “The sandbox means a compromised desktop app cannot hurt users.”

**Why it fails:** Granted capabilities, IPC, user files, tokens and network access can still create material impact.

## “WCAG is enough for native accessibility.”

**Why it fails:** Native applications also require platform accessibility semantics and real assistive-technology testing.

## “Simulator tests are enough.”

**Why it fails:** They miss hardware, process pressure, power, store/signing and real assistive-technology behavior.

## “A clean install proves update safety.”

**Why it fails:** Existing users carry historical state, caches, credentials, schema versions and old permissions.

## “Hot updates avoid app-store friction.”

**Why it fails:** Remote executable-code delivery can violate platform policy and introduces update-system security risk.

## “Local DB is just a cache.”

**Why it fails:** Once offline writes or unsynced user work exist, it can hold authoritative pending intent.

## “Client-side feature flags are authorization.”

**Why it fails:** A modified client can ignore flags; privileged actions require trusted enforcement.

## “Jailbreak/root detection makes the client trusted.”

**Why it fails:** Device-state checks can be bypassed and should not replace server-side authorization.

## “Desktop users will close the app cleanly.”

**Why it fails:** Power loss, OS restart, Task Manager/kill signals and crashes are normal failure inputs.

## “We can drop old API behavior immediately after releasing a new app.”

**Why it fails:** Client update adoption is asynchronous; old clients persist.

## “More telemetry is safer.”

**Why it fails:** Unbounded logs raise cost, privacy exposure and noise; collect decision-relevant signals.


---

# 26. Platform profiles

These profiles contain **volatile implementation constraints**, not universal
architecture doctrine.

## 26.1 Apple mobile (iOS/iPadOS)

**Lifecycle**
- foreground/background state materially changes available resources;
- scene lifecycle is the modern UI lifecycle model;
- general background tasks are system-scheduled and can be interrupted.
  [APPLE-LIFE] [APPLE-BG]

**State**
- use restorable scene/session mechanisms only for lightweight UI continuity;
- durable model data belongs in durable application storage. [APPLE-STATE]

**Permissions/privacy**
- ask for protected resources when the feature needs them;
- provide purpose strings and fallback when access is not granted.
  [APPLE-PRIV]

**Secrets**
- Keychain is the platform facility for small secrets/keys/certificates.
  [APPLE-KEYCHAIN]

**Links**
- Universal Links use associated-domain verification but remain an input attack
  vector; validate parameters and constrain sensitive side effects.
  [APPLE-LINKS]

**Distribution**
- App Store channel owns distribution/update mechanics;
- executable-code delivery is constrained by current App Review policy.
  [APPLE-REVIEW]

## 26.2 Android

**Lifecycle**
- app process lifetime is OS-controlled;
- process kill may occur without `onDestroy()`. [ANDROID-LIFE]

**State**
- ViewModel/saved-state APIs and durable local storage serve different
  lifetimes; large/important model state belongs in persistence.
  [ANDROID-STATE]

**Offline/sync**
- Android’s reference architecture supports local readable sources, queues,
  lazy writes, sync and WorkManager. Treat LWW as contextual.
  [ANDROID-OFFLINE]

**Background**
- WorkManager is the default persistent-work mechanism for work that should
  survive app exit/reboot and supports constraints/flexible scheduling.
  [ANDROID-WORK]

**Permissions**
- denial/revocation/automatic reset are normal; one-time permission revocation
  may terminate the process. [ANDROID-PERM]

**Secrets**
- Android Keystore supports non-exportable key material and optional
  hardware-backed enforcement. [ANDROID-KEYSTORE]

**Packaging/signing**
- Play uses AAB as publishing format for new apps and Play App Signing manages
  app-signing keys while developers use an upload key. [ANDROID-AAB]
  [ANDROID-SIGN]

**Links**
- verified App Links bind website domain and app signing identity; still
  validate action parameters. [ANDROID-LINKS]

**Quality**
- crashes, ANRs, memory and wake-lock behavior are current Android vitals
  concerns. [ANDROID-VITALS]

## 26.3 macOS

**Distribution**
- Mac App Store: Apple-hosted update/distribution; App Sandbox required.
- Direct: Developer ID signing + notarization; developer owns distribution and
  updater. [APPLE-DIST] [APPLE-NOTARY]

**Security**
- App Sandbox/entitlements should be least privilege;
- direct-distribution update infrastructure is part of the product security
  boundary.

**Desktop semantics**
- user files, multiple windows, keyboard/menu behavior, background/login items
  and broad integrations require explicit platform design.

## 26.4 Windows

**Lifecycle**
- Windows App SDK desktop apps are running/not-running rather than UWP-style
  suspended/resumed, but unexpected shutdown/sleep/OS update/process kill
  remain normal failure inputs. [WIN-LIFE]

**Packaging**
- MSIX provides package identity, signing and block-hash integrity plus
  platform update options. [WIN-MSIX]

**Distribution**
- Store MSIX, direct MSIX/App Installer and unpackaged paths have different
  signing/update ownership. [WIN-DIST] [WIN-UPDATE]

**Credentials**
- Credential Locker is an OS-managed credential facility available to multiple
  desktop frameworks. [WIN-CRED]

**Accessibility**
- use UI Automation semantics, keyboard support, screen readers, text/display
  scaling and high-contrast support. [WIN-A11Y]

## 26.5 Linux desktop

There is no single Linux packaging/update model.

**Default rule:** choose an explicit ecosystem/channel and let that channel own
installation/update when possible. Flatpak illustrates strong sandbox defaults,
scoped permissions and repository-based update distribution. [FLATPAK]

If distributing AppImage/tarball/custom installer with a self-updater, the
publisher owns updater security and MUST apply §17.

## 26.6 Electron-like web-runtime desktop

- only load secure/trusted content where possible;
- remote content MUST NOT receive Node/native privileges by default;
- context isolation + process sandboxing;
- restrictive CSP;
- restrict navigation/new windows;
- validate IPC sender and payload;
- keep Electron current;
- sign production packages;
- use OS/package-manager/update mechanisms appropriately.
  [ELECTRON-SEC] [ELECTRON-UPD]

## 26.7 Tauri-like webview/native-core desktop

- model WebView↔Rust/native core as a trust boundary;
- expose minimum commands/capabilities;
- restrict remote content/CSP;
- updater signatures/TLS are required by the framework, but high-assurance
  updater threat modeling still follows §17.
  [TAURI-SEC] [TAURI-UPD]

---

# 27. Volatile platform watchlist — snapshot 2026-09-27

This section is intentionally dated and MUST NOT become evergreen doctrine.

| Item | Current snapshot | Review trigger |
|---|---|---|
| Google Play mobile target | New apps/updates: Android 16 / API 36 from 2026-08-31; extension path exists to 2026-11-01 | annual Android/Play policy update |
| Apple executable-code policy | App Review Guideline 2.5.2 currently restricts code downloaded/installed/executed to add/change functionality | App Review Guidelines update |
| Windows MSIX docs | MSIX current docs updated 2026-04-15; package must be signed and includes block hashes | Windows packaging/platform change |
| TUF stable spec index | v1.0.36 listed in current specification index | TUF release |
| Tauri updater | current v2 updater requires signed artifacts and production TLS; recent updater releases continue evolving downgrade controls | plugin/security release |
| Android vitals | crashes, ANRs, memory and excessive partial wake locks are current core quality signals; numerical thresholds can change | Play quality policy update |

Sources: [PLAY-TARGET] [APPLE-REVIEW] [WIN-MSIX] [TUF] [TAURI-UPD]
[ANDROID-VITALS]

---

# 28. Metrics and decision use

Do not create one “app quality score.”

| Signal | Decision |
|---|---|
| crash/hang/ANR by version | halt/expand rollout, prioritize defect |
| startup/rendering distribution | performance regression decision |
| sync backlog age | service/client incident or retry-policy decision |
| conflict/reconciliation rate | revisit sync model |
| migration failure rate | halt rollout / ship repair |
| update adoption | backend compatibility retirement timing |
| permission-denied journey completion | redesign permission/fallback |
| battery/resource signal | background-work/resource remediation |
| accessibility regression | block release for affected critical flow |
| support volume by version/device | device/OS targeting or hotfix decision |

For each metric define denominator, platform/version segments, data quality,
privacy treatment and threshold/use. Metric counts without a decision are
telemetry debt.

---

# 29. Governance, maintenance and review triggers

Event-triggered review is mandatory when:

- Apple/Google/Microsoft/Linux distribution policy changes;
- target SDK/API or minimum OS support requirement changes;
- signing/notarization/key-management mechanism changes;
- framework major version changes lifecycle/bridge/updater behavior;
- a critical dependency/updater/runtime security advisory lands;
- store review rejects a relied-on technique;
- OS release changes background/permission/storage semantics;
- real field data shows process-death, migration, sync or resource failure;
- minimum client/backend compatibility window changes.

Disposition after review:

- retain;
- refresh;
- partial update;
- full update;
- deprecate/withdraw;
- watch.

---

# 30. Definition of Ready

A mobile/desktop application initiative is ready for detailed implementation
when:

- [ ] product outcome and critical journeys are known
- [ ] target platforms and distribution channels are known
- [ ] criticality/assurance level is assigned
- [ ] native/cross-platform sharing boundary is an explicit hypothesis
- [ ] lifecycle interruption model is understood
- [ ] state classes/sources of truth are identified
- [ ] offline mode is selected
- [ ] permission/capability needs are identified
- [ ] signing/update ownership is understood
- [ ] backend compatibility horizon is known
- [ ] accessibility requirements are included
- [ ] platform/store freshness sources are mapped

---

# 31. Definition of Done

A production application/release is done only when all applicable conditions
pass:

## Correctness/state
- [ ] durable user intent survives required lifecycle/process failure
- [ ] local invariants and schema migrations verified
- [ ] no duplicate authoritative state without conflict semantics

## Offline/network
- [ ] timeout/retry/idempotency behavior defined
- [ ] offline UX matches actual guarantee
- [ ] sync conflict/delete/reconciliation verified

## Permissions/security/privacy
- [ ] least-privilege capabilities
- [ ] denial/revocation paths verified
- [ ] secret storage appropriate
- [ ] deep-link/file/IPC boundaries validated
- [ ] platform policy/security source current
- [ ] sensitive telemetry/logging reviewed

## UX/accessibility
- [ ] platform input modes work
- [ ] relevant AT tested
- [ ] scaling/high-contrast/system settings respected

## Packaging/release
- [ ] artifact identity/digest known
- [ ] production signing/notarization/store submission verified
- [ ] update path tested
- [ ] binary/state rollback relationship known
- [ ] old-client/new-backend compatibility verified

## Field operations
- [ ] staged-release health signals available
- [ ] crash/hang/resource/sync/migration signals segmented by version
- [ ] halt/feature-kill/roll-forward/rollback ownership clear
- [ ] support/runbook ready

---

# 32. V1 → audit → V2 change record

The V1 falsification audit found 3 BLOCKER, 12 MAJOR and 2 MINOR document
defects. V2 closes each through:

1. routed offline modes rather than offline-first dogma;
2. OS-governed background scheduling and persisted work;
3. separate mobile vs desktop lifecycle profiles;
4. contextual LWW and stronger conflict/version semantics;
5. explicit secret-store vs data-store separation;
6. TUF-informed self-updater threat model;
7. binary vs durable-state rollback separation;
8. a code-sharing spectrum with explicit platform seams;
9. platform-policy gate for runtime executable-code delivery;
10. dynamic permission/revocation handling;
11. deep links as untrusted activation;
12. broader field quality signals;
13. platform-native accessibility/AT requirements;
14. desktop multi-instance/file coordination;
15. hardened WebView/native IPC boundary;
16. volatile current policy facts isolated from evergreen doctrine;
17. Linux distribution/update heterogeneity.

**Status remains `REVIEWED`.** The desk/research audit validates the document’s
construction against current sources, but representative non-author execution
and field/scenario pilots are still required before `TESTED`/`VALIDATED` under
[P00-MPS].

---

# 33. Source register and evidence map

> Sources have different roles. Platform documentation establishes platform
> semantics/policy. Security standards establish control/reference models.
> Framework documentation proves framework mechanisms, not universal
> superiority. Current store rules are volatile and must be rechecked.

| ID | Source | Location | Primary use | Limitation |
|---|---|---|---|---|
| `P00-MPS` | Master Playbook Standard v2.0-RC1 | Uploaded parent standard | Playbook construction, evidence, risk, audit, verification/validation, quality gates. | Stable house parent standard. |
| `P00-SWE` | Universal Software & AI Engineering Master Playbook v2.0 | Uploaded parent standard | Engineering constitution: lifecycle, quality, state, failure, security, privacy, release, maintenance. | Specialist playbook must strengthen, not silently weaken, parent controls. |
| `APPLE-LIFE` | Apple — Managing your app’s life cycle | https://developer.apple.com/documentation/uikit/managing-your-app-s-life-cycle | Foreground/background lifecycle; background apps should minimize work; scene lifecycle. | iOS/UIKit-specific; exact APIs evolve. |
| `APPLE-BG` | Apple — BackgroundTasks | https://developer.apple.com/documentation/backgroundtasks | BGAppRefreshTask/BGProcessingTask; system-scheduled background work and interruption. | iOS-family platform semantics; not a precise scheduler. |
| `APPLE-STATE` | Apple — Restoring your app’s state with SwiftUI / SceneStorage | https://developer.apple.com/documentation/swiftui/restoring-your-app-s-state-with-swiftui | Scene restoration is lightweight; persistence timing is not guaranteed; model data belongs elsewhere. | SwiftUI-specific mechanism; principle generalizes. |
| `APPLE-KEYCHAIN` | Apple — Keychain services | https://developer.apple.com/documentation/security/keychain-services | Secure storage for small secrets, keys, certificates, credentials. | Not a general application database. |
| `APPLE-PRIV` | Apple — Protecting the User’s Privacy | https://developer.apple.com/documentation/uikit/protecting-the-user-s-privacy | Request protected-resource access when needed; purpose strings; fallback when denied. | Apple-specific permission UX. |
| `APPLE-SANDBOX` | Apple — Security / App Sandbox | https://developer.apple.com/documentation/security | macOS App Sandbox restricts access to resources/data and contains damage. | Sandbox is containment, not complete application security. |
| `APPLE-NOTARY` | Apple — Notarizing macOS software before distribution | https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution | Developer ID distribution should be signed/notarized; notarization is automated malware/signing check, not App Review. | macOS direct-distribution specific. |
| `APPLE-DIST` | Apple — Distribution / macOS distribution | https://developer.apple.com/documentation/technologyoverviews/distribution | App Store vs direct macOS distribution, signing/notarization and update ownership. | Distribution rules can change. |
| `APPLE-REVIEW` | Apple — App Review Guidelines | https://developer.apple.com/app-store/review/guidelines/ | Section 2.5.2 constrains downloading/installing/executing code that changes app functionality; background services must match intended purposes. | Fast-moving platform policy; re-check before release. |
| `APPLE-LINKS` | Apple — Supporting universal links in your app | https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app | Verified website-app association; universal-link parameters are an attack vector and must be validated. | Apple-specific implementation. |
| `APPLE-A11Y` | Apple — Supporting VoiceOver in your app | https://developer.apple.com/documentation/uikit/supporting-voiceover-in-your-app | Test real navigation with VoiceOver; accessibility must be verified in use. | One assistive-technology path; broader testing may be needed. |
| `ANDROID-LIFE` | Android — Processes and app lifecycle | https://developer.android.com/guide/components/activities/process-lifecycle | Process lifetime is system-controlled; process can be killed; onDestroy is not guaranteed. | Android-specific lifecycle. |
| `ANDROID-STATE` | Android — Save UI states | https://developer.android.com/topic/libraries/architecture/saving-states | ViewModel, saved state and local durable storage serve different lifetimes; saved state is limited. | Android-specific APIs; taxonomy generalizes. |
| `ANDROID-OFFLINE` | Android — Build an offline-first app | https://developer.android.com/topic/architecture/data-layer/offline-first | Local readable source, queues, synchronization and conflict-resolution patterns. | Android presents LWW as common, not universally safe; this playbook narrows it. |
| `ANDROID-WORK` | Android — Task scheduling / WorkManager | https://developer.android.com/develop/background-work/background-tasks/persistent | Persistent scheduled work can survive app restarts/reboots; work is constrained/flexible, not a universal exact scheduler. | Android-specific. |
| `ANDROID-PERM` | Android — Request runtime permissions | https://developer.android.com/training/permissions/requesting | Permissions can be denied/revoked; one-time permission revocation can terminate the process. | Android-specific. |
| `ANDROID-KEYSTORE` | Android — Android Keystore system | https://developer.android.com/privacy-and-security/keystore | Key material can remain non-exportable and optionally hardware-backed; usage restrictions can be enforced. | Protects keys; compromised app may still be able to invoke permitted operations. |
| `ANDROID-SIGN` | Android — Sign your app / Play App Signing | https://developer.android.com/studio/publish/app-signing | All APKs must be signed; Play App Signing separates app-signing and upload keys and supports key upgrade. | Google Play-specific path differs from other stores/direct distribution. |
| `ANDROID-AAB` | Android — About Android App Bundles | https://developer.android.com/guide/app-bundle | AAB is publishing format; Play generates optimized signed APKs; required for new Play apps since 2021. | Google Play-specific distribution fact. |
| `ANDROID-DCL` | Android — Dynamic Code Loading | https://developer.android.com/privacy-and-security/risks/dynamic-code-loading | Dynamic code raises tampering/code-execution risk; many remote-code patterns violate Play policy. | Policy specifics must be rechecked. |
| `ANDROID-LINKS` | Android — About/Verify App Links | https://developer.android.com/training/app-links/about | Verified association via assetlinks.json and signing certificate fingerprint. | Does not remove need for input validation/authorization. |
| `ANDROID-VITALS` | Android — Android vitals / crashes / ANRs | https://developer.android.com/games/optimize/vitals | Field metrics cover stability, performance, battery and memory; crash/ANR/wake-lock behavior is operational quality. | Thresholds are volatile and should live in watchlist, not evergreen doctrine. |
| `ANDROID-A11Y` | Android — Build accessible apps | https://developer.android.com/guide/topics/ui/accessibility | Accessibility should be designed, developed and tested using platform semantics/tools. | Platform-specific implementation. |
| `PLAY-TARGET` | Google Play — Target API level requirements | https://support.google.com/googleplay/android-developer/answer/11926878 | From 31 Aug 2026, new mobile apps/updates must target Android 16/API 36; existing availability has separate target rules. | Volatile snapshot; use policy rather than fixed number as evergreen rule. |
| `PLAY-POLICY` | Google Play — Target API Level Policy | https://support.google.com/googleplay/android-developer/answer/16561298 | New apps/updates must generally target within one year of latest major Android; existing apps within two years for new-user visibility. | Policy may change. |
| `WIN-LIFE` | Microsoft — App lifecycle for Windows App SDK desktop apps | https://learn.microsoft.com/windows/apps/develop/launch/app-lifecycle | Desktop apps are not UWP-suspended; they run until close/process exit but must handle unexpected shutdown/power/OS termination. | Windows App SDK desktop profile. |
| `WIN-MSIX` | Microsoft — What is MSIX? | https://learn.microsoft.com/windows/msix/overview | MSIX packaging, identity, signing, integrity hashes, clean install/uninstall and update support. | One Windows packaging path; unpackaged apps also exist. |
| `WIN-UPDATE` | Microsoft — Auto-update and repair apps / App Installer | https://learn.microsoft.com/windows/msix/app-installer/auto-update-and-repair--overview | Direct MSIX distributions can configure automatic update/repair behavior. | Windows/MSIX specific. |
| `WIN-DIST` | Microsoft — Choose a distribution path for your Windows app | https://learn.microsoft.com/windows/apps/package-and-deploy/choose-distribution-path | Store, MSIX direct/sideload, packaged/unpackaged paths differ in signing/update ownership. | Fast-moving platform guidance. |
| `WIN-CRED` | Microsoft — Credential Locker for Windows apps | https://learn.microsoft.com/windows/apps/develop/security/credential-locker | Secure credential storage APIs usable from WinUI/WPF/WinForms. | Credential storage, not general durable data. |
| `WIN-A11Y` | Microsoft — Accessibility overview/checklist | https://learn.microsoft.com/windows/apps/design/accessibility/accessibility | UI Automation, keyboard, screen readers, scaling/high contrast and CI regression testing. | Windows-native accessibility profile. |
| `OWASP-MASVS` | OWASP — Mobile Application Security Verification Standard | https://mas.owasp.org/MASVS/ | Security verification baseline spanning storage, crypto, auth, network, platform, code, resilience and privacy. | Mobile-focused; threat model and desktop controls still required. |
| `ELECTRON-SEC` | Electron — Security | https://www.electronjs.org/docs/latest/tutorial/security | Context isolation, sandboxing, restrictive CSP, IPC sender validation, navigation restrictions and current runtime. | Electron-specific; does not replace OS controls. |
| `ELECTRON-UPD` | Electron — autoUpdater | https://www.electronjs.org/docs/latest/api/auto-updater | Built-in updater supports macOS/Windows; Linux generally delegates to package manager; macOS updater requires signing. | Framework-specific. |
| `TAURI-SEC` | Tauri — Security / CSP | https://v2.tauri.app/security/ | Explicit WebView↔core trust boundary, capability controls and CSP guidance. | Tauri-specific. |
| `TAURI-UPD` | Tauri — Updater | https://v2.tauri.app/plugin/updater/ | Updater requires signatures; TLS enforced in production; update permissions are capability-scoped. | Signature alone does not solve freshness/rollback/key-compromise concerns. |
| `TUF` | The Update Framework — Specification / Security | https://theupdateframework.github.io/specification/ | Update-system threat model includes arbitrary install, rollback, freeze, mix-and-match and key-compromise resilience. | Use full TUF or equivalent mechanisms when self-update risk warrants; not mandatory bureaucracy for every channel. |
| `FLATPAK` | Flatpak — Sandbox permissions / repositories | https://docs.flatpak.org/en/latest/sandbox-permissions.html | Default sandbox isolation and least-permission guidance; repository updates can be delivered through package ecosystem. | One Linux distribution model; Linux packaging is heterogeneous. |
| `KMP` | Kotlin Multiplatform — platform-specific APIs/default behavior | https://kotlinlang.org/docs/multiplatform/compose-platform-specifics.html | Shared UI/code still requires platform entry points and platform-specific APIs; sharing is a spectrum. | Vendor documentation proves mechanism, not superiority. |
| `MAUI` | Microsoft — What is .NET MAUI? | https://learn.microsoft.com/dotnet/maui/what-is-maui | Shared C#/XAML codebase across mobile/desktop with access to native platform APIs. | Vendor documentation proves capability, not universal cost/performance benefit. |


## 33.1 Evidence-weighted claims

| Claim | Classification | Confidence | Primary evidence |
|---|---|---|---|
| Process interruption must be designed as normal client behavior | EST | HIGH | [ANDROID-LIFE] [APPLE-LIFE] [WIN-LIFE] |
| Saved UI state is not a substitute for durable domain storage | EST | HIGH | [APPLE-STATE] [ANDROID-STATE] |
| General background work is OS-scheduled/constrained rather than exact | EST | HIGH | [APPLE-BG] [ANDROID-WORK] |
| Permission denial/revocation is a normal application state | EST | HIGH | [APPLE-PRIV] [ANDROID-PERM] |
| Platform secret/key facilities should protect local credentials/keys | EST | HIGH | [APPLE-KEYCHAIN] [ANDROID-KEYSTORE] [WIN-CRED] |
| Offline-first is useful only where product semantics justify it | CTX | HIGH | [ANDROID-OFFLINE] + parent architecture doctrine |
| LWW is one conflict strategy, not a universal default | CTX | HIGH | [ANDROID-OFFLINE] [P00-SWE] |
| Verified app links reduce association ambiguity but still need input validation | EST | HIGH | [APPLE-LINKS] [ANDROID-LINKS] |
| Store/direct distribution changes who owns updater security | EST | HIGH | [APPLE-DIST] [WIN-DIST] [ELECTRON-UPD] |
| Code signing alone does not fully secure a self-updater | EST | HIGH | [TUF] |
| Remote executable-code update is policy-sensitive | REQ/CTX | HIGH | [APPLE-REVIEW] [ANDROID-DCL] |
| Cross-platform sharing is a spectrum with platform-specific seams | EST | HIGH | [KMP] [MAUI] |
| Native accessibility needs platform semantic/AT testing | EST | HIGH | [APPLE-A11Y] [ANDROID-A11Y] [WIN-A11Y] |
| Crash rate alone is not sufficient client field quality | EST | HIGH | [ANDROID-VITALS] |
| Exact Google Play target API number is a volatile requirement | REQ | HIGH at cutoff | [PLAY-TARGET] [PLAY-POLICY] |

---

# 34. Audit / falsification checklist for future revisions

At every major release, actively try to falsify:

- “this applies equally to mobile and desktop”;
- “this framework makes platform behavior identical”;
- “this local state is only a cache”;
- “this callback always runs”;
- “this background job runs on schedule”;
- “this retry is safe”;
- “this timestamp establishes order”;
- “this permission stays granted”;
- “this deep link is trusted”;
- “this signature makes the updater secure”;
- “this older binary can read current state”;
- “this store allows this runtime-delivery mechanism”;
- “this accessibility API mapping works in real AT”;
- “this simulator result represents the physical device”;
- “this current policy/version is still current.”

A future V3 SHOULD be driven by falsified assumptions, platform changes and
field evidence, not by document length.

---

# 35. Final doctrine

If only one page survives:

1. **Model OS lifecycle and interruption before building flows.**
2. **Classify state by lifetime; do not confuse memory, saved UI state,
   durable domain state, sync intent, secrets and cache.**
3. **Choose offline behavior from product need; offline writes require durable
   intent, idempotency, version/conflict/delete semantics and reconciliation.**
4. **Treat permissions as dynamic capabilities and denial/revocation as normal.**
5. **Treat deep links, files, IPC, WebViews and update feeds as trust
   boundaries.**
6. **Use platform secret/key stores for secrets; never ship server secrets in a
   client.**
7. **Share only genuinely shared semantics; keep lifecycle/permission/platform
   differences explicit.**
8. **Use platform accessibility semantics and real assistive-technology tests.**
9. **Treat package identity, signing and distribution channel as security and
   lifecycle state.**
10. **A custom updater needs authenticity, integrity, freshness, anti-rollback
    and recovery proportional to risk; a signature alone is not enough.**
11. **Binary rollback is not data rollback; design migrations and multi-version
    compatibility before release.**
12. **Test process death, upgrade, interruption, permissions, offline conflict,
    low resources and old-client/new-server coexistence.**
13. **Observe real devices by version/platform, including crashes, hangs,
    resource behavior, sync and migration/update failures.**
14. **Keep current store/OS/framework policy in a volatile watchlist and
    re-verify before consequential releases.**
15. **Increase assurance with consequence; never let a framework, store review,
    sandbox or simulator substitute for engineering judgment.**
