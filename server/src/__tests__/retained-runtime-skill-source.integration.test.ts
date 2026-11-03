import {randomUUID} from "node:crypto";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {and,eq,sql} from "drizzle-orm";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {agents,authUsers,companyMemberships,principalPermissionGrants,companySkills,companySkillVersions,heartbeatRuns,issues,
 agentExecutionManifests,agentExecutionManifestItems,contextManifests,contextManifestMemoryRoots,memoryBindings,memoryRecords,memoryEvidence,
 learningCycles,learningEvidence,learningHypotheses,learningEvaluations,learningDomainCandidates,createDb,
 EMBEDDED_POSTGRES_TEST_TIMEOUT_MS} from "@paperclipai/db";
import {agentExecutionManifestSchema} from "@paperclipai/shared";
import {startEmbeddedPostgresTestDatabase} from "./helpers/embedded-postgres.js";
import {enableV5ForTest,seedV5Presences} from "./helpers/v5-fixtures.js";
import {preparePlatformSkillAdmission} from "../services/platform-skill-admission.js";
import {blenteraPlatformContractHashes} from "../services/tool-gateway.js";
import type {AuthorizationActor} from "../services/authorization.js";
import {grantsForHumanRole} from "../services/company-member-roles.js";
import {hashContextPolicySnapshot} from "../services/context/context-manifest.js";
import {removeRuntimeStorageTree} from "../services/runtime-skill-cache.js";
import {materializeAsset} from "../services/native-runtime/runtime-context.js";
import {nativeRuntimeContextFixture} from "../services/native-runtime/runtime-context.test-fixture.js";
import {buildNativeExecutionInput} from "../services/native-runtime/native-execution-input.js";
import {canonicalNativeRuntimeContextDigest} from "../vendor/paperclip-runner/index.js";
import {assertRetainedRuntimeSkillSourceCurrent,assertRuntimeSkillSourceRetained} from "../services/learning/learning-assets.js";

describe("retained runtime Skill separates producer proof from its current reader",()=>{
 let database:Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,db:ReturnType<typeof createDb>,root:string;
 const previousHome=process.env.PAPERCLIP_HOME;
 beforeAll(async()=>{
  database=await startEmbeddedPostgresTestDatabase("native-retained-runtime-skill-");db=createDb(database.connectionString,{maxConnections:4});
  root=await mkdtemp(join(tmpdir(),"native-retained-skill-assets-"));process.env.PAPERCLIP_HOME=root;await enableV5ForTest(db);
 },EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
 afterAll(async()=>{await db?.$client.end({timeout:0});await database?.cleanup();await removeRuntimeStorageTree(root);
  if(previousHome===undefined)delete process.env.PAPERCLIP_HOME;else process.env.PAPERCLIP_HOME=previousHome;
 },30000);
 const digest=async(value:unknown)=>{const [row]=await db.execute<{digest:string}>(sql`select encode(sha256(convert_to((${JSON.stringify(value)}::jsonb)::text,'UTF8')),'hex') as digest`);return row!.digest;};
 async function fixture(options:{omitManifestItem?:boolean;wrongContextRun?:boolean}={}){
  const f=await seedV5Presences(db),runId=randomUUID(),issueId=randomUUID(),skillId=randomUUID(),versionId=randomUUID(),bob=randomUUID(),manifestId=randomUUID();
  await db.insert(authUsers).values({id:bob,name:"Other current reader",email:`${bob}@test.invalid`,createdAt:new Date(),updatedAt:new Date()});
  await db.insert(companyMemberships).values({companyId:f.home,principalType:"user",principalId:bob,status:"active",membershipRole:"member"});
  await db.insert(principalPermissionGrants).values(grantsForHumanRole("operator").map(grant=>({companyId:f.home,principalType:"user",principalId:bob,...grant})));
  await db.insert(issues).values({id:issueId,companyId:f.home,title:"Producer Task",createdByUserId:f.userId});
  const key=`company/${f.home}/${skillId}`,body="Reviewed company procedure.\n";
  await db.insert(companySkills).values({id:skillId,companyId:f.home,key,slug:skillId,name:"Retained company procedure",markdown:body,
   sourceType:"url",sourceLocator:"https://example.test/procedure",compatibility:"compatible",lifecycleState:"active",sharingScope:"company"});
  await db.insert(companySkillVersions).values({id:versionId,companyId:f.home,companySkillId:skillId,revisionNumber:1,state:"active",
   visibility:"company",fileInventory:[{path:"SKILL.md",kind:"skill",content:body}],authorUserId:f.userId});
  await db.update(companySkills).set({activeVersionId:versionId,currentVersionId:versionId,headVersionId:versionId}).where(eq(companySkills.id,skillId));
  const bundle=await materializeAsset([{path:"SKILL.md",content:Buffer.from(body),mode:0o444}],{companyId:f.home,runId});
  const instructions=await materializeAsset([{path:"AGENTS.md",content:Buffer.from("Run instructions."),mode:0o444}],{companyId:f.home,runId});
  const runtime=nativeRuntimeContextFixture();runtime.instructions.bundle=instructions;runtime.skills=[{key,runtimeName:skillId,versionId,bundle}];
  runtime.aggregateDigest=canonicalNativeRuntimeContextDigest(runtime);
  const execution=buildNativeExecutionInput({companyId:f.home,runId,agentId:f.presence.id,issue:{id:issueId,identifier:null,title:"Producer",description:null,workMode:"standard"},
   taskPrompt:"Use the exact retained procedure.",workspace:{id:randomUUID(),cwd:join(root,runId),repoUrl:null,repoRef:null,branchName:null},normalizedSessionId:randomUUID(),
   completionContract:{id:randomUUID(),sha256:`sha256:${"a".repeat(64)}`,schemaVersion:"paperclip.run-result.v1",contract:{revision:"1",objective:"Deliver reviewed output",criteria:[{id:"output",requirement:"Deliver reviewed output"}]}},runtimeContext:runtime});
  const source={kind:"runtime_skill" as const,key,versionId,bundleDigest:bundle.digest,manifestDigest:bundle.manifestDigest};
  const receiptBody={version:1,binding:{companyId:f.home,runId,agentId:f.presence.id,responsibleUserId:f.userId,issueId},
   bootstrap:{executionInputDigest:await digest(execution),policy:{issueIds:[],projectIds:[],runIds:[],memoryIds:[],foundationRevisionIds:[]},inputs:[source]},dispatches:[],additionalInputs:[]};
  const receipt={...receiptBody,digest:await digest(receiptBody)};
  await db.insert(heartbeatRuns).values({id:runId,companyId:f.home,agentId:f.presence.id,status:"running",runtimeMode:"native",runtimeModeResolvedAt:new Date(),
   scopeKind:"issue",nativeIssueId:issueId,responsibleUserId:f.userId,nativeInputSourceProtocolVersion:1,
   contextSnapshot:{issueId,v5ExecutionManifestId:manifestId},runnerProfileJson:{nativeExecutionInput:execution,nativeInputSourceReceipt:receipt}});
  const contextRunId=options.wrongContextRun?randomUUID():runId;
  if(options.wrongContextRun)await db.insert(heartbeatRuns).values({id:contextRunId,companyId:f.home,agentId:f.presence.id,status:"running",runtimeMode:"native",nativeIssueId:issueId,responsibleUserId:f.userId});
  const [context]=await db.insert(contextManifests).values({companyId:f.home,runId:contextRunId,agentId:f.presence.id,issueId,queryHash:"1".repeat(64),policySnapshotHash:"2".repeat(64)}).returning();
  const manifest=agentExecutionManifestSchema.parse({schemaVersion:5,runId,companyId:f.home,agentId:f.presence.id,agentIdentityId:f.identity.id,homeCompanyId:f.home,responsibleUserId:f.userId,
   executionScope:{primaryCompanyId:f.home,primaryAgentPresenceId:f.presence.id,delegatedScopes:[]},rolePack:null,contextManifests:[{companyId:f.home,contextManifestId:context!.id}],
   skills:[{skillId,versionId,key,name:"Retained procedure",selection:"required",loadPoint:"always",estimatedDescriptorTokens:5}],playbooks:[],capabilities:[],
   providers:[{companyId:f.home,agentId:f.presence.id,providerBindingId:randomUUID(),profileRef:"software-fixture",snapshotHash:"3".repeat(64),isolationMode:"isolated_per_presence"}],
   executionPolicy:{deterministicPreference:true,policies:[],approvalRefs:[],restrictions:[],policySnapshotHash:"2".repeat(64)},inventoryEstimatedTokens:5,warnings:[]});
  const [stored]=await db.insert(agentExecutionManifests).values({id:manifestId,companyId:f.home,runId,agentId:f.presence.id,agentIdentityId:f.identity.id,contextManifestId:context!.id,
   manifest,policySnapshotHash:manifest.executionPolicy.policySnapshotHash,hash:hashContextPolicySnapshot(manifest)}).returning();
  if(!options.omitManifestItem)await db.insert(agentExecutionManifestItems).values({companyId:f.home,manifestId:stored!.id,type:"skill",ref:skillId,versionRef:versionId});
  await db.update(heartbeatRuns).set({status:"succeeded",finishedAt:new Date()}).where(eq(heartbeatRuns.id,runId));
  const owner={type:"board" as const,source:"session" as const,userId:f.userId},reader={...owner,userId:bob};
  const read=(actor:AuthorizationActor=reader,overrides:Partial<Parameters<typeof assertRetainedRuntimeSkillSourceCurrent>[1]>={})=>assertRetainedRuntimeSkillSourceCurrent(db,{companyId:f.home,actor,producerRunId:runId,source,...overrides});
  return {...f,runId,issueId,skillId,versionId,source,bundle,contextId:context!.id,manifestId:stored!.id,owner,reader,read};
 }
 it("lets another legitimate Human read a company-public copy after its producer completed",async()=>{
  const f=await fixture();await expect(f.read()).resolves.toMatchObject({skill:{id:f.skillId},producer:{skillId:f.skillId}});
  await expect(f.read(f.owner)).resolves.toBeTruthy();
  await expect(assertRuntimeSkillSourceRetained(db,f.home,f.reader,f.skillId,f.versionId)).rejects.toMatchObject({status:403});
 });
 it("reads the actual bundled platform admission after a Fabric-off producer completed",async()=>{
  const f=await fixture(),runId=randomUUID();
  await db.update(agents).set({adapterType:"paperclip_runner"}).where(eq(agents.id,f.presence.id));
  await db.insert(heartbeatRuns).values({id:runId,companyId:f.home,agentId:f.presence.id,status:"running",runtimeMode:"native",runtimeModeResolvedAt:new Date(),
   scopeKind:"issue",nativeIssueId:f.issueId,responsibleUserId:f.userId,nativeInputSourceProtocolVersion:1});
  const platform=await preparePlatformSkillAdmission(db,{companyId:f.home,agentId:f.presence.id,runId,responsibleUserId:f.userId,requireExisting:false},blenteraPlatformContractHashes());
  const [version]=await db.select().from(companySkillVersions).where(eq(companySkillVersions.id,platform.pin.versionId));
  const bundle=await materializeAsset(version!.fileInventory.map(file=>({path:file.path,content:Buffer.from(file.content),mode:0o444})),{companyId:f.home,runId});
  const runtime=nativeRuntimeContextFixture();runtime.instructions.bundle=await materializeAsset([{path:"AGENTS.md",content:Buffer.from("Platform fixture"),mode:0o444}],{companyId:f.home,runId});
  runtime.skills=[{key:"blentera-platform",runtimeName:"blentera-platform",versionId:platform.pin.versionId,bundle}];runtime.aggregateDigest=canonicalNativeRuntimeContextDigest(runtime);
  const execution=buildNativeExecutionInput({companyId:f.home,runId,agentId:f.presence.id,issue:{id:f.issueId,identifier:null,title:"Platform producer",description:null,workMode:"standard"},
   taskPrompt:"Read platform procedure",workspace:{id:randomUUID(),cwd:join(root,runId),repoUrl:null,repoRef:null,branchName:null},normalizedSessionId:randomUUID(),
   completionContract:{id:randomUUID(),sha256:`sha256:${"a".repeat(64)}`,schemaVersion:"paperclip.run-result.v1",contract:{revision:"1",objective:"Deliver reviewed output",criteria:[{id:"output",requirement:"Deliver reviewed output"}]}},runtimeContext:runtime});
  const source={kind:"runtime_skill" as const,key:"blentera-platform",versionId:platform.pin.versionId,bundleDigest:bundle.digest,manifestDigest:bundle.manifestDigest};
  const receiptBody={version:1,binding:{companyId:f.home,runId,agentId:f.presence.id,responsibleUserId:f.userId,issueId:f.issueId},
   bootstrap:{executionInputDigest:await digest(execution),policy:{issueIds:[],projectIds:[],runIds:[],memoryIds:[],foundationRevisionIds:[]},inputs:[source]},dispatches:[],additionalInputs:[]};
  const [run]=await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,runId));
  await db.update(heartbeatRuns).set({nativeInputSourceProtocolVersion:1,runnerProfileJson:{...run!.runnerProfileJson,nativeExecutionInput:execution,nativeInputSourceReceipt:{...receiptBody,digest:await digest(receiptBody)}}}).where(eq(heartbeatRuns.id,runId));
  await db.update(heartbeatRuns).set({status:"succeeded",finishedAt:new Date()}).where(eq(heartbeatRuns.id,runId));
  await expect(assertRetainedRuntimeSkillSourceCurrent(db,{companyId:f.home,actor:f.reader,producerRunId:runId,source})).resolves.toMatchObject({producer:{platform:true,contextId:null}});
  await db.update(heartbeatRuns).set({contextSnapshot:{issueId:f.issueId,v5ExecutionManifestId:randomUUID()}}).where(eq(heartbeatRuns.id,runId));
  await expect(assertRetainedRuntimeSkillSourceCurrent(db,{companyId:f.home,actor:f.reader,producerRunId:runId,source})).rejects.toMatchObject({status:403});
 });
 it("denies an unbound producer, foreign company, forged bundle and missing manifest pin",async()=>{
  const f=await fixture();await expect(f.read(f.reader,{producerRunId:randomUUID()})).rejects.toMatchObject({status:403});
  await expect(f.read(f.reader,{companyId:f.guest})).rejects.toMatchObject({status:404});
  await expect(f.read(f.reader,{source:{...f.source,bundleDigest:"f".repeat(64)}})).rejects.toMatchObject({status:403});
  await expect(db.delete(agentExecutionManifestItems).where(eq(agentExecutionManifestItems.manifestId,f.manifestId))).rejects.toMatchObject({cause:{code:"23514"}});
  await expect(db.delete(agentExecutionManifests).where(eq(agentExecutionManifests.id,f.manifestId))).rejects.toMatchObject({cause:{code:"23514"}});
  await expect(f.read()).resolves.toBeTruthy();
  const missing=await fixture({omitManifestItem:true}),swapped=await fixture({wrongContextRun:true});
  await expect(missing.read()).rejects.toMatchObject({status:403});
  await expect(swapped.read()).rejects.toMatchObject({status:403});
 });
 it("retains only its exact superseded version and rejects a swapped active version",async()=>{
  const f=await fixture(),next=randomUUID();
  await db.insert(companySkillVersions).values({id:next,companyId:f.home,companySkillId:f.skillId,revisionNumber:2,state:"candidate",visibility:"company",fileInventory:[{path:"SKILL.md",kind:"skill",content:"New reviewed version"}]});
  await db.update(companySkillVersions).set({state:"superseded"}).where(eq(companySkillVersions.id,f.versionId));
  await db.update(companySkillVersions).set({state:"active"}).where(eq(companySkillVersions.id,next));
  await db.update(companySkills).set({activeVersionId:next,currentVersionId:next,headVersionId:next}).where(eq(companySkills.id,f.skillId));
  await expect(f.read()).resolves.toBeTruthy();
  await expect(f.read(f.reader,{source:{...f.source,versionId:next}})).rejects.toMatchObject({status:403});
 });
 it("uses the actual current reader for private Learning roots and fails after source erasure",async()=>{
  const f=await fixture(),privateIssue=randomUUID();
  await db.insert(issues).values({id:privateIssue,companyId:f.home,title:"Private original outcome",status:"done",completedAt:new Date(),visibility:"private",responsibleUserId:f.userId,createdByUserId:f.userId});
  const [task]=await db.select().from(issues).where(eq(issues.id,privateIssue));
  const [binding]=await db.insert(memoryBindings).values({companyId:f.home,key:randomUUID(),name:"Learned source",providerKey:"local"}).returning();
  const [memory]=await db.insert(memoryRecords).values({companyId:f.home,bindingId:binding!.id,providerKey:"local",memoryType:"outcome",scopeType:"company",content:"Private learned outcome",
   observedAt:new Date(),createdByActorType:"user",createdByActorId:f.userId,sourceProvenanceQualified:true,sourceIssueIds:[privateIssue],verificationState:"human_verified",reviewState:"accepted",retentionState:"active"}).returning();
  await db.insert(memoryEvidence).values({companyId:f.home,memoryRecordId:memory!.id,sourceClass:"task",sourceProvider:"august_works_tasks",sourceType:"issue",sourceRef:`issue://${privateIssue}`,
   sourceVersion:task!.updatedAt.toISOString(),sourceUpdatedAt:task!.updatedAt,observedAt:new Date(),excerptHash:"a".repeat(64),citationJson:{label:"Private outcome"},trustLevel:"high",supportsOrContradicts:"supports"});
  const [cycle]=await db.insert(learningCycles).values({companyId:f.home,scopeType:"company",purpose:"native_task_execution",trigger:"Verified outcome",maxHypotheses:2,maxEvaluations:2,outcomeVersions:{},createdBy:f.userId}).returning();
  await db.insert(learningEvidence).values({companyId:f.home,cycleId:cycle!.id,memoryRecordId:memory!.id,sourceVersion:memory!.updatedAt.toISOString()});
  const [hypothesis]=await db.insert(learningHypotheses).values({companyId:f.home,cycleId:cycle!.id,claim:"Learned procedure",predictedEffect:"Better review",targetDomain:"skill",targetId:f.skillId,riskClass:"low"}).returning();
  const [evaluation]=await db.insert(learningEvaluations).values({companyId:f.home,hypothesisId:hypothesis!.id,method:"manual_review",result:"passed",cases:[],outcomeVersions:{[privateIssue]:task!.updatedAt.toISOString()},metrics:{},limitations:[],reviewedBy:f.userId}).returning();
  await db.insert(learningDomainCandidates).values({companyId:f.home,hypothesisId:hypothesis!.id,evaluationId:evaluation!.id,targetDomain:"skill",targetId:f.skillId,candidateId:f.versionId,candidateHash:hashContextPolicySnapshot([{path:"SKILL.md",content:"Reviewed company procedure.\n"}])});
  await db.insert(contextManifestMemoryRoots).values({companyId:f.home,manifestId:f.contextId,memoryRecordId:memory!.id,sourceVersion:memory!.updatedAt.toISOString()});
  await expect(f.read(f.owner)).resolves.toBeTruthy();await expect(f.read()).rejects.toMatchObject({status:404});
  await db.delete(memoryRecords).where(eq(memoryRecords.id,memory!.id));
  await expect(f.read(f.owner)).rejects.toThrow();
 });
 it("denies lost company access and erased immutable bundle bytes",async()=>{
  const f=await fixture();await db.update(companyMemberships).set({status:"inactive"}).where(and(eq(companyMemberships.companyId,f.home),eq(companyMemberships.principalId,f.reader.userId)));
  await expect(f.read()).rejects.toMatchObject({status:403});
  await removeRuntimeStorageTree(f.bundle.rootPath);await expect(f.read(f.owner)).rejects.toThrow();
 });
});
