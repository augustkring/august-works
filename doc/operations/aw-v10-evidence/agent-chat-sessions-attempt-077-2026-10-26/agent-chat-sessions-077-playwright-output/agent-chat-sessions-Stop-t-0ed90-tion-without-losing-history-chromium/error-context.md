# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-chat-sessions.spec.ts >> Stop then queued /new resets unpause the conversation without losing history
- Location: tests/e2e/agent-chat-sessions.spec.ts:311:1

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
          - button "Open Agent Chat 1793037144750 organization switcher" [ref=e12]:
            - generic [ref=e13]:
              - generic [ref=e14]: A
              - generic "Agent Chat 1793037144750" [ref=e17]
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
                    - /url: /AGEAAAAAA/agents/727b2f9e-73a7-44be-924d-a5c120f1431c/runtime
            - button "Hide properties" [ref=e204]
          - main [ref=e205]:
            - tabpanel [ref=e208]:
              - generic [ref=e210]:
                - generic [ref=e215]:
                  - generic [ref=e218]:
                    - paragraph [ref=e221]: fixture:eyJhY3Rpb24iOiJob2xkIn0
                    - generic [ref=e222]: 5:52 PM
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
  245 |     expect(metricSource).toMatchObject({kind:"tool_result",runId:run.id,callId:metricCapture.callId,toolName:"query_business_metric",invocationId:null,contentHash:metricCapture.resultDigest});
  246 |     const resultContextInputs=metricSourceSet.inputs.filter(input=>input.kind==="context");expect(resultContextInputs).toHaveLength(1);
  247 |     const resultContextId=resultContextInputs[0]!.manifestId as string;
  248 |     const [resultContext]=await db.select().from(contextManifests).where(eq(contextManifests.id,resultContextId));
  249 |     expect(resultContext).toMatchObject({companyId:f.company.id,runId:run.id,agentId:f.agent.id,issueId:original.id});
  250 |     const [execution]=await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId,run.id));expect(execution).toBeTruthy();
  251 |     expect(resultContextId).not.toBe(execution!.contextManifestId);
  252 |     const retainedContext=await db.select().from(contextManifestMemoryRoots).where(eq(contextManifestMemoryRoots.manifestId,resultContextId));expect(retainedContext.some(row=>row.memoryRecordId===retention!.id)).toBe(true);
  253 |     const bootstrapRoots=await db.select().from(contextManifestMemoryRoots).where(eq(contextManifestMemoryRoots.manifestId,execution!.contextManifestId));
  254 |     expect(bootstrapRoots.some(row=>row.memoryRecordId===retention!.id)).toBe(false);
  255 |     const receipt=profile.nativeInputSourceReceipt as {additionalInputs?:Array<{responsibleUserId:string;policy:unknown;inputs:Array<Record<string,any>>}>};
  256 |     expect(receipt.additionalInputs).toContainEqual({responsibleUserId:runRow!.responsibleUserId,policy:metricSourceSet.policy,inputs:[metricSource,...metricSourceSet.inputs]});
  257 |     const authority=await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.memoryRecordId,retention!.id)).then(rows=>rows[0]);
  258 |     expect(authority?.authorityPins).toContainEqual({kind:"analytical_evidence",source:{type:"metric_observation",id:observation!.id,metricId:metric.metric.id,metricVersionId:metric.version.id}});
  259 |     expect((await db.select().from(analyticalContextDependencies).where(eq(analyticalContextDependencies.memoryRecordId,retention!.id))).map(row=>row.sourceManifestId)).toContain(observation!.lineageManifestId);
  260 |     await page.goto(f.route);await expect(page.getByText("Private analytical history before source visibility changes",{exact:true})).toBeVisible();
  261 |     await json(await request.patch(`/api/issues/${source.id}`,{data:{hiddenAt:new Date().toISOString()}}));
  262 |     const denied=await request.get(f.chatPath);expect(denied.status()).toBe(403);expect((await denied.json()).details.conversationIssueId).toBe(original.id);
  263 |     await page.reload();await expect(page.getByRole("button",{name:"Start a new conversation"})).toBeVisible();
  264 |     await expect(page.getByText("Private analytical history before source visibility changes",{exact:true})).toHaveCount(0);
  265 |     await page.screenshot({path:test.info().outputPath("source-visibility-lost.png"),fullPage:true});
  266 |     await page.getByRole("button",{name:"Start a new conversation"}).click();await expect(page.getByTestId("task-chat-composer-input")).toBeVisible();
  267 |     const fresh=await json(await request.get(f.chatPath));expect(fresh.id).not.toBe(original.id);expect((await request.get(`/api/issues/${original.id}/comments`)).status()).toBe(403);
  268 |     expect((await db.select().from(memoryRecords).where(eq(memoryRecords.id,retention!.id)))[0]!.deletedAt).not.toBeNull();
  269 |     expect((await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.id,observation!.id)))[0]!.id).toBe(observation!.id);
  270 |     expect((await db.select().from(businessMetricVersions).where(eq(businessMetricVersions.id,metric.version.id)))[0]!.id).toBe(metric.version.id);
  271 |     await page.screenshot({path:test.info().outputPath("source-visibility-fresh-native-chat.png"),fullPage:true});
  272 |   }finally{await db.$client.end({timeout:0});await f.restore({collectState:false});}
  273 | });
  274 | 
  275 | test("feature flag blocks new sends and resets while preserving existing history", async ({
  276 |   page,
  277 |   request,
  278 | }) => {
  279 |   const f = await setup(request, page);
  280 |   request = f.request;
  281 |   try {
  282 |     await page.goto(f.route);
  283 |     await send(page, "Visible history");
  284 |     const issue = await idle(request, f.chatPath);
  285 |     await json(
  286 |       await request.patch("/api/instance/settings/experimental", {
  287 |         data: { enableAgentChat: false },
  288 |       }),
  289 |     );
  290 |     for (const body of ["blocked message", "/new"])
  291 |       expect(
  292 |         (
  293 |           await request.post(`/api/issues/${issue.id}/comments`, {
  294 |             data: { body },
  295 |           })
  296 |         ).status(),
  297 |       ).toBe(404);
  298 |     await page.reload();
  299 |     await expect(page.getByText(/Agent Chat is disabled/)).toBeVisible();
  300 |     expect(
  301 |       (await json(await request.get(`/api/issues/${issue.id}/comments`))).some(
  302 |         (c: any) => c.body.includes("Visible history"),
  303 |       ),
  304 |     ).toBe(true);
  305 |     expect((await request.post(f.chatPath, { data: {} })).status()).toBe(404);
  306 |   } finally {
  307 |     await f.restore();
  308 |   }
  309 | });
  310 | 
  311 | test("Stop then queued /new resets unpause the conversation without losing history", async ({
  312 |   page,
  313 |   request,
  314 | }) => {
  315 |   const f = await setup(request, page);
  316 |   request = f.request;
  317 |   try {
  318 |     await page.goto(f.route);
  319 |     await send(page, { action: "hold" });
  320 |     await expect
  321 |       .poll(async () => {
  322 |         const chat = await json(await request.get(f.chatPath));
  323 |         return (
  324 |           chat &&
  325 |           (
  326 |             await json(await request.get(`/api/issues/${chat.id}/comments`))
  327 |           ).some(
  328 |             (c: any) => c.body === "Provider is streaming and ready to stop.",
  329 |           )
  330 |         );
  331 |       })
> 332 |       .toBe(true);
      |        ^ Error: expect(received).toBe(expected) // Object.is equality
  333 |     const issue = await json(await request.get(f.chatPath));
  334 |     const active = (
  335 |       await json(await request.get(`/api/issues/${issue.id}/live-runs`))
  336 |     )[0];
  337 |     await page.getByTestId("task-chat-composer-stop").click();
  338 |     await expect
  339 |       .poll(
  340 |         async () =>
  341 |           (await json(await request.get(`/api/heartbeat-runs/${active.id}`)))
  342 |             .status,
  343 |       )
  344 |       .toBe("cancelled");
  345 |     const staleToken = createLocalAgentJwt(
  346 |       f.agent.id,
  347 |       f.company.id,
  348 |       "process",
  349 |       active.id,
  350 |     );
  351 |     expect(staleToken).toBeTruthy();
  352 |     const late = await request.post(`/api/issues/${issue.id}/comments`, {
  353 |       headers: { Authorization: `Bearer ${staleToken}` },
  354 |       data: { body: "Forbidden late response" },
  355 |     });
  356 |     expect([403, 409]).toContain(late.status());
  357 |     const mutation = await request.post(
  358 |       `/api/companies/${f.company.id}/projects`,
  359 |       {
  360 |         headers: { Authorization: `Bearer ${staleToken}` },
  361 |         data: { name: "Cancelled project" },
  362 |       },
  363 |     );
  364 |     expect([403, 409]).toContain(mutation.status());
  365 |     expect(
  366 |       await json(await request.get(`/api/companies/${f.company.id}/projects`)),
  367 |     ).toHaveLength(0);
  368 |     await send(page, "/new");
  369 |     await send(page, "/new");
  370 |     await send(page, "Fresh followup");
  371 |     await idle(request, f.chatPath, 2);
  372 |     const fresh = await json(await request.get(f.chatPath));
  373 |     expect(fresh.id).toBe(issue.id);
  374 |     expect(fresh.conversationSessionGeneration).toBe(2);
  375 |     await expect(
  376 |       page.getByText("Reply generation 2: Fresh followup", { exact: true }),
  377 |     ).toBeVisible();
  378 |     await page.reload();
  379 |     await expect(page.getByText("New session", { exact: true })).toHaveCount(2);
  380 |     await expect(
  381 |       page.getByRole("separator", { name: "Run completed", exact: true }),
  382 |     ).toHaveCount(0);
  383 |     const runs = await json(
  384 |       await request.get(`/api/companies/${f.company.id}/heartbeat-runs`),
  385 |     );
  386 |     const detailed = await Promise.all(
  387 |       runs.map((run: any) =>
  388 |         request.get(`/api/heartbeat-runs/${run.id}`).then(json),
  389 |       ),
  390 |     );
  391 |     expect(
  392 |       detailed.filter((run) => run.contextSnapshot?.conversationReset),
  393 |     ).toHaveLength(2);
  394 |     expect(
  395 |       detailed
  396 |         .filter((run) => run.contextSnapshot?.conversationReset)
  397 |         .every((run) => !run.sessionIdAfter),
  398 |     ).toBe(true);
  399 |   } finally {
  400 |     await f.restore();
  401 |   }
  402 | });
  403 | 
  404 | test("sidebar discovery, stars, recent agents, configuration links, and drafts survive switching", async ({
  405 |   page,
  406 |   request,
  407 | }) => {
  408 |   const f = await setup(request, page);
  409 |   request = f.request;
  410 |   try {
  411 |     await page.goto(`/${f.company.issuePrefix}/dashboard`);
  412 |     const nav = page.getByRole("navigation");
  413 |     const chatLinks = nav.locator('a[href*="/chats/"]');
  414 |     await expect(chatLinks).toHaveText(["Alpha"]);
  415 |     const compose = nav.getByRole("button", { name: "Chat with an agent", exact: true });
  416 |     await compose.click();
  417 |     const picker = page.getByRole("dialog", { name: "Choose a Co-worker to ask", exact: true });
  418 |     await expect(
  419 |       picker.getByRole("listbox", { name: "Suggestions" }).getByRole("option"),
  420 |     ).toHaveCount(6);
  421 |     const search = picker.getByRole("combobox", {
  422 |       name: "Search Co-workers by name or role",
  423 |     });
  424 |     await search.fill("Beta");
  425 |     await search.press("Enter");
  426 |     await expect(picker).not.toBeVisible();
  427 |     await expect(page.getByRole("link", { name: "Configure Beta", exact: true })).toBeVisible();
  428 |     expect(await json(await request.get(`/api/companies/${f.company.id}/chats/${f.agents[1].id}`))).toBeNull();
  429 |     for (const agent of f.agents) {
  430 |       await page.goto(`/${f.company.issuePrefix}/chats/${agent.id}`);
  431 |       await expect(page.getByTestId("task-chat-composer-input")).toBeVisible();
  432 |     }
```