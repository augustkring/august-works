# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-chat-sessions.spec.ts >> sidebar discovery, stars, recent agents, configuration links, and drafts survive switching
- Location: tests/e2e/agent-chat-sessions.spec.ts:385:1

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByRole('dialog', { name: 'Chat with an agent', exact: true }).getByRole('option')
Expected: 6
Received: 0
Timeout:  20000ms

Call log:
  - Expect "toHaveCount" with timeout 20000ms
  - waiting for getByRole('dialog', { name: 'Chat with an agent', exact: true }).getByRole('option')
    44 × locator resolved to 0 elements
       - unexpected value "0"

```

# Page snapshot

```yaml
- generic:
  - generic:
    - generic:
      - generic:
        - link:
          - /url: "#main-content"
          - text: Skip to Main Content
        - generic:
          - generic:
            - generic:
              - generic:
                - complementary:
                  - generic:
                    - button:
                      - generic:
                        - generic: A
                        - generic: Agent Chat 1793021096151
                  - navigation:
                    - generic:
                      - button:
                        - generic: New Task
                      - link:
                        - /url: /AGEAA/search
                        - generic: Search
                      - link:
                        - /url: /AGEAA/dashboard
                        - generic: Overview
                      - link:
                        - /url: /AGEAA/agents
                        - generic: Agents
                      - link:
                        - /url: /AGEAA/inbox
                        - generic: Inbox
                    - generic:
                      - generic:
                        - generic:
                          - button [expanded]
                          - generic: Work
                      - generic:
                        - generic:
                          - link:
                            - /url: /AGEAA/issues
                            - generic: Tasks
                          - link:
                            - /url: /AGEAA/routines
                            - generic: Routines
                          - link:
                            - /url: /AGEAA/projects
                            - generic: Projects
                          - link:
                            - /url: /AGEAA/artifacts
                            - generic: Artifacts
                    - generic:
                      - link:
                        - /url: /AGEAA/apps
                        - generic: Connections
                      - link:
                        - /url: /AGEAA/governance
                        - generic: Governance
                    - generic:
                      - generic:
                        - generic:
                          - button [expanded]
                          - generic: Advanced
                      - generic:
                        - generic:
                          - link:
                            - /url: /AGEAA/skills
                            - generic: Skills
                          - link:
                            - /url: /AGEAA/activity
                            - generic: Audit
                    - region:
                      - generic:
                        - generic: Chats
                        - button
                      - generic:
                        - link:
                          - /url: /AGEAA/chats/alpha
                          - generic: Alpha
                        - button
              - generic:
                - generic:
                  - button:
                    - generic: AR
                    - generic: Authenticated agent-chat reviewer
            - separator
          - generic:
            - generic:
              - region:
                - generic:
                  - generic:
                    - generic:
                      - generic: Language
                      - combobox
                - link:
                  - /url: /AGEAA/company/help
                  - text: Help / Support
                - link:
                  - /url: mailto:support@blentera.com
                  - text: Contact support
                - link:
                  - /url: /AGEAA/company/settings/instance/profile
              - generic:
                - generic:
                  - generic:
                    - heading [level=1]: Dashboard
            - generic:
              - generic:
                - main:
                  - generic:
                    - generic:
                      - heading [level=3]: Agents
                      - generic:
                        - paragraph: No recent agent runs.
                    - generic:
                      - link:
                        - /url: /AGEAA/agents
                        - generic:
                          - generic:
                            - generic:
                              - paragraph: "6"
                              - paragraph: Agents Enabled
                              - generic: 0 running, 0 paused, 0 errors
                      - link:
                        - /url: /AGEAA/issues
                        - generic:
                          - generic:
                            - generic:
                              - paragraph: "0"
                              - paragraph: Tasks In Progress
                              - generic: 0 open, 0 blocked
                      - link:
                        - /url: /AGEAA/costs
                        - generic:
                          - generic:
                            - generic:
                              - paragraph: $0.00
                              - paragraph: Month Spend
                              - generic: Unlimited budget
                      - link:
                        - /url: /AGEAA/approvals
                        - generic:
                          - generic:
                            - generic:
                              - paragraph: "0"
                              - paragraph: Pending Approvals
                              - generic: Awaiting board review
                    - generic:
                      - generic:
                        - generic:
                          - heading [level=3]: Run Activity
                          - text: Last 14 days
                        - paragraph: No runs yet
                      - generic:
                        - generic:
                          - heading [level=3]: Tasks by Status
                          - text: Last 14 days
                        - paragraph: No tasks
                      - generic:
                        - generic:
                          - heading [level=3]: Success Rate
                          - text: Last 14 days
                        - paragraph: No runs yet
                    - generic:
                      - generic:
                        - heading [level=3]: Recent Activity
                        - generic:
                          - link:
                            - /url: /AGEAA/agents/95859390-9c39-40fe-b212-743fb8e280fd
                            - generic:
                              - generic:
                                - generic: AR
                                - generic:
                                  - generic:
                                    - paragraph:
                                      - generic: Authenticated agent-chat reviewer created
                                      - generic: Zeta
                                  - generic: just now
                          - link:
                            - /url: /AGEAA/agents/06ef449e-8161-4242-9c5b-04830cc83b43
                            - generic:
                              - generic:
                                - generic: AR
                                - generic:
                                  - generic:
                                    - paragraph:
                                      - generic: Authenticated agent-chat reviewer created
                                      - generic: Epsilon
                                  - generic: just now
                          - link:
                            - /url: /AGEAA/agents/9e0260a8-d522-43b6-bda0-2b2f49869e9b
                            - generic:
                              - generic:
                                - generic: AR
                                - generic:
                                  - generic:
                                    - paragraph:
                                      - generic: Authenticated agent-chat reviewer created
                                      - generic: Delta
                                  - generic: just now
                          - link:
                            - /url: /AGEAA/agents/6fee77d0-3f2c-45dd-9074-db9b5ff6db99
                            - generic:
                              - generic:
                                - generic: AR
                                - generic:
                                  - generic:
                                    - paragraph:
                                      - generic: Authenticated agent-chat reviewer created
                                      - generic: Gamma
                                  - generic: just now
                          - link:
                            - /url: /AGEAA/agents/3a120343-ee23-4cd5-ae2a-2ba2bda7ea3a
                            - generic:
                              - generic:
                                - generic: AR
                                - generic:
                                  - generic:
                                    - paragraph:
                                      - generic: Authenticated agent-chat reviewer created
                                      - generic: Beta
                                  - generic: just now
                          - link:
                            - /url: /AGEAA/agents/e45792c2-66f7-4615-a943-7eb31b073599
                            - generic:
                              - generic:
                                - generic: AR
                                - generic:
                                  - generic:
                                    - paragraph:
                                      - generic: Authenticated agent-chat reviewer created
                                      - generic: Alpha
                                  - generic: just now
                          - generic:
                            - generic:
                              - generic:
                                - generic: AR
                                - generic:
                                  - generic:
                                    - paragraph:
                                      - generic: Authenticated agent-chat reviewer instance settings experimental updated
                                  - generic: just now
                          - generic:
                            - generic:
                              - generic:
                                - generic: AR
                                - generic:
                                  - generic:
                                    - paragraph:
                                      - generic: Authenticated agent-chat reviewer created organization
                                  - generic: just now
                      - generic:
                        - heading [level=3]: Recent Tasks
                        - generic:
                          - paragraph: No tasks yet.
        - generic:
          - heading [level=2]: Command Palette
          - paragraph: Search for a command to run...
  - dialog [ref=e2]:
    - heading "Choose a Co-worker to ask" [level=2] [ref=e4]
    - generic [ref=e5]:
      - combobox "Search Co-workers by name or role" [expanded] [active] [ref=e11]
      - listbox "Suggestions" [ref=e12]:
        - group [ref=e14]:
          - option "Epsilon general" [selected] [ref=e15]:
            - generic [ref=e16]:
              - generic [ref=e17]: Epsilon
              - generic [ref=e18]: general
          - option "Beta general" [ref=e19]:
            - generic [ref=e20]:
              - generic [ref=e21]: Beta
              - generic [ref=e22]: general
          - option "Gamma general" [ref=e23]:
            - generic [ref=e24]:
              - generic [ref=e25]: Gamma
              - generic [ref=e26]: general
          - option "Zeta general" [ref=e27]:
            - generic [ref=e28]:
              - generic [ref=e29]: Zeta
              - generic [ref=e30]: general
          - option "Delta general" [ref=e31]:
            - generic [ref=e32]:
              - generic [ref=e33]: Delta
              - generic [ref=e34]: general
          - option "Alpha general" [ref=e35]:
            - generic [ref=e36]:
              - generic [ref=e37]: Alpha
              - generic [ref=e38]: general
      - generic [ref=e39]:
        - generic [ref=e40]: Set as preferred Co-worker
        - combobox "Set as preferred Co-worker" [ref=e41]:
          - option "Ask me to choose each time" [selected]
          - option "Epsilon — general"
          - option "Beta — general"
          - option "Gamma — general"
          - option "Zeta — general"
          - option "Delta — general"
          - option "Alpha — general"
    - button "Close" [ref=e42]
```

# Test source

```ts
  299 |     await page.goto(f.route);
  300 |     await send(page, { action: "hold" });
  301 |     await expect
  302 |       .poll(async () => {
  303 |         const chat = await json(await request.get(f.chatPath));
  304 |         return (
  305 |           chat &&
  306 |           (
  307 |             await json(await request.get(`/api/issues/${chat.id}/comments`))
  308 |           ).some(
  309 |             (c: any) => c.body === "Provider is streaming and ready to stop.",
  310 |           )
  311 |         );
  312 |       })
  313 |       .toBe(true);
  314 |     const issue = await json(await request.get(f.chatPath));
  315 |     const active = (
  316 |       await json(await request.get(`/api/issues/${issue.id}/live-runs`))
  317 |     )[0];
  318 |     await page.getByTestId("task-chat-composer-stop").click();
  319 |     await expect
  320 |       .poll(
  321 |         async () =>
  322 |           (await json(await request.get(`/api/heartbeat-runs/${active.id}`)))
  323 |             .status,
  324 |       )
  325 |       .toBe("cancelled");
  326 |     const staleToken = createLocalAgentJwt(
  327 |       f.agent.id,
  328 |       f.company.id,
  329 |       "process",
  330 |       active.id,
  331 |     );
  332 |     expect(staleToken).toBeTruthy();
  333 |     const late = await request.post(`/api/issues/${issue.id}/comments`, {
  334 |       headers: { Authorization: `Bearer ${staleToken}` },
  335 |       data: { body: "Forbidden late response" },
  336 |     });
  337 |     expect([403, 409]).toContain(late.status());
  338 |     const mutation = await request.post(
  339 |       `/api/companies/${f.company.id}/projects`,
  340 |       {
  341 |         headers: { Authorization: `Bearer ${staleToken}` },
  342 |         data: { name: "Cancelled project" },
  343 |       },
  344 |     );
  345 |     expect([403, 409]).toContain(mutation.status());
  346 |     expect(
  347 |       await json(await request.get(`/api/companies/${f.company.id}/projects`)),
  348 |     ).toHaveLength(0);
  349 |     await send(page, "/new");
  350 |     await send(page, "/new");
  351 |     await send(page, "Fresh followup");
  352 |     await idle(request, f.chatPath, 2);
  353 |     const fresh = await json(await request.get(f.chatPath));
  354 |     expect(fresh.id).toBe(issue.id);
  355 |     expect(fresh.conversationSessionGeneration).toBe(2);
  356 |     await expect(
  357 |       page.getByText("Reply generation 2: Fresh followup", { exact: true }),
  358 |     ).toBeVisible();
  359 |     await page.reload();
  360 |     await expect(page.getByText("New session", { exact: true })).toHaveCount(2);
  361 |     await expect(
  362 |       page.getByRole("separator", { name: "Run completed", exact: true }),
  363 |     ).toHaveCount(0);
  364 |     const runs = await json(
  365 |       await request.get(`/api/companies/${f.company.id}/heartbeat-runs`),
  366 |     );
  367 |     const detailed = await Promise.all(
  368 |       runs.map((run: any) =>
  369 |         request.get(`/api/heartbeat-runs/${run.id}`).then(json),
  370 |       ),
  371 |     );
  372 |     expect(
  373 |       detailed.filter((run) => run.contextSnapshot?.conversationReset),
  374 |     ).toHaveLength(2);
  375 |     expect(
  376 |       detailed
  377 |         .filter((run) => run.contextSnapshot?.conversationReset)
  378 |         .every((run) => !run.sessionIdAfter),
  379 |     ).toBe(true);
  380 |   } finally {
  381 |     await f.restore();
  382 |   }
  383 | });
  384 | 
  385 | test("sidebar discovery, stars, recent agents, configuration links, and drafts survive switching", async ({
  386 |   page,
  387 |   request,
  388 | }) => {
  389 |   const f = await setup(request, page);
  390 |   request = f.request;
  391 |   try {
  392 |     await page.goto(`/${f.company.issuePrefix}/dashboard`);
  393 |     const nav = page.getByRole("navigation");
  394 |     const chatLinks = nav.locator('a[href*="/chats/"]');
  395 |     await expect(chatLinks).toHaveText(["Alpha"]);
  396 |     const compose = nav.getByRole("button", { name: "Chat with an agent", exact: true });
  397 |     await compose.click();
  398 |     const picker = page.getByRole("dialog", { name: "Chat with an agent", exact: true });
> 399 |     await expect(picker.getByRole("option")).toHaveCount(6);
      |                                              ^ Error: expect(locator).toHaveCount(expected) failed
  400 |     await picker.getByRole("combobox").fill("Beta");
  401 |     await picker.getByRole("combobox").press("Enter");
  402 |     await expect(picker).not.toBeVisible();
  403 |     await expect(page.getByRole("link", { name: "Configure Beta", exact: true })).toBeVisible();
  404 |     expect(await json(await request.get(`/api/companies/${f.company.id}/chats/${f.agents[1].id}`))).toBeNull();
  405 |     for (const agent of f.agents) {
  406 |       await page.goto(`/${f.company.issuePrefix}/chats/${agent.id}`);
  407 |       await expect(page.getByTestId("task-chat-composer-input")).toBeVisible();
  408 |     }
  409 |     await expect(chatLinks).toHaveText(["Alpha", "Zeta", "Epsilon", "Delta", "Gamma"]);
  410 |     const star = page.getByRole("button", { name: "Star Zeta", exact: true });
  411 |     await page.getByTestId("task-chat-composer-input").hover();
  412 |     await expect(star).toHaveCSS("opacity", "0");
  413 |     // Enter from the preceding link. Clicking the rich editor first can leave
  414 |     // a pending selection update that restores editor focus; Shift+Tab there
  415 |     // also cycles work modes instead of moving backwards through the sidebar.
  416 |     await nav.getByRole("link", { name: "Zeta", exact: true }).focus();
  417 |     await page.keyboard.press("Tab");
  418 |     await expect(star).toBeFocused();
  419 |     await expect(star).toHaveCSS("opacity", "1");
  420 |     await star.click();
  421 |     await page.goto(f.route);
  422 |     await page.getByRole("button", { name: "Star Alpha", exact: true }).click();
  423 |     await expect(nav.locator('a[href*="/chats/"]').first()).toHaveText("Alpha");
  424 |     await expect(nav.locator('a[href*="/chats/"]').nth(1)).toHaveText("Zeta");
  425 |     const editor = page
  426 |       .getByTestId("task-chat-composer-input")
  427 |       .locator('[contenteditable="true"]');
  428 |     await editor.fill("Unsent draft for Alpha");
  429 |     await nav.getByRole("link", { name: "Zeta", exact: true }).click();
  430 |     await expect(editor).toHaveText("");
  431 |     await nav.getByRole("link", { name: "Alpha", exact: true }).click();
  432 |     await expect(editor).toContainText("Unsent draft for Alpha");
  433 |     const recent = await page.evaluate(() =>
  434 |       Object.fromEntries(
  435 |         Object.entries(localStorage).filter(([key]) =>
  436 |           key.startsWith("paperclip.recentAgentChats:"),
  437 |         ),
  438 |       ),
  439 |     );
  440 |     await page.getByRole("link", { name: /Configure Alpha/ }).click();
  441 |     await expect(page).toHaveURL(/\/agents\/.*\/runtime/);
  442 |     const backgroundPath = `/api/companies/${f.company.id}/chats/${f.agents[1].id}`;
  443 |     const background = await json(
  444 |       await request.post(backgroundPath, { data: {} }),
  445 |     );
  446 |     await json(
  447 |       await request.post(`/api/issues/${background.id}/comments`, {
  448 |         data: {
  449 |           body: "Background activity",
  450 |           clientRequestId: "00000000-0000-4000-8000-000000000099",
  451 |         },
  452 |       }),
  453 |     );
  454 |     await idle(request, backgroundPath);
  455 |     expect(
  456 |       await page.evaluate(() =>
  457 |         Object.fromEntries(
  458 |           Object.entries(localStorage).filter(([key]) =>
  459 |             key.startsWith("paperclip.recentAgentChats:"),
  460 |           ),
  461 |         ),
  462 |       ),
  463 |     ).toEqual(recent);
  464 |     await compose.click();
  465 |     await expect(picker.getByRole("combobox")).toHaveValue("");
  466 |     await picker.getByRole("combobox").fill("Beta");
  467 |     await picker.getByRole("combobox").press("Enter");
  468 |     await expect(picker).not.toBeVisible();
  469 |     await expect(page.getByRole("link", { name: "Configure Beta", exact: true })).toBeVisible();
  470 |     await expect(page.getByText("Background activity", { exact: true })).toBeVisible();
  471 |   } finally {
  472 |     await f.restore();
  473 |   }
  474 | });
  475 | 
```