# 21 — Systems, Embedded & Real-Time Engineering — V2.0

## High-assurance evergreen standard for low-level systems, memory, concurrency, processes, firmware, timing, hardware interfaces, determinism and safety-critical engineering

```yaml
document_id: SWE-PB-21
title: Systems, Embedded & Real-Time Engineering
version: 2.0
status: REVIEWED
release_label: HIGH-ASSURANCE GOLDEN MASTER — DOUBLE-AUDITED
research_audit_passes: 2
artifact_type: domain_playbook
primary_archetype: hybrid
parent_standards:
  - Master Playbook Standard v2.0
  - Universal Software & AI Engineering Master Playbook v2.0
research_cutoff: 2026-09-27
construction_rigor: R4
application_criticality: C0-C4 risk-proportionate
owner_role: Playbook 21 Maintainer
reviewers:
  - software/systems assurance reviewer role
  - embedded/real-time reviewer role
  - safety/security reviewer role for C3-C4 applications
volatility: moderate + event-driven
next_scheduled_review: 2027-03-27
review_triggers:
  - publication of a new IEC 61508 edition
  - publication of ISO 26262 third edition
  - publication of IEC 62304 second edition
  - material revision of ISO 14971 or IEC 81001-5-1 for medical-device projects
  - material revision of ISO 13849-1, IEC 62061 or IEC 61511 for machinery/process projects
  - finalization of EN 50716 amendment work for railway projects
  - material change to IEEE 1012, POSIX, ISO C, ISO/IEC 24772 or MISRA C
  - material FAA/EASA multicore or airborne software guidance change
  - material NIST firmware/OT security revision
  - field incident invalidating a protected invariant
  - major new processor/runtime memory model used by a governed system
```

---

# Executive standard

Systems and embedded engineering is the discipline of turning software intent into behavior that remains acceptable **at the boundary where language semantics, runtime scheduling, memory, processor architecture, peripherals, physical time, faults and the real world meet**.

The durable chain is:

```text
INTENT / HAZARD / CONSTRAINT
→ EXECUTION MODEL
→ STATE + MEMORY + AUTHORITY
→ TEMPORAL + RESOURCE BOUNDS
→ HARDWARE / FIRMWARE CONTRACTS
→ FAILURE + RECOVERY MODEL
→ IMPLEMENTATION
→ VERIFICATION
→ TARGET VALIDATION
→ FIELD MONITORING
→ CONTROLLED EVOLUTION
```

The core doctrine is:

> **Make state, ownership, ordering, timing, privilege, hardware assumptions and fault response explicit; bound what must be bounded; isolate what must not interfere; verify the exact target configuration; and escalate assurance with the consequence of being wrong.**

This playbook is intentionally strict about **properties** and conservative about **mechanisms**. It does not claim one best language, RTOS, scheduler, architecture, coding standard, allocation model or safety process for every system.

---

# 1. Purpose, outcomes and non-goals

## 1.1 Intended outcome

Enable engineering teams to build, change, release and operate low-level and embedded systems whose:

- functional behavior is correct;
- memory behavior is controlled;
- concurrency semantics are explicit;
- timing claims match evidence;
- hardware interactions are well-defined;
- firmware lifecycle is recoverable and secure;
- failures are detected/contained/recovered according to risk;
- safety claims are traceable to evidence;
- production configuration is reproducible and auditable;
- field maintenance does not silently invalidate assurance.

## 1.2 This playbook is

- a specialist engineering constitution;
- a decision system;
- an assurance framework;
- a set of operational controls;
- a routing layer to domain standards.

## 1.3 This playbook is not

- a substitute for IEC 61508, ISO 26262, IEC 62304, DO-178C, EN 50716 or another applicable standard;
- a certification claim;
- an electrical/PCB design standard;
- a CPU/SoC reference manual;
- a language manual;
- a fixed development methodology;
- a universal ban on dynamic allocation, C/C++, multicore, caches, interrupts, exceptions, recursion or general-purpose OSs.

---

# 2. Inherited parent doctrine

The parent standards require this playbook to preserve:

1. **Outcome before output.**
2. **Context before prescription.**
3. **Evidence fit before source prestige.**
4. **Risk-proportionate rigor.**
5. **Explicit uncertainty and assumptions.**
6. **Verification before trust.**
7. **Validation in the real operating context.**
8. **Traceability for high-rigor work.**
9. **Independent assurance where consequence requires it.**
10. **Controlled change and learning.**

This domain strengthens those principles because a hidden low-level assumption can become a timing miss, memory corruption, unsafe actuator command, unrecoverable boot failure or silent security bypass.

---

# 3. Relationship to the engineering playbook system

| Playbook | Primary ownership | Playbook 21 adds |
|---|---|---|
| 01 Requirements | requirements/domain intent | timing, reset, hardware and safety requirements |
| 02 Architecture | system structure/trade-offs | execution model, partitioning, hardware/RT boundaries |
| 04 Construction | code quality | low-level/memory/ISR/MMIO construction constraints |
| 05 Verification | general V&V | target, timing, HIL, fault injection, WCET evidence |
| 06 Security | security lifecycle | boot, firmware, debug, DMA, device/OT boundaries |
| 07 Privacy | data protection | device telemetry/storage implications |
| 08 Reliability/SRE | service reliability | device failure/recovery/reset/field diagnostics |
| 09 Performance | performance/capacity | hard/firm/soft real-time and bounded latency |
| 10 DevOps/Supply Chain | CI/CD/provenance | firmware artifact/update/provisioning pipeline |
| 11 Maintenance | change/migration/debt | silicon/RTOS/compiler/bootloader field evolution |
| 13 Distributed Systems | network/distributed state | embedded IPC/device-bus ordering and time |
| 15 Backend/Engines | services/engines | low-level runtime boundary |
| 17 Cloud/Infrastructure | infrastructure | edge/OT gateway boundary |
| 22 Language/Runtime | language-specific profiles | low-level constraints that language profiles must satisfy |

Playbook 21 owns the **cross-cutting low-level system contract**.

---

# 4. Scope

## 4.1 In scope

- bootloaders and firmware;
- bare-metal applications;
- microcontroller and SoC software;
- RTOS applications;
- embedded Linux/Unix-like systems;
- kernels, drivers and privileged runtime components;
- industrial/OT software;
- safety-related software;
- device gateways where low-level behavior matters;
- memory and resource management;
- concurrency, processes, threads and IPC;
- interrupts, timers, signals and asynchronous callbacks;
- MMIO, buses and DMA;
- real-time scheduling and temporal assurance;
- multicore and shared-resource interference;
- reset, startup, watchdog, fault containment and recovery;
- secure boot, firmware update, field rollback/roll-forward;
- target-specific verification and diagnostics.

## 4.2 Out of scope

- circuit/PCB electrical design except software-visible contracts;
- mechanical/thermal safety engineering except software assumptions;
- domain certification procedures beyond routing;
- cryptographic primitive design;
- language tutorials;
- application UI/UX.

---

# 5. Normative language and claim classes

`MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, `MAY`, and `JUDGMENT REQUIRED` follow Playbook 00.

Claim classes:

- `REQ` — external scoped requirement.
- `EST` — well-established cross-domain engineering principle.
- `DEF` — recommended default.
- `CTX` — context-dependent mechanism.
- `EMG` — emerging practice.
- `HOUSE` — deliberate internal synthesis.
- `UNK` — unresolved/material unknown.

A `MUST` in this playbook is a house control unless explicitly identified as `REQ`.

---

# 6. Evidence architecture

## 6.1 Evidence lanes

| Lane | Typical source | Best use |
|---|---|---|
| E0 | law/regulation/certification basis | scoped obligation |
| E1 | ISO/IEC/IEEE/RTCA/CENELEC standard | normative technical/process baseline |
| E2 | systematic review/meta-analysis | average empirical effects |
| E3 | foundational/peer-reviewed research | algorithmic/property evidence |
| E4 | NIST/FAA/NASA/CISA framework | public high-assurance/security guidance |
| E5 | mature industrial evidence | mechanisms in real systems |
| E6 | processor/SoC/RTOS/compiler datasheet/manual | exact target semantics |
| E7 | repeated practitioner pattern | hypothesis/default |
| E8 | folklore | idea only; never assurance by itself |

## 6.2 Exact-source rule

For low-level behavior:

> **The authoritative source for a register, interrupt, memory barrier, cache operation, compiler extension, timer or erratum is the exact target’s current authoritative documentation.**

Generic advice MUST NOT override target-specific semantics.

## 6.3 Current-version discipline

The following statuses are material at the research cutoff:

- IEC 61508 Edition 2 (2010) remains the published generic functional-safety baseline; IEC lists a 2027 stability date.
- IEC TS 61508-3-2:2024 adds current dependable-software assurance guidance for critical OT in an IEC 61508-3 context.
- ISO 26262:2018 remains published Edition 2, but ISO marks it “to be revised.”
- IEC 62304:2006+A1:2015 remains the current published medical-device software lifecycle baseline while Edition 2 is under development.
- IEEE 1012-2024 is the current system/software/hardware V&V standard.
- POSIX.1-2024 / IEEE Std 1003.1-2024 is the current POSIX interface baseline.
- ISO/IEC 9899:2024 is the current C language standard.
- ISO/IEC 24772-1:2024 is the current language-independent vulnerability catalogue.
- MISRA C:2025 is the current MISRA C revision; MISRA C:2023 is retained only for older projects.
- NASA-STD-8739.8B is active.
- FAA AC 20-193 is current multicore certification guidance for its airborne scope.
- NIST SP 800-82 Rev. 3 is current OT security guidance.
- IEC 62443-4-1:2018 and 62443-4-2:2019 remain published final baselines; 2026 amendment work does not silently replace them.

---

# 7. Domain model: the execution reality

A low-level system is not “the source code.” The governed system includes:

```text
SOURCE + GENERATED CODE
+ COMPILER / LINKER / FLAGS
+ STARTUP / CRT / LIBRARIES
+ KERNEL / RTOS / BSP / HAL
+ BOOTLOADER / UPDATE AGENT
+ PROCESSOR / CORES / MEMORY MODEL
+ CACHE / MMU / MPU / DMA
+ CLOCKS / TIMERS / INTERRUPTS
+ PERIPHERALS / BUSES
+ BOARD / SILICON REVISION + ERRATA
+ POWER / RESET / WATCHDOG
+ PERSISTENT STATE
+ OPERATIONAL CONFIGURATION
```

The assurance boundary MUST include every element whose behavior can invalidate a material requirement.

---

# 8. System intake and classification

Before architecture, complete:

```yaml
system:
  product_or_system:
  intended_function:
  users_and_operators:
  physical_environment:
  maintenance_environment:

criticality:
  parent_level: C0|C1|C2|C3|C4
  human_safety_consequence:
  security_consequence:
  privacy_consequence:
  financial_or_mission_consequence:
  irreversibility:
  recoverability:
  detectability:

target:
  processor_architecture:
  soc_part_and_revision:
  cores:
  memory:
  mmu_or_mpu:
  caches:
  dma:
  persistent_storage:
  watchdog:
  board_revision:

runtime:
  bare_metal_or_os:
  kernel_or_rtos_version:
  scheduler:
  process_model:
  privilege_model:
  libc_or_runtime:
  allocator:

timing:
  hard_deadlines:
  firm_deadlines:
  soft_deadlines:
  periods:
  jitter_limits:
  time_sources:
  synchronization_requirements:

interfaces:
  sensors:
  actuators:
  buses:
  network:
  debug:
  update:

safety:
  applicable_standard:
  integrity_classification:
  hazards:
  safe_or_degraded_states:

security:
  trust_anchors:
  boot_model:
  update_model:
  physical_access_assumption:
```

No material field may remain “assumed obvious.”

---

# 9. Criticality and assurance posture

Use C0–C4 from the parent standard.

## C0 — experimental

- non-production;
- no material safety/security/data;
- fast learning;
- explicit prototype status.

## C1 — ordinary embedded

- normal code review/tests;
- basic fault handling;
- controlled firmware/update;
- basic security hygiene.

## C2 — material

Adds:

- formalized threat/failure model;
- target timing evidence;
- restore/recovery test;
- stronger configuration control;
- independent review of critical paths.

## C3 — high assurance

Adds:

- explicit hazard analysis where safety-relevant;
- independent V&V for material properties;
- stronger traceability;
- fault injection;
- controlled toolchain;
- assurance evidence package;
- change-impact review.

## C4 — safety/mission critical

Applicable domain standard governs.

Expect proportionately stronger:

- hazard analysis;
- traceability;
- independence;
- tool qualification where required;
- formalized configuration management;
- deterministic/bounded behavior where required;
- safety case/assurance evidence;
- controlled release;
- retained evidence;
- specialist approval.

**Do not imitate C4 paperwork in C1 without risk value.**

---

# 10. The 80 Golden Systems/Embedded Standards

1. **Define the physical and execution environment before choosing the software architecture.**
2. **Treat hardware, firmware, runtime and toolchain assumptions as engineering requirements.**
3. **Make every material state owner explicit.**
4. **Give every shared mutable state an ordering and synchronization contract.**
5. **Give every critical memory region a lifetime, access and exhaustion policy.**
6. **Make invalid hardware/software states difficult to enter and observable when entered.**
7. **Prefer the least complex execution model that satisfies required isolation and timing.**
8. **Real-time means meeting stated temporal constraints; “fast” is not a real-time requirement.**
9. **Name the deadline, clock, tolerance and consequence of miss.**
10. **Use monotonic time for local elapsed-time/deadline logic unless another clock is explicitly required.**
11. **Never infer cross-core/node causality solely from wall-clock timestamps.**
12. **Use absolute periodic release/deadline logic where it prevents cumulative drift and the platform supports it.**
13. **Bound every non-preemptible/interrupt-masked interval that can affect a critical deadline.**
14. **Bound interrupt handler work and make overload/storm behavior explicit.**
15. **A high priority is not a schedulability proof.**
16. **Account for execution, blocking, interference, release jitter and runtime overhead.**
17. **Analyze priority inversion wherever critical fixed-priority work shares blocking resources.**
18. **An RTOS is a mechanism; timing evidence must be demonstrated on the configured target.**
19. **Do not apply a textbook utilization bound outside its assumptions.**
20. **For hard real-time claims, distinguish measured maxima from justified upper bounds.**
21. **Measurement-only evidence MUST NOT be represented as a universal WCET proof unless the method/assumptions justify that claim.**
22. **Multicore shared-resource interference is a first-class timing and assurance concern.**
23. **A platform/core-count change can invalidate timing evidence even when source code is unchanged.**
24. **Select static, pool, arena or dynamic allocation from boundedness and failure requirements—not folklore.**
25. **Hard real-time critical paths require bounded allocation/deallocation or no runtime allocation.**
26. **Always define memory-exhaustion behavior.**
27. **Treat stack overflow as a resource failure with detection/containment where consequence warrants.**
28. **Prefer memory-safe implementation paths for new security-sensitive code when practical.**
29. **Memory-safe language does not remove timing, logic, privilege, unsafe/FFI or hardware-interface risk.**
30. **C/C++ use requires explicit language/version, UB controls and appropriate coding/security profile.**
31. **`volatile` is not a standard thread-synchronization primitive.**
32. **Atomicity does not by itself establish a correct concurrent algorithm.**
33. **Distinguish language memory order, CPU memory order and device-I/O order.**
34. **Lock-free does not imply wait-free, starvation-free or hard-real-time boundedness.**
35. **Critical lock hold times and lock order MUST be knowable.**
36. **Model deadlock, livelock, starvation, cancellation and restart.**
37. **Use process/partition isolation when it materially reduces blast radius.**
38. **IPC contracts include backpressure, queue bounds, restart and version semantics.**
39. **Asynchronous signal/callback contexts get a restricted operation set.**
40. **MMIO is a device protocol, not ordinary shared memory.**
41. **Use platform-authorized MMIO accessors/barriers; do not invent ordering from source-code appearance.**
42. **Never assume register read-modify-write is safe without register semantics.**
43. **DMA requires explicit buffer ownership and coherency transitions.**
44. **Peripheral/bus operations require finite timeout or an explicit reason why waiting is safe.**
45. **Hardware interface contracts include reset/power/init/error/recovery behavior.**
46. **Track silicon/board errata as versioned dependencies.**
47. **Boot/reset is a safety/security-sensitive state machine.**
48. **Hazard-relevant outputs have defined behavior before software reaches READY.**
49. **Record reset cause and boot/update outcome where it materially improves recovery/diagnosis.**
50. **A watchdog is not proof of safety; it is one fault-detection/recovery mechanism.**
51. **Watchdog coverage requires independence, deadline and recovery semantics.**
52. **Prevent uncontrolled reset loops where repeated restart can worsen harm.**
53. **Persistent writes account for interruption, wear, corruption and version migration.**
54. **A CRC/checksum is integrity/error-detection evidence, not authentication.**
55. **Firmware update authenticity, compatibility, activation and recovery are separate properties.**
56. **Protect firmware, detect corruption/invalid state and provide a recovery path when consequence warrants.**
57. **Signed firmware is not automatically safe, correct or compatible firmware.**
58. **Anti-rollback is a security control that must be reconciled with operational recovery needs.**
59. **Update keys and trust anchors have rotation/revocation/recovery lifecycles.**
60. **Production debug/test interfaces are explicitly disabled, authenticated or otherwise governed.**
61. **Safety begins with hazards, not with a coding standard.**
62. **Trace hazard → safety constraint → requirement → control → verification → residual risk.**
63. **Fail-safe vs fail-operational is hazard-driven.**
64. **Redundancy without independence can duplicate the same failure.**
65. **Analyze common-cause/common-mode dependencies.**
66. **Safety and cybersecurity are co-engineered when malicious control can create a hazard.**
67. **SIL, ASIL, DAL and other integrity levels are domain-specific; do not numerically cross-map them by default.**
68. **Coding standards reduce defect classes; they do not certify system safety.**
69. **Compiler, linker, LTO, runtime and build flags are part of the executable system.**
70. **Verify the exact production artifact and configuration.**
71. **Changes to toolchain, RTOS, BSP, silicon, clocks or optimization trigger impact analysis.**
72. **Target tests complement—not replace—host/unit/formal analysis.**
73. **HIL is evidence about represented hardware/environment, not proof of all field behavior.**
74. **Fault injection tests recovery paths that ordinary success-path tests cannot establish.**
75. **Diagnostics/telemetry MUST be bounded so observability cannot violate timing/safety.**
76. **Instrument overrun, reset and fault behavior where it can change an engineering decision.**
77. **Field failures feed back into hazard/threat/timing assumptions.**
78. **Retain enough provenance to identify source, toolchain, hardware target and released image.**
79. **Maintenance includes silicon errata, toolchain support, component EOL, vulnerabilities and standards revisions.**
80. **When uncertainty affects a safety/timing claim, preserve it and increase assurance rather than hiding it behind margin.**

---

# 11. Determinism model

“Deterministic” is too vague unless the dimension is named.

V2 uses seven dimensions.

## 11.1 Functional determinism

Same relevant state/input under defined conditions produces the same specified logical result.

## 11.2 Temporal determinism

Execution/response remains within a required time envelope.

## 11.3 Scheduling determinism

Task release, precedence, preemption and blocking behavior follow a defined model.

## 11.4 Resource determinism

Memory, queue, file descriptor, DMA descriptor and other critical resource consumption are bounded.

## 11.5 I/O determinism

Peripheral/bus behavior has defined timing/error/retry bounds sufficient for the requirement.

## 11.6 Recovery determinism

Reset, failover and update recovery reach a defined state within required bounds.

## 11.7 Evidence determinism

The exact production configuration can be reconstructed well enough to explain why the claim holds.

A system MAY be functionally deterministic but temporally nondeterministic. Never collapse the dimensions.

---

# 12. Memory architecture

## 12.1 Memory map is a controlled artifact

For C2+ or any system with custom linker/layout, retain:

```yaml
region:
  start_end:
  type: ram|flash|nvm|mmio|dma|shared|secure
  owner:
  writers:
  readers:
  lifetime:
  alignment:
  cacheability:
  executable:
  privileged:
  initialization:
  persistence:
  overflow_or_exhaustion:
  verification:
```

## 12.2 Sources of memory failure

Consider:

- out-of-bounds;
- use-after-free;
- double free;
- uninitialized memory;
- aliasing violations;
- integer overflow feeding size/pointer logic;
- stack overflow;
- heap/pool exhaustion;
- fragmentation;
- alignment;
- endian mismatch;
- padding/ABI mismatch;
- stale DMA ownership;
- cache incoherency;
- torn persistent writes;
- ECC/parity events;
- memory-mapped device side effects.

## 12.3 Stack engineering

Critical task stack sizing SHOULD combine:

- static call/stack analysis where suitable;
- measured high-water under representative stress;
- interrupt/nesting contribution;
- library/RTOS hidden use;
- worst credible error/recovery path;
- change margin.

Guard pages/MPU regions/canaries MAY increase detectability where supported.

## 12.4 Dynamic allocation decision

Dynamic allocation is **not universally prohibited**.

Use this gate:

```text
Does runtime allocation occur on a hard-deadline / safety-critical path?
  ├─ NO → ordinary allocation may be acceptable with exhaustion handling.
  └─ YES → Can a credible worst-case latency + exhaustion bound be shown?
           ├─ NO → preallocate / pool / arena / redesign.
           └─ YES → use only with documented bound, ownership and tests.
```

Allocation policy MUST define:

- maximum memory;
- maximum object count where material;
- failure return/exception behavior;
- ownership/lifetime;
- concurrency;
- fragmentation assumption;
- reset/reclamation;
- observability.

## 12.5 Persistent memory

For EEPROM/flash/NVM:

- know erase/write granularity;
- endurance/write-cycle budget;
- atomicity/torn-write behavior;
- ECC/error behavior;
- power-fail semantics;
- version/migration format;
- rollback compatibility;
- corruption detection;
- recovery/default behavior.

Common patterns:

- append-only journal;
- dual-slot generation records;
- commit marker written last;
- CRC/ECC for corruption detection;
- versioned schema;
- wear leveling.

A checksum does not authenticate state against an attacker.

---

# 13. Language, undefined behavior and memory safety

## 13.1 Language/runtime profile

Every production target MUST pin:

- language standard version;
- compiler;
- compiler version;
- language extensions;
- warning policy;
- optimization;
- sanitizer/static-analysis profile used in verification;
- coding standard/profile if applicable.

## 13.2 C systems

Current baseline: ISO/IEC 9899:2024.

For high-assurance C:

- avoid undefined/unspecified behavior relied upon for correctness;
- validate integer/pointer bounds;
- control casts and aliasing;
- treat object representation/padding carefully;
- separate MMIO/device access from normal objects;
- use atomic/synchronization primitives for inter-thread communication;
- use current secure/coding profile appropriate to the domain.

MISRA C:2025 is a current critical-systems coding-guideline option. It is not a safety certificate and does not replace hazard, architecture, timing, integration or validation work.

ISO/IEC 24772-1:2024 provides a current language-independent vulnerability catalogue and can be used to audit language/runtime profiles. ISO/IEC TR 24772-3:2020 provides the C-specific manifestation/avoidance profile and SHOULD be consulted when C is used in assured-behavior systems.

## 13.3 Memory-safe languages

For new security-sensitive systems/components, memory-safe languages SHOULD be considered where:

- target/toolchain support exists;
- required hardware/RTOS bindings exist;
- performance/timing can be established;
- certification/tool qualification path is acceptable;
- team can maintain the code.

Still audit:

- unsafe blocks;
- FFI;
- DMA;
- MMIO;
- allocator;
- concurrency;
- integer/logic faults;
- panic/unwind behavior;
- runtime footprint;
- timing.

## 13.4 Mixed-language systems

Every FFI boundary is a trust boundary for:

- ABI;
- ownership;
- lifetime;
- alignment;
- error handling;
- unwinding/exception model;
- concurrency;
- representation;
- allocator compatibility.

## 13.5 Object-oriented and dynamic features in safety-relevant software

Object orientation, dynamic dispatch, dynamic objects, exceptions, generic/runtime reflection and managed runtime features are **not universally forbidden** in safety-relevant software. They MUST be justified against the applicable domain standard and the properties the system actually needs.

Where such features are used in a safety-relevant path, explicitly analyze as applicable:

- allocation/deallocation and fragmentation behavior;
- object lifetime and ownership;
- dynamic dispatch/call-target analyzability;
- exception/unwind semantics;
- initialization order;
- runtime/garbage-collection pauses;
- hidden synchronization;
- bounded stack/heap use;
- worst-case timing and interference;
- toolchain/code-generation behavior;
- testability and traceability.

IEC TR 61508-3-3:2025 is useful evidence that object-oriented techniques can be justified under controlled conditions in IEC 61508 safety contexts; it is a **supplement**, not a replacement for IEC 61508-3. The transferable rule is to assure the relevant properties, not to ban or bless a language paradigm by label.

---

# 14. Concurrency correctness model

## 14.1 State before primitives

Do not begin with “mutex or atomic?”

Begin with:

```yaml
state:
invariant:
owner:
allowed_concurrent_operations:
required_ordering:
conflict_semantics:
progress_requirement:
deadline:
failure_recovery:
```

Then choose the primitive.

## 14.2 Data race vs race condition

- **data race:** conflicting unsynchronized memory accesses under a language memory model where at least one is a write; often undefined or erroneous behavior depending on language.
- **race condition:** correctness depends on relative timing/order; can exist even with individually atomic accesses.

Eliminating data races does not automatically eliminate race conditions.

## 14.3 Linearizability and other correctness conditions

Linearizability is a strong correctness condition for concurrent objects: operations appear to take effect atomically at some point between invocation and response, consistent with real-time order.

Do not require linearizability where weaker semantics are sufficient. Do not claim it without proof/evidence.

## 14.4 Locking

Critical locks SHOULD define:

```yaml
lock:
protected_state:
order_rank:
max_hold_time:
contenders:
priority_protocol:
may_block_in_isr: false
cancellation_behavior:
owner_death_behavior:
```

Rules:

- maintain an explicit lock order for nested locks;
- keep critical sections bounded;
- never wait indefinitely in a hard-deadline path without a justified model;
- include error/recovery paths in lock analysis;
- ensure the lock outlives the state/protocol users.

## 14.5 Priority inversion

A higher-priority task can be blocked by a lower-priority task holding a shared resource. Medium-priority work can amplify the delay.

For fixed-priority critical systems, use one or more as justified:

- eliminate sharing;
- bounded critical sections;
- priority inheritance;
- priority ceiling/protection;
- architectural partitioning;
- static schedule.

The protocol itself must be supported and verified on the target runtime.

## 14.6 Atomics and memory ordering

For each atomic algorithm define:

- invariant;
- atomic object(s);
- memory order;
- publication/visibility requirement;
- progress property;
- ABA/version issue if relevant;
- wraparound;
- retry bound;
- reclamation strategy;
- architecture assumptions.

`volatile` MUST NOT substitute for atomics/locks for standard C thread synchronization.

## 14.7 Lock-free and wait-free

Use precise terms:

- **obstruction-free:** progress if one actor runs in isolation long enough;
- **lock-free:** system as a whole makes progress under the formal model;
- **wait-free:** each operation completes in a finite/bounded number of its own steps under the formal model.

Hard real-time cares about **per-operation worst case**, not branding.

A lock-free CAS loop with unbounded contention can be unacceptable for a hard deadline.

## 14.8 Reclamation

Non-blocking structures often move complexity into memory reclamation:

- hazard pointers;
- epochs/RCU;
- reference counting;
- quiescent-state mechanisms;
- bounded pools.

Reclamation must satisfy lifetime, boundedness and memory-exhaustion requirements.

---

# 15. Processes, threads and isolation

## 15.1 Process vs thread decision

Prefer process/partition boundaries when:

- privilege differs;
- restart independence matters;
- corruption containment matters;
- untrusted code/plugins exist;
- mixed criticality needs isolation.

Prefer threads when:

- address-space sharing is required;
- latency/footprint dominate;
- shared-state model remains tractable.

## 15.2 Privilege

Run the least privilege consistent with the function.

Separate where practical:

- boot/update authority;
- device-driver privilege;
- network-facing parsing;
- safety-control logic;
- diagnostics/maintenance;
- user/business logic.

## 15.3 Supervision

A restartable component SHOULD define:

```yaml
health_signal:
failure_detection:
restart_authority:
restart_limit:
backoff:
state_reconciliation:
dependency_order:
reset_loop_containment:
escalation:
```

Restart without state reconciliation can repeat corruption or hazards.

---

# 16. IPC and queues

Every IPC channel MUST define:

- producer(s);
- consumer(s);
- schema/version;
- copy vs shared memory;
- queue depth;
- full behavior;
- empty behavior;
- ordering;
- priority;
- timeout/cancellation;
- restart semantics;
- duplicate semantics;
- memory ownership;
- observability.

## 16.1 Queue rule

Unbounded queues are prohibited where sustained input can exceed service rate and exhaust a critical resource.

A queue absorbs **bursts**, not infinite overload.

For each queue:

```yaml
capacity:
expected_arrival_rate:
service_rate:
burst_assumption:
full_policy: reject|drop_oldest|drop_newest|block|degrade|reset
priority_policy:
producer_backpressure:
overrun_signal:
```

---

# 17. Signals and asynchronous callbacks

Asynchronous contexts can interrupt code at unsafe points.

Where POSIX/C signals are used:

- follow the platform’s async-signal-safe rules;
- restrict shared-state access to permitted mechanisms;
- avoid non-reentrant operations;
- prefer converting asynchronous signals into normal event-loop/task context when practical.

For any callback/ISR-like environment, define the allowed operation subset.

---

# 18. Interrupt engineering

## 18.1 Interrupt contract

```yaml
interrupt:
source:
trigger: edge|level|message
priority:
maximum_expected_rate:
credible_storm_rate:
nesting:
maskable:
ack_sequence:
isr_budget:
shared_state:
deferred_work:
overflow_policy:
fault_behavior:
```

## 18.2 ISR rules

An ISR SHOULD:

- do only time-critical work;
- acknowledge/capture the event correctly;
- use bounded operations;
- avoid blocking;
- avoid unbounded loops;
- avoid normal heap allocation unless explicitly proven acceptable;
- avoid general logging/formatting;
- transfer ownership cleanly to deferred context;
- handle burst/storm behavior.

## 18.3 Interrupt latency budget

Include:

- higher-priority ISR nesting;
- interrupt mask time;
- non-preemptible kernel sections;
- architecture entry/exit;
- cache/TLB effects;
- critical sections;
- interrupt routing;
- hypervisor/firmware interference if applicable.

---

# 19. Time architecture

## 19.1 There is no single “time”

Classify every use.

| Clock/use | Purpose | Failure risk |
|---|---|---|
| monotonic | local intervals/deadlines | suspend semantics may differ |
| wall/civil time | logs/user timestamps | can step/change |
| boot-time | elapsed including suspend on some systems | platform-specific |
| CPU-time | execution consumption | not wall response time |
| hardware counter | precise target timing | wrap/frequency/reset |
| RTC | persistent civil time | drift/battery/tamper |
| synchronized network clock | cross-device timing | bounded sync error required |

## 19.2 Clock contract

```yaml
clock:
source:
resolution:
accuracy:
monotonicity:
drift:
sync_error:
can_step:
can_slew:
wrap_period:
reset_behavior:
suspend_behavior:
failure_detection:
```

## 19.3 Rollover

Explicitly test:

- tick wrap;
- sequence number wrap;
- counter saturation;
- 32-bit time conversion;
- long uptime;
- reboot/RTC discontinuity.

Use wrap-safe arithmetic where required.

## 19.4 Periodic execution

Prefer an absolute-deadline model for periodic work when supported:

```text
next_release = epoch + n × period
```

rather than repeatedly “sleep period after work,” which can accumulate phase drift.

---

# 20. Real-time classification and timing contract

## 20.1 Operational classes

### Hard real-time

A deadline miss is an unacceptable failure/hazard within the defined operating envelope.

### Firm real-time

A late result has negligible/no value; some bounded miss behavior may be acceptable.

### Soft real-time

Lateness degrades quality but can remain useful.

The category is defined by consequence and acceptance criteria—not by implementation technology.

## 20.2 Timing contract

For each critical activity:

```yaml
activity:
trigger:
clock:
period_or_min_interarrival:
deadline:
release_jitter:
wcet_or_execution_budget:
blocking_bound:
preemption_interference:
interrupt_interference:
io_bus_bound:
multicore_interference:
scheduler_overhead:
margin:
overrun_detection:
overrun_response:
evidence:
```

## 20.3 Response-time accounting

Conceptual model:

```text
R
= C
+ B
+ I
+ J
+ O
+ IO
+ M
```

where:

- `C` = own execution;
- `B` = blocking;
- `I` = execution interference/preemption;
- `J` = release/event jitter contribution;
- `O` = scheduler/context/interrupt overhead;
- `IO` = bounded external/bus/device wait;
- `M` = microarchitectural/shared-resource effects not already counted.

This is not a universal schedulability formula. The actual analysis must match the scheduler/system model.

---

# 21. WCET and temporal evidence

## 21.1 Evidence ladder

### T0 — no timing evidence

Only anecdotal/average observation.  
Not acceptable for hard real-time claims.

### T1 — representative measurement

Useful for ordinary latency/performance.  
Does not by itself prove worst case.

### T2 — stress + coverage-informed measurement

Adds:

- worst-path scenarios;
- high interrupt load;
- max queue/load;
- cache states;
- DMA/bus contention;
- temperature/power mode where material.

Stronger, still empirical.

### T3 — analysis-backed bound

Static/symbolic/model/measurement hybrid with explicit hardware/software assumptions.

### T4 — certification-grade/domain-specific timing assurance

Method, independence, evidence and configuration control meet the applicable high-assurance standard/certification basis.

## 21.2 Measurement rule

Never write:

> “WCET = largest time observed in test”

unless the assurance method explicitly justifies why that observation is a credible upper bound.

Use “maximum observed execution time” when that is what was measured.

## 21.3 Instrumentation effect

Tracing can perturb:

- cache;
- timing;
- locks;
- I/O;
- interrupts.

Timing evidence MUST state instrumentation and estimated observer effect where material.

---

# 22. Scheduling

## 22.1 Scheduling models

Possible choices:

- cyclic executive;
- cooperative;
- fixed-priority preemptive;
- fixed-priority non-preemptive;
- deadline-based/EDF;
- time-triggered;
- partitioned/static multicore;
- global/migrating multicore;
- mixed-criticality/partitioned hypervisor.

No model is universally best.

## 22.2 Task contract

```yaml
task:
criticality:
trigger:
period_or_min_interarrival:
deadline:
priority_or_deadline_policy:
cpu_budget:
wcet_evidence:
blocking:
jitter:
stack:
core_affinity:
shared_resources:
io:
overrun_policy:
restart_policy:
```

## 22.3 Liu–Layland caution

Foundational scheduling theory provides powerful results under explicit assumptions.

Do **not** import utilization thresholds mechanically into systems with:

- arbitrary deadlines;
- blocking;
- release jitter;
- self-suspension;
- non-preemptive regions;
- multicore migration;
- shared caches/buses;
- variable execution distributions.

Use analysis valid for the real model.

---

# 23. Priority inversion and shared resources

For every critical shared resource:

```yaml
resource:
owners:
contenders:
critical_sections:
max_hold_time:
nesting:
priority_protocol:
blocking_bound:
recovery:
```

Use priority inheritance/ceiling/protection only when:

- runtime semantics are understood;
- nested behavior is analyzed;
- protocol parameters are correct;
- actual target implementation is verified.

Do not “solve” inversion by raising every task priority.

---

# 24. Multicore and shared-resource interference

Multicore is a different assurance problem, not just “more CPUs.”

## 24.1 Shared resources

Map:

- LLC/cache slices;
- memory controller/channels;
- coherent interconnect;
- bus fabric;
- DMA;
- storage;
- I/O;
- interrupts;
- power/thermal/frequency state;
- hypervisor/firmware services.

## 24.2 Multicore assurance questions

- Can one core delay another’s critical task?
- What are maximum co-runner behaviors?
- Is memory bandwidth partitioned or bounded?
- Can DMA saturate a shared fabric?
- Can interrupt routing move unexpectedly?
- Can OS/kernel work migrate onto a critical core?
- Are caches shared?
- Can DVFS/thermal throttling change timing?
- Are synchronization retries bounded?

## 24.3 Controls

Depending on risk:

- CPU affinity;
- isolation/dedicated cores;
- bounded co-runners;
- cache/bandwidth partitioning;
- static resource budgets;
- interrupt affinity;
- disable unneeded migration;
- controlled frequency/power states;
- interference tests;
- platform-specific analysis.

FAA AC 20-193 is an important domain example of why shared-resource interference becomes certification-significant in airborne multicore systems. Do not apply its exact certification process universally; do preserve the mechanism.

# 25. MMIO and device-register engineering

Memory-mapped I/O is not ordinary memory. Register access can trigger hardware behavior, acknowledge interrupts, clear status, start transfers, or change power/safety state.

## 25.1 Register contract

For each material device/register block, record:

```yaml
device:
base_address_source:
register_spec_version:
clock_reset_dependencies:
access_widths:
endianness:
ordering_requirements:
read_side_effects:
write_side_effects:
reserved_bits_policy:
write_one_to_clear_bits:
write_zero_to_clear_bits:
read_modify_write_safe: true|false|conditional
atomicity_guarantees:
interrupt_interactions:
reset_values:
security_privilege:
verification:
```

## 25.2 Rules

- MUST derive addresses, widths, bit semantics, reset behavior, and reserved-bit rules from the authoritative hardware specification or generated description.
- MUST NOT assume a normal C/C++ load/store expresses the required device ordering or access width on every architecture.
- MUST NOT perform read-modify-write on registers with read side effects, W1C/W0C fields, write-only fields, or hardware-updated bits unless the device explicitly defines it as safe.
- SHOULD isolate register access behind small typed/domain-specific interfaces rather than spread magic addresses and masks across application logic.
- SHOULD use masks generated from authoritative hardware descriptions where trustworthy generation is available and controlled.
- MUST preserve reserved bits exactly as the hardware specification requires.
- MUST verify that compiler optimization cannot remove, merge, reorder, or widen/narrow accesses in a way that violates the hardware contract.
- MUST distinguish compiler visibility (`volatile` or equivalent) from synchronization and memory ordering.
- MUST use the architecture/compiler mechanism actually required for barriers, atomics, or device-memory ordering.
- SHOULD include hardware-facing negative tests for invalid/reset/degraded states when consequence warrants.

## 25.3 Common MMIO failure modes

| Failure | Mechanism | Typical control |
|---|---|---|
| Lost status/event | read clears register unexpectedly | single owner, shadow/capture, documented read semantics |
| Accidental acknowledge | generic read/write helper touches W1C bit | semantic accessors, masks, tests |
| Corrupted reserved bits | blind write of full word | masked/generated write path |
| Wrong access width | compiler emits byte/word access unsupported by device | fixed-width typed accessor + disassembly/target test |
| Reordering | CPU/compiler moves device and memory operations | correct barrier/device-memory primitive |
| Concurrent RMW | ISR/task/hardware update collides | ownership, critical section, atomic/set-clear alias registers |
| Stale spec | silicon revision changes semantics | device-revision binding + errata process |

---

# 26. DMA, cache coherency and shared memory with devices

DMA creates concurrency between CPU, device, caches, and memory subsystem. Treat it as a state-ownership and ordering problem.

## 26.1 DMA buffer contract

```yaml
buffer:
producer:
consumer:
coherent_hardware: true|false|partial
cache_policy:
alignment:
size_and_bounds:
lifetime:
ownership_transition:
pre_dma_operation:
post_dma_operation:
barriers:
iommu_or_mpu_policy:
address_width:
scatter_gather_rules:
completion_signal:
error_signal:
timeout:
recovery:
```

## 26.2 Rules

- MUST define who owns a DMA buffer at every point in the transfer lifecycle.
- MUST NOT let CPU and device concurrently mutate the same bytes unless the interface is deliberately designed for that concurrency.
- MUST account for cache maintenance on non-coherent or partially coherent platforms.
- MUST treat cache clean/invalidate operations and barriers as architecture-specific correctness mechanisms, not folklore sequences.
- MUST bound DMA descriptors, lengths, and addresses before programming hardware.
- SHOULD use IOMMU/MPU or equivalent containment when supported and consequence justifies it.
- MUST validate device completion/error state before consuming data.
- MUST handle timeout, abort, partial transfer, bus error, descriptor corruption, and reset races where credible.
- MUST treat descriptors as shared state; descriptor publication/consumption ordering must be explicit.
- SHOULD test with cache enabled, optimization enabled, realistic bus contention, and representative transfer sizes.

## 26.3 DMA anti-patterns

- assuming a successful interrupt means all intended bytes are valid;
- invalidating a dirty CPU cache line and silently discarding CPU writes;
- cleaning after ownership has already transferred to the device;
- reusing a buffer before device quiescence is proven;
- programming a device from user-controlled length/address without a trusted bounds check;
- treating coherent development hardware as proof for a non-coherent production variant.

---

# 27. Hardware-interface contract standard

Every hardware/software boundary that can affect correctness, timing, safety, or security SHOULD have an explicit contract.

Minimum contract:

```yaml
interface_id:
hardware_revision:
software_revision:
physical_or_logical_bus:
electrical_assumptions:
initialization_order:
clocking:
reset_behavior:
addressing:
data_format:
endianness:
units_and_scaling:
valid_ranges:
timing:
latency_deadlines:
timeouts:
error_detection:
error_codes:
retries:
recovery:
concurrency:
interrupts:
dma:
power_states:
hotplug_or_absence_behavior:
security_trust_boundary:
safe_state_behavior:
observability:
verification_evidence:
```

## 27.1 Device absence is a normal state

Boot and runtime code MUST define behavior when:

- device does not respond;
- wrong device/revision is present;
- expected clock/power domain is unavailable;
- calibration/NVM data is absent or invalid;
- link is degraded;
- sensor reports implausible values;
- peripheral resets independently;
- bus arbitration is delayed;
- the device is replaced during service.

## 27.2 Units are part of the contract

For physical values, encode or document:

- SI/unit;
- scale/offset;
- range;
- resolution;
- saturation behavior;
- invalid/sentinel encoding;
- calibration version;
- conversion overflow behavior.

Unit mismatch is a systems defect, not a cosmetic type issue.

---

# 28. Polling vs interrupt vs DMA decision framework

No mechanism is universally superior.

| Mechanism | Strong when | Main risks |
|---|---|---|
| Polling | bounded short waits, deterministic sampling, simple device, no useful work during wait | wasted CPU/power, hidden long waits, starvation |
| Interrupt | event-driven work, bounded service time, useful CPU work between events | storming, jitter, priority inversion, shared-state races |
| DMA | bulk/stream transfer where CPU copying is wasteful | coherency, descriptor ownership, bus interference, recovery complexity |

Decision sequence:

1. What latency/deadline is required?
2. What is the maximum event/data rate?
3. What CPU budget and power budget exist?
4. How bursty can the source become?
5. Can interrupt rate overload the system?
6. Is DMA coherency/ownership complexity justified?
7. What is the recovery behavior for a hung device?
8. What mechanism gives the simplest bounded behavior that satisfies the requirement?

Hybrid designs are common: DMA for transfer, interrupt for completion, polling during early boot or bounded critical windows.

---

# 29. Boot and reset architecture

Boot is a state machine that establishes trust, hardware readiness, persistent-state validity, and operational capability.

## 29.1 Boot phases

A useful generic model:

```text
RESET VECTOR
→ MINIMUM CPU/RUNTIME STATE
→ TRUST / IMAGE VALIDATION WHERE REQUIRED
→ CLOCK / MEMORY FOUNDATION
→ CRITICAL HARDWARE INIT
→ PERSISTENT-STATE VALIDATION
→ PLATFORM SERVICES / KERNEL
→ DEVICE DISCOVERY / INIT
→ APPLICATION INIT
→ SELF-TEST / READINESS CHECK
→ OPERATIONAL
```

The exact ordering is platform-specific.

## 29.2 Boot invariants

- MUST know which reset causes are distinguishable and which state survives each reset.
- MUST initialize memory/runtime prerequisites before relying on them.
- MUST not expose externally consequential functionality before required security/safety checks complete.
- MUST define behavior for incomplete initialization.
- MUST define what happens when an optional device fails.
- MUST define what happens when a mandatory device fails.
- SHOULD expose staged readiness rather than one ambiguous “booted” flag.
- SHOULD record reset/boot reason in durable or retained diagnostic state when valuable.
- MUST avoid reset loops without bounded escalation/recovery.
- MUST test brownout, watchdog, software reset, cold start, warm reset, update reboot, and corrupted persistent-state paths where relevant.

## 29.3 Reset-domain analysis

For each reset source:

```yaml
reset_source:
what_resets:
what_survives:
what_hardware_keeps_running:
shared_state_hazard:
persistent_state_effect:
external_output_effect:
safe_reentry_sequence:
loop_detection:
escalation:
```

A CPU reset that leaves DMA/peripherals active can create post-reset corruption unless reentry quiesces or reclaims them correctly.

---

# 30. Watchdogs and supervision

A watchdog is an independent liveness/failure-containment mechanism only to the extent that its failure path is independent of the fault it is meant to detect.

## 30.1 Rules

- MUST define what failure hypothesis the watchdog detects.
- MUST define the deadline/window and why it is safe.
- MUST NOT feed the watchdog from a timer ISR merely proving that interrupts still run when the actual application is deadlocked.
- SHOULD aggregate health from critical tasks/subsystems before feed where practical.
- MUST define recovery after expiry and verify that recovery cannot create unsafe repeated cycling.
- SHOULD use windowed watchdog semantics when early feeding indicates a fault and the hardware supports it.
- SHOULD preserve enough diagnostic evidence to distinguish watchdog resets from power or software resets.
- MUST consider watchdog behavior during firmware update, debugger use, deep sleep, clock transitions, and long legitimate operations.
- For C3/C4 systems, SHOULD analyze watchdog independence, common-cause failures, and latent failure of the watchdog itself.

## 30.2 Supervisory hierarchy

A layered example:

```text
TASK HEARTBEAT / PROGRESS
→ SOFTWARE SUPERVISOR
→ OS/KERNEL HEALTH
→ HARDWARE WATCHDOG
→ EXTERNAL SUPERVISOR / POWER CYCLER (when justified)
```

Do not add layers without a distinct failure mechanism they contain.

---

# 31. Persistent-state engineering

Nonvolatile state can outlive software versions, power loss, resets, partial writes, and device replacement.

## 31.1 Persistent-state contract

```yaml
state:
owner:
format_version:
compatibility:
atomicity_unit:
power_loss_model:
integrity_check:
redundancy:
wear_model:
default_or_factory_state:
migration:
rollback_compatibility:
confidentiality:
authenticity:
recovery:
```

## 31.2 Rules

- MUST version long-lived formats that may evolve.
- MUST define atomic commit semantics for state that cannot tolerate torn updates.
- MUST not treat CRC as authenticity; checksum detects accidental corruption, not an attacker with write access.
- SHOULD separate configuration, calibration, operational counters, secrets, and forensic logs by lifecycle/security needs.
- MUST define behavior when state is corrupt, missing, newer than software, or older than expected.
- MUST account for flash/EEPROM wear and erase granularity where material.
- SHOULD use journal, copy-on-write, A/B records, monotonic sequence, or transactional structure when consequence justifies it.
- MUST test power interruption at every material write phase for C2+ state transitions where power loss is credible.

---

# 32. Firmware platform security and resiliency

For platforms whose firmware establishes lower-level trust, security must include recovery from corruption—not only prevention.

NIST SP 800-193 provides a useful cross-platform conceptual model:

```text
PROTECT
→ DETECT
→ RECOVER
```

This is a strong architecture lens, not a universal implementation recipe.

## 32.1 Protect

Depending on threat model:

- authenticated/verified updates;
- immutable or strongly protected root of trust;
- least-privilege flash/update permissions;
- rollback policy;
- debug lock/control;
- protected secrets/keys;
- bounds checks on parsers and manifests;
- anti-tamper where material.

## 32.2 Detect

- boot-time image verification;
- runtime integrity signals where useful;
- persistent corruption detection;
- update verification;
- version/manifest consistency;
- unauthorized configuration-change detection.

## 32.3 Recover

- known-good recovery image;
- A/B bank;
- ROM recovery path;
- service recovery;
- rollback/roll-forward policy;
- bounded boot-attempt counter;
- recovery authorization;
- post-recovery validation.

A secure boot path without a usable recovery path can convert corruption into permanent unavailability.

---

# 33. Firmware update engineering

Firmware update is a privileged distributed transaction across artifact, device state, power, storage, version compatibility, and recovery.

RFC 9019 and RFC 9124 provide strong architecture/manifest concepts for IoT firmware update ecosystems, while product-specific standards may impose stronger requirements.

## 33.1 Canonical update state machine

```text
IDLE
→ CANDIDATE_RECEIVED
→ MANIFEST_VALIDATED
→ ARTIFACT_VALIDATED
→ COMPATIBILITY_CHECKED
→ STAGED
→ ACTIVATION_REQUESTED
→ BOOT_TRIAL
→ HEALTH_VALIDATED
→ COMMITTED
```

Failure branches:

```text
ANY PRE-COMMIT FAILURE
→ REJECT / RESTORE PREVIOUS KNOWN-GOOD / RECOVERY MODE
```

## 33.2 Manifest minimum

```yaml
product_family:
hardware_compatibility:
image_version:
security_version_or_rollback_epoch:
artifact_digest:
signature_or_authentication:
image_size:
partition_target:
dependencies:
minimum_bootloader:
minimum_data_schema:
release_constraints:
recovery_requirements:
```

## 33.3 Rules

- MUST authenticate firmware when an attacker can influence update content.
- MUST verify integrity before activation.
- MUST verify hardware/product compatibility.
- MUST bound lengths/offsets before write.
- MUST make interrupted download/write/activation recoverable to the required level.
- MUST distinguish “image installed” from “image proven healthy.”
- SHOULD use trial boot + health confirmation before permanent commit where architecture allows.
- MUST model data/schema compatibility with rollback.
- MUST protect update authority independently of application-level persuasion or untrusted content.
- MUST define update concurrency and duplicate-request behavior.
- SHOULD rate-limit failed update attempts when they can cause wear or denial of service.
- MUST test update under power loss, reset, corrupt manifest, corrupt image, wrong target, full storage, network loss, and failed new firmware health check where relevant.

---

# 34. Anti-rollback vs recoverability

Anti-rollback and recovery can conflict.

Anti-rollback can reduce reintroduction of known-vulnerable firmware, but a strict monotonic policy can brick or prevent emergency recovery if rollback is the only working path.

Decision record SHOULD include:

```yaml
threat_prevented_by_anti_rollback:
security_epoch_model:
recovery_images_allowed:
emergency_override:
override_authority:
auditability:
offline_recovery:
data_schema_compatibility:
field_service_model:
```

Strong pattern:

- separate **functional version** from **security epoch**;
- allow recovery only to images whose security epoch is still accepted;
- preserve an independently protected recovery path;
- explicitly govern emergency downgrade if permitted.

Do not copy this pattern if the platform/domain standard requires different semantics.

---

# 35. Secure boot, verified boot and measured boot

These terms are related but not interchangeable.

- **Secure/verified boot**: execution is conditioned on verification/authentication according to policy.
- **Measured boot**: measurements of boot components are recorded into a protected mechanism for later attestation/evaluation.
- **Recovery boot**: a separate path intended to restore a trustworthy operating image/state.

A device can be measured but still execute an untrusted image if policy permits it. A verified image can still contain vulnerabilities. A valid signature does not prove software correctness.

For material boot trust:

- define root-of-trust assumptions;
- define key lifecycle/revocation;
- define what exactly is covered by verification;
- define configuration/data outside the signed image;
- define failure behavior;
- define recovery;
- define anti-rollback;
- test key rotation/revocation and corrupt metadata where applicable.

---

# 36. Debug, manufacturing and service interfaces

Debug/test interfaces often bypass the same controls that protect production software.

Inventory:

- JTAG/SWD;
- UART/console;
- bootloader shell;
- factory test commands;
- manufacturing keys;
- service passwords/tokens;
- hidden diagnostic protocol;
- boundary-scan;
- ROM download mode;
- USB recovery/service modes.

Rules:

- MUST identify which interfaces exist in production hardware.
- MUST define production enable/disable/authentication state.
- MUST protect factory/service credentials proportionate to consequence.
- MUST not assume physical access is irrelevant merely because the product is “embedded.”
- SHOULD make privileged service actions auditable when feasible.
- MUST ensure debug disablement does not eliminate necessary approved recovery/service capability without an alternative.
- MUST test unauthorized entry paths and lifecycle transitions (factory → provisioned → field → RMA/decommissioned).

---

# 37. Safety engineering doctrine

Safety-critical software is governed by hazards and unacceptable outcomes, not by generic “high quality” alone.

## 37.1 Hazard chain

Use a traceable chain:

```text
SYSTEM HAZARD
→ SAFETY REQUIREMENT / CONSTRAINT
→ ALLOCATION TO HW/SW/HUMAN/PROCESS
→ SOFTWARE SAFETY REQUIREMENT
→ ARCHITECTURE / CONTROL
→ IMPLEMENTATION
→ VERIFICATION EVIDENCE
→ INTEGRATION / VALIDATION EVIDENCE
→ RESIDUAL RISK / ACCEPTANCE
```

## 37.2 Safety requirements

A software safety requirement SHOULD state, as relevant:

- hazardous condition prevented/controlled;
- operating mode;
- triggering condition;
- required response;
- response deadline;
- safe/degraded state;
- detection assumptions;
- independence assumptions;
- diagnostic coverage assumptions;
- failure behavior;
- verification method.

## 37.3 Core rules

- MUST perform hazard/risk analysis under the applicable domain process when software can materially contribute to harm.
- MUST trace safety requirements through implementation and verification at the required assurance level.
- MUST treat common-cause/systematic failures separately from independent random hardware failures where the domain requires it.
- MUST not use redundancy as a substitute for eliminating a systematic software defect shared by all replicas.
- MUST define safe state or continued safe operation; “reset” is not automatically safe.
- MUST analyze latent faults when redundancy/monitoring relies on components that can silently fail.
- MUST control configuration, tools, libraries, compiler options, generated code, and changes as required by the applicable standard.
- MUST retain objective evidence sufficient for the required assurance/certification case.

---

# 38. Fail-safe, fail-degraded and fail-operational

These are system properties and must be chosen from hazard analysis.

## 38.1 Fail-safe

On detected failure, transition to a state whose remaining risk is acceptable.

Examples can include shutdown, de-energize, inhibit actuation, or physical safe position—but only if system context makes that state safe.

## 38.2 Fail-degraded

Continue a reduced capability while protecting safety/security boundaries.

Requirements:

- what capability remains;
- duration;
- operator/user indication;
- prohibited functions;
- recovery/escalation.

## 38.3 Fail-operational

Continue required operation despite specified failures.

Usually requires stronger:

- fault containment;
- redundancy/independence;
- health monitoring;
- reconfiguration;
- degraded-mode timing analysis;
- common-cause analysis;
- evidence that the remaining path meets the safety requirement.

“High availability” is not automatically fail-operational safety.

---

# 39. Fault model and dependability

Use explicit fault hypotheses. Avizienis et al.'s dependability taxonomy is a useful conceptual anchor: faults can cause errors, which can propagate into externally visible failures.

A practical model:

```text
FAULT
→ INTERNAL ERROR STATE
→ PROPAGATION
→ SERVICE / SAFETY FAILURE
```

Classify credible faults by dimensions such as:

- hardware vs software vs human/configuration;
- transient vs intermittent vs permanent;
- accidental vs malicious;
- development-time/systematic vs runtime/random;
- internal vs external;
- single vs correlated/common cause;
- detected vs latent.

For each high-consequence fault:

```yaml
fault:
assumed_frequency_or_exposure:
error_state:
detection:
detection_latency:
containment:
recovery:
safe_behavior:
latent_risk:
verification:
```

Do not claim fault tolerance for faults outside the analyzed fault model.

---

# 40. Redundancy, diversity and common-cause failure

Redundancy increases assurance only when failure independence is credible enough for the claim.

## 40.1 Questions

- Do replicas share the same requirement error?
- Same algorithm?
- Same source code?
- Same compiler/toolchain?
- Same clock/power?
- Same sensor/input?
- Same bus/interconnect?
- Same physical environment?
- Same firmware update?
- Same operator/configuration?

## 40.2 Diversity

Diversity can reduce selected common-mode risks but introduces:

- interface complexity;
- reconciliation/voting logic;
- independent maintenance burden;
- divergent defect profiles;
- verification complexity.

Use diversity only for a named fault hypothesis and verify the independence mechanism.

## 40.3 Voting is not truth

Two or three channels agreeing does not guarantee correctness when they share a systematic defect or common input corruption.

---

# 41. Safety integrity classifications are not interchangeable

This playbook intentionally does **not** translate SIL, ASIL, DAL, software safety classes, or rail integrity classifications into a universal common scale.

They arise from different domain standards, hazard methods, allocation logic, lifecycle obligations, and evidence requirements.

Rules:

- MUST use the classification scheme of the applicable domain standard.
- MUST NOT claim “ASIL D = SIL 3 = DAL B” or similar equivalence without a formal, scoped method accepted by the relevant authorities/process.
- MAY use a house criticality level for internal planning, but it MUST NOT replace the regulatory/domain classification.
- Cross-domain reuse MUST preserve the strongest applicable constraints and document any assurance gap.

---

# 42. Assurance and safety cases

ISO/IEC/IEEE 15026-2 provides a formal standard for assurance cases. The broader principle is valuable wherever high consequence requires structured confidence.

A minimal claim-argument-evidence pattern:

```text
CLAIM
  why should it be believed?
ARGUMENT
  based on what assumptions/context?
EVIDENCE
  requirements / analysis / test / review / formal proof / operational evidence
```

## 42.1 Rules

- Claims MUST be specific enough to challenge.
- Evidence MUST address the claim directly; “tests passed” is not a universal assurance claim.
- Assumptions and context MUST be explicit.
- Unresolved defeaters/counter-evidence MUST be visible.
- Evidence generated by the same mechanism under assurance SHOULD be diversified/independently checked when consequence requires it.
- Changes MUST trigger impact analysis across affected claims/evidence.

An assurance case is not persuasive writing. It is an inspectable structure showing why reliance is justified and where uncertainty remains.

---

# 43. Safety and cybersecurity co-assurance

Security faults can become safety hazards; safety mechanisms can create security attack surface.

Examples:

- remote diagnostic command can actuate hardware;
- unauthenticated update can replace safety logic;
- safety fallback disables authentication to preserve availability;
- security rate limiting blocks time-critical emergency communication;
- debug lock prevents legitimate safety recovery;
- compromise of a shared time source invalidates safety timing assumptions.

For safety-relevant connected systems:

1. map safety assets and security assets together;
2. connect threat scenarios to hazard scenarios;
3. identify controls with cross-effects;
4. verify security controls do not violate timing/safety requirements;
5. verify safety fallback does not silently weaken critical security boundaries;
6. align incident/recovery plans;
7. retain joint change-impact traceability.

Use the applicable domain pairing, e.g. ISO 26262 + ISO/SAE 21434 for road vehicles, or IEC 61508-family safety with IEC 62443 security where scoped appropriately.

---

# 44. Domain-overlay router

The universal playbook defines mechanisms. The applicable domain standard governs mandatory lifecycle, classification, evidence, independence, and certification obligations.

| Domain / context | Primary current anchor(s) at 2026-09-27 | Use / status note |
|---|---|---|
| Generic E/E/PE functional safety | IEC 61508:2010 series | foundational functional-safety lifecycle and SIL framework; relevant parts remain the current Ed.2 baseline with stability date 2027 |
| Critical OT dependable software | IEC TS 61508-3-2:2024 | mathematical/logical techniques for critical OT software under IEC 61508-3 |
| Object-oriented safety-relevant software | IEC TR 61508-3-3:2025 + IEC 61508-3:2010 | supplemental justification guidance; TR does not replace IEC 61508-3 |
| Road vehicles — functional safety | ISO 26262:2018 series | current published Edition 2 baseline; Edition 3 DIS drafts are under development and MUST remain watch items until final |
| Road vehicles — cybersecurity | ISO/SAE 21434:2021 | vehicle cybersecurity engineering; separate from functional-safety assurance |
| Medical-device software lifecycle | IEC 62304:2006 + A1:2015 | current consolidated Edition 1.1; Edition 2 remains under development |
| Medical-device risk management | ISO 14971:2019 | current risk-management baseline; reviewed and confirmed in 2025 |
| Health-software cybersecurity lifecycle | IEC 81001-5-1:2021, including 2025 interpretation/corrected material | secure health-software lifecycle; complements safety/effectiveness obligations |
| Machinery safety-related control systems | ISO 13849-1:2023 | safety-related parts of control systems, including software design |
| Machinery functional safety | IEC 62061:2021 + AMD1:2024 + AMD2:2026 | current consolidated machinery functional-safety control-system baseline |
| Process-industry SIS | IEC 61511-1:2016 + AMD1:2017 | process-sector implementation of IEC 61508 for safety instrumented systems; stability date 2029 |
| Airborne software | DO-178C as recognized via FAA AC 20-115D | airborne software assurance/certification objectives |
| Airborne multicore | FAA AC 20-193 | active multicore processor interference/assurance guidance issued 2024-01-08 |
| NASA software assurance/safety | NASA-STD-8739.8B | NASA software assurance and software safety standard |
| Railway software | EN 50716:2023 | current railway software-development baseline replacing EN 50128/EN 50657; prA1:2026 is a draft watch item |
| Industrial automation/control security | IEC 62443-4-1:2018, IEC 62443-4-2:2019 + COR1:2022 | secure product-development lifecycle and component requirements |
| OT cybersecurity | NIST SP 800-82 Rev. 3 | current final baseline; Rev. 4 Initial Public Draft dated 2026-09-21 is a watch item |
| Platform firmware resiliency | NIST SP 800-193 | platform firmware Protect → Detect → Recover |
| IoT firmware update | RFC 9019 + RFC 9124 | IETF **Informational** architecture/manifest guidance, not Internet Standards Track or safety certification |
| General V&V | IEEE 1012-2024 | current published integrity-scaled V&V baseline; an active P1012 revision project exists |
| Assurance cases | ISO/IEC/IEEE 15026-2:2022 | assurance-case structure/terminology; structure does not establish truth by itself |

## 44.1 Overlay application rule

For a real project:

```text
UNIVERSAL PLAYBOOK 21
+ APPLICABLE DOMAIN SAFETY STANDARD
+ APPLICABLE SECURITY / PRIVACY / REGULATORY OVERLAY
+ PLATFORM / SILICON / RTOS / LANGUAGE SPECIFICATIONS
+ ORGANIZATIONAL ASSURANCE PLAN
= PROJECT ENGINEERING BASELINE
```

If a domain rule conflicts with a house default, the applicable domain rule wins.

---

# 45. Verification and validation strategy

Verification asks whether the implemented system satisfies specified requirements. Validation asks whether those requirements and the resulting system are fit for the intended operational use.

For embedded/real-time systems, evidence often spans hardware, software, timing, physical environment, tools, and operators.

## 45.1 Assurance portfolio

Select methods from the failure claim, not from habit:

| Assurance question | Strong candidate evidence |
|---|---|
| Functional logic | requirements-based tests, review, static analysis |
| Invariants/state machines | property tests, model-based tests, formal methods |
| Concurrency | stress/interleaving tests, race detectors where available, model checking, targeted review |
| Timing | measurement, static timing/WCET analysis, scheduling analysis, stress, interference tests |
| Memory safety | language guarantees, static analysis, sanitizers where applicable, bounds tests, fuzzing |
| Hardware contract | HIL tests, bus traces, register checks, fault injection, silicon errata review |
| Recovery | power-cut/reset/fault-injection tests, restore/reboot/update trial |
| Security | threat-based tests, fuzzing, static/dynamic analysis, penetration tests, update/auth tests |
| Safety | requirements-based verification, independence, traceability, structural coverage/analysis where required by domain |
| Environmental behavior | temperature/voltage/EMC/mechanical qualification where applicable |

No single column proves the whole system.

## 45.2 Target realism ladder

Evidence strength usually increases as execution approaches the actual operational stack:

```text
HOST MODEL / UNIT
→ EMULATOR / SIMULATOR
→ TARGET ISA / VIRTUAL PLATFORM
→ DEVELOPMENT BOARD
→ PRODUCTION PCB
→ HARDWARE-IN-THE-LOOP
→ INTEGRATED PRODUCT
→ REPRESENTATIVE OPERATIONAL ENVIRONMENT
```

Each layer answers different questions. Host-only tests cannot establish target timing, MMIO correctness, cache/DMA behavior, or all ABI/toolchain effects.

## 45.3 Independence

For C3/C4 or domain-mandated assurance:

- verification independence SHOULD increase with consequence;
- test author and implementer roles MAY require separation;
- safety/security review MAY require specialist competence;
- formal evidence SHOULD be independently checked when feasible;
- qualification/certification authority expectations MUST be followed.

Independence is not ceremony; it reduces correlated assumptions and confirmation bias.

---

# 46. Requirements-to-verification matrix

Every material C3/C4 requirement SHOULD have no orphan state.

```markdown
| Req ID | Requirement | Hazard / failure link | Implementation | Verification method | Test/analysis ID | Environment | Result | Evidence | Status |
|---|---|---|---|---|---|---|---|---|---|
```

Rules:

- MUST identify unverified requirements.
- MUST identify tests with no current requirement/purpose.
- MUST version evidence when requirement meaning changes.
- MUST perform impact analysis when code, compiler, hardware, configuration, or requirement changes.
- SHOULD keep machine-readable traceability where scale justifies it.
- MUST not count duplicated tests as independent evidence when they share the same oracle/assumption.

---

# 47. Systems/embedded test ladder

Use the lightest combination that can provide the needed confidence.

## T1 — Static construction checks

- compiler warnings/errors;
- type checks;
- lint/static rules;
- banned API/pattern checks;
- linker/map-budget checks;
- generated-artifact consistency.

## T2 — Host/domain tests

Fast tests of pure logic and deterministic modules, with explicit awareness of target-semantic gaps.

## T3 — Property/model-based tests

Generate input/state sequences against invariants and state-machine properties.

## T4 — Target component tests

Run on target architecture/hardware for ABI, instruction, alignment, interrupt, memory and peripheral semantics.

## T5 — Integration and HIL

Exercise real interfaces and representative peripherals/sensors/actuators.

## T6 — Stress, timing and overload

Test maximum credible rates, queue saturation, interrupt storms, memory pressure, thermal/frequency states and timing tails.

## T7 — Fault injection / recovery

Deliberately violate assumptions and prove containment/recovery.

## T8 — Safety/security adversarial verification

Threat/hazard-driven misuse, privilege, malformed input, unsafe transitions, update attacks and protective mechanism failures.

## T9 — Operational/field validation

Representative users/environment/maintenance/update lifecycle and real-world monitoring.

For material changes, rerun the affected subset as regression evidence.

---

# 48. Fault-injection standard

Fault injection is useful when it tests a named fault hypothesis and observes the expected containment/recovery behavior.

## 48.1 Candidate injections

### Memory/storage
- bit corruption in non-safety test environment;
- invalid CRC/ECC indication;
- torn persistent write;
- full storage;
- stale configuration;
- corrupt update metadata.

### CPU/software
- task stall;
- deadlock trigger;
- stack pressure;
- exception/fault handler path;
- watchdog non-feed;
- unexpected restart.

### Timing
- delayed ISR/task;
- clock drift/source loss;
- deadline miss;
- worst credible execution path;
- multicore interference.

### Communication
- loss;
- duplication;
- reordering;
- delay;
- malformed frame;
- bus-off/link reset;
- partial message.

### Hardware/device
- absent device;
- stuck busy;
- impossible sensor value;
- DMA error;
- peripheral reset;
- power-domain loss.

### Update/recovery
- power cut during each phase;
- invalid signature;
- wrong product image;
- failed trial boot;
- recovery image corruption.

## 48.2 Experiment record

```yaml
fault_id:
hypothesis:
injection_point:
preconditions:
expected_detection:
max_detection_latency:
expected_containment:
expected_recovery:
forbidden_effects:
observed_result:
logs_evidence:
pass_fail:
defect:
```

Never inject faults into live safety-critical operation without an approved safe experimental boundary.

---

# 49. Formal methods and mathematically grounded analysis

Formal methods are valuable when the property is important, precisely expressible, and difficult to establish by testing alone.

Strong use cases:

- scheduler/state-machine invariants;
- mutual exclusion;
- protocol ordering;
- deadlock freedom under scoped assumptions;
- privilege/state-transition constraints;
- boot/update state machines;
- bounded resource models;
- high-consequence control logic.

## 49.1 Method spectrum

- precise executable/reference specification;
- state-machine modeling;
- model checking;
- theorem proving;
- abstract interpretation;
- static timing analysis;
- schedulability analysis;
- contracts/pre/postconditions;
- symbolic execution.

## 49.2 Limits

- A proof validates a stated property under assumptions.
- It does not prove that the requirement itself is correct.
- It does not prove unmodeled hardware/tool/environment behavior.
- Model-to-code conformance must be justified separately.
- State-space reduction/abstraction can hide relevant behavior if unsoundly chosen.

## 49.3 Decision rule

Use stronger formalism when:

```text
CONSEQUENCE × STATE-SPACE COMPLEXITY × CONCURRENCY / TIMING SUBTLETY
> COST OF MODELING + REVIEW
```

This is a decision lens, not arithmetic.

---

# 50. Static analysis and coding standards

Coding rules are controls for named defect classes, portability, analyzability, and reviewer/tool consistency—not proof of correctness.

## 50.1 Source-standard hierarchy

For C/C++-like low-level work, distinguish:

1. language standard semantics;
2. compiler implementation/ABI documentation;
3. platform/RTOS rules;
4. selected coding standard (e.g. current MISRA profile, CERT rules, AUTOSAR profile where applicable);
5. organization/project rules.

A project rule MUST NOT silently contradict language/compiler semantics.

## 50.2 Rule-set governance

For each enabled rule:

```yaml
rule_source:
version:
reason:
severity:
automated_checker:
deviation_process:
owner:
```

Rules:

- SHOULD automate deterministic rule checking.
- MUST define a controlled deviation process rather than disable useful rules globally because of one exception.
- SHOULD suppress only at the narrowest justified scope.
- MUST review tool false positives/false negatives in risk context.
- MUST NOT treat zero static-analysis findings as proof of safety/security.
- For a material MISRA compliance claim, MUST define the exact guideline set/version, enforcement methods, deviation process and treatment of externally developed code; a vague statement such as “MISRA compliant” is insufficient assurance.

MISRA Compliance:2020 is a useful process-level companion because it makes compliance a project/process claim rather than a magic property of source text. Coding-rule compliance remains one evidence layer inside the larger safety/security/correctness argument.

## 50.3 Current-status discipline

As of the evidence cutoff, MISRA C:2025 is the current MISRA C edition; older editions may remain contractually required by a project but MUST be identified as project baselines rather than “latest.”

---

# 51. Compiler, linker and build assurance

The toolchain transforms source semantics into the executable system. It belongs in the assurance boundary.

## 51.1 Toolchain record

```yaml
compiler:
version:
target:
abi:
optimization:
linker:
link_script:
assembler:
standard_library:
startup_runtime:
code_generator:
build_system:
flags:
reproducibility_controls:
qualified_or_approved_status:
known_errata:
```

## 51.2 Rules

- MUST pin/identify material toolchain versions for controlled releases.
- MUST make compiler/linker flags reviewable.
- MUST treat optimization level as behaviorally material for timing, UB exposure and code generation.
- SHOULD enable the strongest practical diagnostics and fail the build for agreed severe classes.
- MUST inspect map/image layout when memory placement or boot semantics matter.
- MUST verify assumptions about integer width, alignment, endianness, calling convention and atomicity on the actual target.
- SHOULD retain disassembly or binary-level evidence for selected critical routines when source-level evidence cannot establish the property.
- MUST track compiler/linker silicon/tool errata that can invalidate generated code.
- MUST follow applicable tool-qualification requirements in regulated domains.

## 51.3 Reproducibility

Reproducible builds can strengthen artifact provenance but do not prove source correctness. When required, control:

- source revision;
- generated files;
- toolchain image;
- timestamps/random seeds;
- dependency versions;
- linker/build environment;
- artifact hashes.

---

# 52. Linker scripts, startup code and memory placement

These files often contain system architecture disguised as “build configuration.”

Review explicitly:

- vector table;
- reset entry;
- stack placement/size;
- heap region;
- executable/read/write permissions where supported;
- interrupt stacks;
- DMA/non-cacheable regions;
- persistent/no-init memory;
- bootloader/application boundaries;
- recovery partitions;
- calibration/config sections;
- secure/non-secure regions;
- alignment constraints;
- copy/zero initialization tables;
- MPU/MMU/IOMMU setup dependencies.

Rules:

- MUST version-control linker/startup definitions.
- MUST test overflow and overlap failures.
- SHOULD make region budgets machine-enforced.
- MUST verify that no confidential material persists unintentionally in no-init/retention memory.
- MUST validate bootloader/application expectations at partition boundaries.
- SHOULD generate a machine-readable memory map for release evidence where useful.

---

# 53. Configuration management for embedded systems

The executable behavior can vary by source, compiler, flags, hardware revision, fuses, device tree, Kconfig, calibration, feature flags, bootloader, secure-world firmware and manufacturing settings.

A release identity SHOULD therefore include more than the application Git commit.

```yaml
release_id:
source_revision:
submodules_dependencies:
generated_input_versions:
build_configuration:
toolchain:
bootloader:
platform_firmware:
hardware_revision:
board_config:
fuses_or_lifecycle_state:
calibration_compatibility:
feature_set:
security_policy:
artifact_digest:
```

## 53.1 Variant explosion

Every compile-time/runtime variant creates an assurance state.

- Minimize product variants when they do not deliver material value.
- Define supported combinations explicitly.
- Do not assume one tested configuration covers incompatible compile-time paths.
- Use combinatorial/risk-based selection when exhaustive variant testing is impossible.
- Retire obsolete variants and conditionals.

---

# 54. Silicon, board and tool errata management

An embedded product inherits defects outside its repository.

Maintain an errata register:

```yaml
erratum_id:
source:
affected_part_revision:
condition:
consequence:
workaround:
software_location:
verification:
performance_or_timing_effect:
removal_trigger:
owner:
```

Rules:

- MUST check silicon/board/module errata during initial design and relevant updates.
- MUST map workaround to exact affected revisions.
- MUST retest timing/safety assumptions when a workaround changes execution or disables hardware acceleration.
- MUST remove or gate workaround when applying it to unaffected hardware can itself create risk.
- SHOULD include errata review in hardware-revision onboarding.

---

# 55. Performance is not real-time correctness

Performance asks how much work/how fast on average or distributionally. Real-time correctness asks whether specified actions complete within required temporal constraints.

Examples:

- Average 10 µs with rare 10 ms stalls can be unacceptable for a 1 ms hard deadline.
- Deterministic 400 µs may be safer than variable 50–2000 µs.
- Higher throughput can increase interference and deadline misses.

For every timing-critical path track both:

```yaml
functional_result:
release_deadline:
response_time_bound:
jitter:
blocking:
execution_distribution:
worst_case_evidence:
load_conditions:
```

Do not report only average latency for a hard/firm deadline claim.

---

# 56. Overload and admission control in real-time/embedded systems

Overload can be caused by:

- interrupt storms;
- burst sensors/network;
- retry loops;
- queue buildup;
- degraded device causing repeated polling;
- CPU frequency reduction;
- thermal throttling;
- memory/bus contention;
- diagnostic/logging bursts;
- fault-recovery work;
- adversarial traffic.

## 56.1 Rules

- MUST define maximum credible input/event rates for bounded systems.
- MUST bound queues where exhaustion/latency matters.
- MUST define what is dropped, delayed, coalesced, degraded, or escalated beyond capacity.
- MUST preserve safety/security invariants under overload.
- SHOULD prioritize safety/control work over diagnostics/telemetry when appropriate.
- MUST test overload transition and recovery, not only nominal throughput.
- MUST avoid retry policies that amplify overload.
- SHOULD make rate limits explicit at hardware/protocol/task boundaries.

## 56.2 Real-time overload policy

For firm/hard real-time systems, queued late work may be worthless or harmful. Consider:

- skip obsolete sample;
- overwrite with latest value;
- drop low-priority event;
- shed optional computation;
- enter degraded mode;
- trigger safe-state/escalation.

Choose according to domain semantics, not generic queue policy.

---

# 57. Resource budgets

Embedded correctness often depends on finite resources.

Budget explicitly:

```yaml
flash_code:
flash_data:
ram_static:
ram_dynamic:
stack_per_context:
heap_peak:
file_descriptors_or_handles:
threads_tasks:
queue_depths:
dma_descriptors:
interrupt_rate:
cpu_utilization:
bus_bandwidth:
storage_writes_wear:
energy:
thermal:
startup_time:
shutdown_time:
```

## 57.1 Budget policy

- Assign owner and threshold.
- Reserve headroom intentionally rather than as accidental unused capacity.
- Track growth over time.
- Fail CI/build for hard region overflow.
- Investigate step changes.
- Revalidate after compiler/toolchain changes.
- For real-time CPU budgets, use worst-case/response-time logic appropriate to the scheduling model, not average utilization alone.

---

# 58. Device-driver state-machine standard

Drivers are stateful concurrency boundaries between application/kernel and hardware.

Model states explicitly when behavior is nontrivial:

```text
UNINITIALIZED
→ RESETTING
→ CONFIGURING
→ READY
→ ACTIVE
→ QUIESCING
→ SUSPENDED
→ ERROR
→ RECOVERING
→ READY / FAILED
```

## 58.1 Required questions

- Which calls are valid in each state?
- Are calls synchronous/asynchronous?
- Who owns buffers?
- What if interrupt arrives during transition?
- What if reset occurs mid-transfer?
- What if suspend/power loss occurs?
- Can two callers reconfigure concurrently?
- Is close/shutdown idempotent?
- How is permanent device failure represented?
- What data survives reset?

## 58.2 Rules

- MUST reject invalid state transitions or make them unrepresentable.
- MUST synchronize configuration vs data-path operations.
- MUST quiesce hardware before freeing/reusing resources.
- MUST handle spurious/late completion after cancellation/reset.
- SHOULD expose error classes rather than one generic failure when recovery differs.

---

# 59. Error taxonomy and propagation

Low-level systems fail poorly when errors lose meaning across layers.

Distinguish at least:

- caller/input error;
- resource exhaustion;
- timeout/deadline;
- transient device/link error;
- permanent hardware fault;
- data-integrity failure;
- security/auth failure;
- unsupported hardware/version;
- invariant/internal defect;
- cancellation/shutdown;
- safety fallback activation.

## 59.1 Error contract

```yaml
error_class:
recoverable_by_caller:
retry_safe:
operator_action:
safety_effect:
security_effect:
log_severity:
rate_limit:
telemetry:
```

Do not retry invariant violations or permanent incompatibility as though they were transient I/O failures.

---

# 60. Recovery hierarchy

Recovery should move from least disruptive to more disruptive only when the failure model justifies it.

Example hierarchy:

```text
RETRY OPERATION
→ RESET PERIPHERAL
→ RESTART TASK/SERVICE
→ REINITIALIZE SUBSYSTEM
→ REBOOT APPLICATION PROCESSOR/MCU
→ BOOT KNOWN-GOOD IMAGE
→ EXTERNAL POWER CYCLE
→ SERVICE / SAFE SHUTDOWN
```

Each step needs:

- precondition;
- maximum attempts;
- timeout;
- data/state consequence;
- safety/security consequence;
- diagnostic evidence preserved;
- escalation condition.

Unbounded reboot loops are not resilience.

---

# 61. Observability in constrained systems

Observability must respect CPU, memory, bandwidth, storage wear, power, privacy, and real-time constraints.

## 61.1 Minimum useful signals

Depending on system:

- reset reason;
- firmware/build identity;
- uptime/boot counter;
- watchdog reason;
- fatal fault context;
- task deadline miss counters;
- queue high-water marks;
- stack/heap watermarks;
- bus/device error counters;
- update state/result;
- security/auth failures;
- thermal/voltage events;
- persistent corruption events;
- degraded/safe-state transitions.

## 61.2 Rules

- MUST NOT let logging on a critical path violate timing or fill storage uncontrollably.
- SHOULD use bounded/rate-limited logging.
- SHOULD retain compact crash/reset breadcrumbs across reboot where useful.
- MUST sanitize secrets/sensitive data.
- SHOULD timestamp with an explicitly defined time source; distinguish uptime/monotonic from wall clock.
- MUST include enough release identity to correlate field behavior with exact software/hardware/config.
- SHOULD make dropped-log/telemetry counters visible so absence of logs is not mistaken for absence of events.

---

# 62. Field diagnostics and serviceability

A production embedded device needs a controlled path to answer:

- What exact hardware/software is this?
- Why did it reset?
- Which safety/degraded state is active?
- What peripherals are healthy?
- What update was attempted?
- Is storage/state valid?
- What recent errors occurred?
- Can logs be exported safely?
- Can the device be recovered without exposing privileged control?

## 62.1 Diagnostic interface controls

- authenticate privileged functions;
- distinguish read-only diagnosis from write/service actions;
- rate-limit dangerous operations;
- preserve audit trail when practical;
- redact secrets/personal data;
- prevent diagnostic commands from violating safety interlocks;
- document lifecycle state (factory/field/RMA);
- support offline recovery if network dependency is itself a failure mode.

---

# 63. Incident and post-failure engineering

For significant field failures, capture:

```yaml
incident_id:
product_hw_revision:
firmware_build:
configuration:
environment:
user_or_system_impact:
safety_security_impact:
initial_trigger:
observed_failure:
reset_fault_context:
timeline:
contributing_conditions:
why_detection_or_containment_failed:
recovery:
evidence_preserved:
reproduction_status:
actions:
verification_of_actions:
field_campaign_or_update_required:
```

## 63.1 Embedded-specific learning

Check:

- hardware revision/lot dependence;
- environmental conditions;
- wear/aging;
- brownout/noisy power;
- timing/load history;
- firmware-update history;
- persistent-state corruption;
- sensor/calibration drift;
- rare concurrency/interleaving;
- silicon/toolchain errata;
- common-cause fleet behavior.

Do not reduce a multi-factor failure to “operator error” or “race condition” without tracing the conditions that made it possible and the controls that failed to contain it.

---

# 64. Maintenance and evolution

Embedded products couple long-lived hardware with changing software, dependencies and threats.

Maintain:

- supported hardware matrix;
- toolchain support horizon;
- RTOS/kernel support horizon;
- third-party component inventory;
- vulnerability process;
- compiler/silicon errata;
- update/recovery support;
- persistent-format compatibility;
- diagnostic protocol compatibility;
- calibration compatibility;
- field rollback/recovery policy;
- service documentation.

## 64.1 Safe dependency/toolchain upgrade

1. identify semantic changes;
2. identify generated-code/ABI/timing impact;
3. rerun static analysis and target tests;
4. compare binary size/layout/timing where material;
5. rerun affected safety/security evidence;
6. stage fleet/field exposure where possible;
7. retain known-good recovery.

“Compiler upgrade with no source change” can still be a material behavior change.

---

# 65. Deprecation and retirement

Retiring an embedded product/system may require:

- final secure firmware state;
- revocation/rotation of device credentials;
- disablement of cloud endpoints;
- export/retention/deletion of personal or regulated data;
- update-signing infrastructure lifecycle;
- service parts/tooling retention;
- recovery image archival;
- customer/end-user communication;
- vulnerability-support end date;
- safe decommissioning of actuators/energy storage;
- factory/RMA secrets destruction.

Do not retire the signing/recovery infrastructure before the final supported fleet can be safely serviced or decommissioned.

---

# 66. Decision framework — bare metal vs RTOS vs general-purpose OS

## Bare metal is attractive when

- functionality is small/bounded;
- static control flow is valuable;
- startup/resource footprint must be minimal;
- concurrency needs are modest;
- certification/assurance benefits from a smaller platform;
- required drivers/network/filesystems are limited.

Risks: bespoke scheduling/timers/drivers, hidden growth, ad-hoc concurrency.

## RTOS is attractive when

- multiple deadline-sensitive activities exist;
- priority/preemption/timers/IPC are useful;
- deterministic bounded services are available and understood;
- ecosystem/device support reduces bespoke code.

Risks: scheduler assumptions, priority inversion, kernel/driver surface, configuration complexity.

## General-purpose OS is attractive when

- rich networking/filesystems/process isolation/device ecosystem matters;
- hardware resources can support it;
- hard deterministic guarantees are not required from ordinary user-space services or a bounded real-time extension/partition is used;
- maintainability/security update ecosystem has high value.

Risks: larger state space, background activity, scheduler/VM/I/O variability, update surface.

### Decision rule

Choose the least complex platform that demonstrably meets required functionality, timing, isolation, security, maintenance and assurance obligations.

---

# 67. Decision framework — single-core vs multicore

Prefer single-core when it meets requirements and:

- deterministic timing is difficult to prove on shared multicore resources;
- software parallelism adds little value;
- certification/verification cost dominates.

Use multicore when a real requirement demands:

- throughput;
- parallel real-time functions;
- isolation/partitioning;
- heterogeneous compute;
- platform availability.

Before multicore adoption, answer:

- shared cache/memory/bus interference;
- interrupt routing;
- task affinity/migration;
- synchronization cost;
- power/thermal throttling;
- safety partition assumptions;
- fault containment;
- analysis/test method.

---

# 68. Decision framework — dynamic allocation

Dynamic allocation is acceptable when:

- fragmentation/failure behavior is bounded enough for the requirement;
- allocation latency fits timing constraints;
- ownership/lifetime is clear;
- exhaustion is handled safely;
- allocator concurrency is understood.

Prefer static/pool/preallocation when:

- runtime memory must be strictly bounded;
- deterministic latency matters;
- allocation failure is unacceptable after initialization;
- certification/analyzability benefits.

A useful hybrid is dynamic configuration/initialization followed by a frozen operational phase, but only if the lifecycle permits it.

---

# 69. Decision framework — lock vs non-blocking synchronization

Use a lock when:

- critical section is bounded;
- blocking analysis is acceptable;
- ownership is clear;
- priority protocol exists where real-time priority matters;
- simpler correctness outweighs contention.

Consider lock-free/wait-free when:

- contention or priority blocking is materially harmful;
- algorithm semantics are well understood;
- memory reclamation and ABA/lifetime issues are solved;
- progress property is actually required;
- target atomics/memory model support it.

Never choose lock-free merely because it sounds faster or more deterministic.

---

# 70. Decision framework — polling, interrupt or DMA

Use the framework in §28. The default should be the simplest mechanism that satisfies:

```text
latency/deadline
+ maximum rate
+ CPU/power budget
+ overload behavior
+ concurrency complexity
+ recovery
```

Do not optimize away a simple bounded poll loop when it is the most analyzable correct design.

---

# 71. Decision framework — when to use formal methods

Escalate formal methods when one or more are true:

- failure is catastrophic/high consequence;
- concurrency/state-space is difficult to test exhaustively;
- property is compact and mathematically expressible;
- protocol/scheduler correctness dominates system risk;
- domain standard/assurance plan requires it;
- recurrent defects show ordinary testing is insufficient.

Do not use formal methods merely for prestige. Define the property, model boundary, assumptions and model-to-implementation link first.

---

# 72. Decision framework — fail-safe vs fail-operational

Ask:

1. Is stopping/de-energizing actually safe in all material operating states?
2. If not, how long must operation continue after a specified fault?
3. Which minimum functions must remain?
4. What redundancy/independence is required?
5. How is the fault detected?
6. What timing must degraded mode meet?
7. What common-cause failures invalidate the architecture?
8. How does the human/operator know the degraded state?
9. What is the transition to final safe state?

The hazard analysis determines the answer.

---

# 73. Decision framework — A/B vs in-place firmware update

## A/B / dual-bank

Advantages:

- keep known-good image;
- atomic slot switch;
- trial/rollback path;
- strong power-loss resilience.

Costs:

- storage footprint;
- partition complexity;
- data-schema rollback compatibility;
- bootloader complexity.

## In-place

Advantages:

- lower storage requirement;
- potentially simpler partitioning.

Risks:

- interruption may corrupt sole image;
- recovery may require ROM/service path;
- more complex resumable patch/write design.

### Decision rule

Use A/B when storage cost is justified by recovery assurance. Use in-place only with a credible independent recovery mechanism and verified interruption semantics appropriate to consequence.

---

# 74. Architecture review checklist

## Context and criticality

- [ ] Product/system boundary is explicit.
- [ ] Hardware revisions and operating environments are identified.
- [ ] C0–C4 house criticality is assigned.
- [ ] Applicable domain safety/security/regulatory overlays are identified separately.
- [ ] Unacceptable failures and hazards are explicit.
- [ ] Required operator/user competence is explicit.

## State and memory

- [ ] Persistent and volatile state owners are known.
- [ ] Memory map, protection domains and DMA regions are defined.
- [ ] Stack/dynamic-memory budgets are justified.
- [ ] Buffer ownership/lifetime is explicit.
- [ ] Undefined/implementation-defined language assumptions are controlled.
- [ ] Persistent state has version, integrity and power-loss behavior.

## Concurrency

- [ ] Tasks/threads/processes/ISRs and priorities are mapped.
- [ ] Shared mutable state is inventoried.
- [ ] Synchronization and memory-order semantics are explicit.
- [ ] Blocking/critical-section bounds exist where timing matters.
- [ ] Priority inversion controls are justified.
- [ ] Cancellation/shutdown ownership is explicit.

## Timing

- [ ] Every material deadline is specified as a timing contract.
- [ ] Clock/time sources are defined.
- [ ] Jitter, interrupt/scheduler latency and blocking are budgeted.
- [ ] WCET/response-time evidence matches the real target/configuration.
- [ ] Overrun handling is defined.
- [ ] Multicore/shared-resource interference is considered.

## Hardware boundary

- [ ] Device/register contract is current.
- [ ] Reset/power/clock sequencing is known.
- [ ] MMIO ordering/barriers are correct for architecture/compiler.
- [ ] DMA/cache coherency and ownership are explicit.
- [ ] Peripheral error/absence/recovery states are designed.
- [ ] Silicon/board errata are reviewed.

## Safety/security

- [ ] Hazard and threat models are connected where needed.
- [ ] Safe/degraded/fail-operational behavior is explicit.
- [ ] Update/boot trust and recovery are designed.
- [ ] Debug/service/manufacturing interfaces are governed.
- [ ] Least privilege/protection mechanisms are appropriate.
- [ ] Recovery does not silently defeat safety/security controls.

## Assurance

- [ ] Requirements are traceable to verification evidence.
- [ ] Toolchain/build configuration is controlled.
- [ ] Fault injection targets named fault hypotheses.
- [ ] Formal methods are used where their decision value justifies them.
- [ ] Independent review is selected proportionately.
- [ ] Release, field monitoring and maintenance evidence are planned.

---

# 75. Concurrency review checklist

- [ ] Every shared object has an owner and synchronization policy.
- [ ] Data-race freedom is established under the language/runtime memory model.
- [ ] Atomics use the weakest semantics justified by a documented happens-before argument, not by performance folklore.
- [ ] `volatile` is not used as a substitute for inter-thread synchronization.
- [ ] ISR/task sharing uses primitives valid in interrupt context.
- [ ] Locks are never taken in contexts where sleeping/blocking is illegal unless explicitly supported.
- [ ] Lock ordering/nesting is documented where deadlock is possible.
- [ ] Priority inversion and maximum blocking are bounded where deadlines depend on them.
- [ ] Non-blocking structures define memory reclamation/lifetime safety.
- [ ] Cancellation cannot leave resources/state orphaned.
- [ ] Shutdown/restart is safe under in-flight operations.
- [ ] Tests exercise race-prone transitions and target semantics.
- [ ] Multicore cache/interconnect interference is considered separately from logical synchronization correctness.

---

# 76. Timing review checklist

- [ ] “Real-time” is classified hard/firm/soft or otherwise operationally defined.
- [ ] Deadline measured from a named release/trigger event to a named completion event.
- [ ] Period/minimum inter-arrival time is defined.
- [ ] Release jitter is bounded or characterized.
- [ ] Interrupt latency and ISR execution are included.
- [ ] Scheduler/context-switch latency is included where material.
- [ ] Non-preemptible and critical-section time is included.
- [ ] Shared-resource blocking is included.
- [ ] Cache/memory/DMA/interconnect interference is included where relevant.
- [ ] Clock drift/synchronization error is included for cross-clock behavior.
- [ ] WCET evidence states model/target/configuration assumptions.
- [ ] Frequency/thermal/power states used by the deployed product are covered.
- [ ] Deadline-miss detection and response are defined.
- [ ] Overload behavior has been tested.
- [ ] Evidence covers startup, fault-recovery and degraded modes if deadlines apply there.

---

# 77. Firmware-update readiness checklist

- [ ] Update authority/authentication model is explicit.
- [ ] Manifest/product/hardware compatibility is checked.
- [ ] Artifact integrity is verified before activation.
- [ ] Image bounds/partition constraints are enforced.
- [ ] Anti-rollback/security-epoch policy is explicit.
- [ ] A power/reset interruption during every phase is recoverable to the required assurance level.
- [ ] Trial boot/health confirmation or equivalent commit logic is defined.
- [ ] Persistent data/schema is compatible with rollback/recovery.
- [ ] Bootloader/recovery path is independently protected.
- [ ] Key rotation/revocation is supported to the product’s threat/lifetime needs.
- [ ] Update failure does not create an unbounded boot loop.
- [ ] Recovery can work under plausible network/service outage.
- [ ] Rate/wear/resource limits are enforced.
- [ ] Wrong-target, corrupt, stale and unauthorized images are rejected.
- [ ] Update events/results are diagnosable/auditable as required.

---

# 78. Safety-critical change checklist

- [ ] Change is linked to affected safety requirements/hazards.
- [ ] Safety classification/integrity level is re-evaluated if scope changed.
- [ ] Assumptions/independence/fault-containment claims remain valid.
- [ ] Timing/resource budgets are re-evaluated.
- [ ] Compiler/toolchain/generated-code impact is assessed.
- [ ] Hardware/platform/errata impact is assessed.
- [ ] Security impact on safety is assessed.
- [ ] Traceability matrix is updated bidirectionally.
- [ ] Required independent review is performed.
- [ ] Verification regression covers affected requirements.
- [ ] Structural coverage/formal evidence is updated where domain requires.
- [ ] Safety/assurance case impact is assessed.
- [ ] Residual risk and deviations are explicitly approved.
- [ ] Field migration/update/recovery risk is assessed.

---

# 79. Production release checklist

- [ ] Exact source revision and release artifact are identified.
- [ ] Hardware compatibility list is explicit.
- [ ] Compiler/linker/startup/config versions are recorded.
- [ ] Generated artifacts are reproducible/traceable enough for the assurance level.
- [ ] No unresolved BLOCKER defect exists.
- [ ] MAJOR defects are zero or formally accepted by applicable governance.
- [ ] Memory/stack/resource budgets pass.
- [ ] Static analysis/build diagnostics pass the approved baseline.
- [ ] Functional, target, timing and recovery tests pass the required portfolio.
- [ ] Safety/security verification passes where applicable.
- [ ] Boot/reset/brownout/watchdog behavior is verified.
- [ ] Update/recovery path is verified.
- [ ] Persistent-state migration/compatibility is verified.
- [ ] Release diagnostics identify build/hardware/config.
- [ ] Signing/provenance controls are complete where required.
- [ ] Field rollback/roll-forward/recovery authority is defined.
- [ ] Monitoring/incident/service ownership is active.

---

# 80. Template — hardware-interface contract

```yaml
interface_id:
owner:
hardware_part:
hardware_revision:
specification_reference:
software_component:

power:
  rails:
  sequencing:
  brownout_behavior:
clock:
  source:
  frequency:
  tolerance:
reset:
  sources:
  reset_state:

transport:
  bus_or_link:
  speed:
  addressing:
  framing:
  endianness:
  crc_or_integrity:

registers_or_messages:
  version:
  access_width:
  side_effects:
  atomicity:
  reserved_bits:

concurrency:
  owners:
  interrupts:
  dma:
  synchronization:

timing:
  response_deadline:
  timeout:
  maximum_rate:

errors:
  detectable_faults:
  error_codes:
  retry_policy:
  reset_recovery:

safety_security:
  safe_state:
  trust_boundary:
  privilege:

verification:
  tests:
  target_evidence:
  errata_checked:
```

---

# 81. Template — task and timing contract

```yaml
task_id:
function:
criticality:
trigger:
period_or_min_interarrival:
release_jitter:
deadline:
priority_or_scheduler_policy:
core_affinity:

execution:
  bcet_if_useful:
  wcet_claim:
  wcet_method:
  target_config:

blocking:
  locks_resources:
  maximum_blocking:
  nonpreemptible_time:

interrupts:
  relevant_isrs:
  latency_budget:

shared_resources:
  cache:
  memory_bus:
  dma:
  accelerator:

clock:
  source:
  drift_sync_error:

overrun:
  detection:
  immediate_action:
  escalation:

verification:
  measurement_tests:
  analysis:
  stress_interference:
  result:
```

---

# 82. Template — memory budget

```yaml
product_variant:
hardware_revision:
build_id:

flash:
  bootloader:
  app_code:
  const_data:
  update_slot:
  filesystem_or_assets:
  reserve:

ram:
  data_bss:
  stacks:
  heap_or_pools:
  dma_buffers:
  network_buffers:
  retained_noinit:
  reserve:

stacks:
  - context:
    configured:
    measured_high_water:
    analysis_margin:

allocation:
  runtime_dynamic_allowed:
  allocator:
  max_peak:
  fragmentation_evidence:
  exhaustion_behavior:

persistent_storage:
  write_budget:
  wear_model:
  transactional_scheme:
```

---

# 83. Template — fault-injection record

```yaml
fault_test_id:
requirement_or_hazard:
fault_hypothesis:
criticality:

injection:
  layer:
  mechanism:
  preconditions:
  duration:

expected:
  detection_signal:
  detection_deadline:
  containment:
  degraded_or_safe_state:
  recovery:
  forbidden_effects:

observed:
  detection:
  latency:
  containment:
  recovery:
  side_effects:

result: PASS|FAIL|PARTIAL
defects:
evidence_location:
retest_required:
```

---

# 84. Template — safety traceability matrix

```markdown
| Hazard | Safety requirement | Integrity/class | SW requirement | Design/control | Code/component | Verification | Result/evidence | Residual risk | Status |
|---|---|---|---|---|---|---|---|---|---|
```

For high assurance, add bidirectional checks:

- every safety requirement has implementation and verification;
- every safety control traces to a hazard/requirement;
- every safety test traces to a current requirement;
- every deviation/risk acceptance has owner/authority/expiry or disposition.

---

# 85. Template — assurance case fragment

```markdown
## Claim [C-ID]
What property is being claimed, in what configuration/context?

## Context
- system/version:
- environment:
- criticality/domain classification:

## Argument
Why does the evidence support the claim?

## Assumptions
- ...

## Evidence
- [E-ID] requirement-based test
- [E-ID] analysis
- [E-ID] independent review
- [E-ID] formal result

## Defeaters / counter-evidence
- ...

## Limitations
- ...

## Residual risk
- ...

## Approval / review
- owner:
- independent reviewer:
- status:
- revisit trigger:
```

---

# 86. Anti-patterns and falsified folklore

The following claims MUST NOT be treated as universal best practice.

## 86.1 “Real-time means fast.”

**False.** Real-time correctness is about timing constraints and consequences of lateness.

**Better:** define release, deadline, jitter, blocking, clocks and evidence.

## 86.2 “An RTOS makes the system deterministic.”

**False.** Determinism depends on scheduler semantics, drivers, interrupts, allocation, hardware, caches, DMA, clocks and workload.

## 86.3 “High priority guarantees the deadline.”

**False.** Higher priority can still suffer blocking, non-preemptible execution, interference or insufficient CPU capacity.

## 86.4 “Average/99th percentile latency proves a hard deadline.”

**False.** Statistical measurements can be useful evidence but do not establish an absolute bound unless the claim/method justifies it.

## 86.5 “Measure long enough and you know WCET.”

**False.** Rare paths and hardware states may not be sampled. Use measurement as scoped evidence, not automatic proof.

## 86.6 “Never use the heap in embedded systems.”

**Overgeneralization.** Dynamic allocation can be safe enough in many systems when timing, fragmentation, failure and lifetime are controlled.

## 86.7 “Static allocation is always safer.”

**False.** Static allocation can waste capacity, hide stack sizing mistakes and does not remove buffer corruption or ownership defects.

## 86.8 “`volatile` makes shared memory thread-safe.”

**False.** In C/C++, `volatile` is not a synchronization primitive and does not create the required inter-thread happens-before relation.

## 86.9 “Atomic means race-free.”

**False.** Individual atomic operations do not automatically make multi-variable invariants or protocols correct.

## 86.10 “Lock-free means wait-free/deterministic.”

**False.** Lock-free is system-wide progress; an individual operation can retry/starve. Wait-free is a stronger progress property.

## 86.11 “Lock-free is always faster.”

**False.** Contention, cache-line bouncing, retry loops and reclamation can make it slower and less analyzable.

## 86.12 “Disable interrupts to make critical code deterministic.”

**Incomplete/dangerous.** It can bound local interference while increasing interrupt latency and breaking system deadlines.

## 86.13 “Multicore gives near-linear speedup.”

**False.** Shared-resource contention, synchronization and serial work constrain speedup and timing.

## 86.14 “Single-core timing evidence carries over to multicore.”

**False.** Shared caches/memory/interconnect/DMA can introduce new interference.

## 86.15 “Polling is bad; interrupts are good.”

**False.** Polling can be simpler and more bounded for short/high-rate or startup paths; interrupts add asynchronous complexity.

## 86.16 “Interrupts are free until handler CPU time is high.”

**False.** Entry/exit, cache disruption, priority interference and storm behavior matter.

## 86.17 “DMA is just faster memcpy.”

**False.** DMA introduces ownership, coherency, descriptor, bus/interference and recovery semantics.

## 86.18 “MMIO only needs `volatile`.”

**False.** Device-memory ordering, access width, side effects and barriers are architecture/compiler/device specific.

## 86.19 “A watchdog makes the system safe.”

**False.** It detects selected liveness failures and its reset/recovery behavior may itself be unsafe.

## 86.20 “Feed watchdog from a timer interrupt.”

**Usually weak.** It may prove only that the interrupt still runs while critical work is deadlocked.

## 86.21 “Reset is always recovery.”

**False.** Reset can leave external devices/DMA/state inconsistent or create reboot loops.

## 86.22 “Power off is the safe state.”

**False.** Some systems require continued control to remain safe.

## 86.23 “Redundancy makes failures independent.”

**False.** Common requirements, code, compiler, sensors, power and environment can create common-cause failure.

## 86.24 “Two-out-of-three voting proves correctness.”

**False.** Correlated/systematic defects can make all channels wrong together.

## 86.25 “CRC secures firmware.”

**False.** CRC detects accidental corruption; it does not authenticate a maliciously modified image.

## 86.26 “A valid signature means safe firmware.”

**False.** Signature authenticates according to key/policy; image can still be incompatible, vulnerable or functionally unsafe.

## 86.27 “Secure boot means the device is secure.”

**False.** It protects a boot integrity/authenticity property, not the entire runtime/security lifecycle.

## 86.28 “Anti-rollback is always safer.”

**False.** Poorly designed anti-rollback can eliminate the only recoverable image. Balance security epoch and recovery policy.

## 86.29 “A/B update makes updates safe.”

**Incomplete.** It improves recoverability but compatibility, health validation, bootloader bugs and data migrations still matter.

## 86.30 “Memory-safe language solves embedded safety.”

**False.** It reduces/eliminates important memory-corruption classes but not timing, logic, hardware, unsafe control, concurrency or supply-chain faults.

## 86.31 “C/C++ is required for deterministic embedded work.”

**False as a universal claim.** Determinism depends on runtime/toolchain/platform semantics and evidence, not language branding alone.

## 86.32 “MISRA compliance proves safety.”

**False.** Coding-standard conformance controls selected defect classes; safety requires hazard-based system assurance.

## 86.33 “Static analysis proves absence of defects.”

**False.** Tools have scope, models and false-negative boundaries.

## 86.34 “Formal verification proves the whole system correct.”

**False.** It proves scoped properties under modeled assumptions; requirement/model/hardware conformance remain separate.

## 86.35 “HIL proves production safety.”

**False.** HIL is powerful integration evidence, but cannot by itself establish every environmental, timing, common-cause or field condition.

## 86.36 “Certification process is universal best practice.”

**False.** Certification-specific obligations are mandatory in scope; outside scope, copy the risk-control mechanism only when it adds decision value.

## 86.37 “The newest draft standard should replace the current one.”

**False.** Keep final/current baseline and draft/watch item distinct.

## 86.38 “A reproducible build proves software integrity/security.”

**False.** It strengthens reproducibility/provenance, not functional/security correctness.

## 86.39 “Logs make a device observable.”

**False.** Signals must answer operational questions within resource/privacy/timing budgets.

## 86.40 “If the field failure cannot be reproduced, it is probably hardware noise.”

**False.** Rare concurrency, brownout, wear, interference, errata and state-history faults require evidence-driven investigation.

---

# 87. Universal baseline vs domain-specific overlay

## Strong universal defaults

- explicit state/ownership;
- explicit memory/lifetime assumptions;
- explicit concurrency/memory-order model;
- finite resource policy;
- explicit timing contracts where time affects correctness;
- bounded blocking/overload where required;
- hardware-interface contracts;
- reset/recovery semantics;
- secure/recoverable update where field firmware can change;
- risk-proportionate V&V;
- configuration/toolchain control;
- bidirectional traceability for high-assurance claims;
- field learning and maintenance.

## Contextual mechanisms

- bare metal vs RTOS vs Linux;
- static vs dynamic allocation;
- lock vs non-blocking algorithm;
- polling vs interrupt vs DMA;
- single vs multicore;
- MPU vs MMU/hypervisor;
- A/B update vs in-place;
- fixed-priority vs EDF or other scheduler;
- formal method/tool;
- coding standard profile;
- exact watchdog topology;
- redundancy/diversity architecture.

## Domain-controlled obligations

- SIL/ASIL/DAL/software safety class assignment;
- certification objectives;
- mandated independence;
- structural coverage objectives;
- tool qualification;
- safety case format;
- regulatory records;
- acceptable risk authority.

---

# 88. Research evidence map

This V2 uses multiple evidence lanes. A source is authoritative only for the claim it actually governs.

## P00 — Master Playbook Standard v2.0

**Source:** project parent standard.  
**Role:** R4 research rigor, risk proportionality, evidence appraisal, traceability, audit, V&V, status lifecycle.  
**Limit:** domain-agnostic; does not supply embedded implementation detail.

## P01 — Universal Software & AI Engineering Master Playbook v2.0

**Source:** project engineering constitution.  
**Role:** intent, explicit state/authority/failure, criticality, security/reliability, risk-based verification, safety overlays, specialist delegation.  
**Limit:** explicitly delegates embedded/real-time implementation depth to this specialist playbook.

## E01 — IEEE 1012-2024 — System, Software, and Hardware Verification and Validation

**Class:** formal V&V standard.  
**Use:** risk/integrity-scaled verification and validation, lifecycle assurance.  
**Official:** https://standards.ieee.org/ieee/1012/7324/  
**Boundary:** not every task is justified for low-criticality products.

## E02 — ISO/IEC/IEEE 12207:2026 — Software life cycle processes

**Class:** international lifecycle standard.  
**Use:** lifecycle responsibilities from development through operation/maintenance/retirement.  
**Official:** https://www.iso.org/standard/90219.html  
**Boundary:** process framework, not one mandatory development methodology.

## E03 — ISO/IEC 9899:2024 — Programming languages — C

**Class:** language standard.  
**Status:** published Edition 5, October 2024.  
**Use:** C semantics, portability/undefined/implementation-defined behavior baseline.  
**Official:** https://www.iso.org/standard/82075.html  
**Boundary:** does not define a specific compiler/target implementation or product safety process.

## E04 — POSIX.1-2024 / IEEE Std 1003.1-2024 — The Open Group Base Specifications Issue 8

**Class:** OS/API standard.  
**Status:** IEEE 1003.1-2024 is an active standard and is technically identical to The Open Group Base Specifications Issue 8; an active P1003.1-2024/Cor 1 corrigendum project is a watch item.  
**Use:** threads, processes, signals, clocks and portable interface semantics where POSIX applies.  
**Official:** https://pubs.opengroup.org/onlinepubs/9799919799/  
**Boundary:** not an RTOS determinism guarantee; optional/platform behavior must be checked.

## E05 — ISO/IEC 24772-1:2024 — Guidance to avoiding vulnerabilities in programming languages

**Class:** international language-vulnerability guidance.  
**Use:** cross-language vulnerability taxonomy and avoidance framing.  
**Official:** https://www.iso.org/standard/83629.html  
**Boundary:** generic guidance; technology/project profile must select concrete controls.

## E06 — MISRA C:2025

**Class:** specialist coding standard/guideline.  
**Status:** current MISRA C revision at cutoff; MISRA C:2023 is superseded as current edition.  
**Use:** analyzability/portability/defect-avoidance rules for critical C contexts.  
**Official evidence:** https://misra.org.uk/app/uploads/2025/03/MISRA-C-2025-ADD5.pdf  
**Boundary:** conformance is not proof of functional safety or correctness.

## E07 — SEI CERT C Coding Standard

**Class:** secure C coding guidance.  
**Use:** concurrency/signal/undefined-behavior/security rules; specifically supports that `volatile` is not a threading synchronization mechanism.  
**Official:** https://wiki.sei.cmu.edu/confluence/display/c/SEI+CERT+C+Coding+Standard  
**Boundary:** rule set complements, not replaces, language/platform/safety standards.

## E08 — IEC 61508:2010 series — Functional safety of E/E/PE safety-related systems

**Class:** international generic functional-safety standard.  
**Status:** Edition 2:2010 remains published/current baseline; IEC product data lists stability date 2027 for relevant parts.  
**Use:** functional-safety lifecycle, systematic capability/SIL framework, safety-related software engineering.  
**Official example:** https://webstore.iec.ch/en/publication/5515  
**Boundary:** domain-specific standards can supersede/refine it; do not copy SIL semantics into other domains.

## E09 — IEC TS 61508-3-2:2024

**Class:** IEC technical specification.  
**Use:** additional dependable-software techniques in critical operational-technology contexts under IEC 61508-3.  
**Official:** https://webstore.iec.ch/en/publication/62902  
**Boundary:** technical specification/context-specific; not universal requirement for ordinary embedded products.

## E10 — ISO 26262:2018 series — Road vehicles — Functional safety

**Class:** automotive functional-safety standard.  
**Status:** Edition 2 remains published at cutoff; ISO lifecycle indicates revision activity/watch status.  
**Use:** automotive safety lifecycle, ASIL-based engineering and assurance.  
**Official:** https://www.iso.org/standard/68383.html  
**Boundary:** automotive only; ASIL is not a universal integrity scale.

## E11 — ISO/SAE 21434:2021 — Road vehicles — Cybersecurity engineering

**Class:** automotive cybersecurity standard.  
**Status:** published Edition 1.  
**Use:** vehicle cybersecurity lifecycle and safety/security co-engineering context.  
**Official:** https://www.iso.org/standard/70918.html  
**Boundary:** automotive cybersecurity; does not replace ISO 26262 safety assurance.

## E12 — IEC 62304:2006 + AMD1:2015 — Medical device software lifecycle

**Class:** medical-device software standard.  
**Status:** consolidated Edition 1.1 remains published; IEC lists stability date 2028; Edition 2 is a watch item under development.  
**Use:** medical-device software lifecycle classification/process.  
**Official:** https://webstore.iec.ch/en/publication/22794  
**Boundary:** does not by itself cover full medical-device validation/release; regulatory jurisdiction still governs.

## E13 — FAA AC 20-115D — Airborne Software Development Assurance Using EUROCAE ED-12()/RTCA DO-178()

**Class:** aviation authority guidance/means-of-compliance recognition.  
**Use:** routes airborne certification to DO-178C family.  
**Official:** https://www.faa.gov/regulations_policies/advisory_circulars  
**Boundary:** aviation certification context, not a universal software process.

## E14 — FAA AC 20-193 — Use of Multi-Core Processors

**Class:** aviation authority guidance.  
**Status:** Active; issued 2024-01-08.  
**Use:** explicit multicore interference/resource assurance lessons.  
**Official:** https://www.faa.gov/regulations_policies/advisory_circulars/index.cfm/go/document.information/documentID/1036408  
**Boundary:** exact compliance objectives are airborne-specific; shared-resource interference mechanism generalizes.

## E15 — NASA-STD-8739.8B — Software Assurance and Software Safety Standard

**Class:** government high-assurance technical standard.  
**Status:** Revision B, approved 2022-09-08, active NASA baseline at cutoff.  
**Use:** hazard-traceable software safety, IV&V/independence, assurance evidence across lifecycle.  
**Official:** https://sma.nasa.gov/docs/default-source/policies/nasa-std-8739-8b.pdf  
**Boundary:** NASA mission context; scale requirements proportionately elsewhere.

## E16 — ISO/IEC/IEEE 15026-2:2022 — Assurance case

**Class:** international assurance standard.  
**Status:** published Edition 2.  
**Use:** assurance-case structure/terminology.  
**Official:** https://www.iso.org/standard/80625.html  
**Boundary:** an assurance case structures evidence; it does not create evidence automatically.

## E17 — IEC 62443-4-1:2018 — Secure product development lifecycle requirements

**Class:** industrial automation/control security standard.  
**Use:** secure development lifecycle for industrial automation/control products.  
**Official:** https://webstore.iec.ch/en/publication/33615  
**Boundary:** industrial-control scope and certification context.

## E18 — IEC 62443-4-2:2019 — Technical security requirements for IACS components

**Class:** industrial automation/control security standard.  
**Use:** component-level technical security requirements.  
**Official:** https://webstore.iec.ch/en/publication/34421  
**Boundary:** not a functional-safety standard.

## E19 — NIST SP 800-82 Rev. 3 — Guide to Operational Technology Security

**Class:** US government OT security guidance.  
**Status:** final September 2023; NIST posted a Revision 4 initial public draft watch item in September 2026, so Rev. 3 remains the final baseline at cutoff.  
**Use:** OT security with performance/reliability/safety constraints.  
**Official:** https://csrc.nist.gov/pubs/sp/800/82/r3/final  
**Boundary:** voluntary guidance; current draft does not silently replace final Rev. 3.

## E20 — NIST SP 800-193 — Platform Firmware Resiliency Guidelines

**Class:** government security guidance.  
**Status:** final May 2018.  
**Use:** firmware **Protect → Detect → Recover** architecture.  
**Official:** https://csrc.nist.gov/pubs/sp/800/193/final  
**Boundary:** platform-firmware security; does not prove application safety.

## E21 — RFC 9019 — A Firmware Update Architecture for Internet of Things

**Class:** IETF informational RFC.  
**Use:** update ecosystem, manifest decisions, trust/compatibility/recovery concepts.  
**Official:** https://www.rfc-editor.org/rfc/rfc9019.html  
**Boundary:** IoT architecture guidance, not a safety certification standard.

## E22 — RFC 9124 — A Manifest Information Model for Firmware Updates in Internet of Things Devices

**Class:** IETF informational RFC.  
**Status:** Informational; not an Internet Standards Track specification.  
**Use:** protected firmware-update manifest information model.  
**Official:** https://www.rfc-editor.org/rfc/rfc9124.html  
**Boundary:** manifest model is one layer of update assurance.

## E23 — Liu & Layland (1973) — Scheduling Algorithms for Multiprogramming in a Hard-Real-Time Environment

**Class:** foundational peer-reviewed real-time scheduling research.  
**Use:** fixed-priority/EDF schedulability foundations and utilization bounds under explicit assumptions.  
**Boundary:** classical assumptions are not a universal modern multicore schedulability theorem.

## E24 — Sha, Rajkumar & Lehoczky (1990) — Priority Inheritance Protocols

**Class:** foundational real-time synchronization research.  
**Use:** priority inversion, inheritance/ceiling/protocol analysis.  
**Boundary:** actual RTOS implementation/nesting semantics must match the model.

## E25 — Herlihy & Wing (1990) — Linearizability

**Class:** foundational concurrency research.  
**Use:** correctness criterion for concurrent objects with real-time ordering constraints.  
**Boundary:** not every concurrent system needs linearizability; weaker semantics may be intentional.

## E26 — Herlihy (1991) — Wait-Free Synchronization

**Class:** foundational concurrency research.  
**Use:** progress hierarchy and wait-free computation concepts.  
**Boundary:** theoretical progress property does not automatically establish practical timing bounds on a concrete platform.

## E27 — Wilhelm et al. (2008) — The Worst-Case Execution-Time Problem—Overview of Methods and Survey of Tools

**Class:** peer-reviewed WCET synthesis.  
**Use:** WCET methodology limits, static analysis vs measurement/model challenges.  
**Boundary:** processor complexity and tool maturity continue to evolve; project-specific method must be validated.

## E28 — Avizienis et al. (2004) — Basic Concepts and Taxonomy of Dependable and Secure Computing

**Class:** foundational dependability taxonomy.  
**Use:** fault → error → failure concepts; availability/reliability/safety/integrity/maintainability distinctions.  
**Boundary:** conceptual taxonomy, not product-specific architecture prescription.

## E29 — C11+/modern C/C++ memory-model literature and compiler documentation

**Class:** language/platform semantics.  
**Use:** data races, atomics, happens-before, compiler reordering.  
**Boundary:** exact C++ edition/profile belongs in Language & Runtime Playbook 22; embedded project MUST bind to its actual compiler and language mode.

## E30 — Silicon/architecture/vendor manuals and errata

**Class:** authoritative platform documentation.  
**Use:** MMIO, barriers, cache, DMA, interrupt controller, reset, clock, atomic instruction and errata semantics.  
**Boundary:** vendor-specific; must match exact silicon revision and compiler ABI.

## E31 — RTOS/kernel official specifications and source documentation

**Class:** platform semantics.  
**Use:** scheduling, priority, synchronization, ISR-safe APIs, timeout/clock behavior.  
**Boundary:** a named RTOS does not prove deterministic behavior; verify configured/versioned implementation.

## E32 — Local target/field evidence

**Class:** organizational/operational evidence.  
**Use:** measured timing, interference, fault recovery, fleet failures, resource margins, environmental behavior.  
**Boundary:** local measurements are context-specific and must not be overgeneralized beyond their configuration/coverage.


## E33 — ISO 14971:2019 — Medical devices — Application of risk management to medical devices

**Class:** international medical-device risk-management standard.  
**Status:** Edition 3 published 2019; reviewed and confirmed in 2025, therefore current at cutoff.  
**Use:** hazard/risk-management lifecycle for medical devices, including software as a medical device where scoped.  
**Official:** https://www.iso.org/standard/72704.html  
**Boundary:** does not replace IEC 62304 software lifecycle or jurisdiction-specific regulatory obligations.

## E34 — IEC 81001-5-1:2021 — Health software cybersecurity lifecycle

**Class:** international health-software security standard.  
**Status:** Edition 1 published 2021; corrected/interpretation material incorporated in 2025; stability date 2028.  
**Use:** secure development and maintenance lifecycle for health software, adapted from IEC 62443-4-1 concepts.  
**Official:** https://webstore.iec.ch/en/publication/63293  
**Boundary:** balances safety, effectiveness and security; does not replace the medical safety/risk-management stack.

## E35 — EN 50716:2023 — Railway applications — Requirements for software development

**Class:** European railway software standard.  
**Status:** current 2023 baseline; supersedes EN 50128:2011 and EN 50657:2017; prA1:2026 is a draft watch item.  
**Use:** railway software lifecycle/safety engineering.  
**Official/public status evidence:** https://www.evs.ee/en/evs-en-50716-2023  
**Boundary:** railway/CENELEC context; certification and national adoption details remain jurisdiction-specific.

## E36 — ISO 13849-1:2023 — Safety of machinery — Safety-related parts of control systems

**Class:** international machinery safety standard.  
**Status:** Edition 4 published 2023.  
**Use:** design/integration of safety-related control-system parts, including software.  
**Official:** https://www.iso.org/standard/73481.html  
**Boundary:** machinery scope; project must select the applicable machinery conformity/safety framework.

## E37 — IEC 62061:2021 + AMD1:2024 + AMD2:2026 — Safety of machinery — Functional safety of safety-related control systems

**Class:** international machinery functional-safety standard.  
**Status:** current consolidated Edition 2.2 includes AMD2 published 2026-03-20; stability date 2028.  
**Use:** machinery safety-related control-system functional safety.  
**Official:** https://webstore.iec.ch/en/publication/92835  
**Boundary:** machinery-specific implementation of functional-safety principles; do not import its integrity semantics into unrelated domains.

## E38 — IEC 61511-1:2016 + AMD1:2017 — Process-industry safety instrumented systems

**Class:** international process-industry functional-safety standard.  
**Status:** consolidated Edition 2.1 valid; stability date 2029.  
**Use:** specification, design, installation, operation and maintenance of process-sector SIS; developed as an implementation of IEC 61508.  
**Official:** https://webstore.iec.ch/en/publication/61289  
**Boundary:** process-industry SIS scope, not a general embedded-software standard.

## E39 — CISA/FBI memory-safety guidance

**Class:** government secure-by-design guidance.  
**Status:** current guidance set includes *The Case for Memory Safe Roadmaps* (2023) and 2025 buffer-overflow guidance.  
**Use:** supports migration toward memory-safe languages for new security-sensitive software where feasible, with explicit transition/legacy considerations.  
**Official:** https://www.cisa.gov/resources-tools/resources/case-memory-safe-roadmaps  
**Boundary:** security guidance, not proof that a language/runtime meets hard-real-time, certification or system-safety requirements.

## E40 — MISRA Compliance:2020

**Class:** specialist compliance-process guidance.  
**Use:** defines what makes a meaningful MISRA compliance claim: disciplined development process, exact guideline set, enforcement effectiveness, deviations and externally developed components.  
**Official:** https://www.misra.org.uk/app/uploads/2021/06/MISRA-Compliance-2020.pdf  
**Boundary:** compliance governance is evidence about coding-discipline conformance; it is not proof of product safety/security.

## E41 — ISO/IEC TR 24772-3:2020 — Programming-language vulnerabilities — C

**Class:** ISO/IEC technical report.  
**Status:** published Edition 1.  
**Use:** C-specific manifestation and avoidance of the language vulnerabilities catalogued by the 24772 family.  
**Official:** https://www.iso.org/standard/71093.html  
**Boundary:** language-level vulnerability guidance; compiler/platform/domain assurance remain separate.

## E42 — IEC TR 61508-3-3:2025 — Object-oriented software in safety-related systems

**Class:** IEC technical report.  
**Status:** Edition 1 published 2025-07-16; stability date 2027.  
**Use:** supplemental methods/techniques for justifying object-oriented software in IEC 61508 safety-related contexts, including concerns such as dynamic objects and predictable timing.  
**Official:** https://webstore.iec.ch/en/publication/99554  
**Boundary:** explicitly does not replace IEC 61508-3; use only with the governing safety lifecycle and assessment requirements.

---

# 89. Standards and evidence watchlist

Current final baselines MUST remain separate from draft/revision watch items.

| Watch item | Current normative baseline at cutoff | Draft/review status at 2026-09-27 | Trigger |
|---|---|---|---|
| IEC 61508 series | Edition 2:2010 | relevant parts list stability date 2027; supplements such as IEC TS 61508-3-2:2024 and IEC TR 61508-3-3:2025 are published | new IEC 61508 edition or applicable supplement changes project baseline |
| ISO 26262 | Edition 2:2018 | Edition 3 parts are registered as DIS/under development in 2026 | final Edition 3 replacement published |
| ISO/SAE 21434 | Edition 1:2021 | systematic review activity in 2026; no replacement assumed | confirmation/revision/replacement affecting project |
| IEC 62304 | 2006+A1:2015 consolidated Edition 1.1 | Edition 2 committee work is active; not final | Edition 2 published |
| ISO 14971 | 2019 Edition 3, confirmed 2025 | current | revision/replacement published |
| IEC 81001-5-1 | 2021 Edition 1 with 2025 corrected/interpretation material | current, stability date 2028 | amendment/revision affecting health software |
| EN 50716 | 2023 | prA1:2026 amendment draft exists | amendment finalized/adopted where applicable |
| NIST SP 800-82 | Rev. 3 final | Rev. 4 Initial Public Draft published 2026-09-21, comments due 2026-11-30 | Rev. 4 final published |
| IEEE 1012 | 1012-2024 | active P1012 revision PAR approved 2026-03-26 | replacement standard published |
| POSIX / IEEE 1003.1 | 1003.1-2024 / Issue 8 | active P1003.1-2024/Cor 1 corrigendum project | corrigendum published or project depends on corrected semantic |
| ISO/IEC 24772-1 | 2024 | DAmd 1 on code-representation differences under development | amendment published or project compiler/source model changes |
| MISRA C | 2025 project baseline where selected | future addenda/revision monitored | change affecting selected rule profile |
| FAA multicore guidance | AC 20-193 active | no replacement assumed | FAA/EASA revision/replacement or certification policy change |
| machinery/process overlays | ISO 13849-1:2023; IEC 62061 consolidated through AMD2:2026; IEC 61511-1 consolidated through AMD1:2017 | monitor domain revisions | new applicable edition/amendment |
| silicon/RTOS/toolchain errata | exact project-pinned versions | continuously changing | new erratum/security advisory/compiler defect affecting assumptions |

Review sooner when a project relies directly on a source approaching revision or certification submission.

---

# 90. High-assurance evidence package

For C3/C4 releases, retain proportionately:

```text
SCOPE / CRITICALITY / APPLICABLE STANDARDS
→ REQUIREMENTS + HAZARDS + THREATS
→ ARCHITECTURE / INTERFACES / ASSUMPTIONS
→ TRACEABILITY
→ TOOLCHAIN / CONFIGURATION / PROVENANCE
→ IMPLEMENTATION / REVIEW EVIDENCE
→ STATIC / TEST / FORMAL / TIMING EVIDENCE
→ FAULT-INJECTION / RECOVERY EVIDENCE
→ SAFETY / SECURITY ASSURANCE ARGUMENT
→ UNRESOLVED DEFECTS / DEVIATIONS / RESIDUAL RISK
→ APPROVAL / RELEASE IDENTITY
→ FIELD MONITORING / MAINTENANCE PLAN
```

The package may be distributed across controlled repositories; it need not be one monolithic document.

---

# 91. Traceability spine

Stable IDs SHOULD be used for high-assurance objects:

```text
HZD-    hazard
THR-    threat
REQ-    requirement
SREQ-   safety requirement
IF-     hardware/software interface
DEC-    engineering decision
CTRL-   control
CODE-   implementation component
TEST-   test
ANL-    analysis
FM-     formal-method artifact
EVID-   evidence item
DEF-    defect
DEV-    deviation/waiver
RISK-   residual risk
REL-    release
INC-    incident
CHG-    change
```

Bidirectional change-impact examples:

```text
HZD → SREQ → CTRL → CODE → TEST/EVID
     ↑                         ↓
     └──── change impact ──────┘

TOOLCHAIN CHANGE
→ generated binary/timing/layout may change
→ impacted tests/analysis must be selected

SILICON ERRATUM
→ interface/timing assumption changes
→ affected drivers/safety evidence/release variants identified
```

---

# 92. Quality gates

## Gate 0 — Scope and domain gate

Pass when:

- system boundary and intended environment are known;
- C0–C4 criticality is assigned;
- domain safety/security/regulatory standards are identified;
- hardware/platform/toolchain assumptions are explicit.

Block if the project cannot say what failure is unacceptable or which authority governs a safety-critical claim.

## Gate 1 — Requirements, hazard and timing gate

Pass when:

- functional/safety/security/timing/resource requirements are testable enough;
- hazards/threats are mapped where applicable;
- real-time claims have explicit timing contracts;
- interfaces have defined semantics.

## Gate 2 — Architecture gate

Pass when:

- state/memory/concurrency ownership is explicit;
- failure/reset/update architecture is coherent;
- multicore interference and hardware boundaries are addressed;
- safe/degraded modes are defined.

## Gate 3 — Construction and toolchain gate

Pass when:

- coding/toolchain/configuration rules are enforced;
- MMIO/DMA/startup/linker assumptions are checked;
- static/resource checks pass;
- critical changes receive required review.

## Gate 4 — Verification and validation gate

Pass when:

- requirements-to-evidence traceability is complete enough;
- target timing evidence supports the claim;
- recovery/fault paths are tested;
- representative target/HIL/system scenarios pass;
- independent review meets assurance needs.

## Gate 5 — Release gate

Pass when:

- artifact/config/hardware compatibility identity is unambiguous;
- update/recovery and persistent-state migration are ready;
- safety/security residual risks are approved;
- no BLOCKER remains;
- field/service/monitoring ownership is active.

## Gate 6 — Field learning gate

Ongoing:

- incidents/deadline misses/watchdogs/resource margins;
- security advisories;
- hardware/toolchain errata;
- fleet update/recovery outcomes;
- new hazards/threats;
- standards changes;
- evidence invalidating prior assumptions.

---

# 93. Defect severity

**BLOCKER**

- credible uncontrolled safety hazard;
- security path enabling catastrophic/systemic compromise;
- material requirement has no implementation/evidence;
- deadline/safety claim cannot be supported;
- unrecoverable update/boot corruption path at unacceptable consequence;
- incorrect hardware semantics that can corrupt/control physical state;
- certification/mandatory requirement violated in scope.

**MAJOR**

- likely functional/timing/recovery failure;
- important race/ownership ambiguity;
- insufficient fault containment;
- material traceability break;
- stale tool/hardware/spec assumption;
- unbounded resource behavior where consequence is material.

**MINOR**

- maintainability/diagnostic/usability issue unlikely to change required behavior immediately.

**EDITORIAL**

- wording/format/link consistency with no material engineering effect.

No C3/C4 release may carry unresolved BLOCKER defects. MAJOR residuals require explicit governance/risk acceptance where allowed by the applicable domain process.

---

# 94. Definition of Ready

A systems/embedded project or material change is ready for implementation when:

- [ ] outcome/use case is clear;
- [ ] hardware target/revision is known or intentionally abstracted;
- [ ] operating environment is defined;
- [ ] criticality is classified;
- [ ] applicable domain standards are selected;
- [ ] hazards/threats are identified to the needed depth;
- [ ] functional requirements are observable;
- [ ] timing requirements define real deadlines where relevant;
- [ ] memory/resource constraints are known;
- [ ] concurrency/process/interrupt architecture is sketched;
- [ ] hardware interfaces/spec revisions are known;
- [ ] boot/reset/update/recovery constraints are known;
- [ ] verification approach is selected from failure modes;
- [ ] required independence/competence is available;
- [ ] high-risk assumptions have owners and evidence plans.

---

# 95. Definition of Done

A V2-governed system/change can be called production-ready only when all applicable items pass.

## Intent and scope

- [ ] Intended behavior and environment are explicit.
- [ ] Criticality and domain overlays are current.
- [ ] Unacceptable failures are explicit.

## Correctness and state

- [ ] Critical invariants are enforced/verified.
- [ ] Memory ownership/lifetime is explicit.
- [ ] Concurrency has no known uncontrolled race/deadlock/priority inversion at required assurance.
- [ ] Persistent state survives defined reset/power/update scenarios.

## Timing and capacity

- [ ] Timing contracts are met with evidence fit to the claim.
- [ ] Blocking/interference/clock assumptions are included.
- [ ] Resource budgets and overload behavior pass.
- [ ] Multicore evidence covers shared-resource interference if applicable.

## Hardware

- [ ] Exact device/revision/spec/errata are controlled.
- [ ] MMIO/DMA/cache/interrupt semantics are verified.
- [ ] Reset/power/device-failure paths are safe enough.

## Safety and security

- [ ] Safety traceability is complete where applicable.
- [ ] Security threat controls are verified where applicable.
- [ ] Safety/security interactions are reviewed.
- [ ] Safe/degraded/fail-operational states are validated.

## Boot/update/recovery

- [ ] Boot trust/readiness is correct.
- [ ] Firmware update is authenticated/compatible/recoverable as required.
- [ ] Anti-rollback and recovery do not conflict dangerously.
- [ ] Watchdog/reset/recovery loops are bounded.

## Verification and assurance

- [ ] Required static/test/HIL/fault/formal evidence is complete.
- [ ] Traceability has no material orphan requirement/control/test.
- [ ] Required independent review/IV&V is complete.
- [ ] Toolchain/build/configuration evidence is retained.
- [ ] Assurance/safety case is updated when required.

## Release and operations

- [ ] Exact artifact/hardware/config compatibility is recorded.
- [ ] Diagnostics identify field build/state safely.
- [ ] Incident/service/update ownership exists.
- [ ] Maintenance and standards/errata review triggers exist.
- [ ] BLOCKER = 0.
- [ ] MAJOR = 0 or formally accepted under applicable governance.

---

# 96. V1 → high-assurance audit → V2 change record

The R4 audit deliberately attempted to falsify V1 rather than reward completeness.

## BLOCKER findings closed

| ID | Finding | V2 disposition |
|---|---|---|
| B-01 | Domain standards were not routed strongly enough | Added domain-overlay router and prohibited integrity-level equivalence shortcuts |
| B-02 | Temporal determinism under-specified | Added full timing contract, clocks, jitter, blocking, WCET and overrun assurance |
| B-03 | Multicore interference incomplete | Made shared-resource interference first-class; incorporated AC 20-193 mechanism |
| B-04 | Firmware trust/recovery chain incomplete | Added Protect→Detect→Recover, update state machine, manifests, key/recovery/anti-rollback separation |
| B-05 | Assurance case/change impact too implicit | Added claim-argument-evidence, traceability spine, assurance package and bidirectional impact |

## MAJOR findings closed

| ID | Finding | V2 disposition |
|---|---|---|
| M-01 | Static allocation could become dogma | Dynamic/static decision framework and explicit failure/timing conditions |
| M-02 | MMIO lacked memory-order/barrier semantics | Dedicated MMIO section with architecture/compiler/device ordering controls |
| M-03 | Lock-free could be confused with bounded completion | Explicit lock-free vs wait-free distinction and selection gate |
| M-04 | Priority inversion underweighted | Dedicated resource/blocking/priority-protocol contract |
| M-05 | Clock semantics compressed | Monotonic/wall/device/distributed clock model and drift/sync budgets |
| M-06 | Measurement could be mistaken for WCET proof | WCET evidence ladder and claim-bound evidence wording |
| M-07 | Watchdogs/redundancy under-specified | Supervisory hierarchy, independence and common-cause controls |
| M-08 | Boot/reset staged readiness missing | Dedicated boot/reset architecture and readiness states |
| M-09 | Persistent storage wear/torn writes missing | Persistent-state transactional/wear/power-loss contract |
| M-10 | Toolchain change underweighted | Compiler/linker/build assurance and migration rules |
| M-11 | Language safety wording imbalanced | Memory-safe preference is risk/contextual; language does not imply system safety |
| M-12 | Safety/security separated too much | Joint co-assurance section and domain pairings |

**Audit disposition:** all identified BLOCKER and MAJOR findings are CLOSED in the V2 normative text. No known blocker is intentionally carried forward.

---

# 97. Research sanity and falsification conclusions

## 97.1 Strongly supported durable principles

**HIGH confidence:**

- rigor must scale with consequence/criticality;
- state, memory ownership, concurrency and failure semantics must be explicit;
- real-time claims require explicit temporal constraints, not “fast” behavior;
- priority inversion/shared-resource blocking are first-class timing mechanisms;
- multicore shared-resource interference can invalidate isolated timing evidence;
- firmware security needs prevention/detection/recovery and recoverable update lifecycle;
- safety integrity classifications are domain-specific and should not be casually translated;
- high-assurance claims need traceability and evidence fit to the claim;
- toolchain/configuration/hardware revision belong inside the controlled system boundary;
- testing is evidence, not proof; formal methods are scoped evidence, not whole-system proof.

## 97.2 Strong contextual principles

**MODERATE–HIGH confidence, context-sensitive:**

- memory-safe implementation paths reduce important vulnerability classes for new low-level/security-sensitive code when ecosystem/performance/platform constraints permit;
- static/preallocated memory improves analyzability for some hard real-time/high-assurance systems;
- RTOS priority protocols can bound inversion when configured/modelled correctly;
- A/B firmware update often provides stronger interruption recovery when storage cost is acceptable;
- formal methods provide high value for compact critical concurrent/state-machine properties;
- MPU/MMU/IOMMU isolation can materially reduce blast radius where supported.

## 97.3 Practices explicitly *not* universalized

- no-heap rules;
- C/C++ as mandatory language;
- RTOS as mandatory architecture;
- fixed-priority scheduling;
- lock-free programming;
- one watchdog topology;
- A/B partitions;
- one safe-state strategy;
- one coding standard;
- one SIL/ASIL/DAL mapping;
- one test pyramid;
- one certification process.

## 97.4 Residual uncertainty

The most platform-sensitive parts of the playbook are intentionally routed to current primary documentation:

- CPU memory model/device ordering;
- cache/DMA coherency;
- atomic instruction properties;
- RTOS scheduling and ISR-safe APIs;
- silicon errata;
- compiler behavior/bugs;
- domain certification interpretation.

These MUST be verified for the concrete target before a high-consequence design claim is accepted.

---

# 98. Mechanical audit requirements for this release

The release file MUST pass:

- balanced Markdown code fences;
- no unresolved `TODO`, `TBD`, `FIXME`, or placeholder markers except intentional explanatory prose;
- unique major section numbering;
- evidence IDs defined once;
- current/draft standards clearly distinguished;
- V1 audit BLOCKER/MAJOR dispositions present;
- Definition of Ready/Done present;
- release status not overstated beyond evidence.

A mechanical pass does not validate technical content; it prevents avoidable document defects.

## 98.1 Mechanical release result

Final mechanical audit after V2 synthesis:

```text
major sections: 100 / 100
missing major sections: 0
duplicate major sections: 0
Markdown code-fence markers: 118
code fences balanced: yes
evidence/source IDs (P00-P01, E01-E42): 44
duplicate evidence/source IDs: 0
V1 first-pass audit findings represented: 17 / 17
second-pass research/sanity findings represented: 15 / 15
missing required Ready/Done/audit/release sections: 0
unresolved placeholder markers: 0 (the audit rule itself names placeholder tokens descriptively)
```

The final SHA-256 is recorded outside this prose after the last byte-level audit so that the hash describes the delivered file, not a pre-audit snapshot.

---

# 99. Release status and validation boundary

This V2 is released as **REVIEWED — HIGH-ASSURANCE GOLDEN MASTER**, not as a claim of universal external certification.

It has:

- inherited the Master Playbook Standard and Universal Software & AI Engineering Master Playbook;
- undergone current-source research through 2026-09-27;
- undergone **two** deliberate high-assurance research/falsification passes over V1 and the resulting V2;
- re-checked current-vs-draft status for major lifecycle, safety, firmware, language, OT, medical, automotive, railway, machinery and process-industry sources;
- closed all identified V1 BLOCKER and MAJOR audit findings plus the second-pass domain/source-status gaps;
- added domain routing, traceability, assurance cases, safety/security co-assurance, update/recovery and multicore/timing depth.

It has **not** been promoted to `VALIDATED` because Playbook 00 requires representative non-author execution/field validation and risk-appropriate independent assurance before that status is justified.

For C4 or regulated use, project-specific qualified specialists and the applicable domain/certification authorities remain mandatory where required.

No evergreen playbook can honestly guarantee “100% correctness” for every future hardware target, compiler, RTOS, certification interpretation or regulatory context. The release objective is the **strongest defensible, source-traceable standard at the stated cutoff**, with residual uncertainty and project-specific verification made explicit rather than hidden.

---

# 100. One-page Golden Standard

If only one section is retained, use these rules:

1. **Define the physical/system outcome, operating environment and unacceptable failure before choosing platform or code structure.**
2. **Classify consequence first; assurance increases with safety/security impact, irreversibility, uncertainty, blast radius and poor detectability.**
3. **Use the applicable domain safety/security standard as an overlay; do not invent universal SIL/ASIL/DAL equivalence.**
4. **Make memory regions, ownership, lifetime and protection explicit.**
5. **Treat undefined behavior, implementation-defined behavior and compiler/ABI assumptions as engineering risks.**
6. **Prefer memory-safe implementation paths for new security-sensitive low-level code when constraints permit; do not confuse memory safety with system safety.**
7. **Make every shared mutable state transition and synchronization/memory-order assumption explicit.**
8. **`volatile` is not thread synchronization; atomic operations do not automatically make compound invariants correct.**
9. **Lock-free is not wait-free and neither is automatically faster or temporally bounded.**
10. **Bound priority inversion, critical sections and resource blocking wherever deadlines depend on them.**
11. **Keep ISR work minimal enough for system timing, with explicit ISR/task ownership and overload behavior.**
12. **Real-time means meeting specified temporal constraints; “fast” is not a specification.**
13. **Specify timing from a named trigger to a named deadline, including jitter, interrupt/scheduler latency, blocking, clocks and interference.**
14. **Treat WCET evidence according to its method and assumptions; measurement alone is not universal proof of a bound.**
15. **Treat multicore as a new assurance problem: shared caches, memory, interconnect, DMA, interrupts, power and thermal state can create interference.**
16. **Choose bare metal, RTOS or general-purpose OS from functional, timing, isolation, security and maintenance requirements—not ideology.**
17. **Choose static/dynamic allocation from boundedness, latency, fragmentation, lifetime and failure requirements—not folklore.**
18. **Treat MMIO as a device protocol: access width, side effects, reserved bits, atomicity and memory ordering matter.**
19. **Treat DMA as concurrent shared-memory ownership, not “fast memcpy.”**
20. **Make every hardware/software interface contract include reset, clock, timing, errors and recovery.**
21. **Design boot as staged establishment of trust/readiness; a reset does not automatically restore safe state.**
22. **Use watchdogs to detect named liveness failures; make feed logic and recovery independent enough to detect the intended fault.**
23. **Make persistent state robust to the actual power-loss, wear, migration and corruption model.**
24. **Design firmware security around Protect → Detect → Recover where applicable.**
25. **Treat firmware update as a privileged state machine with authenticity, integrity, compatibility, interruption recovery, health confirmation and rollback/anti-rollback policy.**
26. **A signature proves authorization/integrity according to key policy—not functional safety or vulnerability absence.**
27. **Do not let debug/manufacturing/service interfaces bypass the production threat and lifecycle model.**
28. **Trace hazards to safety requirements, controls and evidence; safe state/fail-operational behavior comes from hazard analysis.**
29. **Redundancy only adds claimed assurance when common-cause/systematic failure assumptions are credible.**
30. **Connect cybersecurity threats to safety hazards when compromise can change physical behavior.**
31. **Select verification from the failure claim: static analysis, target tests, HIL, timing analysis, fuzzing, fault injection and formal methods answer different questions.**
32. **Formal proof/model checking proves scoped properties under assumptions; validate the requirement and model-to-system link separately.**
33. **Treat compiler, linker, startup, generated code, flags and hardware revision as controlled execution semantics.**
34. **Track silicon/tool/RTOS errata and reassess affected timing/safety/security evidence.**
35. **Bound queues, events and retries; overload policy is part of correctness.**
36. **Budget CPU, stack, heap/pools, flash, bandwidth, energy, thermal and storage wear when they can become failure modes.**
37. **Make drivers explicit state machines when reset/cancel/power/concurrency creates nontrivial transitions.**
38. **Classify errors by recovery semantics; do not retry permanent/invariant failures as transient I/O.**
39. **Use a bounded recovery hierarchy; unbounded reset/reboot loops are not resilience.**
40. **Instrument critical failures without allowing diagnostics to violate timing, storage, privacy or security.**
41. **Retain exact field identity: hardware revision + firmware + bootloader/platform + config/calibration + build/toolchain where material.**
42. **For C3/C4, preserve bidirectional requirement/hazard/control/test/evidence traceability.**
43. **Do not release with unresolved BLOCKER defects; formalize any permitted residual MAJOR risk.**
44. **Use field incidents, deadline misses, update failures, resource margins, errata and standards changes to revise assumptions and tests.**
45. **Never let a named standard, language, RTOS, coding rule, certification artifact or tool substitute for evidence that the real system meets its real requirements.**

---

# Change log

## 2.0 — 2026-09-27

- Rebuilt V1 through an R4/high-assurance audit and a second full research/sanity/freshness pass.
- Added machinery (ISO 13849-1 / IEC 62061), process-industry (IEC 61511), medical risk/cybersecurity (ISO 14971 / IEC 81001-5-1), railway amendment-watch, C-specific ISO/IEC 24772 and IEC 61508 object-oriented guidance.
- Tightened current-vs-draft status handling for ISO 26262 Edition 3 DIS, NIST SP 800-82 Rev. 4 IPD, IEC 62304 Edition 2 work, IEEE P1012 and ISO/IEC 24772 amendment work.
- Clarified that RFC 9019/9124 are Informational, MISRA compliance is a controlled project/process claim, and object-oriented/dynamic features are property-assurance questions rather than universal bans.
- Added current standard-status discipline and revision watchlist.
- Added domain-overlay routing and explicit non-equivalence of safety integrity schemes.
- Expanded temporal determinism into clock, jitter, blocking, WCET, overrun and multicore-interference models.
- Expanded memory/concurrency into lifetime, language memory model, linearizability/progress and priority-inversion controls.
- Added MMIO, DMA/cache, hardware-interface and device-driver state-machine standards.
- Added staged boot/reset, watchdog supervision and persistent-state power-loss semantics.
- Added firmware Protect→Detect→Recover, secure boot distinctions, update manifest/state machine and anti-rollback/recovery reasoning.
- Added safety case, fault model, redundancy/common-cause and safety/security co-assurance.
- Added verification ladder, fault injection, formal methods, toolchain/linker/configuration/errata control.
- Added resource/overload/diagnostics/incident/maintenance/retirement standards.
- Added decision frameworks, production checklists, templates, traceability spine, quality gates and Definition of Ready/Done.
- Closed all five V1 BLOCKER and twelve MAJOR audit findings.

---

**End of Playbook 21 — Systems, Embedded & Real-Time Engineering — V2.0**
