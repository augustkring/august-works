# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-chat-sessions.spec.ts >> an owner can explicitly recover after source visibility is lost while original metric facts survive
- Location: tests/e2e/agent-chat-sessions.spec.ts:212:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 2
+ Received  + 2

  Object {
    "contextInputCount": 1,
-   "exactReceiptInputCount": 1,
+   "exactReceiptInputCount": 0,
    "matchingDispatchAssociationCount": 1,
    "matchingDispatchIntentCount": 1,
    "nativeInputDispatchPresent": true,
-   "sourcePresent": true,
+   "sourcePresent": false,
    "turnIdPresent": true,
  }
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
          - button "Open Agent Chat 1793039543453 organization switcher" [ref=e12]:
            - generic [ref=e13]:
              - generic [ref=e14]: A
              - generic "Agent Chat 1793039543453" [ref=e17]
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
                    - /url: /AGE/agents/97bf160c-9163-4ec0-b5b7-6778f1000f58/runtime
            - button "Hide properties" [ref=e202]
          - main [active] [ref=e203]:
            - tabpanel [ref=e206]:
              - generic [ref=e208]:
                - generic [ref=e213]:
                  - generic [ref=e216]:
                    - paragraph [ref=e219]: Private analytical history before source visibility changes
                    - generic [ref=e220]: 6:32 PM
                  - generic [ref=e222]:
                    - generic [ref=e224]:
                      - generic [ref=e225]:
                        - generic [ref=e226]: Alpha
                        - generic [ref=e230]: Worked for 10s
                      - button "Expand read files (2 activities)" [ref=e235]:
                        - generic "Read files" [ref=e240]
                    - paragraph [ref=e246]: "Reply generation 0: Private analytical history before source visibility changes"
                    - generic [ref=e247]:
                      - generic [ref=e248]: 6:32 PM
                      - generic [ref=e249]:
                        - button "Copy message" [ref=e250]
                        - button "Helpful" [ref=e254]
                        - button "Needs work" [ref=e257]
                  - generic [ref=e261]:
                    - paragraph [ref=e264]: fixture:eyJhY3Rpb24iOiJtZXRyaWMiLCJtZXRyaWNJZCI6IjFhYThkMjY0LTRkZGYtNDZjNS1hYjM4LTU0NzgxY2IzOGNlOCIsInZlcnNpb25JZCI6IjNhYzg0MjdhLTU0ZTgtNDI3My05Mzc1LWM1NzVmYmI1M2JlZiIsImZyb20iOiIyMDI2LTEwLTI1VDE4OjMyOjM2LjEwNloiLCJ1bnRpbCI6IjIwMjYtMTAtMjZUMTg6MzI6MzcuMTA2WiJ9
                    - generic [ref=e265]: 6:32 PM
                  - generic [ref=e267]:
                    - generic [ref=e269]:
                      - generic [ref=e270]:
                        - generic [ref=e271]: Alpha
                        - generic [ref=e275]: Worked for 18s
                      - button "Expand read files, searched files (3 activities)" [ref=e280]:
                        - generic "Read files, searched files" [ref=e287]
                    - paragraph [ref=e293]: Observed a current native business metric.
                    - generic [ref=e294]:
                      - generic [ref=e295]: 6:32 PM
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
  154 |   request = f.request;
  155 |   try {
  156 |     const original = await json(await request.post(f.chatPath, { data: {} }));
  157 |     await json(await request.post(`/api/issues/${original.id}/comments`, { data: { body: "Private history before source loss", clientRequestId: "00000000-0000-4000-8000-000000000099" } }));
  158 |     await idle(request, f.chatPath, 1);
  159 |     await page.goto(f.route);
  160 |     await expect(page.getByText("Private history before source loss", { exact: true })).toBeVisible();
  161 |     await page.screenshot({ path: test.info().outputPath("source-retained-history.png"), fullPage: true });
  162 |     let sourceLost = false, refreshed = 0, creations = 0;
  163 |     await page.route(`**${f.chatPath}`, async route => {
  164 |       if (route.request().method() === "POST") creations++;
  165 |       if (sourceLost && route.request().method() === "GET") {
  166 |         refreshed++;
  167 |         return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
  168 |       }
  169 |       await route.continue();
  170 |     });
  171 |     await page.route(`**/api/issues/${original.id}/comments*`, async route => {
  172 |       sourceLost = true;
  173 |       await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Analytical conversation source access is unavailable", details: { code: "analytical_source_access_lost" } }) });
  174 |     });
  175 |     await page.reload();
  176 |     await expect.poll(() => refreshed).toBeGreaterThan(0);
  177 |     await expect(page.getByTestId("task-chat-composer-input")).toBeVisible();
  178 |     await expect(page.getByText("Private history before source loss", { exact: true })).toHaveCount(0);
  179 |     expect(creations).toBe(0);
  180 |     await page.screenshot({ path: test.info().outputPath("source-loss-fresh-draft.png"), fullPage: true });
  181 |   } finally { await f.restore(); }
  182 | });
  183 | 
  184 | // Actual native source, authorization, recovery API and UI. The historical
  185 | // private retention root is seeded in the isolated DB; this browser case does
  186 | // not claim an external LLM or SDK analytical tool invocation.
  187 | // Live denial is an explicit UI response-contract fixture. Recipient admission
  188 | // and source/IAM changes are independently exercised over real WS + PostgreSQL.
  189 | test("live source denial removes cached chat history without a reload or implicit replacement", async ({page,request}) => {
  190 |   const f=await setup(request, page);
  191 |   request = f.request;
  192 |   try{
  193 |     const original=await json(await request.post(f.chatPath,{data:{}}));
  194 |     await json(await request.post(`/api/issues/${original.id}/comments`,{data:{body:"Private cached history before live source denial",clientRequestId:randomUUID()}}));await idle(request,f.chatPath,1);
  195 |     const deliveries:Array<(message:string)=>void>=[];
  196 |     await page.routeWebSocket("**/api/companies/*/events/ws",socket=>{
  197 |       const server=socket.connectToServer();server.onMessage(message=>socket.send(message));deliveries.push(message=>socket.send(message));
  198 |     });
  199 |     await page.goto(f.route);await expect(page.getByText("Private cached history before live source denial",{exact:true})).toBeVisible();await expect.poll(()=>deliveries.length).toBeGreaterThan(0);
  200 |     await page.screenshot({path:test.info().outputPath("live-source-admitted-history.png"),fullPage:true});
  201 |     let creations=0;
  202 |     const failure={error:"Analytical conversation source access is unavailable",details:{code:"analytical_source_access_lost",conversationIssueId:original.id}};
  203 |     await page.route(`**${f.chatPath}`,route=>{if(route.request().method()==="POST")creations++;return route.fulfill({status:403,json:failure});});
  204 |     await page.route(`**/api/issues/${original.id}/comments*`,route=>route.fulfill({status:403,json:failure}));
  205 |     for(const deliver of deliveries)deliver(JSON.stringify({id:900001,companyId:f.company.id,type:"analytical.context.access_lost",createdAt:new Date().toISOString(),payload:{issueId:original.id,runId:null,code:"analytical_source_access_lost"}}));
  206 |     await expect(page.getByText("Private cached history before live source denial",{exact:true})).toHaveCount(0);
  207 |     await expect(page.getByRole("button",{name:"Start a new conversation"})).toBeVisible();expect(creations).toBe(0);
  208 |     await page.screenshot({path:test.info().outputPath("live-source-hidden-history.png"),fullPage:true});
  209 |   }finally{await f.restore();}
  210 | });
  211 | 
  212 | test("an owner can explicitly recover after source visibility is lost while original metric facts survive", async ({page,request}) => {
  213 |   const f=await setup(request, page);
  214 |   request = f.request;
  215 |   const config=JSON.parse(await readFile(process.env.PAPERCLIP_E2E_SERVER_CONFIG!,"utf8")),pid=await readFile(path.join(config.database.embeddedPostgresDataDir,"postmaster.pid"),"utf8");
  216 |   const db=createDb(`postgres://paperclip:paperclip@127.0.0.1:${pid.split("\n")[3]}/paperclip`);
  217 |   try{
  218 |     await json(await request.patch("/api/instance/settings/experimental",{data:{analytical_lineage_v8:true,business_metrics_v8:true,management_reviews_v8:true,management_chat_tools_v8:true,enableContextEngineV1:true,ai_use_cases_v7:true,governance_evidence_v7:true}}));
  219 |     const original=await json(await request.post(f.chatPath,{data:{}}));
  220 |     await json(await request.post(`/api/issues/${original.id}/comments`,{data:{body:"Private analytical history before source visibility changes",clientRequestId:randomUUID()}}));
  221 |     await idle(request,f.chatPath,1);
  222 |     const priorRuns=await json(await request.get(`/api/companies/${f.company.id}/heartbeat-runs`));
  223 |     const priorRunIds=new Set(priorRuns.map((run:any)=>run.id));
  224 |     const source=await json(await request.post(`/api/companies/${f.company.id}/issues`,{data:{title:"Canonical metric population for chat retention",status:"done"}}));
  225 |     const policy=await json(await request.post(`/api/companies/${f.company.id}/governance-obligations`,{data:analyticalPurpose()}));
  226 |     const session=await json(await request.get("/api/auth/get-session"));
  227 |     const definition=metricDefinition(policy.id);definition.ownerUserId=session.user.id;
  228 |     const metric=await json(await request.post(`/api/companies/${f.company.id}/business-metrics`,{data:{key:"browser_source_recovery",definition}}));
  229 |     await json(await request.post(`/api/companies/${f.company.id}/business-metrics/${metric.metric.id}/publish`,{data:{expectedRevision:1,versionId:metric.version.id}}));
  230 |     const now=new Date(),command={action:"metric",metricId:metric.metric.id,versionId:metric.version.id,from:new Date(now.getTime()-86400000).toISOString(),until:new Date(now.getTime()+1000).toISOString()};
  231 |     const firstMessage=`fixture:${Buffer.from(JSON.stringify(command)).toString("base64url")}`;
  232 |     await json(await request.post(`/api/issues/${original.id}/comments`,{data:{body:firstMessage,clientRequestId:randomUUID()}}));
  233 |     await idle(request,f.chatPath,2);
  234 |     await page.goto(f.route);await expect(page.getByText("Private analytical history before source visibility changes",{exact:true})).toBeVisible();
  235 |     await expect(page.getByText(firstMessage,{exact:true})).toBeVisible();
  236 |     const runs=await json(await request.get(`/api/companies/${f.company.id}/heartbeat-runs`)),run=runs.find((r:any)=>!priorRunIds.has(r.id)&&r.contextSnapshot?.issueId===original.id);expect(run).toBeTruthy();
  237 |     const [observation]=await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.metricId,metric.metric.id));expect(observation).toBeTruthy();
  238 |     const [runRow]=await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,run.id));expect(runRow).toBeTruthy();
  239 |     const retention=await db.select().from(memoryRecords).where(eq(memoryRecords.createdByActorId,"native_analytical_retention")).then(rows=>rows.find(row=>row.companyId===f.company.id&&row.ownerAgentId===f.agent.id));expect(retention).toBeTruthy();
  240 |     expect(runRow!.responsibleUserId).toBe(session.user.id);
  241 |     const profile=runRow!.runnerProfileJson as Record<string,any>,captures=Array.isArray(profile.nativeToolResultSourceCaptures)?profile.nativeToolResultSourceCaptures as Array<Record<string,any>>:[];
  242 |     const metricCaptures=captures.filter(capture=>capture.tool==="query_business_metric"&&capture.nativeReadResult===true&&capture.sourceSet&&capture.sourceSet.inputs);
  243 |     expect(metricCaptures).toHaveLength(1);
  244 |     const metricCapture=metricCaptures[0]!,metricSource=metricCapture.source as Record<string,any>,metricSourceSet=metricCapture.sourceSet as {policy:unknown;inputs:Array<Record<string,any>>};
  245 |     const turnId=metricCapture.turnId,dispatchIntents=Array.isArray(profile.nativeModelInputDispatchIntents)?profile.nativeModelInputDispatchIntents as Array<Record<string,any>>:[];
  246 |     const dispatchAssociations=Array.isArray(profile.nativeToolCallDispatchAssociations)?profile.nativeToolCallDispatchAssociations as Array<Record<string,any>>:[];
  247 |     const receipt=profile.nativeInputSourceReceipt as {additionalInputs?:Array<{responsibleUserId:string;policy:unknown;inputs:Array<Record<string,any>>}>}|undefined;
  248 |     const matchingAssociations=dispatchAssociations.filter(row=>row.callId===metricCapture.callId&&row.turnId===turnId&&row.tool==="query_business_metric"&&row.eventSeq===metricCapture.eventSeq&&row.attempt===metricCapture.attempt);
  249 |     const exactReceiptInputs=(receipt?.additionalInputs??[]).filter(entry=>entry.responsibleUserId===runRow!.responsibleUserId&&JSON.stringify(entry.policy)===JSON.stringify(metricSourceSet.policy)&&
  250 |       Array.isArray(entry.inputs)&&metricSource!==null&&entry.inputs.length===metricSourceSet.inputs.length+1&&
  251 |       JSON.stringify(entry.inputs[0])===JSON.stringify(metricSource)&&JSON.stringify(entry.inputs.slice(1))===JSON.stringify(metricSourceSet.inputs));
  252 |     expect({turnIdPresent:typeof turnId==="string",matchingDispatchIntentCount:dispatchIntents.filter(row=>row.turnId===turnId&&row.eventSeq===metricCapture.eventSeq&&row.attempt===metricCapture.attempt).length,
  253 |       nativeInputDispatchPresent:Boolean(metricCapture.nativeInputDispatch),matchingDispatchAssociationCount:matchingAssociations.length,sourcePresent:metricSource!==null,
> 254 |       contextInputCount:metricSourceSet.inputs.filter(input=>input.kind==="context").length,exactReceiptInputCount:exactReceiptInputs.length}).toEqual({
      |                                                                                                                                                ^ Error: expect(received).toEqual(expected) // deep equality
  255 |       turnIdPresent:true,matchingDispatchIntentCount:1,nativeInputDispatchPresent:true,matchingDispatchAssociationCount:1,sourcePresent:true,contextInputCount:1,exactReceiptInputCount:1,
  256 |     });
  257 |     expect(metricSource).toMatchObject({kind:"tool_result",runId:run.id,callId:metricCapture.callId,toolName:"query_business_metric",invocationId:null,contentHash:metricCapture.resultDigest});
  258 |     const resultContextInputs=metricSourceSet.inputs.filter(input=>input.kind==="context");expect(resultContextInputs).toHaveLength(1);
  259 |     const resultContextId=resultContextInputs[0]!.manifestId as string;
  260 |     const [resultContext]=await db.select().from(contextManifests).where(eq(contextManifests.id,resultContextId));
  261 |     expect(resultContext).toMatchObject({companyId:f.company.id,runId:run.id,agentId:f.agent.id,issueId:original.id});
  262 |     const [execution]=await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId,run.id));expect(execution).toBeTruthy();
  263 |     expect(resultContextId).not.toBe(execution!.contextManifestId);
  264 |     const retainedContext=await db.select().from(contextManifestMemoryRoots).where(eq(contextManifestMemoryRoots.manifestId,resultContextId));expect(retainedContext.some(row=>row.memoryRecordId===retention!.id)).toBe(true);
  265 |     const bootstrapRoots=await db.select().from(contextManifestMemoryRoots).where(eq(contextManifestMemoryRoots.manifestId,execution!.contextManifestId));
  266 |     expect(bootstrapRoots.some(row=>row.memoryRecordId===retention!.id)).toBe(false);
  267 |     expect(receipt.additionalInputs).toContainEqual({responsibleUserId:runRow!.responsibleUserId,policy:metricSourceSet.policy,inputs:[metricSource,...metricSourceSet.inputs]});
  268 |     const authority=await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.memoryRecordId,retention!.id)).then(rows=>rows[0]);
  269 |     expect(authority?.authorityPins).toContainEqual({kind:"analytical_evidence",source:{type:"metric_observation",id:observation!.id,metricId:metric.metric.id,metricVersionId:metric.version.id}});
  270 |     expect((await db.select().from(analyticalContextDependencies).where(eq(analyticalContextDependencies.memoryRecordId,retention!.id))).map(row=>row.sourceManifestId)).toContain(observation!.lineageManifestId);
  271 |     await page.goto(f.route);await expect(page.getByText("Private analytical history before source visibility changes",{exact:true})).toBeVisible();
  272 |     await json(await request.patch(`/api/issues/${source.id}`,{data:{hiddenAt:new Date().toISOString()}}));
  273 |     const denied=await request.get(f.chatPath);expect(denied.status()).toBe(403);expect((await denied.json()).details.conversationIssueId).toBe(original.id);
  274 |     await page.reload();await expect(page.getByRole("button",{name:"Start a new conversation"})).toBeVisible();
  275 |     await expect(page.getByText("Private analytical history before source visibility changes",{exact:true})).toHaveCount(0);
  276 |     await page.screenshot({path:test.info().outputPath("source-visibility-lost.png"),fullPage:true});
  277 |     await page.getByRole("button",{name:"Start a new conversation"}).click();await expect(page.getByTestId("task-chat-composer-input")).toBeVisible();
  278 |     const fresh=await json(await request.get(f.chatPath));expect(fresh.id).not.toBe(original.id);expect((await request.get(`/api/issues/${original.id}/comments`)).status()).toBe(403);
  279 |     expect((await db.select().from(memoryRecords).where(eq(memoryRecords.id,retention!.id)))[0]!.deletedAt).not.toBeNull();
  280 |     expect((await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.id,observation!.id)))[0]!.id).toBe(observation!.id);
  281 |     expect((await db.select().from(businessMetricVersions).where(eq(businessMetricVersions.id,metric.version.id)))[0]!.id).toBe(metric.version.id);
  282 |     await page.screenshot({path:test.info().outputPath("source-visibility-fresh-native-chat.png"),fullPage:true});
  283 |   }finally{await db.$client.end({timeout:0});await f.restore({collectState:false});}
  284 | });
  285 | 
  286 | test("feature flag blocks new sends and resets while preserving existing history", async ({
  287 |   page,
  288 |   request,
  289 | }) => {
  290 |   const f = await setup(request, page);
  291 |   request = f.request;
  292 |   try {
  293 |     await page.goto(f.route);
  294 |     await send(page, "Visible history");
  295 |     const issue = await idle(request, f.chatPath);
  296 |     await json(
  297 |       await request.patch("/api/instance/settings/experimental", {
  298 |         data: { enableAgentChat: false },
  299 |       }),
  300 |     );
  301 |     for (const body of ["blocked message", "/new"])
  302 |       expect(
  303 |         (
  304 |           await request.post(`/api/issues/${issue.id}/comments`, {
  305 |             data: { body },
  306 |           })
  307 |         ).status(),
  308 |       ).toBe(404);
  309 |     await page.reload();
  310 |     await expect(page.getByText(/Agent Chat is disabled/)).toBeVisible();
  311 |     expect(
  312 |       (await json(await request.get(`/api/issues/${issue.id}/comments`))).some(
  313 |         (c: any) => c.body.includes("Visible history"),
  314 |       ),
  315 |     ).toBe(true);
  316 |     expect((await request.post(f.chatPath, { data: {} })).status()).toBe(404);
  317 |   } finally {
  318 |     await f.restore();
  319 |   }
  320 | });
  321 | 
  322 | test("Stop then queued /new resets unpause the conversation without losing history", async ({
  323 |   page,
  324 |   request,
  325 | }) => {
  326 |   const f = await setup(request, page);
  327 |   request = f.request;
  328 |   try {
  329 |     await page.goto(f.route);
  330 |     await send(page, { action: "hold" });
  331 |     await expect
  332 |       .poll(async () => {
  333 |         const chat = await json(await request.get(f.chatPath));
  334 |         return (
  335 |           chat &&
  336 |           (
  337 |             await json(await request.get(`/api/issues/${chat.id}/comments`))
  338 |           ).some(
  339 |             (c: any) => c.body === "Provider is streaming and ready to stop.",
  340 |           )
  341 |         );
  342 |       })
  343 |       .toBe(true);
  344 |     const issue = await json(await request.get(f.chatPath));
  345 |     const active = (
  346 |       await json(await request.get(`/api/issues/${issue.id}/live-runs`))
  347 |     )[0];
  348 |     await page.getByTestId("task-chat-composer-stop").click();
  349 |     await expect
  350 |       .poll(
  351 |         async () =>
  352 |           (await json(await request.get(`/api/heartbeat-runs/${active.id}`)))
  353 |             .status,
  354 |       )
```