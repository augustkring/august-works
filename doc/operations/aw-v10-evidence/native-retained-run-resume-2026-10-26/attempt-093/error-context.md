# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-chat-sessions.spec.ts >> an owner can explicitly recover after source visibility is lost while original metric facts survive
- Location: tests/e2e/agent-chat-sessions.spec.ts:213:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('task-chat-composer-input')
Expected: visible
Timeout: 20000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 20000ms
  - waiting for getByTestId('task-chat-composer-input')

```

```yaml
- link "Skip to Main Content":
  - /url: "#main-content"
- complementary:
  - button "Open Agent Chat 1793044452815 organization switcher": A Agent Chat 1793044452815
  - navigation:
    - button "New Task"
    - link "Search":
      - /url: /AGE/search
    - link "Overview":
      - /url: /AGE/dashboard
    - link "Agents":
      - /url: /AGE/agents
    - link "Inbox":
      - /url: /AGE/inbox
    - button "Collapse Work" [expanded]
    - text: Work
    - link "Tasks":
      - /url: /AGE/issues
    - link "Routines":
      - /url: /AGE/routines
    - link "Management reviews":
      - /url: /AGE/management-reviews
    - link "Business metrics":
      - /url: /AGE/business-metrics
    - link "AI Governance":
      - /url: /AGE/ai-governance
    - link "Projects":
      - /url: /AGE/projects
    - link "Artifacts":
      - /url: /AGE/artifacts
    - link "Connections":
      - /url: /AGE/apps
    - link "Governance":
      - /url: /AGE/governance
    - button "Collapse Advanced" [expanded]
    - text: Advanced
    - link "Skills":
      - /url: /AGE/skills
    - link "Audit":
      - /url: /AGE/activity
    - region "Chats":
      - text: Chats
      - button "Chat with an agent"
      - link "Alpha":
        - /url: /AGE/chats/alpha
      - button "Star Alpha"
- button "Open account menu": AR Authenticated agent-chat reviewer
- separator "Resize sidebar"
- region "Global utilities":
  - text: Language
  - combobox "Language":
    - option "English" [selected]
    - option "Dansk"
  - link "Help / Support":
    - /url: /AGE/company/help
  - link "Contact support":
    - /url: mailto:support@blentera.com
  - link "User account":
    - /url: /AGE/company/settings/instance/profile
- main:
  - alert:
    - paragraph: Internal server error
    - button "Start a new conversation"
- heading "Command Palette" [level=2]
- paragraph: Search for a command to run...
```

# Test source

```ts
  193 |   try{
  194 |     const original=await json(await request.post(f.chatPath,{data:{}}));
  195 |     await json(await request.post(`/api/issues/${original.id}/comments`,{data:{body:"Private cached history before live source denial",clientRequestId:randomUUID()}}));await idle(request,f.chatPath,1);
  196 |     const deliveries:Array<(message:string)=>void>=[];
  197 |     await page.routeWebSocket("**/api/companies/*/events/ws",socket=>{
  198 |       const server=socket.connectToServer();server.onMessage(message=>socket.send(message));deliveries.push(message=>socket.send(message));
  199 |     });
  200 |     await page.goto(f.route);await expect(page.getByText("Private cached history before live source denial",{exact:true})).toBeVisible();await expect.poll(()=>deliveries.length).toBeGreaterThan(0);
  201 |     await page.screenshot({path:test.info().outputPath("live-source-admitted-history.png"),fullPage:true});
  202 |     let creations=0;
  203 |     const failure={error:"Analytical conversation source access is unavailable",details:{code:"analytical_source_access_lost",conversationIssueId:original.id}};
  204 |     await page.route(`**${f.chatPath}`,route=>{if(route.request().method()==="POST")creations++;return route.fulfill({status:403,json:failure});});
  205 |     await page.route(`**/api/issues/${original.id}/comments*`,route=>route.fulfill({status:403,json:failure}));
  206 |     for(const deliver of deliveries)deliver(JSON.stringify({id:900001,companyId:f.company.id,type:"analytical.context.access_lost",createdAt:new Date().toISOString(),payload:{issueId:original.id,runId:null,code:"analytical_source_access_lost"}}));
  207 |     await expect(page.getByText("Private cached history before live source denial",{exact:true})).toHaveCount(0);
  208 |     await expect(page.getByRole("button",{name:"Start a new conversation"})).toBeVisible();expect(creations).toBe(0);
  209 |     await page.screenshot({path:test.info().outputPath("live-source-hidden-history.png"),fullPage:true});
  210 |   }finally{await f.restore();}
  211 | });
  212 | 
  213 | test("an owner can explicitly recover after source visibility is lost while original metric facts survive", async ({page,request}) => {
  214 |   const f=await setup(request, page);
  215 |   request = f.request;
  216 |   const config=JSON.parse(await readFile(process.env.PAPERCLIP_E2E_SERVER_CONFIG!,"utf8")),pid=await readFile(path.join(config.database.embeddedPostgresDataDir,"postmaster.pid"),"utf8");
  217 |   const db=createDb(`postgres://paperclip:paperclip@127.0.0.1:${pid.split("\n")[3]}/paperclip`);
  218 |   try{
  219 |     await json(await request.patch("/api/instance/settings/experimental",{data:{analytical_lineage_v8:true,business_metrics_v8:true,management_reviews_v8:true,management_chat_tools_v8:true,enableContextEngineV1:true,ai_use_cases_v7:true,governance_evidence_v7:true}}));
  220 |     const original=await json(await request.post(f.chatPath,{data:{}}));
  221 |     await json(await request.post(`/api/issues/${original.id}/comments`,{data:{body:"Private analytical history before source visibility changes",clientRequestId:randomUUID()}}));
  222 |     await idle(request,f.chatPath,1);
  223 |     const priorRuns=await json(await request.get(`/api/companies/${f.company.id}/heartbeat-runs`));
  224 |     const priorRunIds=new Set(priorRuns.map((run:any)=>run.id));
  225 |     const source=await json(await request.post(`/api/companies/${f.company.id}/issues`,{data:{title:"Canonical metric population for chat retention",status:"done"}}));
  226 |     const policy=await json(await request.post(`/api/companies/${f.company.id}/governance-obligations`,{data:analyticalPurpose()}));
  227 |     const session=await json(await request.get("/api/auth/get-session"));
  228 |     const definition=metricDefinition(policy.id);definition.ownerUserId=session.user.id;
  229 |     const metric=await json(await request.post(`/api/companies/${f.company.id}/business-metrics`,{data:{key:"browser_source_recovery",definition}}));
  230 |     await json(await request.post(`/api/companies/${f.company.id}/business-metrics/${metric.metric.id}/publish`,{data:{expectedRevision:1,versionId:metric.version.id}}));
  231 |     const now=new Date(),command={action:"metric",metricId:metric.metric.id,versionId:metric.version.id,from:new Date(now.getTime()-86400000).toISOString(),until:new Date(now.getTime()+1000).toISOString()};
  232 |     const firstMessage=`fixture:${Buffer.from(JSON.stringify(command)).toString("base64url")}`;
  233 |     await json(await request.post(`/api/issues/${original.id}/comments`,{data:{body:firstMessage,clientRequestId:randomUUID()}}));
  234 |     await idle(request,f.chatPath,2);
  235 |     await page.goto(f.route);await expect(page.getByText("Private analytical history before source visibility changes",{exact:true})).toBeVisible();
  236 |     await expect(page.getByText(firstMessage,{exact:true})).toBeVisible();
  237 |     const runs=await json(await request.get(`/api/companies/${f.company.id}/heartbeat-runs`)),run=runs.find((r:any)=>!priorRunIds.has(r.id)&&r.contextSnapshot?.issueId===original.id);expect(run).toBeTruthy();
  238 |     const [observation]=await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.metricId,metric.metric.id));expect(observation).toBeTruthy();
  239 |     const [runRow]=await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,run.id));expect(runRow).toBeTruthy();
  240 |     const retention=await db.select().from(memoryRecords).where(eq(memoryRecords.createdByActorId,"native_analytical_retention")).then(rows=>rows.find(row=>row.companyId===f.company.id&&row.ownerAgentId===f.agent.id));expect(retention).toBeTruthy();
  241 |     expect(runRow!.responsibleUserId).toBe(session.user.id);
  242 |     const profile=runRow!.runnerProfileJson as Record<string,any>,captures=Array.isArray(profile.nativeToolResultSourceCaptures)?profile.nativeToolResultSourceCaptures as Array<Record<string,any>>:[];
  243 |     const metricCaptures=captures.filter(capture=>capture.tool==="query_business_metric"&&capture.nativeReadResult===true&&capture.sourceSet&&capture.sourceSet.inputs);
  244 |     expect(metricCaptures).toHaveLength(1);
  245 |     const metricCapture=metricCaptures[0]!,metricSource=metricCapture.source as Record<string,any>,metricSourceSet=metricCapture.sourceSet as {policy:unknown;inputs:Array<Record<string,any>>};
  246 |     const turnId=metricCapture.turnId,dispatchIntents=Array.isArray(profile.nativeModelInputDispatchIntents)?profile.nativeModelInputDispatchIntents as Array<Record<string,any>>:[];
  247 |     const dispatchAssociations=Array.isArray(profile.nativeToolCallDispatchAssociations)?profile.nativeToolCallDispatchAssociations as Array<Record<string,any>>:[];
  248 |     const receipt=profile.nativeInputSourceReceipt as {additionalInputs?:Array<{responsibleUserId:string;policy:unknown;inputs:Array<Record<string,any>>}>}|undefined;
  249 |     const parsedReceipt=nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
  250 |     const receiptBinding=parsedReceipt.success?parsedReceipt.data.binding:null;
  251 |     const matchingAssociations=dispatchAssociations.filter(row=>row.callId===metricCapture.callId&&row.turnId===turnId&&row.tool==="query_business_metric"&&row.eventSeq===metricCapture.eventSeq&&row.attempt===metricCapture.attempt);
  252 |     const exactReceiptInputs=(receipt?.additionalInputs??[]).filter(entry=>entry.responsibleUserId===runRow!.responsibleUserId&&JSON.stringify(entry.policy)===JSON.stringify(metricSourceSet.policy)&&
  253 |       Array.isArray(entry.inputs)&&metricSource!==null&&entry.inputs.length===metricSourceSet.inputs.length+1&&
  254 |       JSON.stringify(entry.inputs[0])===JSON.stringify(metricSource)&&JSON.stringify(entry.inputs.slice(1))===JSON.stringify(metricSourceSet.inputs));
  255 |     expect({turnIdPresent:typeof turnId==="string",matchingDispatchIntentCount:dispatchIntents.filter(row=>row.turnId===turnId&&row.eventSeq===metricCapture.eventSeq&&row.attempt===metricCapture.attempt).length,
  256 |       nativeInputDispatchPresent:Boolean(metricCapture.nativeInputDispatch),matchingDispatchAssociationCount:matchingAssociations.length,sourcePresent:metricSource!==null,
  257 |       inputSourceProtocolVersion:runRow!.nativeInputSourceProtocolVersion,
  258 |       receiptSchemaValid:parsedReceipt.success,receiptCompanyMatches:receiptBinding?.companyId===runRow!.companyId,
  259 |       receiptRunMatches:receiptBinding?.runId===runRow!.id,receiptAgentMatches:receiptBinding?.agentId===runRow!.agentId,
  260 |       receiptIssueMatches:receiptBinding?.issueId===runRow!.nativeIssueId,
  261 |       receiptHumanMatches:receiptBinding?.responsibleUserId===runRow!.responsibleUserId,
  262 |       contextInputCount:metricSourceSet.inputs.filter(input=>input.kind==="context").length,exactReceiptInputCount:exactReceiptInputs.length}).toEqual({
  263 |       turnIdPresent:true,matchingDispatchIntentCount:1,nativeInputDispatchPresent:true,matchingDispatchAssociationCount:1,sourcePresent:true,contextInputCount:1,exactReceiptInputCount:1,
  264 |       inputSourceProtocolVersion:1,
  265 |       receiptSchemaValid:true,receiptCompanyMatches:true,receiptRunMatches:true,receiptAgentMatches:true,receiptIssueMatches:true,receiptHumanMatches:true,
  266 |     });
  267 |     expect(metricSource).toMatchObject({kind:"tool_result",runId:run.id,callId:metricCapture.callId,toolName:"query_business_metric",invocationId:null,contentHash:metricCapture.resultDigest});
  268 |     const resultContextInputs=metricSourceSet.inputs.filter(input=>input.kind==="context");expect(resultContextInputs).toHaveLength(1);
  269 |     const resultContextId=resultContextInputs[0]!.manifestId as string;
  270 |     const [resultContext]=await db.select().from(contextManifests).where(eq(contextManifests.id,resultContextId));
  271 |     expect(resultContext).toMatchObject({companyId:f.company.id,runId:run.id,agentId:f.agent.id,issueId:original.id});
  272 |     const bootstrapContexts=Array.isArray(profile.nativeBootstrapContextManifests)
  273 |       ? profile.nativeBootstrapContextManifests as Array<{companyId:string;contextManifestId:string}>
  274 |       : [];
  275 |     expect(bootstrapContexts).toHaveLength(1);
  276 |     const bootstrapContextId=bootstrapContexts[0]!.contextManifestId;
  277 |     const [bootstrapContext]=await db.select().from(contextManifests).where(eq(contextManifests.id,bootstrapContextId));
  278 |     expect(bootstrapContext).toMatchObject({companyId:f.company.id,runId:run.id,agentId:f.agent.id,issueId:original.id});
  279 |     expect(resultContextId).not.toBe(bootstrapContextId);
  280 |     const retainedContext=await db.select().from(contextManifestMemoryRoots).where(eq(contextManifestMemoryRoots.manifestId,resultContextId));expect(retainedContext.some(row=>row.memoryRecordId===retention!.id)).toBe(true);
  281 |     const bootstrapRoots=await db.select().from(contextManifestMemoryRoots).where(eq(contextManifestMemoryRoots.manifestId,bootstrapContextId));
  282 |     expect(bootstrapRoots.some(row=>row.memoryRecordId===retention!.id)).toBe(false);
  283 |     expect(receipt.additionalInputs).toContainEqual({responsibleUserId:runRow!.responsibleUserId,policy:metricSourceSet.policy,inputs:[metricSource,...metricSourceSet.inputs]});
  284 |     const authority=await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.memoryRecordId,retention!.id)).then(rows=>rows[0]);
  285 |     expect(authority?.authorityPins).toContainEqual({kind:"analytical_evidence",source:{type:"metric_observation",id:observation!.id,metricId:metric.metric.id,metricVersionId:metric.version.id}});
  286 |     expect((await db.select().from(analyticalContextDependencies).where(eq(analyticalContextDependencies.memoryRecordId,retention!.id))).map(row=>row.sourceManifestId)).toContain(observation!.lineageManifestId);
  287 |     await page.goto(f.route);await expect(page.getByText("Private analytical history before source visibility changes",{exact:true})).toBeVisible();
  288 |     await json(await request.patch(`/api/issues/${source.id}`,{data:{hiddenAt:new Date().toISOString()}}));
  289 |     const denied=await request.get(f.chatPath);expect(denied.status()).toBe(403);expect((await denied.json()).details.conversationIssueId).toBe(original.id);
  290 |     await page.reload();await expect(page.getByRole("button",{name:"Start a new conversation"})).toBeVisible();
  291 |     await expect(page.getByText("Private analytical history before source visibility changes",{exact:true})).toHaveCount(0);
  292 |     await page.screenshot({path:test.info().outputPath("source-visibility-lost.png"),fullPage:true});
> 293 |     await page.getByRole("button",{name:"Start a new conversation"}).click();await expect(page.getByTestId("task-chat-composer-input")).toBeVisible();
      |                                                                                                                                         ^ Error: expect(locator).toBeVisible() failed
  294 |     const fresh=await json(await request.get(f.chatPath));expect(fresh.id).not.toBe(original.id);expect((await request.get(`/api/issues/${original.id}/comments`)).status()).toBe(403);
  295 |     expect((await db.select().from(memoryRecords).where(eq(memoryRecords.id,retention!.id)))[0]!.deletedAt).not.toBeNull();
  296 |     expect((await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.id,observation!.id)))[0]!.id).toBe(observation!.id);
  297 |     expect((await db.select().from(businessMetricVersions).where(eq(businessMetricVersions.id,metric.version.id)))[0]!.id).toBe(metric.version.id);
  298 |     await page.screenshot({path:test.info().outputPath("source-visibility-fresh-native-chat.png"),fullPage:true});
  299 |   }finally{await db.$client.end({timeout:0});await f.restore({collectState:false});}
  300 | });
  301 | 
  302 | test("feature flag blocks new sends and resets while preserving existing history", async ({
  303 |   page,
  304 |   request,
  305 | }) => {
  306 |   const f = await setup(request, page);
  307 |   request = f.request;
  308 |   try {
  309 |     await page.goto(f.route);
  310 |     await send(page, "Visible history");
  311 |     const issue = await idle(request, f.chatPath);
  312 |     await json(
  313 |       await request.patch("/api/instance/settings/experimental", {
  314 |         data: { enableAgentChat: false },
  315 |       }),
  316 |     );
  317 |     for (const body of ["blocked message", "/new"])
  318 |       expect(
  319 |         (
  320 |           await request.post(`/api/issues/${issue.id}/comments`, {
  321 |             data: { body },
  322 |           })
  323 |         ).status(),
  324 |       ).toBe(404);
  325 |     await page.reload();
  326 |     await expect(page.getByText(/Agent Chat is disabled/)).toBeVisible();
  327 |     expect(
  328 |       (await json(await request.get(`/api/issues/${issue.id}/comments`))).some(
  329 |         (c: any) => c.body.includes("Visible history"),
  330 |       ),
  331 |     ).toBe(true);
  332 |     expect((await request.post(f.chatPath, { data: {} })).status()).toBe(404);
  333 |   } finally {
  334 |     await f.restore();
  335 |   }
  336 | });
  337 | 
  338 | test("Stop then queued /new resets unpause the conversation without losing history", async ({
  339 |   page,
  340 |   request,
  341 | }) => {
  342 |   const f = await setup(request, page);
  343 |   request = f.request;
  344 |   try {
  345 |     await page.goto(f.route);
  346 |     await send(page, { action: "hold" });
  347 |     await expect
  348 |       .poll(async () => {
  349 |         const chat = await json(await request.get(f.chatPath));
  350 |         return (
  351 |           chat &&
  352 |           (
  353 |             await json(await request.get(`/api/issues/${chat.id}/comments`))
  354 |           ).some(
  355 |             (c: any) => c.body === "Provider is streaming and ready to stop.",
  356 |           )
  357 |         );
  358 |       })
  359 |       .toBe(true);
  360 |     const issue = await json(await request.get(f.chatPath));
  361 |     const active = (
  362 |       await json(await request.get(`/api/issues/${issue.id}/live-runs`))
  363 |     )[0];
  364 |     await page.getByTestId("task-chat-composer-stop").click();
  365 |     await expect
  366 |       .poll(
  367 |         async () =>
  368 |           (await json(await request.get(`/api/heartbeat-runs/${active.id}`)))
  369 |             .status,
  370 |       )
  371 |       .toBe("cancelled");
  372 |     const staleToken = createLocalAgentJwt(
  373 |       f.agent.id,
  374 |       f.company.id,
  375 |       "process",
  376 |       active.id,
  377 |     );
  378 |     expect(staleToken).toBeTruthy();
  379 |     const late = await request.post(`/api/issues/${issue.id}/comments`, {
  380 |       headers: { Authorization: `Bearer ${staleToken}` },
  381 |       data: { body: "Forbidden late response" },
  382 |     });
  383 |     expect([403, 409]).toContain(late.status());
  384 |     const mutation = await request.post(
  385 |       `/api/companies/${f.company.id}/projects`,
  386 |       {
  387 |         headers: { Authorization: `Bearer ${staleToken}` },
  388 |         data: { name: "Cancelled project" },
  389 |       },
  390 |     );
  391 |     expect([403, 409]).toContain(mutation.status());
  392 |     expect(
  393 |       await json(await request.get(`/api/companies/${f.company.id}/projects`)),
```