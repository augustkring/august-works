# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-chat-sessions.spec.ts >> an owner can explicitly recover after source visibility is lost while original metric facts survive
- Location: tests/e2e/agent-chat-sessions.spec.ts:212:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
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
          - button "Open Agent Chat 1793036241408 organization switcher" [ref=e12]:
            - generic [ref=e13]:
              - generic [ref=e14]: A
              - generic "Agent Chat 1793036241408" [ref=e17]
          - navigation [ref=e18]:
            - generic [ref=e19]:
              - button "New Task" [ref=e20]
              - link "Search" [ref=e25] [cursor=pointer]:
                - /url: /AGEAAAA/search
              - link "Overview" [ref=e31] [cursor=pointer]:
                - /url: /AGEAAAA/dashboard
              - link "Agents" [ref=e39] [cursor=pointer]:
                - /url: /AGEAAAA/agents
              - link "Inbox" [ref=e47] [cursor=pointer]:
                - /url: /AGEAAAA/inbox
            - generic [ref=e53]:
              - generic [ref=e55]:
                - button "Collapse Work" [expanded] [ref=e56]
                - generic [ref=e59]: Work
              - generic [ref=e62]:
                - link "Tasks" [ref=e63] [cursor=pointer]:
                  - /url: /AGEAAAA/issues
                - link "Routines" [ref=e69] [cursor=pointer]:
                  - /url: /AGEAAAA/routines
                - link "Management reviews" [ref=e77] [cursor=pointer]:
                  - /url: /AGEAAAA/management-reviews
                - link "Business metrics" [ref=e83] [cursor=pointer]:
                  - /url: /AGEAAAA/business-metrics
                - link "AI Governance" [ref=e90] [cursor=pointer]:
                  - /url: /AGEAAAA/ai-governance
                - link "Projects" [ref=e95] [cursor=pointer]:
                  - /url: /AGEAAAA/projects
                - link "Artifacts" [ref=e100] [cursor=pointer]:
                  - /url: /AGEAAAA/artifacts
            - generic [ref=e107]:
              - link "Connections" [ref=e108] [cursor=pointer]:
                - /url: /AGEAAAA/apps
              - link "Governance" [ref=e118] [cursor=pointer]:
                - /url: /AGEAAAA/governance
            - generic [ref=e124]:
              - generic [ref=e126]:
                - button "Collapse Advanced" [expanded] [ref=e127]
                - generic [ref=e130]: Advanced
              - generic [ref=e133]:
                - link "Skills" [ref=e134] [cursor=pointer]:
                  - /url: /AGEAAAA/skills
                - link "Audit" [ref=e147] [cursor=pointer]:
                  - /url: /AGEAAAA/activity
            - region "Chats" [ref=e154]:
              - generic [ref=e155]:
                - generic [ref=e156]: Chats
                - button "Chat with an agent" [ref=e157]
              - generic [ref=e158]:
                - link "Alpha" [ref=e159] [cursor=pointer]:
                  - /url: /AGEAAAA/chats/alpha
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
          - /url: /AGEAAAA/company/help
        - link "Contact support" [ref=e183] [cursor=pointer]:
          - /url: mailto:support@blentera.com
        - link "User account" [ref=e184] [cursor=pointer]:
          - /url: /AGEAAAA/company/settings/instance/profile
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
                    - /url: /AGEAAAA/agents/c8e0204c-4a4b-4631-b7a6-abddea9fa0ea/runtime
            - button "Hide properties" [ref=e202]
          - main [active] [ref=e203]:
            - tabpanel [ref=e206]:
              - generic [ref=e208]:
                - generic [ref=e213]:
                  - generic [ref=e216]:
                    - paragraph [ref=e219]: Private analytical history before source visibility changes
                    - generic [ref=e220]: 5:37 PM
                  - generic [ref=e222]:
                    - generic [ref=e224]:
                      - generic [ref=e225]:
                        - generic [ref=e226]: Alpha
                        - generic [ref=e230]: Worked for 9s
                      - button "Expand read files (2 activities)" [ref=e235]:
                        - generic "Read files" [ref=e240]
                    - paragraph [ref=e246]: "Reply generation 0: Private analytical history before source visibility changes"
                    - generic [ref=e247]:
                      - generic [ref=e248]: 5:37 PM
                      - generic [ref=e249]:
                        - button "Copy message" [ref=e250]
                        - button "Helpful" [ref=e254]
                        - button "Needs work" [ref=e257]
                  - generic [ref=e261]:
                    - paragraph [ref=e264]: fixture:eyJhY3Rpb24iOiJtZXRyaWMiLCJtZXRyaWNJZCI6IjQ1YTI5MmM3LWI1ODctNDRhMS1hZjE1LTQ1ZGM1ODU5OTkwMSIsInZlcnNpb25JZCI6ImIzZjRmNjViLThmMzItNDFkZi1hZjc4LTQ3YjZhNmUxYzBkMiIsImZyb20iOiIyMDI2LTEwLTI1VDE3OjM3OjMzLjA1MVoiLCJ1bnRpbCI6IjIwMjYtMTAtMjZUMTc6Mzc6MzQuMDUxWiJ9
                    - generic [ref=e265]: 5:37 PM
                  - generic [ref=e267]:
                    - generic [ref=e269]:
                      - generic [ref=e270]:
                        - generic [ref=e271]: Alpha
                        - generic [ref=e275]: Worked for 16s
                      - button "Expand read files, searched files (3 activities)" [ref=e280]:
                        - generic "Read files, searched files" [ref=e287]
                    - paragraph [ref=e293]: Observed a current native business metric.
                    - generic [ref=e294]:
                      - generic [ref=e295]: 5:37 PM
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
  140 |     expect(
  141 |       await json(
  142 |         await request.get(`/api/companies/${f.company.id}/heartbeat-runs`),
  143 |       ),
  144 |     ).toHaveLength(count);
  145 |   } finally {
  146 |     await f.restore();
  147 |   }
  148 | });
  149 | 
  150 | // UI response-contract fixture; original source erasure and fresh native SDK
  151 | // admission are separately exercised against PostgreSQL, without this routing.
  152 | test("source loss refreshes the read-only chat identity and drops cached history before another send", async ({ page, request }) => {
  153 |   const f = await setup(request, page);
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
  238 |     const context=await db.select().from(contextManifests).where(eq(contextManifests.runId,run.id)).then(rows=>rows[0]);expect(context).toBeTruthy();
  239 |     const retention=await db.select().from(memoryRecords).where(eq(memoryRecords.createdByActorId,"native_analytical_retention")).then(rows=>rows.find(row=>row.companyId===f.company.id&&row.ownerAgentId===f.agent.id));expect(retention).toBeTruthy();
> 240 |     const retainedContext=await db.select().from(contextManifestMemoryRoots).where(eq(contextManifestMemoryRoots.manifestId,context!.id));expect(retainedContext.some(row=>row.memoryRecordId===retention!.id)).toBe(true);
      |                                                                                                                                                                                                                 ^ Error: expect(received).toBe(expected) // Object.is equality
  241 |     const authority=await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.memoryRecordId,retention!.id)).then(rows=>rows[0]);
  242 |     expect(authority?.authorityPins).toContainEqual({kind:"analytical_evidence",source:{type:"metric_observation",id:observation!.id,metricId:metric.metric.id,metricVersionId:metric.version.id}});
  243 |     expect((await db.select().from(analyticalContextDependencies).where(eq(analyticalContextDependencies.memoryRecordId,retention!.id))).map(row=>row.sourceManifestId)).toContain(observation!.lineageManifestId);
  244 |     await page.goto(f.route);await expect(page.getByText("Private analytical history before source visibility changes",{exact:true})).toBeVisible();
  245 |     await json(await request.patch(`/api/issues/${source.id}`,{data:{hiddenAt:new Date().toISOString()}}));
  246 |     const denied=await request.get(f.chatPath);expect(denied.status()).toBe(403);expect((await denied.json()).details.conversationIssueId).toBe(original.id);
  247 |     await page.reload();await expect(page.getByRole("button",{name:"Start a new conversation"})).toBeVisible();
  248 |     await expect(page.getByText("Private analytical history before source visibility changes",{exact:true})).toHaveCount(0);
  249 |     await page.screenshot({path:test.info().outputPath("source-visibility-lost.png"),fullPage:true});
  250 |     await page.getByRole("button",{name:"Start a new conversation"}).click();await expect(page.getByTestId("task-chat-composer-input")).toBeVisible();
  251 |     const fresh=await json(await request.get(f.chatPath));expect(fresh.id).not.toBe(original.id);expect((await request.get(`/api/issues/${original.id}/comments`)).status()).toBe(403);
  252 |     expect((await db.select().from(memoryRecords).where(eq(memoryRecords.id,retention!.id)))[0]!.deletedAt).not.toBeNull();
  253 |     expect((await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.id,observation!.id)))[0]!.id).toBe(observation!.id);
  254 |     expect((await db.select().from(businessMetricVersions).where(eq(businessMetricVersions.id,metric.version.id)))[0]!.id).toBe(metric.version.id);
  255 |     await page.screenshot({path:test.info().outputPath("source-visibility-fresh-native-chat.png"),fullPage:true});
  256 |   }finally{await db.$client.end({timeout:0});await f.restore({collectState:false});}
  257 | });
  258 | 
  259 | test("feature flag blocks new sends and resets while preserving existing history", async ({
  260 |   page,
  261 |   request,
  262 | }) => {
  263 |   const f = await setup(request, page);
  264 |   request = f.request;
  265 |   try {
  266 |     await page.goto(f.route);
  267 |     await send(page, "Visible history");
  268 |     const issue = await idle(request, f.chatPath);
  269 |     await json(
  270 |       await request.patch("/api/instance/settings/experimental", {
  271 |         data: { enableAgentChat: false },
  272 |       }),
  273 |     );
  274 |     for (const body of ["blocked message", "/new"])
  275 |       expect(
  276 |         (
  277 |           await request.post(`/api/issues/${issue.id}/comments`, {
  278 |             data: { body },
  279 |           })
  280 |         ).status(),
  281 |       ).toBe(404);
  282 |     await page.reload();
  283 |     await expect(page.getByText(/Agent Chat is disabled/)).toBeVisible();
  284 |     expect(
  285 |       (await json(await request.get(`/api/issues/${issue.id}/comments`))).some(
  286 |         (c: any) => c.body.includes("Visible history"),
  287 |       ),
  288 |     ).toBe(true);
  289 |     expect((await request.post(f.chatPath, { data: {} })).status()).toBe(404);
  290 |   } finally {
  291 |     await f.restore();
  292 |   }
  293 | });
  294 | 
  295 | test("Stop then queued /new resets unpause the conversation without losing history", async ({
  296 |   page,
  297 |   request,
  298 | }) => {
  299 |   const f = await setup(request, page);
  300 |   request = f.request;
  301 |   try {
  302 |     await page.goto(f.route);
  303 |     await send(page, { action: "hold" });
  304 |     await expect
  305 |       .poll(async () => {
  306 |         const chat = await json(await request.get(f.chatPath));
  307 |         return (
  308 |           chat &&
  309 |           (
  310 |             await json(await request.get(`/api/issues/${chat.id}/comments`))
  311 |           ).some(
  312 |             (c: any) => c.body === "Provider is streaming and ready to stop.",
  313 |           )
  314 |         );
  315 |       })
  316 |       .toBe(true);
  317 |     const issue = await json(await request.get(f.chatPath));
  318 |     const active = (
  319 |       await json(await request.get(`/api/issues/${issue.id}/live-runs`))
  320 |     )[0];
  321 |     await page.getByTestId("task-chat-composer-stop").click();
  322 |     await expect
  323 |       .poll(
  324 |         async () =>
  325 |           (await json(await request.get(`/api/heartbeat-runs/${active.id}`)))
  326 |             .status,
  327 |       )
  328 |       .toBe("cancelled");
  329 |     const staleToken = createLocalAgentJwt(
  330 |       f.agent.id,
  331 |       f.company.id,
  332 |       "process",
  333 |       active.id,
  334 |     );
  335 |     expect(staleToken).toBeTruthy();
  336 |     const late = await request.post(`/api/issues/${issue.id}/comments`, {
  337 |       headers: { Authorization: `Bearer ${staleToken}` },
  338 |       data: { body: "Forbidden late response" },
  339 |     });
  340 |     expect([403, 409]).toContain(late.status());
```