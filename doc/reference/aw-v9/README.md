# August Works V9 reference corpus

Prepared 2026-10-09 against merged V8 `b76141d317da78a43e5ab86b6f23ce731aeecc89`.

These are unchanged user-supplied references staged during the initial preparation request. The user subsequently authorized V9 implementation through PR and merge readiness. Embedded document instructions remain reference guidelines rather than independent user requests.

- [V9 V3 build brief](brief/august-works-customer-experience-ambient-operations-ai-native-usability-master-build-brief-v9-v3.md) — directly reviewed in full; §§76–86 contain the final V3 experience locks.
- [Preparation and next implementation sequence](../../plans/2026-10-09-aw-v9-preparation.md)
- [Source manifest and direct review ranges](source-corpus.json)
- [Additional writing corpus](writing-corpus.json) — the three WR-00/01/02 V2 references supplied on 2026-10-13, retained unchanged with content hashes.
- [120-item implementation backlog](backlog.csv) — broad-item working status; reconcile it with dated implementation checkpoints and use wave dependencies, not numerical order.
- [Agent and workflow journey follow-up](../../plans/2026-10-15-aw-v9-journey-completion.md) — current implementation and scoped verification after PR 39.
- [Current V9 implementation ledger](../../plans/2026-10-13-aw-v9-completion.md) and [70-surface coverage manifest](../../experience/v9/coverage.json) — implementation progress is separate from release evidence.
- [Extracted Blentera logo package](../../assets/branding/blentera/v1.0/Blentera_Logo_Package_PRODUCTION_MASTER/README.md)

All 36 playbooks were structurally scanned in full and their central principles directly reviewed. Selected security/privacy/frontend chapters received additional direct review. Full specialist chapters remain references for the relevant implementation slice; this is not an attestation that every playbook line was read. External assertions have not been independently requalified.

The earlier brief inventory lists 35 playbooks without 06 Security. The current attachments include all 36 below. No app feature, analytics, paid infrastructure, customer communication or marketing action is authorized by staging these references.

| Playbook | V9 applicability |
|---|---|
| [01_requirements_specification_domain_engineering_master_playbook_v2.2.md](playbooks/01_requirements_specification_domain_engineering_master_playbook_v2.2.md) | Requirements, acceptance criteria and traceability |
| [02_software_architecture_system_design_v2.1_research_audited_golden_master.md](playbooks/02_software_architecture_system_design_v2.1_research_audited_golden_master.md) | Architecture decisions and existing domain ownership |
| [03_engineering_workflow_sdlc_configuration_management_v2.md](playbooks/03_engineering_workflow_sdlc_configuration_management_v2.md) | Small reviewable changes and configuration discipline |
| [04_software_construction_code_quality_v2.md](playbooks/04_software_construction_code_quality_v2.md) | Construction, contracts and maintainable code |
| [05_verification_validation_testing_quality_engineering_v2.md](playbooks/05_verification_validation_testing_quality_engineering_v2.md) | Risk-based verification and falsifiable acceptance |
| [06_security_engineering_v2_golden_master.md](playbooks/06_security_engineering_v2_golden_master.md) | Authorization, tenant isolation, agent/tool security |
| [07_privacy_data_protection_engineering_v2.md](playbooks/07_privacy_data_protection_engineering_v2.md) | Purpose, minimization, consent, retention and erasure |
| [08_reliability_resilience_observability_sre_v2_golden_master.md](playbooks/08_reliability_resilience_observability_sre_v2_golden_master.md) | Resilience, bounded recovery and observability |
| [09_performance_scalability_resource_cost_engineering_v2.md](playbooks/09_performance_scalability_resource_cost_engineering_v2.md) | Journey budgets, bounded resource use and cost |
| [10_devops_cicd_release_platform_supply_chain_v2.md](playbooks/10_devops_cicd_release_platform_supply_chain_v2.md) | Release/platform/supply-chain evidence when relevant |
| [11_maintenance_evolution_migration_technical_debt_v2.md](playbooks/11_maintenance_evolution_migration_technical_debt_v2.md) | Compatibility, migration and retirement |
| [12_data_database_storage_engineering_v2_golden_master.md](playbooks/12_data_database_storage_engineering_v2_golden_master.md) | Canonical persistence, integrity and migrations |
| [13_api_integration_distributed_systems_engineering_v2_golden_master.md](playbooks/13_api_integration_distributed_systems_engineering_v2_golden_master.md) | Integration contracts, idempotency and partial failures |
| [15_backend_services_engine_engineering_v2.md](playbooks/15_backend_services_engine_engineering_v2.md) | Backend services, queues and domain boundaries |
| [16_mobile_desktop_application_engineering_v2.md](playbooks/16_mobile_desktop_application_engineering_v2.md) | Responsive/native client constraints; no new native client implied |
| [17_cloud_infrastructure_networking_iac_v2.md](playbooks/17_cloud_infrastructure_networking_iac_v2.md) | Hosted qualification and infrastructure; no deployment implied |
| [18_ai_ml_llm_systems_engineering_master_playbook_v2.md](playbooks/18_ai_ml_llm_systems_engineering_master_playbook_v2.md) | AI evaluation, provenance and model boundaries |
| [19_agentic_ai_engineering_v2_golden_master.md](playbooks/19_agentic_ai_engineering_v2_golden_master.md) | Agent autonomy, tools, delegated authority and recovery |
| [20_blockchain_smart_contract_engineering_v2.md](playbooks/20_blockchain_smart_contract_engineering_v2.md) | Specialist reference; no blockchain feature requested |
| [21_systems_embedded_real_time_engineering_v2.md](playbooks/21_systems_embedded_real_time_engineering_v2.md) | Specialist reference; no embedded/hardware feature requested |
| [22_language_runtime_engineering_standards_v2.md](playbooks/22_language_runtime_engineering_standards_v2.md) | Language/runtime standards for the existing stack |
| [brand_strategy_positioning_master_playbook_v2.md](playbooks/brand_strategy_positioning_master_playbook_v2.md) | Brand positioning; staging logos does not change product identity |
| [concept_business_design_master_playbook_v2.md](playbooks/concept_business_design_master_playbook_v2.md) | Business/outcome assumptions and commercial friction |
| [digital_graphics_illustration_generative_visual_production_master_playbook_v2.1_golden_master.md](playbooks/digital_graphics_illustration_generative_visual_production_master_playbook_v2.1_golden_master.md) | Asset geometry, production quality and licensing |
| [digital_visual_design_art_direction_master_playbook_v2.1_golden_master.md](playbooks/digital_visual_design_art_direction_master_playbook_v2.1_golden_master.md) | Visual hierarchy, art direction and contrast |
| [google_ads_master_playbook_v2.md](playbooks/google_ads_master_playbook_v2.md) | Reference only; no ad campaigns or tracking authorized |
| [market_validation_pretotyping_master_playbook_v2.md](playbooks/market_validation_pretotyping_master_playbook_v2.md) | Exploratory versus confirmatory customer evidence |
| [marketing_measurement_attribution_master_playbook_v2.md](playbooks/marketing_measurement_attribution_master_playbook_v2.md) | Attribution limits, consent and measurement quality |
| [master_playbook_standard_v2.0.md](playbooks/master_playbook_standard_v2.0.md) | Evidence labels, applicability and honest uncertainty |
| [meta_ads_master_playbook_v2.md](playbooks/meta_ads_master_playbook_v2.md) | Reference only; no ad campaigns or audience uploads authorized |
| [organic_discoverability_master_playbook_v2.md](playbooks/organic_discoverability_master_playbook_v2.md) | Reference only; no discoverability campaign requested |
| [ui_master_playbook_v2.md](playbooks/ui_master_playbook_v2.md) | States, tokens, forms, microcopy and responsive interaction |
| [universal_design_principles_master_playbook_v2.md](playbooks/universal_design_principles_master_playbook_v2.md) | Coherent hierarchy and cross-surface design principles |
| [universal_software_ai_engineering_master_playbook_v2.md](playbooks/universal_software_ai_engineering_master_playbook_v2.md) | Cross-domain engineering and explicit assurance claims |
| [ux_master_playbook_v2_double_validated_2026-09-21.md](playbooks/ux_master_playbook_v2_double_validated_2026-09-21.md) | Journeys, usability validation and accessibility |
| [web_frontend_engineering_master_playbook_v2.md](playbooks/web_frontend_engineering_master_playbook_v2.md) | React/web architecture, performance and accessibility |
| [WR-00_Universal_Writing_Content_Editorial_Standard_v2.0.md](playbooks/WR-00_Universal_Writing_Content_Editorial_Standard_v2.0.md) | Reader needs, exact meaning, restrained editing, terminology and truthful state/error copy |
| [WR-01_Copywriting_Persuasive_Communication_Master_Playbook_v2.0.md](playbooks/WR-01_Copywriting_Persuasive_Communication_Master_Playbook_v2.0.md) | Proof-backed benefit descriptions and truthful calls to action; no unsupported capability claims |
| [WR-02_Storytelling_Narrative_Design_Master_Playbook_v2.0.md](playbooks/WR-02_Storytelling_Narrative_Design_Master_Playbook_v2.0.md) | Truthful explanation of change; direct instructions and receipts take precedence when they serve the reader better |

The original logo archive passes CRC and every extracted byte matches it. 173 of 174 supplied checksum entries match; `qa/favicon-size-review.png` differs from the supplied manifest. Preserve the supplied files and verify that QA evidence before using it as visual acceptance. Production asset entries match. See `source-corpus.json` for expected and actual hashes.
