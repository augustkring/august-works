import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { activityLog, analyticalLineageEdges, analyticalLineageManifests, applyPendingMigrations, businessEventObjects, businessEvents, companies, createDb, governanceObligations, issues, projects,
  processAnalysisDefinitions, processAnalysisPublications, processAnalysisRuns, processAnalysisVersions, processFindings, processFindingTransitions } from "@paperclipai/db";
import { processAnalysisDefinitionSchema, type ProcessAnalysisDefinition } from "@paperclipai/shared";
import { processAnalysisService } from "../services/process-analysis.js";
import { processFindingService } from "../services/process-findings.js";
import { businessEventService } from "../services/business-events.js";
import { aiGovernanceService } from "../services/ai-governance/governance-service.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { lockMemoryPrivacy } from "../services/memory/memory-privacy.js";
import { eraseAnalyticalSourcesUnderMemory } from "../services/analytical-source-erasure.js";
import { eraseBusinessEventObjectUnderMemory } from "../services/business-event-payload-erasure.js";
import { eraseExpiredAnalyticalLineage } from "../services/analytical-retention.js";
import { assertDatabaseRestoreAdmission, prepareRestoredQuarantine } from "../services/saas/quarantine.js";
import { analyticalPurpose } from "./helpers/business-metric-fixture.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;
const actor = { type: "board" as const, source: "local_implicit" as const };
const flags = { business_events_v8: true, analytical_lineage_v8: true, process_intelligence_v8: true, ai_use_cases_v7: true, governance_evidence_v7: true };
const period = { from: "2026-01-01T00:00:00.000001Z", until: "2026-01-02T00:00:00.000002Z" };
suite("Native human-published process analysis on migrated PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>, companyId: string, otherCompanyId: string, issueId: string, projectId: string, policyId: string;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v8-process-"); db = createDb(database.connectionString); });
  afterAll(async () => { await database?.cleanup(); });
  beforeEach(async () => {
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental(flags);
    companyId = randomUUID(); otherCompanyId = randomUUID(); issueId = randomUUID(); projectId = randomUUID();
    await db.insert(companies).values([{ id: companyId, name: "Native process", issuePrefix: randomUUID() }, { id: otherCompanyId, name: "Foreign", issuePrefix: randomUUID() }]);
    await db.insert(projects).values({ id: projectId, companyId, name: "Native project" });
    await db.insert(issues).values({ id: issueId, companyId, projectId, title: "Native task" });
    const policy = analyticalPurpose(); policy.citation = "Native process test purpose";
    policy.analyticalPurpose!.purpose = "process_intelligence"; policy.analyticalPurpose!.capabilities = ["process"]; policy.analyticalPurpose!.maxRetentionDays = 90;
    policyId = (await aiGovernanceService(db).obligation(actor, companyId, policy)).id;
    await db.insert(activityLog).values([
      { companyId, actorType: "user", actorId: "private-person", entityType: "issue", entityId: issueId, action: "issue.created", createdAt: new Date("2026-01-01T12:00:00Z"), details: { status: "todo", projectId, body: "secret body" } },
      { companyId, actorType: "user", actorId: "private-person", entityType: "issue", entityId: issueId, action: "issue.updated", createdAt: new Date("2026-01-01T12:01:00Z"), details: { status: "done", projectId, body: "secret body" } },
    ]);
  });
  const service = () => processAnalysisService(db);
  const definition = () => processAnalysisDefinitionSchema.parse({ name: "Native task cycle", businessQuestion: "How long did the recorded native task cycle take?",
    ownerUserId: "local-board", reviewFrequencyDays: 30, retentionDays: 30, scope: "company", sensitivity: "internal", purpose: "process_intelligence",
    governanceObligationRefs: [policyId], requiredSourceProviders: ["activity_log"], objectTypes: ["issue"], requiredActivities: ["issue.created", "issue.updated"],
    minimumCoverageSeconds: 3600, analysisFamilies: ["event_volume", "directly_follows", "variants", "cycle_time"], requiresArrivalEvidence: false, maxLateArrivalRate: 0 });
  async function published(value = definition()) {
    const created = await service().create(companyId, actor, { key: `flow_${randomUUID()}`, definition: value });
    const root = await service().publish(companyId, actor, created.root.id, { expectedRevision: 1, versionId: created.version.id, rationale: "Human reviewed the native definition and requested analyses" });
    return { ...created, root };
  }
  async function project() {
    await businessEventService(db).backfill(companyId, actor, { ...period, limit: 100, retentionDays: 30, governanceObligationRefs: [policyId] });
  }
  async function waitForBlockedRead(fragment: string) {
    const deadline=performance.now()+1500;
    while(performance.now()<deadline) {
      const [row]=await db.execute<{blocked:boolean}>(sql`select exists(select 1 from pg_stat_activity where datname=current_database()
        and pid<>pg_backend_pid() and wait_event_type='Lock' and query like ${`%${fragment}%`}) as blocked`);
      if(row?.blocked) return;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    throw Error("Native reader did not reach the expected database lock boundary");
  }
  it("keeps drafts and proposed revisions separate from publication, with immutable receipts and expected-revision checks", async () => {
    const created = await service().create(companyId, actor, { key: "recorded_flow", definition: definition() });
    await expect(service().run(companyId, actor, created.root.id, { versionId: created.version.id, ...period })).rejects.toMatchObject({ status: 409 });
    await service().publish(companyId, actor, created.root.id, { expectedRevision: 1, versionId: created.version.id, rationale: "Explicit human review of exact definition and purpose" });
    await expect(service().revise(companyId, actor, created.root.id, { expectedRevision: 1, definition: definition() })).rejects.toMatchObject({ status: 409 });
    const next = await service().revise(companyId, actor, created.root.id, { expectedRevision: 2, definition: { ...definition(), name: "Proposed changed definition" } });
    const detail = await service().detail(companyId, actor, created.root.id);
    expect(detail).toMatchObject({ root: { revision: 3, publishedVersionId: created.version.id }, effectiveVersion: { id: created.version.id }, latestVersion: { id: next.id } });
    await expect(service().run(companyId, actor, created.root.id, { versionId: next.id, ...period })).rejects.toMatchObject({ status: 409 });
    await expect(db.update(processAnalysisVersions).set({ contentHash: "f".repeat(64) }).where(eq(processAnalysisVersions.id, next.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(processAnalysisPublications).set({ rationale: "Changed review" }).where(eq(processAnalysisPublications.definitionId, created.root.id))).rejects.toMatchObject({ cause: { code: "23514" } });
  });
  it("requires fresh intrinsic readiness, retains exact microsecond windows and erases dependent result payloads under Memory", async () => {
    const created = await published();
    const missing = await service().run(companyId, actor, created.root.id, { versionId: created.version.id, ...period });
    expect(missing.result).toMatchObject({ status: "inconclusive", errorCode: "DATA_NOT_READY", objectSummaries: [] });
    await project();
    const run = await service().run(companyId, actor, created.root.id, { versionId: created.version.id, ...period });
    expect(run.result).toMatchObject({ status: "succeeded", objectSummaries: [{ objectType: "issue", objectCount: 1, medianCycleSeconds: 60 }] });
    expect(JSON.stringify(run)).not.toMatch(/private-person|secret body/);
    const retained = await service().getRun(companyId, actor, created.root.id, run.id);
    expect((await service().listRuns(companyId,actor,created.root.id)).items.map(item=>item.id)).toEqual([run.id]);
    expect(retained.from).toBe(period.from); expect(retained.until).toBe(period.until);
    expect(retained.result).toEqual(run.result);
    expect(await db.select().from(analyticalLineageEdges).where(eq(analyticalLineageEdges.manifestId, run.lineageManifestId))).toHaveLength(5);
    await expect(db.update(processAnalysisRuns).set({ result: missing.result }).where(eq(processAnalysisRuns.id, run.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db; await lockMemoryPrivacy(tx, companyId);
      await eraseAnalyticalSourcesUnderMemory(tx, companyId, "issue", [issueId]);
      await eraseBusinessEventObjectUnderMemory(tx, companyId, "issue", issueId);
    });
    expect(await db.select().from(processAnalysisRuns).where(eq(processAnalysisRuns.id, run.id))).toHaveLength(0);
    expect(await db.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.id, run.lineageManifestId))).toHaveLength(0);
    expect(await db.select().from(processAnalysisDefinitions).where(eq(processAnalysisDefinitions.id, created.root.id))).toHaveLength(1);
    await expect(service().getRun(companyId, actor, created.root.id, run.id)).rejects.toMatchObject({ status: 404 });
  });
  it("denies agent publication, foreign purpose and runs, expired ownership and changed source coverage", async () => {
    const agent = { type: "agent" as const, source: "agent_key" as const, companyId, agentId: randomUUID() };
    await expect(service().create(companyId, agent, { key: "agent_flow", definition: definition() })).rejects.toMatchObject({ status: 403 });
    await expect(service().create(otherCompanyId, actor, { key: "foreign_flow", definition: definition() })).rejects.toMatchObject({ status: 409 });
    await expect(service().create(companyId, actor, { key: "owner_flow", definition: { ...definition(), ownerUserId: "missing-owner" } })).rejects.toMatchObject({ status: 409 });
    const created = await published(); await project();
    const run = await service().run(companyId, actor, created.root.id, { versionId: created.version.id, ...period });
    await expect(service().getRun(otherCompanyId, actor, created.root.id, run.id)).rejects.toMatchObject({ status: 404 });
    await db.insert(activityLog).values({ companyId, actorType: "user", actorId: "private-person", entityType: "issue", entityId: issueId, action: "issue.updated",
      createdAt: new Date("2026-01-01T12:02:00Z"), details: { priority: "high" } });
    await expect(service().getRun(companyId, actor, created.root.id, run.id)).rejects.toMatchObject({ status: 409 });
  });
  it("keeps external/arrival and incomplete lifecycle data inconclusive without weakening the published definition", async () => {
    await project();
    for (const extra of [{ requiresArrivalEvidence: true }, { requiredSourceProviders: ["activity_log", "crm"] }, { objectTypes: ["issue", "project"] as ProcessAnalysisDefinition["objectTypes"] }]) {
      const created = await published({ ...definition(), ...extra });
      const run = await service().run(companyId, actor, created.root.id, { versionId: created.version.id, ...period });
      expect(run.result).toMatchObject({ status: "inconclusive", errorCode: "DATA_NOT_READY", objectSummaries: [] });
    }
  });
  it("freezes material process findings, admits only reviewed lifecycle transitions and erases every descendant with its source", async () => {
    const secondIssueId=randomUUID();await db.insert(issues).values({id:secondIssueId,companyId,projectId,title:"Second native path",status:"done"});
    await db.insert(activityLog).values([
      { companyId,actorType:"user",actorId:"private-person",entityType:"issue",entityId:issueId,action:"issue.updated",createdAt:new Date("2026-01-01T12:00:15Z"),details:{status:"blocked",projectId} },
      { companyId,actorType:"user",actorId:"private-person",entityType:"issue",entityId:issueId,action:"issue.updated",createdAt:new Date("2026-01-01T12:01:15Z"),details:{status:"in_progress",projectId} },
      { companyId,actorType:"user",actorId:"private-person",entityType:"issue",entityId:issueId,action:"issue.updated",createdAt:new Date("2026-01-01T12:02:00Z"),details:{status:"done",projectId} },
      { companyId,actorType:"user",actorId:"private-person",entityType:"issue",entityId:secondIssueId,action:"issue.created",createdAt:new Date("2026-01-01T13:00:00Z"),details:{status:"todo",projectId} },
      { companyId,actorType:"user",actorId:"private-person",entityType:"issue",entityId:secondIssueId,action:"issue.updated",createdAt:new Date("2026-01-01T13:00:30Z"),details:{status:"done",projectId} },
    ]);
    const created=await published({...definition(),analysisFamilies:["event_volume","directly_follows","variants","cycle_time","rework","blocked_time"]});await project();
    const run=await service().run(companyId,actor,created.root.id,{versionId:created.version.id,...period});
    const findings=processFindingService(db),input={findingType:"avoidable_wait" as const,objectType:"issue" as const,variantHash:null,severity:"medium" as const,
      interpretation:"Investigate whether the recorded blocked interval could be reduced"};
    const finding=await findings.create(companyId,actor,created.root.id,run.id,input);
    expect(finding).toMatchObject({status:"OPEN",version:1,eventSetHash:run.eventSetHash,definitionHash:run.definitionHash,
      facts:{observed:{knownBlockedSeconds:45},semantics:"human_process_interpretation_of_observed_facts"}});
    expect(JSON.stringify(finding)).not.toMatch(/private-person|secret body/);
    const [nativeFinding]=await db.select().from(processFindings).where(eq(processFindings.id,finding.id));
    await expect(db.insert(processFindings).values({...nativeFinding,id:randomUUID(),objectType:null,fingerprint:"9".repeat(64)})).rejects.toThrow();
    expect((await findings.create(companyId,actor,created.root.id,run.id,input)).id).toBe(finding.id);
    await expect(findings.create(companyId,actor,created.root.id,run.id,{...input,severity:"high"})).rejects.toMatchObject({status:409});
    const reopen=await findings.create(companyId,actor,created.root.id,run.id,{...input,findingType:"rework",interpretation:"Investigate the observed reopening with a process owner"});
    expect(reopen.facts.observed.reopenCount).toBe(1);
    const bottleneck=await findings.create(companyId,actor,created.root.id,run.id,{...input,findingType:"bottleneck"});
    expect(bottleneck.facts.limitations.join(" ")).toContain("does not establish avoidability or a bottleneck");
    const variantHash=run.result.objectSummaries[0]!.variants[0]!.hash;
    const variant=await findings.create(companyId,actor,created.root.id,run.id,{...input,findingType:"unusual_variant",variantHash});
    expect(variant.facts.observed.variantObjectCount).toBe(1);expect(variant.facts.limitations.join(" ")).toContain("not a statistically established anomaly");
    await expect(findings.create(companyId,actor,created.root.id,run.id,{...input,findingType:"unusual_variant",variantHash:"f".repeat(64)})).rejects.toMatchObject({status:409});
    await expect(findings.transition(companyId,actor,created.root.id,run.id,finding.id,{expectedVersion:1,status:"RESOLVED",reason:"Attempt to skip the accountable investigation"})).rejects.toMatchObject({status:409});
    await expect(db.update(processFindings).set({facts:{observed:{knownBlockedSeconds:0},semantics:"human_process_interpretation_of_observed_facts",limitations:[]}}).where(eq(processFindings.id,finding.id))).rejects.toThrow();
    // A legitimate state change without its human receipt fails at COMMIT.
    await expect(db.update(processFindings).set({status:"ACKNOWLEDGED",version:2}).where(eq(processFindings.id,finding.id))).rejects.toThrow();
    await expect(db.delete(processFindingTransitions).where(eq(processFindingTransitions.findingId,finding.id))).rejects.toThrow();
    for(const [version,status] of [[1,"ACKNOWLEDGED"],[2,"INVESTIGATING"],[3,"RESOLVED"]] as const) {
      expect((await findings.transition(companyId,actor,created.root.id,run.id,finding.id,{expectedVersion:version,status,reason:"Human review of the retained process evidence"})).version).toBe(version+1);
    }
    await expect(findings.transition(companyId,actor,created.root.id,run.id,finding.id,{expectedVersion:4,status:"OPEN",reason:"Attempt to silently reopen frozen resolution"})).rejects.toMatchObject({status:409});
    const detail=await findings.detail(companyId,actor,created.root.id,run.id,finding.id);
    expect(detail.transitions).toHaveLength(4);expect(detail.finding.resolvedAt).not.toBeNull();
    expect((await findings.list(companyId,actor,created.root.id,run.id)).items).toHaveLength(4);
    await db.transaction(async tx=>{await lockMemoryPrivacy(tx as unknown as typeof db,companyId);await eraseBusinessEventObjectUnderMemory(tx as unknown as typeof db,companyId,"issue",issueId);});
    expect(await db.select().from(processFindings).where(eq(processFindings.analysisRunId,run.id))).toHaveLength(0);
    expect(await db.select().from(processFindingTransitions).where(eq(processFindingTransitions.findingId,finding.id))).toHaveLength(0);
    expect(await db.select().from(issues).where(eq(issues.id,secondIssueId))).toHaveLength(1);
  });
  it("keeps missing-data findings separate from statistics and rechecks company, agent and changed current source authority", async () => {
    await project();const created=await published({...definition(),requiresArrivalEvidence:true});
    const run=await service().run(companyId,actor,created.root.id,{versionId:created.version.id,...period}),findings=processFindingService(db);
    const input={findingType:"missing_process_data" as const,objectType:null,variantHash:null,severity:"medium" as const,interpretation:"Review unknown source arrival evidence before using process statistics"};
    const finding=await findings.create(companyId,actor,created.root.id,run.id,input);
    expect(finding.facts.observed.late_arrival_rate).toBe("unknown");
    await expect(findings.create(companyId,actor,created.root.id,run.id,{...input,findingType:"rework",objectType:"issue"})).rejects.toMatchObject({status:409});
    await expect(findings.detail(otherCompanyId,actor,created.root.id,run.id,finding.id)).rejects.toMatchObject({status:404});
    const agent={type:"agent" as const,source:"agent_key" as const,companyId,agentId:randomUUID()};
    await expect(findings.detail(companyId,agent,created.root.id,run.id,finding.id)).rejects.toMatchObject({status:403});
    await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,issueId));
    await expect(findings.detail(companyId,actor,created.root.id,run.id,finding.id)).rejects.toMatchObject({status:409});
  });
  it("does not reuse an old analytical purpose after the current policy is superseded", async () => {
    const created=await published();await project();
    const run=await service().run(companyId,actor,created.root.id,{versionId:created.version.id,...period});
    const changed=analyticalPurpose();changed.citation="Native process test purpose";
    changed.analyticalPurpose!.purpose="process_intelligence";changed.analyticalPurpose!.capabilities=["metrics"];
    await aiGovernanceService(db).obligation(actor,companyId,changed);
    await expect(service().getRun(companyId,actor,created.root.id,run.id)).rejects.toMatchObject({status:409});
    await expect(service().run(companyId,actor,created.root.id,{versionId:created.version.id,...period})).rejects.toMatchObject({status:409});
    expect((await service().list(companyId,actor)).items).toEqual([]);
  });
  it("withdraws definitions with flags off and removes expired runs without rollout or company-status admission", async () => {
    const created = await published({ ...definition(), retentionDays: 1 }); await project();
    const run = await service().run(companyId, actor, created.root.id, { versionId: created.version.id, ...period });
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ process_intelligence_v8: false });
    await db.update(companies).set({ status: "paused" }).where(eq(companies.id, companyId));
    await expect(service().detail(companyId, actor, created.root.id)).rejects.toMatchObject({ status: 404 });
    expect((await service().retire(companyId, actor, created.root.id, { expectedRevision: 2, rationale: "Human withdrawal after rollout rollback" })).status).toBe("retired");
    const later = new Date(Date.parse(run.createdAt) + 2 * 86400000);
    expect((await eraseExpiredAnalyticalLineage(db, later)).erasedManifests).toBeGreaterThan(0);
    expect(await db.select().from(processAnalysisRuns).where(eq(processAnalysisRuns.id, run.id))).toHaveLength(0);
    expect((await service().sweepExpired(later)).erasedDefinitions).toBeGreaterThan(0);
    expect(await db.select().from(processAnalysisDefinitions).where(eq(processAnalysisDefinitions.id, created.root.id))).toHaveLength(0);
    expect(await db.select().from(issues).where(eq(issues.id, issueId))).toHaveLength(1);
  });
  it("requires matching native publication and lineage at the database boundary", async () => {
    const created = await published(); await project();
    const run = await service().run(companyId, actor, created.root.id, { versionId: created.version.id, ...period });
    const [row] = await db.select().from(processAnalysisRuns).where(eq(processAnalysisRuns.id, run.id));
    await expect(db.insert(processAnalysisRuns).values({ ...row, id: randomUUID(), lineageManifestId: randomUUID() })).rejects.toMatchObject({ cause: { code: "23514" } });
    await db.delete(analyticalLineageEdges).where(and(eq(analyticalLineageEdges.manifestId,run.lineageManifestId),eq(analyticalLineageEdges.inputType,"business_event_source")));
    await expect(service().getRun(companyId,actor,created.root.id,run.id)).rejects.toMatchObject({status:409});
    await db.execute(sql`delete from analytical_lineage_manifests where id=${run.lineageManifestId}::uuid`);
    expect(await db.select().from(processAnalysisRuns).where(eq(processAnalysisRuns.id, run.id))).toHaveLength(0);
  });
  it("waits for Memory before reading retained run rows and cannot revive a result erased during the wait", async () => {
    const created=await published(); await project();
    const run=await service().run(companyId,actor,created.root.id,{versionId:created.version.id,...period});
    let held!:()=>void,release!:()=>void;
    const locked=new Promise<void>(resolve=>{held=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
    const erasing=db.transaction(async rawTx=>{
      const tx=rawTx as unknown as typeof db; await lockMemoryPrivacy(tx,companyId); held(); await gate;
      await eraseAnalyticalSourcesUnderMemory(tx,companyId,"issue",[issueId]);
      await eraseBusinessEventObjectUnderMemory(tx,companyId,"issue",issueId);
    });
    await locked; let settled=false;
    const reading=service().getRun(companyId,actor,created.root.id,run.id).then(value=>({value}),error=>({error})).finally(()=>{settled=true;});
    try { await waitForBlockedRead("pg_advisory_xact_lock");expect(settled).toBe(false); }
    finally {release();}
    await erasing;expect(await reading).toMatchObject({error:{status:404}});
  });
  it("replays post-backup source suppression into a separate restored native database before any result becomes readable", async () => {
    const created=await published();await project();
    const run=await service().run(companyId,actor,created.root.id,{versionId:created.version.id,...period});
    const [definitionRow]=await db.select().from(processAnalysisDefinitions).where(eq(processAnalysisDefinitions.id,created.root.id));
    const [runRow]=await db.select().from(processAnalysisRuns).where(eq(processAnalysisRuns.id,run.id));
    const name=`aw_restore_process_${randomUUID().replaceAll("-","")}`,target=new URL(database.connectionString);target.pathname=`/${name}`;
    await db.execute(sql`create database ${sql.identifier(name)}`);const restored=createDb(target.toString());
    try {
      await applyPendingMigrations(target.toString());
      await restored.insert(companies).values(await db.select().from(companies).where(eq(companies.id,companyId)));
      await restored.insert(governanceObligations).values(await db.select().from(governanceObligations).where(eq(governanceObligations.companyId,companyId)));
      await restored.insert(projects).values(await db.select().from(projects).where(eq(projects.id,projectId)));
      await restored.insert(issues).values(await db.select().from(issues).where(eq(issues.id,issueId)));
      await restored.insert(activityLog).values(await db.select().from(activityLog).where(eq(activityLog.companyId,companyId)));
      await restored.insert(businessEvents).values(await db.select().from(businessEvents).where(eq(businessEvents.companyId,companyId)));
      await restored.insert(businessEventObjects).values(await db.select().from(businessEventObjects).where(eq(businessEventObjects.companyId,companyId)));
      await restored.insert(processAnalysisDefinitions).values({...definitionRow,publishedVersionId:null,status:"draft"});
      await restored.insert(processAnalysisVersions).values(await db.select().from(processAnalysisVersions).where(eq(processAnalysisVersions.definitionId,created.root.id)));
      await restored.insert(processAnalysisPublications).values(await db.select().from(processAnalysisPublications).where(eq(processAnalysisPublications.definitionId,created.root.id)));
      await restored.update(processAnalysisDefinitions).set({status:"published",publishedVersionId:created.version.id}).where(eq(processAnalysisDefinitions.id,created.root.id));
      await restored.insert(analyticalLineageManifests).values(await db.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,run.lineageManifestId)));
      await restored.insert(analyticalLineageEdges).values(await db.select().from(analyticalLineageEdges).where(eq(analyticalLineageEdges.manifestId,run.lineageManifestId)));
      await restored.insert(processAnalysisRuns).values({...runRow,from:sql`${period.from}::timestamptz`,until:sql`${period.until}::timestamptz`});
      const [source]=await db.select({id:activityLog.id}).from(activityLog).where(and(eq(activityLog.companyId,companyId),eq(activityLog.action,"issue.created")));
      await prepareRestoredQuarantine(restored,target.toString(),{companies:[],memory:[],analyticalSources:[],businessEvents:[{company_id:companyId,source_ref:source.id,suppressed_at:new Date().toISOString()}]});
      await expect(assertDatabaseRestoreAdmission(restored)).rejects.toThrow("remains quarantined");
      expect((await instanceSettingsService(restored).getExperimental()).process_intelligence_v8).toBe(false);
      expect(await restored.select().from(processAnalysisRuns).where(eq(processAnalysisRuns.id,run.id))).toHaveLength(0);
      expect(await restored.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,run.lineageManifestId))).toHaveLength(0);
      await instanceSettingsService(restored,{runtimeEnv:{}}).updateExperimental(flags);
      await expect(processAnalysisService(restored).getRun(companyId,actor,created.root.id,run.id)).rejects.toMatchObject({status:404});
    } finally {await restored.$client.end({timeout:1});await db.execute(sql`drop database ${sql.identifier(name)}`);}
  },30000);
  it("does not certify a subset when a backdated native source arrives during object authorization", async () => {
    const created=await published();await project();
    let held!:()=>void,release!:()=>void;
    const locked=new Promise<void>(resolve=>{held=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
    const appending=db.transaction(async rawTx=>{
      const tx=rawTx as unknown as typeof db;
      await tx.select({id:projects.id}).from(projects).where(eq(projects.id,projectId)).for("update");held();await gate;
      await tx.insert(activityLog).values({companyId,actorType:"user",actorId:"private-person",entityType:"issue",entityId:issueId,action:"issue.updated",
        createdAt:new Date("2026-01-01T12:02:00Z"),details:{priority:"high"}});
    });
    await locked;let settled=false;
    const calculating=service().run(companyId,actor,created.root.id,{versionId:created.version.id,...period}).finally(()=>{settled=true;});
    try {await waitForBlockedRead('from "projects"');expect(settled).toBe(false);}
    finally {release();}
    await appending;const run=await calculating;
    expect(run.result).toMatchObject({status:"inconclusive",errorCode:"DATA_NOT_READY",objectSummaries:[],readiness:{coverage:"bounded_incomplete_snapshot"}});
  });
});
