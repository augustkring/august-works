import { test, expect } from "@playwright/test";
import { withManagedConnectionReview, type ConnectionReviewJourney } from "./managed-connection-review";

type Json = Record<string, unknown>;
async function json<T = Json>(response: Awaited<ReturnType<import("@playwright/test").APIRequestContext["get"]>>): Promise<T> {
  expect(response.ok(), `${response.url()} failed ${response.status()}: ${await response.text()}`).toBe(true);
  return await response.json() as T;
}

// Each caller registers exactly one real journey for the existing E2E partition.
export function registerManagedConnectionReviewCase(journey: ConnectionReviewJourney) {
  test(`connection review: ${journey}, synchronized task history and actual continuation`, async ({ page }, testInfo) => {
    const envelopeMs = journey === "always" ? 720_000 : 540_000;
    const deadlineAt = Date.now() + envelopeMs;
    test.setTimeout(envelopeMs);
    await withManagedConnectionReview({ page, journey, deadlineAt,
      driveReview: async ({ page, context, request, seed, agent, issue, calls, remaining, start, waitInitialRun, createLaterTask, recordPendingComment, resolutionRunId }) => {
    let suppressReviewEvents = journey === "decline";
    if (journey === "decline") {
      // Reproduce a review arriving between the initial fetch and subscription:
      // return an empty first snapshot and drop its live creation notification.
      const initialSnapshots = new Set<string>();
      await page.route("**/api/issues/*/interactions", async (route) => {
        const url = route.request().url();
        if (route.request().method() === "GET" && !initialSnapshots.has(url)) {
          initialSnapshots.add(url);
          await route.fulfill({ json: [] });
        } else await route.continue();
      });
      await page.routeWebSocket("**/api/companies/*/events/ws", (socket) => {
        const server = socket.connectToServer();
        server.onMessage((message) => {
          if (suppressReviewEvents && String(message).includes("issue.thread_interaction_")) return;
          socket.send(message);
        });
      });
    }
        await start();
        await page.goto(`/${seed.prefix}/issues/${issue.identifier}`);
        await expect(page.getByRole("button", { name: "Approve & run", exact: true }))
          .toBeVisible({ timeout: remaining() });
        await waitInitialRun();
      const originatingReviews = await json<Array<{ id: string; sourceRunId: string | null }>>(await request.get(`/api/issues/${issue.id}/interactions`));
      const originatingReview = originatingReviews[0];
      expect(calls()).toBe(0);
      await page.screenshot({
        path: testInfo.outputPath("pending-review.png"),
      });
      await page
        .getByRole("button", { name: "Dismiss Approve tool action" })
        .click();
      await expect(
        page.getByRole("button", { name: "Approve & run", exact: true }),
      ).not.toBeVisible();
      const savedPendingNote = await json<{ id: string }>(
        await request.post(`/api/issues/${issue.id}/comments`, {
          data: { body: "Keeping this review pending while I check." },
        }),
      );
      await recordPendingComment(savedPendingNote.id);
      expect(calls()).toBe(0);
      await page
        .getByRole("button", { name: "Review request", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Approve & run", exact: true }),
      ).toBeVisible();
      const queue = await context.newPage();
      await queue.goto(`/${seed.prefix}/apps/review`);
      await expect(
        queue.getByRole("button", { name: "Decline", exact: true }),
      ).toBeVisible({ timeout: remaining() });
      if (journey === "decline") {
        // Resolve from Connections and observe the still-open task tab update.
        await queue
          .getByRole("button", { name: "Decline", exact: true })
          .click();

      } else {
        if (journey === "always") {
          await page.getByRole("button", { name: "Approval options", exact: true }).click();
          await page.getByRole("menuitem", { name: "Always allow", exact: true }).click();
        } else {
          await page.getByRole("button", { name: "Approve & run", exact: true }).click();
        }
      }
      await expect
        .poll(
          async () =>
            (
              await json<Array<{ body: string }>>(
                await request.get(`/api/issues/${issue.id}/comments`),
              )
            )
              .map((c) => c.body)
              .join("\n"),
          { timeout: remaining() },
        )
        .toContain(
          journey === "decline"
            ? "Review declined"
            : journey === "failure"
              ? "Read failed"
              : "Roadmap",
        );
      const replies = await json<Array<{ body: string; authorAgentId: string | null; createdByRunId: string | null }>>(await request.get(`/api/issues/${issue.id}/comments`));
      const reply = replies.find(comment => comment.authorAgentId === agent.id && comment.createdByRunId === resolutionRunId())!;
      expect(reply.createdByRunId).toBeTruthy();
      expect(reply.createdByRunId).toBe(resolutionRunId());
      expect(originatingReview.sourceRunId).toBeTruthy();
      expect(reply.createdByRunId).not.toBe(originatingReview.sourceRunId);
      expect(reply.body).not.toContain('"content":');
      if (!["decline", "failure"].includes(journey)) {
        await expect(page.getByRole("button", { name: "Show result details" })).toBeVisible();
        await expect(page.locator("pre")).not.toBeVisible();
        await page.getByRole("button", { name: "Show result details" }).click();
        await expect(page.locator("pre")).toContainText('"content":');
        await page.getByRole("button", { name: "Hide result details" }).click();
      }
      expect(calls()).toBe(journey === "decline" ? 0 : 1);
      // The decline case intentionally dropped the live interaction event and
      // returned an empty first snapshot. Verify IssueDetail's retained polling
      // reconciliation removes the stale pending card without a manual reload.
      await expect(
        page.getByRole("button", { name: "Approve & run", exact: true }),
      ).not.toBeVisible({ timeout: remaining() });
      await expect(
        queue.getByRole("button", { name: "Decline", exact: true }),
      ).not.toBeVisible({ timeout: remaining() });
      await expect
        .poll(
          async () =>
            (await json<{ status: string }>(await request.get(`/api/issues/${issue.id}`))).status,
          { timeout: remaining() },
        )
        .toBe("done");
      const showResolvedDetails = page.getByRole("button", {
        name: "Show result details",
        exact: true,
      });
      if (await showResolvedDetails.isVisible()) await showResolvedDetails.click();
      await expect(
        page
          .getByText(
            journey === "decline"
              ? "Declined"
              : journey === "failure"
                ? "Execution failed"
                : "Succeeded",
            { exact: false },
          )
          .first(),
      ).toBeVisible();
      const hideResolvedDetails = page.getByRole("button", {
        name: "Hide result details",
        exact: true,
      });
      if (await hideResolvedDetails.isVisible()) await hideResolvedDetails.click();
      await page.screenshot({
        path: testInfo.outputPath("resolved-review.png"),
      });
      if (journey === "always") {
        const later = await createLaterTask();
        await expect
          .poll(
            async () =>
              (
                await json<Array<{ body: string }>>(
                  await request.get(`/api/issues/${later.id}/comments`),
                )
              )
                .map((c) => c.body)
                .join("\n"),
            { timeout: remaining() },
          )
          .toContain("Roadmap");
        expect(calls()).toBe(2);
        expect(
          await json<unknown[]>(
            await request.get(`/api/issues/${later.id}/interactions`),
          ),
        ).toHaveLength(0);
      }
      await testInfo.attach("journey", {
        body: JSON.stringify(
          {
            source: "actual managed Native Runs with the fixed Railway GraphQL bridge; no live Railway",
            journey,
            ...seed,
            issue,
            agent,
            providerCalls: calls(),
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
      await queue.close();
      },
    });
  });
}
