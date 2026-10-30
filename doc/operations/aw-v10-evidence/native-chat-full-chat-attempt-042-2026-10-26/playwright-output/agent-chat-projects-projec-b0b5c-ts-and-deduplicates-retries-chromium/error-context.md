# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-chat-projects.spec.ts >> project card through dedicated tool persists and deduplicates retries
- Location: tests/e2e/agent-chat-projects.spec.ts:15:3

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByRole('article', { name: 'Project created: Browser repositories' })
Expected: 1
Received: 0
Timeout:  20000ms

Call log:
  - Expect "toHaveCount" with timeout 20000ms
  - waiting for getByRole('article', { name: 'Project created: Browser repositories' })
    43 × locator resolved to 0 elements
       - unexpected value "0"

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
          - button "Open Agent Chat 1793019557299 organization switcher" [ref=e12]:
            - generic [ref=e13]:
              - generic [ref=e14]: A
              - generic "Agent Chat 1793019557299" [ref=e17]
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
                - link "Projects" [ref=e77] [cursor=pointer]:
                  - /url: /AGE/projects
                - link "Artifacts" [ref=e82] [cursor=pointer]:
                  - /url: /AGE/artifacts
            - generic [ref=e89]:
              - link "Connections" [ref=e90] [cursor=pointer]:
                - /url: /AGE/apps
              - link "Governance" [ref=e100] [cursor=pointer]:
                - /url: /AGE/governance
            - generic [ref=e106]:
              - generic [ref=e108]:
                - button "Collapse Advanced" [expanded] [ref=e109]
                - generic [ref=e112]: Advanced
              - generic [ref=e115]:
                - link "Skills" [ref=e116] [cursor=pointer]:
                  - /url: /AGE/skills
                - link "Audit" [ref=e129] [cursor=pointer]:
                  - /url: /AGE/activity
            - region "Chats" [ref=e136]:
              - generic [ref=e137]:
                - generic [ref=e138]: Chats
                - button "Chat with an agent" [ref=e139]
              - generic [ref=e140]:
                - link "Alpha" [ref=e141] [cursor=pointer]:
                  - /url: /AGE/chats/alpha
                - button "Star Alpha" [ref=e147]
        - button "Open account menu" [ref=e150]:
          - generic [ref=e151]: AR
          - generic [ref=e153]: Authenticated agent-chat reviewer
      - separator "Resize sidebar" [ref=e154]
    - generic [ref=e156]:
      - region "Global utilities" [ref=e158]:
        - generic [ref=e161]:
          - generic [ref=e162]: Language
          - combobox "Language" [ref=e163]:
            - option "English" [selected]
            - option "Dansk"
        - link "Help / Support" [ref=e164] [cursor=pointer]:
          - /url: /AGE/company/help
        - link "Contact support" [ref=e165] [cursor=pointer]:
          - /url: mailto:support@blentera.com
        - link "User account" [ref=e166] [cursor=pointer]:
          - /url: /AGE/company/settings/instance/profile
      - generic [ref=e170]:
        - generic [ref=e171]:
          - generic [ref=e172]:
            - navigation "breadcrumb" [ref=e174]:
              - list [ref=e175]:
                - listitem [ref=e176]:
                  - link "AL Alpha" [disabled] [ref=e177]:
                    - generic [ref=e178]: AL
                    - generic [ref=e181]: Alpha
                  - link "Configure Alpha" [ref=e183] [cursor=pointer]:
                    - /url: /AGE/agents/fe880c29-cfc4-4e30-a078-6c9ce1c0da35/runtime
            - button "Hide properties" [ref=e184]
          - main [ref=e185]:
            - tabpanel [ref=e188]:
              - generic [ref=e190]:
                - generic [ref=e195]:
                  - generic [ref=e198]:
                    - paragraph [ref=e201]: fixture:eyJhY3Rpb24iOiJwcm9qZWN0IiwibmFtZSI6IkJyb3dzZXIgcmVwb3NpdG9yaWVzIiwiZGlyZWN0IjpmYWxzZSwidXJscyI6WyJodHRwczovL2dpdGh1Yi5jb20vb2N0b2NhdC9IZWxsby1Xb3JsZC5naXQiLCJodHRwczovL2dpdGh1Yi5jb20vb2N0b2NhdC9TcG9vbi1LbmlmZSIsImh0dHBzOi8vZ2l0aHViLmNvbS9vY3RvY2F0L0hlbGxvLVdvcmxkIl19
                    - generic [ref=e202]: 12:59 PM
                  - generic [ref=e204]:
                    - generic [ref=e206]:
                      - generic [ref=e207]:
                        - generic [ref=e208]: Alpha
                        - generic [ref=e212]: Worked for 21s
                      - button "Expand read files, worked on files, used tools (4 activities)" [ref=e217]:
                        - generic "Read files, worked on files, used tools" [ref=e224]
                    - paragraph [ref=e230]: "Expected tool result: {\"contentItems\":[{\"text\":\"Private projects are not available\",\"type\":\"inputText\"}],\"success\":false}"
                    - generic [ref=e231]:
                      - generic [ref=e232]: 12:59 PM
                      - generic [ref=e233]:
                        - button "Copy message" [ref=e234]
                        - button "Helpful" [ref=e238]
                        - button "Needs work" [ref=e241]
                - generic [ref=e247]:
                  - generic [ref=e251]:
                    - textbox "editable markdown" [ref=e253]:
                      - paragraph [ref=e254]
                    - generic:
                      - paragraph: Message Alpha — describe what you want done…
                  - generic [ref=e255]:
                    - button "Attach file" [ref=e256]
                    - button "Auto mode" [ref=e258]
                    - button "Send" [disabled] [ref=e261]
        - complementary [ref=e264]:
          - separator "Resize panel" [ref=e265]
          - region "Side panel" [ref=e268]:
            - generic [ref=e269]:
              - generic [ref=e272]:
                - tablist [ref=e273]:
                  - generic [ref=e276]:
                    - tab "Artifacts" [selected] [ref=e277]
                    - button "Close Artifacts" [ref=e279]
                  - status [ref=e283]
                - button "Open a new tab" [ref=e285]
              - generic [ref=e287]:
                - button "Maximize side panel" [ref=e288]
                - button "Close side panel" [ref=e289]
            - tabpanel "Artifacts" [ref=e292]:
              - generic [ref=e293]: No artifacts yet. Work products, documents, and agent-produced files will appear here.
  - generic [ref=e294]:
    - heading "Command Palette" [level=2] [ref=e295]
    - paragraph [ref=e296]: Search for a command to run...
```

# Test source

```ts
  1   | import { expect, test } from "@playwright/test";
  2   | 
  3   | import { idle, json, send, setup } from "./agent-chat.shared";
  4   | 
  5   | test.use({ trace: "retain-on-failure" });
  6   | test.setTimeout(120_000);
  7   | 
  8   | /**
  9   |  * Agent chat project and content coverage: project cards, split handoff,
  10  |  * uploads, Ask/Plan modes, repository selection, plan approval, and shared
  11  |  * history. Shared fixtures live in ./agent-chat.shared.ts; session lifecycle
  12  |  * flows run in agent-chat-sessions.spec.ts.
  13  |  */
  14  | for (const direct of [false, true])
  15  |   test(`project card through ${direct ? "direct API" : "dedicated tool"} persists and deduplicates retries`, async ({
  16  |     page,
  17  |     request,
  18  |   }) => {
  19  |     const f = await setup(request, page);
  20  |     request = f.request;
  21  |     try {
  22  |       await page.goto(f.route);
  23  |       await send(page, {
  24  |         action: "project",
  25  |         name: "Browser repositories",
  26  |         direct,
  27  |         urls: [
  28  |           "https://github.com/octocat/Hello-World.git",
  29  |           "https://github.com/octocat/Spoon-Knife",
  30  |           "https://github.com/octocat/Hello-World",
  31  |         ],
  32  |       });
  33  |       await idle(request, f.chatPath);
  34  |       const card = page.getByRole("article", {
  35  |         name: "Project created: Browser repositories",
  36  |       });
> 37  |       await expect(card).toHaveCount(1);
      |                          ^ Error: expect(locator).toHaveCount(expected) failed
  38  |       await expect(
  39  |         card.getByRole("link", { name: "octocat/Hello-World" }),
  40  |       ).toHaveAttribute("href", "https://github.com/octocat/Hello-World");
  41  |       await expect(
  42  |         card.getByRole("link", { name: "octocat/Spoon-Knife" }),
  43  |       ).toBeVisible();
  44  |       const projects = await json(
  45  |         await request.get(`/api/companies/${f.company.id}/projects`),
  46  |       );
  47  |       expect(projects).toHaveLength(1);
  48  |       expect(projects[0].workspaces).toHaveLength(2);
  49  |       if (direct) {
  50  |         await json(await request.post(`/api/projects/${projects[0].id}/workspaces`, {
  51  |           data: { name: "Additional repository", repoUrl: "https://github.com/octocat/git-consortium" },
  52  |         }));
  53  |         await expect(card.getByRole("link", { name: "Additional repository" }))
  54  |           .toHaveAttribute("href", "https://github.com/octocat/git-consortium");
  55  |         await expect(card).toHaveCount(1);
  56  |       }
  57  |       await send(page, "/new");
  58  |       await expect
  59  |         .poll(
  60  |           async () =>
  61  |             (await json(await request.get(f.chatPath)))
  62  |               .conversationSessionGeneration,
  63  |         )
  64  |         .toBe(1);
  65  |       await page.reload();
  66  |       await expect(card).toHaveCount(1);
  67  |       if (direct) await expect(card.getByRole("link", { name: "Additional repository" })).toBeVisible();
  68  |       await card
  69  |         .getByRole("link", { name: "Browser repositories", exact: true })
  70  |         .click();
  71  |       await expect(page).toHaveURL(/\/projects\/.*\/issues/);
  72  |       await page
  73  |         .getByRole("tab", { name: "Configuration", exact: true })
  74  |         .click();
  75  |       await expect(
  76  |         page.getByRole("region", { name: "Repositories" }),
  77  |       ).toContainText("octocat/Hello-World");
  78  |     } finally {
  79  |       await f.restore();
  80  |     }
  81  |   });
  82  | 
  83  | test("split handoff commits relevant plans before execution and never creates chat children", async ({
  84  |   page,
  85  |   request,
  86  | }) => {
  87  |   const f = await setup(request, page);
  88  |   request = f.request;
  89  |   try {
  90  |     await page.goto(f.route);
  91  |     await send(page, {
  92  |       action: "handoff",
  93  |       name: "Welcome project",
  94  |       split: true,
  95  |       plan: "# Welcome plan\nWrite a friendly welcome.",
  96  |     });
  97  |     const chat = await idle(request, f.chatPath);
  98  |     await expect
  99  |       .poll(
  100 |         async () => {
  101 |           const tasks = await json(
  102 |             await request.get(`/api/companies/${f.company.id}/issues`),
  103 |           );
  104 |           return (
  105 |             tasks.length === 2 &&
  106 |             tasks.every((task: any) => task.status === "done")
  107 |           );
  108 |         },
  109 |         { timeout: 60_000 },
  110 |       )
  111 |       .toBe(true);
  112 |     const tasks = await json(
  113 |       await request.get(`/api/companies/${f.company.id}/issues`),
  114 |     );
  115 |     for (const task of tasks) {
  116 |       expect(task.parentId).toBeNull();
  117 |       expect(task.projectId).toBeTruthy();
  118 |       expect(task.assigneeAgentId).toBe(f.agent.id);
  119 |       const plan = await json(
  120 |         await request.get(`/api/issues/${task.id}/documents/plan`),
  121 |       );
  122 |       const output = await json(
  123 |         await request.get(`/api/issues/${task.id}/documents/output`),
  124 |       );
  125 |       expect(output.body).toContain(plan.body);
  126 |       const runs = await json(
  127 |         await request.get(`/api/companies/${f.company.id}/heartbeat-runs`),
  128 |       );
  129 |       const run = runs.find(
  130 |         (run: any) => run.contextSnapshot?.issueId === task.id,
  131 |       );
  132 |       expect(run).toBeTruthy();
  133 |       expect(Date.parse(plan.updatedAt)).toBeLessThanOrEqual(
  134 |         Date.parse(run.startedAt),
  135 |       );
  136 |     }
  137 |     expect(
```