# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-chat-sessions.spec.ts >> sidebar discovery, stars, recent agents, configuration links, and drafts survive switching
- Location: tests/e2e/agent-chat-sessions.spec.ts:388:1

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByRole('dialog', { name: 'Choose a Co-worker to ask', exact: true }).getByRole('option')
Expected: 6
Received: 13
Timeout:  20000ms

Call log:
  - Expect "toHaveCount" with timeout 20000ms
  - waiting for getByRole('dialog', { name: 'Choose a Co-worker to ask', exact: true }).getByRole('option')
    43 × locator resolved to 13 elements
       - unexpected value "13"

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
                        - generic: Agent Chat 1793022491550
                  - navigation:
                    - generic:
                      - button:
                        - generic: New Task
                      - link:
                        - /url: /AGE/search
                        - generic: Search
                      - link:
                        - /url: /AGE/dashboard
                        - generic: Overview
                      - link:
                        - /url: /AGE/agents
                        - generic: Agents
                      - link:
                        - /url: /AGE/inbox
                        - generic: Inbox
                    - generic:
                      - generic:
                        - generic:
                          - button [expanded]
                          - generic: Work
                      - generic:
                        - generic:
                          - link:
                            - /url: /AGE/issues
                            - generic: Tasks
                          - link:
                            - /url: /AGE/routines
                            - generic: Routines
                          - link:
                            - /url: /AGE/projects
                            - generic: Projects
                          - link:
                            - /url: /AGE/artifacts
                            - generic: Artifacts
                    - generic:
                      - link:
                        - /url: /AGE/apps
                        - generic: Connections
                      - link:
                        - /url: /AGE/governance
                        - generic: Governance
                    - generic:
                      - generic:
                        - generic:
                          - button [expanded]
                          - generic: Advanced
                      - generic:
                        - generic:
                          - link:
                            - /url: /AGE/skills
                            - generic: Skills
                          - link:
                            - /url: /AGE/activity
                            - generic: Audit
                    - region:
                      - generic:
                        - generic: Chats
                        - button
                      - generic:
                        - link:
                          - /url: /AGE/chats/alpha
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
                  - /url: /AGE/company/help
                  - text: Help / Support
                - link:
                  - /url: mailto:support@blentera.com
                  - text: Contact support
                - link:
                  - /url: /AGE/company/settings/instance/profile
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
                        - /url: /AGE/agents
                        - generic:
                          - generic:
                            - generic:
                              - paragraph: "6"
                              - paragraph: Agents Enabled
                              - generic: 0 running, 0 paused, 0 errors
                      - link:
                        - /url: /AGE/issues
                        - generic:
                          - generic:
                            - generic:
                              - paragraph: "0"
                              - paragraph: Tasks In Progress
                              - generic: 0 open, 0 blocked
                      - link:
                        - /url: /AGE/costs
                        - generic:
                          - generic:
                            - generic:
                              - paragraph: $0.00
                              - paragraph: Month Spend
                              - generic: Unlimited budget
                      - link:
                        - /url: /AGE/approvals
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
                            - /url: /AGE/agents/4a54c6b5-b3e8-4a95-94a9-e449aa5e7d77
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
                            - /url: /AGE/agents/62aa8e85-4a18-45d4-af5e-e1a6bb8465f0
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
                            - /url: /AGE/agents/f7ea2bc8-ae7d-4763-b822-7576a3f9305b
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
                            - /url: /AGE/agents/eb70b2b1-3972-4388-9a9a-703d5eac8da3
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
                            - /url: /AGE/agents/b289ab53-e720-4efb-ae6d-6b8098e55973
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
                            - /url: /AGE/agents/b4d16170-ea30-49d4-81d0-375d233f1b8d
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
          - option "Zeta general" [selected] [ref=e15]:
            - generic [ref=e16]:
              - generic [ref=e17]: Zeta
              - generic [ref=e18]: general
          - option "Epsilon general" [ref=e19]:
            - generic [ref=e20]:
              - generic [ref=e21]: Epsilon
              - generic [ref=e22]: general
          - option "Beta general" [ref=e23]:
            - generic [ref=e24]:
              - generic [ref=e25]: Beta
              - generic [ref=e26]: general
          - option "Alpha general" [ref=e27]:
            - generic [ref=e28]:
              - generic [ref=e29]: Alpha
              - generic [ref=e30]: general
          - option "Gamma general" [ref=e31]:
            - generic [ref=e32]:
              - generic [ref=e33]: Gamma
              - generic [ref=e34]: general
          - option "Delta general" [ref=e35]:
            - generic [ref=e36]:
              - generic [ref=e37]: Delta
              - generic [ref=e38]: general
      - generic [ref=e39]:
        - generic [ref=e40]: Set as preferred Co-worker
        - combobox "Set as preferred Co-worker" [ref=e41]:
          - option "Ask me to choose each time" [selected]
          - option "Zeta — general"
          - option "Epsilon — general"
          - option "Beta — general"
          - option "Alpha — general"
          - option "Gamma — general"
          - option "Delta — general"
    - button "Close" [ref=e42]
```

# Test source

```ts
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
> 402 |     await expect(picker.getByRole("option")).toHaveCount(6);
      |                                              ^ Error: expect(locator).toHaveCount(expected) failed
  403 |     await picker.getByRole("combobox").fill("Beta");
  404 |     await picker.getByRole("combobox").press("Enter");
  405 |     await expect(picker).not.toBeVisible();
  406 |     await expect(page.getByRole("link", { name: "Configure Beta", exact: true })).toBeVisible();
  407 |     expect(await json(await request.get(`/api/companies/${f.company.id}/chats/${f.agents[1].id}`))).toBeNull();
  408 |     for (const agent of f.agents) {
  409 |       await page.goto(`/${f.company.issuePrefix}/chats/${agent.id}`);
  410 |       await expect(page.getByTestId("task-chat-composer-input")).toBeVisible();
  411 |     }
  412 |     await expect(chatLinks).toHaveText(["Alpha", "Zeta", "Epsilon", "Delta", "Gamma"]);
  413 |     const star = page.getByRole("button", { name: "Star Zeta", exact: true });
  414 |     await page.getByTestId("task-chat-composer-input").hover();
  415 |     await expect(star).toHaveCSS("opacity", "0");
  416 |     // Enter from the preceding link. Clicking the rich editor first can leave
  417 |     // a pending selection update that restores editor focus; Shift+Tab there
  418 |     // also cycles work modes instead of moving backwards through the sidebar.
  419 |     await nav.getByRole("link", { name: "Zeta", exact: true }).focus();
  420 |     await page.keyboard.press("Tab");
  421 |     await expect(star).toBeFocused();
  422 |     await expect(star).toHaveCSS("opacity", "1");
  423 |     await star.click();
  424 |     await page.goto(f.route);
  425 |     await page.getByRole("button", { name: "Star Alpha", exact: true }).click();
  426 |     await expect(nav.locator('a[href*="/chats/"]').first()).toHaveText("Alpha");
  427 |     await expect(nav.locator('a[href*="/chats/"]').nth(1)).toHaveText("Zeta");
  428 |     const editor = page
  429 |       .getByTestId("task-chat-composer-input")
  430 |       .locator('[contenteditable="true"]');
  431 |     await editor.fill("Unsent draft for Alpha");
  432 |     await nav.getByRole("link", { name: "Zeta", exact: true }).click();
  433 |     await expect(editor).toHaveText("");
  434 |     await nav.getByRole("link", { name: "Alpha", exact: true }).click();
  435 |     await expect(editor).toContainText("Unsent draft for Alpha");
  436 |     const recent = await page.evaluate(() =>
  437 |       Object.fromEntries(
  438 |         Object.entries(localStorage).filter(([key]) =>
  439 |           key.startsWith("paperclip.recentAgentChats:"),
  440 |         ),
  441 |       ),
  442 |     );
  443 |     await page.getByRole("link", { name: /Configure Alpha/ }).click();
  444 |     await expect(page).toHaveURL(/\/agents\/.*\/runtime/);
  445 |     const backgroundPath = `/api/companies/${f.company.id}/chats/${f.agents[1].id}`;
  446 |     const background = await json(
  447 |       await request.post(backgroundPath, { data: {} }),
  448 |     );
  449 |     await json(
  450 |       await request.post(`/api/issues/${background.id}/comments`, {
  451 |         data: {
  452 |           body: "Background activity",
  453 |           clientRequestId: "00000000-0000-4000-8000-000000000099",
  454 |         },
  455 |       }),
  456 |     );
  457 |     await idle(request, backgroundPath);
  458 |     expect(
  459 |       await page.evaluate(() =>
  460 |         Object.fromEntries(
  461 |           Object.entries(localStorage).filter(([key]) =>
  462 |             key.startsWith("paperclip.recentAgentChats:"),
  463 |           ),
  464 |         ),
  465 |       ),
  466 |     ).toEqual(recent);
  467 |     await compose.click();
  468 |     await expect(picker.getByRole("combobox")).toHaveValue("");
  469 |     await picker.getByRole("combobox").fill("Beta");
  470 |     await picker.getByRole("combobox").press("Enter");
  471 |     await expect(picker).not.toBeVisible();
  472 |     await expect(page.getByRole("link", { name: "Configure Beta", exact: true })).toBeVisible();
  473 |     await expect(page.getByText("Background activity", { exact: true })).toBeVisible();
  474 |   } finally {
  475 |     await f.restore();
  476 |   }
  477 | });
  478 | 
```