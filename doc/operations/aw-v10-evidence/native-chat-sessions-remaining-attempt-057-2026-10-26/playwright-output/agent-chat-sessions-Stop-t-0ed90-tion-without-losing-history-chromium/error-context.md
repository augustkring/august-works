# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-chat-sessions.spec.ts >> Stop then queued /new resets unpause the conversation without losing history
- Location: tests/e2e/agent-chat-sessions.spec.ts:295:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 20000ms exceeded while waiting on the predicate
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
          - button "Open Agent Chat 1793025692780 organization switcher" [ref=e12]:
            - generic [ref=e13]:
              - generic [ref=e14]: A
              - generic "Agent Chat 1793025692780" [ref=e17]
          - navigation [ref=e18]:
            - generic [ref=e19]:
              - button "New Task" [ref=e20]
              - link "Search" [ref=e25] [cursor=pointer]:
                - /url: /AGEAAAAAA/search
              - link "Overview" [ref=e31] [cursor=pointer]:
                - /url: /AGEAAAAAA/dashboard
              - link "Agents" [ref=e39] [cursor=pointer]:
                - /url: /AGEAAAAAA/agents
              - link "Inbox 1" [ref=e47] [cursor=pointer]:
                - /url: /AGEAAAAAA/inbox
                - generic [ref=e53]: Inbox
                - generic [ref=e54]: "1"
            - generic [ref=e55]:
              - generic [ref=e57]:
                - button "Collapse Work" [expanded] [ref=e58]
                - generic [ref=e61]: Work
              - generic [ref=e64]:
                - link "Tasks" [ref=e65] [cursor=pointer]:
                  - /url: /AGEAAAAAA/issues
                - link "Routines" [ref=e71] [cursor=pointer]:
                  - /url: /AGEAAAAAA/routines
                - link "Management reviews" [ref=e79] [cursor=pointer]:
                  - /url: /AGEAAAAAA/management-reviews
                - link "Business metrics" [ref=e85] [cursor=pointer]:
                  - /url: /AGEAAAAAA/business-metrics
                - link "AI Governance" [ref=e92] [cursor=pointer]:
                  - /url: /AGEAAAAAA/ai-governance
                - link "Projects" [ref=e97] [cursor=pointer]:
                  - /url: /AGEAAAAAA/projects
                - link "Artifacts" [ref=e102] [cursor=pointer]:
                  - /url: /AGEAAAAAA/artifacts
            - generic [ref=e109]:
              - link "Connections" [ref=e110] [cursor=pointer]:
                - /url: /AGEAAAAAA/apps
              - link "Governance" [ref=e120] [cursor=pointer]:
                - /url: /AGEAAAAAA/governance
            - generic [ref=e126]:
              - generic [ref=e128]:
                - button "Collapse Advanced" [expanded] [ref=e129]
                - generic [ref=e132]: Advanced
              - generic [ref=e135]:
                - link "Skills" [ref=e136] [cursor=pointer]:
                  - /url: /AGEAAAAAA/skills
                - link "Audit" [ref=e149] [cursor=pointer]:
                  - /url: /AGEAAAAAA/activity
            - region "Chats" [ref=e156]:
              - generic [ref=e157]:
                - generic [ref=e158]: Chats
                - button "Chat with an agent" [ref=e159]
              - generic [ref=e160]:
                - link "Alpha" [ref=e161] [cursor=pointer]:
                  - /url: /AGEAAAAAA/chats/alpha
                - button "Star Alpha" [ref=e167]
        - button "Open account menu" [ref=e170]:
          - generic [ref=e171]: AR
          - generic [ref=e173]: Authenticated agent-chat reviewer
      - separator "Resize sidebar" [ref=e174]
    - generic [ref=e176]:
      - region "Global utilities" [ref=e178]:
        - generic [ref=e181]:
          - generic [ref=e182]: Language
          - combobox "Language" [ref=e183]:
            - option "English" [selected]
            - option "Dansk"
        - link "Help / Support" [ref=e184] [cursor=pointer]:
          - /url: /AGEAAAAAA/company/help
        - link "Contact support" [ref=e185] [cursor=pointer]:
          - /url: mailto:support@blentera.com
        - link "User account" [ref=e186] [cursor=pointer]:
          - /url: /AGEAAAAAA/company/settings/instance/profile
      - generic [ref=e190]:
        - generic [ref=e191]:
          - generic [ref=e192]:
            - navigation "breadcrumb" [ref=e194]:
              - list [ref=e195]:
                - listitem [ref=e196]:
                  - link "AL Alpha" [disabled] [ref=e197]:
                    - generic [ref=e198]: AL
                    - generic [ref=e201]: Alpha
                  - link "Configure Alpha" [ref=e203] [cursor=pointer]:
                    - /url: /AGEAAAAAA/agents/85194067-57ff-411b-bda8-a8ba0bb58161/runtime
            - button "Hide properties" [ref=e204]
          - main [ref=e205]:
            - tabpanel [ref=e208]:
              - generic [ref=e210]:
                - generic [ref=e215]:
                  - generic [ref=e218]:
                    - paragraph [ref=e221]: fixture:eyJhY3Rpb24iOiJob2xkIn0
                    - generic [ref=e222]: 2:41 PM
                  - separator "Run failed" [ref=e224]:
                    - generic [ref=e226]:
                      - generic [ref=e231]: Run failed
                      - generic [ref=e232]: · The run failed (adapter_failed). You can retry this message now.
                  - separator "Run failed" [ref=e235]:
                    - generic [ref=e237]:
                      - generic [ref=e242]: Run failed
                      - generic [ref=e243]: · The run failed (adapter_failed). You can retry this message now.
                      - button "Try again" [ref=e244]
                  - 'group "System update: No live execution path" [ref=e247]':
                    - generic [ref=e248]:
                      - button "No live execution path · just now" [ref=e249]:
                        - generic [ref=e252]: No live execution path
                        - generic [ref=e253]: · just now
                      - button "Try again" [ref=e256]
                - generic [ref=e260]:
                  - generic [ref=e264]:
                    - textbox "editable markdown" [ref=e266]:
                      - paragraph [ref=e267]
                    - generic:
                      - paragraph: Message Alpha — describe what you want done…
                  - generic [ref=e268]:
                    - button "Attach file" [ref=e269]
                    - button "Auto mode" [ref=e271]
                    - button "Send" [disabled] [ref=e274]
        - complementary [ref=e277]:
          - separator "Resize panel" [ref=e278]
          - region "Side panel" [ref=e281]:
            - generic [ref=e282]:
              - generic [ref=e285]:
                - tablist [ref=e286]:
                  - generic [ref=e289]:
                    - tab "Artifacts" [selected] [ref=e290]
                    - button "Close Artifacts" [ref=e292]
                  - status [ref=e296]
                - button "Open a new tab" [ref=e298]
              - generic [ref=e300]:
                - button "Maximize side panel" [ref=e301]
                - button "Close side panel" [ref=e302]
            - tabpanel "Artifacts" [ref=e305]:
              - generic [ref=e306]: No artifacts yet. Work products, documents, and agent-produced files will appear here.
  - generic [ref=e307]:
    - heading "Command Palette" [level=2] [ref=e308]
    - paragraph [ref=e309]: Search for a command to run...
```

# Test source

```ts
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
  240 |     const retainedContext=await db.select().from(contextManifestMemoryRoots).where(eq(contextManifestMemoryRoots.manifestId,context!.id));expect(retainedContext.some(row=>row.memoryRecordId===retention!.id)).toBe(true);
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
> 316 |       .toBe(true);
      |        ^ Error: expect(received).toBe(expected) // Object.is equality
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
  341 |     const mutation = await request.post(
  342 |       `/api/companies/${f.company.id}/projects`,
  343 |       {
  344 |         headers: { Authorization: `Bearer ${staleToken}` },
  345 |         data: { name: "Cancelled project" },
  346 |       },
  347 |     );
  348 |     expect([403, 409]).toContain(mutation.status());
  349 |     expect(
  350 |       await json(await request.get(`/api/companies/${f.company.id}/projects`)),
  351 |     ).toHaveLength(0);
  352 |     await send(page, "/new");
  353 |     await send(page, "/new");
  354 |     await send(page, "Fresh followup");
  355 |     await idle(request, f.chatPath, 2);
  356 |     const fresh = await json(await request.get(f.chatPath));
  357 |     expect(fresh.id).toBe(issue.id);
  358 |     expect(fresh.conversationSessionGeneration).toBe(2);
  359 |     await expect(
  360 |       page.getByText("Reply generation 2: Fresh followup", { exact: true }),
  361 |     ).toBeVisible();
  362 |     await page.reload();
  363 |     await expect(page.getByText("New session", { exact: true })).toHaveCount(2);
  364 |     await expect(
  365 |       page.getByRole("separator", { name: "Run completed", exact: true }),
  366 |     ).toHaveCount(0);
  367 |     const runs = await json(
  368 |       await request.get(`/api/companies/${f.company.id}/heartbeat-runs`),
  369 |     );
  370 |     const detailed = await Promise.all(
  371 |       runs.map((run: any) =>
  372 |         request.get(`/api/heartbeat-runs/${run.id}`).then(json),
  373 |       ),
  374 |     );
  375 |     expect(
  376 |       detailed.filter((run) => run.contextSnapshot?.conversationReset),
  377 |     ).toHaveLength(2);
  378 |     expect(
  379 |       detailed
  380 |         .filter((run) => run.contextSnapshot?.conversationReset)
  381 |         .every((run) => !run.sessionIdAfter),
  382 |     ).toBe(true);
  383 |   } finally {
  384 |     await f.restore();
  385 |   }
  386 | });
  387 | 
  388 | test("sidebar discovery, stars, recent agents, configuration links, and drafts survive switching", async ({
  389 |   page,
  390 |   request,
  391 | }) => {
  392 |   const f = await setup(request, page);
  393 |   request = f.request;
  394 |   try {
  395 |     await page.goto(`/${f.company.issuePrefix}/dashboard`);
  396 |     const nav = page.getByRole("navigation");
  397 |     const chatLinks = nav.locator('a[href*="/chats/"]');
  398 |     await expect(chatLinks).toHaveText(["Alpha"]);
  399 |     const compose = nav.getByRole("button", { name: "Chat with an agent", exact: true });
  400 |     await compose.click();
  401 |     const picker = page.getByRole("dialog", { name: "Choose a Co-worker to ask", exact: true });
  402 |     await expect(
  403 |       picker.getByRole("listbox", { name: "Suggestions" }).getByRole("option"),
  404 |     ).toHaveCount(6);
  405 |     const search = picker.getByRole("combobox", {
  406 |       name: "Search Co-workers by name or role",
  407 |     });
  408 |     await search.fill("Beta");
  409 |     await search.press("Enter");
  410 |     await expect(picker).not.toBeVisible();
  411 |     await expect(page.getByRole("link", { name: "Configure Beta", exact: true })).toBeVisible();
  412 |     expect(await json(await request.get(`/api/companies/${f.company.id}/chats/${f.agents[1].id}`))).toBeNull();
  413 |     for (const agent of f.agents) {
  414 |       await page.goto(`/${f.company.issuePrefix}/chats/${agent.id}`);
  415 |       await expect(page.getByTestId("task-chat-composer-input")).toBeVisible();
  416 |     }
```