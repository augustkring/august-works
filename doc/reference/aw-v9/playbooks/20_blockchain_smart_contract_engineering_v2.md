# 20 — Blockchain & Smart Contract Engineering — V2.0
## High-assurance Golden Master for smart contracts, keys, signing, custody, upgrades, economic security, verification, and irreversible distributed state

```yaml
document_id: PB-20-BLOCKCHAIN
title: 20 — Blockchain & Smart Contract Engineering
artifact_type: domain_capability_playbook
primary_archetype: hybrid
version: "2.0"
release_label: RESEARCH_AUDITED_GOLDEN_MASTER
status: REVIEWED
created: 2026-09-27
last_updated: 2026-09-27
last_reviewed: 2026-09-27
evidence_cutoff: 2026-09-27
research_level: R4_CRITICAL
rigor_level: L4_CRITICAL
engineering_criticality_default: C3_HIGH_ASSURANCE
volatility: FAST
canonical_language: English
owner: TBD_BY_ADOPTING_ORGANIZATION
independent_review_required_for_validation: true
field_execution_required_for_validation: true
next_scheduled_review: 2026-12-27
review_triggers:
  - material chain or protocol hard fork
  - cryptographic break or security advisory
  - compiler/runtime semantic change
  - wallet, custody, HSM, MPC, or signing-stack change
  - bridge/oracle/security incident
  - upgrade/governance architecture change
  - material new attack class
  - authoritative standard or specification revision
  - regulation or contractual requirement change
supersedes:
  - PB-20-BLOCKCHAIN-V1-DRAFT
applies_to:
  - smart contracts
  - blockchain programs
  - wallets and smart accounts
  - protocol-controlled assets
  - key management and signing
  - custody and treasury systems
  - upgrade and governance mechanisms
  - token and vault logic
  - oracle-dependent systems
  - bridges and crosschain messaging
  - onchain/offchain hybrid systems
out_of_scope:
  - investment advice
  - token price forecasts
  - legal opinions
  - consensus-protocol cryptographic proofs beyond the system being engineered
  - chain-specific certification claims not explicitly named
```

> **Release-status note.** This is a research-audited V2 Golden Master, not a claim of external certification or field validation. Under the governing Master Playbook Standard, R4 guidance requires appropriately independent review, test evidence, audit-grade traceability, and representative execution before it can honestly be called `VALIDATED` [S00].

---

# Executive standard

Blockchain engineering is ordinary software engineering under unusually severe combinations of **public adversarial execution, cryptographic authority, financial incentives, distributed ordering, immutable or difficult-to-reverse state, composability, and operational irreversibility**.

The high-assurance doctrine is:

> **Treat every value-bearing state transition as a security decision; every signature as an authorization over exact intent; every privileged key as a production control plane; every upgrade path as equivalent to the maximum authority it can install; every external data source as an adversarial dependency; and every irreversible action as requiring stronger pre-release evidence because ordinary rollback may not exist.**

The durable sequence is:

```text
INTENT / ASSET / AUTHORITY
→ THREAT + ECONOMIC MODEL
→ INVARIANTS + STATE MACHINE
→ KEY / SIGNING / CUSTODY DESIGN
→ IMPLEMENTATION WITH EXPLICIT TRUST BOUNDARIES
→ ADVERSARIAL + FORMAL + ECONOMIC VERIFICATION AS JUSTIFIED
→ INDEPENDENT REVIEW
→ IDENTIFIED ARTIFACT + DEPLOYMENT PROVENANCE
→ PROGRESSIVE ECONOMIC EXPOSURE
→ FINALITY-AWARE OPERATION + RECONCILIATION
→ INCIDENT CONTAINMENT + FORENSIC EVIDENCE
→ COMPENSATION / MIGRATION / RECOVERY
→ LEARNING + CONTROLLED EVOLUTION
```

The inherited engineering master explicitly escalates assurance for **irreversible high-value state, fraud/financial integrity, and cryptographic/key custody**, and it treats verification methods as risk-driven rather than ritualized [S01].

## V2 decisive conclusions

1. **“Onchain” does not remove trust; it relocates and makes trust boundaries inspectable.**
2. **A private key is not just a secret. It is an authorization capability with lifecycle, recovery, revocation, and human-system dependencies.**
3. **A multisig threshold alone is not evidence of independent custody.** Independence must be evaluated across operators, devices, organizations, recovery paths, providers, software, and policy.
4. **MPC/threshold signing is not automatically safer than conventional multisig.** Assurance depends on the protocol, implementation, DKG/key generation, shares, recovery, liveness assumptions, and operational independence [S04][S05].
5. **The weakest path to equivalent authority determines effective security.** A hardened treasury is not protected if one weaker upgrade, recovery, cloud-IAM, or emergency path can install equivalent power.
6. **“Audit passed” is not a meaningful terminal state.** Audits sample a code version and threat model; residual risk, post-audit changes, deployment identity, and operating controls remain first-class.
7. **Formal verification proves scoped claims under assumptions.** It does not prove that the specification is the right specification, that the deployed artifact matches the model, or that economic assumptions remain valid [S16].
8. **Economic security is part of correctness.** Flash liquidity, transaction ordering, MEV, governance capture, oracle manipulation, liquidation dynamics, and incentive discontinuities can violate business invariants while every function behaves “as coded.”
9. **Finality is a policy input, not a synonym for “transaction seen.”** Systems must define confirmation/finality thresholds per operation and reorg behavior [S25].
10. **Crosschain systems inherit multiple finality, relayer, validator, custody, RPC, and smart-contract trust domains.**
11. **Upgradeability trades one irreversibility problem for an authority/governance problem.** Neither immutable nor upgradeable is universally superior.
12. **Rollback language must be literal.** When state cannot be reverted, recovery means compensation, migration, isolation, governance action, or chain-specific exceptional mechanisms—not fictional database rollback.
13. **Progressive exposure should constrain value at risk, not only user count.**
14. **Operational monitoring must reconcile state and assets independently; event logs alone can lie by omission, corruption, RPC divergence, or implementation defect.**
15. **Platform-specific semantics matter.** EVM, Solana, Aptos/Move and Sui/Move require different execution and authority models; universal controls must not be disguised EVM folklore.

---

# 1. Purpose, outcomes, and governing inheritance

This playbook operationalizes the Master Playbook Standard [S00] and the Universal Software & AI Engineering Master Playbook [S01] for blockchain and smart-contract systems.

It exists to enable engineering teams, security reviewers, protocol designers, key custodians, operators, and governance owners to:

- define protected assets, authority, and unacceptable failure;
- design state transitions and permissions explicitly;
- prevent unauthorized or economically invalid state;
- manage cryptographic keys and signing with lifecycle controls;
- choose custody architecture proportionate to consequence;
- design safe upgrade, governance, and emergency mechanisms;
- verify smart contracts/programs against functional, security, economic, and state invariants;
- release identified code with provenance and controlled economic exposure;
- operate against explicit finality, oracle, bridge, and reconciliation policies;
- contain incidents when irreversible state or privileged keys are involved;
- preserve evidence and learn without misrepresenting assurance.

## 1.1 Governing rules inherited from Playbook 00

The following inherited rules are non-negotiable unless a stronger scoped requirement supersedes them:

- rigor increases with consequence, irreversibility, uncertainty, financial materiality, security impact, and blast radius [S00];
- R4 work requires formal standards where applicable, independent review, test evidence, audit trail, and explicit risk acceptance for unresolved material uncertainty [S00];
- material requirements/claims/controls/tests must be traceable at R4 [S00];
- machine-executable or automated actions need explicit permissions, approvals, idempotency/concurrency controls, provenance, monitoring, and stop/recovery paths where relevant [S00];
- live secrets/private keys must not be embedded in playbooks or operational documentation [S00];
- `MUST`, `SHOULD`, and `MAY` express this house standard’s normative strength; they do not automatically express evidence certainty [S00].

## 1.2 Non-goals

This playbook does not:

- claim that one blockchain, VM, language, wallet, multisig product, HSM, MPC vendor, bridge, oracle, or audit firm is universally best;
- guarantee economic safety because code is memory-safe, formally verified, or audited;
- treat consensus finality as equivalent across chains;
- replace legal/regulatory advice, financial risk management, or domain-specific safety obligations;
- recommend asset purchase, issuance valuation, or investment strategy.

---

# 2. How to use this playbook

Use four reading layers.

| Layer | Question | Core sections |
|---|---|---|
| Orientation | What are we protecting and why is this high assurance? | 1–6 |
| Decision | Which architecture/control fits the actual risk? | 7–21, 29 |
| Execution | What must be built, reviewed, signed, released, monitored? | 22–31 |
| Assurance | Why should this be trusted and what remains uncertain? | 32–38 |

For a material production system, start with:

1. §5 System boundary, assets, authority;
2. §6 Criticality and assurance;
3. §7 Threat and economic model;
4. §8 Golden standards;
5. §9–§20 domain architecture controls;
6. §22 verification strategy;
7. §26 release;
8. §27 operation/reconciliation;
9. §32 assurance package;
10. §35 release checklist.

---

# 3. Evidence and research standard

## 3.1 Research posture

This playbook uses an R4 critical research posture because failures can combine:

- irreversible/high-value state;
- direct financial loss;
- private-key compromise;
- public exploitability;
- large blast radius;
- governance capture;
- cross-system contagion;
- difficult or impossible restoration.

Evidence is claim-fit rather than brand-fit. Source classes answer different questions:

| Evidence lane | Strongest use |
|---|---|
| Binding law/contract | scoped mandatory requirement |
| Formal/consensus standard | normative definition or assurance baseline |
| Protocol/EIP/platform specification | exact protocol or platform semantics |
| Government/industry security guidance | control framework and threat model |
| Peer-reviewed/formal/empirical research | mechanism, attack, or effect evidence |
| Mature operational documentation | implementation behavior and runbook detail |
| Practitioner/security guidance | useful contextual patterns requiring corroboration |

## 3.2 Claim labels

Use the Master Playbook labels:

- `REQ` — externally required in scope;
- `EST` — well-established engineering practice;
- `DEF` — recommended default;
- `CTX` — context-dependent;
- `EMG` — emerging / incomplete evidence;
- `HOUSE` — deliberate internal synthesis;
- `EXP` — experiment;
- `UNK` — important unresolved question.

## 3.3 Source-status discipline

Current/draft status is part of the evidence.

At this cutoff:

- NIST SP 800-57 Part 1 Rev. 5 remains final; Rev. 6 is an Initial Public Draft [S02][S03];
- NIST IR 8214C is final and provides current threshold-cryptography guidance for multi-party threshold schemes [S04];
- EEA EthTrust Security Levels v3 is the current approved EEA smart-contract security specification [S08][S11];
- EEA Crosschain Security Guidelines v1 and DeFi Risk Assessment Guidelines v1 remain current listed EEA specifications [S09][S10][S11];
- OWASP SCSVS is useful but alpha/fast-moving; it MUST NOT be represented as a mature final certification standard [S12];
- ERC-1967 is Final; ERC-1822 is Stagnant and MUST NOT be promoted as a universal upgrade standard [S22][S23].

---

# 4. Canonical domain model

A blockchain system is not “the contract.” Model at least these planes:

```text
HUMAN / ORGANIZATIONAL PLANE
  operators
  signers
  approvers
  governance
  recovery authorities
  vendors / service providers

KEY / IDENTITY PLANE
  seed / secret / shares
  hardware wallets / HSM / KMS
  MPC / threshold systems
  account abstraction / smart accounts
  recovery / rotation / revocation

CLIENT / INTENT PLANE
  frontend
  wallet UI
  transaction builder
  simulation
  RPC
  policy engine
  signing display

ONCHAIN EXECUTION PLANE
  contract / program code
  state / accounts / storage
  permissions
  proxies / loaders / upgrade mechanisms
  tokens / vaults / bridges

EXTERNAL-DEPENDENCY PLANE
  oracle feeds
  sequencers
  relayers
  validators / bridges
  keepers / automation
  RPC / indexers
  offchain databases/services

ECONOMIC PLANE
  liquidity
  collateral
  liquidation
  fees
  incentives
  governance voting power
  MEV / ordering
  flash liquidity

ASSURANCE / OPERATIONS PLANE
  source repository
  compiler / build
  CI
  tests / formal models
  audits / bounty
  deployed-code verification
  monitoring / reconciliation
  incident response
```

Security claims that omit one of the planes materially used by the system are incomplete.

---

# 5. System boundary, assets, and authority

## 5.1 Asset inventory

Inventory assets before architecture.

```yaml
asset:
  identifier:
  type: native_asset | token | claim | credential | governance_power | data | code_authority
  value_or_consequence:
  source_of_truth:
  owner_or_beneficiary:
  authorized_mutations:
  irreversible_mutations:
  dependencies:
  recovery_or_compensation:
  monitoring:
```

Include:

- native tokens;
- ERC/SPL/Move assets;
- vault shares;
- bridge-minted claims;
- debt/collateral positions;
- governance votes/delegations;
- signer secrets and shares;
- upgrade/admin capabilities;
- oracle configuration;
- allowlists/denylists;
- protocol accounting state.

## 5.2 Authority inventory

Authority MUST be modeled as capabilities, not job titles.

```yaml
authority:
  action:
  principal_or_quorum:
  technical_enforcement:
  maximum_effect:
  preconditions:
  time_delay:
  value_limit:
  recovery_path:
  revocation:
  observability:
  independent_of_primary_path:
```

Enumerate at least:

- spend/transfer;
- mint/burn;
- pause/unpause;
- upgrade/install code;
- change implementation;
- change oracle;
- change fee/risk parameters;
- add/remove signers;
- change thresholds;
- recovery;
- rotate keys;
- change bridge validators/relayers;
- bypass normal governance;
- seize/freeze where supported.

## 5.3 Effective-authority rule

**HOUSE / HIGH confidence**

> **Effective authority equals the weakest credible path that can produce equivalent consequence.**

Examples:

- a 4-of-7 treasury is effectively weaker if a 1-of-1 upgrade key can install code that drains it;
- hardware signers are weakened if cloud IAM can reset the signer policy;
- a time-locked governor is weakened if an emergency role can upgrade instantly;
- threshold custody is weakened if recovery recombines full authority under one operator.

Every C3/C4 design MUST produce an **equivalent-authority graph** and review the weakest path.

---

# 6. Criticality and assurance model

The engineering master requires assurance to rise with consequence, exposure, irreversibility, uncertainty, blast radius, and weak recoverability [S01].

## 6.1 Blockchain assurance levels

### B0 — Experimental

Use only when:

- no material funds;
- no sensitive keys with production authority;
- no user reliance;
- disposable test state.

Minimum:

- explicit non-production label;
- isolated test keys;
- basic automated tests;
- no production secrets.

### B1 — Limited consequence

Typical:

- small bounded value;
- limited internal use;
- recoverable offchain compensation.

Adds:

- threat review;
- code review;
- reproducible deployment steps;
- monitored roles/keys.

### B2 — Material

Typical:

- customer funds or material treasury;
- public contract;
- meaningful token/financial state.

Adds:

- explicit invariants;
- adversarial tests;
- signer/custody design review;
- upgrade/governance review;
- independent security review;
- progressive value limits;
- monitoring and reconciliation.

### B3 — High assurance

Typical:

- large assets;
- core custody;
- protocol solvency;
- bridge/oracle dependence;
- privileged code upgrade.

Adds:

- independent specialist review;
- multiple assurance modalities;
- cryptographic/custody architecture review;
- formal/specification methods for critical properties where feasible;
- independent deployment verification;
- incident rehearsal;
- recovery-path testing;
- audit-grade traceability.

### B4 — Critical / systemic

Typical:

- catastrophic loss potential;
- systemically important custody/bridge;
- safety/critical-infrastructure consequence;
- very high irreversible exposure.

Adds:

- qualified domain/cryptographic specialists;
- formalized change board / segregation of duties;
- independent assurance across code, key systems, governance, economics, and operations;
- adversarial exercises;
- strongest feasible evidence of model-to-implementation and source-to-deployment equivalence;
- explicit residual-risk acceptance by accountable authority.

## 6.2 Escalation triggers

Escalate at least one level when any of these become material:

- unilateral upgrade authority;
- high-value hot keys;
- bridge mint/burn authority;
- oracle-dependence with liquidation or minting;
- permissionless external callbacks/composability;
- custom cryptography;
- novel economic mechanism;
- crosschain settlement;
- irreversible migration;
- new compiler/runtime or immature toolchain;
- unverifiable deployed code;
- ambiguous finality;
- emergency role capable of bypassing normal governance.

---

# 7. Threat, failure, and economic model

## 7.1 Adversary classes

Threat-model:

- external attacker;
- malicious/compromised signer;
- insider;
- colluding quorum;
- compromised recovery operator;
- malicious governance majority;
- flash-capital attacker;
- MEV/searcher/block-builder/sequencer adversary;
- oracle/data-source manipulator;
- bridge validator/relayer compromise;
- frontend/supply-chain attacker;
- RPC/indexer attacker;
- cloud/IAM compromise;
- dependency/compiler/toolchain compromise;
- user phishing/social engineering;
- governance voter bribery/rented voting power;
- protocol-integrator with surprising token behavior.

## 7.2 Failure classes

Model non-malicious failures too:

- key loss;
- signer unavailable;
- share corruption;
- clock/time-window error;
- nonce desynchronization;
- wrong chain/network;
- stale oracle;
- chain halt;
- deep reorg;
- sequencer outage;
- contract initialization error;
- storage-layout corruption;
- arithmetic/rounding error;
- incorrect decimal scaling;
- partial migration;
- front-end encoding defect;
- RPC returns stale/forked state;
- event/indexer divergence;
- governance deadlock;
- pause/unpause deadlock;
- bridge message duplication;
- message delivered out of order;
- upgrade incompatible with old state;
- compiler bug.

## 7.3 Economic threat model

For every value-bearing mechanism identify:

```yaml
economic_invariant:
attacker_capital:
borrowable_atomic_capital:
governance_power_available:
ordering_advantage:
oracle_influence:
time_horizon:
external_market_depth:
liquidation_path:
profit_function:
cost_of_attack:
loss_given_attack:
circuit_breakers:
residual_risk:
```

Do not use “cost of attack” if the attacker can borrow capital atomically, recoup principal inside the transaction, bribe ordering, or capture governance temporarily [S44][S45].

---

# 8. Golden blockchain engineering standards

1. **Define assets, authority, state, and unacceptable failure before selecting a chain or contract pattern.**
2. **Increase assurance with irreversible value at risk, not with contract line count.**
3. **Treat cryptographic authority as production infrastructure.**
4. **Treat the weakest equivalent-authority path as the effective security boundary.**
5. **No live secret, private key, seed, recovery phrase, or reconstructable secret material belongs in source code, tickets, playbooks, logs, prompts, screenshots, or ordinary chat.**
6. **Design key generation, storage, use, rotation, backup, recovery, revocation, and destruction as one lifecycle [S02].**
7. **Do not claim multisig independence from threshold alone.**
8. **Do not claim MPC/threshold security from vendor labels alone; define protocol and adversary assumptions [S04][S05].**
9. **Separate signer identity from authorization policy; possession of a key does not by itself justify the action.**
10. **The bytes signed MUST encode the intended action unambiguously enough for the signer/policy system to verify.**
11. **Every offchain authorization MUST define replay boundaries appropriate to its domain.**
12. **EIP-712 structured data is not replay protection by itself [S18].**
13. **Contract-account signature validity can change over time; cache/authorization logic MUST account for this when ERC-1271-like validation is used [S20][S27].**
14. **Make state invariants explicit before implementation.**
15. **Model privileged state transitions as a state machine or equivalent enforceable policy.**
16. **Initialization is a privileged state transition and MUST be single-use or otherwise safely controlled.**
17. **External calls are adversarial boundaries unless the contract and exact semantics are trusted.**
18. **Do not generalize EVM reentrancy controls to execution environments with different state/ownership models.**
19. **Do not generalize Solana account authority or PDA semantics to EVM/Move.**
20. **Do not generalize Move resource safety into business/economic safety.**
21. **Use platform-native ownership/capability semantics instead of emulating another VM’s mental model.**
22. **Immutable and upgradeable architectures are both contextual choices.**
23. **The security class of an upgrade mechanism equals the maximum effect of code it can install.**
24. **Storage/state compatibility for upgrades MUST be machine-checked where mature tooling exists and independently reviewed for high-value changes [S29].**
25. **Emergency upgrade paths MUST NOT silently bypass governance invariants without explicit, separately accepted risk.**
26. **Timelocks improve review/exit opportunity but add liveness and governance complexity; they are not absolute safety [S30][S31].**
27. **Pause mechanisms require an allowed-actions matrix and an independently verified unpause/recovery design.**
28. **Unpause SHOULD require at least as much assurance as pause when resuming can restore economic exposure.**
29. **Token integrations MUST test actual token semantics rather than assuming ideal ERC/SPL behavior.**
30. **Rounding direction is a financial policy decision, not an implementation detail.**
31. **Test zero, near-zero, first-user, last-user, donation, repeated-rounding, and decimal-scaling cases for share/accounting systems [S32].**
32. **Oracle quality includes source quality, market depth, freshness, operating hours, concentration, liveness, and deprecation—not just a contract address [S40].**
33. **Oracle consumers MUST define stale/missing/invalid/sequencer-down behavior [S40][S41].**
34. **Randomness derived from public predictable state MUST NOT be treated as unpredictable when adversaries can observe or influence it.**
35. **Economic correctness MUST be tested under maximum practical atomic composability and ordering advantage.**
36. **MEV/order dependence is a correctness consideration when order changes value or outcome [S44].**
37. **Finality MUST be an executable policy with chain-specific thresholds and reorg handling [S25].**
38. **“Confirmed” and “finalized” MUST be defined by the chain/protocol and business consequence.**
39. **Crosschain systems MUST model each chain’s finality and the bridge’s own validation/custody mechanism [S09].**
40. **Crosschain messages MUST bind source, destination, sender/domain, payload, nonce/identifier, and replay semantics as appropriate.**
41. **Bridge accounting MUST reconcile minted/escrowed/burned/released claims independently.**
42. **A source-code publication is not proof that deployed bytecode/program data matches the reviewed artifact.**
43. **Separate source verification, reproducible build evidence, deployment provenance, and runtime/deployed identity [S17].**
44. **Compiler/runtime version and known-bug status MUST be part of the release evidence [S15].**
45. **A security audit is one evidence source, not a security certificate.**
46. **Post-audit changes MUST receive explicit diff review and applicable re-verification.**
47. **Independent reviews SHOULD avoid correlated blind spots by varying reviewers/tools/methods when consequence justifies it.**
48. **Formal-method evidence MUST state properties, assumptions, tool/version, unresolved/unknown results, and model-to-implementation linkage.**
49. **Do not claim “formally verified system” when only a model or subset of properties was checked [S16].**
50. **Release exposure SHOULD be limited by economic value at risk, not only traffic/user percentage.**
51. **Deployment MUST identify the exact reviewed artifact and authority used to deploy it.**
52. **Post-deployment checks MUST verify code/program identity, roles, implementation pointers, initialization, configuration, and expected invariants.**
53. **Monitoring MUST include independent state/asset reconciliation, not only event alerts.**
54. **Incident response MUST preserve transaction, state, code, config, signer, approval, and communication evidence.**
55. **Do not promise rollback where the chain/system cannot revert state.**
56. **Design compensation, migration, isolation, and governance recovery before funds are at risk.**
57. **Key recovery MUST be no weaker than the risk accepted for normal custody—or the weakness MUST be explicit and compensated.**
58. **Key backups must satisfy confidentiality, integrity, and recoverability simultaneously.**
59. **Frontend/RPC integrity is part of signing safety; signers SHOULD independently decode and verify high-value intent.**
60. **Onchain privacy assumptions MUST treat public durable data as potentially permanent and indexable.**
61. **Security controls MUST remain operable during degraded conditions such as signer loss, chain congestion, oracle outage, or RPC failure.**
62. **Every accepted residual risk MUST have an owner, rationale, monitoring/review trigger, and expiry/revisit condition where possible.**

---

# 9. Irreversible distributed state, finality, and reorgs

## 9.1 State-finality specification

For every consequential operation define:

```yaml
operation:
source_chain:
state_transition:
accepted_confirmation_state:
economic_finality_threshold:
reorg_depth_considered:
business_action_before_finality:
business_action_after_finality:
reorg_response:
crosschain_dependency:
manual_override:
```

Examples of operations requiring different thresholds:

- UI acknowledgment;
- withdrawal availability;
- bridge minting;
- governance execution;
- custody settlement;
- collateral crediting;
- irreversible offchain fulfillment.

## 9.2 Finality policy

A production system MUST NOT reduce finality to one hard-coded “N confirmations” value without chain-specific justification.

Ethereum proof-of-stake finality uses checkpoint voting and has materially different security properties from probabilistic confirmation rules on other chains [S25]. Other chains may expose “processed/confirmed/finalized,” BFT commit, epochs, or different fork-choice/finality concepts.

## 9.3 Reorg behavior

For every indexed/onchain-derived offchain system:

- store block/hash provenance;
- detect canonicality changes;
- make derived state replayable/reconcilable;
- avoid irreversible offchain action before the required finality threshold;
- define compensation if action precedes finality intentionally.

## 9.4 Compensation, not fictional rollback

Where onchain state cannot be reverted:

```text
DETECT
→ CONTAIN NEW EXPOSURE
→ PRESERVE EVIDENCE
→ IDENTIFY CANONICAL STATE
→ PAUSE / REVOKE / RATE-LIMIT IF AVAILABLE
→ COMPENSATE OR MIGRATE
→ RECONCILE
→ GOVERNANCE / USER COMMUNICATION
→ REOPEN UNDER VERIFIED CONDITIONS
```

If a chain has an exceptional social/governance recovery mechanism, treat it as an extraordinary ecosystem event, not an application rollback primitive.

---

# 10. Cryptographic key lifecycle

NIST SP 800-57 provides the core lifecycle framing for cryptographic key management [S02]. Blockchain custody adds public adversarial value and often direct bearer-like authority.

## 10.1 Key classes

Inventory separately:

- treasury spend key;
- contract owner/admin;
- proxy admin / upgrade authority;
- governance proposer;
- governance executor;
- pause guardian;
- unpause/recovery;
- oracle admin;
- bridge validator/relayer;
- deployer;
- package/program upgrade authority;
- CI/release signing key;
- API/service credential used in transaction construction;
- HSM/KMS/MPC administrative identities.

## 10.2 Key lifecycle

Every material key/share MUST define:

```yaml
key_id:
purpose:
scheme:
generation_method:
entropy_source:
generated_where:
custody_type:
authorized_signers_or_quorum:
usage_policy:
transaction_limits:
network/domain_restrictions:
backup:
recovery:
rotation:
revocation:
compromise_detection:
audit_log:
destruction:
owner:
```

## 10.3 Generation

For C3/C4 authority:

- generation MUST use an approved/assessed cryptographic mechanism appropriate to the environment;
- secret material MUST NOT pass through uncontrolled clipboard, screen recording, logging, shell history, or collaboration systems;
- DKG/threshold generation MUST record participants, protocol, identities, transcript/evidence policy, and failure handling;
- test/production generation MUST be separated.

FIPS 140-3 validated modules can be relevant when cryptographic-module assurance is required by policy/regulation, but FIPS validation is not a universal blockchain custody requirement and does not prove the overall custody system is safe [S06].

## 10.4 Rotation and revocation

Rotation MUST distinguish:

- cryptographic key rotation;
- signer membership change;
- threshold change;
- smart-account owner update;
- governance-role update;
- upgrade-authority transfer;
- revocation of service/cloud identity.

A key is not safely rotated if equivalent old authority remains reachable through recovery, cached sessions, delegated permissions, old modules, or onchain roles.

---

# 11. Custody architecture and signing authority

## 11.1 Custody decision factors

Do not choose custody by brand. Evaluate:

| Factor | Questions |
|---|---|
| Consequence | Maximum loss/authority? |
| Online need | Must signing be real-time? |
| Frequency | How often is signing needed? |
| Human review | Can intent be reviewed before signature? |
| Independence | Are signers truly independent? |
| Availability | What signer loss/outage is tolerated? |
| Recovery | Who can recover/reconstitute authority? |
| Compliance | HSM, audit, locality, policy requirements? |
| Automation | Can machines initiate or approve? |
| Upgrade equivalence | Can another key bypass custody through code/governance? |

## 11.2 Single-key custody

Single-key production authority MAY be acceptable only when consequence is tightly bounded and compensating controls make the residual risk explicit.

For material funds or code authority, a single uncontrolled hot key is normally insufficient.

## 11.3 Multisig assurance

For each quorum evaluate independence across:

```yaml
cryptographic_independence:
device_independence:
operator_independence:
organizational_independence:
physical_location_independence:
network_independence:
wallet_software_independence:
provider_independence:
recovery_independence:
approval_policy_independence:
```

A nominal 3-of-5 where five keys are on one cloud account, controlled by one operator, recovered by one email identity is not equivalent to independent 3-of-5 custody.

## 11.4 MPC / threshold-signature assurance

NIST’s threshold-cryptography work makes explicit that multi-party threshold schemes have protocol-specific security and deployment assumptions [S04][S05].

For C3/C4 MPC/threshold custody record:

```yaml
signature_scheme:
threshold_protocol:
security_model:
adversary_model:
threshold:
participants:
dkg_or_key_generation:
share_storage:
share_refresh:
resharing_membership_change:
nonce_generation:
transcript_or_audit_evidence:
availability_assumptions:
recovery_model:
backup_model:
fallback_path:
implementation_version:
cryptographic_review:
operational_independence:
```

MUST NOT claim:

- “no single point of failure” merely because shares exist;
- “non-custodial” merely because no one stores the reconstructed key;
- “hardware-backed” as proof of protocol correctness;
- “threshold” as proof that recovery/administration cannot bypass threshold.

## 11.5 Recovery equivalence

Recovery MUST be threat-modeled as a privileged control plane.

Check:

- Can recovery reduce threshold?
- Can one administrator replace signers?
- Can identity proofing be socially engineered?
- Can backup shares be combined under one organization?
- Does disaster recovery introduce plaintext key material?
- Is recovery rehearsed without exposing secrets?

## 11.6 Segregation of duties

For C3/C4, separate where feasible:

- transaction proposer;
- policy checker;
- human/business approver;
- signer;
- broadcaster;
- reconciler;
- custody administrator;
- upgrade developer;
- upgrade approver;
- incident commander.

Segregation is about independent authority, not merely different usernames.

---

# 12. Intent integrity, signing, and replay resistance

## 12.1 Signing invariant

> **The authorized semantic action MUST match the exact message/transaction that is signed and broadcast.**

The signing system SHOULD make these independently verifiable:

- chain/network;
- account;
- target program/contract;
- function/instruction;
- asset;
- amount;
- recipient;
- fee/limits;
- nonce/replay domain;
- expiry/deadline;
- delegate/allowance;
- embedded arbitrary data;
- upgrade code hash / implementation address where relevant.

## 12.2 High-value signing flow

```text
REQUEST
→ CONSTRUCT
→ DECODE TO HUMAN/POLICY SEMANTICS
→ FETCH INDEPENDENT STATE
→ SIMULATE WHEN RELIABLE
→ POLICY CHECK
→ APPROVE
→ SIGN
→ BROADCAST
→ VERIFY INCLUSION + FINALITY
→ VERIFY POSTCONDITIONS
→ RECONCILE
```

A compromised frontend or RPC can alter intent before signing. For C3/C4, the final review SHOULD rely on an independently derived decoding/state source where practical.

## 12.3 Replay-resistance checklist

Offchain authorization SHOULD bind enough context that the signature is not valid outside its intended domain:

- protocol/application domain;
- version;
- chain/network;
- verifying contract/program or account domain;
- action/type;
- resource/object;
- amount/limit;
- recipient;
- nonce/sequence;
- expiry;
- unique request/order ID.

EIP-712 provides typed structured signing but explicitly does **not** itself provide replay protection [S18]. EIP-155 provides chain-ID replay protection for legacy Ethereum transaction signing contexts [S19].

ERC-4337 smart-account flows include chain/EntryPoint and nonce-related replay considerations in their validation model [S21].

## 12.4 Contract signatures

ERC-1271 enables contracts to validate signatures [S20].

Security implications:

- validity may depend on current contract state;
- signer ownership/threshold can change;
- previously valid signatures can become invalid;
- a contract can be upgraded if architecture permits;
- cached “signature valid forever” assumptions can be wrong.

Authorization designs MUST state whether validation is evaluated:

- at creation time;
- at execution time;
- at both;
- against a snapshot or current state.

---

# 13. Smart-contract/program design and invariants

## 13.1 Invariant-first specification

Write invariants before functions.

Examples:

```text
total_claims <= backing_assets
user_withdrawable <= user_entitlement
minted_bridge_supply == canonical_locked_or_burned_backing ± explicitly modeled in-flight state
unauthorized_principal cannot install code
paused_state cannot execute value-increasing risky actions
protocol_equity >= required_solvency_floor
share_price transition obeys specified rounding and donation policy
nonce never authorizes the same semantic action twice
```

Classify each invariant:

- local function;
- contract/program;
- multi-contract;
- crosschain;
- accounting/economic;
- authorization;
- liveness;
- temporal.

## 13.2 State-machine standard

For consequential state:

```yaml
states:
transitions:
authorized_actor_per_transition:
preconditions:
postconditions:
forbidden_transitions:
timeouts:
emergency_transitions:
recovery_transitions:
events_or_observability:
```

## 13.3 Initialization

Initialization MUST define:

- who can initialize;
- when initialization can happen;
- initial roles;
- initial implementation;
- initial oracle/parameters;
- whether initialization can be repeated;
- safe behavior if deployment and initialization are separate.

Upgradeable deployments MUST verify initialized state after deployment.

## 13.4 External interaction

Before an external call/instruction/CPI/integration:

- identify callback/reentrancy behavior for that platform;
- define asset/token side effects;
- define failure behavior;
- bound returned data/resource use;
- avoid trusting return values without semantic validation;
- preserve internal invariants if the external component reverts/fails/changes behavior.

---

# 14. Platform execution profiles

Universal principles remain the same; implementation controls differ.

## 14.1 EVM / Solidity profile

### Security semantics to model

- reentrancy and cross-function/cross-contract callback paths;
- `delegatecall` context and storage authority;
- proxy implementation/admin slots;
- initialization;
- allowance/delegation semantics;
- fallback/receive behavior;
- arithmetic/precision/rounding;
- gas/resource assumptions;
- transaction ordering/MEV;
- signature domain/replay;
- token quirks;
- self-destruct/version semantics;
- compiler known bugs.

Solidity’s security guidance remains an important primary source for language/runtime hazards [S14].

### Reentrancy

Do not reduce reentrancy to “use a guard.”

Review:

- state changes before/after calls;
- view/read-only reentrancy where integrations infer state mid-call;
- callbacks from ERC-777-like or hook-enabled assets;
- multi-function reentrancy;
- cross-contract shared-state reentrancy;
- reentrancy through upgradeable/delegatecall layers.

### `delegatecall`

`delegatecall` gives called code execution in the caller’s storage/context. Treat any ability to select or install delegated code as equivalent to the maximum privileged state mutation it can perform.

### Proxy storage

ERC-1967 standardizes specific proxy storage slots and related events [S22]. Upgrade tooling MUST validate layout compatibility and proxy safety where applicable [S29].

### SELFDESTRUCT freshness rule

Under EIP-6780, `SELFDESTRUCT` semantics changed materially: outside creation-transaction conditions it no longer generally deletes code/storage as older folklore assumes [S24].

Therefore:

- security review MUST use semantics for the exact target fork/runtime;
- do not rely on old “destroy and redeploy” patterns;
- treat opcode/runtime changes as freshness triggers.

### Compiler evidence

Release evidence MUST record:

```yaml
compiler:
version:
optimizer:
optimizer_runs_or_equivalent:
evm_target:
libraries:
metadata_settings:
known_bug_review:
build_hash:
```

Solidity publishes known compiler bugs and metadata/source-verification behavior [S15][S17].

## 14.2 Solana profile

Solana separates executable program code from mutable account state; program upgrade authority is a distinct capability [S33][S34].

For each instruction validate:

```yaml
account:
expected_address_or_derivation:
owner_program:
is_signer_required:
is_writable_required:
expected_executable_flag:
expected_data_type_or_discriminator:
expected_relationship_to_other_accounts:
pda_seeds_and_bump_if_applicable:
```

### Account-validation doctrine

MUST validate, as applicable:

- owner;
- signer;
- writable;
- executable;
- PDA derivation/seeds;
- data type/discriminator;
- authority fields inside account data;
- relationship among accounts.

An account passed by the caller is untrusted merely because its shape parses.

### PDA doctrine

PDAs are deterministic off-curve addresses controlled through program invocation semantics, not ordinary private keys [S35].

Security review MUST verify:

- exact seeds;
- namespace/domain separation;
- expected program ID;
- canonical bump policy where applicable;
- no seed collision/semantic aliasing;
- CPI signer authority is bounded to intended action.

### CPI

Cross-program invocation can propagate privileges. Review:

- which accounts are writable;
- which signatures/PDAs are forwarded;
- which callee program is invoked;
- whether a caller can substitute a malicious program/account.

### Upgrade authority

Solana programs can be upgradeable under an upgrade authority, and the authority can be revoked/finalized to make the program immutable [S34].

Treat upgrade authority with the same effective-authority analysis as EVM proxy admins.

### Deployment evidence

Solana production readiness guidance supports verifying deployed program bytes/source relationship and securing the upgrade authority [S37].

## 14.3 Aptos / Move profile

Move’s resource and signer semantics eliminate or change some EVM failure classes but do not eliminate authorization, accounting, governance, oracle, upgrade, or economic risk [S38].

Review:

- `signer`/capability authority;
- resource ownership/movement;
- module/package upgrade policy;
- object/resource access assumptions;
- arithmetic and economic invariants;
- oracle/bridge dependencies;
- transaction replay/domain semantics;
- upgrade compatibility.

Aptos supports package upgrade policies including more restrictive/immutable paths; the exact release/toolchain semantics MUST be checked against current platform documentation [S38].

## 14.4 Sui / Move profile

Sui’s object-centric model differs materially from Aptos despite shared Move ancestry [S39].

Review:

- owned/shared/immutable object semantics;
- capability objects;
- object IDs/versions;
- shared-object concurrency;
- package upgrade mechanisms;
- dynamic fields/collections where material;
- transfer and authority invariants.

Do not transfer an Aptos/EVM checklist mechanically to Sui.

---

# 15. Upgradeability, governance, and immutability

## 15.1 Decision before pattern

Choose among immutable, proxy-based, loader/package upgrade, migration-based, or governance-controlled approaches from failure consequence.

### Prefer stronger immutability when:

- specification is small/stable;
- emergency correction is not essential;
- upgrade authority would dominate trust;
- migration/compensation is feasible;
- users require minimized administrative trust.

### Prefer controlled upgradeability when:

- defect correction is necessary;
- external dependencies/regulation will evolve;
- data/state migration would be riskier than code upgrade;
- governance/custody controls can credibly protect upgrade authority.

Neither is universally safer.

## 15.2 Upgrade authority equivalence

For each upgrade path ask:

> **What is the maximum behavior new code could install?**

If it can:

- transfer funds;
- mint;
- change balances;
- change signature rules;
- bypass pause;
- rewrite governance;
- alter bridge validation;

then the upgrade authority belongs in the corresponding highest security class.

## 15.3 Upgrade safety gate

Every material upgrade MUST include:

```yaml
upgrade_id:
current_code_identity:
new_code_identity:
source_revision:
compiler_build:
storage_or_state_compatibility:
initializer_or_migration:
invariant_delta:
privilege_delta:
external_interface_delta:
economic_model_delta:
formal_properties_rerun:
tests_rerun:
audit_or_review_scope:
post_audit_diff:
governance_approval:
timelock:
execution_authority:
rollback_or_forward_plan:
post_upgrade_checks:
residual_risk:
```

## 15.4 Storage/state compatibility

For proxy/state-preserving upgrades:

- machine-check layout compatibility with mature tooling where possible [S29];
- independently inspect critical state;
- test from representative historical state snapshots;
- test partial/failed migration;
- verify initialization/version guards;
- prohibit accidental slot/type/order corruption.

## 15.5 Emergency upgrades

An emergency upgrade path MUST explicitly document which normal guarantees it bypasses.

If it can bypass:

- quorum;
- timelock;
- review window;
- user exit window;
- formal verification;
- audit;

the bypass is a separate accepted risk and requires compensating controls.

## 15.6 Governance and timelocks

Governance risks include:

- quorum capture;
- borrowed/rented voting power;
- proposal spam;
- proposer privilege;
- malicious executor;
- cancellation abuse;
- timelock bypass;
- upgrade payload substitution;
- governance token concentration;
- voter apathy;
- emergency-role capture.

OpenZeppelin governance/timelock documentation highlights role and liveness implications of proposers, executors, cancellers, and delayed execution [S30][S31].

For C3/C4:

- hash/identify exact executable payload before approval;
- bind approval to chain and target;
- expose proposal diff;
- preserve exit/review time;
- monitor authority/role changes;
- test governance failure/deadlock;
- define emergency governance separately.

---

# 16. Pause, circuit breakers, and emergency control

A pause mechanism is not automatically safe.

## 16.1 Allowed-actions matrix

Define:

| State | Action | Allowed? | Why |
|---|---|---:|---|
| Normal | deposit | yes/no | |
| Normal | withdraw | yes/no | |
| Paused | deposit | yes/no | |
| Paused | withdraw | yes/no | |
| Paused | repay debt | yes/no | |
| Paused | liquidation | yes/no | |
| Paused | governance/upgrade | yes/no | |
| Paused | emergency recovery | yes/no | |

Preserve actions that reduce user/system risk when safe. “Pause everything” can trap users or worsen insolvency.

## 16.2 Pause authority

Define:

- who can pause;
- value/time scope;
- whether one actor can pause;
- how pause is logged;
- how abuse is detected;
- how authority is revoked.

## 16.3 Unpause

Unpause SHOULD require:

- resolved incident/root cause;
- code/config identity check;
- state reconciliation;
- oracle/dependency health;
- signer/governance confirmation;
- explicit reopen decision;
- post-unpause monitoring.

---

# 17. Tokens, assets, accounting, precision, and rounding

## 17.1 Token compatibility matrix

For every integrated asset test/record:

```yaml
asset:
standard_claim:
decimals:
return_value_behavior:
fee_on_transfer:
rebasing:
callbacks_or_hooks:
blacklist_or_freeze:
pause:
mintability:
upgradeability:
permit_or_signature_extensions:
balance_changes_outside_transfer:
nonstandard_transfer_behavior:
admin_risk:
oracle_source:
```

Do not assume all “ERC-20 compatible” assets behave identically.

## 17.2 Accounting invariants

Examples:

```text
assets = liabilities + equity_like_residual
total_user_claims <= realizable_backing
shares_outstanding × pricing_rule reconciles to backing within stated rounding bounds
bridge_minted - burned == canonical_backed_claims ± modeled in_flight
```

Reconcile internal accounting to actual asset balances, not events alone.

## 17.3 Precision and rounding

Specify:

- units/decimals;
- normalization;
- intermediate precision;
- overflow/underflow behavior;
- rounding direction for each operation;
- who benefits from rounding;
- cumulative rounding bound;
- invariant tolerance.

Test:

- zero;
- one minimal unit;
- near-zero denominator;
- huge values;
- first deposit/mint;
- last withdrawal/redemption;
- donation/direct transfer;
- repeated small operations;
- decimal mismatch;
- price near boundaries.

OpenZeppelin’s ERC-4626 guidance documents first-depositor/donation/inflation and rounding concerns as a concrete example of why initialization and rounding are security-relevant [S32].

---

# 18. Oracles, external data, randomness, and automation

## 18.1 Oracle feed register

For every feed:

```yaml
feed:
purpose:
provider:
underlying_data_sources:
aggregation:
market_structure:
liquidity:
concentration:
update_trigger:
heartbeat_or_cadence:
acceptable_staleness:
market_hours:
decimals:
outlier_behavior:
deprecation_process:
sequencer_dependency:
fallback:
circuit_breaker:
consumer_owner:
```

Chainlink’s own current guidance emphasizes data quality, liquidity, market hours, freshness, deprecation, circuit breakers, and consumer responsibility [S40].

## 18.2 Oracle consumer checks

Consumer code MUST define:

- expected feed identity;
- freshness;
- non-zero/valid range;
- decimals/scaling;
- stale/missing behavior;
- extreme deviation behavior;
- sequencer status where relevant;
- market closure behavior;
- fallback or safe halt.

For L2 systems using sequencer uptime feeds, integrate the platform-specific grace-period/recovery logic appropriate to the application [S41].

## 18.3 Manipulation analysis

Model:

- spot vs TWAP;
- observation window;
- liquidity and concentration;
- capital required;
- flash liquidity;
- block/order control;
- MEV/private orderflow;
- cross-market hedging;
- oracle update timing;
- liquidation feedback.

PoS/ordering changes can alter oracle attack assumptions; Uniswap’s published analysis illustrates why older PoW-era assumptions cannot simply be frozen forever [S43].

## 18.4 Randomness

A randomness design MUST state:

```yaml
source:
predictability:
who_can_bias:
who_can_withhold:
commit_reveal_needed:
finality_dependency:
callback_failure:
timeout:
fallback:
economic_value_exposed:
```

Never use public predictable values as secure randomness merely because they are hashes.

## 18.5 Automation/keepers

Automation keys/services must be bounded:

- exact allowed functions;
- value limits;
- rate limits;
- no broad upgrade/admin power unless justified;
- idempotency;
- failure/retry semantics;
- revocation;
- monitoring.

---

# 19. Economic security, MEV, flash liquidity, and governance attacks

## 19.1 Atomic-composability test

For every critical financial invariant ask:

> **Does it still hold if an attacker can borrow the maximum practical capital, call multiple protocols, manipulate ordering, and unwind inside one transaction/block?**

Flash loans are best understood as an atomic-capital amplifier; they expose assumptions that were only safe because ordinary attackers were presumed capital-constrained [S45].

## 19.2 MEV/order-dependence test

For any operation where order matters test:

- front-run;
- back-run;
- sandwich;
- liquidation race;
- auction ordering;
- oracle update ordering;
- governance vote/order interaction;
- bridge message ordering.

MEV literature demonstrates that ordering itself can create extractable value and consensus/market externalities [S44].

Mitigations can include contextually:

- commit/reveal;
- batch auctions;
- bounded slippage;
- private orderflow;
- price limits;
- minimum delay;
- randomization;
- frequent batch clearing;
- protocol redesign.

No mitigation is universal; analyze incentive and liveness effects.

## 19.3 Governance-economic attacks

Model:

- governance token borrowing;
- delegated vote capture;
- bribery;
- low-turnout minority capture;
- proposal payload deception;
- timelock timing;
- veto/guardian capture;
- economic extortion through pause/unpause.

## 19.4 Insolvency and bank-run dynamics

For vault/lending/bridge systems model:

- cascading liquidation;
- oracle discontinuity;
- illiquid collateral;
- redemption queue;
- depeg;
- bridge backing impairment;
- bad debt allocation;
- emergency close behavior.

A contract can be technically correct and economically insolvent.

---

# 20. Crosschain and bridge engineering

EEA’s Crosschain Security Guidelines explicitly frame crosschain systems as multi-component systems including blockchain nodes, relayers/validators, RPC, wallets/key management, smart contracts, and repositories [S09].

## 20.1 Trust decomposition

For each bridge/crosschain system document:

```yaml
source_chain_security:
destination_chain_security:
source_finality_rule:
destination_finality_rule:
validation_model:
validator_or_relayer_set:
custody_model:
admin_upgrade_model:
message_format:
replay_domain:
ordering:
rate_limits:
mint_or_release_authority:
oracle_or_rpc_dependencies:
failure_recovery:
```

## 20.2 Message invariant

A crosschain message SHOULD bind as applicable:

- source chain/domain;
- destination chain/domain;
- source sender/application;
- destination receiver/application;
- payload;
- amount/asset;
- unique message ID/nonce;
- expiry;
- version;
- verification/proof context.

“Message processed once” is insufficient if the same semantic authorization can be replayed on another route/domain/version.

## 20.3 Finality mismatch

Before mint/release on destination:

- define source finality;
- model reorg after relay;
- define relay wait threshold;
- define exceptional chain halt/reorg behavior;
- decide whether destination action can be reversed/compensated.

## 20.4 Value-at-risk controls

Bridges SHOULD use contextually appropriate:

- mint/release caps;
- per-window rate limits;
- per-asset caps;
- validator/relayer limits;
- anomaly detection;
- circuit breakers;
- staged capacity growth.

## 20.5 Backing reconciliation

Independently reconcile:

```text
CANONICAL LOCKED / BURNED / ESCROWED
↔ IN-FLIGHT MESSAGES
↔ DESTINATION MINTED / RELEASED
↔ PENDING / FAILED / REPLAYED MESSAGES
```

A bridge alerting only on contract events is insufficient.

---

# 21. Frontend, RPC, wallet, and transaction-integrity security

The end-user control plane can fail before the smart contract is reached.

Threats include:

- DNS/domain compromise;
- malicious frontend bundle;
- dependency compromise;
- RPC substitution;
- stale/forked RPC;
- wallet phishing;
- address poisoning;
- clipboard replacement;
- transaction simulation spoofing;
- malicious deep link/QR;
- compromised browser extension.

Controls for material signing:

- content/security supply-chain controls;
- multiple RPCs or independent critical-state verification where justified;
- contract/address allowlists;
- human-readable transaction decoding;
- simulation as evidence, not authority;
- hardware-wallet or independent signer display;
- explicit chain/recipient/value verification;
- warning on blind/unparsed calldata;
- out-of-band approval for high-value or authority-changing actions.

---

# 22. Verification, validation, and assurance stack

Testing is evidence, not proof [S01].

## 22.1 Assurance modalities

Use a portfolio matched to failure modes:

| Failure / claim | Strong candidate evidence |
|---|---|
| local business logic | unit/domain tests |
| integration behavior | integration tests |
| protocol/API compatibility | contract/integration tests |
| broad invariants | property/stateful fuzz tests |
| parser/calldata robustness | fuzzing |
| permission/role safety | authorization tests + threat review |
| upgrade layout | machine validation + migration tests |
| concurrency/order | state-machine/model tests |
| critical formal property | SMT/model checking/proof where justified |
| oracle/economic manipulation | economic simulations + adversarial scenarios |
| deployment identity | reproducible build/deployed-code verification |
| key custody | architecture review + ceremony/recovery rehearsal |
| operations | drills + reconciliation |
| crosschain | multi-chain integration/reorg/replay tests |

## 22.2 Stateful/invariant testing

Critical protocols SHOULD encode invariants executable against generated action sequences.

Test:

- arbitrary sequences;
- repeated calls;
- invalid permissions;
- pause transitions;
- upgrade transitions;
- partial liquidation;
- zero/edge balances;
- token quirks;
- oracle faults;
- crosschain duplicates.

## 22.3 Formal methods

Solidity’s SMTChecker can prove/assert properties for supported code paths but reports unknown/unproved results and depends on the correctness of specified properties [S16].

For any “formal” claim retain:

```yaml
property_id:
property:
scope:
model_or_source:
tool:
tool_version:
compiler:
assumptions:
trusted_base:
result:
unknowns:
counterexamples:
implementation_mapping:
deployment_mapping:
reviewer:
```

Allowed language:

- “Property P was proven for model/version X under assumptions A/B.”
- “No counterexample was found within bounded model Y.”

Disallowed language:

- “The protocol is formally verified and therefore secure.”

unless a precisely scoped formal assurance statement is supplied and independently defensible.

## 22.4 Independent security review

Review scope MUST record:

- commit/code hash;
- deployment configuration;
- compiler/build;
- contracts/programs/modules covered;
- excluded components;
- threat assumptions;
- findings/severity;
- fixes;
- retest evidence;
- residual risk;
- reviewer conflicts/independence.

A second audit is most valuable when it adds genuinely different expertise/methods rather than duplicating the same correlated blind spot.

## 22.5 Audit-to-release delta

Before deployment:

```text
AUDITED REVISION
→ FIXES
→ POST-AUDIT CHANGES
→ DIFF REVIEW
→ RETEST
→ BUILD
→ DEPLOYED ARTIFACT VERIFICATION
```

Any unaudited material change reopens the relevant assurance scope.

## 22.6 Bug bounty / live adversarial assurance

A bounty MAY add post-release discovery capacity. It does not replace:

- pre-release design;
- tests;
- audits;
- custody controls;
- monitoring;
- incident response.

Bounty scope, disclosure, triage, safe-harbor, and remediation ownership must be explicit.

---

# 23. Formal assurance and traceability package

For B3/B4 retain a package sufficient for an independent reviewer to reconstruct the decision:

- approved scope and criticality;
- asset/authority inventory;
- threat/economic model;
- requirements/invariants;
- architecture decisions;
- key/custody design;
- governance/upgrade model;
- source/commit;
- build environment/compiler;
- dependency lock/provenance;
- test evidence;
- fuzz/property evidence;
- formal-property evidence;
- audit reports and fixes;
- residual-risk register;
- governance approvals;
- deployment transaction and artifact identity;
- post-deployment verification;
- monitoring/reconciliation plan;
- incident/recovery plan.

## 23.1 Traceability spine

At B3/B4:

| ID | Requirement/invariant | Evidence/rationale | Control/implementation | Verification | Runtime signal | Status |
|---|---|---|---|---|---|---|

No unexplained orphan states:

- invariant with no implementation;
- control with no test;
- test with no current requirement;
- admin authority with no owner;
- key with no recovery/revocation;
- risk with no acceptance/mitigation;
- monitoring signal with no response.

---

# 24. Build, compiler, dependencies, and deployed-code provenance

## 24.1 Four distinct claims

Never collapse these:

1. **Source availability** — source can be inspected.
2. **Reproducible/identified build** — source/config/toolchain can produce an identified artifact.
3. **Reviewed artifact identity** — the artifact corresponds to what was reviewed.
4. **Deployed runtime identity** — onchain code/program/implementation equals the identified release artifact.

Solidity metadata can support source/build reproduction and bytecode comparison, but that evidence still must be connected to the actual deployed address and proxy/implementation structure [S17].

## 24.2 Release build manifest

```yaml
source_revision:
repository:
compiler_or_toolchain:
exact_version:
optimizer_or_build_flags:
dependencies_lock_hash:
generated_code:
chain_target:
artifact_hash:
metadata_hash:
build_environment:
builder_identity:
provenance_attestation:
reviewed_by:
```

## 24.3 Dependency controls

- lock/pin material dependencies;
- monitor vulnerability/security releases;
- review cryptographic libraries carefully;
- avoid bespoke cryptography unless exceptional and independently reviewed;
- minimize privileged build steps;
- isolate secrets from untrusted CI.

## 24.4 Deployed identity

After deployment verify:

- address/program/package/module;
- chain/network;
- code hash/program data;
- proxy implementation;
- proxy admin;
- initialized version;
- role holders;
- upgrade authority;
- oracle addresses;
- critical parameters;
- ownership renunciation/finalization if intended.

---

# 25. Pre-production staging and adversarial rehearsal

Before material exposure, test at least:

1. normal user lifecycle;
2. invalid inputs;
3. unauthorized caller;
4. signer loss;
5. signer compromise;
6. stale/missing oracle;
7. extreme price move;
8. flash liquidity;
9. MEV/order manipulation;
10. pause;
11. unpause;
12. upgrade;
13. failed upgrade/migration;
14. RPC/indexer divergence;
15. deep-enough reorg scenario for the business;
16. token with nonstandard behavior;
17. bridge duplicate/replay;
18. chain/sequencer outage;
19. recovery key/share activation;
20. incident evidence collection.

For B3/B4, conduct a tabletop with engineering, security, custody, governance, and operations.

---

# 26. Deployment, release, and progressive economic exposure

## 26.1 Deployment gate

MUST verify:

- exact source/revision;
- approved artifacts;
- compiler/toolchain;
- known compiler bugs;
- tests;
- audit scope/delta;
- deployment identity;
- deployer key/authority;
- target chain;
- constructor/initializer;
- roles;
- proxy/program/package authority;
- oracle;
- parameters;
- monitoring;
- pause/recovery.

## 26.2 Progressive economic exposure

Progressive rollout for blockchain SHOULD constrain **value at risk**.

Possible controls:

- TVL cap;
- per-account cap;
- mint cap;
- withdrawal cap;
- bridge transfer cap;
- daily/hourly flow cap;
- collateral-factor limits;
- limited asset set;
- governance activation delay;
- staged permission enablement.

Increase limits only after:

- observed invariants hold;
- reconciliation passes;
- monitoring is reliable;
- no unresolved blocker/major findings;
- incident paths are operational.

## 26.3 No false rollback

Release plan MUST classify recovery:

```yaml
code_rollback_possible:
state_rollback_possible:
proxy_rollback_compatible:
migration_reversible:
economic_side_effects_reversible:
compensation_available:
new_migration_path:
```

If state is irreversible, say so.

---

# 27. Operations, observability, and reconciliation

## 27.1 Monitor questions, not event volume

Operators need to answer:

- Are assets where accounting says they are?
- Did privileged authority change?
- Is deployed code the approved code?
- Are oracle data and freshness acceptable?
- Is bridge backing consistent?
- Are pause/governance mechanisms reachable?
- Are signatures/transactions outside policy?
- Did finality/reorg invalidate derived state?
- Is a queue/keeper/relayer failing?
- Has economic behavior moved outside expected bounds?

## 27.2 Critical event monitoring

Alert on contextually:

- role/admin/owner changes;
- implementation/upgrade;
- upgrade-authority transfer;
- pause/unpause;
- oracle config/change;
- large mint/burn/withdraw;
- bridge validator/relayer change;
- threshold/signer change;
- abnormal governance proposal;
- fee/risk parameter change;
- emergency action.

## 27.3 Independent reconciliation

At an appropriate cadence reconcile:

```text
ONCHAIN BALANCES
↔ INTERNAL ACCOUNTING
↔ USER CLAIMS
↔ BRIDGE BACKING
↔ ORACLE / MARKET STATE
↔ OFFCHAIN SETTLEMENT
```

Use independent queries/providers where consequence justifies it.

## 27.4 Drift detection

Continuously or periodically verify:

- code hash;
- implementation pointer;
- admin roles;
- critical config;
- signer set/threshold;
- oracle feed;
- chain ID/network;
- program upgrade authority;
- dependency endpoints.

---

# 28. Incident response, key compromise, and evidence preservation

## 28.1 First objectives

```text
PROTECT PEOPLE / USERS AS APPLICABLE
→ STOP OR BOUND NEW LOSS
→ PRESERVE EVIDENCE
→ REVOKE / PAUSE / RATE-LIMIT WHERE SAFE
→ ESTABLISH CANONICAL STATE
→ COMMUNICATE FACTS + UNCERTAINTY
→ RECOVER / MIGRATE / COMPENSATE
→ RECONCILE
→ LEARN
```

## 28.2 Evidence preservation

Preserve immutably or tamper-evidently:

- transaction hashes;
- blocks and canonicality;
- traces where available;
- contract/program code identity;
- proxy implementation history;
- configuration/roles;
- source/build release;
- signer approvals;
- custody/audit logs;
- HSM/MPC administrative logs;
- frontend release hashes;
- RPC/provider evidence;
- governance proposals/votes;
- oracle values;
- bridge messages/proofs;
- incident communications/timeline.

Do not “clean up” evidence while containment is ongoing unless safety/security requires it.

## 28.3 Key compromise

If compromise is plausible:

1. bound affected authority;
2. suspend/revoke where possible;
3. rotate signer sets/roles;
4. inspect equivalent recovery/admin paths;
5. inspect historical unauthorized actions;
6. reconcile assets/state;
7. replace compromised infrastructure;
8. do not reuse old operation/approval identifiers where replay is possible;
9. document residual uncertainty.

## 28.4 Contract/program exploit

Classify:

- active exploit;
- latent defect;
- economic manipulation;
- governance abuse;
- oracle failure;
- crosschain failure;
- key compromise;
- frontend/signing compromise.

Containment action must preserve system-specific safety; blindly pausing or upgrading can worsen loss.

---

# 29. Recovery, migration, compensation, and retirement

## 29.1 Recovery strategy classes

- rotate/revoke authority;
- pause/restrict;
- parameter/risk-limit reduction;
- upgrade;
- migrate to new contract/program;
- snapshot and claims migration;
- bridge halt/reconciliation;
- user compensation;
- protocol recapitalization;
- controlled retirement.

## 29.2 Migration requirements

A migration SHOULD be:

- explicit about source/canonical state;
- replay-resistant;
- idempotent where possible;
- reconciled;
- independently reviewed;
- bounded in time/value;
- observable;
- finality-aware;
- compatible with old/new versions during coexistence.

## 29.3 Retirement

Retiring a blockchain system includes:

- disable new exposure;
- communicate user withdrawal/migration;
- remove/revoke keys/roles;
- archive source/build/audit evidence;
- maintain claims/withdrawal path as required;
- stop or transfer oracle/automation;
- close programs/accounts only when safe and supported;
- preserve required monitoring for residual assets.

---

# 30. Privacy and durable public data

Blockchain data can be public, globally replicated, durable, and correlated long after publication.

Before writing personal/sensitive data onchain ask:

```yaml
data:
is_identity_needed:
can_hash_or_commitment_still_be_personal_or_linkable:
can_store_offchain:
retention_requirement:
deletion_requirement:
future_linkability:
access_pattern:
metadata_leakage:
jurisdiction_or_contract_constraints:
```

Do not promise deletion where architecture cannot provide it.

Hashing a low-entropy identifier does not automatically anonymize it.

Wallet addresses/pseudonyms can become personally identifiable through linkage; treat privacy as a separate engineering concern from confidentiality.

---

# 31. Decision frameworks

## 31.1 Immutable or upgradeable?

```text
Can the protocol safely migrate/compensate without in-place upgrade?
  ├─ YES → Is minimizing admin trust a primary requirement?
  │          ├─ YES → prefer immutable / tightly minimized upgrade authority
  │          └─ NO  → compare operational/evolution benefit vs authority risk
  └─ NO  → Is in-place defect repair/evolution materially required?
             ├─ NO → reconsider architecture
             └─ YES → controlled upgradeability with authority-equivalence controls
```

## 31.2 Custody pattern?

```text
Is maximum consequence small and strictly bounded?
  ├─ YES → single controlled key may be acceptable with explicit risk
  └─ NO  → Need independent human approval?
             ├─ YES → evaluate multisig / smart-account quorum
             └─ NO  → Need automated high-frequency signing?
                        ├─ YES → evaluate HSM/KMS/MPC with policy limits
                        └─ NO  → offline/hardware + quorum may fit
```

Always compare the recovery/admin path.

## 31.3 Formal methods?

```text
Is there a small, expressible, high-consequence property/state machine?
  ├─ NO → use other stronger-fit evidence
  └─ YES → Can assumptions/model-to-code mapping be made credible?
             ├─ NO → formal model may still aid design, not proof of deployment
             └─ YES → add formal verification to the assurance stack
```

## 31.4 Oracle acceptable?

```text
Does a trusted external fact affect money/authority?
  ├─ NO → avoid oracle
  └─ YES → Is there a manipulation/liveness model and safe stale behavior?
             ├─ NO → not production-ready
             └─ YES → Is economic manipulation cost/resilience acceptable?
                        ├─ NO → redesign source/aggregation/window/economics
                        └─ YES → deploy with circuit breakers + monitoring
```

## 31.5 Bridge/crosschain?

```text
Can the user outcome be achieved without crosschain state/value?
  ├─ YES → prefer simpler trust boundary unless crosschain benefit is material
  └─ NO  → enumerate both chains + bridge validation + custody + finality
             → define message/replay invariants
             → cap progressive value
             → reconcile backing independently
```

---

# 32. Residual-risk, assurance, and acceptance records

## 32.1 Residual-risk record

```yaml
risk_id:
scenario:
assets:
likelihood_basis:
impact:
controls:
evidence:
remaining_uncertainty:
detectability:
recovery:
owner:
accepted_by:
acceptance_rationale:
expiry_or_revisit:
monitoring:
```

No “accepted by team” for B3/B4. Name accountable authority.

## 32.2 Audit report is not risk acceptance

A report may say no finding was observed in scope. The product owner/security authority still owns:

- excluded code;
- economic assumptions;
- keys;
- governance;
- deployment;
- integrations;
- operations;
- future changes.

## 32.3 Assurance statement template

```text
We have evidence that [property/control] holds for [exact version/scope]
under [assumptions], based on [methods].

This does not establish [explicit exclusions].

Residual risks [IDs] remain and are owned by [role].
```

---

# 33. Anti-patterns and false assurance

## A01 — “The contract was audited, so it is safe.”

False. Audit scope/version/assumptions are bounded.

## A02 — “It is a multisig, so custody is decentralized.”

False. Threshold says nothing about operator/provider/recovery independence.

## A03 — “MPC removes private-key risk.”

False. It changes key representation and threat model; shares, protocol, admin, recovery, and liveness remain.

## A04 — “Hardware wallet means secure signing.”

False. Transaction intent, firmware/software, user verification, recovery, and front-end compromise remain.

## A05 — “EIP-712 prevents replay.”

False. EIP-712 does not itself provide replay protection [S18].

## A06 — “A signature is permanently valid if it once validated.”

False for state-dependent contract signatures [S20].

## A07 — “Immutable is always safer.”

False. Unfixable critical defects can dominate.

## A08 — “Upgradeable is safer because bugs can be fixed.”

False. Upgrade authority can be equivalent to total protocol control.

## A09 — “A timelock makes governance safe.”

False. Role design, payload visibility, capture, liveness, and emergency bypass remain [S30][S31].

## A10 — “Pause makes incidents safe.”

False. Pause can trap users, block debt repayment, or be abused.

## A11 — “Events are the source of truth.”

False. State is authoritative; events are telemetry/interface evidence.

## A12 — “Chain data is final once we see the transaction.”

False. Finality is chain/protocol-specific [S25].

## A13 — “N confirmations is universal.”

False. Confirmation/finality semantics differ.

## A14 — “Flash loans are the vulnerability.”

Usually false. They amplify an economic invariant that already fails under atomic capital [S45].

## A15 — “MEV is only a trading issue.”

False when ordering changes protocol correctness/value [S44].

## A16 — “A decentralized oracle cannot be manipulated.”

False. Data sources, market depth, concentration, aggregation, ordering, and consumer logic remain [S40].

## A17 — “TWAP solves oracle manipulation.”

False as a universal rule; window/liquidity/block control matter [S43].

## A18 — “Standard token interface means standard behavior.”

False. Fees, rebases, hooks, freezes, upgrades, and return behavior vary.

## A19 — “Integer math avoids precision bugs.”

False. Rounding and scaling remain economic policy.

## A20 — “Formal verification proves the protocol secure.”

False. Scoped properties and assumptions only [S16].

## A21 — “No compiler warnings means safe code.”

False.

## A22 — “Verified source means deployed code is the audited code.”

False unless build/deployment identity is connected [S17].

## A23 — “A signed artifact is trustworthy.”

False. A signature binds an artifact to a key/identity; source/build/key/policy trust remain [S01].

## A24 — “Bridge message once = replay safe.”

False across route/domain/version semantics.

## A25 — “Rate limits prevent bridge loss.”

They bound some loss; validator/admin/key compromise can remain.

## A26 — “Move eliminates smart-contract security risk.”

False. It changes memory/resource semantics, not authorization/economic/governance risk.

## A27 — “Solana has no reentrancy, so account validation is enough.”

False. CPI, PDA authority, account substitution, arithmetic, governance, economics remain.

## A28 — “SELFDESTRUCT deletes the contract.”

Stale as a general EVM claim after EIP-6780 [S24].

## A29 — “Upgrade rollback is always possible.”

False if state/storage/external effects are incompatible.

## A30 — “Bug bounty can replace audit.”

False.

## A31 — “More tools = more assurance.”

False if tools share assumptions or produce unreviewed noise.

## A32 — “Monitoring events catches all loss.”

False without independent reconciliation.

## A33 — “Recovery seed stored offline solves disaster recovery.”

False if recovery is untested, inaccessible, or weaker than primary custody.

## A34 — “Onchain is anonymous.”

False as a general privacy claim.

## A35 — “Open source means secure.”

False; review, provenance, operation, and incentives matter.

## A36 — “Higher TVL proves security.”

False; exposure and time are not verification.

---

# 34. Threat-model checklist

## Assets / authority

- [ ] All value-bearing assets identified
- [ ] All code/admin/upgrade authority identified
- [ ] Recovery authority identified
- [ ] Equivalent-authority graph reviewed
- [ ] Maximum consequence per authority known

## Adversaries

- [ ] External attacker
- [ ] Compromised signer
- [ ] Colluding quorum
- [ ] Recovery/admin compromise
- [ ] Governance capture
- [ ] Flash-capital attacker
- [ ] MEV/order adversary
- [ ] Oracle manipulation
- [ ] Bridge validator/relayer compromise
- [ ] Frontend/RPC compromise
- [ ] Supply-chain/toolchain compromise

## Failure

- [ ] Key loss
- [ ] Oracle stale/down
- [ ] Reorg/finality
- [ ] Sequencer/chain outage
- [ ] Migration/upgrade failure
- [ ] Token nonstandard behavior
- [ ] Rounding/precision
- [ ] Indexer/reconciliation divergence
- [ ] Governance deadlock
- [ ] Pause/unpause failure

---

# 35. Production release checklist

## Scope and invariants

- [ ] Assets/state/authority inventory current
- [ ] Criticality assigned
- [ ] Invariants enumerated
- [ ] Economic invariants tested
- [ ] State machine/forbidden transitions reviewed

## Keys and signing

- [ ] Key lifecycle defined
- [ ] No secrets in repository/docs/logs
- [ ] Custody architecture approved
- [ ] Recovery path tested
- [ ] Signer independence reviewed
- [ ] Intent decoding independent enough for risk
- [ ] Replay boundaries defined
- [ ] Chain/network/target verified

## Governance / upgrade

- [ ] Upgrade authority equivalence reviewed
- [ ] Storage/state compatibility checked
- [ ] Initializer/migration tested
- [ ] Timelock/governance roles verified
- [ ] Emergency bypass explicitly accepted
- [ ] Pause/unpause matrix tested

## Contract/program

- [ ] Platform-specific checks complete
- [ ] External-call/CPI behavior tested
- [ ] Token compatibility tested
- [ ] Precision/rounding edge cases tested
- [ ] Compiler/runtime exact version recorded
- [ ] Known compiler bugs checked

## Oracles / economics

- [ ] Feed register complete
- [ ] Freshness/range/sequencer handling tested
- [ ] Manipulation analysis updated
- [ ] Atomic composability/flash-capital tested
- [ ] MEV/order scenarios tested
- [ ] Insolvency/liquidation scenarios tested

## Crosschain

- [ ] Finality on every chain explicit
- [ ] Message domain/replay controls tested
- [ ] Validator/relayer/custody trust documented
- [ ] Bridge caps configured
- [ ] Backing reconciliation working

## Verification

- [ ] Unit/integration tests pass
- [ ] Stateful/property/fuzz tests pass as scoped
- [ ] Formal evidence reviewed where required
- [ ] Independent review/audit complete
- [ ] Findings fixed/retested
- [ ] Post-audit diff reviewed
- [ ] Residual risk accepted

## Build/deployment

- [ ] Source revision identified
- [ ] Dependencies locked
- [ ] Artifact identified
- [ ] Build/provenance retained
- [ ] Deployed code/program verified
- [ ] Proxy/program upgrade authority verified
- [ ] Initialization/roles/config verified

## Operations

- [ ] Value-at-risk limits configured
- [ ] Monitoring live
- [ ] Independent reconciliation live
- [ ] Incident runbook tested
- [ ] Evidence preservation path works
- [ ] Recovery/migration/compensation plan exists
- [ ] Owner/on-call/escalation clear

---

# 36. Key/custody review checklist

- [ ] Exact purpose per key/share
- [ ] Generation method and environment
- [ ] Entropy/protocol appropriate
- [ ] Device/module assurance proportionate
- [ ] Threshold/quorum documented
- [ ] Independence dimensions reviewed
- [ ] Per-transaction/value policy
- [ ] Chain/domain restrictions
- [ ] Human-readable intent
- [ ] Rotation
- [ ] Revocation
- [ ] Backup
- [ ] Recovery
- [ ] Recovery not weaker than accepted custody risk
- [ ] Administrative paths reviewed
- [ ] HSM/KMS/MPC software/firmware versions
- [ ] Audit log
- [ ] Compromise detection
- [ ] Incident rehearsal
- [ ] Destruction/retirement

---

# 37. V1 → adversarial audit → V2 closure matrix

The V1 adversarial audit deliberately attempted to falsify V1 rather than reward completeness.

| Finding | V2 disposition | Primary section |
|---|---|---|
| F-01 Platform-neutrality incomplete | CLOSED — explicit EVM/Solana/Aptos/Sui profiles | §14 |
| F-02 Multisig too coarse | CLOSED — independence dimensions | §11.3 |
| F-03 MPC assurance under-specified | CLOSED — protocol/adversary/DKG/recovery record | §11.4 |
| F-04 Intent integrity missing | CLOSED — root signing invariant | §12 |
| F-05 EIP-712 over-read | CLOSED — explicit “not replay protection” | §12.3 |
| F-06 Contract signatures time-dependent | CLOSED | §12.4 |
| F-07 Upgrade authority equivalence | CLOSED — root rule + graph | §§5.3, 15.2 |
| F-08 Storage compatibility machine gate | CLOSED | §15.4 |
| F-09 Emergency upgrade bypass | CLOSED | §15.5 |
| F-10 Oracle market/lifecycle | CLOSED — full feed register | §18.1 |
| F-11 Manipulation cost + ordering | CLOSED | §18.3 |
| F-12 Atomic composability | CLOSED — explicit test | §19.1 |
| F-13 Governance attack surface | CLOSED | §15.6, §19.3 |
| F-14 Token compatibility matrix | CLOSED | §17.1 |
| F-15 Precision/rounding/first-user | CLOSED | §17.3 |
| F-16 Finality executable policy | CLOSED | §9 |
| F-17 Crosschain “once” insufficient | CLOSED — domain/message binding | §20.2 |
| F-18 Source vs reproducible deployment | CLOSED — four-claim separation | §24.1 |
| F-19 Compiler status/version | CLOSED | §14.1, §24 |
| F-20 Audit anti-correlation | CLOSED | §22.4 |
| F-21 Residual-risk record | CLOSED | §32.1 |
| F-22 Formal implementation link | CLOSED | §22.3 |
| F-23 Progressive economic exposure | CLOSED — root release rule | §26.2 |
| F-24 Pause liveness/abuse | CLOSED | §16 |
| F-25 Recovery weaker than custody | CLOSED | §11.5 |
| F-26 Backup availability + confidentiality | CLOSED | §10, §11.5 |
| F-27 Frontend/RPC transaction integrity | CLOSED — dedicated section | §21 |
| F-28 Solana account validation | CLOSED — explicit doctrine | §14.2 |
| F-29 Move business-logic risk | CLOSED | §§14.3–14.4 |
| F-30 SELFDESTRUCT freshness | CLOSED | §14.1 |
| F-31 Reconciliation beyond events | CLOSED | §27.3 |
| F-32 Immutable evidence preservation | CLOSED | §28.2 |

**Audit closure rule:** `CLOSED` means the V2 text contains a responsive control. It does **not** mean the control has been field-validated in every platform/context.

---

# 38. Known unknowns, watchlist, and review triggers

## 38.1 Known unknowns

1. No cross-chain smart-contract security verification standard is universally authoritative across EVM, Solana, Move, Bitcoin-script-like, ZK, and future runtimes.
2. MPC/threshold products expose materially different protocol/implementation/recovery assumptions; vendor claims are not standardized assurance.
3. Formal verification coverage and model-to-deployment linkage remain highly tool/system-specific.
4. MEV markets and private orderflow evolve rapidly and can change previously reasonable economic assumptions.
5. Oracle and bridge provider architecture, validator sets, and failover mechanisms change faster than evergreen principles.
6. Account abstraction expands signing/policy capability and therefore expands wallet/control-plane threat surfaces.
7. ZK proof-system engineering, circuit soundness, setup ceremonies, prover/verifier implementation, and cryptographic proof assumptions justify a dedicated specialist overlay beyond this general blockchain playbook.
8. Regulatory treatment of custody, stablecoins, tokenized assets, market infrastructure, and smart contracts is jurisdiction-specific and time-sensitive.
9. Post-quantum migration for blockchain signatures/long-lived custody is a strategic watch item; migration timing depends on chain/protocol support and threat horizon.
10. Chain governance/forks can alter execution semantics; runtime assumptions require event-triggered review.

## 38.2 Mandatory freshness triggers

Re-review the affected control when:

- EVM hard fork changes opcode/gas/execution semantics;
- Solidity/Move/Rust toolchain security bulletin;
- EIP/SIP/AIP/platform upgrade changes authority or transaction semantics;
- new oracle/bridge architecture;
- custody/MPC protocol change;
- key algorithm deprecation;
- cryptographic vulnerability;
- governance/upgrade incident;
- compiler known-bug update;
- authoritative standard version changes.

---

# 39. Source register

> Sources have different evidentiary roles. Formal standards define scoped requirements/baselines; protocol/platform specifications define semantics; research characterizes mechanisms; operational/practitioner sources supply implementation guidance. Inclusion is not equal weighting.

## [S00] Master Playbook Standard v2.0-RC1
**Source:** user-provided canonical project file.  
**Role:** playbook construction, R4 rigor, evidence, traceability, audit, validation, machine execution, secrets/document controls.  
**Status:** reviewed project standard at cutoff.  
**Limitation:** house standard; not an external certification.

## [S01] Universal Software & AI Engineering Master Playbook v2.0
**Source:** user-provided canonical project file.  
**Role:** criticality, irreversible state, key custody escalation, state/authority, security, formal methods, provenance, release, incidents.  
**Status:** double-validated/falsification-weighted project standard at cutoff.  
**Limitation:** specialist blockchain detail intentionally delegated to this playbook.

## [S02] NIST SP 800-57 Part 1 Rev. 5 — Recommendation for Key Management: Part 1 — General
**Institution:** NIST  
**Status:** Final; May 2020.  
**URL:** https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final  
**Use:** cryptographic key lifecycle and key-management principles.  
**Limitation:** general key management; blockchain-specific custody is an overlay.

## [S03] NIST SP 800-57 Part 1 Rev. 6 — Initial Public Draft
**Institution:** NIST  
**Status:** Initial Public Draft at cutoff.  
**URL:** https://csrc.nist.gov/pubs/sp/800/57/pt1/r6/ipd  
**Use:** watch item only.  
**Rule:** MUST NOT silently replace Rev. 5 as final baseline.

## [S04] NIST IR 8214C — NIST First Call for Multi-Party Threshold Schemes
**Institution:** NIST  
**Status:** Final; January 2026.  
**URL:** https://csrc.nist.gov/pubs/ir/8214/c/final  
**Use:** threshold-cryptography categories, assumptions, evaluation direction.  
**Limitation:** not certification of a specific custody product.

## [S05] NIST Multi-Party Threshold Cryptography project
**Institution:** NIST  
**URL:** https://csrc.nist.gov/projects/threshold-cryptography  
**Use:** current threshold-cryptography work and scheme evaluation context.  
**Limitation:** project/draft work evolves.

## [S06] FIPS 140-3 — Security Requirements for Cryptographic Modules
**Institution:** NIST  
**Status:** Final.  
**URL:** https://csrc.nist.gov/pubs/fips/140-3/final  
**Use:** cryptographic-module assurance where scoped requirement/policy calls for it.  
**Limitation:** module validation does not establish end-to-end custody security.

## [S07] Cryptocurrency Security Standard (CCSS) v9.0
**Institution:** CryptoCurrency Certification Consortium (C4)  
**Status:** v9.0 current at cutoff.  
**URL:** https://cryptoconsortium.org/cryptocurrency-security-standard-documentation/ccss-details-v9/  
**Use:** crypto-asset key generation, custody, backup, recovery, signing, operational security.  
**Limitation:** industry standard/certification framework, not a substitute for system-specific threat modeling.

## [S08] EEA EthTrust Security Levels Specification v3
**Institution:** Enterprise Ethereum Alliance  
**Status:** approved/current; March 2025.  
**URL:** https://entethalliance.org/specs/ethtrust-sl/v3/  
**Use:** Ethereum smart-contract security requirements/levels.  
**Limitation:** EVM/Ethereum-centric.

## [S09] EEA Crosschain Security Guidelines v1
**Institution:** Enterprise Ethereum Alliance  
**Status:** current listed EEA specification at cutoff.  
**URL:** https://entethalliance.org/wp-content/uploads/2021/11/crosschainsecurityguidelines.pdf  
**Use:** bridge/crosschain holistic attack-surface and finality/security considerations.  
**Limitation:** older v1 guidance; current architectures must still be verified.

## [S10] EEA DeFi Risk Assessment Guidelines v1
**Institution:** Enterprise Ethereum Alliance  
**Status:** current listed EEA specification at cutoff.  
**URL:** https://entethalliance.org/specs/defi-risks/v1  
**Use:** DeFi risk across smart contract, custody, market/tokenomic and operational areas.  
**Limitation:** risk framework, not a universal verification standard.

## [S11] EEA Technical Specifications index
**Institution:** Enterprise Ethereum Alliance  
**URL:** https://entethalliance.org/resources/technical-specifications/  
**Use:** current-status verification for EEA specifications.  
**Limitation:** index/status source.

## [S12] OWASP Smart Contract Security Verification Standard (SCSVS)
**Institution:** OWASP Smart Contract Security project  
**Status:** alpha/fast-moving at cutoff.  
**URL:** https://scs.owasp.org/SCSVS/  
**Use:** emerging verification coverage/taxonomy.  
**Limitation:** MUST NOT be presented as a mature final certification baseline.

## [S13] OWASP Smart Contract Security Testing Guide (SCSTG)
**Institution:** OWASP  
**URL:** https://scs.owasp.org/SCSTG/  
**Use:** practical test cases and security testing guidance.  
**Limitation:** EVM-heavy and evolving.

## [S14] Solidity — Security Considerations
**Institution:** Solidity project  
**URL:** https://docs.soliditylang.org/en/latest/security-considerations.html  
**Use:** Solidity/EVM implementation hazards and secure-development guidance.  
**Limitation:** language/runtime-specific and version-sensitive.

## [S15] Solidity — List of Known Bugs
**Institution:** Solidity project  
**URL:** https://docs.soliditylang.org/en/latest/bugs.html  
**Use:** release compiler-bug gate.  
**Limitation:** must be checked for the exact compiler/version/config.

## [S16] Solidity — SMTChecker and Formal Verification
**Institution:** Solidity project  
**URL:** https://docs.soliditylang.org/en/latest/smtchecker.html  
**Use:** formal property checking, counterexamples, unknown results.  
**Limitation:** proof scope depends on properties/tool/model; specification validity remains separate.

## [S17] Solidity — Contract Metadata
**Institution:** Solidity project  
**URL:** https://docs.soliditylang.org/en/latest/metadata.html  
**Use:** source/build metadata and bytecode/source verification.  
**Limitation:** metadata/source verification alone does not prove deployment governance or security.

## [S18] EIP-712 — Typed structured data hashing and signing
**Status:** Final.  
**URL:** https://eips.ethereum.org/EIPS/eip-712  
**Use:** structured signing/domain separation.  
**Critical limitation:** does not include replay protection itself.

## [S19] EIP-155 — Simple replay attack protection
**Status:** Final.  
**URL:** https://eips.ethereum.org/EIPS/eip-155  
**Use:** chain-ID replay protection for Ethereum transaction signing context.

## [S20] ERC-1271 — Standard Signature Validation Method for Contracts
**Status:** Final.  
**URL:** https://eips.ethereum.org/EIPS/eip-1271  
**Use:** contract-account signature validation.  
**Limitation:** validity can be state-dependent.

## [S21] ERC-4337 — Account Abstraction Using Alt Mempool
**Status:** Final.  
**URL:** https://eips.ethereum.org/EIPS/eip-4337  
**Use:** smart-account validation, nonce/replay and EntryPoint-domain considerations.  
**Limitation:** implementation/ecosystem evolves.

## [S22] ERC-1967 — Proxy Storage Slots
**Status:** Final.  
**URL:** https://eips.ethereum.org/EIPS/eip-1967  
**Use:** standardized proxy implementation/admin/beacon storage slots/events.

## [S23] ERC-1822 — Universal Upgradeable Proxy Standard (UUPS)
**Status:** Stagnant at cutoff.  
**URL:** https://eips.ethereum.org/EIPS/eip-1822  
**Use:** historical/contextual UUPS specification.  
**Limitation:** MUST NOT be presented as a current universal normative upgrade standard.

## [S24] EIP-6780 — SELFDESTRUCT only in same transaction
**Status:** Final.  
**URL:** https://eips.ethereum.org/EIPS/eip-6780  
**Use:** current EVM selfdestruct semantics/freshness control.

## [S25] Ethereum.org — Proof-of-Stake / finality documentation
**Institution:** Ethereum Foundation ecosystem documentation  
**URL:** https://ethereum.org/developers/docs/consensus-mechanisms/pos/  
**Use:** Ethereum checkpoint/finality semantics and reversion security context.  
**Limitation:** Ethereum-specific.

## [S26] Ethereum.org — Smart Contract Security
**URL:** https://ethereum.org/developers/docs/smart-contracts/security/  
**Use:** broad Ethereum smart-contract security patterns.  
**Limitation:** educational guidance, not complete verification standard.

## [S27] OpenZeppelin Contracts 5.x — Cryptography
**Institution:** OpenZeppelin  
**URL:** https://docs.openzeppelin.com/contracts/5.x/api/utils/cryptography  
**Use:** ECDSA malleability handling, EIP-712 helpers, SignatureChecker/ERC-1271 integration.  
**Limitation:** library-specific; business replay/authorization policy remains application responsibility.

## [S28] OpenZeppelin Upgrades — Writing Upgradeable Contracts
**URL:** https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable  
**Use:** initialization/storage/upgradeable implementation constraints.  
**Limitation:** OpenZeppelin tooling/pattern scope.

## [S29] OpenZeppelin Upgrades — Core/validation APIs
**URL:** https://docs.openzeppelin.com/upgrades-plugins/api-core  
**Use:** machine validation of upgrade safety/storage compatibility.  
**Limitation:** machine validation does not replace semantic/economic review.

## [S30] OpenZeppelin Contracts 5.x — Governance
**URL:** https://docs.openzeppelin.com/contracts/5.x/governance  
**Use:** governance/timelock implementation semantics.

## [S31] OpenZeppelin Contracts 5.x — Access Control
**URL:** https://docs.openzeppelin.com/contracts/5.x/access-control  
**Use:** roles, timelock controller, proposer/executor/canceller operational implications.

## [S32] OpenZeppelin Contracts 5.x — ERC-4626
**URL:** https://docs.openzeppelin.com/contracts/5.x/erc4626  
**Use:** vault rounding and inflation/donation attack example.  
**Limitation:** ERC-4626-specific example, generalized only at invariant level.

## [S33] Solana — Programs
**Institution:** Solana documentation  
**URL:** https://solana.com/docs/core/programs  
**Use:** program/state separation and program authority model.

## [S34] Solana — Deploying Programs
**URL:** https://solana.com/docs/programs/deploying  
**Use:** deploy/update, upgrade authority, final/immutable deployment semantics.

## [S35] Solana — Program Derived Addresses
**URL:** https://solana.com/docs/core/pda  
**Use:** PDA derivation/off-curve/program-signing semantics.

## [S36] Solana — Accounts
**URL:** https://solana.com/docs/core/accounts  
**Use:** account owner/program modification semantics.

## [S37] Solana — Production Readiness
**URL:** https://solana.com/docs/tools/production-readiness  
**Use:** production deployment and deployed-program verification guidance.

## [S38] Aptos — Application / Move integration documentation
**Institution:** Aptos documentation  
**URL:** https://aptos.dev/build/guides/application-integration  
**Use:** account/signing/finality and Move package integration/upgrade context.  
**Limitation:** platform documentation evolves.

## [S39] Sui — Sui Move Concepts
**Institution:** Sui documentation  
**URL:** https://docs.sui.io/develop/write-move/sui-move-concepts  
**Use:** Sui-specific object/Move semantics.  
**Limitation:** not interchangeable with Aptos Move.

## [S40] Chainlink Data Feeds — Selecting Quality Data Feeds
**Institution:** Chainlink documentation  
**URL:** https://docs.chain.link/data-feeds/selecting-data-feeds  
**Use:** data quality, liquidity, market hours, freshness, circuit breakers, deprecation, consumer responsibility.  
**Limitation:** provider documentation; consumers still own application risk.

## [S41] Chainlink — L2 Sequencer Uptime Feeds
**URL:** https://docs.chain.link/data-feeds/l2-sequencer-feeds  
**Use:** sequencer-outage consumer handling.  
**Limitation:** relevant only to supported architectures/chains.

## [S42] Chainlink — Offchain Reporting
**URL:** https://docs.chain.link/architecture-overview/off-chain-reporting  
**Use:** decentralized reporting/aggregation architecture context.

## [S43] Uniswap Labs — Uniswap v3 Oracles in Proof of Stake
**URL:** https://blog.uniswap.org/uniswap-v3-oracles  
**Use:** evidence that consensus/ordering changes alter oracle manipulation assumptions.  
**Limitation:** protocol-specific applied research.

## [S44] Daian et al. — Flash Boys 2.0
**URL:** https://arxiv.org/abs/1904.05234  
**Evidence role:** foundational research on frontrunning/transaction-ordering/MEV.  
**Limitation:** MEV ecosystem has evolved; use mechanism, not historical market magnitude.

## [S45] Qin et al. — Attacking the DeFi Ecosystem with Flash Loans for Fun and Profit
**URL:** https://arxiv.org/abs/2003.03810  
**Evidence role:** research on flash-loan-enabled atomic economic attacks.  
**Limitation:** historical protocols; mechanism remains more durable than individual exploit examples.

---

# 40. Mechanical QA for this release

The release artifact SHOULD pass:

- balanced Markdown code fences;
- no unresolved drafting markers or stub content;
- every `[Sxx]` reference used in normative text has a source-register definition;
- no duplicate source IDs;
- V2 does not claim `VALIDATED`;
- all V1 adversarial audit findings have an explicit V2 disposition;
- no live secret/private-key material is embedded;
- no source marked draft/alpha/stagnant is represented as final current authority;
- URLs/source titles correspond to the evidence register;
- section numbering and internal references are coherent.

---

# 41. Definition of Done and release status

## 41.1 Research-audited Golden Master — PASS criteria

- [x] Purpose/scope explicit
- [x] R4/L4 posture explicit
- [x] Master Playbook inheritance explicit
- [x] Platform-neutral core plus multiple platform profiles
- [x] Keys/signing/custody lifecycle
- [x] Upgrade/governance/emergency controls
- [x] Economic attack model
- [x] Oracle/MEV/flash-liquidity controls
- [x] Crosschain/finality/replay controls
- [x] Verification/formal/audit strategy
- [x] Build/deployment provenance
- [x] Progressive economic exposure
- [x] Monitoring/reconciliation
- [x] Incident/evidence/recovery
- [x] Anti-patterns
- [x] Checklists
- [x] Evidence/source register
- [x] V1 adversarial findings closed in text
- [x] Known unknowns/watchlist
- [x] Mechanical QA

## 41.2 What remains before `VALIDATED`

Under Playbook 00 this artifact MUST NOT be labeled `VALIDATED` until the adopting system completes applicable field assurance, including:

1. named accountable owner;
2. independent domain/cryptographic/security review proportionate to scope;
3. representative non-author execution of key procedures;
4. scenario testing across at least EVM plus one non-EVM profile if those profiles are claimed operationally;
5. custody/recovery rehearsal for any adopted key architecture;
6. release/deployment dry run;
7. incident/reconciliation exercise;
8. closure or formal risk acceptance of any resulting BLOCKER/MAJOR defects;
9. regression check after material changes.

**Current status: `REVIEWED — RESEARCH_AUDITED_GOLDEN_MASTER`.**

---

# 42. Change log

## v2.0 — 2026-09-27

V2 is the adversarially audited successor to V1.

Material changes:

- elevated effective-authority/weakest-path analysis to root doctrine;
- replaced “multisig” shorthand with multidimensional independence analysis;
- added explicit MPC/threshold assurance record and recovery analysis;
- made intent integrity and replay boundaries first-class;
- strengthened EIP-712 and ERC-1271 caveats;
- made upgrade authority equivalent to maximum installable code effect;
- added machine-gated storage/state compatibility;
- separated normal vs emergency upgrade guarantees;
- expanded governance attack surface;
- expanded oracle market-structure/lifecycle controls;
- made atomic composability and ordering advantages part of economic correctness;
- added token behavior compatibility matrix;
- strengthened precision/rounding/first-user tests;
- converted finality into an executable business policy;
- strengthened crosschain domain/replay/finality/backing controls;
- separated source publication, reproducible build, reviewed artifact, and deployed identity;
- added audit anti-correlation and residual-risk records;
- strengthened formal-method model-to-implementation evidence;
- elevated progressive economic exposure to a root release rule;
- added pause liveness/abuse/unpause assurance;
- strengthened key recovery and backup invariants;
- added dedicated frontend/RPC transaction-integrity controls;
- added explicit Solana account/PDA/CPI doctrine;
- added Aptos and Sui Move profiles without importing EVM assumptions;
- corrected stale `SELFDESTRUCT` assumptions using EIP-6780;
- made independent state reconciliation mandatory where risk justifies it;
- made forensic evidence preservation a first incident objective;
- refreshed current/draft status for NIST, EEA, OWASP, and Ethereum standards/specifications.

---

# Final doctrine

> **The core asset in blockchain engineering is not code. It is authorized state transition.**
>
> High assurance therefore requires one continuous chain of evidence:
>
> **intent → authority → signature → executable code → state transition → economic effect → finality → reconciliation.**
>
> A system is only as trustworthy as the weakest material link in that chain.
