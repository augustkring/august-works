# 17 — Cloud, Infrastructure, Networking & IaC — V2.0

## Vendor-neutral evergreen standard for compute, networking, IAM, containers, orchestration, Infrastructure as Code, infrastructure security, reliability and operations

```yaml
document_id: PB-17
title: Cloud, Infrastructure, Networking & IaC
version: 2.0
status: REVIEWED
release_name: Research-Audited Golden Master
artifact_type: domain_capability_playbook
primary_archetype:
  - operating
  - capability
  - decision
  - execution
  - response
inherits:
  - Master Playbook Standard v2.0-RC1
  - Universal Software & AI Engineering Master Playbook v2.0
  - Security Engineering principles
  - Reliability/SRE principles
  - DevOps/CI-CD/Supply-Chain principles
evidence_cutoff: 2026-09-27
research_rigor: R3_CONTROLLED
default_assurance: C2_MATERIAL
critical_overlays:
  - C3_HIGH_ASSURANCE
  - C4_DOMAIN_SPECIFIC
volatility:
  core_principles: MODERATE
  implementation_profiles: FAST
canonical_language: English
normative_language: MUST_SHOULD_MAY
validation_note: >
  Research-audited and mechanically checked. Not labelled VALIDATED until
  representative non-author infrastructure operators execute material plays
  in realistic environments and resulting defects are closed.
```

---

# Executive standard

Infrastructure is not “the cloud account,” “the cluster,” or “the Terraform.” It is the **socio-technical execution environment and control system** that gives software identities, connectivity, compute, policy, configuration, failure domains, recovery paths, operational evidence and economic boundaries.

The durable chain is:

```text
OUTCOME / SERVICE REQUIREMENT
→ WORKLOAD + DATA + THREAT + FAILURE MODEL
→ CRITICALITY / ASSURANCE
→ PLACEMENT + CONTROL OWNERSHIP
→ ADMINISTRATIVE + IDENTITY + NETWORK + COMPUTE BOUNDARIES
→ DECLARATIVE / CONTROLLED DESIRED STATE
→ SUPPLY-CHAIN + POLICY + CHANGE VERIFICATION
→ RUNTIME VERIFICATION
→ USER-RELEVANT RELIABILITY + CAPACITY OPERATIONS
→ INCIDENT / RESTORE / FAILOVER / RECONCILIATION
→ COST + DRIFT + RISK OPTIMIZATION
→ PATCH / UPGRADE / EVOLVE
→ DECOMMISSION / REVOKE / DELETE / PROVE CLOSURE
```

The V2 doctrine is:

> **Build the least complex infrastructure topology that demonstrably satisfies workload requirements and credible threat/failure models. Grant no authority merely because something is “inside” a network. Treat desired state, provider state and observed runtime state as separate evidence. Bound privilege, work, cost and blast radius. Make material change observable and recoverable. Treat redundancy as a hypothesis until restore/failover is exercised. Design recovery so it does not depend entirely on the component that has failed.**

This is an evergreen **standard of outcomes, invariants, decision logic and evidence**. It is deliberately not a catalog of provider services.

---

# 1. Purpose

This playbook operationalizes the playbook-construction and evidence rules of the Master Playbook Standard and the root engineering invariants of the Universal Software & AI Engineering Master Playbook. [S01][S02]

This playbook exists to make infrastructure:

- correct enough for its workload;
- secure by design and default;
- explicitly authorized;
- bounded in blast radius;
- resilient to plausible failure and overload;
- observable enough to diagnose;
- recoverable enough to meet business need;
- reproducible and traceable enough for its risk;
- economical enough to sustain;
- maintainable and portable enough for its expected lifetime;
- auditable enough to establish what was intended, changed and actually running.

The playbook governs the infrastructure lifecycle from placement decision through retirement.

---

# 2. Scope and non-scope

## 2.1 In scope

- public, private and hybrid cloud infrastructure;
- virtual machines and hypervisors;
- containers and container runtimes;
- container orchestration;
- serverless/function/managed execution environments;
- on-premises and colocation compute where the same infrastructure principles apply;
- edge infrastructure where control/recovery/connectivity constraints matter;
- network addressing, routing, DNS, ingress, egress, load balancing and service connectivity;
- human, workload and automation identity;
- secrets, certificates, cryptographic service dependencies and time dependencies;
- administrative hierarchy / landing zones / equivalent foundations;
- IaC, configuration as code, policy as code, GitOps and drift;
- image/build/artifact infrastructure supply chain;
- reliability, capacity, backup, restore, disaster recovery and failover;
- infrastructure observability, operations, incidents, maintenance and upgrades;
- provider dependency, concentration, portability and exit;
- FinOps/resource efficiency;
- infrastructure decommissioning.

## 2.2 Delegated to specialist playbooks

This standard does not replace deeper standards for:

- application architecture;
- databases/data modeling;
- application security;
- privacy/legal compliance;
- software supply-chain implementation;
- software testing;
- API/distributed-system semantics;
- AI/agentic runtime behavior;
- safety certification;
- physical facility engineering.

Where those domains intersect infrastructure, this playbook defines the boundary and minimum infrastructure responsibility.

## 2.3 Physical facilities

Power, cooling, racks, cabling, fire protection, physical access and hardware disposal become material for self-hosted, edge, colocation and private-cloud environments. Their **requirements and dependencies are in scope**; detailed facility engineering is outside this playbook.

---

# 3. How to use this playbook

Use three layers:

1. **Core invariants** — durable rules that should survive provider changes.
2. **Decision frameworks** — choose compute/network/IAM/IaC/recovery mechanisms from constraints.
3. **Implementation profiles** — provider, orchestrator or tool-specific details that can change quickly.

Do not promote an implementation profile into a universal rule.

Examples:

```text
CORE:
No implicit trust from network location.

CONTEXTUAL IMPLEMENTATION:
Kubernetes NetworkPolicy + service identity + L7 policy.

PROVIDER-SPECIFIC PROFILE:
Specific VPC/VNet/firewall/service-mesh controls.
```

---

# 4. Normative and evidence language

## 4.1 Requirement words

- **MUST / MUST NOT** — house-standard requirement. Deviation requires explicit exception/risk ownership.
- **SHOULD / SHOULD NOT** — strong default; deviation is legitimate when context supports it.
- **MAY** — optional mechanism.
- **JUDGMENT REQUIRED** — competent contextual decision; the playbook intentionally does not force one deterministic answer.

## 4.2 Claim taxonomy

- `REQ` — external scoped requirement;
- `EST` — established practice;
- `DEF` — recommended default;
- `CTX` — context-dependent;
- `EMG` — emerging;
- `HOUSE` — internal synthesis;
- `EXP` — experiment;
- `UNK` — material unknown.

Normative strength is not evidence strength.

## 4.3 Evidence lanes

This playbook distinguishes:

- formal/international standards;
- IETF/open technical specifications;
- government security/risk guidance;
- mature operational evidence;
- official technology specifications;
- applied practitioner frameworks;
- local production evidence.

A source is authoritative only for the claims within its scope. ISO does not prove one cloud architecture is optimal. Kubernetes documentation defines Kubernetes behavior, not a universal reason to use Kubernetes. Google SRE supplies mature operating mechanisms, not mandatory topology for every system.

---

# 5. Current-source status at the evidence cutoff

The following freshness points are material to V2:

- **ISO/IEC 27017:2026** is the current cloud-security edition; the 2015 edition is superseded. [S04]
- **ISO/IEC 27018:2025** is the current public-cloud PII guidance. [S05]
- **NIST SP 800-63-4** is final and supersedes SP 800-63-3. [S10]
- **SLSA v1.2** is approved/current. [S20]
- **RFC 9846**, published July 2026, is the current TLS 1.3 RFC and obsoletes RFC 8446 and RFC 5246. [S11]
- **ISO/IEC 19941:2017** remains the current published cloud interoperability/portability standard at the cutoff; **ISO/IEC 19941-1 is under publication**, not yet the published replacement. [S32][S33]
- NIST NCCoE’s **DevSecOps Practices live document** has a September 2026 revision; it is applied/live guidance, not a replacement normative standard. [S19]

Draft/under-publication material can inform watch items but MUST NOT silently replace current published baselines.

---

# 6. Infrastructure domain model

NIST SP 800-145 remains a useful stable vocabulary anchor for cloud service/deployment concepts, while this playbook deliberately covers a broader modern infrastructure boundary. [S03]

## 6.1 The nine planes

| Plane | Question | Examples of state |
|---|---|---|
| Workload | What behavior is being delivered? | services, jobs, functions, agents |
| Compute | Where/how is it executed and isolated? | hosts, VMs, containers, runtimes |
| Network | Who can reach what, by which path? | routes, DNS, edge, firewall, policy |
| Identity/policy | Who/what is the principal and what may it do? | users, workloads, roles, grants |
| Persistence dependency | What state must survive and recover? | disks, object stores, snapshots, backup |
| Control/management | What controls the environment? | provider API, orchestrator, KMS, consoles |
| Delivery/configuration | What declares and changes desired state? | IaC, images, pipeline, policy |
| Observability/operations | How is reality detected and controlled? | logs, metrics, traces, alerts, runbooks |
| Governance/economics | Who owns it and what constraints apply? | tags, cost, residency, contracts, lifecycle |

A design that diagrams only compute and networking is incomplete.

## 6.2 Desired, provider and observed state

Infrastructure has at least three relevant states:

```text
DESIRED STATE
what source/configuration says should exist

PROVIDER / CONTROL-PLANE STATE
what the provider/orchestrator currently records

OBSERVED RUNTIME STATE
what is actually reachable, authorized, running and behaving
```

They can diverge.

IaC verifies desired-state intent. Provider APIs verify provider state. Runtime tests/telemetry verify observed behavior. High assurance uses more than one.

## 6.3 Administrative hierarchy

Every environment needs an explicit administrative structure, whether the platform calls it organization, tenant, management group, folder, account, subscription, project, namespace or another term.

The structure SHOULD make these boundaries intentional:

- production vs non-production;
- business/workload ownership;
- billing/allocation;
- policy inheritance;
- privileged administration;
- audit aggregation;
- quotas;
- network/security boundaries;
- region/jurisdiction where relevant;
- lifecycle/deletion authority.

Administrative containers are control/blast-radius mechanisms, not magical isolation.

---

# 7. Protected invariants

These are the V2 invariants that implementation choices MUST preserve.

1. **No implicit authorization from network location.** [S08][S09]
2. **Every material resource and privileged principal has an owner.**
3. **Every material workload has an explicit source of desired configuration/state.**
4. **Every material privilege is scoped, reviewable and revocable.**
5. **Every material external exposure is intentional and inventoried.**
6. **Every production change has attributable source and execution evidence.**
7. **Every critical dependency has a failure assumption.**
8. **Every recovery plan identifies bootstrap dependencies and recovery authority.**
9. **Every backup claim is separated from restore evidence.**
10. **Every redundancy claim is separated from tested resilience.**
11. **Every IaC claim is separated from actual runtime verification.**
12. **Every high-blast-radius destructive action has stronger authorization/verification.**
13. **Every overloadable shared resource has a bounded policy.**
14. **Every production system has a support/patch/upgrade path.**
15. **Every resource has a retirement path.**
16. **Every material provider dependency has an exit/concentration judgment.**
17. **Every control that claims enforcement is technically enforced, not merely documented.**
18. **Every security/reliability requirement can be traced to evidence proportionate to risk.**

---

# 8. Criticality and assurance model

Use the root engineering levels:

| Level | Typical consequence | Infrastructure posture |
|---|---|---|
| C0 — Experimental | disposable, no material data/users | minimal foundations; explicitly non-production |
| C1 — Ordinary | recoverable inconvenience | normal IAM, IaC/config, monitoring, backup discipline |
| C2 — Material | customer/revenue/sensitive data/important operations | threat model, staged change, restore test, stronger IAM/audit |
| C3 — High assurance | major security/privacy/financial/operational impact | independent review, segregation, formal evidence, DR exercise |
| C4 — Safety/mission critical | severe physical/mission consequence | applicable domain standard governs; specialist assurance |

Infrastructure criticality may exceed workload criticality when a component is shared.

Examples:

- identity plane;
- KMS/root key hierarchy;
- routing core;
- DNS;
- artifact registry;
- CI/CD production deploy identity;
- orchestration control plane;
- shared database/storage;
- provider organization/root account.

## 8.1 Assurance selector

Increase assurance with:

```text
consequence
× exposure
× privilege
× irreversibility
× blast radius
× tenancy/shared dependency
× uncertainty
÷ recoverability
÷ detectability-before-harm
```

This is a reasoning model, not arithmetic.

---

# 9. Shared responsibility and control ownership

CSA Security Guidance v5 and CCM v4.1 provide complementary applied cloud-security and control-assessment views; they are used as secondary operational evidence rather than as proof of one architecture. [S06][S07]

ISO/IEC 27017:2026 emphasizes cloud-specific controls and clarification of responsibilities across customer/provider environments. [S04]

For every material managed service, establish a control-ownership matrix:

| Control | Provider | Customer | Shared | Evidence | Failure/incident owner |
|---|---:|---:|---:|---|---|
| physical facility | | | | | |
| host/hypervisor | | | | | |
| guest/runtime | | | | | |
| network policy | | | | | |
| identity | | | | | |
| data encryption/key | | | | | |
| patching | | | | | |
| logging | | | | | |
| backup/restore | | | | | |
| incident response | | | | | |

A managed service can reduce operated surface. It does **not** remove accountability for the user outcome.

**Anti-pattern:** “Provider manages it, so it is secure/reliable by default.”

---

# 10. Administrative foundation / landing-zone standard

A vendor-neutral landing zone or equivalent foundation SHOULD define, proportionately:

```yaml
administrative_hierarchy:
environment_separation:
identity_federation:
privileged_access:
audit_aggregation:
network_foundation:
dns:
security_baseline:
encryption_key_model:
logging:
backup_recovery:
policy_inheritance:
allowed_regions_or_locations:
resource_metadata:
cost_allocation:
quota_management:
break_glass:
decommission:
```

## 10.1 Rules

- Production SHOULD be separated from lower-trust development/test boundaries in a way that limits accidental privilege and blast radius.
- Shared root/organization administrator capability MUST be tightly controlled.
- Policy inheritance SHOULD be understood before relying on inherited controls.
- Central guardrails MUST have documented exception mechanisms; invisible bypasses are worse than explicit exceptions.
- Foundational automation identities MUST be protected as high-value infrastructure.
- A landing zone is not “done” merely because templates deployed successfully; controls must be verified in effective runtime state.

---

# 11. Workload placement and compute selection

No compute abstraction is universally best.

Possible placements:

- bare metal;
- virtual machine;
- managed VM platform;
- container runtime;
- container orchestrator;
- managed application platform;
- functions/serverless;
- edge/local execution;
- SaaS/external managed capability.

## 11.1 Placement criteria

Evaluate:

- functional/runtime fit;
- isolation boundary;
- latency/geography;
- state/persistence;
- reliability/failure domains;
- elasticity;
- startup/cold-path behavior;
- IAM/security control fit;
- compliance/residency;
- observability/debuggability;
- patch responsibility;
- workload portability;
- provider concentration;
- total cost;
- operator skill;
- expected lifetime/evolution.

FinOps’ current workload-placement capability similarly frames decisions across public cloud, private cloud/data center and other technology categories using business value plus performance, reliability, security, regulatory and cost constraints. [S31]

## 11.2 Decision default

```text
Can a simpler managed execution boundary satisfy the requirements?
  ├─ YES → prefer it unless cost/control/portability/operability argues otherwise
  └─ NO  → Is VM-level control sufficient?
             ├─ YES → VM/managed VM
             └─ NO  → Is orchestration solving a concrete platform/scheduling/isolation need?
                        ├─ YES → evaluate orchestrator
                        └─ NO  → use the smallest runtime that meets the requirement
```

## 11.3 Compute rules

- Runtime/host versions MUST have support/EOL ownership.
- High-risk host access MUST be minimized.
- Base images SHOULD be maintained from controlled sources.
- Image/runtime patching SHOULD prefer repeatable rebuild/replacement where practical; controlled in-place patching remains legitimate when constraints justify it.
- CPU, memory, local storage, file descriptors, connections, processes and accelerators SHOULD have explicit policies where exhaustion creates material risk.
- Overcommit is a capacity decision, not free utilization.
- GPU/accelerator scheduling MUST include capacity, tenancy/isolation, driver/runtime compatibility and failure behavior where material.
- Compute availability claims MUST include host and control-plane failure, not just process restart.

---

# 12. Virtualization and hypervisor standard

NIST SP 800-125A Rev. 1 treats the hypervisor as a mediator of CPU, memory, network and storage resources and a runtime isolation boundary among VMs. [S14]

For VM-based platforms:

- hypervisor management MUST be more restricted than guest administration;
- management network/API exposure MUST be minimized;
- guest-to-host escape risk and device passthrough risk SHOULD be considered for high-risk workloads;
- templates/images MUST have patch and provenance ownership;
- snapshots MUST NOT be mistaken for a complete backup strategy;
- VM migration/live-migration channels and destination trust SHOULD be included in the threat model where used;
- noisy-neighbor/resource overcommit SHOULD be monitored;
- virtual network controls MUST be understood separately from guest firewall controls.

---

# 13. Networking standard

## 13.1 Core network doctrine

```text
REACHABILITY ≠ IDENTITY
IDENTITY ≠ AUTHORIZATION
ENCRYPTION ≠ AUTHORIZATION
SEGMENTATION ≠ AUTHORIZATION
PRIVATE ADDRESS ≠ TRUST
NAT ≠ ACCESS POLICY
```

NIST SP 800-207 explicitly rejects implicit trust based solely on physical/network location or ownership. [S08] NIST SP 800-207A extends that principle to cloud-native service identities. [S09]

## 13.2 Required network model

For C2+ workloads record:

```yaml
address_families:
address_space:
sites_regions_zones:
internet_ingress:
internal_ingress:
egress:
east_west:
dns:
routing:
load_balancing:
service_discovery:
management_access:
transport_security:
ddos_abuse:
provider_edge_dependencies:
mtu_tunneling_overlays:
quotas_limits:
failure_domains:
telemetry:
recovery:
```

## 13.3 Ingress

Every externally reachable endpoint MUST have:

- owner;
- purpose;
- expected protocol/ports;
- authentication/authorization behavior if applicable;
- transport security appropriate to threat/data;
- abuse/resource controls;
- backend exposure model;
- logging;
- rapid revoke/disable path;
- lifecycle/expiry if temporary.

Public exposure is not automatically unsafe; **uncontrolled public exposure** is.

Private exposure is not automatically safe.

## 13.4 Egress

Egress SHOULD be treated as a first-class control where compromise, exfiltration, supply-chain communication or cost abuse is material.

Possible controls:

- destination restrictions;
- proxy/gateway mediation;
- DNS policy;
- network policy;
- provider/service endpoint restrictions;
- rate/volume limits;
- explicit internet-disabled workloads.

Egress allowlists can be brittle. They MUST have an update/incident path if used as a hard control.

## 13.5 DNS

DNS is a production dependency when names drive service discovery, provider APIs, certificates or failover.

Design for:

- authoritative-zone ownership;
- registrar/account security;
- record change controls;
- health/failover semantics;
- TTL and cache behavior;
- split-horizon/private DNS where relevant;
- DNSSEC where threat/operating context justifies it;
- recovery if normal DNS management is unavailable.

A low TTL does not prove fast failover. Test from representative clients/resolvers.

## 13.6 Routing and address management

- Address plans SHOULD avoid predictable future overlap where networks may peer/connect.
- IP address family support MUST be explicit; do not assume IPv4 or IPv6 without requirement.
- Routing changes with large blast radius MUST use controlled review and validation.
- Operators of public interdomain routing SHOULD apply current BGP/source-validation practices suitable to their role; NIST SP 800-189 covers RPKI/origin validation, prefix filtering and DDoS-related controls, while BCP 38 addresses source-address spoofing at ingress. [S12][S13]
- Route propagation, transitive connectivity and asymmetric paths MUST be considered where security policy depends on topology.

## 13.7 MTU and overlays

VPNs, tunnels, overlays and meshes can create path-MTU and fragmentation failures that configuration review does not expose.

Where overlays exist:

- document encapsulation overhead;
- test representative end-to-end packet paths;
- monitor retransmission/connectivity symptoms;
- avoid assuming same MTU across all segments.

## 13.8 Transport security

Transport security MUST use current protocol guidance appropriate to the application and threat model. At the evidence cutoff, RFC 9846 is the current TLS 1.3 RFC. [S11]

Do not hard-code protocol versions forever in the root standard. Implementation profiles MUST track current security recommendations and interoperability requirements.

## 13.9 Network policy default

`DEF / HIGH`: use deny-by-default/allowlist policy for security-sensitive trust boundaries when dependencies can be modeled and operated reliably.

Exceptions can be legitimate where:

- dynamic external dependencies make hard allowlisting operationally unsafe;
- another control provides equivalent risk reduction;
- legacy/protocol limitations exist.

The exception MUST be explicit for C2+ risk.

---

# 14. Human IAM standard

NIST SP 800-63-4 is the current NIST digital identity guideline suite at the cutoff, complemented here by NIST's cloud access-control guidance where infrastructure policy semantics matter. [S10][S35]

## 14.1 Human principal record

```yaml
principal:
identity_source:
employment_or_contract_owner:
authenticator_policy:
mfa:
base_access:
privileged_access:
elevation:
session_constraints:
review_or_expiry:
audit:
offboarding:
```

## 14.2 Rules

- Central federation SHOULD be used for workforce infrastructure access when practical.
- Privileged human access SHOULD use phishing-resistant MFA where feasible and proportionate.
- Shared routine human admin accounts MUST NOT be used.
- Standing broad privilege SHOULD be minimized.
- JIT/time-bound elevation SHOULD be preferred where the environment supports it and operational risk justifies it.
- Privileged and ordinary contexts SHOULD be separable enough to reduce accidental privileged action.
- Offboarding MUST revoke access promptly according to risk.
- Dormant accounts and entitlements SHOULD be detectable.
- Access review MUST examine effective permission, including nested groups, inherited policy, wildcards and delegated admin.

---

# 15. Workload and automation identity

Machine identity is not just “an API key.”

Types:

- workload/service identity;
- node/host identity;
- CI/CD identity;
- IaC/provisioner identity;
- backup/recovery identity;
- monitoring/agent identity.

## 15.1 Rules

- Each machine identity MUST have an owner.
- Identity SHOULD be bound to workload/platform lifecycle.
- Prefer short-lived/federated credentials over duplicated long-lived static credentials where supported.
- Scope identities by environment and resource/action.
- Production deploy/provision identities SHOULD be separate from development identities.
- High-value workload identity issuance is itself a control plane and MUST be protected.
- Credential rotation MUST not create an untested outage path.
- Revocation behavior and propagation delay SHOULD be understood for high-risk systems.

SPIFFE provides an open standard model for workload identities and SVIDs in heterogeneous dynamic infrastructure; it is an implementation option, not a mandate. [S34]

---

# 16. Break-glass and bootstrap identity

## 16.1 The bootstrap problem

A recovery design is defective if:

> recovering IAM requires IAM, recovering the network requires the network, or recovering KMS requires KMS with no independent path.

For C2+ shared critical infrastructure, identify:

```yaml
failed_component:
normal_admin_dependency:
independent_recovery_identity:
independent_recovery_network_path:
required_keys_or_material:
emergency_documentation_location:
approval_or_dual_control:
audit_after_recovery:
credential_rotation_after_use:
last_exercise:
```

## 16.2 Rules

- Break-glass MUST be rare, separately protected and monitored.
- It MUST NOT rely entirely on the same identity/control plane whose failure it addresses.
- Access MUST be scoped to the minimum recovery action practical.
- Use SHOULD trigger incident review and credential reset/rotation where appropriate.
- Emergency documentation MUST remain available during plausible outages without allowing stale copies to become the silent source of truth.

---

# 17. Secrets, keys, certificates and time

## 17.1 Secrets

Secrets SHOULD be:

- external to source code;
- least-privilege scoped;
- short-lived where practical;
- rotatable;
- access-audited;
- excluded from logs/plans/error traces;
- revoked when owners/workloads retire.

Do not treat “environment variable” as a complete secret-management strategy; the important question is lifecycle, exposure and access.

## 17.2 KMS and key hierarchy

For critical encryption/signing:

- document key hierarchy and ownership;
- include KMS availability in dependency/recovery analysis;
- separate high-consequence key administration from routine workload operation where risk warrants;
- define rotation and recovery;
- understand regional/provider/key replication dependencies;
- prevent one ordinary workload credential from administering key policy.

## 17.3 Certificates

Treat certificate lifecycle as infrastructure:

- issuer/trust roots;
- ownership;
- issuance;
- renewal;
- deployment;
- expiry;
- revocation where relevant;
- recovery if issuance service fails.

Expiry alarms that no owner receives are not a control.

## 17.4 Time

Authentication tokens, certificates, logs and distributed systems may depend on correct time.

Where material:

- define trusted time source;
- monitor material skew;
- use monotonic clocks for elapsed local durations when possible;
- include time dependency in incident diagnosis.

---

# 18. Container standard

NIST SP 800-190 provides a container-security baseline, while OCI standardizes image/runtime/distribution behavior. [S15][S16]

## 18.1 Container supply chain

```text
SOURCE
→ BUILD
→ DEPENDENCY / BASE IMAGE RESOLUTION
→ TEST / SCAN
→ IDENTIFIED IMAGE
→ PROVENANCE / SBOM / ATTESTATION AS REQUIRED
→ REGISTRY
→ ADMISSION
→ RUNTIME
→ OBSERVE
→ PATCH / REBUILD
→ RETIRE
```

## 18.2 Image rules

- Production images MUST have an identifiable immutable artifact reference when reproducibility matters.
- Mutable tags MUST NOT be the sole production artifact identity for C2+ systems.
- Base image ownership and update cadence MUST be known.
- Secrets MUST NOT be baked into images.
- Registry access and deletion MUST be controlled.
- Artifact retention SHOULD support rollback/incident for the required horizon.
- Provenance, SBOMs, signatures and scans are **evidence layers**, not proof that the artifact is secure. [S20]

## 18.3 Runtime rules

- Avoid privileged containers unless explicitly required.
- Drop unnecessary OS capabilities.
- Avoid host namespace/device/filesystem access unless justified.
- Run as non-root where workload/platform compatibility supports it.
- Use seccomp/AppArmor/SELinux or equivalent hardening where threat and platform justify it.
- Bound runtime resources where exhaustion is material.
- Containers sharing a kernel MUST NOT be represented as equivalent to a VM security boundary.
- Higher-risk workloads MAY use stronger sandbox/VM-based isolation.

---

# 19. Orchestration standard

An orchestrator is justified by requirements such as:

- scheduling across a pool;
- desired replica reconciliation;
- placement constraints;
- rolling change;
- service discovery;
- workload policy;
- multi-tenant platform capability;
- batch/queue scheduling;
- standardized workload lifecycle.

It also creates:

- control-plane dependency;
- scheduler/policy complexity;
- cluster upgrade burden;
- network overlay;
- secret distribution;
- new authorization model;
- admission/webhook dependencies;
- node lifecycle;
- platform-specific incident modes.

## 19.1 Rules

- Orchestration MUST be adopted for a stated benefit, not prestige.
- Kubernetes MUST NOT be treated as required for scale.
- Control-plane availability/recovery MUST be designed.
- Node upgrades and workload disruption MUST be understood.
- Workload resource policy MUST be explicit.
- Platform policy MUST be technically enforced where it claims to be a hard control.
- Multi-tenancy/isolation MUST be tested against the actual runtime/network/identity controls.
- Cluster backup MUST distinguish workload data from control-plane/configuration data.
- Add-ons/controllers/webhooks are privileged dependencies and belong in the supply-chain/threat model.

---

# 20. Kubernetes implementation profile — versioned, contextual

This section is an implementation profile, not a universal infrastructure mandate.

Current Kubernetes documentation at the cutoff shows several important constraints. [S22]

## 20.1 Pod Security Standards

Kubernetes defines Privileged, Baseline and Restricted profiles. Restricted includes controls such as preventing privilege escalation, non-root expectations, seccomp and capability restrictions, but compatibility varies by workload.

**Rule:** select/enforce the strictest profile that meets workload requirements; exceptions are explicit.

## 20.2 NetworkPolicy

Kubernetes NetworkPolicy:

- primarily controls L3/L4 traffic;
- requires a network plugin that actually enforces it;
- has default-allow behavior when no isolating policy exists;
- is not a TLS/identity/audit system;
- can block DNS if egress is denied without explicit DNS allowance.

**Rule:** test effective connectivity/policy in the chosen CNI implementation.

## 20.3 Requests and limits

Kubernetes scheduling uses resource requests; runtime/cgroups enforce configured limits.

**Rule:** resource settings are workload-specific. “Always set low limits” and “never set limits” are both invalid universals.

Validate:

- OOM behavior;
- CPU throttling;
- node pressure/eviction;
- burst behavior;
- quota;
- failover capacity.

## 20.4 PodDisruptionBudget

PDBs constrain certain voluntary disruptions. They do not prevent all involuntary failures and can be bypassed by some direct deletions.

**Rule:** PDB is maintenance availability control, not DR.

## 20.5 Secrets

Kubernetes Secret objects are not automatically equivalent to an external secret manager or encrypted end-to-end secret lifecycle. Implementations must verify encryption-at-rest, RBAC, delivery, logging and workload exposure.

## 20.6 API/control plane

The API/control plane, kubelet/node access and underlying metadata services are privileged surfaces. Exposure MUST be minimized and audited.

---

# 21. IaC core standard

NIST SP 800-204C recognizes infrastructure, policy and observability as declarative code types in cloud-native DevSecOps. [S17]

## 21.1 IaC is controlled desired state

IaC SHOULD be the canonical desired-state mechanism for material production infrastructure when:

- the platform is programmatically manageable;
- change is repeated;
- audit/review matters;
- reproducibility/consistency benefits exceed tooling cost.

Manual management MAY remain valid for:

- low-risk one-off work;
- unsupported legacy equipment;
- emergency break-glass;
- narrow physical actions.

Manual changes do not waive documentation, authorization or reconciliation.

## 21.2 IaC does not equal reproducibility

Stronger repeatability is:

```text
DECLARATIVE INTENT
+ CONTROLLED INPUTS
+ PINNED / REVIEWED DEPENDENCIES
+ PROTECTED CONSISTENT STATE
+ IDENTIFIED IMAGES / ARTIFACTS
+ CONTROLLED PROVIDER/API VERSIONS WHERE POSSIBLE
+ POLICY / TESTS
+ RUNTIME VERIFICATION
+ DRIFT MANAGEMENT
```

IaC alone cannot control all provider/runtime external state.

## 21.3 IaC change flow

For C2+ material changes:

```text
INTENT
→ CHANGE DESIRED STATE
→ FORMAT / SCHEMA / STATIC VALIDATION
→ SECURITY / POLICY CHECK
→ PLAN / DIFF
→ HUMAN OR POLICY REVIEW
→ RISK APPROVAL IF REQUIRED
→ CONTROLLED APPLY
→ VERIFY PROVIDER STATE
→ VERIFY RUNTIME / SERVICE BEHAVIOR
→ OBSERVE
→ RECORD EVIDENCE / DRIFT / EXCEPTION
```

## 21.4 Plan semantics

A plan/preview is **prediction** based on current tool/provider/state knowledge.

It is not proof of:

- final provider behavior;
- eventual runtime health;
- actual authorization effect;
- application reachability;
- hidden provider mutation;
- migration safety;
- absence of secret leakage.

---

# 22. IaC state, concurrency and recovery

Treat IaC state/backends as production data when they influence destructive/change behavior or contain sensitive metadata.

## 22.1 State rules

- state backend access MUST be least privilege;
- encryption/access/audit SHOULD match sensitivity;
- state locking/concurrency MUST prevent unsafe concurrent writers where the tool requires serialization;
- backup/versioning of state SHOULD be used where corruption/loss creates material recovery risk;
- state migrations/import/removal MUST be controlled;
- secrets in state/plan output MUST be treated as secrets;
- partial apply/failure MUST have a recovery procedure.

## 22.2 Apply concurrency

Define:

```yaml
apply_scope:
locking:
parallelism:
conflicting_pipelines:
manual_apply_policy:
timeout:
retry_policy:
provider_rate_limits:
partial_failure_recovery:
```

“Retry the pipeline” is unsafe if the operation is not idempotent or state reconciliation is unknown.

---

# 23. Drift standard

Drift types:

1. **unauthorized/unexplained**;
2. **break-glass/emergency**;
3. **provider-managed/runtime**;
4. **external-controller-owned**;
5. **intentional migration/transitional**;
6. **stale desired state** — code is wrong, runtime is right.

## 23.1 Rules

- Detect material drift.
- Classify before remediation.
- Do not blindly auto-reconcile unknown drift.
- Break-glass changes MUST return to a documented authoritative desired state.
- If runtime behavior proves the code is wrong, fix desired state rather than forcing the defect back into production.
- Drift age and ownership SHOULD be visible for C2+ systems.

---

# 24. Policy as Code

Policy as code is valuable when a rule is:

- deterministic enough to evaluate;
- repeated often;
- materially important;
- representable without hiding required human judgment.

Examples:

- forbidden public exposure classes;
- required ownership metadata;
- restricted regions;
- disallowed privileged container options;
- minimum logging/encryption controls;
- IAM wildcard restrictions;
- destructive-change gates.

## 24.1 Enforcement levels

```text
ADVISORY → reports only
GATING   → blocks pipeline/admission
RUNTIME  → continuously enforced
```

A warning is not an enforced control.

High-consequence policies SHOULD have:

- versioned rule;
- tests;
- exception mechanism;
- owner;
- failure behavior;
- audit evidence.

---

# 25. GitOps standard

OpenGitOps describes GitOps through declarative state, versioned/immutable storage, automatic pull and continuous reconciliation. [S21]

Classification: `CTX / MODERATE`.

Use GitOps when:

- continuous convergence is valuable;
- pull-based control reduces credential/exposure risk;
- platform supports declarative reconciliation;
- desired state can be represented safely.

Do not require it when:

- infrastructure is low-change/simple;
- target cannot reconcile safely;
- stateful/destructive operations need explicit transactional control;
- emergency operations would become harder/less safe.

GitOps MUST have:

- source authorization;
- reconciler identity;
- policy;
- drift/health visibility;
- pause/suspend capability;
- break-glass path;
- reconciliation after emergency change;
- protection against malicious desired-state commit.

---

# 26. Infrastructure supply chain

NIST SP 800-204D addresses software-supply-chain security in DevSecOps CI/CD; SLSA v1.2 provides source/build provenance tracks and guarantees. [S18][S20]

Infrastructure supply-chain assets include:

- IaC modules/providers/plugins;
- CI actions/plugins;
- container base images;
- OS images;
- Helm/charts/manifests/templates;
- operators/controllers;
- firmware/appliance images where relevant;
- security/policy packages.

## 26.1 Rules

- Dependencies MUST be intentional and owned.
- High-risk dependencies SHOULD be pinned/locked to immutable versions where practical.
- Pinning MUST be paired with monitoring/update, not permanent stasis.
- Provenance SHOULD be retained where artifact tampering/source ambiguity is material.
- SBOM/inventory MAY improve incident/vulnerability response.
- Supplier/service due diligence SHOULD scale with privilege, data, criticality and exit cost.
- A signature proves linkage to a signing identity/key, not that the content is safe.
- A vulnerability scan proves only what the scanner could identify in the examined artifact/context.

---

# 27. Infrastructure security engineering

Use broad control catalogs such as NIST SP 800-53 only as risk-tailored assurance references; a control catalog is not a deployment architecture. [S36]

## 27.1 Threat model

For C2+ environments consider:

```yaml
assets:
human_admins:
workload_identities:
automation_identities:
management_planes:
internet_entry_points:
internal_entry_points:
metadata_services:
network_paths:
secrets_keys_certs:
images_dependencies:
iac_state:
cicd:
observability:
backup_recovery:
provider_support_access:
tenant_boundaries:
likely_abuse_paths:
residual_risk:
verification:
```

## 27.2 Secure defaults

Prefer defaults that:

- deny unnecessary public exposure;
- minimize standing privilege;
- prevent anonymous administration;
- minimize default service surface;
- require explicit production deployment;
- separate production from lower-trust environments;
- enable useful security/audit telemetry;
- make destructive operations difficult to perform accidentally.

Secure defaults must remain operable; operators will bypass controls that make legitimate recovery impossible.

## 27.3 Metadata service protection

Where runtime metadata can yield identity credentials or sensitive configuration, workloads SHOULD have only the minimum metadata access required.

## 27.4 Tenant isolation

For multi-tenant infrastructure:

- identify tenant boundary;
- isolate authorization/resource names;
- bound resource consumption/fairness;
- isolate secrets;
- test cross-tenant negative cases;
- include shared caches/queues/logs/backups in isolation model.

“Namespace” or “project” is not automatically a complete tenant boundary.

---

# 28. Vulnerability, patch and lifecycle management

Covered components include:

- host OS/kernel;
- hypervisor;
- container runtime;
- orchestrator/control plane;
- network/security appliances;
- base/container images;
- IaC providers/modules;
- controllers/operators;
- CI/CD actions;
- firmware where owned;
- managed-service configuration and supported versions.

## 28.1 Prioritization

Patch urgency SHOULD use:

- exploitability/exposure;
- privilege;
- consequence;
- compensating controls;
- vendor support;
- operational risk of change.

“Patch everything immediately” and “never touch stable infrastructure” are both invalid universals.

## 28.2 End of life

Unsupported components MUST have:

- replacement/upgrade plan;
- documented temporary risk acceptance if retained;
- compensating controls where appropriate;
- owner and deadline/trigger.

---

# 29. Reliability and failure-domain engineering

NIST's cyber-resiliency systems guidance reinforces the objective to anticipate, withstand, recover and adapt; V2 uses that as a higher-assurance lens without imposing maximum ceremony on ordinary workloads. [S28]

Google SRE supports user-relevant SLOs, controlled change/canaries and explicit overload engineering. [S23][S24][S25]

## 29.1 Reliability starts with the service

Infrastructure availability is useful only insofar as it protects user/system outcomes.

For each critical user journey:

- define SLI/SLO where appropriate;
- map infrastructure dependencies;
- identify which failure domains can violate it;
- define mitigation/recovery.

Provider SLA ≠ product SLO.

## 29.2 Failure-domain graph

C2+ workloads SHOULD model:

```text
workload
├─ compute host/pool
├─ zone/rack/site
├─ regional control plane
├─ network / DNS
├─ identity
├─ KMS / secrets / certificate service
├─ storage/database
├─ image/artifact registry
├─ CI/CD / IaC
├─ provider organization/account
├─ external SaaS/API
└─ human operational path
```

Mark each dependency:

- independent;
- shared/correlated;
- replicated;
- recoverable;
- bootstrap-critical.

## 29.3 Redundancy vs resilience

Redundancy is architecture.

Resilience requires evidence that the system can:

- detect failure;
- isolate/contain it;
- redirect/recover work;
- preserve integrity;
- operate within capacity;
- recover/fail back;
- be understood by operators.

Therefore:

> **Redundancy is a resilience hypothesis until exercised.**

---

# 30. Multi-zone, multi-region and multi-cloud

## 30.1 Multi-zone

Use when zone/site failure is material and the application/data layer can preserve required behavior.

Test:

- replica placement;
- dependency zonality;
- load balancer behavior;
- surviving capacity;
- quorum/state;
- maintenance/disruption;
- failback.

## 30.2 Multi-region

Use when region/site loss or geography requirement justifies:

- higher cost;
- data replication complexity;
- routing/DNS complexity;
- operational duplication;
- state consistency trade-offs.

Multi-region MUST include:

- regional dependency map;
- data model/RPO;
- traffic shift;
- failover capacity;
- identity/KMS/DNS assumptions;
- failback/reconciliation.

## 30.3 Multi-cloud

Classification: `CTX`.

Multi-cloud can reduce selected provider/concentration risks but adds:

- duplicated IAM;
- networking;
- policy;
- observability;
- skills;
- CI/CD;
- incident paths;
- state replication;
- portability constraints;
- cost.

Adopt it only for a stated requirement such as:

- contractual/customer requirement;
- provider concentration risk that exceeds complexity;
- sovereignty;
- acquisition/organizational reality;
- differentiated capability needed across providers.

Do not buy “resilience” by creating an operating model the team cannot safely run.

---

# 31. Capacity, overload and autoscaling

Overload is a correctness/reliability concern for networked systems. Google SRE describes cascading failure from saturation, queues and retry amplification. [S25]

## 31.1 Capacity model

For material workloads define:

```yaml
normal_load:
peak_load:
growth_assumption:
failover_load:
maintenance_reduced_capacity:
critical_bottlenecks:
provider_quotas:
network_limits:
storage_iops_throughput:
connection_limits:
queue_limits:
autoscaling_signal:
scale_up_latency:
downstream_capacity:
cost_ceiling:
```

## 31.2 Bounded work

Where overload can exhaust the platform:

- bound queues;
- bound concurrency;
- rate/admission control;
- prioritize critical traffic;
- load shed/degrade where safe;
- budget retries;
- test overload behavior.

## 31.3 Autoscaling

Autoscaling MUST NOT be treated as infinite capacity.

Design:

- min/max;
- startup/warm-up time;
- signal quality;
- cooldown/stability;
- quota;
- downstream saturation;
- database/queue/network capacity;
- cost/abuse guardrails;
- failover capacity.

A bad autoscaler can amplify cost and dependency failure.

---

# 32. Backup standard

Backup design MUST identify:

```yaml
protected_state:
source_of_truth:
backup_method:
frequency:
retention:
encryption:
access:
deletion_protection:
immutability_or_independent_copy_if_required:
location_failure_domain:
restore_tooling:
restore_identity:
last_restore_test:
```

## 32.1 Rules

- Snapshot ≠ backup unless it meets recovery/threat requirements.
- Replication ≠ backup; replication can copy corruption/deletion.
- Backup completion ≠ recoverability.
- Backup privilege SHOULD be isolated from ordinary workload/admin paths when ransomware/admin compromise risk justifies it.
- Restore procedures MUST be executable with realistic credentials and dependencies.
- Retention MUST align with privacy/legal/business requirements, not “keep forever.”

---

# 33. RTO, RPO and disaster recovery

ISO/IEC 27031:2025 connects ICT readiness to business continuity and restoration within agreed timeframes, including third-party/cloud dependencies. [S27]

## 33.1 Recovery objectives

- **RTO** — acceptable restoration time.
- **RPO** — acceptable data-loss window.

They are business/service constraints, not provider marketing numbers.

## 33.2 Recovery package

For C2+ critical services:

```yaml
incident_authority:
recovery_trigger:
source_of_truth:
rto:
rpo:
recovery_environment:
recovery_capacity:
recovery_network:
recovery_identity:
kms_secrets:
dns_traffic_shift:
backup_restore:
integrity_checks:
business_validation:
failback:
reconciliation:
communication:
last_exercise:
```

## 33.3 Recovery phases

```text
DECLARE
→ CONTAIN / FREEZE CONFLICTING CHANGE
→ ESTABLISH RECOVERY AUTHORITY
→ RESTORE CONTROL PLANE / DEPENDENCIES
→ RESTORE STATE
→ VERIFY INTEGRITY
→ ACTIVATE COMPUTE / NETWORK
→ SHIFT WORK / TRAFFIC
→ VERIFY SECURITY + SLO + BUSINESS CORRECTNESS
→ OPERATE DEGRADED/RECOVERY MODE
→ RECONCILE
→ FAIL BACK OR DECLARE NEW STEADY STATE
→ LEARN
```

## 33.4 Failback

A DR plan without failback/reconciliation is incomplete.

Check:

- split writes;
- duplicate jobs/messages;
- secret/key versions;
- DNS/route state;
- state version divergence;
- data reconciliation;
- queues;
- external webhook/callback destinations.

---

# 34. Failure injection and resilience testing

Failure testing is contextual, not a maturity badge.

Use bounded experiments when:

- a failure assumption materially affects architecture;
- safe blast radius can be established;
- monitoring/stop controls exist;
- the result can change a decision.

Possible tests:

- instance/node loss;
- zone loss simulation;
- dependency timeout;
- DNS failure;
- certificate expiry staging;
- identity denial;
- provider API throttling;
- queue saturation;
- network partition;
- restore;
- failover;
- reduced capacity.

Do not inject high-consequence failure into production merely to claim “chaos engineering.”

---

# 35. Observability and telemetry

OpenTelemetry distinguishes observability from the telemetry signals used to achieve it. [S26]

## 35.1 Operational questions

Instrumentation SHOULD let operators answer:

- Is the user journey working?
- Which region/zone/version/tenant is affected?
- Which dependency is slow/unavailable?
- Did a deployment/config/IAM/network change precede the issue?
- Is capacity/saturation growing?
- Is a queue draining?
- Is DNS/routing failing?
- Did privilege/public exposure change?
- Is restore/backup stale?
- Is cost deviating unexpectedly?

## 35.2 Infrastructure signals

Use proportionately:

- latency;
- traffic;
- errors;
- saturation;
- CPU/memory/storage/network pressure;
- quotas;
- connection pools;
- queue/backlog;
- autoscaling;
- DNS;
- control-plane/API errors;
- certificate/key expiry;
- IAM/security events;
- deployment/config events;
- backup/restore status;
- cost anomalies.

## 35.3 Telemetry security

Telemetry can contain:

- identifiers;
- addresses;
- resource names;
- configuration;
- request metadata;
- sensitive values;
- secrets by accident.

Apply:

- collection minimization;
- redaction;
- access control;
- retention;
- region/residency where required.

---

# 36. Alerting standard

An alert SHOULD:

- represent material consequence or near-term risk;
- be actionable;
- have an owner;
- contain enough context to start diagnosis;
- link to a runbook/play when useful;
- avoid page-level noise.

Examples of page-worthy infrastructure symptoms depend on service criticality:

- active user-visible SLO burn;
- capacity exhaustion approaching failure;
- production control-plane outage;
- privileged compromise;
- cert/key expiry with imminent outage;
- failed backup/restore policy for critical system;
- region failover failure.

Do not page simply because a CPU crossed an arbitrary threshold if no action or consequence exists.

---

# 37. Operations and toil

## 37.1 Operational controls

Material platforms SHOULD support:

- inspect current config/state;
- safe restart/replacement;
- drain/maintenance;
- replay/retry where safe;
- feature/workload disablement;
- traffic isolation;
- emergency access;
- resource scaling;
- audit;
- repair with evidence.

## 37.2 Automation

Automate stable, understood, repeatable work when it reduces total risk/cost.

Do not automate ambiguity into high-speed failure.

Automation MUST have:

- identity;
- scope;
- inputs;
- preconditions;
- timeout;
- concurrency;
- retry/idempotency behavior;
- observability;
- stop/recovery.

---

# 38. Incident operations

NIST SP 800-61 Rev. 3 is used as a current cybersecurity incident-response anchor; this playbook extends the operating loop to non-security infrastructure/service incidents as well. [S29]

Use the standard loop:

```text
DETECT
→ TRIAGE
→ CONTAIN
→ MITIGATE / RESTORE
→ VERIFY
→ COMMUNICATE
→ RECONCILE
→ LEARN
```

During active failure, safe restoration generally outranks deep root-cause analysis.

## 38.1 Infrastructure incident record

```yaml
impact:
systems:
regions_zones:
start:
detection:
trigger:
changes_preceding:
identity_security_impact:
network_impact:
capacity_impact:
data_impact:
mitigation:
recovery:
reconciliation:
what_worked:
what_failed:
control_gaps:
actions:
owners:
validation:
```

A postmortem action “be more careful” is not sufficient remediation for a system/control defect.

---

# 39. Release and infrastructure change safety

DORA’s current delivery metrics are intended for contextual improvement rather than metric gaming. [S30]

Infrastructure changes SHOULD be:

- small enough to reason about;
- tied to intent;
- reviewed against blast radius;
- staged where useful;
- correlated with telemetry;
- reversible or accompanied by stronger assurance.

## 39.1 High-risk change examples

- IAM/root policy;
- network routing;
- firewall/egress;
- KMS/key policy;
- cluster/control plane;
- DNS zone/registrar;
- destructive storage;
- account/subscription hierarchy;
- shared IaC module;
- provider organization configuration.

These SHOULD receive stronger review/segregation than routine low-risk scaling.

## 39.2 Progressive change

Canary/progressive rollout is useful when production evidence is valuable and blast radius can be bounded. [S24]

Infrastructure examples:

- one node pool;
- one cluster;
- one region;
- subset of accounts/projects;
- shadow/preview policy;
- read-only enforcement before block mode.

A canary is weak if the cohort does not exercise the relevant failure mode.

---

# 40. Patch and upgrade standard

For each platform component:

```yaml
current_version:
support_status:
latest_security_relevant_version:
owner:
compatibility_dependencies:
upgrade_method:
test_environment:
staged_rollout:
rollback_or_forward:
maintenance_capacity:
last_upgrade:
next_trigger:
```

## 40.1 Upgrade principles

- Do not optimize for “latest” as a vanity target.
- Do not normalize unsupported/EOL state.
- Test compatibility across control plane, nodes, plugins/controllers and workloads.
- Verify backup/recovery before high-risk upgrades.
- Maintain enough spare capacity for maintenance.
- Observe after each stage.
- Remove deprecated APIs/config only after usage is known.

---

# 41. FinOps and resource efficiency

The FinOps Framework is a practitioner operating model, not a formal security/reliability standard. Its 2026 update broadens workload placement and technology value across cloud, SaaS, private cloud and data center categories. [S31]

## 41.1 Minimum cost controls

- material spend is attributable;
- ownership tags/metadata are enforced enough to support decisions;
- abnormal spend is detectable;
- idle/orphaned resources are reviewed;
- rightsizing preserves required headroom/SLO;
- egress and observability volume are visible;
- managed-service premiums include saved operator labor;
- commitments/reservations follow credible demand;
- migration parallel-run cost is modeled;
- DR reserve capacity is included;
- cost optimization does not silently weaken security/reliability.

## 41.2 Unit economics

Where useful, relate infrastructure cost to a business workload unit:

- per active customer;
- per transaction;
- per job;
- per GB processed;
- per inference;
- per tenant.

Do not optimize raw utilization while destroying latency/recovery headroom.

---

# 42. Provider, concentration and portability

Supplier/provider due diligence SHOULD scale with criticality, privilege, resilience and exit exposure; NIST SP 1326 provides a current 2026 supplier due-diligence reference. [S37]

ISO/IEC 19941:2017 provides current terminology/concepts for cloud interoperability and portability; its Part 1 replacement is under publication at the cutoff. [S32][S33]

## 42.1 Portability dimensions

Always state which one:

- data portability;
- application/runtime portability;
- infrastructure/configuration portability;
- identity portability;
- operational portability;
- observability portability;
- provider/service substitutability.

“Portable” without dimension is ambiguous.

## 42.2 Provider dependency record

```yaml
provider_or_service:
business_role:
data:
identity_dependency:
regions:
availability_dependency:
control_plane_dependency:
quota_rate_limits:
support:
pricing_egress:
data_export:
config_export:
replacement_options:
migration_time:
contract_exit:
concentration_risk:
```

## 42.3 Lock-in

Vendor lock-in is a trade-off, not automatically a defect.

It can be rational if:

- managed capability materially improves value/security/operations;
- switching cost is known;
- business horizon supports it;
- exit/concentration risk is acceptable.

Avoid “lowest common denominator” architecture solely for theoretical portability.

---

# 43. Hybrid, on-premises and edge

The same protected invariants apply.

Additional questions:

- Who owns hardware lifecycle?
- Who patches firmware/hypervisor?
- What is the power/network failure model?
- Are spare parts available?
- How is physical access controlled?
- What happens when WAN/cloud control plane is unreachable?
- Can edge workloads operate offline/degraded?
- How are certificates/credentials rotated at disconnected sites?
- How is telemetry buffered?
- How is remote recovery performed?
- How is hardware securely retired?

A private cloud is not inherently more secure or cheaper than public cloud. It trades provider responsibility for internal responsibility and control.

---

# 44. Resource metadata, naming and lifecycle

Metadata does not enforce security by itself but supports ownership, policy, cost and incident response.

For material resources SHOULD include enough to derive:

- owner;
- workload/service;
- environment;
- data/security classification if useful;
- cost center/business unit;
- lifecycle/expiry;
- IaC/source repository;
- criticality.

Temporary/preview resources SHOULD have TTL/expiry or a cleanup owner.

Avoid sensitive data in tags/labels/names.

---

# 45. Decommissioning standard

Decommission is a controlled lifecycle operation.

## 45.1 Sequence

1. identify dependents/traffic;
2. announce/migrate where necessary;
3. stop new writes/work;
4. export/archive required data/evidence;
5. execute retention/deletion requirements;
6. remove DNS/routes/load balancers/integrations;
7. revoke identities/secrets/certs;
8. delete compute/storage/snapshots/backups according to policy;
9. remove allowlists/firewall/IAM references;
10. remove IaC safely or mark retired;
11. stop monitoring/licenses/billing;
12. verify no orphan remains;
13. record closure.

## 45.2 Closure evidence

```yaml
resource_or_service:
last_traffic:
dependents_checked:
data_disposition:
credentials_revoked:
network_references_removed:
iac_removed_or_archived:
billing_stopped:
evidence_archived:
verified_by:
date:
```

---

# 46. Decision framework — cloud / on-prem / hybrid

```text
Does the workload have a hard location, device, latency, sovereignty or physical-control constraint?
  ├─ YES → on-prem/edge/private/hybrid may be required; compare feasible options
  └─ NO  → can managed/public services meet security, reliability, performance and cost?
             ├─ YES → prefer lower operational burden unless concentration/exit/control changes decision
             └─ NO  → self-managed/private/hybrid option may be justified
```

Always include total lifecycle ownership.

---

# 47. Decision framework — VM vs container vs function/serverless

```text
Need custom OS/kernel/device/strong VM boundary?
  ├─ YES → VM/bare metal
  └─ NO → Need portable packaged long-running process/runtime control?
            ├─ YES → container or managed app platform
            └─ NO → Is workload event-driven/bursty/bounded and platform limits acceptable?
                      ├─ YES → function/serverless candidate
                      └─ NO → simplest persistent runtime
```

No branch implies that the selected mechanism is automatically cheaper or safer.

---

# 48. Decision framework — add an orchestrator?

```text
Do multiple workloads require scheduling/reconciliation/placement/policy at a shared platform layer?
  ├─ NO → do not add an orchestrator solely for fashion
  └─ YES → Can a managed platform provide the capability with lower operational burden?
             ├─ YES → evaluate managed option
             └─ NO → adopt orchestrator only with control-plane/upgrade/on-call competence
```

---

# 49. Decision framework — multi-region?

```text
Would loss of one region/site violate a material continuity objective?
  ├─ NO → single-region + strong backup/recovery may be sufficient
  └─ YES → Can the data/state model support regional recovery?
             ├─ NO → redesign state/recovery first
             └─ YES → model all correlated dependencies and test failover/failback
```

---

# 50. Decision framework — multi-cloud?

```text
Is there a concrete requirement that cannot be acceptably met by one provider + independent recovery?
  ├─ NO → do not add multi-cloud for prestige
  └─ YES → Is the risk/value reduction larger than duplicated operating complexity?
             ├─ NO → prefer simpler concentration mitigation
             └─ YES → define which layer is portable/redundant and test the cross-provider recovery path
```

---

# 51. Decision framework — public vs private endpoint

```text
Does the endpoint need broad internet reachability?
  ├─ YES → expose intentionally with identity/authz/transport/abuse/observability controls
  └─ NO → restrict reachability

Does restriction eliminate authorization requirements?
  └─ NO → private is not trusted
```

---

# 52. Decision framework — static secret vs federation/workload identity

```text
Can target system accept short-lived/federated identity?
  ├─ YES → prefer it for material automation/workload access
  └─ NO → use managed static secret with minimum scope, rotation, audit and owner
```

Do not build custom federation complexity solely to avoid one low-risk secret unless total risk improves.

---

# 53. Decision framework — GitOps?

```text
Is desired state declarative and safe to continuously reconcile?
  ├─ NO → use controlled push/apply workflow
  └─ YES → Does pull/reconciliation improve control enough to justify reconciler complexity?
             ├─ YES → GitOps candidate
             └─ NO → standard IaC pipeline is sufficient
```

---

# 54. Atomic plays

## PLAY-INF-001 — Design a new production workload

### Objective
Select the simplest infrastructure architecture that satisfies workload, security, reliability, cost and lifecycle requirements.

### Use when
- new C2+ workload;
- material relocation/replatform;
- material tenancy/exposure change.

### Inputs
- functional and quality requirements;
- data classification/location;
- threat model;
- criticality;
- traffic/latency/capacity;
- recovery requirements;
- budget/team constraints.

### Execution
1. Define outcome and criticality.
2. Define workload/state/data boundaries.
3. Map identity and trust boundaries.
4. Compare placement alternatives.
5. Define administrative/resource hierarchy.
6. Define ingress/egress/management networking.
7. Build dependency/failure-domain graph.
8. Define desired-state/IaC model.
9. Define supply-chain/control policy.
10. Define SLO/capacity/recovery.
11. Define observability/incident owner.
12. Compare lifecycle cost/portability.
13. Record consequential architecture decisions.
14. Define verification scenarios.

### Acceptance
- no material owner unknown;
- no implicit privileged/public path;
- recovery bootstrap path exists;
- high-blast-radius dependencies identified;
- selected complexity has a requirement;
- verification plan exists.

---

## PLAY-INF-002 — Review and apply a material IaC change

### Preconditions
- canonical desired-state repository identified;
- correct environment/state backend selected.

### Execution
1. Confirm intended behavior.
2. Review dependency/provider/module change.
3. Run static/schema/security/policy checks.
4. Inspect plan/diff.
5. Classify:
   - IAM;
   - network;
   - public exposure;
   - destructive;
   - data/state;
   - region/failure-domain;
   - cost/quota.
6. Validate concurrency/locking.
7. Define rollback/roll-forward.
8. Obtain risk-proportional approval.
9. Apply with controlled automation identity.
10. Verify provider state.
11. Verify runtime/reachability/authz/service health.
12. Record exception/drift/evidence.

### Failure handling
If apply fails partially, stop blind retries. Re-read state/provider reality, identify applied effects, then choose repair/reconcile/rollback.

---

## PLAY-INF-003 — Approve new internet exposure

### Decision questions
- Is public reachability required?
- What is the exact endpoint?
- Is backend/admin exposure separated?
- What identity/authz applies?
- What transport and certificate lifecycle applies?
- What rate/abuse/DDoS/resource policy applies?
- What data leaves/enters?
- How is exposure monitored?
- How is it disabled?
- Who owns it?

### Acceptance
No unexplained exposure; scanning/reachability test confirms expected ports/protocols only.

---

## PLAY-INF-004 — Create or change privileged infrastructure access

1. Identify human/workload principal.
2. Define resource/action/context.
3. Evaluate effective existing access.
4. Choose minimum privilege/duration.
5. Require stronger auth/approval if high risk.
6. Apply through controlled change.
7. Negative-test prohibited capability where material.
8. Verify audit evidence.
9. Set review/expiry/revocation.

---

## PLAY-INF-005 — Execute restore

1. Declare recovery owner.
2. Identify target recovery point.
3. Establish recovery identity/access.
4. Provision/verify recovery environment.
5. Restore state.
6. Validate integrity/security.
7. Start dependent services in required order.
8. Validate business behavior.
9. Measure actual RTO/RPO.
10. record defects and update plan.

---

## PLAY-INF-006 — Execute regional disaster recovery

1. Declare incident and authority.
2. Stop conflicting changes.
3. Confirm source-of-truth and data-loss window.
4. Validate target region capacity.
5. Re-establish IAM/KMS/secrets/network.
6. Restore/activate state.
7. Verify integrity.
8. Shift traffic/work.
9. Verify SLO/security/business correctness.
10. Operate recovery mode.
11. Reconcile divergence.
12. Decide failback/new steady state.
13. review.

---

## PLAY-INF-007 — Break-glass administration

1. Validate trigger.
2. Record approver/incident.
3. Activate independent recovery credential/path.
4. Scope session/action.
5. Record material actions.
6. restore normal path.
7. revoke/rotate emergency material as required.
8. reconcile IaC/config drift.
9. perform incident review.

---

## PLAY-INF-008 — Orchestrator/cluster upgrade

1. Verify version/support/compatibility matrix.
2. Verify control-plane and workload backup/recovery.
3. Check deprecated APIs/plugins/controllers.
4. Confirm spare capacity/PDB/maintenance behavior.
5. Stage non-production/representative test.
6. Upgrade smallest safe cohort/control plane stage.
7. Observe API/scheduler/network/storage/workload health.
8. continue or stop.
9. verify all workloads and policy.
10. remove temporary compatibility once safe.

---

## PLAY-INF-009 — Capacity/overload incident

1. Identify user consequence and bottleneck.
2. Stop retry/autoscaling feedback amplification if present.
3. shed/degrade low-priority work if safe.
4. add capacity only if downstream can support it.
5. protect critical tenants/work.
6. recover queue/backlog deliberately.
7. validate saturation and error return to normal.
8. review capacity model/guardrails.

---

## PLAY-INF-010 — Credential/key/certificate compromise

1. classify affected principal/material and scope;
2. contain/disable where safe;
3. identify dependent workloads;
4. rotate/reissue/revoke;
5. invalidate sessions/tokens where supported;
6. inspect audit/use;
7. restore affected service;
8. verify old credential no longer works;
9. reconcile secrets/IaC/config;
10. investigate root/control-plane path.

---

## PLAY-INF-011 — Decommission workload/environment

Use the sequence in §45 and retain closure evidence.

---

# 55. Runbook template

```markdown
# RUN-INF-[ID] — [Outcome]

## Trigger
## Preconditions
## Required identities / permissions
## Safety constraints
## Inputs / environment
## Steps
1. ...
2. ...

## Expected state after each critical step
## Verification
## Failure / partial completion
## Stop criteria
## Rollback / roll-forward / recovery
## Escalation
## Evidence retained
## Owner
## Version / last tested
```

Material runbooks SHOULD be dry-run by a competent non-author before production reliance.

---

# 56. Architecture review checklist

## Intent
- [ ] workload/user outcome defined
- [ ] criticality assigned
- [ ] material constraints explicit
- [ ] provider/service choice follows requirements

## Boundaries
- [ ] administrative/resource hierarchy explicit
- [ ] state/source of truth explicit
- [ ] human/workload/automation identities explicit
- [ ] management plane explicit
- [ ] ingress/egress/east-west explicit
- [ ] tenant boundary explicit where applicable

## Security
- [ ] threat model proportionate
- [ ] least privilege
- [ ] no network-location trust
- [ ] secret/key/cert lifecycle
- [ ] metadata/control-plane exposure
- [ ] supply-chain dependencies
- [ ] audit evidence

## Reliability
- [ ] user-relevant SLO/requirements
- [ ] failure-domain graph
- [ ] correlated dependencies
- [ ] capacity normal + failover
- [ ] backup/restore
- [ ] RTO/RPO
- [ ] bootstrap recovery path
- [ ] failback/reconciliation

## Change/operations
- [ ] desired-state/IaC model
- [ ] drift model
- [ ] rollout/recovery
- [ ] telemetry/alerts
- [ ] patch/upgrade
- [ ] incident/runbooks

## Economics/lifecycle
- [ ] owner/cost allocation
- [ ] major cost drivers
- [ ] portability/concentration
- [ ] decommission path

---

# 57. Network review checklist

- [ ] address family/space deliberate
- [ ] no overlap risk ignored
- [ ] public endpoints inventoried
- [ ] private/internal endpoints owned
- [ ] management endpoints restricted
- [ ] egress policy explicit
- [ ] DNS ownership/failure/recovery explicit
- [ ] route propagation understood
- [ ] transport identity/encryption appropriate
- [ ] NAT not treated as auth
- [ ] DDoS/resource abuse considered
- [ ] path MTU/overlay behavior considered
- [ ] network policy enforcement tested
- [ ] logs/flow evidence sufficient
- [ ] disable/revoke path tested where material

---

# 58. IAM review checklist

- [ ] workforce federation where appropriate
- [ ] MFA appropriate to threat
- [ ] no shared routine admins
- [ ] standing privilege minimized
- [ ] effective permissions reviewed
- [ ] workload identities owned
- [ ] automation identities separated by environment/scope
- [ ] long-lived static credentials minimized
- [ ] rotation/revocation works
- [ ] dormant identities detectable
- [ ] negative authorization tests for high-risk actions
- [ ] break-glass independent and tested
- [ ] offboarding/lifecycle integrated

---

# 59. Container/orchestrator checklist

- [ ] image source controlled
- [ ] immutable artifact identity
- [ ] base image maintained
- [ ] no embedded secrets
- [ ] least runtime privilege
- [ ] no unjustified host access
- [ ] resource policy explicit
- [ ] tenant/isolation assumptions tested
- [ ] network policy effective
- [ ] control-plane access protected
- [ ] add-ons/controllers supply chain covered
- [ ] cluster/control-plane recovery
- [ ] maintenance/disruption model
- [ ] upgrade compatibility
- [ ] workload data recovery separate from cluster config recovery

---

# 60. IaC review checklist

- [ ] canonical repo/environment/state identified
- [ ] no secret in source
- [ ] state/plan sensitivity protected
- [ ] provider/module/plugin dependency controlled
- [ ] plan/diff reviewed
- [ ] destructive actions explicit
- [ ] IAM change explicit
- [ ] network/public exposure explicit
- [ ] storage/data impact explicit
- [ ] region/failure-domain impact explicit
- [ ] cost/quota impact explicit
- [ ] locking/concurrency safe
- [ ] policy tests pass
- [ ] apply identity least privilege
- [ ] partial-failure path known
- [ ] actual runtime verified after apply
- [ ] drift classified/reconciled

---

# 61. Recovery readiness checklist

- [ ] business RTO/RPO set
- [ ] dependency/failure graph current
- [ ] recovery identity independent enough
- [ ] recovery docs accessible
- [ ] backups protected from modeled threat
- [ ] restore executed
- [ ] actual RTO/RPO measured
- [ ] target capacity tested
- [ ] DNS/network/KMS/cert path works
- [ ] integrity checks exist
- [ ] business validation exists
- [ ] failback/reconciliation exists
- [ ] last exercise still representative after architecture changes

---

# 62. Production readiness gate

C2+ infrastructure is production-ready only if applicable items pass:

- ownership;
- architecture/criticality;
- IAM;
- network exposure;
- secrets/keys/certs;
- compute/runtime;
- supply chain;
- IaC/change control;
- observability;
- capacity;
- backup/restore;
- RTO/RPO;
- incident support;
- cost allocation;
- provider dependency;
- decommission.

Green CI alone is not this gate.

---

# 63. Testing and assurance strategy

Choose from:

### T1 — Static review
IaC/config/policy/architecture evidence.

### T2 — Plan/diff simulation
Provider change preview.

### T3 — Integration/provision test
Create actual representative infrastructure.

### T4 — Security/control test
Negative IAM, network reachability, policy, secret exposure.

### T5 — Capacity/load/overload
Normal, peak, failover and overload behavior.

### T6 — Restore
Backup restoration and integrity.

### T7 — Failover/failback
Zone/region/dependency recovery.

### T8 — Failure injection
Bounded hypothesis-driven fault.

### T9 — Non-author runbook execution
Competent operator executes without author coaching.

### T10 — Production canary
Limited real exposure with stop thresholds.

Higher criticality requires more independent/representative evidence.

---

# 64. Metrics and decision signals

Do not create one infrastructure “health score.”

## Reliability
- SLO/error-budget;
- actual restore RTO/RPO;
- failover exercise success;
- incident recurrence.

## Change
- failed deployment/change rate;
- recovery time;
- drift age;
- unauthorized/manual change rate.

## Security/IAM
- standing privileged access;
- dormant credentials;
- high-risk entitlement age;
- exposed endpoint inventory drift;
- critical vulnerability exposure age;
- cert/key expiry risk.

## Capacity
- saturation/headroom;
- failover capacity;
- queue/backlog;
- quota risk;
- autoscaling effectiveness.

## Operations
- actionable alert rate;
- operator toil;
- runbook last-tested age;
- time to diagnose.

## Cost
- allocation coverage;
- anomalous spend;
- idle/orphaned resources;
- cost per useful workload unit.

Each material metric SHOULD define the decision it informs.

---

# 65. Anti-playbook — infrastructure folklore to resist

## 65.1 “Private means trusted.”
**Verdict:** false.  
**Better rule:** reachability and authorization are separate. [S08]

## 65.2 “Kubernetes is required for scale.”
**Verdict:** false.  
**Better rule:** adopt orchestration only when it solves scheduling/platform requirements worth its complexity.

## 65.3 “Containers are lightweight VMs.”
**Verdict:** misleading for security.  
**Better rule:** choose isolation boundary from threat/consequence.

## 65.4 “IaC makes infrastructure reproducible.”
**Verdict:** incomplete.  
**Better rule:** IaC improves versioned intent; state, dependencies, images, provider behavior, secrets and drift still matter.

## 65.5 “Plan succeeded, so apply is safe.”
**Verdict:** false.  
**Better rule:** plan is predictive evidence; verify actual effects/runtime.

## 65.6 “Multi-cloud means resilient.”
**Verdict:** false.  
**Better rule:** multi-cloud is justified only by a modeled risk/value advantage that survives operating complexity.

## 65.7 “Two regions means DR.”
**Verdict:** false.  
**Better rule:** test state, identity, KMS, DNS, dependency, capacity, failback and reconciliation.

## 65.8 “Autoscaling solves capacity.”
**Verdict:** false.  
**Better rule:** autoscaling is one control with latency, quota, downstream and cost limits.

## 65.9 “Managed service means no operations.”
**Verdict:** false.  
**Better rule:** provider owns more implementation; customer still owns configuration, integration and user outcome.

## 65.10 “Serverless means no servers.”
**Verdict:** marketing shorthand.  
**Better rule:** server ownership moves to provider; IAM/config/dependency/runtime limits remain yours.

## 65.11 “Firewall/security group is authorization.”
**Verdict:** false.

## 65.12 “NAT is a security boundary.”
**Verdict:** false as a general claim.

## 65.13 “Encryption makes a connection trusted.”
**Verdict:** false.  
**Better rule:** peer identity + authorization + appropriate transport.

## 65.14 “Encrypt every internal packet using a service mesh.”
**Verdict:** overgeneralization.  
**Better rule:** protect traffic where threat/sensitivity warrants; choose simplest adequate enforcement.

## 65.15 “Zero Trust is a product.”
**Verdict:** false. [S08]

## 65.16 “VPN = Zero Trust.”
**Verdict:** false.

## 65.17 “NetworkPolicy = cluster Zero Trust.”
**Verdict:** false; L3/L4/enforcement limitations remain. [S22]

## 65.18 “PDB means Kubernetes HA.”
**Verdict:** false; it mainly constrains voluntary disruptions. [S22]

## 65.19 “Always set strict CPU/memory limits.”
**Verdict:** contextual.  
**Better rule:** choose resource controls from workload/failure mode.

## 65.20 “Never set resource limits.”
**Verdict:** equally contextual.

## 65.21 “Latest image tag keeps production secure.”
**Verdict:** false; mutable and unreproducible.

## 65.22 “Signed image = secure image.”
**Verdict:** false; signature proves identity linkage, not content safety.

## 65.23 “SBOM = supply-chain security.”
**Verdict:** false; inventory is one evidence layer. [S20]

## 65.24 “GitOps eliminates drift.”
**Verdict:** false; reconciler/source/provider/manual reality can diverge.

## 65.25 “Always auto-remediate drift.”
**Verdict:** unsafe when desired state is wrong or incident change is intentional.

## 65.26 “Immutable infrastructure means never patch in place.”
**Verdict:** heuristic, not law.

## 65.27 “Backup completed = recoverable.”
**Verdict:** false.

## 65.28 “Replication = backup.”
**Verdict:** false.

## 65.29 “Snapshot = DR.”
**Verdict:** false.

## 65.30 “Provider SLA = our SLO.”
**Verdict:** false.

## 65.31 “Five nines is more professional.”
**Verdict:** false; reliability must match consequence. [S23]

## 65.32 “More monitoring data = better observability.”
**Verdict:** false. [S26]

## 65.33 “One account/project is simplest and therefore best.”
**Verdict:** can create unacceptable blast radius.

## 65.34 “Every workload needs a separate account/project.”
**Verdict:** also false; boundary overhead must earn value.

## 65.35 “Public IP means insecure.”
**Verdict:** false; security depends on effective controls/exposure need.

## 65.36 “No public IP means secure.”
**Verdict:** false.

## 65.37 “High utilization is efficient.”
**Verdict:** incomplete; headroom can be a reliability control.

## 65.38 “Cheapest instance/service is cost optimization.”
**Verdict:** false; lifecycle/operator/risk cost matters.

## 65.39 “Avoid managed services to avoid lock-in.”
**Verdict:** overgeneralization.

## 65.40 “Portability means lowest-common-denominator architecture.”
**Verdict:** false.

## 65.41 “Never make manual production changes.”
**Verdict:** false as an emergency rule.  
**Better rule:** controlled break glass + evidence + reconcile desired state.

## 65.42 “If CI is green, infrastructure is production-ready.”
**Verdict:** false.

## 65.43 “Chaos engineering proves resilience.”
**Verdict:** false; only the tested hypothesis/environment is evidenced.

## 65.44 “More regions/providers always reduce risk.”
**Verdict:** false; complexity can introduce more failure than it removes.

## 65.45 “Cloud is always cheaper.”
**Verdict:** false; workload/labor/egress/commitment/scale determine economics.

## 65.46 “On-prem is always cheaper at scale.”
**Verdict:** equally unsupported as a universal.

---

# 66. Contradiction ledger

| Tension | V2 rule |
|---|---|
| Public vs private | Exposure changes threat surface; neither establishes trust. |
| Managed vs self-managed | Managed reduces operated layers; may increase dependency/control constraints. |
| Single vs multi-cloud | Simplicity vs concentration risk; requirement decides. |
| Single vs multi-region | Simplicity/cost vs regional continuity; state/recovery determines feasibility. |
| VM vs container | isolation/control vs density/packaging; threat/workload decides. |
| Serverless vs persistent | elasticity/managed ops vs runtime/control/cost predictability. |
| Default deny vs flexibility | deny is strong when maintainable; brittle policy can create unsafe bypasses. |
| Encryption vs complexity | protect material paths; do not mandate ornamental layers. |
| IaC reconciliation vs break glass | canonical desired state plus controlled temporary exception. |
| GitOps vs push | continuous pull convergence vs simpler explicit execution. |
| Immutable vs in-place patch | repeatability vs practical emergency/legacy constraints. |
| Autoscale vs reserve | dynamic efficiency vs deterministic headroom. |
| Utilization vs reliability | efficiency stops where saturation risk becomes material. |
| Portability vs provider-native value | exit flexibility vs differentiated managed capability. |
| Security vs operability | controls that block safe recovery can create security/reliability risk. |
| Central platform vs team autonomy | consistent controls vs blast radius/bottleneck; scope shared services carefully. |

---

# 67. Threat and failure scenario catalog

Every material architecture review SHOULD select scenarios relevant to its risk rather than blindly test all.

## Identity
- IdP unavailable;
- admin credential compromised;
- workload credential leaked;
- permission revocation delayed;
- break-glass unusable.

## Network
- DNS unavailable/misconfigured;
- route leak;
- certificate expiry;
- DDoS;
- egress dependency blocked;
- MTU/overlay failure;
- region interconnect loss.

## Compute
- host/node failure;
- kernel/runtime defect;
- capacity exhausted;
- image unavailable;
- noisy neighbor.

## Control plane
- provider API degraded;
- orchestrator API unavailable;
- IaC state locked/corrupt;
- KMS unavailable;
- registry unavailable.

## Change
- partial apply;
- wrong environment;
- destructive replacement;
- policy regression;
- incompatible upgrade;
- bad route/IAM propagation.

## Data/recovery
- accidental deletion;
- corruption;
- ransomware/admin deletion of backup;
- restore takes too long;
- failover creates divergent writes.

## Economics
- runaway autoscaling;
- attack-driven cost;
- observability cardinality explosion;
- egress spike;
- forgotten resources.

---

# 68. Implementation and adoption

A standard is not implemented by publishing it.

Adoption SHOULD establish:

- infrastructure/platform owner;
- security reviewer;
- SRE/operations owner;
- FinOps/cost partner where spend is material;
- canonical IaC/config repository;
- admin boundary/landing-zone baseline;
- identity/federation model;
- network/exposure baseline;
- observability baseline;
- backup/recovery baseline;
- exception process;
- training and runbook rehearsal;
- deprecation of conflicting old guidance.

## 68.1 Protected invariants vs adaptable periphery

**Protected:** authority, ownership, recovery evidence, traceability, blast-radius control, threat/failure requirements.

**Adaptable:** cloud provider, IaC tool, orchestrator, service mesh, exact account/project hierarchy, telemetry backend, Git branching workflow.

---

# 69. Definition of Ready for an infrastructure change

- [ ] outcome/intent defined
- [ ] environment/resource identified
- [ ] owner identified
- [ ] criticality/blast radius known
- [ ] desired-state source known
- [ ] dependencies known enough
- [ ] IAM/network/data effects identified
- [ ] verification method selected
- [ ] rollback/roll-forward/recovery considered
- [ ] approver/decision owner known where required

---

# 70. Definition of Done

A C2+ material infrastructure change is done when applicable:

## Intent and state
- [ ] desired state merged/approved
- [ ] actual provider/runtime state verified
- [ ] no unexplained drift

## Security
- [ ] IAM effective permissions verified
- [ ] exposure/network verified
- [ ] secrets/keys/certs safe
- [ ] security/policy checks pass
- [ ] audit evidence available

## Reliability
- [ ] service/user behavior healthy
- [ ] capacity acceptable
- [ ] failure-domain/recovery assumptions remain valid
- [ ] backup/recovery not broken

## Operations
- [ ] telemetry correlates change
- [ ] alerts/runbooks updated if required
- [ ] operator ownership clear

## Economics/lifecycle
- [ ] cost/quota impact acceptable
- [ ] temporary resources have expiry
- [ ] decommission/migration cleanup completed where applicable

BLOCKER defects prevent release/closure.

---

# 71. Review cadence and event triggers

Core principles: review at least annually or when major standards change.

Implementation profiles: review quarterly or event-driven for fast-moving technology.

Immediate review triggers:

- identity/security standard update;
- orchestration major version;
- provider control-plane/security behavior change;
- IaC provider/tool breaking change;
- new public exposure;
- security incident;
- failed restore/DR exercise;
- material outage;
- unsupported/EOL component;
- regulator/contract change;
- material pricing/quota change;
- new provider concentration;
- architecture change that invalidates failure assumptions.

---

# 72. Current watchlist

As of 2026-09-27:

1. **ISO/IEC 19941-1** — under publication; expected to replace ISO/IEC 19941:2017. Recheck after publication. [S33]
2. **NIST NCCoE DevSecOps Practices live document** — September 2026 active/live guidance; monitor revisions. [S19]
3. Kubernetes implementation-profile details — fast-moving; recheck before applying exact field/version guidance.
4. Cloud provider identity/network/security defaults — verify from current official provider docs at implementation time.
5. Cryptographic protocol/profile recommendations — recheck current IETF/industry guidance before new deployments.

---

# 73. Evidence map and source register

The source register intentionally separates normative standards from operational and practitioner evidence.

## Foundations

### S01 — Master Playbook Standard v2.0-RC1
**Type:** local foundational standard.  
**Use:** evidence discipline, risk proportionality, play/runbook architecture, audit, validation, lifecycle.  
**Limitation:** house standard; not an external certification.

### S02 — Universal Software & AI Engineering Master Playbook v2.0
**Type:** local foundational engineering standard.  
**Use:** criticality, security, SRE, failure engineering, supply chain, DevOps, IaC anti-folklore.  
**Limitation:** root standard delegates implementation depth to specialist playbooks.

## Cloud/security/governance

### S03 — NIST SP 800-145 — The NIST Definition of Cloud Computing
URL: https://csrc.nist.gov/pubs/sp/800/145/final  
**Use:** stable cloud vocabulary/service/deployment model reference.  
**Limitation:** 2011 taxonomy; modern infrastructure mechanisms extend beyond it.

### S04 — ISO/IEC 27017:2026 — Cloud security controls
URL: https://www.iso.org/standard/27017  
**Status:** Published/current, Edition 2, July 2026.  
**Use:** cloud-specific ISO/IEC 27002 guidance and customer/provider responsibility.  
**Limitation:** standard/control baseline, not proof of one architecture.

### S05 — ISO/IEC 27018:2025 — PII in public cloud
URL: https://www.iso.org/standard/27018  
**Status:** Published/current, Edition 3.  
**Use:** PII processor/cloud privacy control guidance.  
**Limitation:** scoped to public-cloud PII processor context.

### S06 — Cloud Security Alliance — Security Guidance v5
URL: https://cloudsecurityalliance.org/artifacts/security-guidance-v5  
**Status:** released 2024; updated 2025.  
**Use:** applied cloud security domains, IAM, infrastructure/networking, workload, monitoring, resilience.  
**Limitation:** practitioner/industry framework, not a binding standard.

### S07 — CSA Cloud Controls Matrix v4.1
URL: https://cloudsecurityalliance.org/artifacts/cloud-controls-matrix-v4-1  
**Status:** released January 2026.  
**Use:** cloud control assessment/mappings.  
**Limitation:** control framework; count/website presentation may evolve; do not use control count as quality evidence.

### S08 — NIST SP 800-207 — Zero Trust Architecture
URL: https://csrc.nist.gov/pubs/sp/800/207/final  
**Status:** Final.  
**Use:** no implicit trust solely from physical/network location; resource-centric access.  
**Limitation:** architecture guidance, not a product recipe.

### S09 — NIST SP 800-207A — ZTA for cloud-native multi-cloud applications
URL: https://csrc.nist.gov/pubs/sp/800/207/a/final  
**Status:** Final 2023.  
**Use:** application/service identity and granular policy in hybrid/multi-cloud.  
**Limitation:** cloud-native model; not every system needs mesh/API-gateway implementation.

### S10 — NIST SP 800-63-4 — Digital Identity Guidelines
URL: https://csrc.nist.gov/pubs/sp/800/63/4/final  
**Status:** Final July 2025; supersedes SP 800-63-3.  
**Use:** identity proofing/authentication/federation concepts and assurance.  
**Limitation:** U.S. federal guideline scope; map mechanisms to local risk rather than cargo-cult assurance levels.

### S11 — IETF RFC 9846 — TLS 1.3
URL: https://www.rfc-editor.org/info/rfc9846/  
**Status:** Standards Track, July 2026; obsoletes RFC 8446 and RFC 5246.  
**Use:** current TLS 1.3 protocol reference.  
**Limitation:** application protocols still must define use/identity verification.

### S12 — IETF BCP 38 / RFC 2827 — Network ingress filtering
URL: https://www.rfc-editor.org/info/bcp38/  
**Use:** source-address spoofing mitigation.  
**Limitation:** network-operator context, not an application authorization control.

### S13 — NIST SP 800-189 — Resilient Interdomain Traffic Exchange
URL: https://csrc.nist.gov/pubs/sp/800/189/final  
**Status:** Final 2019; a revision has existed in draft form but the final baseline remains the final publication until superseded.  
**Use:** RPKI/origin validation, prefix/source filtering and DDoS-related interdomain controls.  
**Limitation:** primarily relevant to network operators managing interdomain routing.

### S14 — NIST SP 800-125A Rev. 1 — Server hypervisor security
URL: https://csrc.nist.gov/pubs/sp/800/125/a/r1/final  
**Status:** Final.  
**Use:** hypervisor mediation/isolation and secure baseline functions.  
**Limitation:** server virtualization context; older but still useful foundational guidance.

### S15 — NIST SP 800-190 — Application Container Security Guide
URL: https://csrc.nist.gov/pubs/sp/800/190/final  
**Status:** Final.  
**Use:** container threat/control baseline.  
**Limitation:** 2017; supplement with current runtime/orchestrator standards.

### S16 — Open Container Initiative — specifications / Runtime Spec v1.3
URL: https://opencontainers.org/  
**Status:** OCI Runtime Spec v1.3 released November 2025.  
**Use:** current container runtime/image/distribution standard ecosystem.  
**Limitation:** specification semantics, not an end-to-end security standard.

## IaC / DevSecOps / supply chain

### S17 — NIST SP 800-204C — DevSecOps implementation
URL: https://csrc.nist.gov/pubs/sp/800/204/c/final  
**Status:** Final 2022.  
**Use:** application, service, infrastructure, policy and observability as code; CI/CD/GitOps.  
**Limitation:** cloud-native/microservice reference context; exact architecture is not universal.

### S18 — NIST SP 800-204D — Supply-chain security in DevSecOps CI/CD
URL: https://csrc.nist.gov/pubs/sp/800/204/d/final  
**Status:** Final 2024.  
**Use:** artifacts, attestations, SBOM/provenance and CI/CD supply-chain controls.  
**Limitation:** focused on software supply chain; infrastructure runtime controls remain separate.

### S19 — NIST NCCoE — Secure Software Development, Security, and Operations (DevSecOps) Practices Live Document
URL: https://pages.nist.gov/nccoe-devsecops/  
**Status:** September 2026 live document.  
**Use:** current implementation demonstrations and security-as-code practices.  
**Limitation:** active/live applied guidance, not a final universal normative standard.

### S20 — SLSA v1.2
URL: https://slsa.dev/spec/v1.2/  
**Status:** Approved/current.  
**Use:** source/build provenance and increasing supply-chain guarantees.  
**Limitation:** provenance does not prove source/runtime correctness or absence of vulnerabilities.

### S21 — OpenGitOps Principles v1.0.0
URL: https://opengitops.dev/  
**Use:** declarative, versioned/immutable, pull and continuous reconciliation definition.  
**Limitation:** contextual operating pattern, not universal infrastructure law.

## Orchestration implementation evidence

### S22 — Kubernetes documentation
URLs:
- https://kubernetes.io/docs/concepts/security/security-checklist/
- https://kubernetes.io/docs/concepts/security/pod-security-standards/
- https://kubernetes.io/docs/concepts/services-networking/network-policies/
- https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/
- https://kubernetes.io/docs/concepts/workloads/pods/disruptions/

**Use:** current implementation behavior/limitations for Pod Security, NetworkPolicy, resources and disruption.  
**Limitation:** fast-moving Kubernetes-specific evidence; recheck version before implementation.

## Reliability / operations

### S23 — Google SRE Workbook — Implementing SLOs
URL: https://sre.google/workbook/implementing-slos/  
**Use:** user-relevant reliability targets and error-budget decision logic.  
**Limitation:** adapt to workload; not every infrastructure component needs a formal SLO.

### S24 — Google SRE Workbook — Canarying Releases
URL: https://sre.google/workbook/canarying-releases/  
**Use:** reduce change blast radius; production evidence.  
**Limitation:** effectiveness requires representative cohort and useful stop signals.

### S25 — Google SRE — Addressing Cascading Failures
URL: https://sre.google/sre-book/addressing-cascading-failures/  
**Use:** overload, retries, queues, load shedding and cascading failure.  
**Limitation:** Google-scale examples; mechanism generalizes more than exact implementation.

### S26 — OpenTelemetry — Observability Primer
URL: https://opentelemetry.io/docs/concepts/observability-primer/  
**Use:** observability vs telemetry distinction.  
**Limitation:** instrumentation ecosystem does not guarantee useful diagnosis.

### S27 — ISO/IEC 27031:2025 — ICT readiness for business continuity
URL: https://www.iso.org/standard/27031  
**Status:** Published/current, Edition 2.  
**Use:** continuity/recovery alignment including cloud/external dependencies.  
**Limitation:** continuity guidance; workload-specific RTO/RPO require business analysis.

### S28 — NIST SP 800-160 Vol. 2 Rev. 1 — Developing Cyber-Resilient Systems
URL: https://csrc.nist.gov/pubs/sp/800/160/v2/r1/final  
**Use:** anticipate, withstand, recover and adapt.  
**Limitation:** higher-assurance systems-engineering framing; tailor rigor.

### S29 — NIST SP 800-61 Rev. 3 — Incident Response Recommendations
URL: https://csrc.nist.gov/pubs/sp/800/61/r3/final  
**Status:** Final 2025.  
**Use:** incident response integrated into cybersecurity risk management.  
**Limitation:** cybersecurity IR is one part of broader service-operations incident response.

### S30 — DORA — Software delivery performance metrics
URL: https://dora.dev/guides/dora-metrics/  
**Use:** current five delivery metrics, contextual improvement and anti-gaming.  
**Limitation:** service/delivery context; not an individual engineer or infrastructure quality score.

### S31 — FinOps Framework 2026
URLs:
- https://www.finops.org/framework/
- https://www.finops.org/framework/capabilities/architecting-workload-placement/
- https://www.finops.org/framework/capabilities/usage-optimization/

**Use:** workload placement, cost/value/accountability and usage optimization.  
**Limitation:** practitioner framework; cost optimization never overrides material security/reliability requirements by itself.

## Portability / identity extensions

### S32 — ISO/IEC 19941:2017 — Cloud interoperability and portability
URL: https://www.iso.org/standard/66639.html  
**Status:** current published baseline at cutoff; confirmed 2023.  
**Use:** portability/interoperability terminology.  
**Limitation:** expected to be replaced shortly.

### S33 — ISO/IEC 19941-1 — Cloud interoperability and portability Part 1
URL: https://www.iso.org/standard/87817.html  
**Status:** **under publication** as of 18 September 2026, not yet the published replacement.  
**Use:** watch item.  
**Limitation:** MUST NOT be cited as current final until publication completes.

### S34 — SPIFFE specifications
URL: https://spiffe.io/docs/latest/spiffe-specs/spiffe/  
**Use:** open workload identity model (SPIFFE IDs/SVIDs/Workload API).  
**Limitation:** implementation choice, not universal requirement.

### S35 — NIST SP 800-210 — General Access Control Guidance for Cloud Systems
URL: https://csrc.nist.gov/pubs/sp/800/210/final  
**Use:** cloud access-control characteristics across service models.  
**Limitation:** guidance baseline; implementation depends on platform/threat.

### S36 — NIST SP 800-53 Rev. 5 / Release 5.2.0
URL: https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final  
**Status:** Rev. 5 catalog with Release 5.2.0 finalized August 2025.  
**Use:** broad security/privacy control catalog and assurance reference.  
**Limitation:** control catalog, not a cloud architecture recipe; select controls by risk/overlay.

### S37 — NIST SP 1326 — C-SCRM Due Diligence Assessment Quick-Start Guide
URL: https://csrc.nist.gov/pubs/sp/1326/final  
**Status:** Final July 2026.  
**Use:** supplier provenance/resilience/foundational practices/supply-chain tiers.  
**Limitation:** supplier due-diligence guide; scale to dependency criticality.

---

# 74. V2 falsification closure

V2 explicitly closes the V1 blockers.

## Blocker B1 — IaC falsely implies reproducibility
**Closed by:** §§6.2, 21, 22, 23.  
Desired/provider/runtime state are separated; state/concurrency/dependency/drift/post-apply verification are mandatory according to risk.

## Blocker B2 — multi-region falsely implies resilience
**Closed by:** §§29–30, 33.  
Failure-domain graph, correlated dependencies, target capacity, state integrity, failover/failback and reconciliation are explicit.

## Blocker B3 — recovery can be circular
**Closed by:** §§16, 29, 33.  
Bootstrap dependencies, independent recovery identity/path and recovery documentation are explicit.

## Major findings closed

V2 additionally:

- scopes default-deny rather than universalizing it;
- scopes encryption to threat/sensitivity rather than mandating service mesh;
- separates reachability, identity, authorization and encryption;
- adds management-plane inventory;
- separates human/workload/automation/recovery identity;
- adds effective-permission review;
- adds cert/time dependencies;
- adds MTU/overlay/network path failure;
- strengthens DNS;
- expands container supply chain;
- isolates Kubernetes as implementation profile;
- turns resource limits into workload-specific policy;
- models IaC state/concurrency/partial failure;
- classifies drift;
- adds autoscaling feedback-loop controls;
- requires failback/reconciliation;
- threat-models backup independence;
- rejects provider-SLA-to-SLO substitution;
- adds landing-zone/admin hierarchy;
- adds decommission closure evidence.

No V2 finding justifies a universal preference for one provider, Kubernetes, multi-cloud, serverless, service mesh, GitOps or IaC product.

---

# 75. Mechanical QA record

Post-synthesis mechanical QA for this V2 snapshot:

```text
3316 source lines before this recorded QA update
13,527 words before this recorded QA update
72 Markdown code-fence markers; balanced = yes
37 source IDs used
37 source IDs defined
0 missing source-ID definitions
0 unresolved drafting markers
```

Semantic QA additionally verified:

- the three V1 BLOCKER findings are represented in V2;
- current/draft/under-publication status is explicit for volatile material;
- no provider, orchestrator, service mesh, GitOps or IaC product is promoted to a universal default;
- recovery distinguishes backup, restore, failover, failback and reconciliation;
- IaC distinguishes desired state, provider/control-plane state and observed runtime state;
- `REVIEWED` is not represented as field validation.

---

# 76. One-page Golden Standard

If only one section is used:

1. Start from workload, data, threat, failure and recovery requirements—not provider products.
2. Classify criticality before selecting assurance.
3. Use the least complex infrastructure that satisfies demonstrated requirements.
4. Separate administrative, identity, network, compute, state, control-plane and operational boundaries.
5. Never grant authorization merely because a principal/resource is on a private/internal network.
6. Treat reachability, identity, authorization, encryption and segmentation as different controls.
7. Inventory and protect management/control planes more strongly than ordinary workload paths.
8. Give every material resource and privileged identity an owner and lifecycle.
9. Prefer federation/short-lived workload identity over duplicated static credentials when it improves total risk.
10. Design break-glass so recovery does not depend entirely on the failed identity/control plane.
11. Treat DNS, KMS, certificate, time, registry and CI/CD as real dependencies when they are.
12. Choose VM/container/serverless/orchestrator from workload and isolation needs; Kubernetes is not a scale prerequisite.
13. Treat containers as shared-kernel isolation unless stronger runtime isolation is actually provided.
14. Make production artifacts identifiable; provenance/SBOM/signatures are evidence, not proof of security.
15. Use IaC as controlled desired state when it improves repeatability/auditability.
16. Never claim IaC alone makes infrastructure reproducible.
17. Protect IaC state; define locking, concurrency, partial-failure and recovery.
18. Detect and classify drift before remediation; reconcile emergency changes back into authoritative state.
19. Use policy as code for deterministic repeated controls; a warning is not enforcement.
20. Use GitOps only where continuous pull/reconciliation is a net operational benefit.
21. Define ingress, egress, east-west and management networking separately.
22. Treat public exposure as an intentional inventory item with owner, auth, transport, abuse and revoke controls.
23. Treat egress as a first-class control where compromise/exfiltration/cost risk is material.
24. Make network policy effective in the real implementation; configuration objects alone are not evidence.
25. Model failure domains and correlated dependencies; redundancy is not automatically resilience.
26. Define user-relevant reliability; provider SLA is not your SLO.
27. Bound queues, concurrency, retries and resource consumption; overload can cascade.
28. Autoscaling has bounds, delay, quota, downstream and cost constraints.
29. Capacity-test normal, peak, maintenance and failover modes.
30. Treat backup, replication, snapshot, restore and DR as different concepts.
31. Measure RTO/RPO through restoration/exercises, not documents.
32. Design failover and failback/reconciliation together.
33. Map recovery bootstrap dependencies and keep emergency access/docs usable during failure.
34. Make telemetry answer operational questions; more logs are not more observability.
35. Correlate infrastructure changes with service/security telemetry.
36. Page on actionable consequence, not arbitrary resource noise.
37. Patch/upgrade based on exposure/support/risk; neither “always latest” nor “never touch stable” is a universal rule.
38. Treat cost as an engineering constraint without sacrificing required security/reliability.
39. Define portability by dimension; vendor lock-in is a trade-off, not automatically a defect.
40. Use multi-region/multi-cloud only for modeled requirements that justify their operational complexity.
41. Test the controls that matter in actual runtime state.
42. Keep runbooks accessible under degraded conditions and dry-run material procedures with non-authors.
43. Decommission DNS, data, credentials, network references, IaC, monitoring and billing—not only compute.
44. Keep fast-moving implementation profiles versioned and event-reviewed.
45. Treat standards, frameworks, audits and green CI as evidence—not substitutes for engineering judgment and demonstrated behavior.

---

# Change log

## V2.0 — 2026-09-27

Research-audited successor to V1.

Material changes:

- current 2026 source-status corrections;
- desired/provider/runtime state model;
- explicit IaC state/concurrency/drift control;
- recovery bootstrap/break-glass model;
- failure-domain/recovery dependency graph;
- failback/reconciliation;
- scoped default-deny/encryption controls;
- identity-class separation;
- management-plane inventory;
- DNS/cert/time/MTU dependencies;
- expanded container supply chain;
- Kubernetes moved to versioned profile;
- autoscaling/overload feedback controls;
- admin hierarchy/landing-zone standard;
- portability/concentration model;
- decommission closure evidence;
- full anti-folklore and assurance layers.

**Status:** `REVIEWED`. Promotion to `TESTED`/`VALIDATED` requires representative non-author execution and field evidence under the Master Playbook Standard.
