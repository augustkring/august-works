# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-chat-sessions.spec.ts >> Stop then queued /new resets unpause the conversation without losing history
- Location: tests/e2e/agent-chat-sessions.spec.ts:342:1

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
          - button "Open Agent Chat 1793051256707 organization switcher" [ref=e12]:
            - generic [ref=e13]:
              - generic [ref=e14]: A
              - generic "Agent Chat 1793051256707" [ref=e17]
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
                    - /url: /AGEAAAAAA/agents/40d29e19-0cfa-4b30-9754-4121d83db0e1/runtime
            - button "Hide properties" [ref=e204]
          - main [ref=e205]:
            - tabpanel [ref=e208]:
              - generic [ref=e210]:
                - generic [ref=e215]:
                  - generic [ref=e218]:
                    - paragraph [ref=e221]: fixture:eyJhY3Rpb24iOiJob2xkIn0
                    - generic [ref=e222]: 9:47 PM
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
  298 |     const fresh=await json(await request.get(f.chatPath));expect(fresh.id).not.toBe(original.id);expect((await request.get(`/api/issues/${original.id}/comments`)).status()).toBe(404);
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
> 363 |       .toBe(true);
      |        ^ Error: expect(received).toBe(expected) // Object.is equality
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
  399 |     await send(page, "/new");
  400 |     await send(page, "/new");
  401 |     await send(page, "Fresh followup");
  402 |     await idle(request, f.chatPath, 2);
  403 |     const fresh = await json(await request.get(f.chatPath));
  404 |     expect(fresh.id).toBe(issue.id);
  405 |     expect(fresh.conversationSessionGeneration).toBe(2);
  406 |     await expect(
  407 |       page.getByText("Reply generation 2: Fresh followup", { exact: true }),
  408 |     ).toBeVisible();
  409 |     await page.reload();
  410 |     await expect(page.getByText("New session", { exact: true })).toHaveCount(2);
  411 |     await expect(
  412 |       page.getByRole("separator", { name: "Run completed", exact: true }),
  413 |     ).toHaveCount(0);
  414 |     const runs = await json(
  415 |       await request.get(`/api/companies/${f.company.id}/heartbeat-runs`),
  416 |     );
  417 |     const detailed = await Promise.all(
  418 |       runs.map((run: any) =>
  419 |         request.get(`/api/heartbeat-runs/${run.id}`).then(json),
  420 |       ),
  421 |     );
  422 |     expect(
  423 |       detailed.filter((run) => run.contextSnapshot?.conversationReset),
  424 |     ).toHaveLength(2);
  425 |     expect(
  426 |       detailed
  427 |         .filter((run) => run.contextSnapshot?.conversationReset)
  428 |         .every((run) => !run.sessionIdAfter),
  429 |     ).toBe(true);
  430 |   } finally {
  431 |     await f.restore();
  432 |   }
  433 | });
  434 | 
  435 | test("sidebar discovery, stars, recent agents, configuration links, and drafts survive switching", async ({
  436 |   page,
  437 |   request,
  438 | }) => {
  439 |   const f = await setup(request, page);
  440 |   request = f.request;
  441 |   try {
  442 |     await page.goto(`/${f.company.issuePrefix}/dashboard`);
  443 |     const nav = page.getByRole("navigation");
  444 |     const chatLinks = nav.locator('a[href*="/chats/"]');
  445 |     await expect(chatLinks).toHaveText(["Alpha"]);
  446 |     const compose = nav.getByRole("button", { name: "Chat with an agent", exact: true });
  447 |     await compose.click();
  448 |     const picker = page.getByRole("dialog", { name: "Choose a Co-worker to ask", exact: true });
  449 |     await expect(
  450 |       picker.getByRole("listbox", { name: "Suggestions" }).getByRole("option"),
  451 |     ).toHaveCount(6);
  452 |     const search = picker.getByRole("combobox", {
  453 |       name: "Search Co-workers by name or role",
  454 |     });
  455 |     await search.fill("Beta");
  456 |     await search.press("Enter");
  457 |     await expect(picker).not.toBeVisible();
  458 |     await expect(page.getByRole("link", { name: "Configure Beta", exact: true })).toBeVisible();
  459 |     expect(await json(await request.get(`/api/companies/${f.company.id}/chats/${f.agents[1].id}`))).toBeNull();
  460 |     for (const agent of f.agents) {
  461 |       await page.goto(`/${f.company.issuePrefix}/chats/${agent.id}`);
  462 |       await expect(page.getByTestId("task-chat-composer-input")).toBeVisible();
  463 |     }
```