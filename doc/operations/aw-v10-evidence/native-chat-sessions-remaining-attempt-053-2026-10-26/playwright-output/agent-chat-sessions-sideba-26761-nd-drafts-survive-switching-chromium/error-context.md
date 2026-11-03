# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-chat-sessions.spec.ts >> sidebar discovery, stars, recent agents, configuration links, and drafts survive switching
- Location: tests/e2e/agent-chat-sessions.spec.ts:388:1

# Error details

```
Error: expect(locator).toHaveValue(expected) failed

Locator: getByRole('dialog', { name: 'Choose a Co-worker to ask', exact: true }).getByRole('combobox')
Expected: ""
Error: strict mode violation: getByRole('dialog', { name: 'Choose a Co-worker to ask', exact: true }).getByRole('combobox') resolved to 2 elements:
    1) <input value="" type="text" cmdk-input="" role="combobox" autocorrect="off" id="radix-_r_2c_" autocomplete="off" spellcheck="false" aria-expanded="true" aria-autocomplete="list" data-slot="command-input" aria-controls="radix-_r_2a_" aria-labelledby="radix-_r_2b_" aria-label="Search Co-workers by name or role" placeholder="Search Co-workers by name or role" class="placeholder:text-muted-foreground flex h-10 w-full rounded-md bg-transparent py-3 text-base md:text-sm outline-hidden disabled:cursor-not-a…/> aka getByRole('combobox', { name: 'Search Co-workers by name or' })
    2) <select id="preferred-coworker" class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">…</select> aka getByLabel('Set as preferred Co-worker')

Call log:
  - Expect "toHaveValue" with timeout 20000ms
  - waiting for getByRole('dialog', { name: 'Choose a Co-worker to ask', exact: true }).getByRole('combobox')

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
                        - generic: Agent Chat 1793023926080
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
                        - button [pressed]
                      - generic:
                        - link:
                          - /url: /AGE/chats/zeta
                          - generic: Zeta
                        - button [pressed]
                      - generic:
                        - link:
                          - /url: /AGE/chats/epsilon
                          - generic: Epsilon
                        - button
                      - generic:
                        - link:
                          - /url: /AGE/chats/delta
                          - generic: Delta
                        - button
                      - generic:
                        - link:
                          - /url: /AGE/chats/gamma
                          - generic: Gamma
                        - button
                      - generic:
                        - link:
                          - /url: /AGE/chats/beta
                          - generic: Beta
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
                    - navigation:
                      - list:
                        - listitem:
                          - link:
                            - /url: /AGE/agents
                            - text: Agents
                        - listitem
                        - listitem:
                          - link:
                            - /url: /AGE/agents/alpha/overview
                            - text: Alpha
                        - listitem
                        - listitem:
                          - link [disabled]: Harness / Runtime
            - generic:
              - generic:
                - complementary:
                  - navigation:
                    - generic:
                      - paragraph: Agent
                      - generic:
                        - link:
                          - /url: /AGE/agents/alpha/overview
                          - generic: Overview
                        - link:
                          - /url: /AGE/agents/alpha/instructions
                          - generic: Instructions
                        - link:
                          - /url: /AGE/agents/alpha/skills
                          - generic: Skills
                    - generic:
                      - paragraph: Runtime
                      - generic:
                        - link:
                          - /url: /AGE/agents/alpha/runtime
                          - generic: Harness / Runtime
                        - link:
                          - /url: /AGE/agents/alpha/secrets
                          - generic: Secrets & variables
                        - link:
                          - /url: /AGE/agents/alpha/tools
                          - generic: Tools
                    - generic:
                      - paragraph: Governance
                      - generic:
                        - link:
                          - /url: /AGE/agents/alpha/permissions
                          - generic: Permissions / Trust
                        - link:
                          - /url: /AGE/agents/alpha/api-keys
                          - generic: API Keys
                        - link:
                          - /url: /AGE/agents/alpha/revisions
                          - generic: Revisions
                    - generic:
                      - paragraph: Audit
                      - generic:
                        - link:
                          - /url: /AGE/activity?mode=agents&agentId=425fdd62-2340-4355-b552-a3537030d3b5
                          - generic: Activity
                        - link:
                          - /url: /AGE/activity/runs?agentId=425fdd62-2340-4355-b552-a3537030d3b5
                          - generic: Runs
                        - link:
                          - /url: /AGE/activity/costs?agentId=425fdd62-2340-4355-b552-a3537030d3b5
                          - generic: Costs
                        - link:
                          - /url: /AGE/activity/budgets?agentId=425fdd62-2340-4355-b552-a3537030d3b5
                          - generic: Budgets
              - generic:
                - main:
                  - generic:
                    - generic:
                      - generic:
                        - generic:
                          - heading [level=1]: Alpha
                          - generic:
                            - generic: Blentera Runner
                            - generic: ·
                            - generic: General
                      - generic:
                        - button [pressed]
                        - generic:
                          - button:
                            - generic: Assign Task
                          - button:
                            - generic: Run now
                          - button:
                            - generic: Run with provider trace
                          - button:
                            - generic: Pause
                          - button
                    - heading [level=2]: Harness / Runtime
                    - generic:
                      - generic:
                        - generic:
                          - generic:
                            - heading [level=3]: Agent identity
                            - generic:
                              - generic:
                                - generic:
                                  - generic: Name
                                  - button
                                - textbox:
                                  - /placeholder: Agent name
                                  - text: Alpha
                              - generic:
                                - generic:
                                  - generic: Title
                                  - button
                                - textbox:
                                  - /placeholder: e.g. VP of Engineering
                              - generic:
                                - generic:
                                  - generic: Reports to
                                  - button
                                - button:
                                  - generic: Choose manager…
                          - generic:
                            - generic:
                              - heading [level=3]: Adapter
                            - generic:
                              - generic:
                                - generic:
                                  - generic: Adapter type
                                  - button
                                - button:
                                  - generic:
                                    - generic: Blentera Runner
                                    - generic: Experimental
                              - generic:
                                - heading [level=3]: Existing authentication — not managed by Connections
                                - paragraph: This agent keeps its current authentication until you choose and test a managed connection. Confirm the account and who may use it before adopting.
                                - button: Choose a managed connection
                              - generic:
                                - generic:
                                  - generic: Provider
                                  - button
                                - combobox
                              - generic:
                                - generic:
                                  - generic: Model
                                  - button
                                - button:
                                  - generic: gpt-5.1-codex-mini
                          - generic:
                            - heading [level=3]: Configuration
                            - generic:
                              - generic:
                                - button: Advanced
                          - generic:
                            - heading [level=3]: Environment variables
                            - generic:
                              - generic:
                                - paragraph: No environment variables
                                - generic:
                                  - button: Add variable
                                - paragraph: Set the KEY to the env var name the process expects, for example GH_TOKEN. Choose a secret to resolve a stored value at run start. PAPERCLIP_* variables are injected automatically.
                          - generic:
                            - heading [level=3]: Run Policy
                            - generic:
                              - generic:
                                - generic:
                                  - generic:
                                    - generic:
                                      - generic: Heartbeat on interval
                                      - button
                                    - switch
                              - generic:
                                - button: Advanced Run Policy
                          - generic:
                            - heading [level=3]: Debugging
                            - generic:
                              - generic:
                                - generic:
                                  - generic: Capture raw provider traces
                                  - button
                                - switch
                          - region:
                            - generic:
                              - generic:
                                - status:
                                  - heading [level=3]: Test your agent
                                  - paragraph: Check that your runtime and model can respond.
                                - button: Run test
                    - generic:
                      - generic:
                        - button [disabled]: Discard
                        - button [disabled]: Save changes
        - generic:
          - heading [level=2]: Command Palette
          - paragraph: Search for a command to run...
  - dialog [ref=f7e2]:
    - heading "Choose a Co-worker to ask" [level=2] [ref=f7e4]
    - generic [ref=f7e5]:
      - combobox "Search Co-workers by name or role" [expanded] [active] [ref=f7e11]
      - listbox "Suggestions" [ref=f7e12]:
        - group [ref=f7e14]:
          - option "Beta general" [selected] [ref=f7e15]:
            - generic [ref=f7e16]:
              - generic [ref=f7e17]: Beta
              - generic [ref=f7e18]: general
          - option "Alpha general" [ref=f7e19]:
            - generic [ref=f7e20]:
              - generic [ref=f7e21]: Alpha
              - generic [ref=f7e22]: general
          - option "Gamma general" [ref=f7e23]:
            - generic [ref=f7e24]:
              - generic [ref=f7e25]: Gamma
              - generic [ref=f7e26]: general
          - option "Zeta general" [ref=f7e27]:
            - generic [ref=f7e28]:
              - generic [ref=f7e29]: Zeta
              - generic [ref=f7e30]: general
          - option "Delta general" [ref=f7e31]:
            - generic [ref=f7e32]:
              - generic [ref=f7e33]: Delta
              - generic [ref=f7e34]: general
          - option "Epsilon general" [ref=f7e35]:
            - generic [ref=f7e36]:
              - generic [ref=f7e37]: Epsilon
              - generic [ref=f7e38]: general
      - generic [ref=f7e39]:
        - generic [ref=f7e40]: Set as preferred Co-worker
        - combobox "Set as preferred Co-worker" [ref=f7e41]:
          - option "Ask me to choose each time" [selected]
          - option "Beta — general"
          - option "Alpha — general"
          - option "Gamma — general"
          - option "Zeta — general"
          - option "Delta — general"
          - option "Epsilon — general"
    - button "Close" [ref=f7e42]
```

# Test source

```ts
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
  417 |     await expect(chatLinks).toHaveText(["Alpha", "Zeta", "Epsilon", "Delta", "Gamma"]);
  418 |     const star = page.getByRole("button", { name: "Star Zeta", exact: true });
  419 |     await page.getByTestId("task-chat-composer-input").hover();
  420 |     await expect(star).toHaveCSS("opacity", "0");
  421 |     // Enter from the preceding link. Clicking the rich editor first can leave
  422 |     // a pending selection update that restores editor focus; Shift+Tab there
  423 |     // also cycles work modes instead of moving backwards through the sidebar.
  424 |     await nav.getByRole("link", { name: "Zeta", exact: true }).focus();
  425 |     await page.keyboard.press("Tab");
  426 |     await expect(star).toBeFocused();
  427 |     await expect(star).toHaveCSS("opacity", "1");
  428 |     await star.click();
  429 |     await page.goto(f.route);
  430 |     await page.getByRole("button", { name: "Star Alpha", exact: true }).click();
  431 |     await expect(nav.locator('a[href*="/chats/"]').first()).toHaveText("Alpha");
  432 |     await expect(nav.locator('a[href*="/chats/"]').nth(1)).toHaveText("Zeta");
  433 |     const editor = page
  434 |       .getByTestId("task-chat-composer-input")
  435 |       .locator('[contenteditable="true"]');
  436 |     await editor.fill("Unsent draft for Alpha");
  437 |     await nav.getByRole("link", { name: "Zeta", exact: true }).click();
  438 |     await expect(editor).toHaveText("");
  439 |     await nav.getByRole("link", { name: "Alpha", exact: true }).click();
  440 |     await expect(editor).toContainText("Unsent draft for Alpha");
  441 |     const recent = await page.evaluate(() =>
  442 |       Object.fromEntries(
  443 |         Object.entries(localStorage).filter(([key]) =>
  444 |           key.startsWith("paperclip.recentAgentChats:"),
  445 |         ),
  446 |       ),
  447 |     );
  448 |     await page.getByRole("link", { name: /Configure Alpha/ }).click();
  449 |     await expect(page).toHaveURL(/\/agents\/.*\/runtime/);
  450 |     const backgroundPath = `/api/companies/${f.company.id}/chats/${f.agents[1].id}`;
  451 |     const background = await json(
  452 |       await request.post(backgroundPath, { data: {} }),
  453 |     );
  454 |     await json(
  455 |       await request.post(`/api/issues/${background.id}/comments`, {
  456 |         data: {
  457 |           body: "Background activity",
  458 |           clientRequestId: "00000000-0000-4000-8000-000000000099",
  459 |         },
  460 |       }),
  461 |     );
  462 |     await idle(request, backgroundPath);
  463 |     expect(
  464 |       await page.evaluate(() =>
  465 |         Object.fromEntries(
  466 |           Object.entries(localStorage).filter(([key]) =>
  467 |             key.startsWith("paperclip.recentAgentChats:"),
  468 |           ),
  469 |         ),
  470 |       ),
  471 |     ).toEqual(recent);
  472 |     await compose.click();
> 473 |     await expect(picker.getByRole("combobox")).toHaveValue("");
      |                                                ^ Error: expect(locator).toHaveValue(expected) failed
  474 |     await picker.getByRole("combobox").fill("Beta");
  475 |     await picker.getByRole("combobox").press("Enter");
  476 |     await expect(picker).not.toBeVisible();
  477 |     await expect(page.getByRole("link", { name: "Configure Beta", exact: true })).toBeVisible();
  478 |     await expect(page.getByText("Background activity", { exact: true })).toBeVisible();
  479 |   } finally {
  480 |     await f.restore();
  481 |   }
  482 | });
  483 | 
```