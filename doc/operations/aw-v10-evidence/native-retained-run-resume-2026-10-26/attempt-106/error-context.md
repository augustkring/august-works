# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-chat-sessions.spec.ts >> an owner can explicitly recover after source visibility is lost while original metric facts survive
- Location: tests/e2e/agent-chat-sessions.spec.ts:213:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 403
Received: 404
```

# Page snapshot

```yaml
- generic [ref=f2e4]:
  - link "Skip to Main Content" [ref=f2e5] [cursor=pointer]:
    - /url: "#main-content"
  - generic [ref=f2e6]:
    - generic [ref=f2e7]:
      - generic [ref=f2e8]:
        - complementary [ref=f2e10]:
          - button "Open Agent Chat 1793049770935 organization switcher" [ref=f2e12]:
            - generic [ref=f2e13]:
              - generic [ref=f2e14]: A
              - generic "Agent Chat 1793049770935" [ref=f2e17]
          - navigation [ref=f2e18]:
            - generic [ref=f2e19]:
              - button "New Task" [ref=f2e20]
              - link "Search" [ref=f2e25] [cursor=pointer]:
                - /url: /AGE/search
              - link "Overview" [ref=f2e31] [cursor=pointer]:
                - /url: /AGE/dashboard
              - link "Agents" [ref=f2e39] [cursor=pointer]:
                - /url: /AGE/agents
              - link "Inbox" [ref=f2e47] [cursor=pointer]:
                - /url: /AGE/inbox
            - generic [ref=f2e53]:
              - generic [ref=f2e55]:
                - button "Collapse Work" [expanded] [ref=f2e56]
                - generic [ref=f2e59]: Work
              - generic [ref=f2e62]:
                - link "Tasks" [ref=f2e63] [cursor=pointer]:
                  - /url: /AGE/issues
                - link "Routines" [ref=f2e69] [cursor=pointer]:
                  - /url: /AGE/routines
                - link "Management reviews" [ref=f2e77] [cursor=pointer]:
                  - /url: /AGE/management-reviews
                - link "Business metrics" [ref=f2e83] [cursor=pointer]:
                  - /url: /AGE/business-metrics
                - link "AI Governance" [ref=f2e90] [cursor=pointer]:
                  - /url: /AGE/ai-governance
                - link "Projects" [ref=f2e95] [cursor=pointer]:
                  - /url: /AGE/projects
                - link "Artifacts" [ref=f2e100] [cursor=pointer]:
                  - /url: /AGE/artifacts
            - generic [ref=f2e107]:
              - link "Connections" [ref=f2e108] [cursor=pointer]:
                - /url: /AGE/apps
              - link "Governance" [ref=f2e118] [cursor=pointer]:
                - /url: /AGE/governance
            - generic [ref=f2e124]:
              - generic [ref=f2e126]:
                - button "Collapse Advanced" [expanded] [ref=f2e127]
                - generic [ref=f2e130]: Advanced
              - generic [ref=f2e133]:
                - link "Skills" [ref=f2e134] [cursor=pointer]:
                  - /url: /AGE/skills
                - link "Audit" [ref=f2e147] [cursor=pointer]:
                  - /url: /AGE/activity
            - region "Chats" [ref=f2e154]:
              - generic [ref=f2e155]:
                - generic [ref=f2e156]: Chats
                - button "Chat with an agent" [ref=f2e157]
              - generic [ref=f2e158]:
                - link "Alpha" [ref=f2e159] [cursor=pointer]:
                  - /url: /AGE/chats/alpha
                - button "Star Alpha" [ref=f2e165]
        - button "Open account menu" [ref=f2e168]:
          - generic [ref=f2e169]: AR
          - generic [ref=f2e171]: Authenticated agent-chat reviewer
      - separator "Resize sidebar" [ref=f2e172]
    - generic [ref=f2e174]:
      - region "Global utilities" [ref=f2e176]:
        - generic [ref=f2e179]:
          - generic [ref=f2e180]: Language
          - combobox "Language" [ref=f2e181]:
            - option "English" [selected]
            - option "Dansk"
        - link "Help / Support" [ref=f2e182] [cursor=pointer]:
          - /url: /AGE/company/help
        - link "Contact support" [ref=f2e183] [cursor=pointer]:
          - /url: mailto:support@blentera.com
        - link "User account" [ref=f2e184] [cursor=pointer]:
          - /url: /AGE/company/settings/instance/profile
      - generic [ref=f2e188]:
        - generic [ref=f2e189]:
          - generic [ref=f2e190]:
            - navigation "breadcrumb" [ref=f2e192]:
              - list [ref=f2e193]:
                - listitem [ref=f2e194]:
                  - link "AL Alpha" [disabled] [ref=f2e195]:
                    - generic [ref=f2e196]: AL
                    - generic [ref=f2e199]: Alpha
                  - link "Configure Alpha" [ref=f2e201] [cursor=pointer]:
                    - /url: /AGE/agents/3df6e891-c00d-4f54-aa07-62b31d1f6eab/runtime
            - button "Hide properties" [ref=f2e202]
          - main [ref=f2e203]:
            - tabpanel [ref=f2e206]:
              - generic [ref=f2e208]:
                - status "Loading conversation" [ref=f2e210]
                - generic [ref=f2e218]:
                  - generic [ref=f2e222]:
                    - textbox "editable markdown" [ref=f2e224]:
                      - paragraph [ref=f2e225]
                    - generic:
                      - paragraph: Message Alpha — describe what you want done…
                  - generic [ref=f2e226]:
                    - button "Attach file" [ref=f2e227]
                    - button "Auto mode" [ref=f2e229]
                    - button "Send" [disabled] [ref=f2e232]
        - complementary [ref=f2e235]:
          - separator "Resize panel" [ref=f2e236]
          - region "Side panel" [ref=f2e239]:
            - generic [ref=f2e240]:
              - generic [ref=f2e243]:
                - tablist [ref=f2e244]:
                  - generic [ref=f2e247]:
                    - tab "Artifacts" [selected] [ref=f2e248]
                    - button "Close Artifacts" [ref=f2e250]
                  - status [ref=f2e254]
                - button "Open a new tab" [ref=f2e256]
              - generic [ref=f2e258]:
                - button "Maximize side panel" [ref=f2e259]
                - button "Close side panel" [ref=f2e260]
            - tabpanel "Artifacts" [ref=f2e263]:
              - generic [ref=f2e264]: No artifacts yet. Work products, documents, and agent-produced files will appear here.
  - generic [ref=f2e265]:
    - heading "Command Palette" [level=2] [ref=f2e266]
    - paragraph [ref=f2e267]: Search for a command to run...
```

# Test source

```ts
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
  241 |     const currentHumanConversation=await request.get(f.chatPath);expect(currentHumanConversation.status()).toBe(200);
  242 |     expect((await currentHumanConversation.json()).id).toBe(original.id);
  243 |     const currentHumanHistory=await json(await request.get(`/api/issues/${original.id}/comments`));
  244 |     expect(currentHumanHistory.some((comment:any)=>comment.body===firstMessage)).toBe(true);
  245 |     expect(runRow!.responsibleUserId).toBe(session.user.id);
  246 |     const profile=runRow!.runnerProfileJson as Record<string,any>,captures=Array.isArray(profile.nativeToolResultSourceCaptures)?profile.nativeToolResultSourceCaptures as Array<Record<string,any>>:[];
  247 |     const metricCaptures=captures.filter(capture=>capture.tool==="query_business_metric"&&capture.nativeReadResult===true&&capture.sourceSet&&capture.sourceSet.inputs);
  248 |     expect(metricCaptures).toHaveLength(1);
  249 |     const metricCapture=metricCaptures[0]!,metricSource=metricCapture.source as Record<string,any>,metricSourceSet=metricCapture.sourceSet as {policy:unknown;inputs:Array<Record<string,any>>};
  250 |     const turnId=metricCapture.turnId,dispatchIntents=Array.isArray(profile.nativeModelInputDispatchIntents)?profile.nativeModelInputDispatchIntents as Array<Record<string,any>>:[];
  251 |     const dispatchAssociations=Array.isArray(profile.nativeToolCallDispatchAssociations)?profile.nativeToolCallDispatchAssociations as Array<Record<string,any>>:[];
  252 |     const receipt=profile.nativeInputSourceReceipt as {additionalInputs?:Array<{responsibleUserId:string;policy:unknown;inputs:Array<Record<string,any>>}>}|undefined;
  253 |     const parsedReceipt=nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
  254 |     const receiptBinding=parsedReceipt.success?parsedReceipt.data.binding:null;
  255 |     const matchingAssociations=dispatchAssociations.filter(row=>row.callId===metricCapture.callId&&row.turnId===turnId&&row.tool==="query_business_metric"&&row.eventSeq===metricCapture.eventSeq&&row.attempt===metricCapture.attempt);
  256 |     const exactReceiptInputs=(receipt?.additionalInputs??[]).filter(entry=>entry.responsibleUserId===runRow!.responsibleUserId&&JSON.stringify(entry.policy)===JSON.stringify(metricSourceSet.policy)&&
  257 |       Array.isArray(entry.inputs)&&metricSource!==null&&entry.inputs.length===metricSourceSet.inputs.length+1&&
  258 |       JSON.stringify(entry.inputs[0])===JSON.stringify(metricSource)&&JSON.stringify(entry.inputs.slice(1))===JSON.stringify(metricSourceSet.inputs));
  259 |     expect({turnIdPresent:typeof turnId==="string",matchingDispatchIntentCount:dispatchIntents.filter(row=>row.turnId===turnId&&row.eventSeq===metricCapture.eventSeq&&row.attempt===metricCapture.attempt).length,
  260 |       nativeInputDispatchPresent:Boolean(metricCapture.nativeInputDispatch),matchingDispatchAssociationCount:matchingAssociations.length,sourcePresent:metricSource!==null,
  261 |       inputSourceProtocolVersion:runRow!.nativeInputSourceProtocolVersion,
  262 |       receiptSchemaValid:parsedReceipt.success,receiptCompanyMatches:receiptBinding?.companyId===runRow!.companyId,
  263 |       receiptRunMatches:receiptBinding?.runId===runRow!.id,receiptAgentMatches:receiptBinding?.agentId===runRow!.agentId,
  264 |       receiptIssueMatches:receiptBinding?.issueId===runRow!.nativeIssueId,
  265 |       receiptHumanMatches:receiptBinding?.responsibleUserId===runRow!.responsibleUserId,
  266 |       contextInputCount:metricSourceSet.inputs.filter(input=>input.kind==="context").length,exactReceiptInputCount:exactReceiptInputs.length}).toEqual({
  267 |       turnIdPresent:true,matchingDispatchIntentCount:1,nativeInputDispatchPresent:true,matchingDispatchAssociationCount:1,sourcePresent:true,contextInputCount:1,exactReceiptInputCount:1,
  268 |       inputSourceProtocolVersion:1,
  269 |       receiptSchemaValid:true,receiptCompanyMatches:true,receiptRunMatches:true,receiptAgentMatches:true,receiptIssueMatches:true,receiptHumanMatches:true,
  270 |     });
  271 |     expect(metricSource).toMatchObject({kind:"tool_result",runId:run.id,callId:metricCapture.callId,toolName:"query_business_metric",invocationId:null,contentHash:metricCapture.resultDigest});
  272 |     const resultContextInputs=metricSourceSet.inputs.filter(input=>input.kind==="context");expect(resultContextInputs).toHaveLength(1);
  273 |     const resultContextId=resultContextInputs[0]!.manifestId as string;
  274 |     const [resultContext]=await db.select().from(contextManifests).where(eq(contextManifests.id,resultContextId));
  275 |     expect(resultContext).toMatchObject({companyId:f.company.id,runId:run.id,agentId:f.agent.id,issueId:original.id});
  276 |     const bootstrapContexts=Array.isArray(profile.nativeBootstrapContextManifests)
  277 |       ? profile.nativeBootstrapContextManifests as Array<{companyId:string;contextManifestId:string}>
  278 |       : [];
  279 |     expect(bootstrapContexts).toHaveLength(1);
  280 |     const bootstrapContextId=bootstrapContexts[0]!.contextManifestId;
  281 |     const [bootstrapContext]=await db.select().from(contextManifests).where(eq(contextManifests.id,bootstrapContextId));
  282 |     expect(bootstrapContext).toMatchObject({companyId:f.company.id,runId:run.id,agentId:f.agent.id,issueId:original.id});
  283 |     expect(resultContextId).not.toBe(bootstrapContextId);
  284 |     const retainedContext=await db.select().from(contextManifestMemoryRoots).where(eq(contextManifestMemoryRoots.manifestId,resultContextId));expect(retainedContext.some(row=>row.memoryRecordId===retention!.id)).toBe(true);
  285 |     const bootstrapRoots=await db.select().from(contextManifestMemoryRoots).where(eq(contextManifestMemoryRoots.manifestId,bootstrapContextId));
  286 |     expect(bootstrapRoots.some(row=>row.memoryRecordId===retention!.id)).toBe(false);
  287 |     expect(receipt.additionalInputs).toContainEqual({responsibleUserId:runRow!.responsibleUserId,policy:metricSourceSet.policy,inputs:[metricSource,...metricSourceSet.inputs]});
  288 |     const authority=await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.memoryRecordId,retention!.id)).then(rows=>rows[0]);
  289 |     expect(authority?.authorityPins).toContainEqual({kind:"analytical_evidence",source:{type:"metric_observation",id:observation!.id,metricId:metric.metric.id,metricVersionId:metric.version.id}});
  290 |     expect((await db.select().from(analyticalContextDependencies).where(eq(analyticalContextDependencies.memoryRecordId,retention!.id))).map(row=>row.sourceManifestId)).toContain(observation!.lineageManifestId);
  291 |     await page.goto(f.route);await expect(page.getByText("Private analytical history before source visibility changes",{exact:true})).toBeVisible();
  292 |     await json(await request.patch(`/api/issues/${source.id}`,{data:{hiddenAt:new Date().toISOString()}}));
  293 |     const denied=await request.get(f.chatPath);expect(denied.status()).toBe(403);expect((await denied.json()).details.conversationIssueId).toBe(original.id);
  294 |     await page.reload();await expect(page.getByRole("button",{name:"Start a new conversation"})).toBeVisible();
  295 |     await expect(page.getByText("Private analytical history before source visibility changes",{exact:true})).toHaveCount(0);
  296 |     await page.screenshot({path:test.info().outputPath("source-visibility-lost.png"),fullPage:true});
  297 |     await page.getByRole("button",{name:"Start a new conversation"}).click();await expect(page.getByTestId("task-chat-composer-input")).toBeVisible();
> 298 |     const fresh=await json(await request.get(f.chatPath));expect(fresh.id).not.toBe(original.id);expect((await request.get(`/api/issues/${original.id}/comments`)).status()).toBe(403);
      |                                                                                                                                                                              ^ Error: expect(received).toBe(expected) // Object.is equality
  299 |     expect((await db.select().from(memoryRecords).where(eq(memoryRecords.id,retention!.id)))[0]!.deletedAt).not.toBeNull();
  300 |     expect((await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.id,observation!.id)))[0]!.id).toBe(observation!.id);
  301 |     expect((await db.select().from(businessMetricVersions).where(eq(businessMetricVersions.id,metric.version.id)))[0]!.id).toBe(metric.version.id);
  302 |     await page.screenshot({path:test.info().outputPath("source-visibility-fresh-native-chat.png"),fullPage:true});
  303 |   }finally{await db.$client.end({timeout:0});await f.restore({collectState:false});}
  304 | });
  305 | 
  306 | test("feature flag blocks new sends and resets while preserving existing history", async ({
  307 |   page,
  308 |   request,
  309 | }) => {
  310 |   const f = await setup(request, page);
  311 |   request = f.request;
  312 |   try {
  313 |     await page.goto(f.route);
  314 |     await send(page, "Visible history");
  315 |     const issue = await idle(request, f.chatPath);
  316 |     await json(
  317 |       await request.patch("/api/instance/settings/experimental", {
  318 |         data: { enableAgentChat: false },
  319 |       }),
  320 |     );
  321 |     for (const body of ["blocked message", "/new"])
  322 |       expect(
  323 |         (
  324 |           await request.post(`/api/issues/${issue.id}/comments`, {
  325 |             data: { body },
  326 |           })
  327 |         ).status(),
  328 |       ).toBe(404);
  329 |     await page.reload();
  330 |     await expect(page.getByText(/Agent Chat is disabled/)).toBeVisible();
  331 |     expect(
  332 |       (await json(await request.get(`/api/issues/${issue.id}/comments`))).some(
  333 |         (c: any) => c.body.includes("Visible history"),
  334 |       ),
  335 |     ).toBe(true);
  336 |     expect((await request.post(f.chatPath, { data: {} })).status()).toBe(404);
  337 |   } finally {
  338 |     await f.restore();
  339 |   }
  340 | });
  341 | 
  342 | test("Stop then queued /new resets unpause the conversation without losing history", async ({
  343 |   page,
  344 |   request,
  345 | }) => {
  346 |   const f = await setup(request, page);
  347 |   request = f.request;
  348 |   try {
  349 |     await page.goto(f.route);
  350 |     await send(page, { action: "hold" });
  351 |     await expect
  352 |       .poll(async () => {
  353 |         const chat = await json(await request.get(f.chatPath));
  354 |         return (
  355 |           chat &&
  356 |           (
  357 |             await json(await request.get(`/api/issues/${chat.id}/comments`))
  358 |           ).some(
  359 |             (c: any) => c.body === "Provider is streaming and ready to stop.",
  360 |           )
  361 |         );
  362 |       })
  363 |       .toBe(true);
  364 |     const issue = await json(await request.get(f.chatPath));
  365 |     const active = (
  366 |       await json(await request.get(`/api/issues/${issue.id}/live-runs`))
  367 |     )[0];
  368 |     await page.getByTestId("task-chat-composer-stop").click();
  369 |     await expect
  370 |       .poll(
  371 |         async () =>
  372 |           (await json(await request.get(`/api/heartbeat-runs/${active.id}`)))
  373 |             .status,
  374 |       )
  375 |       .toBe("cancelled");
  376 |     const staleToken = createLocalAgentJwt(
  377 |       f.agent.id,
  378 |       f.company.id,
  379 |       "process",
  380 |       active.id,
  381 |     );
  382 |     expect(staleToken).toBeTruthy();
  383 |     const late = await request.post(`/api/issues/${issue.id}/comments`, {
  384 |       headers: { Authorization: `Bearer ${staleToken}` },
  385 |       data: { body: "Forbidden late response" },
  386 |     });
  387 |     expect([403, 409]).toContain(late.status());
  388 |     const mutation = await request.post(
  389 |       `/api/companies/${f.company.id}/projects`,
  390 |       {
  391 |         headers: { Authorization: `Bearer ${staleToken}` },
  392 |         data: { name: "Cancelled project" },
  393 |       },
  394 |     );
  395 |     expect([403, 409]).toContain(mutation.status());
  396 |     expect(
  397 |       await json(await request.get(`/api/companies/${f.company.id}/projects`)),
  398 |     ).toHaveLength(0);
```