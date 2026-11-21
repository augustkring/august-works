# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-chat-sessions.spec.ts >> an owner can explicitly recover after source visibility is lost while original metric facts survive
- Location: tests/e2e/agent-chat-sessions.spec.ts:214:1

# Error details

```
Error: expect(received).toBeTruthy()

Received: undefined
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
          - button "Open Agent Chat 1793046614595 organization switcher" [ref=e12]:
            - generic [ref=e13]:
              - generic [ref=e14]: A
              - generic "Agent Chat 1793046614595" [ref=e17]
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
                    - /url: /AGE/agents/34f2b2f8-8d18-4582-871d-cb3163eb4dc5/runtime
            - button "Hide properties" [ref=e202]
          - main [active] [ref=e203]:
            - tabpanel [ref=e206]:
              - generic [ref=e208]:
                - generic [ref=e213]:
                  - generic [ref=e216]:
                    - paragraph [ref=e219]: Private analytical history before source visibility changes
                    - generic [ref=e220]: 8:30 PM
                  - generic [ref=e222]:
                    - generic [ref=e224]:
                      - generic [ref=e225]:
                        - generic [ref=e226]: Alpha
                        - generic [ref=e230]: Worked for 9s
                      - button "Expand read files (2 activities)" [ref=e235]:
                        - generic "Read files" [ref=e240]
                    - paragraph [ref=e246]: "Reply generation 0: Private analytical history before source visibility changes"
                    - generic [ref=e247]:
                      - generic [ref=e248]: 8:30 PM
                      - generic [ref=e249]:
                        - button "Copy message" [ref=e250]
                        - button "Helpful" [ref=e254]
                        - button "Needs work" [ref=e257]
                  - generic [ref=e261]:
                    - paragraph [ref=e264]: fixture:eyJhY3Rpb24iOiJtZXRyaWMiLCJtZXRyaWNJZCI6ImMwYzQ4ZTBlLTVhYjQtNDBiOS04OWMxLTYyNmYzYTA5ZTA3ZiIsInZlcnNpb25JZCI6Ijk0NmVkYWYyLTMxYjMtNGY3MS1iOWVkLTM4Y2RmZTAxNTE3OSIsImZyb20iOiIyMDI2LTEwLTI1VDIwOjMwOjI2LjM1NloiLCJ1bnRpbCI6IjIwMjYtMTAtMjZUMjA6MzA6MjcuMzU2WiJ9
                    - generic [ref=e265]: 8:30 PM
                  - generic [ref=e267]:
                    - generic [ref=e269]:
                      - generic [ref=e270]:
                        - generic [ref=e271]: Alpha
                        - generic [ref=e275]: Worked for 8s
                      - button "Expand checked files (1 activity)" [ref=e280]:
                        - generic "Checked files" [ref=e285]
                    - paragraph [ref=e291]: I could not verify the current task context, so I cannot safely continue.
                    - generic [ref=e292]:
                      - generic [ref=e293]: 8:30 PM
                      - generic [ref=e294]:
                        - button "Copy message" [ref=e295]
                        - button "Helpful" [ref=e299]
                        - button "Needs work" [ref=e302]
                - generic [ref=e308]:
                  - generic [ref=e312]:
                    - textbox "editable markdown" [ref=e314]:
                      - paragraph [ref=e315]
                    - generic:
                      - paragraph: Message Alpha — describe what you want done…
                  - generic [ref=e316]:
                    - button "Attach file" [ref=e317]
                    - button "Auto mode" [ref=e319]
                    - button "Send" [disabled] [ref=e322]
        - complementary [ref=e325]:
          - separator "Resize panel" [ref=e326]
          - region "Side panel" [ref=e329]:
            - generic [ref=e330]:
              - generic [ref=e333]:
                - tablist [ref=e334]:
                  - generic [ref=e337]:
                    - tab "Artifacts" [selected] [ref=e338]
                    - button "Close Artifacts" [ref=e340]
                  - status [ref=e344]
                - button "Open a new tab" [ref=e346]
              - generic [ref=e348]:
                - button "Maximize side panel" [ref=e349]
                - button "Close side panel" [ref=e350]
            - tabpanel "Artifacts" [ref=e353]:
              - generic [ref=e354]: No artifacts yet. Work products, documents, and agent-produced files will appear here.
  - generic [ref=e355]:
    - heading "Command Palette" [level=2] [ref=e356]
    - paragraph [ref=e357]: Search for a command to run...
```

# Test source

```ts
  139 |     ).length;
  140 |     await page.goto(`/${f.company.issuePrefix}/issues/${issue.identifier}`);
  141 |     await page.goto(f.route);
  142 |     expect(
  143 |       await json(
  144 |         await request.get(`/api/companies/${f.company.id}/heartbeat-runs`),
  145 |       ),
  146 |     ).toHaveLength(count);
  147 |   } finally {
  148 |     await f.restore();
  149 |   }
  150 | });
  151 | 
  152 | // UI response-contract fixture; original source erasure and fresh native SDK
  153 | // admission are separately exercised against PostgreSQL, without this routing.
  154 | test("source loss refreshes the read-only chat identity and drops cached history before another send", async ({ page, request }) => {
  155 |   const f = await setup(request, page);
  156 |   request = f.request;
  157 |   try {
  158 |     const original = await json(await request.post(f.chatPath, { data: {} }));
  159 |     await json(await request.post(`/api/issues/${original.id}/comments`, { data: { body: "Private history before source loss", clientRequestId: "00000000-0000-4000-8000-000000000099" } }));
  160 |     await idle(request, f.chatPath, 1);
  161 |     await page.goto(f.route);
  162 |     await expect(page.getByText("Private history before source loss", { exact: true })).toBeVisible();
  163 |     await page.screenshot({ path: test.info().outputPath("source-retained-history.png"), fullPage: true });
  164 |     let sourceLost = false, refreshed = 0, creations = 0;
  165 |     await page.route(`**${f.chatPath}`, async route => {
  166 |       if (route.request().method() === "POST") creations++;
  167 |       if (sourceLost && route.request().method() === "GET") {
  168 |         refreshed++;
  169 |         return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
  170 |       }
  171 |       await route.continue();
  172 |     });
  173 |     await page.route(`**/api/issues/${original.id}/comments*`, async route => {
  174 |       sourceLost = true;
  175 |       await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Analytical conversation source access is unavailable", details: { code: "analytical_source_access_lost" } }) });
  176 |     });
  177 |     await page.reload();
  178 |     await expect.poll(() => refreshed).toBeGreaterThan(0);
  179 |     await expect(page.getByTestId("task-chat-composer-input")).toBeVisible();
  180 |     await expect(page.getByText("Private history before source loss", { exact: true })).toHaveCount(0);
  181 |     expect(creations).toBe(0);
  182 |     await page.screenshot({ path: test.info().outputPath("source-loss-fresh-draft.png"), fullPage: true });
  183 |   } finally { await f.restore(); }
  184 | });
  185 | 
  186 | // Actual native source, authorization, recovery API and UI. The historical
  187 | // private retention root is seeded in the isolated DB; this browser case does
  188 | // not claim an external LLM or SDK analytical tool invocation.
  189 | // Live denial is an explicit UI response-contract fixture. Recipient admission
  190 | // and source/IAM changes are independently exercised over real WS + PostgreSQL.
  191 | test("live source denial removes cached chat history without a reload or implicit replacement", async ({page,request}) => {
  192 |   const f=await setup(request, page);
  193 |   request = f.request;
  194 |   try{
  195 |     const original=await json(await request.post(f.chatPath,{data:{}}));
  196 |     await json(await request.post(`/api/issues/${original.id}/comments`,{data:{body:"Private cached history before live source denial",clientRequestId:randomUUID()}}));await idle(request,f.chatPath,1);
  197 |     const deliveries:Array<(message:string)=>void>=[];
  198 |     await page.routeWebSocket("**/api/companies/*/events/ws",socket=>{
  199 |       const server=socket.connectToServer();server.onMessage(message=>socket.send(message));deliveries.push(message=>socket.send(message));
  200 |     });
  201 |     await page.goto(f.route);await expect(page.getByText("Private cached history before live source denial",{exact:true})).toBeVisible();await expect.poll(()=>deliveries.length).toBeGreaterThan(0);
  202 |     await page.screenshot({path:test.info().outputPath("live-source-admitted-history.png"),fullPage:true});
  203 |     let creations=0;
  204 |     const failure={error:"Analytical conversation source access is unavailable",details:{code:"analytical_source_access_lost",conversationIssueId:original.id}};
  205 |     await page.route(`**${f.chatPath}`,route=>{if(route.request().method()==="POST")creations++;return route.fulfill({status:403,json:failure});});
  206 |     await page.route(`**/api/issues/${original.id}/comments*`,route=>route.fulfill({status:403,json:failure}));
  207 |     for(const deliver of deliveries)deliver(JSON.stringify({id:900001,companyId:f.company.id,type:"analytical.context.access_lost",createdAt:new Date().toISOString(),payload:{issueId:original.id,runId:null,code:"analytical_source_access_lost"}}));
  208 |     await expect(page.getByText("Private cached history before live source denial",{exact:true})).toHaveCount(0);
  209 |     await expect(page.getByRole("button",{name:"Start a new conversation"})).toBeVisible();expect(creations).toBe(0);
  210 |     await page.screenshot({path:test.info().outputPath("live-source-hidden-history.png"),fullPage:true});
  211 |   }finally{await f.restore();}
  212 | });
  213 | 
  214 | test("an owner can explicitly recover after source visibility is lost while original metric facts survive", async ({page,request}) => {
  215 |   const f=await setup(request, page);
  216 |   request = f.request;
  217 |   const config=JSON.parse(await readFile(process.env.PAPERCLIP_E2E_SERVER_CONFIG!,"utf8")),pid=await readFile(path.join(config.database.embeddedPostgresDataDir,"postmaster.pid"),"utf8");
  218 |   const db=createDb(`postgres://paperclip:paperclip@127.0.0.1:${pid.split("\n")[3]}/paperclip`);
  219 |   try{
  220 |     await json(await request.patch("/api/instance/settings/experimental",{data:{analytical_lineage_v8:true,business_metrics_v8:true,management_reviews_v8:true,management_chat_tools_v8:true,enableContextEngineV1:true,ai_use_cases_v7:true,governance_evidence_v7:true}}));
  221 |     const original=await json(await request.post(f.chatPath,{data:{}}));
  222 |     await json(await request.post(`/api/issues/${original.id}/comments`,{data:{body:"Private analytical history before source visibility changes",clientRequestId:randomUUID()}}));
  223 |     await idle(request,f.chatPath,1);
  224 |     const priorRuns=await json(await request.get(`/api/companies/${f.company.id}/heartbeat-runs`));
  225 |     const priorRunIds=new Set(priorRuns.map((run:any)=>run.id));
  226 |     const source=await json(await request.post(`/api/companies/${f.company.id}/issues`,{data:{title:"Canonical metric population for chat retention",status:"done"}}));
  227 |     const policy=await json(await request.post(`/api/companies/${f.company.id}/governance-obligations`,{data:analyticalPurpose()}));
  228 |     const session=await json(await request.get("/api/auth/get-session"));
  229 |     const definition=metricDefinition(policy.id);definition.ownerUserId=session.user.id;
  230 |     const metric=await json(await request.post(`/api/companies/${f.company.id}/business-metrics`,{data:{key:"browser_source_recovery",definition}}));
  231 |     await json(await request.post(`/api/companies/${f.company.id}/business-metrics/${metric.metric.id}/publish`,{data:{expectedRevision:1,versionId:metric.version.id}}));
  232 |     const now=new Date(),command={action:"metric",metricId:metric.metric.id,versionId:metric.version.id,from:new Date(now.getTime()-86400000).toISOString(),until:new Date(now.getTime()+1000).toISOString()};
  233 |     const firstMessage=`fixture:${Buffer.from(JSON.stringify(command)).toString("base64url")}`;
  234 |     await json(await request.post(`/api/issues/${original.id}/comments`,{data:{body:firstMessage,clientRequestId:randomUUID()}}));
  235 |     await idle(request,f.chatPath,2);
  236 |     await page.goto(f.route);await expect(page.getByText("Private analytical history before source visibility changes",{exact:true})).toBeVisible();
  237 |     await expect(page.getByText(firstMessage,{exact:true})).toBeVisible();
  238 |     const runs=await json(await request.get(`/api/companies/${f.company.id}/heartbeat-runs`)),run=runs.find((r:any)=>!priorRunIds.has(r.id)&&r.contextSnapshot?.issueId===original.id);expect(run).toBeTruthy();
> 239 |     const [observation]=await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.metricId,metric.metric.id));expect(observation).toBeTruthy();
      |                                                                                                                                                                ^ Error: expect(received).toBeTruthy()
  240 |     const [runRow]=await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,run.id));expect(runRow).toBeTruthy();
  241 |     const retention=await db.select().from(memoryRecords).where(eq(memoryRecords.createdByActorId,"native_analytical_retention")).then(rows=>rows.find(row=>row.companyId===f.company.id&&row.ownerAgentId===f.agent.id));expect(retention).toBeTruthy();
  242 |     await assertNativeAnalyticalRunPayloadAccess(db,f.company.id,run.id);
  243 |     expect(runRow!.responsibleUserId).toBe(session.user.id);
  244 |     const profile=runRow!.runnerProfileJson as Record<string,any>,captures=Array.isArray(profile.nativeToolResultSourceCaptures)?profile.nativeToolResultSourceCaptures as Array<Record<string,any>>:[];
  245 |     const metricCaptures=captures.filter(capture=>capture.tool==="query_business_metric"&&capture.nativeReadResult===true&&capture.sourceSet&&capture.sourceSet.inputs);
  246 |     expect(metricCaptures).toHaveLength(1);
  247 |     const metricCapture=metricCaptures[0]!,metricSource=metricCapture.source as Record<string,any>,metricSourceSet=metricCapture.sourceSet as {policy:unknown;inputs:Array<Record<string,any>>};
  248 |     const turnId=metricCapture.turnId,dispatchIntents=Array.isArray(profile.nativeModelInputDispatchIntents)?profile.nativeModelInputDispatchIntents as Array<Record<string,any>>:[];
  249 |     const dispatchAssociations=Array.isArray(profile.nativeToolCallDispatchAssociations)?profile.nativeToolCallDispatchAssociations as Array<Record<string,any>>:[];
  250 |     const receipt=profile.nativeInputSourceReceipt as {additionalInputs?:Array<{responsibleUserId:string;policy:unknown;inputs:Array<Record<string,any>>}>}|undefined;
  251 |     const parsedReceipt=nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
  252 |     const receiptBinding=parsedReceipt.success?parsedReceipt.data.binding:null;
  253 |     const matchingAssociations=dispatchAssociations.filter(row=>row.callId===metricCapture.callId&&row.turnId===turnId&&row.tool==="query_business_metric"&&row.eventSeq===metricCapture.eventSeq&&row.attempt===metricCapture.attempt);
  254 |     const exactReceiptInputs=(receipt?.additionalInputs??[]).filter(entry=>entry.responsibleUserId===runRow!.responsibleUserId&&JSON.stringify(entry.policy)===JSON.stringify(metricSourceSet.policy)&&
  255 |       Array.isArray(entry.inputs)&&metricSource!==null&&entry.inputs.length===metricSourceSet.inputs.length+1&&
  256 |       JSON.stringify(entry.inputs[0])===JSON.stringify(metricSource)&&JSON.stringify(entry.inputs.slice(1))===JSON.stringify(metricSourceSet.inputs));
  257 |     expect({turnIdPresent:typeof turnId==="string",matchingDispatchIntentCount:dispatchIntents.filter(row=>row.turnId===turnId&&row.eventSeq===metricCapture.eventSeq&&row.attempt===metricCapture.attempt).length,
  258 |       nativeInputDispatchPresent:Boolean(metricCapture.nativeInputDispatch),matchingDispatchAssociationCount:matchingAssociations.length,sourcePresent:metricSource!==null,
  259 |       inputSourceProtocolVersion:runRow!.nativeInputSourceProtocolVersion,
  260 |       receiptSchemaValid:parsedReceipt.success,receiptCompanyMatches:receiptBinding?.companyId===runRow!.companyId,
  261 |       receiptRunMatches:receiptBinding?.runId===runRow!.id,receiptAgentMatches:receiptBinding?.agentId===runRow!.agentId,
  262 |       receiptIssueMatches:receiptBinding?.issueId===runRow!.nativeIssueId,
  263 |       receiptHumanMatches:receiptBinding?.responsibleUserId===runRow!.responsibleUserId,
  264 |       contextInputCount:metricSourceSet.inputs.filter(input=>input.kind==="context").length,exactReceiptInputCount:exactReceiptInputs.length}).toEqual({
  265 |       turnIdPresent:true,matchingDispatchIntentCount:1,nativeInputDispatchPresent:true,matchingDispatchAssociationCount:1,sourcePresent:true,contextInputCount:1,exactReceiptInputCount:1,
  266 |       inputSourceProtocolVersion:1,
  267 |       receiptSchemaValid:true,receiptCompanyMatches:true,receiptRunMatches:true,receiptAgentMatches:true,receiptIssueMatches:true,receiptHumanMatches:true,
  268 |     });
  269 |     expect(metricSource).toMatchObject({kind:"tool_result",runId:run.id,callId:metricCapture.callId,toolName:"query_business_metric",invocationId:null,contentHash:metricCapture.resultDigest});
  270 |     const resultContextInputs=metricSourceSet.inputs.filter(input=>input.kind==="context");expect(resultContextInputs).toHaveLength(1);
  271 |     const resultContextId=resultContextInputs[0]!.manifestId as string;
  272 |     const [resultContext]=await db.select().from(contextManifests).where(eq(contextManifests.id,resultContextId));
  273 |     expect(resultContext).toMatchObject({companyId:f.company.id,runId:run.id,agentId:f.agent.id,issueId:original.id});
  274 |     const bootstrapContexts=Array.isArray(profile.nativeBootstrapContextManifests)
  275 |       ? profile.nativeBootstrapContextManifests as Array<{companyId:string;contextManifestId:string}>
  276 |       : [];
  277 |     expect(bootstrapContexts).toHaveLength(1);
  278 |     const bootstrapContextId=bootstrapContexts[0]!.contextManifestId;
  279 |     const [bootstrapContext]=await db.select().from(contextManifests).where(eq(contextManifests.id,bootstrapContextId));
  280 |     expect(bootstrapContext).toMatchObject({companyId:f.company.id,runId:run.id,agentId:f.agent.id,issueId:original.id});
  281 |     expect(resultContextId).not.toBe(bootstrapContextId);
  282 |     const retainedContext=await db.select().from(contextManifestMemoryRoots).where(eq(contextManifestMemoryRoots.manifestId,resultContextId));expect(retainedContext.some(row=>row.memoryRecordId===retention!.id)).toBe(true);
  283 |     const bootstrapRoots=await db.select().from(contextManifestMemoryRoots).where(eq(contextManifestMemoryRoots.manifestId,bootstrapContextId));
  284 |     expect(bootstrapRoots.some(row=>row.memoryRecordId===retention!.id)).toBe(false);
  285 |     expect(receipt.additionalInputs).toContainEqual({responsibleUserId:runRow!.responsibleUserId,policy:metricSourceSet.policy,inputs:[metricSource,...metricSourceSet.inputs]});
  286 |     const authority=await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.memoryRecordId,retention!.id)).then(rows=>rows[0]);
  287 |     expect(authority?.authorityPins).toContainEqual({kind:"analytical_evidence",source:{type:"metric_observation",id:observation!.id,metricId:metric.metric.id,metricVersionId:metric.version.id}});
  288 |     expect((await db.select().from(analyticalContextDependencies).where(eq(analyticalContextDependencies.memoryRecordId,retention!.id))).map(row=>row.sourceManifestId)).toContain(observation!.lineageManifestId);
  289 |     await page.goto(f.route);await expect(page.getByText("Private analytical history before source visibility changes",{exact:true})).toBeVisible();
  290 |     await json(await request.patch(`/api/issues/${source.id}`,{data:{hiddenAt:new Date().toISOString()}}));
  291 |     const denied=await request.get(f.chatPath);expect(denied.status()).toBe(403);expect((await denied.json()).details.conversationIssueId).toBe(original.id);
  292 |     await page.reload();await expect(page.getByRole("button",{name:"Start a new conversation"})).toBeVisible();
  293 |     await expect(page.getByText("Private analytical history before source visibility changes",{exact:true})).toHaveCount(0);
  294 |     await page.screenshot({path:test.info().outputPath("source-visibility-lost.png"),fullPage:true});
  295 |     await page.getByRole("button",{name:"Start a new conversation"}).click();await expect(page.getByTestId("task-chat-composer-input")).toBeVisible();
  296 |     const fresh=await json(await request.get(f.chatPath));expect(fresh.id).not.toBe(original.id);expect((await request.get(`/api/issues/${original.id}/comments`)).status()).toBe(403);
  297 |     expect((await db.select().from(memoryRecords).where(eq(memoryRecords.id,retention!.id)))[0]!.deletedAt).not.toBeNull();
  298 |     expect((await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.id,observation!.id)))[0]!.id).toBe(observation!.id);
  299 |     expect((await db.select().from(businessMetricVersions).where(eq(businessMetricVersions.id,metric.version.id)))[0]!.id).toBe(metric.version.id);
  300 |     await page.screenshot({path:test.info().outputPath("source-visibility-fresh-native-chat.png"),fullPage:true});
  301 |   }finally{await db.$client.end({timeout:0});await f.restore({collectState:false});}
  302 | });
  303 | 
  304 | test("feature flag blocks new sends and resets while preserving existing history", async ({
  305 |   page,
  306 |   request,
  307 | }) => {
  308 |   const f = await setup(request, page);
  309 |   request = f.request;
  310 |   try {
  311 |     await page.goto(f.route);
  312 |     await send(page, "Visible history");
  313 |     const issue = await idle(request, f.chatPath);
  314 |     await json(
  315 |       await request.patch("/api/instance/settings/experimental", {
  316 |         data: { enableAgentChat: false },
  317 |       }),
  318 |     );
  319 |     for (const body of ["blocked message", "/new"])
  320 |       expect(
  321 |         (
  322 |           await request.post(`/api/issues/${issue.id}/comments`, {
  323 |             data: { body },
  324 |           })
  325 |         ).status(),
  326 |       ).toBe(404);
  327 |     await page.reload();
  328 |     await expect(page.getByText(/Agent Chat is disabled/)).toBeVisible();
  329 |     expect(
  330 |       (await json(await request.get(`/api/issues/${issue.id}/comments`))).some(
  331 |         (c: any) => c.body.includes("Visible history"),
  332 |       ),
  333 |     ).toBe(true);
  334 |     expect((await request.post(f.chatPath, { data: {} })).status()).toBe(404);
  335 |   } finally {
  336 |     await f.restore();
  337 |   }
  338 | });
  339 | 
```