# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-chat-sessions.spec.ts >> an owner can explicitly recover after source visibility is lost while original metric facts survive
- Location: tests/e2e/agent-chat-sessions.spec.ts:214:1

# Error details

```
Error: Native task source access is unavailable
```

# Page snapshot

```yaml
- generic [ref=e4]:
  - link "Skip to Main Content" [ref=e5] [cursor=pointer]:
    - /url: "#main-content"
  - generic [ref=e6]:
    - generic [ref=e7]:
      - generic [ref=e8]:
        - complementary [ref=e10]:
          - button "Open Agent Chat 1793049333900 organization switcher" [ref=e12]:
            - generic [ref=e13]:
              - generic [ref=e14]: A
              - generic "Agent Chat 1793049333900" [ref=e17]
          - navigation [ref=e18]:
            - generic [ref=e19]:
              - button "New Task" [ref=e20]
              - link "Search" [ref=e25] [cursor=pointer]:
                - /url: /AGE/search
              - link "Overview" [ref=e31] [cursor=pointer]:
                - /url: /AGE/dashboard
              - link "Agents" [ref=e39] [cursor=pointer]:
                - /url: /AGE/agents
              - link "Inbox" [ref=e47] [cursor=pointer]:
                - /url: /AGE/inbox
            - generic [ref=e53]:
              - generic [ref=e55]:
                - button "Collapse Work" [expanded] [ref=e56]
                - generic [ref=e59]: Work
              - generic [ref=e62]:
                - link "Tasks" [ref=e63] [cursor=pointer]:
                  - /url: /AGE/issues
                - link "Routines" [ref=e69] [cursor=pointer]:
                  - /url: /AGE/routines
                - link "Management reviews" [ref=e77] [cursor=pointer]:
                  - /url: /AGE/management-reviews
                - link "Business metrics" [ref=e83] [cursor=pointer]:
                  - /url: /AGE/business-metrics
                - link "AI Governance" [ref=e90] [cursor=pointer]:
                  - /url: /AGE/ai-governance
                - link "Projects" [ref=e95] [cursor=pointer]:
                  - /url: /AGE/projects
                - link "Artifacts" [ref=e100] [cursor=pointer]:
                  - /url: /AGE/artifacts
            - generic [ref=e107]:
              - link "Connections" [ref=e108] [cursor=pointer]:
                - /url: /AGE/apps
              - link "Governance" [ref=e118] [cursor=pointer]:
                - /url: /AGE/governance
            - generic [ref=e124]:
              - generic [ref=e126]:
                - button "Collapse Advanced" [expanded] [ref=e127]
                - generic [ref=e130]: Advanced
              - generic [ref=e133]:
                - link "Skills" [ref=e134] [cursor=pointer]:
                  - /url: /AGE/skills
                - link "Audit" [ref=e147] [cursor=pointer]:
                  - /url: /AGE/activity
            - region "Chats" [ref=e154]:
              - generic [ref=e155]:
                - generic [ref=e156]: Chats
                - button "Chat with an agent" [ref=e157]
              - generic [ref=e158]:
                - link "Alpha" [ref=e159] [cursor=pointer]:
                  - /url: /AGE/chats/alpha
                - button "Star Alpha" [ref=e165]
        - button "Open account menu" [ref=e168]:
          - generic [ref=e169]: AR
          - generic [ref=e171]: Authenticated agent-chat reviewer
      - separator "Resize sidebar" [ref=e172]
    - generic [ref=e174]:
      - region "Global utilities" [ref=e176]:
        - generic [ref=e179]:
          - generic [ref=e180]: Language
          - combobox "Language" [ref=e181]:
            - option "English" [selected]
            - option "Dansk"
        - link "Help / Support" [ref=e182] [cursor=pointer]:
          - /url: /AGE/company/help
        - link "Contact support" [ref=e183] [cursor=pointer]:
          - /url: mailto:support@blentera.com
        - link "User account" [ref=e184] [cursor=pointer]:
          - /url: /AGE/company/settings/instance/profile
      - generic [ref=e188]:
        - generic [ref=e189]:
          - generic [ref=e190]:
            - navigation "breadcrumb" [ref=e192]:
              - list [ref=e193]:
                - listitem [ref=e194]:
                  - link "AL Alpha" [disabled] [ref=e195]:
                    - generic [ref=e196]: AL
                    - generic [ref=e199]: Alpha
                  - link "Configure Alpha" [ref=e201] [cursor=pointer]:
                    - /url: /AGE/agents/9609fb44-60d2-4fd4-a991-b86b2efaafa1/runtime
            - button "Hide properties" [ref=e202]
          - main [active] [ref=e203]:
            - tabpanel [ref=e206]:
              - generic [ref=e208]:
                - generic [ref=e213]:
                  - generic [ref=e216]:
                    - paragraph [ref=e219]: Private analytical history before source visibility changes
                    - generic [ref=e220]: 9:15 PM
                  - generic [ref=e222]:
                    - generic [ref=e224]:
                      - generic [ref=e225]:
                        - generic [ref=e226]: Alpha
                        - generic [ref=e230]: Worked for 13s
                      - button "Expand read files (2 activities)" [ref=e235]:
                        - generic "Read files" [ref=e240]
                    - paragraph [ref=e246]: "Reply generation 0: Private analytical history before source visibility changes"
                    - generic [ref=e247]:
                      - generic [ref=e248]: 9:15 PM
                      - generic [ref=e249]:
                        - button "Copy message" [ref=e250]
                        - button "Helpful" [ref=e254]
                        - button "Needs work" [ref=e257]
                  - generic [ref=e261]:
                    - paragraph [ref=e264]: fixture:eyJhY3Rpb24iOiJtZXRyaWMiLCJtZXRyaWNJZCI6IjkwYjkzNjY4LWMxOGMtNDU4Ny04ZTUyLTIzZmEzNjk4YzJiMyIsInZlcnNpb25JZCI6ImU3ZDU4MTgyLWVhMDYtNDA3NS04ZjhhLTUyNGYxMzMwMDJjOCIsImZyb20iOiIyMDI2LTEwLTI1VDIxOjE1OjUwLjE3MloiLCJ1bnRpbCI6IjIwMjYtMTAtMjZUMjE6MTU6NTEuMTcyWiJ9
                    - generic [ref=e265]: 9:15 PM
                  - generic [ref=e267]:
                    - generic [ref=e269]:
                      - generic [ref=e270]:
                        - generic [ref=e271]: Alpha
                        - generic [ref=e275]: Worked for 28s
                      - button "Expand read files, searched files (3 activities)" [ref=e280]:
                        - generic "Read files, searched files" [ref=e287]
                    - paragraph [ref=e293]: Observed a current native business metric.
                    - generic [ref=e294]:
                      - generic [ref=e295]: 9:16 PM
                      - generic [ref=e296]:
                        - button "Copy message" [ref=e297]
                        - button "Helpful" [ref=e301]
                        - button "Needs work" [ref=e304]
                - generic [ref=e310]:
                  - generic [ref=e314]:
                    - textbox "editable markdown" [ref=e316]:
                      - paragraph [ref=e317]
                    - generic:
                      - paragraph: Message Alpha — describe what you want done…
                  - generic [ref=e318]:
                    - button "Attach file" [ref=e319]
                    - button "Auto mode" [ref=e321]
                    - button "Send" [disabled] [ref=e324]
        - complementary [ref=e327]:
          - separator "Resize panel" [ref=e328]
          - region "Side panel" [ref=e331]:
            - generic [ref=e332]:
              - generic [ref=e335]:
                - tablist [ref=e336]:
                  - generic [ref=e339]:
                    - tab "Artifacts" [selected] [ref=e340]
                    - button "Close Artifacts" [ref=e342]
                  - status [ref=e346]
                - button "Open a new tab" [ref=e348]
              - generic [ref=e350]:
                - button "Maximize side panel" [ref=e351]
                - button "Close side panel" [ref=e352]
            - tabpanel "Artifacts" [ref=e355]:
              - generic [ref=e356]: No artifacts yet. Work products, documents, and agent-produced files will appear here.
  - generic [ref=e357]:
    - heading "Command Palette" [level=2] [ref=e358]
    - paragraph [ref=e359]: Search for a command to run...
```

# Test source

```ts
  245 | 
  246 | async function assertAnalyticalContextPayloadAccessInternal(db:Db,companyId:string,actor:AuthorizationActor|undefined,
  247 |  scope:{issueId:string}|{runId:string},readScope?:NativeReadScope,worklist?:AnalyticalPayloadWorklist):Promise<void>{
  248 |  const origins=()=>db.execute<{source_run_id:string|null;source_task_id:string|null;invalid:boolean}>(sql`
  249 |    select source_run_id,source_task_id,invalid from aw_runner_task_source_chain(${companyId}::uuid,
  250 |      ${"runId"in scope?scope.runId:null}::uuid,${"issueId"in scope?scope.issueId:null}::uuid)
  251 |    order by source_run_id,source_task_id,invalid`);
  252 |  const initial=await origins();
  253 |  if(!is(db,PgTransaction)){
  254 |   const taskIds=[...new Set([...( "issueId" in scope ? [scope.issueId] : []),...initial.map(source=>source.source_task_id).filter((id):id is string=>!!id)])];
  255 |   const workflowTasks=taskIds.length?await db.select({id:issues.id}).from(issues).where(and(eq(issues.companyId,companyId),inArray(issues.id,taskIds),eq(issues.originKind,"workflow_task"))).limit(1):[];
  256 |   const workflowStep="runId" in scope?await db.select({id:workflowStepRuns.id}).from(workflowStepRuns)
  257 |     .where(and(eq(workflowStepRuns.companyId,companyId),eq(workflowStepRuns.heartbeatRunId,scope.runId))).limit(1):[];
  258 |   if(workflowTasks.length||workflowStep.length)return db.transaction(tx=>assertAnalyticalContextPayloadAccess(tx as unknown as Db,companyId,actor,scope,readScope));
  259 |  }
  260 |  if(initial.length>16||initial.some(source=>source.invalid||!source.source_run_id||!source.source_task_id))
  261 |    throw new HttpError(403,"Native task source access is unavailable",{code:"analytical_source_access_lost"});
  262 |  // A saved routine may copy a private analytical answer into a new task.
  263 |  // Retain the exact authoring run's current reader policy as well as erasure.
  264 |  const routineOrigins=()=>db.execute<{source_run_id:string;source_task_id:string}>(sql`
  265 |    with tasks as (
  266 |      select coalesce(${"issueId"in scope?scope.issueId:null}::uuid,(select coalesce(h.native_issue_id,case
  267 |        when coalesce(h.context_snapshot->>'issueId',h.context_snapshot->>'taskId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  268 |        then coalesce(h.context_snapshot->>'issueId',h.context_snapshot->>'taskId')::uuid else null end)
  269 |        from heartbeat_runs h where h.company_id=${companyId}::uuid and h.id=${"runId"in scope?scope.runId:null}::uuid)) as id
  270 |      union select source_task_id from aw_runner_task_source_chain(${companyId}::uuid,
  271 |        ${"runId"in scope?scope.runId:null}::uuid,${"issueId"in scope?scope.issueId:null}::uuid)
  272 |    ) select distinct h.id as source_run_id,c.id as source_task_id
  273 |      from tasks t join issues i on i.company_id=${companyId}::uuid and i.id=t.id and i.origin_kind='routine_execution'
  274 |      join routines r on r.company_id=i.company_id and r.origin_kind='conversation_draft' and r.id=case
  275 |        when i.origin_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then i.origin_id::uuid else null end
  276 |      join heartbeat_runs h on h.company_id=r.company_id and h.id=case
  277 |        when r.origin_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then r.origin_id::uuid else null end
  278 |      join issues c on c.company_id=h.company_id and c.id=coalesce(h.native_issue_id,case
  279 |        when coalesce(h.context_snapshot->>'issueId',h.context_snapshot->>'taskId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  280 |        then coalesce(h.context_snapshot->>'issueId',h.context_snapshot->>'taskId')::uuid else null end)
  281 |      order by source_run_id,source_task_id limit 18`);
  282 |  const initialRoutines=await routineOrigins();
  283 |  if(initialRoutines.length>17)throw new HttpError(403,"Complete routine source access is unavailable",{code:"analytical_source_access_lost"});
  284 |  const workflowTaskIds=[...new Set([...( "issueId" in scope ? [scope.issueId] : []),...initial.map(source=>source.source_task_id).filter((id):id is string=>!!id)])];
  285 |  const workflowTasks=workflowTaskIds.length?await db.select({id:issues.id,runId:issues.originRunId}).from(issues)
  286 |   .where(and(eq(issues.companyId,companyId),inArray(issues.id,workflowTaskIds),eq(issues.originKind,"workflow_task"))).limit(18):[];
  287 |  const stepRuns="runId" in scope?await db.selectDistinct({runId:workflowStepRuns.workflowRunId}).from(workflowStepRuns)
  288 |   .where(and(eq(workflowStepRuns.companyId,companyId),eq(workflowStepRuns.heartbeatRunId,scope.runId))).limit(257):[];
  289 |  const workflowRunIds=[...new Set([...workflowTasks.map(task=>task.runId).filter((id):id is string=>!!id),...stepRuns.map(row=>row.runId)])].sort();
  290 |  if(workflowRunIds.length>256)throw new HttpError(403,"Complete Workflow task source access is unavailable",{code:"analytical_source_access_lost"});
  291 |  if(worklist)workflowRunIds.forEach(runId=>worklist.workflowRunIds.add(runId));
  292 |  const inspect=async()=>{
  293 |  if(worklist)worklist.directSources.set("issueId"in scope?`issue:${scope.issueId}`:`run:${scope.runId}`,scope);
  294 |  else await assertDirectAnalyticalContextPayloadAccess(db,companyId,actor,scope,readScope);
  295 |  for(const source of initial){
  296 |    // Each actual ancestor keeps its Original current-reader policy, not just
  297 |    // an erasure marker or the descendant task's company membership.
  298 |    if(worklist){
  299 |     worklist.sharedSources.set(`run:${source.source_run_id}`,{runId:source.source_run_id!});
  300 |     worklist.sharedSources.set(`issue:${source.source_task_id}`,{issueId:source.source_task_id!});
  301 |    }else{
  302 |     await assertDirectAnalyticalContextPayloadAccess(db,companyId,actor,{runId:source.source_run_id!},readScope);
  303 |     await assertDirectAnalyticalContextPayloadAccess(db,companyId,actor,{issueId:source.source_task_id!},readScope);
  304 |    }
  305 |  }
  306 |  for(const source of initialRoutines){
  307 |    if(worklist){
  308 |     worklist.sharedSources.set(`run:${source.source_run_id}`,{runId:source.source_run_id});
  309 |     worklist.sharedSources.set(`issue:${source.source_task_id}`,{issueId:source.source_task_id});
  310 |    }else{
  311 |     await assertDirectAnalyticalContextPayloadAccess(db,companyId,actor,{runId:source.source_run_id},readScope);
  312 |     await assertDirectAnalyticalContextPayloadAccess(db,companyId,actor,{issueId:source.source_task_id},readScope);
  313 |    }
  314 |  }
  315 |  if(initial.length||initialRoutines.length){
  316 |   const recheck=async()=>{
  317 |    const final=await origins();
  318 |    if(JSON.stringify(initialRoutines)!==JSON.stringify(await routineOrigins()))
  319 |      throw new HttpError(403,"Routine source provenance changed",{code:"analytical_source_access_lost"});
  320 |    if(JSON.stringify(initial)!==JSON.stringify(final))
  321 |      throw new HttpError(403,"Native task source provenance changed",{code:"analytical_source_access_lost"});
  322 |    const [receipt]=await db.execute<{erased:boolean}>(sql`select aw_workflow_memory_erased(${companyId}::uuid,
  323 |      ${"runId"in scope?scope.runId:null}::uuid,${"issueId"in scope?scope.issueId:null}::uuid) as erased`);
  324 |    if(receipt?.erased)throw new HttpError(403,"Native task source access is unavailable",{code:"analytical_source_access_lost"});
  325 |   };
  326 |   if(worklist)worklist.finalChecks.push(recheck);
  327 |   else await recheck();
  328 |  }
  329 |  };
  330 |  if(workflowRunIds.length){
  331 |   if(!actor)throw new HttpError(403,"Native task source access is unavailable",{code:"analytical_source_access_lost"});
  332 |   return authorizationService(db).withReadWorkflowSources(companyId,actor,workflowRunIds,inspect);
  333 |  }
  334 |  return inspect();
  335 | }
  336 | 
  337 | async function assertDirectAnalyticalContextPayloadAccess(db:Db,companyId:string,actor:AuthorizationActor|undefined,scope:{issueId:string}|{runId:string},readScope?:NativeReadScope,companyLocksHeld=false) {
  338 |  // Ordinary conversation prose has source privacy even without analytical
  339 |  // retention roots. Every actual ancestor goes through this same narrowing.
  340 |  let diagnosticStage="task_reader_acl";
  341 |  try {
  342 |  if(!actor || !("issueId" in scope
  343 |    ? await canActorReadIssuePrivacy(db,actor,{companyId,id:scope.issueId})
  344 |    : await canActorReadHeartbeatRunPrivacy(db,actor,{companyId,id:scope.runId})))
> 345 |    throw new HttpError(403,"Native task source access is unavailable",{code:"analytical_source_access_lost"});
      |          ^ Error: Native task source access is unavailable
  346 |  diagnosticStage="task_erasure_currentness";
  347 |  const [sourceReceipt]=await db.execute<{erased:boolean}>(sql`select aw_workflow_memory_erased(${companyId}::uuid,${"runId"in scope?scope.runId:null}::uuid,${"issueId"in scope?scope.issueId:null}::uuid) as erased`);
  348 |  if(sourceReceipt?.erased)throw new HttpError(403,"Analytical conversation source access is unavailable",{code:"analytical_source_access_lost"});
  349 |  diagnosticStage="learned_workflow_currentness";
  350 |  await assertLearnedWorkflowPayloadAccess(db,companyId,actor,scope,readScope);
  351 |  diagnosticStage="conversation_retirement_check";
  352 |  const boundRun="runId" in scope?await db.select({issueId:heartbeatRuns.issueId}).from(heartbeatRuns)
  353 |   .where(and(eq(heartbeatRuns.companyId,companyId),eq(heartbeatRuns.id,scope.runId))).limit(1):[];
  354 |  const conversationIssueId="issueId" in scope?scope.issueId:boundRun[0]?.issueId;
  355 |  const retired = await db.select({id:issues.id}).from(issues).where(and(eq(issues.companyId,companyId),sql`${issues.conversationRetiredAt} is not null`,
  356 |   "issueId" in scope?eq(issues.id,scope.issueId):sql`exists(select 1 from ${heartbeatRuns} h where h.company_id=${companyId}::uuid and h.id=${scope.runId}::uuid and h.native_issue_id=${issues.id})`)).limit(1);
  357 |  if(retired.length)throw new HttpError(403,"Analytical conversation source access is unavailable",{code:"analytical_source_access_lost"});
  358 |  diagnosticStage="retained_context_lookup";
  359 |  const condition="issueId" in scope?or(eq(contextManifests.issueId,scope.issueId),
  360 |   sql`exists(select 1 from heartbeat_runs h where h.company_id=${companyId}::uuid and h.id=${contextManifests.runId} and h.agent_id=${contextManifests.agentId} and h.issue_id=${scope.issueId}::uuid)`):or(eq(contextManifests.runId,scope.runId),conversationIssueId?eq(contextManifests.issueId,conversationIssueId):undefined,sql`exists(select 1 from ${agentExecutionManifests} e where e.company_id=${companyId}::uuid and e.run_id=${scope.runId}::uuid and e.context_manifest_id=${contextManifests.id})`);
  361 |  const {lockAnalyticalCompany}=await import("./analytical-privacy.js"),{lockMemoryPrivacy}=await import("./memory/memory-privacy.js");
  362 |  const inspectIn=async(tx:Db)=>{
  363 |   // The caller already owns a pinned source transaction in the batched/Home
  364 |   // path. Opening a savepoint for every retained Context root adds a full
  365 |   // round trip per Task without strengthening the locks or current checks.
  366 |   // Keep a transaction only for standalone callers.
  367 |   if(!companyLocksHeld){
  368 |    diagnosticStage="retained_context_privacy_locks";
  369 |    await tx.execute(sql`set local statement_timeout='8s'`);
  370 |    await lockAnalyticalCompany(tx,companyId);await lockMemoryPrivacy(tx,companyId);
  371 |   }
  372 |   const currentActor=actor;
  373 |   if(!currentActor)throw forbidden("A current reader is required for source-dependent analytical payloads");
  374 |   if(!companyLocksHeld){
  375 |    diagnosticStage="task_reader_acl_recheck";
  376 |    const canRead="issueId" in scope
  377 |     ? await canActorReadIssuePrivacy(tx,currentActor,{companyId,id:scope.issueId})
  378 |     : await canActorReadHeartbeatRunPrivacy(tx,currentActor,{companyId,id:scope.runId});
  379 |    if(!canRead&&process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS==="1"&&"runId"in scope&&currentActor.type==="agent"){
  380 |     const facts=await tx.execute<{runExists:boolean;runRunning:boolean;agentMatches:boolean;humanMatches:boolean;agentUsable:boolean;
  381 |      scopeKind:string|null;issueRefCount:number;contextObject:boolean;contextIssueRef:boolean;contextTaskRef:boolean;
  382 |      boundIssueOpen:boolean;boundConversationIdentity:boolean;retainedRootCount:number}>(sql`
  383 |      select exists(select 1 from heartbeat_runs r where r.company_id=${companyId}::uuid and r.id=${scope.runId}::uuid) as "runExists",
  384 |       exists(select 1 from heartbeat_runs r where r.company_id=${companyId}::uuid and r.id=${scope.runId}::uuid and r.status='running') as "runRunning",
  385 |       exists(select 1 from heartbeat_runs r where r.company_id=${companyId}::uuid and r.id=${scope.runId}::uuid and r.agent_id=${currentActor.agentId}::uuid) as "agentMatches",
  386 |       exists(select 1 from heartbeat_runs r where r.company_id=${companyId}::uuid and r.id=${scope.runId}::uuid and r.responsible_user_id=${currentActor.onBehalfOfUserId??null}::uuid) as "humanMatches",
  387 |       exists(select 1 from agents a where a.company_id=${companyId}::uuid and a.id=${currentActor.agentId}::uuid and a.status not in ('paused','terminated','pending_approval','error')) as "agentUsable",
  388 |       (select r.scope_kind from heartbeat_runs r where r.company_id=${companyId}::uuid and r.id=${scope.runId}::uuid limit 1) as "scopeKind",
  389 |       (select count(distinct ref.id)::int from heartbeat_runs r cross join lateral (values (r.issue_id),(r.native_issue_id),
  390 |         (case when r.context_snapshot->>'issueId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (r.context_snapshot->>'issueId')::uuid end),
  391 |         (case when r.context_snapshot->>'taskId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (r.context_snapshot->>'taskId')::uuid end)) ref(id)
  392 |        where r.company_id=${companyId}::uuid and r.id=${scope.runId}::uuid) as "issueRefCount",
  393 |       exists(select 1 from heartbeat_runs r where r.company_id=${companyId}::uuid and r.id=${scope.runId}::uuid and jsonb_typeof(coalesce(r.context_snapshot,'{}'::jsonb))='object') as "contextObject",
  394 |       exists(select 1 from heartbeat_runs r where r.company_id=${companyId}::uuid and r.id=${scope.runId}::uuid and coalesce(r.context_snapshot,'{}'::jsonb) ? 'issueId') as "contextIssueRef",
  395 |       exists(select 1 from heartbeat_runs r where r.company_id=${companyId}::uuid and r.id=${scope.runId}::uuid and coalesce(r.context_snapshot,'{}'::jsonb) ? 'taskId') as "contextTaskRef",
  396 |       exists(select 1 from heartbeat_runs r join issues i on i.company_id=r.company_id and i.id in (r.issue_id,r.native_issue_id,
  397 |         case when r.context_snapshot->>'issueId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (r.context_snapshot->>'issueId')::uuid end,
  398 |         case when r.context_snapshot->>'taskId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (r.context_snapshot->>'taskId')::uuid end)
  399 |         where r.company_id=${companyId}::uuid and r.id=${scope.runId}::uuid and i.visibility='open') as "boundIssueOpen",
  400 |       exists(select 1 from heartbeat_runs r join issues i on i.company_id=r.company_id and i.id in (r.issue_id,r.native_issue_id,
  401 |         case when r.context_snapshot->>'issueId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (r.context_snapshot->>'issueId')::uuid end,
  402 |         case when r.context_snapshot->>'taskId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (r.context_snapshot->>'taskId')::uuid end)
  403 |         where r.company_id=${companyId}::uuid and r.id=${scope.runId}::uuid and i.conversation_user_id=${currentActor.onBehalfOfUserId??null}::uuid
  404 |           and i.conversation_agent_id=${currentActor.agentId}::uuid and i.conversation_retired_at is null) as "boundConversationIdentity",
  405 |       (select count(*)::int from context_manifests c join context_manifest_memory_roots cmr on cmr.company_id=c.company_id and cmr.manifest_id=c.id
  406 |         join analytical_context_roots ar on ar.company_id=cmr.company_id and ar.memory_record_id=cmr.memory_record_id
  407 |         where c.company_id=${companyId}::uuid and c.run_id=${scope.runId}::uuid) as "retainedRootCount"
  408 |     `);
  409 |     const row=facts[0];
  410 |     console.info("native-analytical-run-reader-denial-facts",JSON.stringify(row??{}));
  411 |    }
  412 |    if(!canRead)throw new HttpError(403,"Native task source access is unavailable",{code:"analytical_source_access_lost"});
  413 |   }
  414 |   diagnosticStage="retained_context_lookup";
  415 |   const retainedContexts=await tx.select({id:contextManifests.id}).from(contextManifests)
  416 |    .where(and(eq(contextManifests.companyId,companyId),condition)).limit(1);
  417 |   if(!retainedContexts.length)return;
  418 |   const hasRoots=await tx.select({id:analyticalContextRoots.memoryRecordId}).from(contextManifests)
  419 |    .innerJoin(contextManifestMemoryRoots,and(eq(contextManifestMemoryRoots.companyId,contextManifests.companyId),eq(contextManifestMemoryRoots.manifestId,contextManifests.id)))
  420 |    .innerJoin(analyticalContextRoots,and(eq(analyticalContextRoots.companyId,contextManifests.companyId),eq(analyticalContextRoots.memoryRecordId,contextManifestMemoryRoots.memoryRecordId)))
  421 |    .where(and(eq(contextManifests.companyId,companyId),condition)).limit(1);
  422 |   const inspectCurrentSources=async()=>{
  423 |   diagnosticStage="retained_root_lookup";
  424 |   const roots=await tx.selectDistinct({id:analyticalContextRoots.memoryRecordId,sourceCount:analyticalContextRoots.sourceCount,pins:analyticalContextRoots.authorityPins,expiresAt:analyticalContextRoots.expiresAt}).from(contextManifests).innerJoin(contextManifestMemoryRoots,and(eq(contextManifestMemoryRoots.companyId,contextManifests.companyId),eq(contextManifestMemoryRoots.manifestId,contextManifests.id)))
  425 |    .innerJoin(analyticalContextRoots,and(eq(analyticalContextRoots.companyId,contextManifests.companyId),eq(analyticalContextRoots.memoryRecordId,contextManifestMemoryRoots.memoryRecordId))).where(and(eq(contextManifests.companyId,companyId),condition)).limit(257);
  426 |   if(roots.length>256)throw forbidden("The complete analytical conversation exceeds its source review budget");
  427 |   diagnosticStage="retained_run_erasure_currentness";
  428 |   const erased=await tx.execute<{erased:boolean}>(sql`select aw_workflow_memory_erased(${companyId}::uuid,${"runId"in scope?scope.runId:null}::uuid,${conversationIssueId??null}::uuid) as erased`);
  429 |   if(erased[0]?.erased)throw forbidden("The analytical conversation source was erased or expired");
  430 |   const deadline=performance.now()+30000;
  431 |   const memoryRoots=await tx.selectDistinct({id:contextManifestMemoryRoots.memoryRecordId}).from(contextManifests)
  432 |    .innerJoin(contextManifestMemoryRoots,and(eq(contextManifestMemoryRoots.companyId,contextManifests.companyId),eq(contextManifestMemoryRoots.manifestId,contextManifests.id)))
  433 |    .where(and(eq(contextManifests.companyId,companyId),condition)).limit(257);
  434 |   if(memoryRoots.length>256)throw forbidden("The complete retained Context exceeds its source review budget");
  435 |   const {canActorReadMemorySources}=await import("./memory/memory-privacy.js");
  436 |   const analyticalIds=new Set(roots.map(root=>root.id));
  437 |   diagnosticStage="retained_memory_reader";
  438 |   for(const root of memoryRoots){
  439 |    if(analyticalIds.has(root.id)){
  440 |     await assertAnalyticalRetentionRootOwnerCurrent(tx,companyId,currentActor,root.id);
  441 |     continue;
  442 |    }
  443 |    if(performance.now()>deadline || !await canActorReadMemorySources(tx,companyId,currentActor,root.id))
  444 |     throw forbidden("Retained Context source access is unavailable");
  445 |   }
```